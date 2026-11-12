'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { Store } = require('../src/core/store');
const { buildApplication } = require('../src/core/templates');
const { finalize } = require('../src/core/sources');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8').replace(/<script src="app.js"><\/script>/, '');
const appJs = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');

async function boot() {
  const store = await Store.open(null);
  store.upsertJobs(JSON.parse(fs.readFileSync(path.join(root, 'seed/painel-2026-11-12.json'), 'utf8')));
  store.upsertJobs([finalize({ source: 'T', title: '<img src=x onerror=alert(1)> Archviz Artist', company: '<b>Evil</b>', location: 'Remote', remote: true, url: 'https://x/evil', description: '3ds Max Corona', posted: null, salary: null, email: null })]);
  const drafts = [];
  const jh = {
    list: async (q) => ({ jobs: store.list({ status: q.status || undefined, minFit: q.minFit, region: q.region, text: q.text }), counts: store.counts() }),
    setStatus: async (id, s) => { store.setStatus(id, s); return store.counts(); },
    prepare: async (id, lang) => { const j = store.get(id); const t = buildApplication(j, { lang: lang || j.cvLang || undefined }); return { ...t, to: j.email || '', cvFile: 'C:\\x\\CV.pdf', portfolioFile: 'C:\\x\\Port.pdf', job: { id: j.id, title: j.title, company: j.company, url: j.url } }; },
    createDraft: async (p) => { drafts.push(p); store.setStatus(p.id, 'rascunho'); return { id: 'd1' }; },
    open: async () => {}, getConfig: async () => ({ profile: { city: {}, availability: {} }, files: {}, google: {}, companies: {}, adzuna: {} }),
  };
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///app/index.html' });
  dom.window.jh = jh;
  dom.window.eval(appJs);
  await new Promise((r) => setTimeout(r, 50));
  return { dom, doc: dom.window.document, drafts, store };
}

test('renderiza cartões e nunca interpreta HTML vindo de vagas', async () => {
  const { doc } = await boot();
  const cards = doc.querySelectorAll('.card');
  assert.ok(cards.length >= 10);
  assert.equal(doc.querySelector('.card img'), null); // o <img> malicioso virou texto
  assert.ok([...doc.querySelectorAll('.title')].some((t) => t.textContent.includes('<img src=x')));
});

test('marcar Aplicar atualiza o funil', async () => {
  const { doc } = await boot();
  doc.querySelector('.card button.aplicar').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(doc.querySelector('.card.aplicar') !== null, true);
  assert.match(doc.getElementById('stats').textContent, /1\s*aplicar/);
});

test('modal de candidatura preenche e cria rascunho com os anexos marcados', async () => {
  const { doc, drafts } = await boot();
  [...doc.querySelectorAll('.card button')].find((b) => b.textContent === 'Preparar candidatura').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(doc.getElementById('modal').hidden, false);
  assert.match(doc.getElementById('m-subject').value, /Application|Candidatura/);
  doc.getElementById('m-pf').checked = false;
  doc.getElementById('m-draft').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].attachCv, true);
  assert.equal(drafts[0].attachPortfolio, false);
});
