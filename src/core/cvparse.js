'use strict';
const fs = require('node:fs');
const { norm } = require('./text');

// Ferramentas que o app sabe reconhecer num currículo e numa vaga.
const KNOWN_TOOLS = [
  { key: '3ds Max', re: /\b3\s?ds\s?max\b/ },
  { key: 'Corona Renderer', re: /\bcorona\b/ },
  { key: 'V-Ray', re: /\bv-?ray\b/ },
  { key: 'Photoshop', re: /\bphotoshop\b|pacote adobe|adobe creative/ },
  { key: 'SketchUp', re: /\bsketch\s?up\b/ },
  { key: 'AutoCAD', re: /\bautocad\b/ },
  { key: 'Archicad', re: /\barchicad\b/ },
  { key: 'Revit', re: /\brevit\b/ },
  { key: 'Blender', re: /\bblender\b/ },
  { key: 'Unreal Engine', re: /\bunreal\b/ },
  { key: 'Lumion', re: /\blumion\b/ },
  { key: 'Enscape', re: /\benscape\b/ },
  { key: 'D5 Render', re: /\bd5 render\b/ },
  { key: 'Twinmotion', re: /\btwinmotion\b/ },
  { key: 'Rhino', re: /\brhino(ceros)?\b/ },
  { key: 'Cinema 4D', re: /\bcinema 4d\b|\bc4d\b/ },
  { key: 'After Effects', re: /\bafter effects\b/ },
  { key: 'Forest Pack', re: /\bforest ?pack\b/ },
  { key: 'RailClone', re: /\brailclone\b/ },
];

/** Lê o texto de um PDF, linha por linha. */
async function extractPdfText(file) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = '';
    let lastY = null;
    for (const it of content.items) {
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += (line && !line.endsWith(' ') && it.str && !it.str.startsWith(' ') ? ' ' : '') + it.str;
      lastY = y;
    }
    lines.push(line);
  }
  await doc.destroy();
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

function toolsIn(text) {
  const t = norm(text);
  return KNOWN_TOOLS.filter((k) => k.re.test(t)).map((k) => k.key);
}

/** Deixa o cargo do cabeçalho em forma de frase: "Arquiteto e Artista 3D – Generalista" → "arquiteto e artista 3D – generalista". */
function sentenceCase(s) {
  return s.split(/(\s+)/).map((w) => (/^[A-ZÀ-Ý][a-zà-ÿ]+$/.test(w) ? w.toLowerCase() : w)).join('');
}

/**
 * Tira do texto do currículo o que serve para o perfil. Só devolve o que achou.
 * lang diz em que idioma está o currículo (para o cargo do cabeçalho).
 */
function profileFromText(text, lang = 'pt') {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = {};
  const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(text);
  if (email) out.email = email[0];
  const phone = /\+?\d{1,3}[\s.-]?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/.exec(text);
  if (phone) out.phone = phone[0].trim();
  const emailDomain = out.email ? out.email.split('@')[1].toLowerCase() : '';
  for (const m of String(text).matchAll(/\b(?:https?:\/\/)?((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|art|design|studio|me|co|pt|br)(?:\.br|\.pt)?)(\/[\w./-]*)?\b/gi)) {
    const d = m[1].toLowerCase();
    if (d === emailDomain || /linkedin|gmail|hotmail|outlook|yahoo/.test(d) || String(text).charAt(m.index - 1) === '@') continue;
    out.site = d + (m[2] && m[2] !== '/' ? m[2] : '');
    break;
  }
  // Nome: primeira linha com 2 a 5 palavras capitalizadas, sem dígitos nem @.
  const nameLine = lines.slice(0, 5).find((l) => /^([A-ZÀ-Ý][\wÀ-ÿ'’-]+\s){1,4}[A-ZÀ-Ý][\wÀ-ÿ'’-]+$/.test(l) && !/\d|@/.test(l));
  if (nameLine) out.name = nameLine;
  // Cargo: a linha logo depois do nome.
  if (nameLine) {
    const next = lines[lines.indexOf(nameLine) + 1];
    if (next && next.length <= 80 && !/@|\.(com|br)\b|\d{4}/.test(next)) out.headline = { [lang]: sentenceCase(next) };
  }
  const city = lines.slice(0, 12).find((l) => /^[A-ZÀ-Ý][\wÀ-ÿ\s]+,\s?[A-Z]{2}\b(,\s?[A-ZÀ-Ý][\wÀ-ÿ\s]+)?$/.test(l));
  if (city) out.city = { [lang]: city };
  const years = /(?:mais de|over|more than)?\s*(\d{1,2})\+?\s*(?:anos|years)/i.exec(text);
  if (years) out.years = Number(years[1]);
  const tools = toolsIn(text);
  if (tools.length) out.skills = tools;
  const t = norm(text);
  out.ai = /\b(ia|ai)\b|inteligencia artificial|artificial intelligence/.test(t);
  out.animation = /anima(cao|coes|tion|tions)|video/.test(t);
  return out;
}

/**
 * Junta o que veio do currículo ao perfil atual. Nunca sobrescreve um campo que você já preencheu,
 * a não ser as ferramentas, que somam.
 */
function mergeProfile(current, found) {
  const p = JSON.parse(JSON.stringify(current));
  const filled = [];
  for (const k of ['name', 'email', 'phone', 'site', 'years']) {
    if (found[k] && !p[k]) { p[k] = found[k]; filled.push(k); }
  }
  for (const k of ['headline', 'city']) {
    for (const [l, v] of Object.entries(found[k] || {})) {
      p[k] = p[k] || {};
      if (v && !p[k][l]) { p[k][l] = v; filled.push(`${k}.${l}`); }
    }
  }
  if (found.skills) {
    const before = (p.skills || []).length;
    p.skills = [...new Set([...(p.skills || []), ...found.skills])];
    if (p.skills.length > before) filled.push('skills');
  }
  for (const k of ['ai', 'animation']) if (found[k] && !p[k]) { p[k] = true; filled.push(k); }
  return { profile: p, filled };
}

module.exports = { KNOWN_TOOLS, extractPdfText, profileFromText, mergeProfile, toolsIn, sentenceCase };
