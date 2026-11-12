'use strict';
const { norm } = require('./text');
const { detectRemote, regionRestriction, matchedSkills, mentions, myProfile } = require('./detect');

// Os textos passam por norm(): minúsculas e sem acento ("visualização" vira "visualizacao").
// Termos brasileiros: perspectivista, maquetista eletrônico, renderizador, visualizador, artista/generalista/designer 3D, arquiteto 3D.
const BR_ARCHVIZ = /(perspectivista|maquetista eletronic|visualizacao (3d |arquitetonica)|visualizador(a)? 3d|artista 3d.{0,25}arquitet|arquitet\w*.{0,15}(3d|render|visualiza)|imagens? 3d|render(izacao|izador)?.{0,15}(arquitet|imobili))/;
const STRONG_TITLE = new RegExp(`(arch\\s?viz|architectural (visuali|render|cgi)|archi?viz|${BR_ARCHVIZ.source.slice(1, -1)})`);
const ARCHVIZ_TITLE = /(arch\s?viz|architectural (visuali[sz]|render|cgi|3d)|visuali[sz]ation (artist|specialist)|visuali[sz]ador|visuali[sz]er|cgi (artist|visuali)|3d (artist|designer|generalist|visuali)|(artista|generalista|designer|modelador|projetista) 3d|perspectivista|maquetista eletronic|renderizador|render(ing)? artist|archi?viz)/;
const BAD_TITLE = /(character|personage|vfx|gameplay|game ?dev|\bgames?\b|\bjogos?\b|technical artist|animator|animador|rigg|concept artist|environment artist|product visuali|ui\b|ux\b|motion graphics|moveis planejados|marcenaria|joalheria|joias|mecanic|tubulac)/;
const JUNIOR = /(junior|jr\b|intern\b|internship|estagi|trainee|entry[- ]level|aprendiz)/;
const SENIOR = /(senior|sr\.?\b|lead\b|lider|supervisor|principal|art director|diretor(a)? de arte|coordenador|head of|especialista)/;
const ARCH_CONTEXT = /arch|architect|interior|real estate|imobili|arquitet|imove|empreendimento|incorporadora|construtora|interiores/;

/**
 * Aderência de 1 a 5 ao perfil de quem usa o app (ferramentas do currículo carregado), com motivos e avisos em português.
 * Regras simples e transparentes: nada de IA, nada de rede.
 */
function scoreJob(job) {
  const title = norm(job.title);
  const body = norm(job.description || '');
  const all = `${title} ${body}`;
  const reasons = [];
  const warnings = [];
  let pts = 0;

  if (STRONG_TITLE.test(title)) {
    pts += 3;
    reasons.push('Cargo é de visualização arquitetônica');
  } else if (ARCHVIZ_TITLE.test(title)) {
    pts += ARCH_CONTEXT.test(all) ? 2.5 : 2;
    reasons.push(ARCH_CONTEXT.test(all) ? 'Cargo de 3D/visualização ligado a arquitetura ou imobiliário' : 'Cargo de 3D/visualização');
    if (!ARCH_CONTEXT.test(all)) warnings.push('Não cita arquitetura: pode não ser ArchViz');
  } else if (/arch|architect|arquitet/.test(title) && /3d|render|visual/.test(all)) {
    pts += 1.5;
    reasons.push('Cargo de arquitetura com 3D');
  } else {
    warnings.push('O cargo não parece ser de ArchViz');
  }

  const me = myProfile();
  const fromCv = me.skills.length > 0;
  const skills = matchedSkills(all);
  if (skills.length >= 2) {
    pts += 1.5;
    reasons.push(fromCv ? `Pede ferramentas do seu currículo: ${skills.join(', ')}` : `Pede ferramentas de ArchViz: ${skills.join(', ')}`);
  } else if (skills.length === 1) {
    pts += 0.75;
    reasons.push(fromCv ? `Cita ${skills[0]}, que está no seu currículo` : `Cita ${skills[0]}`);
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
    reasons.push('Nível sênior ou liderança');
  }
  if (JUNIOR.test(title)) {
    pts -= 2;
    warnings.push('Vaga de nível júnior/estágio');
  }
  if (/\b(unreal|unity)\b/.test(title) && !me.skills.includes('Unreal Engine')) {
    pts -= 1.5;
    warnings.push(fromCv ? 'Foco em motor de tempo real (Unreal/Unity), que não está no seu currículo' : 'Foco em motor de tempo real (Unreal/Unity)');
  }
  if (BAD_TITLE.test(title)) {
    pts -= 2;
    warnings.push('Cargo de outra especialidade (jogos, VFX, personagem…)');
  }

  let bonus = 0;
  if (mentions(all, /art direction|direcao de arte|art director/)) bonus += 0.5;
  if (mentions(all, /anima(tion|cao)|fly ?through|fly ?over|video/)) bonus += 0.25;
  if (mentions(all, /\b(ai|ia)\b[- ]?(assisted|workflow|tools)|generative|comfyui|stable diffusion|midjourney|inteligencia artificial|\bia generativa/)) {
    // Só pesa a favor se o seu currículo cita IA.
    if (me.ai) { bonus += 0.5; reasons.push('Cita fluxo com IA, que está no seu currículo'); }
    else warnings.push('Pede fluxo com IA');
  }
  if (mentions(all, /real estate|imobili|residential|high[- ]end|alto padrao|lancamento|incorporadora|construtora/)) {
    bonus += 0.25;
    if (mentions(all, /imobili|alto padrao|lancamento|incorporadora|construtora/)) reasons.push('Mercado imobiliário');
  }
  if (mentions(all, /\bpj\b|pessoa juridica|cnpj/)) reasons.push('Contratação PJ');
  pts += Math.min(bonus, 1);

  const fit = pts >= 6 ? 5 : pts >= 4.5 ? 4 : pts >= 3 ? 3 : pts >= 1.5 ? 2 : 1;
  return { fit, reasons, warnings, points: Math.round(pts * 100) / 100 };
}

/** Filtro barato para feeds amplos: só guarda o que tem cara de ArchViz/3D de arquitetura. */
function isCandidate(job) {
  const title = norm(job.title);
  if (ARCHVIZ_TITLE.test(title)) return true;
  const all = `${title} ${norm(job.description || '')}`;
  if (BR_ARCHVIZ.test(all) && /3d|render|visual|perspectiv|maquet|imagem|imagens/.test(title)) return true;
  return /archviz|arch viz|architectural visuali|corona render|3ds max/.test(all) && /3d|render|visual/.test(title);
}

module.exports = { scoreJob, isCandidate, BR_ARCHVIZ };
