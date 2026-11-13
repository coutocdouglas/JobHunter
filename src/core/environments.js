'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_ENVS = 30;
const MAX_TERMS = 20;

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Normaliza a lista de termos: sem repetição, sem vazios, tamanho limitado. */
function cleanTerms(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[,\n;]/);
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    const v = clean(t, 60);
    const k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'ambiente';

/**
 * Ambientes de procura. Cada ambiente tem a própria pasta (banco de vagas, config e documentos),
 * então nada é compartilhado entre eles. Esta classe só guarda a lista (ambientes.json).
 */
class Environments {
  constructor(rootDir) {
    this.root = rootDir;
    this.file = path.join(rootDir, 'ambientes.json');
    this.items = [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(raw.items)) this.items = raw.items.filter((e) => e && /^[a-z0-9-]{1,40}$/.test(e.id));
    } catch { /* primeira execução */ }
  }

  _save() {
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ items: this.items }, null, 2));
  }

  list() {
    return this.items.map((e) => ({ ...e, terms: [...e.terms] }));
  }

  get(id) {
    return this.items.find((e) => e.id === id) || null;
  }

  /** Pasta do ambiente. O id já foi validado, então não escapa de `ambientes/`. */
  dirOf(id) {
    if (!this.get(id)) throw new Error('Ambiente não encontrado.');
    return path.join(this.root, 'ambientes', id);
  }

  create({ name, terms, preset } = {}) {
    const n = clean(name, 60);
    if (!n) throw new Error('Dê um nome ao ambiente.');
    const t = cleanTerms(terms);
    if (!t.length) throw new Error('Informe ao menos um tipo de vaga, por exemplo: arquiteto, artista 3D.');
    if (this.items.length >= MAX_ENVS) throw new Error('Limite de ambientes atingido.');
    if (this.items.some((e) => e.name.toLowerCase() === n.toLowerCase())) throw new Error('Já existe um ambiente com esse nome.');
    let id = slug(n);
    for (let i = 2; this.get(id); i++) id = `${slug(n)}-${i}`;
    // preset 'archviz' = ambiente original do app (filtro e nota de ArchViz); os demais usam só os termos digitados.
    const env = { id, name: n, terms: t, preset: preset === 'archviz' ? 'archviz' : '', created: new Date().toISOString(), lastOpened: null };
    this.items.push(env);
    fs.mkdirSync(path.join(this.root, 'ambientes', id), { recursive: true });
    this._save();
    return { ...env, terms: [...t] };
  }

  update(id, { name, terms } = {}) {
    const e = this.get(id);
    if (!e) throw new Error('Ambiente não encontrado.');
    if (name !== undefined) {
      const n = clean(name, 60);
      if (!n) throw new Error('Dê um nome ao ambiente.');
      if (this.items.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error('Já existe um ambiente com esse nome.');
      e.name = n;
    }
    if (terms !== undefined) {
      const t = cleanTerms(terms);
      if (!t.length) throw new Error('Informe ao menos um tipo de vaga.');
      e.terms = t;
    }
    this._save();
    return { ...e, terms: [...e.terms] };
  }

  touch(id) {
    const e = this.get(id);
    if (e) { e.lastOpened = new Date().toISOString(); this._save(); }
  }
}

module.exports = { Environments, cleanTerms };
