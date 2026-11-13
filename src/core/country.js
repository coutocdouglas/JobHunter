'use strict';
const { norm } = require('./text');

/* Detecta o país da vaga pelo texto do local. Sem país claro devolve null (ex.: "Worldwide"). */
const COUNTRIES = [
  { code: 'BR', name: 'Brasil', re: /\b(brasil|brazil|belo horizonte|sao paulo|rio de janeiro|curitiba|porto alegre|florianopolis|brasilia|recife|fortaleza|salvador|campinas|goiania|\bmg\b|\bsp\b|\brj\b)\b/ },
  { code: 'US', name: 'Estados Unidos', re: /\b(united states|usa|u s a|u s|us only|us|california|texas|new york|florida|austin|seattle|chicago|boston|denver|los angeles)\b/ },
  { code: 'PT', name: 'Portugal', re: /\b(portugal|lisboa|lisbon|braga|coimbra)\b|\bporto,? portugal\b/ },
  { code: 'GB', name: 'Reino Unido', re: /\b(united kingdom|uk|england|scotland|wales|london|manchester|edinburgh)\b/ },
  { code: 'DE', name: 'Alemanha', re: /\b(germany|alemanha|deutschland|berlin|munich|hamburg)\b/ },
  { code: 'CA', name: 'Canadá', re: /\b(canada|toronto|vancouver|montreal|ontario)\b/ },
  { code: 'ES', name: 'Espanha', re: /\b(spain|espana|espanha|madrid|barcelona|valencia)\b/ },
  { code: 'AU', name: 'Austrália', re: /\b(australia|sydney|melbourne)\b/ },
  { code: 'MX', name: 'México', re: /\b(mexico|cdmx|guadalajara)\b/ },
  { code: 'AR', name: 'Argentina', re: /\b(argentina|buenos aires)\b/ },
  { code: 'NL', name: 'Países Baixos', re: /\b(netherlands|holanda|amsterdam|rotterdam)\b/ },
  { code: 'FR', name: 'França', re: /\b(france|franca|paris)\b/ },
  { code: 'IT', name: 'Itália', re: /\b(italy|italia|milan|milano|rome|roma)\b/ },
  { code: 'IN', name: 'Índia', re: /\b(india|bangalore|mumbai|delhi)\b/ },
];

function countryOf(text) {
  const t = norm(String(text || '')).replace(/[.,;/()|-]+/g, ' ');
  if (!t.trim()) return null;
  for (const c of COUNTRIES) if (c.re.test(t)) return { code: c.code, name: c.name };
  return null;
}

module.exports = { countryOf, COUNTRIES };
