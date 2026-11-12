'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { decodeEntities, canonicalUrl, hashId, dedupeKey } = require('./text');

// Só rascunhos e leitura. Nunca pedimos o escopo de envio: o app não consegue mandar e-mail sozinho.
const SCOPES = ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly'];
const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');

function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function cleanHeader(v) {
  return String(v || '').replace(/[\r\n]+/g, ' ').trim();
}

const MIME_BY_EXT = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

/** Monta a mensagem MIME (texto + anexos) e devolve em base64url, formato que a API do Gmail espera. */
function buildRawMessage({ to, subject, body, attachments = [] }) {
  const boundary = `jh_${crypto.randomBytes(12).toString('hex')}`;
  const lines = [];
  if (to) lines.push(`To: ${cleanHeader(to)}`);
  lines.push(`Subject: ${encodeHeader(cleanHeader(subject))}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '');
  lines.push(`--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(String(body || ''), 'utf8').toString('base64')));
  for (const a of attachments) {
    const data = fs.readFileSync(a.path);
    if (data.length > MAX_ATTACH_BYTES) throw new Error(`Anexo grande demais (${Math.round(data.length / 1048576)} MB): ${path.basename(a.path)}`);
    const name = cleanHeader(a.filename || path.basename(a.path));
    const type = a.mimeType || MIME_BY_EXT[path.extname(name).toLowerCase()] || 'application/octet-stream';
    lines.push(
      `--${boundary}`,
      `Content-Type: ${type}; name="${encodeHeader(name)}"`,
      `Content-Disposition: attachment; filename="${encodeHeader(name)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(data.toString('base64'))
    );
  }
  lines.push(`--${boundary}--`, '');
  return b64url(lines.join('\r\n'));
}

/* ---------- OAuth (app instalado, PKCE, redirecionamento local) ---------- */

function pkcePair() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

function authUrl({ clientId, redirectUri, challenge, state }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/**
 * Abre o fluxo de login do Google. `openUrl` abre o navegador (shell.openExternal no Electron).
 * Devolve os tokens; quem chama decide onde guardar (criptografado).
 */
async function authorize({ clientId, clientSecret, openUrl, fetchImpl = fetch, timeoutMs = 180000 }) {
  const { verifier, challenge } = pkcePair();
  const state = b64url(crypto.randomBytes(16));
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tempo esgotado esperando o login do Google.')), timeoutMs);
      server.on('request', (req, res) => {
        const u = new URL(req.url, redirectUri);
        if (u.searchParams.get('state') !== state || (!u.searchParams.get('code') && !u.searchParams.get('error'))) {
          res.writeHead(400).end('Requisição inválida.');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>Tudo certo. Pode fechar esta aba e voltar ao JobHunter.</p>');
        clearTimeout(timer);
        if (u.searchParams.get('error')) reject(new Error(`Google recusou: ${u.searchParams.get('error')}`));
        else resolve(u.searchParams.get('code'));
      });
      openUrl(authUrl({ clientId, redirectUri, challenge, state }));
    });
    return tokenRequest(fetchImpl, { client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  } finally {
    server.close();
  }
}

async function tokenRequest(fetchImpl, form) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Falha no login do Google: ${j.error_description || j.error || res.status}`);
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
}

/** Cliente da API do Gmail que renova o token sozinho. `tokens` vem do authorize(); `onTokens` persiste a renovação. */
function createClient({ clientId, clientSecret, tokens, onTokens = () => {}, fetchImpl = fetch }) {
  let t = { ...tokens };
  async function bearer() {
    if (!t.accessToken || Date.now() >= (t.expiresAt || 0)) {
      if (!t.refreshToken) throw new Error('Sessão do Gmail expirou. Conecte de novo nas configurações.');
      const n = await tokenRequest(fetchImpl, { client_id: clientId, client_secret: clientSecret, refresh_token: t.refreshToken, grant_type: 'refresh_token' });
      t = { ...t, accessToken: n.accessToken, expiresAt: n.expiresAt };
      onTokens(t);
    }
    return t.accessToken;
  }
  async function api(method, url, body) {
    const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/${url}`, {
      method,
      headers: { Authorization: `Bearer ${await bearer()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`Gmail: ${(j.error && j.error.message) || res.status}`);
    return j;
  }
  return {
    /** Cria um RASCUNHO. Nada é enviado: você revisa e clica em enviar no Gmail. */
    async createDraft(msg) {
      const d = await api('POST', 'drafts', { message: { raw: buildRawMessage(msg) } });
      return { id: d.id, url: 'https://mail.google.com/mail/u/0/#drafts' };
    },
    async listLinkedInAlerts(max = 20) {
      const q = encodeURIComponent('from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com) newer_than:14d');
      const list = await api('GET', `messages?q=${q}&maxResults=${max}`);
      const out = [];
      for (const m of list.messages || []) {
        const full = await api('GET', `messages/${m.id}?format=full`);
        out.push(extractHtml(full.payload));
      }
      return out.filter(Boolean);
    },
  };
}

function extractHtml(part) {
  if (!part) return '';
  if (part.mimeType === 'text/html' && part.body && part.body.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts || []) {
    const h = extractHtml(p);
    if (h) return h;
  }
  return '';
}

/**
 * Extrai vagas de um e-mail de alerta do LinkedIn (melhor esforço: o layout do e-mail muda).
 * Pega os links /jobs/view/<id> e o texto do link como título.
 */
function parseLinkedInAlert(html) {
  const jobs = new Map();
  const re = /<a\b[^>]*href="([^"]*linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^"/?]*-)?(\d{6,}))[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const id = m[2];
    const title = decodeEntities(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!title || /^(ver|view|see|apply|candidat)/i.test(title) || title.length < 4) continue;
    if (jobs.has(id)) continue;
    const url = canonicalUrl(`https://www.linkedin.com/jobs/view/${id}`);
    jobs.set(id, { source: 'LinkedIn (alerta por e-mail)', title, company: 'Ver no LinkedIn', location: '', remote: null, url, posted: null, description: '', salary: null, email: null, id: hashId(url), dedupeKey: dedupeKey('linkedin', id) });
  }
  return [...jobs.values()];
}

module.exports = { SCOPES, buildRawMessage, pkcePair, authUrl, authorize, createClient, parseLinkedInAlert, extractHtml };
