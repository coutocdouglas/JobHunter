'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_PROFILE } = require('../core/templates');

const DEFAULTS = {
  profile: DEFAULT_PROFILE,
  files: { cvPt: '', cvEn: '', portfolio: '' },
  google: { clientId: '' },
  companies: { greenhouse: [], lever: [], ashby: [], workable: [] },
  adzuna: { appId: '', appKey: '', country: 'br' },
};

const SLUG_RE = /^[a-zA-Z0-9._-]{1,60}$/;
const str = (v, max = 300) => String(v == null ? '' : v).slice(0, max);

/** Aceita só chaves conhecidas e valida os valores. Tudo que vem da tela passa por aqui. */
function sanitize(input, current = DEFAULTS) {
  const c = JSON.parse(JSON.stringify(current));
  const i = input || {};
  if (i.profile) {
    for (const k of ['name', 'email', 'phone', 'site']) if (k in i.profile) c.profile[k] = str(i.profile[k], 120);
    if (i.profile.availability) for (const l of ['pt', 'en']) if (l in i.profile.availability) c.profile.availability[l] = str(i.profile.availability[l], 400);
    if (i.profile.city) for (const l of ['pt', 'en']) if (l in i.profile.city) c.profile.city[l] = str(i.profile.city[l], 120);
  }
  if (i.files) for (const k of ['cvPt', 'cvEn', 'portfolio']) if (k in i.files) c.files[k] = str(i.files[k], 500);
  if (i.google && 'clientId' in i.google) c.google.clientId = str(i.google.clientId, 200);
  if (i.companies) {
    for (const k of ['greenhouse', 'lever', 'ashby', 'workable']) {
      if (Array.isArray(i.companies[k])) c.companies[k] = [...new Set(i.companies[k].map((s) => str(s, 60).trim()).filter((s) => SLUG_RE.test(s)))];
    }
  }
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
