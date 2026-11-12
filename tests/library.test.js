'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/core/store');
const { Library } = require('../src/core/library');
const { buildApplication } = require('../src/core/templates');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jh-lib-')); }
function file(dir, name, bytes = 100) { const p = path.join(dir, name); fs.writeFileSync(p, Buffer.alloc(bytes, 1)); return p; }

async function setup() {
  const store = await Store.open(null);
  const src = tmp();
  return { store, lib: new Library(store, path.join(tmp(), 'documentos')), src };
}

test('importa copiando o arquivo e o primeiro de cada idioma vira padrão', async () => {
  const { lib, src } = await setup();
  const orig = file(src, 'CV_ANA_TESTE_PT.pdf');
  const a = lib.import(orig, { kind: 'cv', lang: 'pt' });
  const b = lib.import(file(src, 'CV_v2_PT.pdf'), { kind: 'cv', lang: 'pt' });
  const c = lib.import(file(src, 'CV_EN.pdf'), { kind: 'cv', lang: 'en' });
  assert.equal(a.isDefault, true);
  assert.equal(b.isDefault, false);
  assert.equal(c.isDefault, true);
  assert.equal(a.name, 'CV_ANA_TESTE_PT.pdf');
  fs.unlinkSync(orig); // apagar o original não afeta a cópia
  assert.ok(fs.existsSync(lib.pathOf(a)));
});

test('cover letter nunca vira padrão nem é escolhida automaticamente', async () => {
  const { lib, src } = await setup();
  const cov = lib.import(file(src, 'cover.pdf'), { kind: 'cover', lang: 'en' });
  assert.equal(cov.isDefault, false);
  assert.equal(lib.defaults('en').cover, null);
});

test('defaults: padrão do idioma > padrão "qualquer" > mais recente', async () => {
  const { lib, src } = await setup();
  const pf = lib.import(file(src, 'portfolio.pdf'), { kind: 'portfolio', lang: 'any' });
  const pt = lib.import(file(src, 'cv-pt.pdf'), { kind: 'cv', lang: 'pt' });
  const pt2 = lib.import(file(src, 'cv-pt-2.pdf'), { kind: 'cv', lang: 'pt' });
  assert.deepEqual(lib.defaults('pt'), { cv: pt.id, portfolio: pf.id, cover: null });
  lib.setDefault(pt2.id);
  assert.equal(lib.defaults('pt').cv, pt2.id);
  assert.equal(lib.get(pt.id).isDefault, false);
  assert.equal(lib.defaults('en').cv, null); // sem CV em inglês: não manda o português no lugar
  assert.equal(lib.defaults('en').portfolio, pf.id);
});

test('remover apaga a cópia e promove outro padrão', async () => {
  const { lib, src } = await setup();
  const a = lib.import(file(src, 'a.pdf'), { kind: 'cv', lang: 'en' });
  const b = lib.import(file(src, 'b.pdf'), { kind: 'cv', lang: 'en' });
  lib.remove(a.id);
  assert.equal(fs.existsSync(lib.pathOf(a)), false);
  assert.equal(lib.get(b.id).isDefault, true);
});

test('trocar idioma não deixa dois padrões', async () => {
  const { lib, src } = await setup();
  const pt = lib.import(file(src, 'a.pdf'), { kind: 'cv', lang: 'pt' });
  const en = lib.import(file(src, 'b.pdf'), { kind: 'cv', lang: 'en' });
  lib.setLang(pt.id, 'en');
  assert.equal(lib.list('cv').filter((d) => d.isDefault && d.lang === 'en').length, 1);
  assert.equal(lib.get(en.id).isDefault, true);
});

test('validações: formato, tamanho total e documento removido', async () => {
  const { lib, src } = await setup();
  assert.throws(() => lib.import(file(src, 'x.exe'), { kind: 'cv', lang: 'pt' }), /Formato/);
  assert.throws(() => lib.import(file(src, 'x.pdf'), { kind: 'foto', lang: 'pt' }), /Tipo/);
  const big1 = lib.import(file(src, 'p1.pdf', 13 * 1024 * 1024), { kind: 'portfolio', lang: 'any' });
  const big2 = lib.import(file(src, 'c.pdf', 13 * 1024 * 1024), { kind: 'cv', lang: 'en' });
  assert.throws(() => lib.attachments({ cv: big2.id, portfolio: big1.id }), /25 MB/);
  const ok = lib.attachments({ cv: big2.id });
  assert.equal(ok[0].filename, 'c.pdf');
  lib.remove(big2.id);
  assert.throws(() => lib.attachments({ cv: big2.id }), /não está mais/);
});

test('texto do e-mail acompanha os anexos escolhidos', () => {
  const job = { title: 'Archviz Artist', company: 'Acme', location: 'Remote', source: 'X', description: '' };
  assert.match(buildApplication(job, { lang: 'en', attach: { cv: true, portfolio: true, cover: true } }).body, /My CV, my portfolio and a cover letter are attached/);
  assert.match(buildApplication(job, { lang: 'en', attach: { cv: true } }).body, /My CV is attached/);
  assert.match(buildApplication(job, { lang: 'pt', attach: { cv: true, cover: true } }).body, /Envio em anexo meu currículo e minha carta de apresentação/);
  assert.match(buildApplication(job, { lang: 'pt', profile: { site: 'meuportfolio.com' }, attach: {} }).body, /Meus trabalhos estão em meuportfolio\.com/);
  assert.doesNotMatch(buildApplication(job, { lang: 'pt', attach: {} }).body, /Meus trabalhos/);
});

test('escolha de documentos fica salva na vaga', async () => {
  const { store } = await setup();
  store.upsertJobs([{ id: 'j1', dedupeKey: 'a|b', source: 'T', title: 'Archviz', company: 'A', location: '', remote: true, url: 'https://x/1', fit: 4 }]);
  store.setJobDocs('j1', { lang: 'en', cv: 'c1', portfolio: null, cover: 'k1' });
  assert.deepEqual(store.get('j1').docs, { lang: 'en', cv: 'c1', portfolio: null, cover: 'k1' });
});
