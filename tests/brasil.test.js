'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreJob, isCandidate } = require('../src/core/score');
const { detectRemote } = require('../src/core/detect');
const src = require('../src/core/sources');
const { pickLang } = require('../src/core/templates');

// Fixtures da Gupy seguem o formato real conferido no portal em 12/11/2026 (valores inventados).

test('termos brasileiros entram no filtro', () => {
  for (const title of ['Perspectivista', 'Maquetista Eletrônico', 'Visualizador 3D', 'Artista 3D - Arquiteto (Remoto)', 'Renderizador 3D', 'Generalista 3D Pleno', 'Arquiteto(a) 3D']) {
    assert.equal(isCandidate({ title, description: '' }), true, title);
  }
  assert.equal(isCandidate({ title: 'Analista Financeiro', description: 'arquitetura de dados' }), false);
});

test('vaga brasileira boa recebe nota alta', () => {
  const r = scoreJob({
    title: 'Artista 3D - Arquiteto (Remoto)',
    location: 'Remoto (Brasil)',
    description: 'Imagens para lançamentos imobiliários de alto padrão em 3ds Max e Corona Render, pós-produção no Photoshop. Contratação PJ, 100% remoto.',
  });
  assert.ok(r.fit >= 4, `fit ${r.fit}`);
  assert.ok(r.reasons.some((x) => /imobili/i.test(x)));
  assert.ok(r.reasons.some((x) => /PJ/.test(x)));
});

test('perspectivista conta como ArchViz forte; móveis planejados e games não', () => {
  assert.ok(scoreJob({ title: 'Perspectivista Sênior', location: 'Remoto', description: '3ds Max Corona' }).fit >= 4);
  assert.ok(scoreJob({ title: 'Projetista 3D de Móveis Planejados', location: 'Remoto', description: 'SketchUp' }).fit <= 2);
  assert.ok(scoreJob({ title: 'Artista 3D de Games', location: 'Remoto', description: 'Unreal' }).fit <= 2);
});

test('vaga de Unreal cai de nota mesmo sendo sênior e remota', () => {
  const r = scoreJob({ title: 'Senior 3D Artist [Unreal]', location: 'Remoto', description: '3ds Max, liderança' });
  assert.ok(r.fit <= 3, `fit ${r.fit}`);
});

test('seed brasileiro: ids únicos e todas as vagas com Brasil no local', () => {
  const seed = require('../seed/brasil-2026-11-12.json');
  assert.equal(new Set(seed.map((j) => j.id)).size, seed.length);
  assert.ok(seed.every((j) => /brasil/i.test(j.location)));
});

test('estágio é rebaixado mesmo com termo de ArchViz', () => {
  assert.ok(scoreJob({ title: 'Estágio Visualizador 3D', location: 'Remoto', description: 'arquitetura' }).fit <= 3);
});

test('detectRemote em português', () => {
  assert.equal(detectRemote('100% home office'), true);
  assert.equal(detectRemote('Vaga remota'), true);
  assert.equal(detectRemote('Recife, PE', 'Presencial'), false);
  assert.equal(detectRemote('Remoto ou híbrido'), null);
});

test('normalizeGupy: remoto, local com Brasil e campos ausentes', () => {
  const jobs = src.normalizeGupy({
    data: [
      { id: 1, name: 'Visualizador 3D', careerPageName: 'Estúdio X', city: 'São Paulo', state: 'São Paulo', country: 'Brasil', workplaceType: 'remote', jobUrl: 'https://estudiox.gupy.io/jobs/1', publishedDate: '2026-11-10T12:00:00.000Z', description: '<p>3ds Max</p>' },
      { id: 2, name: 'Perspectivista', careerPageName: 'Y', workplaceType: 'on-site', careerPageUrl: 'https://y.gupy.io/', isRemoteWork: false },
      { id: 3, name: 'Artista 3D', careerPageName: 'Z', isRemoteWork: true },
    ],
  });
  assert.equal(jobs[0].remote, true);
  assert.match(jobs[0].location, /Brasil/);
  assert.equal(jobs[0].description, '3ds Max');
  assert.equal(jobs[1].remote, false);
  assert.equal(jobs[1].url, 'https://y.gupy.io/jobs/2');
  assert.equal(jobs[2].location, 'Remoto (Brasil)');
  assert.deepEqual(src.normalizeGupy({}), []);
  assert.deepEqual(src.normalizeGupy(null), []);
});

test('Gupy entra na busca com todos os termos brasileiros, usa o endereço real e pode ser desligada', async () => {
  let called = '';
  const fake = async (u) => { called = u; return { ok: true, json: async () => ({ data: [] }) }; };
  const on = src.buildTasks({}, fake).filter((t) => t.key.startsWith('gupy:'));
  assert.equal(on.length, src.BR_TERMS.length + 2);
  await on.find((x) => x.key === 'gupy:perspectivista').run();
  assert.equal(called, 'https://portal.gupy.io/api/job-search/jobs?jobName=perspectivista&limit=50&offset=0');
  assert.equal(src.buildTasks({ gupy: false }, fake).filter((t) => t.key.startsWith('gupy:')).length, 0);
});

test('Gupy real: on-site/hybrid não são remotos e cidade vazia vira Brasil', () => {
  const [a, b] = src.normalizeGupy({ data: [
    { id: 1, name: 'Arquiteto(a) 3D', careerPageName: 'X', workplaceType: 'remote', city: '', state: '', jobUrl: 'https://x.gupy.io/job/abc?jobBoardSource=gupy_portal', publishedDate: '2026-11-12T20:01:25.944Z' },
    { id: 2, name: 'Visualizador 3D', careerPageName: 'Y', workplaceType: 'hybrid', city: 'Recife', state: 'Pernambuco', jobUrl: 'https://y.gupy.io/job/def' },
  ], pagination: { total: 2 } });
  assert.equal(a.remote, true);
  assert.equal(a.location, 'Remoto (Brasil)');
  assert.equal(src.finalize(a).url, 'https://x.gupy.io/job/abc');
  assert.equal(b.remote, false);
  assert.equal(b.location, 'Recife, Pernambuco (Brasil)');
  assert.equal(src.buildTasks({ gupy: false }, fetch).filter((t) => t.key.startsWith('gupy:')).length, 0);
});

test('Adzuna Brasil usa os termos brasileiros e marca o país', () => {
  const t = src.buildTasks({ gupy: false, adzuna: { appId: 'a', appKey: 'b', country: 'br' } }, fetch).filter((x) => x.key.startsWith('adzuna:'));
  assert.equal(t.length, src.BR_TERMS.length);
  const [j] = src.normalizeAdzuna({ results: [{ title: 'Perspectivista', location: { display_name: 'Curitiba' }, redirect_url: 'https://adz/2' }] }, 'br');
  assert.equal(j.location, 'Curitiba, Brasil');
  assert.equal(pickLang(j), 'pt');
});

test('runAll com Gupy: vaga brasileira passa pelo filtro', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('gupy') && url.includes('perspectivista')) {
      return { ok: true, json: async () => ({ data: [{ id: 9, name: 'Perspectivista', careerPageName: 'Studio', workplaceType: 'remote', jobUrl: 'https://studio.gupy.io/jobs/9' }, { id: 10, name: 'Analista de RH', careerPageName: 'Studio', jobUrl: 'https://studio.gupy.io/jobs/10' }] }) };
    }
    if (url.includes('weworkremotely')) return { ok: true, text: async () => '<rss></rss>' };
    return { ok: true, json: async () => ({ data: [] }) };
  };
  const r = await src.runAll({}, { fetchImpl, now: 5 });
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].title, 'Perspectivista');
  assert.ok(r.report.some((x) => /Gupy/.test(x.label)));
});
