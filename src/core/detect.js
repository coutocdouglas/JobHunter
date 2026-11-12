'use strict';
const { norm } = require('./text');

// Ferramentas que constam no currículo do Douglas. Não inclua V-Ray aqui: não está no CV.
const MY_SKILLS = [
  { key: '3ds Max', re: /\b3\s?ds\s?max\b/ },
  { key: 'Corona Renderer', re: /\bcorona\b/ },
  { key: 'Photoshop', re: /\bphotoshop\b/ },
  { key: 'SketchUp', re: /\bsketch\s?up\b/ },
  { key: 'AutoCAD', re: /\bautocad\b/ },
  { key: 'Archicad', re: /\barchicad\b/ },
];

const ONSITE_RE = /\b(on[- ]?site|onsite|in[- ]office|presencial|hibrido|hybrid|in the office|office[- ]based)\b/;
const REMOTE_RE = /\b(remote|remoto|remota|home ?office|work from home|wfh|anywhere|worldwide|teletrabalho|trabalho a distancia|100% remot)/;
const OPEN_REGION_RE = /\b(worldwide|anywhere|global|latam|latin america|south america|americas|brazil|brasil|international)\b/;
const RESTRICTED_RE = [
  /\b(us|usa|u\.s\.a?\.?|united states)\b[\s,-]*(only|based|residents?|citizens?|authorized)/,
  /\b(canada|uk|united kingdom|eu|europe|european union|emea|apac|australia|india|philippines)\b[\s,-]*(only|based|residents?|citizens?)/,
  /must (be|reside|live|be located|be based)[^.]{0,40}\b(us|usa|united states|canada|uk|united kingdom|europe|eu)\b/,
  /\b(only|exclusively) (open|available) to[^.]{0,40}\b(us|usa|united states|canadian|uk|eu)\b/,
  /nationality only/,
  /work authori[sz]ation (in|for) the (us|united states|uk|eu)/,
  /\bno visa sponsorship\b/,
];

/** true = remoto, false = presencial/híbrido, null = não dá para saber. */
function detectRemote(...texts) {
  const t = norm(texts.filter(Boolean).join(' \n '));
  const remote = REMOTE_RE.test(t);
  const onsite = ONSITE_RE.test(t);
  if (remote && /\b(fully|100%|totally) remote\b|100% (remot|home ?office)|totalmente remot/.test(t)) return true;
  if (remote && onsite) return null; // "remoto ou híbrido": ambíguo
  if (remote) return true;
  if (onsite) return false;
  return null;
}

/** Devolve o trecho que restringe a região, ou null. Não bloqueia se a vaga cita Brasil/LATAM/mundo. */
function regionRestriction(...texts) {
  const t = norm(texts.filter(Boolean).join(' \n '));
  for (const re of RESTRICTED_RE) {
    const m = re.exec(t);
    if (m) {
      const around = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      if (OPEN_REGION_RE.test(around)) continue;
      return m[0].trim();
    }
  }
  return null;
}

function matchedSkills(text) {
  const t = norm(text);
  return MY_SKILLS.filter((s) => s.re.test(t)).map((s) => s.key);
}

function mentions(text, re) {
  return re.test(norm(text));
}

module.exports = { MY_SKILLS, detectRemote, regionRestriction, matchedSkills, mentions };
