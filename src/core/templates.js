'use strict';
const { matchedSkills, mentions } = require('./detect');
const { norm } = require('./text');

// Perfil vazio: os dados pessoais vêm do currículo carregado e das Configurações, nunca do código.
const DEFAULT_PROFILE = {
  name: '',
  email: '',
  phone: '',
  site: '',
  city: { pt: '', en: '' },
  headline: { pt: '', en: '' }, // ex.: "arquiteto e artista 3D", lido do cabeçalho do currículo
  years: null,
  skills: [],
  ai: false,
  animation: false,
  highlights: { pt: '', en: '' }, // parágrafo livre com suas principais conquistas
  availability: {
    pt: 'Tenho disponibilidade para trabalhar remotamente.',
    en: 'I am available to work remotely.',
  },
};

function withDefaults(profile = {}) {
  const p = { ...DEFAULT_PROFILE, ...profile };
  for (const k of ['city', 'headline', 'highlights', 'availability']) p[k] = { ...DEFAULT_PROFILE[k], ...(profile[k] || {}) };
  p.skills = Array.isArray(p.skills) ? p.skills : [];
  return p;
}

/** Escolhe PT para vagas do Brasil e EN para o resto. O usuário pode trocar na tela. */
function pickLang(job) {
  return /brasil|brazil/i.test(`${job.location || ''} ${job.source || ''}`) || /[ãõçé]/i.test(job.title || '') ? 'pt' : 'en';
}

function joinList(items, and) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

/** Quem é você, a partir do perfil. Frases sem dado ficam de fora. */
function intro(p, l) {
  const h = p.headline[l];
  const y = Number(p.years) > 0 ? Number(p.years) : null;
  const main = p.skills.slice(0, 3);
  const parts = [];
  if (l === 'pt') {
    if (h) parts.push(`Sou ${h}${y ? `, com mais de ${y} anos de experiência` : ''}.`);
    else if (y) parts.push(`Tenho mais de ${y} anos de experiência na área.`);
    if (main.length) parts.push(`Trabalho com ${joinList(main, 'e')}.`);
  } else {
    if (h) parts.push(`I am ${article(h)} ${h}${y ? ` with over ${y} years of experience` : ''}.`);
    else if (y) parts.push(`I have over ${y} years of experience in the field.`);
    if (main.length) parts.push(`I work with ${joinList(main, 'and')}.`);
  }
  return parts.join(' ');
}

/** O que a vaga pede e você tem (ferramentas, animação, IA), só com base no seu perfil. */
function skillsLine(job, p, lang) {
  const text = `${job.title} ${job.description || ''}`;
  const skills = p.skills.length ? matchedSkills(text, p.skills) : [];
  const parts = [];
  if (skills.length) {
    parts.push(lang === 'pt'
      ? `Vi que a vaga pede ${joinList(skills, 'e')}, que estão entre as ferramentas que uso no dia a dia.`
      : `I see the role calls for ${joinList(skills, 'and')}, which are part of my daily toolset.`);
  }
  if (p.animation && mentions(text, /anima(tion|cao)|fly ?through|fly ?over/)) {
    parts.push(lang === 'pt' ? 'Também produzo vídeos e animações.' : 'I also produce videos and animations.');
  }
  if (p.ai && mentions(text, /\b(ai|ia)\b[- ]?(assisted|workflow|tools)|generative|comfyui|stable diffusion|midjourney|inteligencia artificial/)) {
    parts.push(lang === 'pt' ? 'Também uso IA no meu processo de trabalho.' : 'I also use AI in my workflow.');
  }
  return parts.join(' ');
}

/** Frase sobre os anexos, de acordo com o que vai de fato no e-mail. */
function attachLine(att, p, l) {
  const more = p.site ? (l === 'pt' ? ` (mais trabalhos em ${p.site})` : ` (more work at ${p.site})`) : '';
  if (l === 'pt') {
    const items = [att.cv && 'meu currículo', att.portfolio && 'meu portfólio', att.cover && 'minha carta de apresentação'].filter(Boolean);
    if (items.length) return `Envio em anexo ${joinList(items, 'e')}${more}.`;
    return p.site ? `Meus trabalhos estão em ${p.site}.` : '';
  }
  const items = [att.cv && 'my CV', att.portfolio && 'my portfolio', att.cover && 'a cover letter'].filter(Boolean);
  if (items.length) {
    const s = `${joinList(items, 'and')} ${items.length > 1 ? 'are' : 'is'} attached${more}.`;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return p.site ? `My work is at ${p.site}.` : '';
}

function closing(p, l) {
  const city = p.city[l] || p.city.pt || p.city.en;
  if (l === 'pt') return [city && `Moro em ${city}.`, p.availability.pt].filter(Boolean).join(' ');
  return [city && `I am based in ${city}.`, p.availability.en].filter(Boolean).join(' ');
}

const signature = (p) => [p.name, p.phone, p.email].filter(Boolean);
const paragraphs = (...ps) => ps.filter((x) => x && String(x).trim()).join('\n\n');

/**
 * Monta assunto e corpo do e-mail de candidatura (texto puro). Só usa o que está no seu perfil.
 * `attach` diz quais documentos vão anexos: {cv, portfolio, cover}.
 */
function buildApplication(job, { lang, profile = {}, attach = { cv: true, portfolio: true, cover: false } } = {}) {
  const p = withDefaults(profile);
  const l = lang || pickLang(job);
  const company = job.company && !/n[aã]o informada|not informed/i.test(job.company) ? job.company : '';
  const who = p.name ? ` — ${p.name}` : '';
  const files = [attachLine(attach, p, l), closing(p, l)].filter(Boolean).join(' ');
  if (l === 'pt') {
    return {
      lang: l,
      subject: `Candidatura: ${job.title}${who}`,
      body: paragraphs(
        company ? `Olá, equipe ${company},` : 'Olá,',
        [`Escrevo para me candidatar à vaga de ${job.title}.`, intro(p, 'pt'), skillsLine(job, p, 'pt')].filter(Boolean).join(' '),
        p.highlights.pt,
        files,
        'Fico à disposição para conversar.',
        ['Atenciosamente,', ...signature(p)].join('\n'),
      ),
    };
  }
  return {
    lang: l,
    subject: `Application: ${job.title}${who}`,
    body: paragraphs(
      company ? `Hello ${company} team,` : 'Hello,',
      [`I am writing to apply for the ${job.title} position.`, intro(p, 'en'), skillsLine(job, p, 'en')].filter(Boolean).join(' '),
      p.highlights.en,
      files,
      'I would be glad to talk.',
      ['Best regards,', ...signature(p)].join('\n'),
    ),
  };
}

/** Idioma da abordagem a um estúdio: português para estúdios no Brasil. */
function studioLang(studio) {
  return /brasil|brazil/i.test(studio.country || '') ? 'pt' : 'en';
}

/** Candidatura espontânea para um estúdio (sem vaga aberta). Mesmas regras: só usa o seu perfil. */
function buildOutreach(studio, { lang, profile = {}, attach = { cv: true, portfolio: true, cover: false } } = {}) {
  const p = withDefaults(profile);
  const l = lang || studioLang(studio);
  const files = [attachLine(attach, p, l), closing(p, l)].filter(Boolean).join(' ');
  const ai = p.ai ? (l === 'pt' ? 'Também uso IA no meu processo de trabalho.' : 'I also use AI in my workflow.') : '';
  if (l === 'pt') {
    return {
      lang: l,
      subject: `Artista 3D / ArchViz disponível para colaborar${p.name ? ` — ${p.name}` : ''}`,
      body: paragraphs(
        `Olá, equipe ${studio.name},`,
        ['Acompanho o trabalho de vocês e gostaria de me colocar à disposição para futuras oportunidades, em vaga fixa ou por projeto.', intro(p, 'pt'), ai].filter(Boolean).join(' '),
        p.highlights.pt,
        files,
        'Se fizer sentido, fico à disposição para conversar.',
        ['Atenciosamente,', ...signature(p)].join('\n'),
      ),
    };
  }
  return {
    lang: l,
    subject: `ArchViz artist available for remote collaboration${p.name ? ` — ${p.name}` : ''}`,
    body: paragraphs(
      `Hello ${studio.name} team,`,
      ['I follow your work and would like to put myself forward for future opportunities, either full-time or as a remote contractor on a project basis.', intro(p, 'en'), ai].filter(Boolean).join(' '),
      p.highlights.en,
      files,
      'If it makes sense for your team, I would be glad to talk.',
      ['Best regards,', ...signature(p)].join('\n'),
    ),
  };
}

module.exports = { buildApplication, buildOutreach, studioLang, pickLang, withDefaults, DEFAULT_PROFILE, norm };
