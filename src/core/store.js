'use strict';
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { scoreJob } = require('./score');

const STATUSES = ['nova', 'aplicar', 'talvez', 'rascunho', 'enviada', 'resposta', 'entrevista', 'descartada'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  source TEXT, title TEXT NOT NULL, company TEXT, location TEXT,
  remote INTEGER, url TEXT NOT NULL, posted TEXT, description TEXT, salary TEXT, email TEXT,
  fit INTEGER, reasons TEXT, warnings TEXT, curated INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'nova', note TEXT DEFAULT '',
  first_seen TEXT NOT NULL, updated TEXT NOT NULL, cv_lang TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
`;

function rowToJob(r) {
  return {
    id: r.id, source: r.source, title: r.title, company: r.company, location: r.location,
    remote: r.remote === null ? null : r.remote === 1, url: r.url, posted: r.posted,
    description: r.description, salary: r.salary, email: r.email, fit: r.fit,
    reasons: JSON.parse(r.reasons || '[]'), warnings: JSON.parse(r.warnings || '[]'),
    curated: r.curated === 1, status: r.status, note: r.note || '',
    firstSeen: r.first_seen, updated: r.updated, cvLang: r.cv_lang,
  };
}

class Store {
  constructor(SQL, db, file) {
    this.SQL = SQL;
    this.db = db;
    this.file = file;
  }

  /** file = null abre um banco só em memória (testes). */
  static async open(file) {
    const SQL = await initSqlJs();
    let db;
    if (file && fs.existsSync(file)) db = new SQL.Database(fs.readFileSync(file));
    else db = new SQL.Database();
    db.exec(SCHEMA);
    const s = new Store(SQL, db, file);
    s.save();
    return s;
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.file);
  }

  _all(sql, params = []) {
    const st = this.db.prepare(sql);
    st.bind(params);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
  }

  /** Insere vagas novas. Vaga já vista (mesmo id ou mesma empresa+cargo) é ignorada e nunca perde o status. */
  upsertJobs(jobs) {
    const now = new Date().toISOString();
    let added = 0;
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO jobs (id, dedupe_key, source, title, company, location, remote, url, posted, description, salary, email, fit, reasons, warnings, curated, status, first_seen, updated, cv_lang)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const j of jobs) {
      const sc = j.fit ? { fit: j.fit, reasons: j.reasons || [], warnings: j.warnings || [] } : scoreJob(j);
      ins.run([
        j.id, j.dedupeKey, j.source, j.title, j.company, j.location,
        j.remote === null || j.remote === undefined ? null : j.remote ? 1 : 0,
        j.url, j.posted, j.description || '', j.salary, j.email,
        sc.fit, JSON.stringify(sc.reasons), JSON.stringify(sc.warnings), j.curated ? 1 : 0,
        j.status && STATUSES.includes(j.status) ? j.status : 'nova', now, now, j.cvLang || null,
      ]);
      added += this.db.getRowsModified();
    }
    ins.free();
    this.save();
    return added;
  }

  list({ status, minFit = 1, region, text } = {}) {
    const where = ['fit >= ?'];
    const params = [minFit];
    if (status) { where.push('status = ?'); params.push(status); }
    const rows = this._all(`SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY fit DESC, first_seen DESC`, params);
    let jobs = rows.map(rowToJob);
    if (region === 'Brasil') jobs = jobs.filter((j) => /brasil|brazil/i.test(`${j.location} ${j.source}`));
    if (region === 'Exterior') jobs = jobs.filter((j) => !/brasil|brazil/i.test(`${j.location} ${j.source}`));
    if (text) {
      const t = text.toLowerCase();
      jobs = jobs.filter((j) => `${j.title} ${j.company} ${j.source}`.toLowerCase().includes(t));
    }
    return jobs;
  }

  get(id) {
    const r = this._all('SELECT * FROM jobs WHERE id = ?', [id])[0];
    return r ? rowToJob(r) : null;
  }

  setStatus(id, status) {
    if (!STATUSES.includes(status)) throw new Error(`Status inválido: ${status}`);
    this.db.run('UPDATE jobs SET status = ?, updated = ? WHERE id = ?', [status, new Date().toISOString(), id]);
    this.save();
  }

  setNote(id, note) {
    this.db.run('UPDATE jobs SET note = ?, updated = ? WHERE id = ?', [String(note || ''), new Date().toISOString(), id]);
    this.save();
  }

  setEmail(id, email) {
    this.db.run('UPDATE jobs SET email = ?, updated = ? WHERE id = ?', [email || null, new Date().toISOString(), id]);
    this.save();
  }

  counts() {
    const out = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of this._all('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status')) out[r.status] = r.n;
    return out;
  }

  getSetting(k, fallback = null) {
    const r = this._all('SELECT v FROM settings WHERE k = ?', [k])[0];
    return r ? JSON.parse(r.v) : fallback;
  }

  setSetting(k, v) {
    this.db.run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, JSON.stringify(v)]);
    this.save();
  }
}

module.exports = { Store, STATUSES };
