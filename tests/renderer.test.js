'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const os = require('node:os');
const { Store } = require('../src/core/store');
const { Library } = require('../src/core/library');
const { Studios } = require('../src/core/studios');
const { buildApplication, buildOutreach, studioLang } = require('../src/core/templates');
const { finalize } = require('../src/core/sources');
const { countryOf } = require('../src/core/country');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8').replace(/<script src="app.js"><\/script>/, '');
const appJs = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');

async function boot(opts = {}) {
  const store = await Store.open(null);
  store.upsertJobs(JSON.parse(fs.readFileSync(path.join(root, 'seed/painel-2026-11-12.json'), 'utf8')));
  store.upsertJobs([finalize({ source: 'T', title: '<img src=x onerror=alert(1)> Archviz Artist', company: '<b>Evil</b>', location: 'Remote', remote: true, url: 'https://x/evil', description: '3ds Max Corona', posted: null, salary: null, email: null })]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jh-ui-'));
  const lib = new Library(store, path.join(tmp, 'documentos'));
  const mk = (n) => { const p = path.join(tmp, n); fs.writeFileSync(p, 'x'); return p; };
  lib.import(mk('CV_PT.pdf'), { kind: 'cv', lang: 'pt' });
  lib.import(mk('CV_EN.pdf'), { kind: 'cv', lang: 'en' });
  lib.import(mk('Portfolio.pdf'), { kind: 'portfolio', lang: 'any' });
  let nextCover = mk('Cover_Acme.pdf');
  const drafts = [];
  const studios = new Studios(store);
  studios.importMany(require('../seed/estudios/estudios-2026-11-12.json'));
  const archviz = { id: 'archviz', name: 'ArchViz remoto', terms: ['artista 3d'], preset: 'archviz', lastOpened: null };
  const interiores = { id: 'interiores', name: 'Interiores', terms: ['designer de interiores'], preset: '', lastOpened: null };
  const envLog = [];
  let active = opts.home ? null : archviz;
  const jh = {
    envState: async () => ({ envs: [archviz, interiores], active }),
    envOpen: async (id) => { envLog.push(id); active = [archviz, interiores].find((e) => e.id === id) || { id, name: id, terms: [], preset: '' }; return active; },
    envHome: async () => { active = null; return true; },
    envCreate: async (i) => ({ id: 'novo', name: i.name, terms: String(i.terms).split(','), preset: '', lastOpened: null }),
    studios: async (q) => ({ studios: studios.list({ status: q.status || undefined, region: q.region, text: q.text }), counts: studios.counts() }),
    addStudio: async (i) => studios.add(i),
    updateStudio: async (id, f) => studios.update(id, f),
    removeStudio: async (id) => studios.remove(id),
    prepareStudio: async (id, lang, sel) => {
      const s = studios.get(id);
      const l = lang || studioLang(s);
      const chosen = sel || lib.defaults(l);
      const t = buildOutreach(s, { lang: l, attach: { cv: !!chosen.cv, portfolio: !!chosen.portfolio, cover: !!chosen.cover } });
      return { ...t, lang: l, to: s.email || '', sel: chosen, docs: lib.list(), job: { kind: 'studio', id: s.id, title: 'Candidatura espontânea', company: s.name, url: s.site } };
    },
    saveStudioDocs: async (id, lang, sel) => studios.setDocs(id, { lang, ...sel }),
    list: async (q) => ({ jobs: store.list({ status: q.status || undefined, minFit: q.minFit, region: q.region, text: q.text }).map((j) => ({ ...j, country: countryOf(j.location) })), counts: store.counts() }),
    setStatus: async (id, s) => { store.setStatus(id, s); return store.counts(); },
    prepare: async (id, lang, sel) => {
      const j = store.get(id);
      const l = lang || j.cvLang || 'en';
      const chosen = sel || lib.defaults(l);
      const t = buildApplication(j, { lang: l, attach: { cv: !!chosen.cv, portfolio: !!chosen.portfolio, cover: !!chosen.cover } });
      return { ...t, lang: l, to: j.email || '', sel: chosen, docs: lib.list(), job: { id: j.id, title: j.title, company: j.company, url: j.url } };
    },
    saveJobDocs: async (id, lang, sel) => store.setJobDocs(id, { lang, ...sel }),
    importDocs: async (kind, lang) => ({ docs: [lib.import(nextCover, { kind, lang })], filled: [] }),
    docs: async () => lib.list(),
    createDraft: async (p) => { drafts.push(p); store.setStatus(p.id, 'rascunho'); return { id: 'd1' }; },
    open: async () => {}, getConfig: async () => ({ profile: { city: {}, availability: {} }, files: {}, google: {}, companies: {}, adzuna: {} }),
  };
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///app/index.html' });
  dom.window.jh = jh;
  dom.window.eval(appJs);
  await new Promise((r) => setTimeout(r, 50));
  return { dom, doc: dom.window.document, drafts, store, lib, studios, envLog };
}
const tick = () => new Promise((r) => setTimeout(r, 60));

test('renderiza cartões e nunca interpreta HTML vindo de vagas', async () => {
  const { doc } = await boot();
  const cards = doc.querySelectorAll('.card');
  assert.ok(cards.length >= 10);
  assert.equal(doc.querySelector('.card .title img, .card .co img'), null); // o <img> malicioso virou texto
  assert.ok([...doc.querySelectorAll('.card img')].every((i) => i.classList.contains('flag') && i.src.startsWith('data:image/svg+xml'))); // só as bandeiras são imagem
  assert.ok([...doc.querySelectorAll('.title')].some((t) => t.textContent.includes('<img src=x')));
});

test('marcar Aplicar atualiza o funil', async () => {
  const { doc } = await boot();
  doc.querySelector('.card button.aplicar').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(doc.querySelector('.card.aplicar') !== null, true);
  assert.match(doc.getElementById('stats').textContent, /1\s*aplicar/);
});

test('modal usa os documentos padrão da biblioteca e aceita cover letter carregada na hora', async () => {
  const { doc, drafts, lib, dom } = await boot();
  [...doc.querySelectorAll('.card button')].find((b) => b.textContent === 'Preparar candidatura').click();
  await tick();
  assert.equal(doc.getElementById('modal').hidden, false);
  const cvSel = doc.getElementById('m-cv');
  const chosenCv = lib.get(cvSel.value);
  assert.equal(chosenCv.lang, doc.getElementById('m-lang').value); // CV do idioma da candidatura
  assert.ok(doc.getElementById('m-pf').value);
  assert.equal(doc.getElementById('m-cover').value, ''); // cover só quando pedir
  assert.doesNotMatch(doc.getElementById('m-body').value, /cover letter|carta de apresenta/);

  doc.getElementById('m-cover-up').click();
  await tick();
  assert.ok(doc.getElementById('m-cover').value);
  assert.match(doc.getElementById('m-body').value, /cover letter|carta de apresenta/); // texto acompanhou

  doc.getElementById('m-pf').value = '';
  doc.getElementById('m-pf').dispatchEvent(new dom.window.Event('change'));
  await tick();
  doc.getElementById('m-draft').click();
  await tick();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].sel.cv, chosenCv.id);
  assert.equal(drafts[0].sel.portfolio, null);
  assert.ok(drafts[0].sel.cover);
});

test('texto editado à mão não é sobrescrito ao trocar anexos', async () => {
  const { doc, dom } = await boot();
  [...doc.querySelectorAll('.card button')].find((b) => b.textContent === 'Preparar candidatura').click();
  await tick();
  doc.getElementById('m-body').value = 'Meu texto próprio';
  doc.getElementById('m-pf').value = '';
  doc.getElementById('m-pf').dispatchEvent(new dom.window.Event('change'));
  await tick();
  assert.equal(doc.getElementById('m-body').value, 'Meu texto próprio');
  assert.match(doc.getElementById('m-note').textContent, /editou o texto/);
});

test('aba Documentos lista os arquivos por tipo e marca o padrão', async () => {
  const { doc } = await boot();
  doc.querySelector('.tab[data-view="docs"]').click();
  await tick();
  assert.equal(doc.getElementById('view-docs').hidden, false);
  assert.equal(doc.querySelectorAll('#docs-cv .doc').length, 2);
  assert.equal(doc.querySelectorAll('#docs-cv .badge').length, 2); // um padrão por idioma
  assert.equal(doc.querySelectorAll('#docs-portfolio .doc').length, 1);
  assert.match(doc.getElementById('docs-cover').textContent, /Nenhum arquivo carregado/);
});

test('aba Estúdios: separada das vagas, abordagem vira rascunho e marca contatado', async () => {
  const { doc, drafts, studios, dom } = await boot();
  doc.querySelector('.tab[data-view="studios"]').click();
  await tick();
  assert.equal(doc.getElementById('view-studios').hidden, false);
  assert.equal(doc.getElementById('view-vagas').hidden, true);
  const cards = doc.querySelectorAll('#s-grid .card');
  assert.ok(cards.length >= 20);
  // nenhum estúdio aparece entre as vagas
  assert.ok(![...doc.querySelectorAll('#grid .title')].some((t) => t.textContent === 'Oficina3D'));

  doc.getElementById('s-reg').value = 'Brasil';
  doc.getElementById('s-reg').dispatchEvent(new dom.window.Event('input'));
  await tick();
  const oficina = [...doc.querySelectorAll('#s-grid .card')].find((c) => c.querySelector('.title').textContent === 'Oficina3D');
  assert.ok(oficina);
  [...oficina.querySelectorAll('button')].find((b) => b.textContent === 'Preparar abordagem').click();
  await tick();
  assert.equal(doc.getElementById('m-lang').value, 'pt');
  assert.equal(doc.getElementById('m-to').value, 'contato@oficina3d.com.br');
  assert.match(doc.getElementById('m-body').value, /Olá, equipe Oficina3D/);
  assert.equal(doc.getElementById('m-sent').textContent, 'Marcar como contatado');
  doc.getElementById('m-draft').click();
  await tick();
  assert.equal(drafts.at(-1).kind, 'studio');
  doc.getElementById('m-sent').click();
  await tick();
  const s = studios.list().find((x) => x.name === 'Oficina3D');
  assert.equal(s.status, 'contatado');
});

test('adicionar estúdio pelo formulário', async () => {
  const { doc, dom, studios } = await boot();
  doc.querySelector('.tab[data-view="studios"]').click();
  await tick();
  doc.getElementById('s-new').click();
  doc.getElementById('sf-name').value = 'Estúdio Novo';
  doc.getElementById('sf-country').value = 'Portugal';
  doc.getElementById('sf-ats').value = 'lever';
  doc.getElementById('sf-slug').value = 'estudionovo';
  doc.getElementById('s-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await tick();
  assert.ok(studios.list().some((x) => x.name === 'Estúdio Novo' && x.ats === 'lever'));
  assert.equal(doc.getElementById('s-form').hidden, true);
});

test('sem ambiente aberto, mostra a página inicial com uma janela por ambiente', async () => {
  const { doc } = await boot({ home: true });
  assert.equal(doc.getElementById('view-home').hidden, false);
  assert.equal(doc.getElementById('view-vagas').hidden, true);
  assert.equal(doc.getElementById('tabs').hidden, true);
  const tiles = [...doc.querySelectorAll('#home-grid .tile')];
  assert.equal(tiles.length, 3); // dois ambientes + "Novo ambiente"
  assert.match(tiles[0].textContent, /ArchViz remoto/);
});

test('clicar na janela abre o ambiente; o seletor troca e o botão volta à página inicial', async () => {
  const { doc, dom, envLog } = await boot({ home: true });
  doc.querySelectorAll('#home-grid .tile')[1].click();
  await tick();
  assert.deepEqual(envLog, ['interiores']);
  assert.equal(doc.getElementById('view-vagas').hidden, false);
  assert.equal(doc.getElementById('env-switch').value, 'interiores');
  assert.equal(doc.getElementById('fit').value, '1'); // ambiente novo mostra todas as vagas
  const sw = doc.getElementById('env-switch');
  sw.value = 'archviz';
  sw.dispatchEvent(new dom.window.Event('change'));
  await tick();
  assert.deepEqual(envLog, ['interiores', 'archviz']);
  assert.equal(doc.getElementById('fit').value, '3');
  doc.getElementById('env-home').click();
  await tick();
  assert.equal(doc.getElementById('view-home').hidden, false);
});

test('criar ambiente pelo formulário abre o ambiente novo', async () => {
  const { doc, dom, envLog } = await boot({ home: true });
  doc.querySelector('#home-grid .tile.new').click();
  assert.equal(doc.getElementById('env-form').hidden, false);
  doc.getElementById('env-name').value = 'Novo';
  doc.getElementById('env-terms').value = 'a, b';
  doc.getElementById('env-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(envLog, ['novo']);
});

test('o cartão mostra o local em destaque, com bandeira e país quando identificado', async () => {
  const { doc } = await boot();
  const locs = [...doc.querySelectorAll('.card .loc')];
  assert.ok(locs.length > 0);
  const withCountry = locs.find((l) => l.querySelector('.ctry'));
  assert.ok(withCountry, 'ao menos uma vaga do seed tem país identificado');
  assert.ok(withCountry.querySelector('.flag'));
});
