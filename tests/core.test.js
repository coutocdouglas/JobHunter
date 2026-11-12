'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detectRemote, regionRestriction, matchedSkills } = require('../src/core/detect');
const { scoreJob, isCandidate } = require('../src/core/score');
const { parseRss } = require('../src/core/rss');
const src = require('../src/core/sources');
const { Store } = require('../src/core/store');
const { buildApplication } = require('../src/core/templates');
const gmail = require('../src/core/gmail');
const { canonicalUrl } = require('../src/core/text');

// Os fixtures abaixo são SINTÉTICOS: imitam o formato documentado de cada fonte, não são respostas reais.

test('detectRemote', () => {
  assert.equal(detectRemote('Remote', 'Archviz Artist'), true);
  assert.equal(detectRemote('Belo Horizonte', 'Visualizador 3D presencial'), false);
  assert.equal(detectRemote('Remote or hybrid'), null);
  assert.equal(detectRemote('', 'Fully remote 3D Artist'), true);
  assert.equal(detectRemote('Dallas, TX', '3D Artist'), null);
});

test('regionRestriction respeita vagas abertas ao Brasil/LATAM', () => {
  assert.ok(regionRestriction('USA Only'));
  assert.ok(regionRestriction('Candidates must be located in the US'));
  assert.equal(regionRestriction('Worldwide'), null);
  assert.equal(regionRestriction('US only, but LATAM contractors are welcome'), null);
});

test('matchedSkills só devolve ferramentas do currículo (sem V-Ray)', () => {
  assert.deepEqual(matchedSkills('3ds Max, V-Ray and Corona, Photoshop'), ['3ds Max', 'Corona Renderer', 'Photoshop']);
});

test('scoreJob: vaga boa x vaga ruim', () => {
  const good = scoreJob({ title: 'Senior Archviz Artist', location: 'Worldwide', remote: true, description: 'Photorealistic high-end real estate images in 3ds Max and Corona, art direction, animation.' });
  assert.equal(good.fit, 5);
  const bad = scoreJob({ title: 'Junior Character Artist', location: 'Austin, TX', remote: false, description: 'Games' });
  assert.equal(bad.fit, 1);
  const usOnly = scoreJob({ title: '3D Architectural Visualizer', location: 'USA Only', remote: true, description: '3ds Max Corona' });
  assert.ok(usOnly.fit <= 3);
  assert.ok(usOnly.warnings.some((w) => /restri/i.test(w)));
});

test('isCandidate filtra feeds amplos', () => {
  assert.equal(isCandidate({ title: 'Senior Backend Engineer', description: 'architectural patterns' }), false);
  assert.equal(isCandidate({ title: '3D Architectural Visualizer', description: '' }), true);
});

test('parseRss + We Work Remotely', () => {
  const xml = `<rss><channel><item><title><![CDATA[Acme Studio: Archviz Artist]]></title><region><![CDATA[Anywhere in the World]]></region><link>https://weworkremotely.com/remote-jobs/acme-archviz-artist?utm_source=x</link><pubDate>Mon, 09 Nov 2026 10:00:00 +0000</pubDate><description><![CDATA[<p>3ds Max &amp; Corona</p>]]></description></item></channel></rss>`;
  const [j] = src.normalizeWeWorkRemotely(parseRss(xml));
  assert.equal(j.company, 'Acme Studio');
  assert.equal(j.title, 'Archviz Artist');
  assert.equal(j.remote, true);
  assert.match(j.description, /3ds Max & Corona/);
  const f = src.finalize(j);
  assert.equal(f.url, 'https://weworkremotely.com/remote-jobs/acme-archviz-artist');
});

test('normalizadores de Remotive, Remote OK, Greenhouse, Lever, Ashby, Workable, Adzuna', () => {
  assert.equal(src.normalizeRemotive({ jobs: [{ title: '3D Visualizer', company_name: 'X', url: 'https://r/1', candidate_required_location: 'Worldwide', publication_date: '2026-11-01T00:00:00' }] })[0].location, 'Worldwide');
  const ok = src.normalizeRemoteOk([{ legal: 'aviso' }, { id: '1', position: 'Archviz Artist', company: 'Y', url: 'https://remoteok.com/1', date: '2026-11-02T00:00:00+00:00' }]);
  assert.equal(ok.length, 1);
  assert.equal(src.normalizeGreenhouse({ jobs: [{ title: 'CGI Artist', absolute_url: 'https://g/1', location: { name: 'Remote' } }] }, 'acme')[0].location, 'Remote');
  assert.equal(src.normalizeLever([{ text: 'Archviz', hostedUrl: 'https://l/1', workplaceType: 'remote', createdAt: 1762000000000 }], 'acme')[0].remote, true);
  assert.equal(src.normalizeAshby({ jobs: [{ title: 'Archviz', jobUrl: 'https://a/1', isRemote: true }] }, 'acme')[0].remote, true);
  assert.equal(src.normalizeWorkable({ name: 'Utopia', jobs: [{ title: '3D Artist', shortcode: 'AB12', telecommuting: true }] }, 'utopia')[0].url, 'https://apply.workable.com/utopia/j/AB12/');
  assert.equal(src.normalizeAdzuna({ results: [{ title: 'Visualizador 3D', company: { display_name: 'Z' }, location: { display_name: 'São Paulo' }, redirect_url: 'https://adz/1' }] })[0].company, 'Z');
});

test('runAll isola falhas, filtra candidatos e respeita o intervalo mínimo', async () => {
  const rssXml = `<rss><channel><item><title>Acme: Archviz Artist</title><link>https://wwr/1</link></item><item><title>Acme: Backend Dev</title><link>https://wwr/2</link></item></channel></rss>`;
  const fetchImpl = async (url) => {
    if (url.includes('weworkremotely')) return { ok: true, text: async () => rssXml };
    if (url.includes('remotive')) return { ok: false, status: 503 };
    return { ok: true, json: async () => [] };
  };
  const r = await src.runAll({}, { fetchImpl, now: 1_000_000 });
  assert.equal(r.jobs.length, 1);
  assert.equal(r.report.find((x) => x.label === 'Remotive').ok, false);
  assert.ok(r.lastFetch.weworkremotely);
  const again = await src.runAll({}, { fetchImpl, now: 1_000_000 + 60_000, lastFetch: r.lastFetch });
  assert.equal(again.report.find((x) => x.label === 'We Work Remotely').skipped, true);
  const forced = await src.runAll({}, { fetchImpl, now: 1_000_000 + 60_000, lastFetch: r.lastFetch, force: true });
  assert.equal(forced.jobs.length, 1);
});

test('Store: deduplica, preserva status e conta o funil', async () => {
  const s = await Store.open(null);
  const mk = (o) => src.finalize({ source: 'T', title: 'Archviz Artist', company: 'Acme', location: 'Remote', remote: true, url: 'https://x/1', description: '3ds Max Corona', posted: null, salary: null, email: null, ...o });
  assert.equal(s.upsertJobs([mk({})]), 1);
  const [j] = s.list();
  s.setStatus(j.id, 'aplicar');
  assert.equal(s.upsertJobs([mk({})]), 0); // mesma vaga
  assert.equal(s.upsertJobs([mk({ url: 'https://other/9' })]), 0); // mesma empresa+cargo em outra fonte
  assert.equal(s.get(j.id).status, 'aplicar');
  assert.equal(s.counts().aplicar, 1);
  assert.throws(() => s.setStatus(j.id, 'xyz'));
  s.setSetting('k', { a: 1 });
  assert.deepEqual(s.getSetting('k'), { a: 1 });
});

test('Store persiste em arquivo', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jh-')), 'db.sqlite');
  const s = await Store.open(f);
  s.upsertJobs([src.finalize({ source: 'T', title: '3D Artist', company: 'Z', location: 'Remote', remote: true, url: 'https://x/2', description: '', posted: null, salary: null, email: null })]);
  const s2 = await Store.open(f);
  assert.equal(s2.list().length, 1);
});

test('templates: PT/EN e só cita ferramentas do currículo', () => {
  const job = { title: 'Archviz Artist', company: 'Acme', location: 'Remote', source: 'X', description: 'We use 3ds Max, V-Ray and Corona. Animation and flythrough.' };
  const en = buildApplication(job, {});
  assert.equal(en.lang, 'en');
  assert.match(en.body, /3ds Max, Corona Renderer/);
  assert.doesNotMatch(en.body, /V-Ray/);
  assert.match(en.body, /animations/);
  const pt = buildApplication({ ...job, location: 'Brasil' }, {});
  assert.equal(pt.lang, 'pt');
  assert.match(pt.subject, /Candidatura/);
});

test('buildRawMessage gera MIME válido com anexo e assunto acentuado', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jh-')), 'CV Douglas.pdf');
  fs.writeFileSync(f, Buffer.from('%PDF-1.4 teste'));
  const raw = gmail.buildRawMessage({ to: 'a@b.com', subject: 'Candidatura: visualização', body: 'Olá, ação!', attachments: [{ path: f }] });
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(mime, /^To: a@b\.com/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(mime, /application\/pdf/);
  assert.match(mime, /filename="CV Douglas\.pdf"/);
  assert.ok(mime.trimEnd().endsWith('--'));
  // injeção de cabeçalho não passa
  const evil = Buffer.from(gmail.buildRawMessage({ to: 'a@b.com\r\nBcc: x@y.com', subject: 's', body: 'b' }), 'base64url').toString('utf8');
  assert.doesNotMatch(evil, /^Bcc:/m);
});

test('PKCE e URL de autorização', () => {
  const { verifier, challenge } = gmail.pkcePair();
  assert.ok(verifier.length >= 43);
  const u = new URL(gmail.authUrl({ clientId: 'id', redirectUri: 'http://127.0.0.1:1', challenge, state: 's' }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(!u.searchParams.get('scope').includes('gmail.send'));
});

test('parseLinkedInAlert (fixture sintético)', () => {
  const html = `<a href="https://www.linkedin.com/comm/jobs/view/3912345678/?trackingId=abc">Senior 3D Visualizer</a>
    <a href="https://www.linkedin.com/comm/jobs/view/3912345678/?x=1">Ver vaga</a>
    <a href="https://www.linkedin.com/jobs/view/senior-archviz-artist-at-acme-3987654321?refId=1">Archviz Artist &amp; Lead</a>`;
  const jobs = gmail.parseLinkedInAlert(html);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].url, 'https://linkedin.com/jobs/view/3912345678');
  assert.equal(jobs[1].title, 'Archviz Artist & Lead');
});

test('canonicalUrl remove rastreadores', () => {
  assert.equal(canonicalUrl('https://www.x.com/a/?utm_source=z&id=3#frag'), 'https://x.com/a?id=3');
});
