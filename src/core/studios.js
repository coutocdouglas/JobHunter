'use strict';
const { hashId, norm } = require('./text');

/**
 * Estúdios para abordar diretamente (candidatura espontânea), separados das vagas abertas.
 * Cada estúdio tem o próprio funil. Se tiver página de carreiras numa plataforma conhecida
 * (Greenhouse, Lever, Ashby, Workable), a busca de vagas passa a monitorá-la.
 */
const STUDIO_STATUSES = ['novo', 'contatar', 'rascunho', 'contatado', 'respondeu', 'conversa', 'sem_interesse'];
const ATS = ['greenhouse', 'lever', 'ashby', 'workable'];
const SLUG_RE = /^[a-zA-Z0-9._-]{1,60}$/;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT, city TEXT,
  site TEXT, careers_url TEXT, email TEXT, ats TEXT, ats_slug TEXT,
  remote_evidence TEXT, notes TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'novo',
  last_contact TEXT, docs TEXT, curated INTEGER DEFAULT 0,
  created TEXT NOT NULL, updated TEXT NOT NULL
);`;

const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
const https = (u) => {
  const s = str(u, 400);
  if (!s) return '';
  try { const x = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString().replace(/\/$/, '') : ''; } catch { return ''; }
};

function rowToStudio(r) {
  return {
    id: r.id, name: r.name, country: r.country || '', city: r.city || '', site: r.site || '',
    careersUrl: r.careers_url || '', email: r.email || '', ats: r.ats || '', atsSlug: r.ats_slug || '',
    remoteEvidence: r.remote_evidence || '', notes: r.notes || '', status: r.status,
    lastContact: r.last_contact, docs: r.docs ? JSON.parse(r.docs) : null, curated: r.curated === 1,
    created: r.created, updated: r.updated,
  };
}

/** Valida e normaliza um estúdio vindo da tela ou de um seed. Lança erro com mensagem em português. */
function clean(input, { partial = false } = {}) {
  const o = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (!partial || has('name')) {
    o.name = str(input.name, 120);
    if (!o.name) throw new Error('Informe o nome do estúdio.');
  }
  for (const k of ['country', 'city']) if (!partial || has(k)) o[k] = str(input[k], 80);
  for (const k of ['site', 'careersUrl']) if (!partial || has(k)) o[k] = https(input[k]);
  if (!partial || has('email')) {
    o.email = str(input.email, 120);
    if (o.email && !EMAIL_RE.test(o.email)) throw new Error('E-mail inválido.');
  }
  if (!partial || has('ats') || has('atsSlug')) {
    o.ats = str(input.ats, 20).toLowerCase();
    o.atsSlug = str(input.atsSlug, 60);
    if (!o.ats || !o.atsSlug) { o.ats = ''; o.atsSlug = ''; }
    else {
      if (!ATS.includes(o.ats)) throw new Error('Plataforma de carreiras inválida.');
      if (!SLUG_RE.test(o.atsSlug)) throw new Error('Identificador da página de carreiras inválido.');
    }
  }
  if (!partial || has('remoteEvidence')) o.remoteEvidence = str(input.remoteEvidence, 500);
  if (!partial || has('notes')) o.notes = str(input.notes, 2000);
  if (has('status')) {
    if (!STUDIO_STATUSES.includes(input.status)) throw new Error(`Status inválido: ${input.status}`);
    o.status = input.status;
  }
  return o;
}

class Studios {
  constructor(store) {
    this.store = store;
    store.db.exec(SCHEMA);
    store.save();
  }

  static idFor(name, site) {
    return hashId('studio', norm(name).replace(/[^a-z0-9]+/g, ''), norm(site || '').replace(/^https?:\/\/(www\.)?/, ''));
  }

  list({ status, region, text } = {}) {
    const rows = status
      ? this.store._all('SELECT * FROM studios WHERE status = ? ORDER BY name COLLATE NOCASE', [status])
      : this.store._all('SELECT * FROM studios ORDER BY name COLLATE NOCASE');
    let list = rows.map(rowToStudio);
    if (region === 'Brasil') list = list.filter((s) => /brasil|brazil/i.test(s.country));
    if (region === 'Exterior') list = list.filter((s) => !/brasil|brazil/i.test(s.country));
    if (text) {
      const t = norm(text);
      list = list.filter((s) => norm(`${s.name} ${s.country} ${s.city} ${s.notes}`).includes(t));
    }
    return list;
  }

  get(id) {
    const r = this.store._all('SELECT * FROM studios WHERE id = ?', [String(id)])[0];
    return r ? rowToStudio(r) : null;
  }

  /** Cria um estúdio. Recusa duplicado (mesmo nome e site). */
  add(input, { curated = false, status = 'novo' } = {}) {
    const s = clean(input);
    const id = Studios.idFor(s.name, s.site);
    if (this.get(id)) throw new Error(`"${s.name}" já está na lista.`);
    const now = new Date().toISOString();
    this.store.db.run(
      `INSERT INTO studios (id, name, country, city, site, careers_url, email, ats, ats_slug, remote_evidence, notes, status, curated, created, updated)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, s.name, s.country, s.city, s.site, s.careersUrl, s.email, s.ats || null, s.atsSlug || null, s.remoteEvidence, s.notes,
        STUDIO_STATUSES.includes(status) ? status : 'novo', curated ? 1 : 0, now, now]
    );
    this.store.save();
    return this.get(id);
  }

  /** Importa uma lista (seed). Estúdios já existentes são ignorados e mantêm seu status e notas. */
  importMany(list) {
    let added = 0;
    for (const item of list) {
      try { this.add(item, { curated: true }); added += 1; } catch (e) { if (!/já está na lista/.test(e.message)) throw e; }
    }
    return added;
  }

  update(id, fields) {
    const cur = this.get(id);
    if (!cur) throw new Error('Estúdio não encontrado.');
    const s = clean(fields, { partial: true });
    const map = { name: 'name', country: 'country', city: 'city', site: 'site', careersUrl: 'careers_url', email: 'email', ats: 'ats', atsSlug: 'ats_slug', remoteEvidence: 'remote_evidence', notes: 'notes', status: 'status' };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in s) { sets.push(`${col} = ?`); vals.push(s[k] === '' && (k === 'ats' || k === 'atsSlug') ? null : s[k]); }
    }
    if (s.status === 'contatado') { sets.push('last_contact = ?'); vals.push(new Date().toISOString()); }
    if (!sets.length) return cur;
    sets.push('updated = ?');
    vals.push(new Date().toISOString(), cur.id);
    this.store.db.run(`UPDATE studios SET ${sets.join(', ')} WHERE id = ?`, vals);
    this.store.save();
    return this.get(cur.id);
  }

  setDocs(id, docs) {
    this.store.db.run('UPDATE studios SET docs = ?, updated = ? WHERE id = ?', [docs ? JSON.stringify(docs) : null, new Date().toISOString(), String(id)]);
    this.store.save();
  }

  remove(id) {
    this.store.db.run('DELETE FROM studios WHERE id = ?', [String(id)]);
    this.store.save();
  }

  counts() {
    const out = Object.fromEntries(STUDIO_STATUSES.map((s) => [s, 0]));
    for (const r of this.store._all('SELECT status, COUNT(*) AS n FROM studios GROUP BY status')) out[r.status] = r.n;
    return out;
  }

  /** Páginas de carreiras a monitorar, no formato de config.companies. */
  boards() {
    const out = Object.fromEntries(ATS.map((a) => [a, []]));
    for (const r of this.store._all('SELECT ats, ats_slug FROM studios WHERE ats IS NOT NULL AND ats_slug IS NOT NULL')) {
      if (ATS.includes(r.ats) && !out[r.ats].includes(r.ats_slug)) out[r.ats].push(r.ats_slug);
    }
    return out;
  }
}

/** Junta as páginas de carreiras configuradas à mão com as dos estúdios, sem repetir. */
function mergeBoards(manual = {}, fromStudios = {}) {
  const out = {};
  for (const a of ATS) out[a] = [...new Set([...(manual[a] || []), ...(fromStudios[a] || [])])];
  return out;
}

module.exports = { Studios, STUDIO_STATUSES, ATS, mergeBoards, clean };
