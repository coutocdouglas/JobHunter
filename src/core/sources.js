'use strict';
const { stripHtml, canonicalUrl, hashId, dedupeKey, toIso } = require('./text');
const { parseRss } = require('./rss');
const { detectRemote } = require('./detect');
const { isCandidate } = require('./score');

const UA = 'JobHunter/0.1 (busca pessoal de vagas; github.com/coutocdouglas/JobHunter)';
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // respeita as APIs gratuitas: no máximo 1 consulta a cada 6 h por fonte
const MAX_DESC = 4000;

function base(source, o) {
  return {
    source,
    title: String(o.title || '').trim(),
    company: String(o.company || '').trim() || 'Empresa não informada',
    location: String(o.location || '').trim(),
    remote: o.remote === undefined ? null : o.remote,
    url: String(o.url || '').trim(),
    posted: toIso(o.posted),
    description: stripHtml(o.description || '').slice(0, MAX_DESC),
    salary: o.salary ? String(o.salary).trim() : null,
    email: null,
  };
}

/* ---------- normalizadores (puros, testáveis com fixtures) ---------- */

function normalizeWeWorkRemotely(items) {
  return items.map((it) => {
    const raw = String(it.title || '');
    const i = raw.indexOf(': ');
    const company = i > 0 ? raw.slice(0, i) : '';
    const title = i > 0 ? raw.slice(i + 2) : raw;
    return base('We Work Remotely', { title, company, location: it.region || 'Remoto', remote: true, url: it.link, posted: it.pubDate, description: it.description });
  });
}

function normalizeRemotive(json) {
  return (json.jobs || []).map((j) =>
    base('Remotive', { title: j.title, company: j.company_name, location: j.candidate_required_location || 'Remoto', remote: true, url: j.url, posted: j.publication_date, description: j.description, salary: j.salary })
  );
}

function normalizeRemoteOk(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter((j) => j && j.id && j.position)
    .map((j) =>
      base('Remote OK', {
        title: j.position,
        company: j.company,
        location: j.location || 'Remoto',
        remote: true,
        url: j.url || (j.slug ? `https://remoteok.com/remote-jobs/${j.slug}` : ''),
        posted: j.date || (j.epoch ? j.epoch * 1000 : null),
        description: j.description,
        salary: j.salary_min ? `US$ ${j.salary_min}–${j.salary_max}` : null,
      })
    );
}

function normalizeGreenhouse(json, slug) {
  return (json.jobs || []).map((j) =>
    base(`Greenhouse (${slug})`, { title: j.title, company: j.company_name || slug, location: j.location && j.location.name, url: j.absolute_url, posted: j.updated_at || j.first_published, description: j.content })
  );
}

function normalizeLever(arr, slug) {
  return (Array.isArray(arr) ? arr : []).map((j) => {
    const c = j.categories || {};
    const wt = String(j.workplaceType || '').toLowerCase();
    return base(`Lever (${slug})`, {
      title: j.text,
      company: slug,
      location: [c.location, c.allLocations && c.allLocations.join(', ')].filter(Boolean)[0],
      remote: wt === 'remote' ? true : wt === 'onsite' || wt === 'hybrid' ? false : undefined,
      url: j.hostedUrl,
      posted: j.createdAt,
      description: j.descriptionPlain || j.description,
    });
  });
}

function normalizeAshby(json, slug) {
  return (json.jobs || []).map((j) =>
    base(`Ashby (${slug})`, { title: j.title, company: slug, location: j.location, remote: j.isRemote === true ? true : undefined, url: j.jobUrl, posted: j.publishedAt, description: j.descriptionPlain || j.descriptionHtml })
  );
}

function normalizeWorkable(json, slug) {
  return (json.jobs || []).map((j) =>
    base(`Workable (${slug})`, {
      title: j.title,
      company: json.name || slug,
      location: [j.city, j.country].filter(Boolean).join(', '),
      remote: j.telecommuting === true ? true : undefined,
      url: j.url || j.shortlink || (j.shortcode ? `https://apply.workable.com/${slug}/j/${j.shortcode}/` : ''),
      posted: j.published_on || j.created_at,
      description: j.description,
    })
  );
}

function normalizeAdzuna(json) {
  return (json.results || []).map((j) =>
    base('Adzuna', {
      title: j.title,
      company: j.company && j.company.display_name,
      location: j.location && j.location.display_name,
      url: j.redirect_url,
      posted: j.created,
      description: j.description,
      salary: j.salary_min ? `R$ ${Math.round(j.salary_min)}–${Math.round(j.salary_max)}` : null,
    })
  );
}

/* ---------- finalização ---------- */

function finalize(job) {
  const url = canonicalUrl(job.url);
  if (!job.title || !url) return null;
  if (job.remote === null || job.remote === undefined) job.remote = detectRemote(job.location, job.title, job.description);
  return { ...job, url, id: hashId(url), dedupeKey: dedupeKey(job.company, job.title) };
}

/* ---------- rede ---------- */

async function getJson(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function getText(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function buildTasks(config, fetchImpl) {
  const c = config.companies || {};
  const tasks = [
    { key: 'weworkremotely', label: 'We Work Remotely', run: async () => normalizeWeWorkRemotely(parseRss(await getText(fetchImpl, 'https://weworkremotely.com/categories/remote-design-jobs.rss'))) },
    { key: 'remotive', label: 'Remotive', run: async () => normalizeRemotive(await getJson(fetchImpl, 'https://remotive.com/api/remote-jobs?category=design')) },
    { key: 'remoteok', label: 'Remote OK', run: async () => normalizeRemoteOk(await getJson(fetchImpl, 'https://remoteok.com/api')) },
  ];
  for (const slug of c.greenhouse || []) tasks.push({ key: `gh:${slug}`, label: `Greenhouse ${slug}`, run: async () => normalizeGreenhouse(await getJson(fetchImpl, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`), slug) });
  for (const slug of c.lever || []) tasks.push({ key: `lever:${slug}`, label: `Lever ${slug}`, run: async () => normalizeLever(await getJson(fetchImpl, `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`), slug) });
  for (const slug of c.ashby || []) tasks.push({ key: `ashby:${slug}`, label: `Ashby ${slug}`, run: async () => normalizeAshby(await getJson(fetchImpl, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`), slug) });
  for (const slug of c.workable || []) tasks.push({ key: `workable:${slug}`, label: `Workable ${slug}`, run: async () => normalizeWorkable(await getJson(fetchImpl, `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`), slug) });
  const a = config.adzuna || {};
  if (a.appId && a.appKey) {
    for (const what of ['visualizador 3d arquitetura', 'artista 3d archviz']) {
      tasks.push({
        key: `adzuna:${what}`,
        label: `Adzuna "${what}"`,
        run: async () => normalizeAdzuna(await getJson(fetchImpl, `https://api.adzuna.com/v1/api/jobs/${a.country || 'br'}/search/1?app_id=${encodeURIComponent(a.appId)}&app_key=${encodeURIComponent(a.appKey)}&results_per_page=30&what=${encodeURIComponent(what)}`)),
      });
    }
  }
  return tasks;
}

/**
 * Roda todas as fontes. Uma fonte que falha não derruba as outras.
 * @returns {{jobs: object[], report: {label:string, ok:boolean, found:number, kept:number, error?:string, skipped?:boolean}[], lastFetch: object}}
 */
async function runAll(config, { fetchImpl = fetch, lastFetch = {}, force = false, now = Date.now() } = {}) {
  const tasks = buildTasks(config, fetchImpl);
  const nextFetch = { ...lastFetch };
  const report = [];
  const jobs = [];
  const results = await Promise.allSettled(
    tasks.map(async (t) => {
      if (!force && lastFetch[t.key] && now - lastFetch[t.key] < MIN_INTERVAL_MS) return { t, skipped: true };
      return { t, list: await t.run() };
    })
  );
  results.forEach((r, i) => {
    const t = tasks[i];
    if (r.status === 'rejected') {
      report.push({ label: t.label, ok: false, found: 0, kept: 0, error: String(r.reason && r.reason.message ? r.reason.message : r.reason) });
      return;
    }
    if (r.value.skipped) {
      report.push({ label: t.label, ok: true, found: 0, kept: 0, skipped: true });
      return;
    }
    nextFetch[t.key] = now;
    const kept = r.value.list.filter(isCandidate).map(finalize).filter(Boolean);
    jobs.push(...kept);
    report.push({ label: t.label, ok: true, found: r.value.list.length, kept: kept.length });
  });
  return { jobs, report, lastFetch: nextFetch };
}

module.exports = {
  runAll, buildTasks, finalize, MIN_INTERVAL_MS,
  normalizeWeWorkRemotely, normalizeRemotive, normalizeRemoteOk, normalizeGreenhouse,
  normalizeLever, normalizeAshby, normalizeWorkable, normalizeAdzuna,
};
