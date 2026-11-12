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
let cur = null;
async function openModal(id, lang) {
  try {
    cur = await window.jh.prepare(id, lang);
  } catch (e) { return fail(e); }
  $('m-title').textContent = `${cur.job.title} — ${cur.job.company}`;
  $('m-lang').value = cur.lang;
  $('m-to').value = cur.to;
  $('m-subject').value = cur.subject;
  $('m-body').value = cur.body;
  $('m-cvname').textContent = cur.cvFile ? baseName(cur.cvFile) : '(escolha em Configurações)';
  $('m-pfname').textContent = cur.portfolioFile ? baseName(cur.portfolioFile) : '(escolha em Configurações)';
  $('m-note').textContent = 'Revise o texto. O rascunho vai para o seu Gmail e nada é enviado até você clicar em enviar lá.';
  $('modal').hidden = false;
}
const baseName = (p) => String(p).split(/[\\/]/).pop();
const closeModal = () => { $('modal').hidden = true; cur = null; };

$('m-lang').addEventListener('change', () => openModal(cur.job.id, $('m-lang').value));
$('m-close').addEventListener('click', closeModal);
$('m-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`${$('m-subject').value}\n\n${$('m-body').value}`); $('m-note').textContent = 'Texto copiado.'; }
  catch { $('m-note').textContent = 'Não consegui copiar. Selecione o texto e copie à mão.'; }
});
$('m-draft').addEventListener('click', async () => {
  $('m-draft').disabled = true;
  try {
    await window.jh.createDraft({ id: cur.job.id, lang: $('m-lang').value, to: $('m-to').value.trim(), subject: $('m-subject').value, body: $('m-body').value, attachCv: $('m-cv').checked, attachPortfolio: $('m-pf').checked });
    $('m-note').textContent = 'Rascunho criado no Gmail. Abra a pasta Rascunhos, revise e envie.';
    await refresh();
  } catch (e) { $('m-note').textContent = `Erro: ${String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`; } finally { $('m-draft').disabled = false; }
});
$('m-sent').addEventListener('click', async () => { await act(cur.job.id, 'enviada'); closeModal(); });

/* ---------- configurações ---------- */
function field(label, input) { return h('div', { class: 'field' }, h('label', {}, label), input); }
function text(id, value, attrs) { return h('input', { id, value: value || '', ...attrs }); }
function fileRow(kind, label) {
  const name = h('span', {}, cfg.files[kind] ? baseName(cfg.files[kind]) : 'nenhum arquivo escolhido');
  return field(label, h('div', { class: 'filebtn' }, h('button', { onclick: async () => { const p = await window.jh.pickFile(kind).catch(fail); if (p) { cfg.files[kind] = p; name.textContent = baseName(p); } } }, 'Escolher PDF…'), name));
}
const lines = (a) => (a || []).join('\n');

async function renderConfig() {
  cfg = await window.jh.getConfig();
  const p = cfg.profile;
  $('f-profile').replaceChildren(
    field('Nome', text('p-name', p.name)), field('E-mail', text('p-email', p.email)), field('Telefone', text('p-phone', p.phone)), field('Site do portfólio', text('p-site', p.site)),
    field('Cidade (português)', text('p-city-pt', p.city.pt)), field('Cidade (inglês)', text('p-city-en', p.city.en)),
    field('Disponibilidade (português)', text('p-av-pt', p.availability.pt)), field('Disponibilidade (inglês)', text('p-av-en', p.availability.en)));
  $('f-files').replaceChildren(fileRow('cvPt', 'Currículo em português'), fileRow('cvEn', 'Currículo em inglês'), fileRow('portfolio', 'Portfólio (PDF)'));
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
  $('f-adzuna').replaceChildren(field('App ID', text('a-id', cfg.adzuna.appId)), field('App Key', text('a-key', cfg.adzuna.appKey, { type: 'password', autocomplete: 'off' })));
}
const split = (id) => $(id).value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

async function save() {
  const secret = $('g-secret').value;
  cfg = await window.jh.setConfig({
    profile: { name: $('p-name').value, email: $('p-email').value, phone: $('p-phone').value, site: $('p-site').value, city: { pt: $('p-city-pt').value, en: $('p-city-en').value }, availability: { pt: $('p-av-pt').value, en: $('p-av-en').value } },
    files: cfg.files,
    google: { clientId: $('g-id').value.trim() },
    googleClientSecret: secret || undefined,
    companies: { greenhouse: split('c-gh'), lever: split('c-lever'), ashby: split('c-ashby'), workable: split('c-wk') },
    adzuna: { appId: $('a-id').value.trim(), appKey: $('a-key').value.trim() },
  });
  $('saved').textContent = 'Salvo.';
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
}

/* ---------- navegação ---------- */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', async () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
  $('view-vagas').hidden = t.dataset.view !== 'vagas';
  $('view-config').hidden = t.dataset.view !== 'config';
  if (t.dataset.view === 'config') await renderConfig(); else await refresh();
}));
$('save').addEventListener('click', () => save().catch(fail));
$('scan').addEventListener('click', runScan);
$('alerts').addEventListener('click', runAlerts);
for (const s of Object.keys(STATUS_LABEL)) $('st').append(h('option', { value: s }, STATUS_LABEL[s]));
['q', 'reg', 'st', 'fit'].forEach((id) => $(id).addEventListener('input', () => refresh().catch(fail)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

refresh().catch(fail);
