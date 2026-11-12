'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { Store } = require('../src/core/store');
const { Studios, mergeBoards, STUDIO_STATUSES } = require('../src/core/studios');
const { buildOutreach, studioLang } = require('../src/core/templates');
const src = require('../src/core/sources');

const seed = require('../seed/estudios/estudios-2026-11-12.json');

async function setup() {
  const store = await Store.open(null);
  return { store, studios: new Studios(store) };
}

test('seed de estúdios: todos válidos e sem duplicata', async () => {
  const { studios } = await setup();
  assert.equal(studios.importMany(seed), seed.length);
  assert.equal(studios.importMany(seed), 0); // segunda importação não duplica
  assert.ok(studios.list({ region: 'Brasil' }).length >= 10);
  assert.ok(studios.list({ region: 'Exterior' }).length >= 10);
});

test('estúdios ficam separados das vagas', async () => {
  const { store, studios } = await setup();
  studios.importMany(seed);
  assert.equal(store.list().length, 0);
  assert.equal(store.counts().nova, 0);
});

test('boards(): só estúdios com página de carreiras, no formato da busca', async () => {
  const { studios } = await setup();
  studios.importMany(seed);
  const b = studios.boards();
  assert.deepEqual(b.workable.sort(), ['boldr', 'soluis', 'utopia', 'visualhouse']);
  assert.deepEqual(b.greenhouse, ['squintopera']);
  assert.deepEqual(b.ashby, ['higharc']);
  assert.deepEqual(b.lever, []);
  const merged = mergeBoards({ workable: ['utopia', 'outro'], lever: ['x'] }, b);
  assert.deepEqual(merged.workable.sort(), ['boldr', 'outro', 'soluis', 'utopia', 'visualhouse']);
  assert.deepEqual(merged.lever, ['x']);
  // a busca de vagas passa a consultar essas páginas
  const keys = src.buildTasks({ gupy: false, companies: merged }, fetch).map((t) => t.key);
  assert.ok(keys.includes('workable:boldr') && keys.includes('gh:squintopera') && keys.includes('ashby:higharc'));
});

test('add/update/remove com validação e funil', async () => {
  const { studios } = await setup();
  const s = studios.add({ name: 'Estúdio Teste', country: 'Brasil', site: 'estudioteste.com.br', email: 'oi@estudioteste.com.br' });
  assert.equal(s.site, 'https://estudioteste.com.br');
  assert.equal(s.status, 'novo');
  assert.throws(() => studios.add({ name: 'Estúdio Teste', site: 'https://estudioteste.com.br' }), /já está na lista/);
  assert.throws(() => studios.add({ name: '' }), /nome/);
  assert.throws(() => studios.add({ name: 'X', email: 'não é email' }), /E-mail/);
  assert.throws(() => studios.add({ name: 'Y', ats: 'indeed', atsSlug: 'y' }), /Plataforma/);
  assert.throws(() => studios.add({ name: 'Z', ats: 'lever', atsSlug: '../x' }), /Identificador/);
  const u = studios.update(s.id, { status: 'contatado', notes: 'Mandei e-mail' });
  assert.equal(u.status, 'contatado');
  assert.ok(u.lastContact);
  assert.equal(u.notes, 'Mandei e-mail');
  assert.throws(() => studios.update(s.id, { status: 'xyz' }), /Status/);
  assert.equal(studios.counts().contatado, 1);
  studios.remove(s.id);
  assert.equal(studios.get(s.id), null);
  assert.ok(STUDIO_STATUSES.includes('sem_interesse'));
});

test('site com protocolo perigoso é descartado', async () => {
  const { studios } = await setup();
  const s = studios.add({ name: 'Perigo', site: 'javascript:alert(1)' });
  assert.equal(s.site, '');
});

test('abordagem espontânea: idioma pelo país, cita o estúdio e acompanha anexos', () => {
  const br = { name: 'Oficina3D', country: 'Brasil' };
  const ex = { name: 'Rendify', country: 'Canadá' };
  assert.equal(studioLang(br), 'pt');
  assert.equal(studioLang(ex), 'en');
  const pt = buildOutreach(br, {});
  assert.match(pt.body, /Olá, equipe Oficina3D/);
  assert.match(pt.body, /vaga fixa ou por projeto/);
  const en = buildOutreach(ex, { attach: { cv: true, portfolio: true, cover: true } });
  assert.match(en.body, /Hello Rendify team/);
  assert.match(en.body, /cover letter/);
  assert.doesNotMatch(en.body, /V-Ray/); // só o que está no CV
});

test('seed: e-mails válidos e evidência de remoto marcada quando existe', () => {
  for (const s of seed) {
    if (s.email) assert.match(s.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, s.name);
    if (s.ats) assert.ok(s.atsSlug, s.name);
  }
  assert.ok(seed.filter((s) => s.remoteEvidence).length >= 12);
  assert.ok(path.basename(require.resolve('../seed/estudios/estudios-2026-11-12.json')));
});
