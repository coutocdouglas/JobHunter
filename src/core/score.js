'use strict';
const { norm } = require('./text');
const { detectRemote, regionRestriction, matchedSkills, mentions } = require('./detect');

const ARCHVIZ_TITLE = /(arch\s?viz|architectural (visuali[sz]|render|cgi|3d)|visuali[sz]ation (artist|specialist)|visuali[sz]ador|visuali[sz]er|cgi (artist|visuali)|3d (artist|designer|generalist|visuali)|artista 3d|render(ing)? artist|archi?viz)/;
const BAD_TITLE = /(character|vfx|gameplay|game ?dev|technical artist|animator|animador|rigg|concept artist|environment artist|product visuali|ui\b|ux\b|motion graphics)/;
const JUNIOR = /(junior|jr\b|intern\b|internship|estagi|trainee|entry[- ]level)/;
const SENIOR = /(senior|sr\.?\b|lead\b|supervisor|principal|art director|diretor de arte|coordenador|head of)/;

/**
 * Aderência de 1 a 5 ao perfil do Douglas, com motivos e avisos em português.
 * Regras simples e transparentes: nada de IA, nada de rede.
 */
function scoreJob(job) {
  const title = norm(job.title);
  const body = norm(job.description || '');
  const all = `${title} ${body}`;
  const reasons = [];
  const warnings = [];
  let pts = 0;

  if (/arch\s?viz|architectural (visuali|render|cgi)|archi?viz/.test(title)) {
    pts += 3;
    reasons.push('Cargo é de visualização arquitetônica');
  } else if (ARCHVIZ_TITLE.test(title)) {
    pts += 2;
    reasons.push('Cargo de 3D/visualização');
    if (!/arch|architect|interior|real estate|imobili/.test(all)) warnings.push('Não cita arquitetura: pode não ser ArchViz');
  } else if (/arch|architect/.test(title) && /3d|render|visual/.test(all)) {
    pts += 1.5;
    reasons.push('Cargo de arquitetura com 3D');
  } else {
    warnings.push('O cargo não parece ser de ArchViz');
  }

  const skills = matchedSkills(all);
  if (skills.length >= 2) {
    pts += 1.5;
    reasons.push(`Pede ferramentas do seu CV: ${skills.join(', ')}`);
  } else if (skills.length === 1) {
    pts += 0.75;
    reasons.push(`Cita ${skills[0]}, que está no seu CV`);
  }

  const remote = job.remote !== undefined && job.remote !== null ? job.remote : detectRemote(job.location, job.title, job.description);
  if (remote === true) {
    pts += 1;
    reasons.push('Remoto');
  } else if (remote === false) {
    pts -= 2;
    warnings.push('Parece presencial ou híbrida');
  } else {
    warnings.push('Remoto não confirmado');
  }

  const restricted = regionRestriction(job.location, job.title, job.description);
  if (restricted) {
    pts -= 3;
    warnings.push(`Pode ter restrição de região ("${restricted}")`);
  } else if (/latam|latin america|brazil|brasil|worldwide|anywhere/.test(norm(`${job.location} ${body}`))) {
    pts += 0.25;
  }

  if (SENIOR.test(title)) {
    pts += 0.5;
    reasons.push('Nível sênior ou liderança, compatível com sua experiência');
  }
  if (JUNIOR.test(title)) {
    pts -= 2;
    warnings.push('Vaga de nível júnior/estágio');
  }
  if (BAD_TITLE.test(title)) {
    pts -= 2;
    warnings.push('Cargo de outra especialidade (jogos, VFX, personagem…)');
  }

  let bonus = 0;
  if (mentions(all, /art direction|direcao de arte|art director/)) bonus += 0.5;
  if (mentions(all, /anima(tion|cao)|fly ?through|fly ?over|video/)) bonus += 0.25;
  if (mentions(all, /\b(ai|ia)\b[- ]?(assisted|workflow|tools)|generative|comfyui|stable diffusion|midjourney/)) {
    bonus += 0.5;
    reasons.push('Cita fluxo com IA, que está no seu CV');
  }
  if (mentions(all, /real estate|imobili|residential|high[- ]end/)) bonus += 0.25;
  pts += Math.min(bonus, 1);

  const fit = pts >= 6 ? 5 : pts >= 4.5 ? 4 : pts >= 3 ? 3 : pts >= 1.5 ? 2 : 1;
  return { fit, reasons, warnings, points: Math.round(pts * 100) / 100 };
}

/** Filtro barato para feeds amplos: só guarda o que tem cara de ArchViz/3D de arquitetura. */
function isCandidate(job) {
  const title = norm(job.title);
  if (ARCHVIZ_TITLE.test(title)) return true;
  const all = `${title} ${norm(job.description || '')}`;
  return /archviz|arch viz|architectural visuali|corona render|3ds max/.test(all) && /3d|render|visual/.test(title);
}

module.exports = { scoreJob, isCandidate };
