'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { Store, STATUSES } = require('../core/store');
const { runAll } = require('../core/sources');
const { buildApplication, buildOutreach, studioLang } = require('../core/templates');
const { Studios, STUDIO_STATUSES, mergeBoards } = require('../core/studios');
const gmail = require('../core/gmail');
const { Library, KINDS, LANGS } = require('../core/library');
const cfgmod = require('./config');

let win;
let store;
let library;
let studios;
let cfgFile;
let secretsFile;
let config;
let gmailClient = null;

const isHttps = (u) => {
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
};
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ---------- segredos (token do Gmail e client secret) criptografados pelo sistema ---------- */
function readSecrets() {
  try {
    if (!fs.existsSync(secretsFile) || !safeStorage.isEncryptionAvailable()) return {};
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsFile)));
  } catch { return {}; }
}
function writeSecrets(s) {
  need(safeStorage.isEncryptionAvailable(), 'O Windows não liberou o cofre de credenciais; não vou guardar senhas em texto puro.');
  fs.writeFileSync(secretsFile, safeStorage.encryptString(JSON.stringify(s)));
}

function getGmail() {
  const s = readSecrets();
  if (!config.google.clientId || !s.clientSecret || !s.tokens) return null;
  if (!gmailClient) {
    gmailClient = gmail.createClient({
      clientId: config.google.clientId, clientSecret: s.clientSecret, tokens: s.tokens,
      onTokens: (t) => writeSecrets({ ...readSecrets(), tokens: t }),
    });
  }
  return gmailClient;
}

/* ---------- primeira execução: importa as vagas já curadas ---------- */
/* Carrega cada arquivo de seed/ uma única vez; arquivos novos de versões futuras entram sozinhos. */
function seedIfNeeded() {
  const dir = path.join(__dirname, '..', '..', 'seed');
  const done = new Set(store.getSetting('seededFiles', store.getSetting('seeded') ? ['painel-2026-11-12.json'] : []));
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort() : []) {
    if (done.has(f)) continue;
    store.upsertJobs(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    done.add(f);
  }
  store.setSetting('seededFiles', [...done]);
}

/* Lista de estúdios que vem com o app (seed/estudios). Cada arquivo entra uma única vez. */
function seedStudios() {
  const dir = path.join(__dirname, '..', '..', 'seed', 'estudios');
  const done = new Set(store.getSetting('seededStudioFiles', []));
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort() : []) {
    if (done.has(f)) continue;
    studios.importMany(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    done.add(f);
  }
  store.setSetting('seededStudioFiles', [...done]);
}

function prepareStudio(id, lang, sel) {
  const s = studios.get(String(id));
  need(s, 'Estúdio não encontrado.');
  const l = lang === 'pt' || lang === 'en' ? lang : studioLang(s);
  const saved = s.docs && s.docs.lang === l ? s.docs : null;
  const chosen = sel ? cleanSel(sel) : saved ? cleanSel(saved) : library.defaults(l);
  const t = buildOutreach(s, { lang: l, profile: config.profile, attach: { cv: !!chosen.cv, portfolio: !!chosen.portfolio, cover: !!chosen.cover } });
  return { ...t, lang: l, to: s.email || '', sel: chosen, docs: library.list(), job: { kind: 'studio', id: s.id, title: 'Candidatura espontânea', company: s.name, url: s.site || s.careersUrl } };
}

/* Versões antigas guardavam só o caminho dos PDFs; traz esses arquivos para a biblioteca uma única vez. */
function migrateOldFiles() {
  const f = config.files || {};
  const pairs = [[f.cvPt, 'cv', 'pt'], [f.cvEn, 'cv', 'en'], [f.portfolio, 'portfolio', 'any']];
  for (const [p, kind, lang] of pairs) {
    if (p && fs.existsSync(p)) { try { library.import(p, { kind, lang }); } catch { /* ignora arquivo inválido */ } }
  }
  if (pairs.some(([p]) => p)) { config.files = { cvPt: '', cvEn: '', portfolio: '' }; cfgmod.save(cfgFile, config); }
}

/** Normaliza a escolha vinda da tela: só ids que existem e do tipo certo. */
function cleanSel(sel = {}) {
  const out = { cv: null, portfolio: null, cover: null };
  for (const k of KINDS) {
    const d = sel[k] ? library.get(sel[k]) : null;
    if (d && d.kind === k) out[k] = d.id;
  }
  return out;
}

function prepare(id, lang, sel) {
  const job = store.get(String(id));
  need(job, 'Vaga não encontrada.');
  const l = lang === 'pt' || lang === 'en' ? lang : job.cvLang || (/brasil|brazil/i.test(`${job.location} ${job.source}`) ? 'pt' : 'en');
  // ordem: escolha da tela > escolha salva da vaga (mesmo idioma) > padrões da biblioteca
  const saved = job.docs && job.docs.lang === l ? job.docs : null;
  const chosen = sel ? cleanSel(sel) : saved ? cleanSel(saved) : library.defaults(l);
  const t = buildApplication(job, { lang: l, profile: config.profile, attach: { cv: !!chosen.cv, portfolio: !!chosen.portfolio, cover: !!chosen.cover } });
  return { ...t, lang: l, to: job.email || '', sel: chosen, docs: library.list(), job: { kind: 'job', id: job.id, title: job.title, company: job.company, url: job.url } };
}

function registerIpc() {
  ipcMain.handle('jobs:list', (_e, q = {}) => ({
    jobs: store.list({ status: STATUSES.includes(q.status) ? q.status : undefined, minFit: Number(q.minFit) || 1, region: q.region, text: String(q.text || '').slice(0, 100) }),
    counts: store.counts(),
  }));
  ipcMain.handle('jobs:status', (_e, id, status) => { store.setStatus(String(id), status); return store.counts(); });
  ipcMain.handle('jobs:note', (_e, id, note) => store.setNote(String(id), String(note).slice(0, 2000)));
  ipcMain.handle('jobs:email', (_e, id, email) => {
    need(!email || /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email), 'E-mail inválido.');
    store.setEmail(String(id), email);
  });

  ipcMain.handle('scan:run', async (_e, force) => {
    // As páginas de carreiras dos estúdios entram na busca junto com as configuradas à mão.
    const scanConfig = { ...config, companies: mergeBoards(config.companies, studios.boards()) };
    const { jobs, report, lastFetch } = await runAll(scanConfig, { lastFetch: store.getSetting('lastFetch', {}), force: !!force });
    store.setSetting('lastFetch', lastFetch);
    return { added: store.upsertJobs(jobs), report };
  });
  ipcMain.handle('alerts:import', async () => {
    const g = getGmail();
    need(g, 'Conecte o Gmail nas Configurações primeiro.');
    const htmls = await g.listLinkedInAlerts();
    const found = htmls.flatMap(gmail.parseLinkedInAlert);
    return { emails: htmls.length, found: found.length, added: store.upsertJobs(found) };
  });

  ipcMain.handle('config:get', () => ({ ...config, gmailConnected: !!getGmail(), hasClientSecret: !!readSecrets().clientSecret }));
  ipcMain.handle('config:set', (_e, input) => {
    config = cfgmod.sanitize(input, config);
    cfgmod.save(cfgFile, config);
    if (input && input.googleClientSecret) writeSecrets({ ...readSecrets(), clientSecret: String(input.googleClientSecret).slice(0, 200) });
    gmailClient = null;
    return { ...config, gmailConnected: !!getGmail(), hasClientSecret: !!readSecrets().clientSecret };
  });
  /* ---------- biblioteca de documentos ---------- */
  ipcMain.handle('docs:list', () => library.list());
  ipcMain.handle('docs:import', async (_e, kind, lang) => {
    need(KINDS.includes(kind), 'Tipo de documento inválido.');
    need(LANGS.includes(lang), 'Idioma inválido.');
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF ou Word', extensions: ['pdf', 'docx', 'doc'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((p) => library.import(p, { kind, lang }));
  });
  ipcMain.handle('docs:remove', (_e, id) => library.remove(String(id)));
  ipcMain.handle('docs:default', (_e, id) => library.setDefault(String(id)));
  ipcMain.handle('docs:lang', (_e, id, lang) => library.setLang(String(id), lang));
  ipcMain.handle('docs:open', async (_e, id) => {
    const d = library.get(String(id));
    need(d, 'Documento não encontrado.');
    const err = await shell.openPath(library.pathOf(d));
    need(!err, `Não consegui abrir: ${err}`);
  });

  /* ---------- estúdios (candidatura espontânea) ---------- */
  ipcMain.handle('studios:list', (_e, q = {}) => ({
    studios: studios.list({ status: STUDIO_STATUSES.includes(q.status) ? q.status : undefined, region: q.region, text: String(q.text || '').slice(0, 100) }),
    counts: studios.counts(),
  }));
  ipcMain.handle('studios:add', (_e, input) => studios.add(input || {}));
  ipcMain.handle('studios:update', (_e, id, fields) => studios.update(String(id), fields || {}));
  ipcMain.handle('studios:remove', (_e, id) => studios.remove(String(id)));
  ipcMain.handle('studios:prepare', (_e, id, lang, sel) => prepareStudio(id, lang, sel));
  ipcMain.handle('studios:docs', (_e, id, lang, sel) => {
    const s = cleanSel(sel);
    studios.setDocs(String(id), { lang: lang === 'pt' ? 'pt' : 'en', ...s });
    return s;
  });

  ipcMain.handle('app:prepare', (_e, id, lang, sel) => prepare(id, lang, sel));
  ipcMain.handle('jobs:docs', (_e, id, lang, sel) => {
    const s = cleanSel(sel);
    store.setJobDocs(String(id), { lang: lang === 'pt' ? 'pt' : 'en', ...s });
    return s;
  });

  ipcMain.handle('gmail:connect', async () => {
    const s = readSecrets();
    need(config.google.clientId && s.clientSecret, 'Informe o Client ID e o Client Secret do Google nas Configurações.');
    const tokens = await gmail.authorize({ clientId: config.google.clientId, clientSecret: s.clientSecret, openUrl: (u) => shell.openExternal(u) });
    need(tokens.refreshToken, 'O Google não devolveu o token de renovação. Remova o acesso do app na sua conta Google e tente de novo.');
    writeSecrets({ ...s, tokens });
    gmailClient = null;
    return true;
  });
  ipcMain.handle('gmail:disconnect', () => {
    const { tokens, ...rest } = readSecrets();
    writeSecrets(rest);
    gmailClient = null;
    return true;
  });
  ipcMain.handle('gmail:draft', async (_e, p) => {
    const g = getGmail();
    need(g, 'Conecte o Gmail nas Configurações primeiro.');
    need(!p.to || /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(p.to), 'E-mail do destinatário inválido.');
    const lang = p.lang === 'pt' ? 'pt' : 'en';
    const sel = cleanSel(p.sel);
    if (p.kind === 'studio') {
      const s = studios.get(String(p.id));
      need(s, 'Estúdio não encontrado.');
      const draft = await g.createDraft({ to: p.to || '', subject: String(p.subject).slice(0, 300), body: String(p.body).slice(0, 20000), attachments: library.attachments(sel) });
      studios.setDocs(s.id, { lang, ...sel });
      studios.update(s.id, { status: 'rascunho', ...(p.to && !s.email ? { email: p.to } : {}) });
      return draft;
    }
    const job = store.get(String(p.id));
    need(job, 'Vaga não encontrada.');
    const draft = await g.createDraft({ to: p.to || '', subject: String(p.subject).slice(0, 300), body: String(p.body).slice(0, 20000), attachments: library.attachments(sel) });
    store.setJobDocs(job.id, { lang, ...sel });
    if (p.to) store.setEmail(job.id, p.to);
    store.setStatus(job.id, 'rascunho');
    return draft;
  });

  ipcMain.handle('shell:open', (_e, url) => { need(isHttps(url), 'Só abro links https.'); return shell.openExternal(url); });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 860, minWidth: 900, minHeight: 600, title: 'JobHunter',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => { if (isHttps(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (isHttps(url)) shell.openExternal(url); } });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    const dir = app.getPath('userData');
    cfgFile = path.join(dir, 'config.json');
    secretsFile = path.join(dir, 'secrets.bin');
    config = cfgmod.load(cfgFile);
    store = await Store.open(path.join(dir, 'jobhunter.sqlite'));
    library = new Library(store, path.join(dir, 'documentos'));
    studios = new Studios(store);
    migrateOldFiles();
    seedIfNeeded();
    seedStudios();
    registerIpc();
    createWindow();
  });
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => app.quit());
}
