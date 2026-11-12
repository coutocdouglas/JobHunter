'use strict';
const crypto = require('node:crypto');

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" };

function decodeEntities(s) {
  return String(s || '')
    .replace(/&(amp|lt|gt|quot|nbsp|apos|#39);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|refid$|trk|trackingid|source$|gh_src$|lever-source|jobboardsource$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\./, '');
    return u.toString().replace(/\/(\?|$)/, '$1');
  } catch {
    return String(url || '').trim();
  }
}

function hashId(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function dedupeKey(company, title) {
  return norm(company).replace(/[^a-z0-9]+/g, '') + '|' + norm(title).replace(/[^a-z0-9]+/g, '');
}

function toIso(value) {
  if (value == null || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { decodeEntities, stripHtml, norm, canonicalUrl, hashId, dedupeKey, toIso };
