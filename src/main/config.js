'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_PROFILE, withDefaults } = require('../core/templates');
const { KNOWN_TOOLS } = require('../core/cvparse');

const DEFAULTS = {
  profile: DEFAULT_PROFILE,
  files: { cvPt: '', cvEn: '', portfolio: '' },
  google: { clientId: '' },
  companies: { greenhouse: [], lever: [], ashby: [], workable: [] },
  adzuna: { appId: '', appKey: '', country: 'br' },
  gupy: true,
};

const SLUG_RE = /^[a-zA-Z0-9._-]{1,60}$/;
const str = (v, max = 300) => String(v == null ? '' : v).slice(0, max);

/** Aceita só chaves conhecidas e valida os valores. Tudo que vem da tela passa por aqui. */
function sanitize(input, current = DEFAULTS) {
  const c = JSON.parse(JSON.stringify(current));
  c.profile = withDefaults(c.profile);
  const i = input || {};
  if (i.profile) {
    for (const k of ['name', 'email', 'phone', 'site']) if (k in i.profile) c.profile[k] = str(i.profile[k], 120);
    const perLang = { availability: 400, city: 120, headline: 120, highlights: 1500 };
    for (const [k, max] of Object.entries(perLang)) {
      if (i.profile[k]) for (const l of ['pt', 'en']) if (l in i.profile[k]) c.profile[k][l] = str(i.profile[k][l], max);
    }
    if ('years' in i.profile) {
      const y = parseInt(i.profile.years, 10);
      c.profile.years = Number.isFinite(y) && y > 0 && y < 70 ? y : null;
    }
    if (Array.isArray(i.profile.skills)) c.profile.skills = [...new Set(i.profile.skills.map((s) => str(s, 40)).filter((s) => KNOWN_TOOLS.some((t) => t.key === s)))];
    for (const k of ['ai', 'animation']) if (k in i.profile) c.profile[k] = i.profile[k] === true;
  }
  if (i.files) for (const k of ['cvPt', 'cvEn', 'portfolio']) if (k in i.files) c.files[k] = str(i.files[k], 500);
  if (i.google && 'clientId' in i.google) c.google.clientId = str(i.google.clientId, 200);
  if (i.companies) {
    for (const k of ['greenhouse', 'lever', 'ashby', 'workable']) {
      if (Array.isArray(i.companies[k])) c.companies[k] = [...new Set(i.companies[k].map((s) => str(s, 60).trim()).filter((s) => SLUG_RE.test(s)))];
    }
  }
  if ('gupy' in i) c.gupy = i.gupy !== false;
  if (c.gupy === undefined) c.gupy = true;
  if (i.adzuna) {
    for (const k of ['appId', 'appKey']) if (k in i.adzuna) c.adzuna[k] = str(i.adzuna[k], 100);
    if ('country' in i.adzuna && /^[a-z]{2}$/.test(i.adzuna.country)) c.adzuna.country = i.adzuna.country;
  }
  return c;
}

function load(file) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return sanitize({});
  }
}

function save(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

module.exports = { DEFAULTS, sanitize, load, save };
