'use strict';
const { norm } = require('./text');

const { KNOWN_TOOLS } = require('./cvparse');

// Perfil de quem usa o app: ferramentas e uso de IA vêm do currículo carregado (ou das Configurações).
// Sem perfil, a nota usa um conjunto genérico de ferramentas de ArchViz e não promete nada no e-mail.
const GENERIC_TOOLS = ['3ds Max', 'Corona Renderer', 'V-Ray', 'Photoshop', 'SketchUp', 'Blender', 'Unreal Engine', 'Lumion', 'Enscape', 'D5 Render'];
const state = { skills: [], ai: false };

function setMyProfile(profile = {}) {
  state.skills = Array.isArray(profile.skills) ? profile.skills.filter((s) => KNOWN_TOOLS.some((k) => k.key === s)) : [];
  state.ai = profile.ai === true;
}
const myProfile = () => ({ skills: [...state.skills], ai: state.ai });

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

/** Ferramentas da lista (padrão: as do perfil, ou as genéricas se não houver perfil) que aparecem no texto. */
function matchedSkills(text, skills) {
  const list = skills || (state.skills.length ? state.skills : GENERIC_TOOLS);
  const t = norm(text);
  return KNOWN_TOOLS.filter((k) => list.includes(k.key) && k.re.test(t)).map((k) => k.key);
}

function mentions(text, re) {
  return re.test(norm(text));
}

module.exports = { GENERIC_TOOLS, setMyProfile, myProfile, detectRemote, regionRestriction, matchedSkills, mentions };
