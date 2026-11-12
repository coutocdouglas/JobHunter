'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractPdfText, profileFromText, mergeProfile, sentenceCase } = require('../src/core/cvparse');
const { setMyProfile } = require('../src/core/detect');
const { scoreJob } = require('../src/core/score');
const { buildApplication, DEFAULT_PROFILE } = require('../src/core/templates');

// Currículo FICTÍCIO (pessoa inventada). Nada de dado real no repositório.
const LINES = [
  'Ana Teste Silva',
  'Arquiteta e Artista 3D',
  'Curitiba, PR',
  '+55 41 99999-0000',
  'ana.teste@example.com',
  'anateste.com.br',
  'Perfil',
  'Artista 3D com mais de 7 anos de experiencia em visualizacao arquitetonica.',
  'Programas: 3ds Max, Corona Renderer, Photoshop, Blender',
  'Uso de IA no processo e producao de animacoes.',
];

/** Gera um PDF mínimo válido com uma linha de texto por item (fonte Helvetica). */
function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 12 Tf 50 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('lê o texto de um PDF e extrai o perfil', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jh-cv-')), 'cv.pdf');
  fs.writeFileSync(f, makePdf(LINES));
  const text = await extractPdfText(f);
  assert.match(text, /Ana Teste Silva/);
  const p = profileFromText(text, 'pt');
  assert.equal(p.name, 'Ana Teste Silva');
  assert.equal(p.email, 'ana.teste@example.com');
  assert.equal(p.phone, '+55 41 99999-0000');
  assert.equal(p.site, 'anateste.com.br');
  assert.deepEqual(p.city, { pt: 'Curitiba, PR' });
  assert.deepEqual(p.headline, { pt: 'arquiteta e artista 3D' });
  assert.equal(p.years, 7);
  assert.deepEqual(p.skills, ['3ds Max', 'Corona Renderer', 'Photoshop', 'Blender']);
  assert.equal(p.ai, true);
  assert.equal(p.animation, true);
});

test('site não confunde com o domínio do e-mail nem com LinkedIn', () => {
  const p = profileFromText('Fulano Tal\nfulano@meusite.com\nlinkedin.com/in/fulano\nportfolio.art', 'en');
  assert.equal(p.site, 'portfolio.art');
});

test('mergeProfile não sobrescreve o que você já preencheu e soma ferramentas', () => {
  const cur = { ...DEFAULT_PROFILE, name: 'Nome Escolhido', skills: ['3ds Max'], headline: { pt: '', en: 'designer' } };
  const { profile, filled } = mergeProfile(cur, { name: 'Outro', email: 'a@b.com', skills: ['3ds Max', 'Blender'], headline: { pt: 'artista 3D', en: 'x' } });
  assert.equal(profile.name, 'Nome Escolhido');
  assert.equal(profile.email, 'a@b.com');
  assert.deepEqual(profile.skills, ['3ds Max', 'Blender']);
  assert.equal(profile.headline.pt, 'artista 3D');
  assert.equal(profile.headline.en, 'designer');
  assert.deepEqual(filled.sort(), ['email', 'headline.pt', 'skills'].sort());
});

test('sentenceCase mantém siglas', () => {
  assert.equal(sentenceCase('Arquiteto e Artista 3D – Generalista'), 'arquiteto e artista 3D – generalista');
  assert.equal(sentenceCase('Senior CGI Artist'), 'senior CGI artist');
});

test('perfil vazio: e-mail sem dados pessoais inventados', () => {
  const r = buildApplication({ title: 'Archviz Artist', company: 'Acme', location: 'Remote', description: '3ds Max' }, { lang: 'en' });
  assert.doesNotMatch(r.body, /undefined|null|years of experience/);
  assert.match(r.body, /Best regards,$/);
});

test('perfil completo entra no e-mail', () => {
  const profile = { name: 'Ana Teste Silva', email: 'ana.teste@example.com', site: 'anateste.com.br', years: 7, headline: { en: 'architect and 3D artist' }, skills: ['3ds Max', 'Corona Renderer'], highlights: { en: 'I led the visuals for 30 launches.' } };
  const r = buildApplication({ title: 'Archviz Artist', company: 'Acme', location: 'Remote', description: 'Corona' }, { lang: 'en', profile });
  assert.match(r.body, /I am an architect and 3D artist with over 7 years of experience\./);
  assert.match(r.body, /I led the visuals for 30 launches\./);
  assert.match(r.body, /more work at anateste\.com\.br/);
  assert.match(r.subject, /— Ana Teste Silva$/);
});

test('IA só pesa na nota se o currículo cita IA', () => {
  const job = { title: 'Archviz Artist', location: 'Remote', description: '3ds Max Corona, AI-assisted workflow' };
  setMyProfile({ skills: ['3ds Max', 'Corona Renderer'], ai: false });
  const sem = scoreJob(job);
  setMyProfile({ skills: ['3ds Max', 'Corona Renderer'], ai: true });
  const com = scoreJob(job);
  setMyProfile({});
  assert.ok(com.points > sem.points);
  assert.ok(sem.warnings.includes('Pede fluxo com IA'));
});
