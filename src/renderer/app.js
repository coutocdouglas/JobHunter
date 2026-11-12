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

function card(j) {
  const btn = (st, label) => h('button', { class: `${j.status === st ? 'on ' : ''}${st}`, onclick: () => act(j.id, j.status === st ? 'nova' : st) }, label);
  return h('article', { class: `card ${j.status}` },
    h('div', { class: 'row-top' }, h('div', {}, h('h3', { class: 'title' }, j.title), h('div', { class: 'co' }, j.company)), h('span', { class: 'fit' }, `Aderência ${j.fit}/5`)),
    h('div', { class: 'chips' },
      h('span', { class: 'chip' }, j.location || 'Local não informado'),
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

async function refresh() {
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

async function openModal(id) {
  try { cur = await window.jh.prepare(id); } catch (e) { return fail(e); }
  applyPrepared(true);
  $('modal').hidden = false;
}
async function reprepare(lang, sel) {
  try {
    cur = await window.jh.prepare(cur.job.id, lang, sel);
    if (sel) await window.jh.saveJobDocs(cur.job.id, cur.lang, cur.sel);
    applyPrepared(false);
  } catch (e) { $('m-note').textContent = `Erro: ${errText(e)}`; }
}
const errText = (e) => String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const closeModal = () => { $('modal').hidden = true; cur = null; };

$('m-lang').addEventListener('change', () => reprepare($('m-lang').value));
['m-cv', 'm-pf', 'm-cover'].forEach((id) => $(id).addEventListener('change', () => reprepare($('m-lang').value, currentSel())));
$('m-cover-up').addEventListener('click', async () => {
  try {
    const added = await window.jh.importDocs('cover', $('m-lang').value);
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
    await window.jh.createDraft({ id: cur.job.id, lang: $('m-lang').value, to: $('m-to').value.trim(), subject: $('m-subject').value, body: $('m-body').value, sel: currentSel() });
    $('m-note').textContent = 'Rascunho criado no Gmail. Abra a pasta Rascunhos, revise e envie.';
    await refresh();
  } catch (e) { $('m-note').textContent = `Erro: ${errText(e)}`; } finally { $('m-draft').disabled = false; }
});
$('m-sent').addEventListener('click', async () => { await act(cur.job.id, 'enviada'); closeModal(); });

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
        h('button', { class: 'primary', onclick: wrap(() => window.jh.importDocs(sec.kind, lang)) }, 'Carregar arquivo…')),
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
    field('Disponibilidade (português)', text('p-av-pt', p.availability.pt)), field('Disponibilidade (inglês)', text('p-av-en', p.availability.en)));
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
    profile: { name: $('p-name').value, email: $('p-email').value, phone: $('p-phone').value, site: $('p-site').value, city: { pt: $('p-city-pt').value, en: $('p-city-en').value }, availability: { pt: $('p-av-pt').value, en: $('p-av-en').value } },
    google: { clientId: $('g-id').value.trim() },
    googleClientSecret: secret || undefined,
    companies: { greenhouse: split('c-gh'), lever: split('c-lever'), ashby: split('c-ashby'), workable: split('c-wk') },
    adzuna: { appId: $('a-id').value.trim(), appKey: $('a-key').value.trim() },
    gupy: $('br-gupy').checked,
  });
  $('saved').textContent = 'Salvo.';
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
}

/* ---------- navegação ---------- */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', async () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
  for (const v of ['vagas', 'docs', 'config']) $(`view-${v}`).hidden = t.dataset.view !== v;
  try {
    if (t.dataset.view === 'config') await renderConfig();
    else if (t.dataset.view === 'docs') await renderDocs();
    else await refresh();
  } catch (e) { fail(e); }
}));
$('save').addEventListener('click', () => save().catch(fail));
$('scan').addEventListener('click', runScan);
$('alerts').addEventListener('click', runAlerts);
for (const s of Object.keys(STATUS_LABEL)) $('st').append(h('option', { value: s }, STATUS_LABEL[s]));
['q', 'reg', 'st', 'fit'].forEach((id) => $(id).addEventListener('input', () => refresh().catch(fail)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

refresh().catch(fail);
