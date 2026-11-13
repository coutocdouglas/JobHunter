'use strict';
// Todo texto vindo da internet entra no DOM só via textContent (h()), nunca via innerHTML.

const STATUS_LABEL = { nova: 'Nova', aplicar: 'Aplicar', talvez: 'Talvez', rascunho: 'Rascunho no Gmail', enviada: 'Enviada', resposta: 'Respondeu', entrevista: 'Entrevista', descartada: 'Descartada' };
const $ = (id) => document.getElementById(id);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

function showMsg(text) { const m = $('msg'); m.textContent = text; m.hidden = !text; }
const fail = (e) => showMsg(`Erro: ${String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);

/* ---------- vagas ---------- */
let cfg = null;

function fmtDate(p) {
  if (!p) return 'Data não informada';
  const d = new Date(p);
  return Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}/.test(p) ? p : `Publicada em ${d.toLocaleDateString('pt-BR')}`;
}

/* Bandeiras pequenas e discretas, desenhadas em SVG (o Windows não mostra emoji de bandeira). */
const svg = (body) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16">${body}</svg>`)}`;
const FLAGS = {
  BR: svg('<rect width="24" height="16" fill="#1d9e50"/><path d="M12 2.5 21 8 12 13.5 3 8z" fill="#fac775"/><circle cx="12" cy="8" r="3.2" fill="#185fa5"/>'),
  US: svg('<rect width="24" height="16" fill="#fff"/><path d="M0 0h24v2.3H0zM0 4.6h24v2.3H0zM0 9.2h24v2.3H0zM0 13.7h24V16H0z" fill="#d9413f"/><rect width="10" height="9.2" fill="#2a4d9b"/>'),
  PT: svg('<rect width="24" height="16" fill="#d9413f"/><rect width="9.6" height="16" fill="#1d7a4a"/><circle cx="9.6" cy="8" r="2.6" fill="#fac775"/>'),
  GB: svg('<rect width="24" height="16" fill="#2a4d9b"/><path d="M0 0l24 16M24 0 0 16" stroke="#fff" stroke-width="3"/><path d="M12 0v16M0 8h24" stroke="#fff" stroke-width="5"/><path d="M12 0v16M0 8h24" stroke="#d9413f" stroke-width="3"/>'),
  DE: svg('<rect width="24" height="5.4" fill="#2c2c2a"/><rect y="5.3" width="24" height="5.4" fill="#d9413f"/><rect y="10.6" width="24" height="5.4" fill="#fac775"/>'),
  CA: svg('<rect width="24" height="16" fill="#fff"/><rect width="6" height="16" fill="#d9413f"/><rect x="18" width="6" height="16" fill="#d9413f"/><circle cx="12" cy="8" r="2.6" fill="#d9413f"/>'),
  ES: svg('<rect width="24" height="16" fill="#d9413f"/><rect y="4" width="24" height="8" fill="#fac775"/>'),
};
function flag(country) {
  if (!country) return null;
  return FLAGS[country.code] ? h('img', { class: 'flag', src: FLAGS[country.code], alt: country.name }) : h('span', { class: 'flag code' }, country.code);
}

function card(j) {
  const btn = (st, label) => h('button', { class: `${j.status === st ? 'on ' : ''}${st}`, onclick: () => act(j.id, j.status === st ? 'nova' : st) }, label);
  return h('article', { class: `card ${j.status}` },
    h('div', { class: 'row-top' }, h('div', {}, h('h3', { class: 'title' }, j.title), h('div', { class: 'co' }, j.company)), h('span', { class: 'fit' }, `Aderência ${j.fit}/5`)),
    h('div', { class: 'loc' }, flag(j.country), h('b', {}, j.location || 'Local não informado'), j.country && h('span', { class: 'ctry' }, j.country.name)),
    h('div', { class: 'chips' },
      h('span', { class: 'chip' }, j.source),
      j.salary && h('span', { class: 'chip' }, j.salary),
      h('span', { class: 'chip' }, fmtDate(j.posted)),
      h('span', { class: 'chip' }, STATUS_LABEL[j.status])),
    j.reasons.length > 0 && h('ul', {}, j.reasons.map((r) => h('li', {}, r))),
    j.warnings.length > 0 && h('div', { class: 'warnings' }, `Atenção: ${j.warnings.join(' · ')}`),
    h('div', { class: 'actions' },
      btn('aplicar', 'Aplicar'), btn('talvez', 'Talvez'), btn('descartada', 'Descartar'),
      h('button', { onclick: () => openModal(j.id) }, 'Preparar candidatura'),
      h('button', { onclick: () => window.jh.open(j.url).catch(fail) }, 'Abrir vaga')));
}

async function act(id, status) {
  try { await window.jh.setStatus(id, status); await refresh(); } catch (e) { fail(e); }
}

let onboarded = null;
async function refresh() {
  if (onboarded === null) {
    try { const c = await window.jh.getConfig(); onboarded = !!(c.profile && c.profile.name); } catch { onboarded = true; }
    $('onboard').hidden = onboarded;
  }
  const { jobs, counts } = await window.jh.list({ text: $('q').value, region: $('reg').value, status: $('st').value, minFit: Number($('fit').value) });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  $('stats').replaceChildren(
    stat(total, 'vagas no banco'),
    ...['aplicar', 'rascunho', 'enviada', 'resposta', 'entrevista'].map((s) => stat(counts[s] || 0, STATUS_LABEL[s].toLowerCase())));
  $('grid').replaceChildren(...(jobs.length ? jobs.map(card) : [h('div', { class: 'empty' }, 'Nenhuma vaga com esses filtros. Tente baixar a aderência mínima ou buscar vagas agora.')]));
}
const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));

/* ---------- busca ---------- */
async function runScan() {
  $('scan').disabled = true;
  showMsg('Buscando vagas nas fontes abertas…');
  try {
    const r = await window.jh.scan(false);
    const lines = r.report.map((x) => `${x.ok ? (x.skipped ? '·' : '✓') : '✗'} ${x.label}: ${x.skipped ? 'consultada há menos de 6 h, pulei' : x.ok ? `${x.found} lidas, ${x.kept} com perfil de ArchViz` : x.error}`);
    showMsg(`${r.added} vaga(s) nova(s).\n${lines.join('\n')}`);
    await refresh();
  } catch (e) { fail(e); } finally { $('scan').disabled = false; }
}
async function runAlerts() {
  $('alerts').disabled = true;
  showMsg('Lendo os alertas do LinkedIn no Gmail…');
  try {
    const r = await window.jh.importAlerts();
    showMsg(`${r.emails} e-mail(s) de alerta lidos, ${r.found} vaga(s) encontradas, ${r.added} nova(s). As vagas do LinkedIn entram com aderência estimada só pelo título: abra a vaga para conferir.`);
    await refresh();
  } catch (e) { fail(e); } finally { $('alerts').disabled = false; }
}

/* ---------- candidatura ---------- */
const LANG_LABEL = { pt: 'Português', en: 'Inglês', any: 'Qualquer idioma' };
let cur = null;
let lastGenerated = { subject: '', body: '' };

function docLabel(d) {
  return `${d.name} · ${LANG_LABEL[d.lang]}${d.isDefault ? ' · padrão' : ''}`;
}
function fillSelect(el, kind, selected, emptyLabel) {
  const docs = cur.docs.filter((d) => d.kind === kind);
  el.replaceChildren(h('option', { value: '' }, docs.length ? emptyLabel : `${emptyLabel} (nenhum carregado)`), ...docs.map((d) => h('option', { value: d.id }, docLabel(d))));
  el.value = selected || '';
}
const currentSel = () => ({ cv: $('m-cv').value || null, portfolio: $('m-pf').value || null, cover: $('m-cover').value || null });

/** Atualiza o modal. Só troca assunto/corpo se você ainda não editou o texto. */
function applyPrepared(first) {
  $('m-title').textContent = `${cur.job.title} — ${cur.job.company}`;
  $('m-lang').value = cur.lang;
  if (first) $('m-to').value = cur.to;
  fillSelect($('m-cv'), 'cv', cur.sel.cv, 'Não anexar currículo');
  fillSelect($('m-pf'), 'portfolio', cur.sel.portfolio, 'Não anexar portfólio');
  fillSelect($('m-cover'), 'cover', cur.sel.cover, 'Sem cover letter');
  const untouched = first || ($('m-subject').value === lastGenerated.subject && $('m-body').value === lastGenerated.body);
  if (untouched) {
    $('m-subject').value = cur.subject;
    $('m-body').value = cur.body;
    lastGenerated = { subject: cur.subject, body: cur.body };
    $('m-note').textContent = cur.docs.length
      ? 'Revise o texto e os anexos. O rascunho vai para o seu Gmail e nada é enviado até você clicar em enviar lá.'
      : 'Nenhum documento carregado ainda. Carregue currículo e portfólio na aba Documentos.';
  } else {
    $('m-note').textContent = 'Anexos atualizados. Você editou o texto, então não mexi nele: confira se a frase sobre os anexos ainda bate.';
  }
}

// O mesmo modal serve para vaga (kind 'job') e para estúdio (kind 'studio').
const isStudio = () => cur && cur.job && cur.job.kind === 'studio';
const prepareFor = (kind, id, lang, sel) => (kind === 'studio' ? window.jh.prepareStudio(id, lang, sel) : window.jh.prepare(id, lang, sel));

async function openModal(id, kind = 'job') {
  try { cur = await prepareFor(kind, id); } catch (e) { return fail(e); }
  applyPrepared(true);
  $('m-sent').textContent = isStudio() ? 'Marcar como contatado' : 'Marcar como enviada';
  $('m-to').placeholder = isStudio() ? 'e-mail de contato do estúdio (veja no site dele)' : 'e-mail de contato da vaga (se houver)';
  $('modal').hidden = false;
}
async function reprepare(lang, sel) {
  try {
    const kind = isStudio() ? 'studio' : 'job';
    cur = await prepareFor(kind, cur.job.id, lang, sel);
    if (sel) await (kind === 'studio' ? window.jh.saveStudioDocs : window.jh.saveJobDocs)(cur.job.id, cur.lang, cur.sel);
    applyPrepared(false);
  } catch (e) { $('m-note').textContent = `Erro: ${errText(e)}`; }
}
const errText = (e) => String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const closeModal = () => { $('modal').hidden = true; cur = null; };

$('m-lang').addEventListener('change', () => reprepare($('m-lang').value));
['m-cv', 'm-pf', 'm-cover'].forEach((id) => $(id).addEventListener('change', () => reprepare($('m-lang').value, currentSel())));
$('m-cover-up').addEventListener('click', async () => {
  try {
    const { docs: added } = await window.jh.importDocs('cover', $('m-lang').value);
    if (!added.length) return;
    await reprepare($('m-lang').value, { ...currentSel(), cover: added[0].id });
  } catch (e) { $('m-note').textContent = `Erro: ${errText(e)}`; }
});
$('m-close').addEventListener('click', closeModal);
$('m-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`${$('m-subject').value}\n\n${$('m-body').value}`); $('m-note').textContent = 'Texto copiado.'; }
  catch { $('m-note').textContent = 'Não consegui copiar. Selecione o texto e copie à mão.'; }
});
$('m-draft').addEventListener('click', async () => {
  $('m-draft').disabled = true;
  try {
    await window.jh.createDraft({ kind: cur.job.kind, id: cur.job.id, lang: $('m-lang').value, to: $('m-to').value.trim(), subject: $('m-subject').value, body: $('m-body').value, sel: currentSel() });
    $('m-note').textContent = 'Rascunho criado no Gmail. Abra a pasta Rascunhos, revise e envie.';
    await (isStudio() ? renderStudios() : refresh());
  } catch (e) { $('m-note').textContent = `Erro: ${errText(e)}`; } finally { $('m-draft').disabled = false; }
});
$('m-sent').addEventListener('click', async () => {
  if (isStudio()) {
    try { await window.jh.updateStudio(cur.job.id, { status: 'contatado' }); closeModal(); await renderStudios(); } catch (e) { $('m-note').textContent = `Erro: ${errText(e)}`; }
    return;
  }
  await act(cur.job.id, 'enviada');
  closeModal();
});

/* ---------- estúdios ---------- */
const STUDIO_LABEL = { novo: 'Novo', contatar: 'Contatar', rascunho: 'Rascunho no Gmail', contatado: 'Contatado', respondeu: 'Respondeu', conversa: 'Em conversa', sem_interesse: 'Sem interesse' };
const ATS_LABEL = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workable: 'Workable' };
const sMsg = (t) => { const m = $('s-msg'); m.textContent = t; m.hidden = !t; };

function studioCard(s) {
  const upd = async (fields) => { try { await window.jh.updateStudio(s.id, fields); sMsg(''); await renderStudios(); } catch (e) { sMsg(`Erro: ${errText(e)}`); } };
  const status = h('select', { onchange: () => upd({ status: status.value }) }, ...Object.entries(STUDIO_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  status.value = s.status;
  const notes = h('textarea', { class: 'notes', rows: 2, placeholder: 'Anotações (quem contatou, quando, o que responderam…)', onchange: () => upd({ notes: notes.value }) }, s.notes);
  let armed = false;
  const del = h('button', {
    onclick: async () => {
      if (!armed) { armed = true; del.textContent = 'Confirmar remoção'; setTimeout(() => { armed = false; del.textContent = 'Remover'; }, 4000); return; }
      try { await window.jh.removeStudio(s.id); await renderStudios(); } catch (e) { sMsg(`Erro: ${errText(e)}`); }
    },
  }, 'Remover');
  const link = (url, label) => url && h('button', { onclick: () => window.jh.open(url).catch((e) => sMsg(`Erro: ${errText(e)}`)) }, label);
  return h('article', { class: `card ${s.status}` },
    h('div', { class: 'row-top' }, h('div', {}, h('h3', { class: 'title' }, s.name), h('div', { class: 'co' }, [s.city, s.country].filter(Boolean).join(' · ') || 'Local não informado')), status),
    h('div', { class: 'chips' },
      s.ats ? h('span', { class: 'chip' }, `Carreiras vigiadas (${ATS_LABEL[s.ats]})`) : h('span', { class: 'chip' }, 'Sem página monitorável'),
      s.email && h('span', { class: 'chip' }, s.email),
      s.lastContact && h('span', { class: 'chip' }, `Contatado em ${new Date(s.lastContact).toLocaleDateString('pt-BR')}`)),
    s.remoteEvidence ? h('ul', {}, h('li', {}, s.remoteEvidence)) : h('div', { class: 'warnings' }, 'Atenção: sem vaga remota conhecida, é abordagem espontânea.'),
    notes,
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => openModal(s.id, 'studio') }, 'Preparar abordagem'),
      link(s.site, 'Abrir site'), link(s.careersUrl, 'Carreiras'), del));
}

async function renderStudios() {
  const { studios, counts } = await window.jh.studios({ text: $('s-q').value, region: $('s-reg').value, status: $('s-st').value });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  $('s-stats').replaceChildren(stat(total, 'estúdios'), ...['contatar', 'rascunho', 'contatado', 'respondeu', 'conversa'].map((k) => stat(counts[k] || 0, STUDIO_LABEL[k].toLowerCase())));
  $('s-grid').replaceChildren(...(studios.length ? studios.map(studioCard) : [h('div', { class: 'empty' }, 'Nenhum estúdio com esses filtros.')]));
}

for (const [v, l] of Object.entries(STUDIO_LABEL)) $('s-st').append(h('option', { value: v }, l));
['s-q', 's-reg', 's-st'].forEach((id) => $(id).addEventListener('input', () => renderStudios().catch((e) => sMsg(`Erro: ${errText(e)}`))));
$('s-new').addEventListener('click', () => { $('s-form').hidden = false; $('sf-name').focus(); });
$('sf-cancel').addEventListener('click', () => { $('s-form').hidden = true; $('s-form').reset(); });
$('s-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await window.jh.addStudio({ name: $('sf-name').value, country: $('sf-country').value, site: $('sf-site').value, email: $('sf-email').value, ats: $('sf-ats').value, atsSlug: $('sf-slug').value, notes: $('sf-notes').value });
    $('s-form').reset();
    $('s-form').hidden = true;
    sMsg('');
    await renderStudios();
  } catch (err) { sMsg(`Erro: ${errText(err)}`); }
});

/* ---------- documentos ---------- */
const DOC_SECTIONS = [
  { kind: 'cv', title: 'Currículos', defLang: 'pt', help: 'Tenha um em português e um em inglês. O app escolhe pelo idioma da candidatura.' },
  { kind: 'portfolio', title: 'Portfólios', defLang: 'any', help: 'Se o portfólio serve para os dois idiomas, deixe "Qualquer idioma". Mantenha abaixo de ~15 MB para caber no e-mail com o currículo.' },
  { kind: 'cover', title: 'Cover letters', defLang: 'en', help: 'Só vão anexas quando você escolher na candidatura. Também dá para carregar uma específica direto na tela da vaga.' },
];
const docsMsg = (t) => { const m = $('docs-msg'); m.textContent = t; m.hidden = !t; };
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function langSelect(value, onchange) {
  const s = h('select', { onchange: () => onchange(s.value) }, ...Object.entries(LANG_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  s.value = value;
  return s;
}

const FIELD_LABEL = { name: 'nome', email: 'e-mail', phone: 'telefone', site: 'site', years: 'anos de experiência', 'headline.pt': 'cargo (português)', 'headline.en': 'cargo (inglês)', 'city.pt': 'cidade (português)', 'city.en': 'cidade (inglês)', skills: 'ferramentas', ai: 'uso de IA', animation: 'animação' };
async function importDoc(kind, lang) {
  try {
    const { docs, filled } = await window.jh.importDocs(kind, lang);
    if (filled.length) onboarded = null;
    await renderDocs();
    if (filled.length) docsMsg(`Li o currículo e preenchi seu perfil: ${filled.map((f) => FIELD_LABEL[f] || f).join(', ')}. Confira em Configurações e escreva lá o parágrafo de destaques.`);
    else if (kind === 'cv' && docs.length) docsMsg('Currículo carregado. Não preenchi nada novo no perfil (ou já estava preenchido, ou o PDF não tem texto). Confira em Configurações.');
    else docsMsg('');
  } catch (e) { docsMsg(`Erro: ${errText(e)}`); await renderDocs(); }
}

async function renderDocs() {
  const docs = await window.jh.docs();
  const wrap = (fn) => async (...a) => { try { await fn(...a); docsMsg(''); } catch (e) { docsMsg(`Erro: ${errText(e)}`); } await renderDocs(); };
  for (const sec of DOC_SECTIONS) {
    let lang = sec.defLang;
    const items = docs.filter((d) => d.kind === sec.kind);
    $(`docs-${sec.kind}`).replaceChildren(
      h('div', { class: 'sechead' },
        h('h2', {}, sec.title),
        langSelect(lang, (v) => { lang = v; }),
        h('button', { class: 'primary', onclick: () => importDoc(sec.kind, lang) }, 'Carregar arquivo…')),
      h('p', { class: 'help' }, sec.help),
      h('div', { class: 'doclist' }, items.length ? items.map((d) => docRow(d, wrap)) : [h('p', { class: 'help' }, 'Nenhum arquivo carregado.')]));
  }
}

function docRow(d, wrap) {
  let armed = false;
  const del = h('button', {
    onclick: async () => {
      if (!armed) { armed = true; del.textContent = 'Confirmar remoção'; setTimeout(() => { armed = false; del.textContent = 'Remover'; }, 4000); return; }
      await wrap(() => window.jh.removeDoc(d.id))();
    },
  }, 'Remover');
  return h('div', { class: 'doc' },
    h('div', { class: 'dname', title: d.name }, d.name),
    h('span', { class: 'dmeta' }, `${fmtSize(d.size)} · ${new Date(d.added).toLocaleDateString('pt-BR')}`),
    langSelect(d.lang, (v) => wrap(() => window.jh.setDocLang(d.id, v))()),
    d.kind !== 'cover' && (d.isDefault ? h('span', { class: 'badge' }, 'Padrão') : h('button', { onclick: wrap(() => window.jh.setDefaultDoc(d.id)) }, 'Usar como padrão')),
    h('button', { onclick: wrap(() => window.jh.openDoc(d.id)) }, 'Abrir'),
    del);
}

/* ---------- configurações ---------- */
function field(label, input) { return h('div', { class: 'field' }, h('label', {}, label), input); }
function text(id, value, attrs) { return h('input', { id, value: value || '', ...attrs }); }
const lines = (a) => (a || []).join('\n');

async function renderConfig() {
  cfg = await window.jh.getConfig();
  const p = cfg.profile;
  $('f-profile').replaceChildren(
    field('Nome', text('p-name', p.name)), field('E-mail', text('p-email', p.email)), field('Telefone', text('p-phone', p.phone)), field('Site do portfólio', text('p-site', p.site)),
    field('Cidade (português)', text('p-city-pt', p.city.pt)), field('Cidade (inglês)', text('p-city-en', p.city.en)),
    field('Cargo, como vai na frase "Sou…" (português)', text('p-hl-pt', p.headline && p.headline.pt, { placeholder: 'ex.: arquiteto e artista 3D' })),
    field('Cargo, como vai na frase "I am a…" (inglês)', text('p-hl-en', p.headline && p.headline.en, { placeholder: 'ex.: architect and 3D artist' })),
    field('Anos de experiência', text('p-years', p.years || '', { type: 'number', min: 1, max: 60 })),
    field('Disponibilidade (português)', text('p-av-pt', p.availability.pt)), field('Disponibilidade (inglês)', text('p-av-en', p.availability.en)),
    field('Destaques (português) — parágrafo com suas principais conquistas, entra em todos os e-mails', h('textarea', { id: 'p-hi-pt', rows: 3 }, (p.highlights && p.highlights.pt) || '')),
    field('Destaques (inglês)', h('textarea', { id: 'p-hi-en', rows: 3 }, (p.highlights && p.highlights.en) || '')),
    field('Ferramentas que você domina (usadas na nota e nos e-mails)', h('div', { class: 'chips', id: 'p-skills' },
      ...(cfg.knownTools || []).map((t) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: t, checked: (p.skills || []).includes(t) }), ` ${t}`)))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'p-ai', checked: !!p.ai }), ' Uso IA no meu processo de trabalho'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'p-anim', checked: !!p.animation }), ' Produzo vídeos e animações'));
  const connected = h('p', { class: 'help' }, cfg.gmailConnected ? 'Gmail conectado.' : 'Gmail não conectado.');
  $('f-google').replaceChildren(
    field('Client ID', text('g-id', cfg.google.clientId)),
    field(cfg.hasClientSecret ? 'Client Secret (já guardado; preencha só para trocar)' : 'Client Secret', text('g-secret', '', { type: 'password', autocomplete: 'off' })),
    connected,
    h('div', { class: 'actions' },
      h('button', { onclick: async () => { await save(); try { await window.jh.gmailConnect(); await renderConfig(); } catch (e) { fail(e); } } }, 'Conectar ao Gmail'),
      cfg.gmailConnected && h('button', { onclick: async () => { await window.jh.gmailDisconnect(); await renderConfig(); } }, 'Desconectar')));
  const ta = (id, label, v) => field(label, h('textarea', { id, rows: 3 }, lines(v)));
  $('f-companies').replaceChildren(ta('c-gh', 'Greenhouse', cfg.companies.greenhouse), ta('c-lever', 'Lever', cfg.companies.lever), ta('c-ashby', 'Ashby', cfg.companies.ashby), ta('c-wk', 'Workable', cfg.companies.workable));
  $('f-br').replaceChildren(
    h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'br-gupy', checked: cfg.gupy !== false }), ' Buscar na Gupy (experimental: usa a busca pública do site, que pode mudar sem aviso)'));
  $('f-adzuna').replaceChildren(field('App ID', text('a-id', cfg.adzuna.appId)), field('App Key', text('a-key', cfg.adzuna.appKey, { type: 'password', autocomplete: 'off' })));
}
const split = (id) => $(id).value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

async function save() {
  const secret = $('g-secret').value;
  cfg = await window.jh.setConfig({
    profile: {
      name: $('p-name').value, email: $('p-email').value, phone: $('p-phone').value, site: $('p-site').value,
      city: { pt: $('p-city-pt').value, en: $('p-city-en').value },
      headline: { pt: $('p-hl-pt').value, en: $('p-hl-en').value },
      years: $('p-years').value,
      availability: { pt: $('p-av-pt').value, en: $('p-av-en').value },
      highlights: { pt: $('p-hi-pt').value, en: $('p-hi-en').value },
      skills: [...document.querySelectorAll('#p-skills input:checked')].map((i) => i.value),
      ai: $('p-ai').checked, animation: $('p-anim').checked,
    },
    google: { clientId: $('g-id').value.trim() },
    googleClientSecret: secret || undefined,
    companies: { greenhouse: split('c-gh'), lever: split('c-lever'), ashby: split('c-ashby'), workable: split('c-wk') },
    adzuna: { appId: $('a-id').value.trim(), appKey: $('a-key').value.trim() },
    gupy: $('br-gupy').checked,
  });
  onboarded = !!(cfg.profile && cfg.profile.name);
  $('onboard').hidden = onboarded;
  $('saved').textContent = 'Salvo.';
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
}

/* ---------- navegação ---------- */
const VIEWS = ['home', 'vagas', 'studios', 'docs', 'config'];
function showOnly(view) { for (const v of VIEWS) $(`view-${v}`).hidden = v !== view; }
function setChrome(inEnv) { for (const id of ['env-bar', 'tabs', 'scan', 'alerts']) $(id).hidden = !inEnv; }

async function goTab(name) {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.view === name));
  showOnly(name);
  try {
    if (name === 'config') await renderConfig();
    else if (name === 'studios') await renderStudios();
    else if (name === 'docs') await renderDocs();
    else await refresh();
  } catch (e) { fail(e); }
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => goTab(t.dataset.view)));

/* ---------- ambientes de procura ---------- */
let envs = [];
let currentEnv = null;
const homeMsg = (t) => { $('home-msg').textContent = t; $('home-msg').hidden = !t; };
const homeFail = (e) => homeMsg(`Erro: ${String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);

function envTile(e) {
  return h('button', { class: 'card tile', onclick: () => openEnvironment(e.id).catch(homeFail) },
    h('h3', { class: 'title' }, e.name),
    h('div', { class: 'chips' }, e.terms.slice(0, 6).map((t) => h('span', { class: 'chip' }, t)), e.terms.length > 6 && h('span', { class: 'chip' }, `+${e.terms.length - 6}`)),
    h('div', { class: 'co' }, e.lastOpened ? `Aberto em ${new Date(e.lastOpened).toLocaleDateString('pt-BR')}` : 'Ainda não aberto'));
}

async function showHome() {
  await window.jh.envHome();
  currentEnv = null;
  const st = await window.jh.envState();
  envs = st.envs;
  setChrome(false);
  showOnly('home');
  homeMsg('');
  $('env-form').hidden = true;
  $('home-grid').replaceChildren(
    ...envs.map(envTile),
    h('button', { class: 'card tile new', onclick: () => { $('env-form').hidden = false; $('env-name').focus(); } }, h('b', {}, '+ Novo ambiente'), h('span', { class: 'co' }, 'Escolha o tipo de vaga que quer buscar')));
  if (!envs.length) homeMsg('Você ainda não tem nenhum ambiente. Crie o primeiro: diga que tipo de vaga procura e os nomes usados nos anúncios.');
}

/** Entra no ambiente (já aberto no processo principal) e mostra a aba de vagas. */
async function enterEnv(env) {
  currentEnv = env;
  envs = (await window.jh.envState()).envs;
  $('env-switch').replaceChildren(...envs.map((e) => h('option', { value: e.id }, e.name)));
  $('env-switch').value = env.id;
  // No ambiente original (ArchViz) a nota já é calibrada; nos novos, mostre tudo até a nota ser ajustada.
  $('fit').value = env.preset === 'archviz' ? '3' : '1';
  onboarded = null;
  showMsg('');
  setChrome(true);
  await goTab('vagas');
}
async function openEnvironment(id) { await enterEnv(await window.jh.envOpen(id)); }

$('env-home').addEventListener('click', () => showHome().catch(homeFail));
$('env-switch').addEventListener('change', () => openEnvironment($('env-switch').value).catch(fail));
$('env-cancel').addEventListener('click', () => { $('env-form').hidden = true; });
$('env-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const e = await window.jh.envCreate({ name: $('env-name').value, terms: $('env-terms').value });
    $('env-form').reset();
    await openEnvironment(e.id);
  } catch (e) { homeFail(e); }
});

async function init() {
  const st = await window.jh.envState();
  envs = st.envs;
  if (st.active) await enterEnv(st.active); else await showHome();
}
$('save').addEventListener('click', () => save().catch(fail));
$('scan').addEventListener('click', runScan);
$('alerts').addEventListener('click', runAlerts);
for (const s of Object.keys(STATUS_LABEL)) $('st').append(h('option', { value: s }, STATUS_LABEL[s]));
['q', 'reg', 'st', 'fit'].forEach((id) => $(id).addEventListener('input', () => refresh().catch(fail)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

init().catch((e) => { setChrome(false); showOnly('home'); homeFail(e); });
