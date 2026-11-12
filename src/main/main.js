'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { Store, STATUSES } = require('../core/store');
const { runAll } = require('../core/sources');
const { buildApplication } = require('../core/templates');
const gmail = require('../core/gmail');
const cfgmod = require('./config');

let win;
let store;
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
function seedIfNeeded() {
  if (store.getSetting('seeded')) return;
  const dir = path.join(__dirname, '..', '..', 'seed');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')) : []) {
    store.upsertJobs(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  store.setSetting('seeded', true);
}

function attachmentsFor(lang, want) {
  const f = config.files;
  const out = [];
  const cv = lang === 'pt' ? f.cvPt : f.cvEn;
  if (want.cv) { need(cv && fs.existsSync(cv), 'Escolha o arquivo do currículo nas Configurações.'); out.push({ path: cv }); }
  if (want.portfolio) { need(f.portfolio && fs.existsSync(f.portfolio), 'Escolha o arquivo do portfólio nas Configurações.'); out.push({ path: f.portfolio }); }
  return out;
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
    const { jobs, report, lastFetch } = await runAll(config, { lastFetch: store.getSetting('lastFetch', {}), force: !!force });
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
  ipcMain.handle('files:pick', async (_e, kind) => {
    need(['cvPt', 'cvEn', 'portfolio'].includes(kind), 'Tipo de arquivo inválido.');
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    config.files[kind] = r.filePaths[0];
    cfgmod.save(cfgFile, config);
    return r.filePaths[0];
  });

  ipcMain.handle('app:prepare', (_e, id, lang) => {
    const job = store.get(String(id));
    need(job, 'Vaga não encontrada.');
    const l = lang === 'pt' || lang === 'en' ? lang : job.cvLang || undefined;
    const t = buildApplication(job, { lang: l, profile: config.profile });
    const f = config.files;
    return { ...t, to: job.email || '', cvFile: t.lang === 'pt' ? f.cvPt : f.cvEn, portfolioFile: f.portfolio, job: { id: job.id, title: job.title, company: job.company, url: job.url } };
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
    const job = store.get(String(p.id));
    need(job, 'Vaga não encontrada.');
    need(!p.to || /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(p.to), 'E-mail do destinatário inválido.');
    const lang = p.lang === 'pt' ? 'pt' : 'en';
    const draft = await g.createDraft({ to: p.to || '', subject: String(p.subject).slice(0, 300), body: String(p.body).slice(0, 20000), attachments: attachmentsFor(lang, { cv: !!p.attachCv, portfolio: !!p.attachPortfolio }) });
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
    seedIfNeeded();
    registerIpc();
    createWindow();
  });
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => app.quit());
}
