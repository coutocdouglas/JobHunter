'use strict';
const { matchedSkills, mentions } = require('./detect');
const { norm } = require('./text');

const DEFAULT_PROFILE = {
  name: 'Douglas Couto',
  email: 'coutocdouglas@gmail.com',
  phone: '+55 31 98817-2586',
  site: 'tildstudio.com.br',
  city: { pt: 'Belo Horizonte, MG', en: 'Belo Horizonte, Brazil (UTC-3)' },
  // Linha opcional sobre disponibilidade. Edite nas configurações.
  availability: {
    pt: 'Tenho disponibilidade para trabalhar remotamente.',
    en: 'I am available to work remotely, as an independent contractor if that suits you.',
  },
};

/** Escolhe PT para vagas do Brasil e EN para o resto. O usuário pode trocar na tela. */
function pickLang(job) {
  return /brasil|brazil/i.test(`${job.location || ''} ${job.source || ''}`) || /[ãõçé]/i.test(job.title || '') ? 'pt' : 'en';
}

function skillsLine(job, lang) {
  const skills = matchedSkills(`${job.title} ${job.description || ''}`);
  const parts = [];
  if (skills.length) {
    parts.push(lang === 'pt'
      ? `Vi que a vaga pede ${skills.join(', ')}, que são minhas ferramentas diárias.`
      : `I see the role calls for ${skills.join(', ')}, which is my daily toolset.`);
  }
  const text = `${job.title} ${job.description || ''}`;
  if (mentions(text, /anima(tion|cao)|fly ?through|fly ?over/)) {
    parts.push(lang === 'pt' ? 'Também produzo vídeos e animações.' : 'I also produce videos and animations.');
  }
  if (mentions(text, /\b(ai|ia)\b[- ]?(assisted|workflow|tools)|generative|comfyui|stable diffusion|midjourney/)) {
    parts.push(lang === 'pt'
      ? 'Também uso IA como auxiliar no desenvolvimento da imagem.'
      : 'I also use AI as an assistant in the image development process.');
  }
  return parts.join(' ');
}

function joinList(items, and) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

/** Frase sobre os anexos, de acordo com o que vai de fato no e-mail. */
function attachLine(att, p, l) {
  if (l === 'pt') {
    const items = [att.cv && 'meu currículo', att.portfolio && 'meu portfólio', att.cover && 'minha carta de apresentação'].filter(Boolean);
    return items.length ? `Envio em anexo ${joinList(items, 'e')} (mais trabalhos em ${p.site}).` : `Meus trabalhos estão em ${p.site}.`;
  }
  const items = [att.cv && 'my CV', att.portfolio && 'my portfolio', att.cover && 'a cover letter'].filter(Boolean);
  const s = items.length ? `${joinList(items, 'and')} ${items.length > 1 ? 'are' : 'is'} attached` : '';
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)} (more work at ${p.site}).` : `My work is at ${p.site}.`;
}

/**
 * Monta assunto e corpo do e-mail de candidatura (texto puro).
 * Só afirma o que consta no currículo.
 * `attach` diz quais documentos vão anexos: {cv, portfolio, cover}.
 */
function buildApplication(job, { lang, profile = {}, attach = { cv: true, portfolio: true, cover: false } } = {}) {
  const p = { ...DEFAULT_PROFILE, ...profile };
  const l = lang || pickLang(job);
  const company = job.company && !/n[aã]o informada|not informed/i.test(job.company) ? job.company : '';
  const extra = skillsLine(job, l);
  const files = attachLine(attach, p, l);

  if (l === 'pt') {
    const hello = company ? `Olá, equipe ${company},` : 'Olá,';
    return {
      lang: l,
      subject: `Candidatura: ${job.title} — ${p.name}`,
      body: [
        hello,
        '',
        `Escrevo para me candidatar à vaga de ${job.title}. Sou arquiteto e artista 3D, com mais de 9 anos de atuação em visualização arquitetônica para o mercado imobiliário de alto padrão, e conduzo a imagem do conceito à pós-produção em 3ds Max, Corona Renderer e Photoshop.${extra ? ' ' + extra : ''}`,
        '',
        'Na Casa Digital entrego cerca de 10 projetos por ano para grandes construtoras, cuido da direção de arte e gerencio uma equipe, com foco na qualidade final das entregas.',
        '',
        `${files} Moro em ${p.city.pt}. ${p.availability.pt}`,
        '',
        'Fico à disposição para conversar.',
        '',
        'Atenciosamente,',
        p.name,
        p.phone,
        p.email,
      ].join('\n'),
    };
  }
  const hello = company ? `Hello ${company} team,` : 'Hello,';
  return {
    lang: l,
    subject: `Application: ${job.title} — ${p.name}`,
    body: [
      hello,
      '',
      `I am writing to apply for the ${job.title} position. I am an architect and 3D artist with over 9 years of experience in architectural visualization for the high-end real estate market, taking images from concept to post-production in 3ds Max, Corona Renderer and Photoshop.${extra ? ' ' + extra : ''}`,
      '',
      'At Casa Digital I deliver about 10 projects a year for major Brazilian construction firms, provide art direction and manage a team, with a focus on the quality of the final deliverables.',
      '',
      `${files} I am based in ${p.city.en} and fluent in English. ${p.availability.en}`,
      '',
      'I would be glad to talk.',
      '',
      'Best regards,',
      p.name,
      p.phone,
      p.email,
    ].join('\n'),
  };
}

module.exports = { buildApplication, pickLang, DEFAULT_PROFILE, norm };
