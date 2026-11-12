'use strict';
const { decodeEntities } = require('./text');

function unwrap(v) {
  const m = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v.trim());
  return m ? m[1] : decodeEntities(v);
}

/** Parser mínimo de RSS 2.0 (sem dependências): devolve cada <item> como objeto de tags simples. */
function parseRss(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(String(xml || '')))) {
    const item = {};
    const tagRe = /<([a-zA-Z][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = tagRe.exec(m[1]))) {
      if (!(t[1] in item)) item[t[1]] = unwrap(t[2]);
    }
    items.push(item);
  }
  return items;
}

module.exports = { parseRss };
