'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KINDS = ['cv', 'portfolio', 'cover'];
const LANGS = ['pt', 'en', 'any'];
const EXTS = ['.pdf', '.docx', '.doc'];
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024; // o Gmail aceita até 25 MB por e-mail
const KIND_LABEL = { cv: 'currículo', portfolio: 'portfólio', cover: 'cover letter' };

function rowToDoc(r) {
  return { id: r.id, kind: r.kind, lang: r.lang, name: r.name, file: r.file, size: r.size, added: r.added, isDefault: r.is_default === 1 };
}

/**
 * Biblioteca de documentos do usuário. Cada arquivo carregado é COPIADO para a pasta do app,
 * então mover ou apagar o original não quebra nada. É daqui que saem os anexos.
 */
class Library {
  constructor(store, dir) {
    this.store = store;
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  list(kind) {
    const rows = kind
      ? this.store._all('SELECT * FROM documents WHERE kind = ? ORDER BY is_default DESC, added DESC', [kind])
      : this.store._all('SELECT * FROM documents ORDER BY kind, is_default DESC, added DESC');
    return rows.map(rowToDoc);
  }

  get(id) {
    const r = this.store._all('SELECT * FROM documents WHERE id = ?', [String(id)])[0];
    return r ? rowToDoc(r) : null;
  }

  pathOf(doc) {
    return path.join(this.dir, doc.file);
  }

  /** Copia o arquivo para a biblioteca. O primeiro currículo/portfólio de cada idioma vira o padrão. */
  import(srcPath, { kind, lang = 'any', name } = {}) {
    if (!KINDS.includes(kind)) throw new Error(`Tipo de documento inválido: ${kind}`);
    if (!LANGS.includes(lang)) throw new Error(`Idioma inválido: ${lang}`);
    const ext = path.extname(srcPath).toLowerCase();
    if (!EXTS.includes(ext)) throw new Error(`Formato não aceito (${ext || 'sem extensão'}). Use PDF ou Word.`);
    const stat = fs.statSync(srcPath);
    if (stat.size > MAX_FILE) throw new Error(`Arquivo grande demais (${Math.round(stat.size / 1048576)} MB). O limite é 20 MB.`);
    const id = crypto.randomBytes(8).toString('hex');
    const file = `${id}${ext}`;
    fs.copyFileSync(srcPath, path.join(this.dir, file));
    const display = String(name || path.basename(srcPath)).replace(/[\r\n"\\/]/g, ' ').trim().slice(0, 120) || `documento${ext}`;
    const first = kind !== 'cover' && this.store._all('SELECT 1 FROM documents WHERE kind = ? AND lang = ? AND is_default = 1', [kind, lang]).length === 0;
    this.store.db.run('INSERT INTO documents (id, kind, lang, name, file, size, added, is_default) VALUES (?,?,?,?,?,?,?,?)', [
      id, kind, lang, display, file, stat.size, new Date().toISOString(), first ? 1 : 0,
    ]);
    this.store.save();
    return this.get(id);
  }

  /** Apaga só a cópia que está no app; o arquivo original no seu computador não é tocado. */
  remove(id) {
    const doc = this.get(id);
    if (!doc) return;
    this.store.db.run('DELETE FROM documents WHERE id = ?', [doc.id]);
    try { fs.unlinkSync(this.pathOf(doc)); } catch { /* já não existia */ }
    if (doc.isDefault && doc.kind !== 'cover') {
      const next = this.store._all('SELECT id FROM documents WHERE kind = ? AND lang = ? ORDER BY added DESC LIMIT 1', [doc.kind, doc.lang])[0];
      if (next) this.store.db.run('UPDATE documents SET is_default = 1 WHERE id = ?', [next.id]);
    }
    this.store.save();
  }

  /** Um padrão por tipo + idioma. */
  setDefault(id) {
    const doc = this.get(id);
    if (!doc) throw new Error('Documento não encontrado.');
    this.store.db.run('UPDATE documents SET is_default = 0 WHERE kind = ? AND lang = ?', [doc.kind, doc.lang]);
    this.store.db.run('UPDATE documents SET is_default = 1 WHERE id = ?', [doc.id]);
    this.store.save();
  }

  setLang(id, lang) {
    if (!LANGS.includes(lang)) throw new Error(`Idioma inválido: ${lang}`);
    const doc = this.get(id);
    if (!doc || doc.lang === lang) return;
    const taken = this.store._all('SELECT 1 FROM documents WHERE kind = ? AND lang = ? AND is_default = 1', [doc.kind, lang]).length > 0;
    this.store.db.run('UPDATE documents SET lang = ?, is_default = ? WHERE id = ?', [lang, doc.isDefault && !taken ? 1 : 0, doc.id]);
    this.store.save();
  }

  /** Escolha automática para um idioma: padrão do idioma, senão padrão "qualquer", senão o mais recente. Cover letter nunca é automática. */
  pick(kind, lang) {
    const all = this.list(kind);
    return (
      all.find((d) => d.isDefault && d.lang === lang) ||
      all.find((d) => d.isDefault && d.lang === 'any') ||
      all.find((d) => d.lang === lang) ||
      all.find((d) => d.lang === 'any') ||
      null
    );
  }

  defaults(lang) {
    const cv = this.pick('cv', lang);
    const pf = this.pick('portfolio', lang);
    return { cv: cv ? cv.id : null, portfolio: pf ? pf.id : null, cover: null };
  }

  /** Converte a escolha {cv, portfolio, cover} em anexos, validando que existem e cabem no e-mail. */
  attachments(sel = {}) {
    const out = [];
    let total = 0;
    for (const kind of KINDS) {
      const id = sel[kind];
      if (!id) continue;
      const doc = this.get(id);
      if (!doc || doc.kind !== kind) throw new Error(`O ${KIND_LABEL[kind]} escolhido não está mais na biblioteca.`);
      const p = this.pathOf(doc);
      if (!fs.existsSync(p)) throw new Error(`O arquivo do ${KIND_LABEL[kind]} "${doc.name}" sumiu da pasta do app. Carregue de novo.`);
      total += fs.statSync(p).size;
      out.push({ path: p, filename: doc.name });
    }
    if (total > MAX_TOTAL) throw new Error(`Os anexos somam ${Math.round(total / 1048576)} MB e o Gmail aceita até 25 MB. Use um portfólio mais leve ou mande o link do site.`);
    return out;
  }
}

module.exports = { Library, KINDS, LANGS, EXTS, KIND_LABEL };
