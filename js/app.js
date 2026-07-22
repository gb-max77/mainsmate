// ── MainsMate ── one module, no build step. Data in, reader out.
import { speech, SPEEDS } from './tts.js';
const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
// **gold** spans are the load-bearing keywords — they drive Cloze masking too.
const md = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<i>$2</i>');

const EXAM = { essay: '2026-08-21', gs1: '2026-08-22', gs2: '2026-08-22', gs3: '2026-08-23', gs4: '2026-08-23', pubad1: '2026-08-30', pubad2: '2026-08-30' };
// The order you revise in, not the order UPSC sits them.
const ORDER = ['gs1', 'gs3', 'pubad1', 'pubad2', 'gs2', 'gs4', 'essay'];

const store = {
  get k() { return 'mm-progress'; },
  data: JSON.parse(localStorage.getItem('mm-progress') || '{}'),
  save() { localStorage.setItem(this.k, JSON.stringify(this.data)); },
  rec(qid) { return this.data[qid] || null; },
  isDone(qid) { return !!this.data[qid]?.done; },
  toggleDone(qid) {
    const e = this.data[qid] = this.data[qid] || {};
    e.done = !e.done;
    if (e.done) e.doneAt = Date.now(); else delete e.doneAt;
    if (!e.done && !e.r) delete this.data[qid];       // no state left worth keeping
    this.save();
    return !!e.done;
  },
  // SRS: Blank→1d, Shaky→3d, Confident→10d. Deliberately coarse — this is a 5-week run-in, not Anki.
  mark(qid, r) {
    // clicking the already-selected rating clears it — a question can go back to unmarked
    if (this.data[qid]?.r === r) {
      const e = this.data[qid];
      delete e.r; delete e.due; delete e.seen;
      if (!e.done) delete this.data[qid];
      this.save();
      return null;
    }
    const days = { 1: 1, 2: 3, 3: 10 }[r];
    const e = this.data[qid] = this.data[qid] || {};
    Object.assign(e, { r, seen: Date.now(), due: Date.now() + days * 864e5 });
    this.save();
    return r;
  }
};

let PAPERS = [], ANSWERS = {}, cur = null, mode = 'full', stepOn = false, stepIdx = -1;
let branchesOn = (localStorage.getItem('mm-branches') ?? '1') === '1';

const paperOf = id => PAPERS.find(p => p.id === id);
const qidOf = (pid, n, b) => b == null ? `${pid}-${n}` : `${pid}-${n}-b${b}`;

async function loadAnswers(pid) {
  if (ANSWERS[pid]) return ANSWERS[pid];
  try {
    const r = await fetch(`data/answers/${pid}.json`, { cache: 'no-cache' });
    ANSWERS[pid] = r.ok ? await r.json() : {};
  } catch { ANSWERS[pid] = {}; }
  return ANSWERS[pid];
}

// flatten a paper into renderable rows (main question, then its branches)
function rows(p, mainOnly) {
  const out = [];
  for (const s of p.sections) for (const q of s.qs) {
    out.push({ ...q, sec: s.t, qid: qidOf(p.id, q.n), pid: p.id });
    if (mainOnly) continue;
    (q.branches || []).forEach((b, i) => out.push({
      ...b, sec: s.t, qid: qidOf(p.id, q.n, i), pid: p.id, isBranch: true, parent: qidOf(p.id, q.n), parentQ: q.q
    }));
  }
  return out;
}

/* ══════════════════ HOME ══════════════════ */
function renderHome() {
  const d = Math.ceil((new Date('2026-08-21') - Date.now()) / 864e5);
  $('#countdown').innerHTML = `<b>${d > 0 ? d : 0}</b><span>days to Essay paper · 21 Aug 2026</span>`;

  const wrap = $('#papers'); wrap.innerHTML = '';
  for (const pid of ORDER) {
    const p = paperOf(pid); if (!p) continue;
    const all = rows(p);
    const done = all.filter(r => ANSWERS[pid]?.[r.qid]).length;          // answer available
    const rev = all.filter(r => store.isDone(r.qid)).length;              // marked completed
    const pctD = all.length ? Math.round(done / all.length * 100) : 0;
    const pctR = all.length ? Math.round(rev / all.length * 100) : 0;
    const b = el('button', 'paper');
    b.innerHTML = `<span class="ic">${p.icon}</span>
      <span class="nm"><b>${esc(p.short)} — ${esc(p.title.replace(/^.*?—\s*/, ''))}</b>
      <small>${all.length} questions · ${new Date(EXAM[pid]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></span>
      <span class="rings">
        <span class="ring ans" style="--p:${pctD}" title="${done} of ${all.length} have a model answer"><i>${done}</i></span>
        <span class="ring rev" style="--p:${pctR}" title="${rev} of ${all.length} marked completed"><i>${rev}</i></span>
      </span>`;
    b.onclick = () => go(`#/p/${pid}`);
    wrap.append(b);
  }

  notesIndex().then(bs => {
    const ch = bs.reduce((s, b) => s + b.chapters.length, 0);
    const w = bs.reduce((s, b) => s + b.chapters.reduce((t, c) => t + c.w, 0), 0);
    $('#notes-sub').textContent = `${bs.length} books · ${ch} chapters · ${(w / 1000).toFixed(0)}k words`;
  });

  const due = [];
  for (const p of PAPERS) for (const r of rows(p)) {
    const rc = store.rec(r.qid);
    if (rc && rc.due < Date.now() && ANSWERS[p.id]?.[r.qid]) due.push(r);
  }
  $('#due-wrap').hidden = !due.length;
  if (due.length) {
    const L = $('#due-list'); L.innerHTML = '';
    due.slice(0, 12).forEach(r => L.append(qRow(r)));
  }
}

/* ══════════════════ LIST ══════════════════ */
const isThin = (a, r) => writtenWords(a) < (r.wmin || 0) || (a.body || []).length < 2;

let filt = { tier: 'all', q: '', theme: 'all', pid: null };

function qRow(r) {
  const a = ANSWERS[r.pid]?.[r.qid], rc = store.rec(r.qid);
  const b = el('button', `qrow tier${r.tier || 3}${r.isBranch ? ' branch' : ''}`);
  const rcTxt = rc ? `<span class="rc${rc.r}">${['', '● Blank', '● Shaky', '● Confident'][rc.r]}</span>` : '';
  b.innerHTML = `<span class="meta">
      ${r.tier ? `<span class="tag t${r.tier}">T${r.tier}</span>` : ''}
      <span>${r.m}M · ${r.w}w</span>
      ${r.isBranch ? '<span>↳ branch</span>' : ''}
      ${a ? '<span class="ok">✓ written</span>' : ''}
      ${store.isDone(r.qid) ? '<span class="cm">◉ completed</span>' : ''}
      ${rcTxt}</span><p><span class="qn">Q${r.n}.</span> ${esc(r.q)}</p>`;
  b.onclick = () => go(`#/a/${r.qid}`);
  if (r.isBranch || !r.branches?.length) return b;

  // Branches stay attached to their parent in the list: one chip, expanding in place.
  const wrap = el('div', 'qgroup');
  const bar = el('button', 'btoggle');
  const done = r.branches.filter((_, i) => ANSWERS[r.pid]?.[qidOf(r.pid, r.n, i)]).length;
  const more = r.branches.length - 1;
  bar.innerHTML = `<span class="caret">▸</span>
    <span class="btopic">↳ ${esc(topicOf(r.branches[0].q))}${more ? ` &nbsp;+${more} more` : ''}</span>
    <span class="bmeta">${done}/${r.branches.length} written</span>`;
  const box = el('div', 'bbox'); box.hidden = true;
  bar.onclick = () => {
    const open = box.hidden;
    if (open && !box.dataset.filled) {
      r.branches.forEach((br, i) => {
        const id = qidOf(r.pid, r.n, i);
        box.append(branchItem(id, br, ANSWERS[r.pid]?.[id]));
      });
      box.dataset.filled = '1';
    }
    box.hidden = !open;
    wrap.classList.toggle('open', open);
  };
  wrap.append(b, bar, box);
  return wrap;
}

// Each chip advertises how many questions it would leave — so you can see a
// filter is worth applying before applying it.
function paintChipCounts(p) {
  const all = rows(p, true);
  const inTheme = r => filt.theme === 'all' || r.sec === filt.theme;
  const n = {
    all: all.filter(inTheme).length,
    1: 0, 2: 0, 3: 0, todo: 0, thin: 0, weak: 0,
  };
  for (const r of all) {
    if (!inTheme(r)) continue;
    if (r.tier) n[r.tier]++;
    const a = ANSWERS[p.id]?.[r.qid];
    if (!a) n.todo++; else if (isThin(a, r)) n.thin++;
    const rc = store.rec(r.qid);
    if (rc && rc.r <= 2) n.weak++;
  }
  for (const c of $('#tier-chips').querySelectorAll('.chip')) {
    const k = c.dataset.tier;
    c.querySelector('.cnt')?.remove();
    const s = document.createElement('span');
    s.className = 'cnt';
    s.textContent = ` (${n[k] ?? 0})`;
    c.append(s);
    c.disabled = (n[k] ?? 0) === 0 && k !== 'all';
  }
}

function renderList() {
  const p = paperOf(filt.pid); if (!p) return go('#/');
  $('#list-title').textContent = `${p.icon} ${p.title}`;

  const sel = $('#theme-sel');
  if (sel.dataset.pid !== p.id) {
    sel.dataset.pid = p.id;
    sel.innerHTML = `<option value="all">All themes (${rows(p, true).length})</option>` +
      p.sections.map(s => `<option value="${esc(s.t)}">${esc(s.t)} (${s.qs.length})</option>`).join('');
    sel.value = 'all'; filt.theme = 'all';
  }

  const needle = filt.q.toLowerCase();
  const list = rows(p, true).filter(r => {
    if (filt.theme !== 'all' && r.sec !== filt.theme) return false;
    const ans = ANSWERS[p.id]?.[r.qid];
    if (filt.tier === 'todo') { if (ans) return false; }
    else if (filt.tier === 'thin') { if (!ans || !isThin(ans, r)) return false; }
    else if (filt.tier === 'weak') { const rc = store.rec(r.qid); if (!rc || rc.r > 2) return false; }
    else if (filt.tier !== 'all' && String(r.tier) !== filt.tier) return false;
    if (needle) {
      const hay = (r.q + ' ' + (ANSWERS[p.id]?.[r.qid]?.flash || []).join(' ')).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  paintChipCounts(p);
  const L = $('#q-list'); L.innerHTML = '';
  if (!list.length) { L.append(el('div', 'empty', 'No questions match these filters.')); return; }
  let sec = null;
  for (const r of list) {
    if (r.sec !== sec) { sec = r.sec; L.append(el('div', 'sec-h', esc(sec))); }
    L.append(qRow(r));
  }
}

// A branch's gist: first clause, trimmed — enough to recognise the angle at a glance.
function topicOf(q) {
  let t = String(q).replace(/\*/g, '').split(/[;—]|\s+with reference to\s+/i)[0].trim();
  return t.length > 72 ? t.slice(0, 69).replace(/\s+\S*$/, '') + '…' : t;
}

/* ══════════════════ ANSWER ══════════════════ */
function findRow(qid) {
  const pid = qid.split('-')[0];
  const p = paperOf(pid); if (!p) return null;
  return rows(p).find(r => r.qid === qid) || null;
}

// Cloze masks the gold spans — tap to reveal one, or hit the reveal-all action.
const clozed = h => h.replace(/<b>(.+?)<\/b>/g, '<b class="cz">$1</b>');

function pointHTML(pt) {
  let h = '';
  if (pt.k) h += `<b class="lbl">${md(pt.k)}</b>: `;
  h += `<span class="x">${md(pt.x)}</span>`;
  if (pt.ex) h += ` <span class="ex"><b class="lbl">Ex:</b> ${md(pt.ex)}</span>`;
  return h;
}

// Words you'd actually put on paper: ONE intro + headings + points + wf + conclusion.
// Mirrors scripts/add.py written_words() — keep the two in step.
function writtenWords(a) {
  const parts = [];
  if (a.intro?.length) parts.push(a.intro[0].x);
  for (const b of a.body || []) {
    parts.push(b.h || '');
    for (const p of b.p || []) parts.push(p.k || '', p.x || '', p.ex || '');
  }
  parts.push(...(a.wf || []), a.conc || '');
  return parts.join(' ').replace(/\*\*|[•·—–]/g, ' ').split(/\s+/).filter(Boolean).length;
}

function diagHTML(d) {
  if (!d) return '';
  const parts = String(d.d).split(/\s*(?:→|->)\s*/);
  const body = parts.length > 1
    ? `<div class="flow">${parts.map(x => `<span class="node">${esc(x)}</span>`).join('<span class="arw">→</span>')}</div>`
    : `<div>${esc(d.d)}</div>`;
  return `<div class="diag"><div class="lbl">Diagram · ${esc(d.k)} · drawable in 30s</div>${body}</div>`;
}

// Each paper is marked on different things, so the regeneration prompt differs.
// Keep these short — an over-specified prompt produces a worse answer, not a better one.
const PAPER_BRIEF = {
  essay: r => `Write a UPSC CSE Mains 2026 essay (1000-1200 words) on: "${r.q}".
Philosophical and multidimensional. Open with an anecdote, parable or paradox; build a clear thesis; develop 6-8 dimensions (historical, social, economic, political, ethical, technological, global); illustrate each with real examples and thinkers; give the counter-view its due; close by returning to the opening image with a forward-looking vision. Flowing prose, no bullet points or headings-as-lists. Reflective, balanced, never partisan.`,

  pubad1: r => `Write a UPSC Public Administration Paper I (Administrative Theory) answer, ${r.m} marks, ${r.wmin}-${r.w} words, at top-100 optional standard: "${r.q}".
Answer IN the discipline's vocabulary. Open with a thinker or paradigm, not a general definition. Name theorists and their works and dates. Organise under 2-3 bold sub-headings with bullet points. Bridge every theory to ONE concrete Indian administrative example. Scholarly critique is mandatory — who challenged this, in which work. Close with a one-line analytical verdict.`,

  pubad2: r => `Write a UPSC Public Administration Paper II (Indian Administration) answer, ${r.m} marks, ${r.wmin}-${r.w} words, at top-100 optional standard: "${r.q}".
Anchor in constitutional provisions, committee and commission reports (2nd ARC first), and current administrative developments. Interlink at least one Paper-I theory or thinker — that linkage is the scoring differentiator. Organise under 2-3 bold sub-headings with bullet points. Keep it in the administrative lane, not the political one. Close with a reform-oriented line.`,

  gs: r => `Write a UPSC CSE Mains 2026 model answer, ${r.m} marks, ${r.wmin}-${r.w} words, as an AIR top-20 candidate would write it in the exam: "${r.q}".
Format: 1-2 line intro (definition, data, judgment or report as the demand fits); then 2-3 headed body sections; under each, 3-4 points as "Bold point heading: one-line expansion. Ex: named example, data, committee, report, Article or judgment"; then a Way Forward line; then one forward-looking conclusion tied to a constitutional value or national goal. Maximise keywords. No repetition, no generic filler. Every named fact must be real and verifiable.`
};

function gaiURL(r) {
  const brief = (PAPER_BRIEF[r.pid] || PAPER_BRIEF.gs)(r);
  return 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(brief);
}

// The answer body as a string, so the same renderer serves the full page and the
// inline branch panels — one source of truth for how an answer looks.
function answerHTML(a) {
  let h = '';
  for (const i of a.intro || []) h += `<p class="intro"><b class="lbl">Intro (${esc(i.t)}):</b> ${md(i.x)}</p>`;
  (a.body || []).forEach((bd, bi) => {
    h += `<div class="bh">H${bi + 1} — ${md(bd.h)}</div>`;
    for (const pt of bd.p || []) h += `<p class="pt${pt.unv ? ' unv' : ''}">${pointHTML(pt)}</p>`;
  });
  if (a.diag) h += diagHTML(a.diag);
  if (a.wf?.length) h += `<p class="wf"><b class="lbl">Way Forward:</b> ${a.wf.map(md).join(' · ')}</p>`;
  if (a.mne) h += `<p class="wf"><b class="lbl">Mnemonic:</b> ${md(a.mne)}</p>`;
  if (a.conc) h += `<p class="conc">Conclusion: ${md(a.conc)}</p>`;
  return h;
}

const noAnswerHTML = r => `<div class="nowrite"><p>No model answer written for this question yet.</p>
  <small>Tier ${r.tier || '—'} · generate one in Google AI Mode below, pre-loaded with the paper's answer brief.</small></div>`;

// A collapsed branch: question line + toggle. Expanding reveals the answer in place.
function branchItem(id, b, ans) {
  const it = el('div', 'bitem');
  const head = el('button', 'bhead');
  head.innerHTML = `<span class="caret">▸</span><span class="btxt">↳ ${esc(b.q)}</span>
    <span class="bmeta">${b.m}M${ans ? ' <i class="ok">✓</i>' : ''}</span>`;
  const body = el('div', 'bbody');
  body.hidden = true;
  head.onclick = () => {
    const open = body.hidden;
    if (open && !body.dataset.filled) {
      body.innerHTML = (ans ? answerHTML(ans) : noAnswerHTML(b))
        + `<a class="bopen" href="#/a/${id}">Open full ↗</a>`;
      body.dataset.filled = '1';
    }
    body.hidden = !open;
    it.classList.toggle('open', open);
    if (open && mode === 'cloze') applyCloze(body);
  };
  it.append(head, body);
  return it;
}

async function renderAnswer(qid) {
  const pid = qid.split('-')[0];
  await loadAnswers(pid);
  const r = findRow(qid); if (!r) return go('#/');
  cur = r; stepIdx = -1; stepOn = false; $('#btn-step').classList.remove('on');
  const a = ANSWERS[pid]?.[qid];
  const A = $('#answer'); A.innerHTML = '';

  const p = paperOf(pid);
  A.append(el('h1', 'qtitle', esc(r.q)));
  const rc = store.rec(qid);
  let wc = '';
  if (a) {
    const w = writtenWords(a), lo = r.wmin || 0;
    // below the floor = marks left on the table; above the ceiling = can't be written in time
    const cls = w > r.w * 1.05 ? 'over' : (w < lo ? 'thin' : 'ok');
    const note = { over: ' — trim', thin: ' — under limit', ok: '' }[cls];
    wc = ` · <span class="wc ${cls}">${w} / ${lo}-${r.w}w${note}</span>`;
  }
  A.append(el('div', 'qmeta',
    `${p.short} · ${r.sec} ${r.tier ? `· T${r.tier}` : ''} · ${r.m} marks · ${Math.round(r.m * 0.72)} min`
    + (r.isBranch ? ` · ↳ branch of Q${r.parent.split('-')[1]}` : '')
    + wc
    + (rc ? ` · last recall: ${['', 'Blank', 'Shaky', 'Confident'][rc.r]}` : '')));

  A.insertAdjacentHTML('beforeend',
    `<div class="abox">${a ? answerHTML(a) : noAnswerHTML(r)}</div>`);

  // Branches ride on the same prepared content, so they live WITH the parent rather
  // than as separate destinations — each expands inline instead of navigating away.
  const parent = r.isBranch ? findRow(r.parent) : r;
  if (branchesOn && parent?.branches?.length) {
    const bx = el('div', 'branches',
      `<h3>Branch angles — ${esc(topicOf(parent.q))}</h3>`);
    if (r.isBranch) {
      const l = el('a', 'bmain', `🌳 Main question: ${esc(r.parentQ)}`);
      l.href = `#/a/${r.parent}`; bx.append(l);
    }
    parent.branches.forEach((b, i) => {
      const id = qidOf(pid, parent.n, i);
      if (id === qid) return;
      bx.append(branchItem(id, b, ANSWERS[pid]?.[id]));
    });
    A.append(bx);
  }

  const acts = el('div', 'actions');
  const gai = el('button', 'act gai', '⟳ Regenerate in Google AI Mode');
  gai.onclick = () => window.open(gaiURL(r), '_blank', 'noopener');
  const rev = el('button', 'act', '👁 Reveal all cloze');
  rev.onclick = () => A.querySelectorAll('.cz').forEach(c => c.classList.add('show'));
  const pr = el('button', 'act', '🖨 Print / PDF');
  pr.onclick = () => window.print();
  const cp = el('button', 'act', '⧉ Copy answer');
  cp.onclick = () => { navigator.clipboard.writeText(A.innerText); cp.textContent = '✓ Copied'; setTimeout(() => cp.textContent = '⧉ Copy answer', 1400); };
  acts.append(gai, rev, cp, pr);
  A.append(acts);

  paintRecall(qid);
  paintDone(qid);
  renderPager(r);
  renderSidebar(r);
  applyMode();
  paintBranchesBtn();
  syncReadAlong(r);
  window.scrollTo(0, 0);
}

function paintBranchesBtn() {
  $('#btn-branches').classList.toggle('on', branchesOn);
  $('#btn-branches').textContent = branchesOn ? 'Branches On' : 'Branches Off';
}

function applyCloze(root) {
  root.querySelectorAll('.pt, .intro, .conc, .wf').forEach(n => { n.innerHTML = clozed(n.innerHTML); });
  root.querySelectorAll('.cz').forEach(c => c.onclick = () => c.classList.toggle('show'));
}

function applyMode() {
  document.body.dataset.mode = mode;
  const A = $('#answer');
  // removeAttribute, not className='' — a leftover class="" stops clozed()'s <b> regex matching on re-entry
  A.querySelectorAll('b.cz').forEach(c => c.removeAttribute('class'));
  if (mode === 'cloze') applyCloze(A);
}

function step(dir) {
  const pts = [...$('#answer').querySelectorAll('.pt')];
  if (!pts.length) return;
  pts.forEach(p => p.classList.remove('focus'));
  stepIdx = Math.max(0, Math.min(pts.length - 1, stepIdx + dir));
  const n = pts[stepIdx];
  n.classList.add('focus');
  n.scrollIntoView({ block: 'center' }); // instant — smooth scrolling breaks the in-app browser
}

/* ══════════════════ READ ALONG ══════════════════ */
// Reads an entire paper aloud, question by question, using the same line-based
// TTS engine as the audiobook feature. Lines are pulled straight from the
// rendered #answer DOM (not re-derived from JSON) so highlighting can never
// drift from what applyMode()/applyCloze() actually put on screen.
let raOn = false, raQueue = [], raIdx = -1, raNavigating = false;
const WPM_BASE = 155; // baseline words/min at 1x — only used for the paper ETA estimate

const raBuildQueue = pid => { const p = paperOf(pid); return p ? rows(p, !branchesOn) : []; };
const raLines = () => [...$('#answer').querySelectorAll('.intro, .bh, .pt, .wf, .conc')];
const raWordsFor = r => { const a = ANSWERS[r.pid]?.[r.qid]; return a ? writtenWords(a) : 0; };

function raClearHighlight() {
  $('#answer').querySelectorAll('.ra-active').forEach(n => n.classList.remove('ra-active'));
}
function raHighlight(idx) {
  raClearHighlight();
  const n = raLines()[idx];
  if (!n) return;
  n.classList.add('ra-active');
  n.scrollIntoView({ block: 'center' }); // instant — smooth scrolling breaks the in-app browser
}

function raETA() {
  if (raIdx < 0) return 0;
  const wordsLeft = raWordsFor(raQueue[raIdx]) + raQueue.slice(raIdx + 1).reduce((s, r) => s + raWordsFor(r), 0);
  return wordsLeft / (WPM_BASE * speech.rate); // minutes
}
function fmtHMS(mins) {
  let s = Math.max(0, Math.round(mins * 60));
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function raPaintBar() {
  const bar = $('#ra-bar'); bar.hidden = !raOn;
  if (!raOn || raIdx < 0) return;
  const r = raQueue[raIdx];
  $('#ra-status').innerHTML = `<span class="ra-dot"></span>Reading ${raIdx + 1} of ${raQueue.length} · ${esc(r.qid.toUpperCase())}`;
  $('#ra-fill').style.width = `${Math.round((raIdx / Math.max(1, raQueue.length)) * 100)}%`;
  $('#ra-eta').textContent = fmtHMS(raETA());
  $('#ra-pause').textContent = speech.playing ? 'Pause' : 'Resume';
}

async function raStartSpeakingCurrent() {
  await new Promise(res => setTimeout(res, 30)); // let renderAnswer's DOM settle
  const texts = raLines().map(n => n.innerText || n.textContent || '');
  speech.load(texts, 0);
  raPaintBar();
  speech.play();
}

function raPlayIdx(i) {
  if (i < 0 || i >= raQueue.length) { raStop(); return; }
  raIdx = i;
  const targetHash = `#/a/${raQueue[i].qid}`;
  if (location.hash !== targetHash) { raNavigating = true; go(targetHash); raNavigating = false; }
  else raStartSpeakingCurrent();
}

speech.onLine = idx => { if (raOn) raHighlight(idx); };
speech.onState = () => raPaintBar();
speech.onFinish = () => { if (raOn) raPlayIdx(raIdx + 1); };

function raStart() {
  if (!speech.supported) { alert('Read Along needs a browser with speech-synthesis support.'); return; }
  if (!cur) return;
  raOn = true;
  $('#btn-ra').classList.add('on');
  raQueue = raBuildQueue(cur.pid);
  const base = cur.isBranch ? cur.parent : cur.qid;
  const i = raQueue.findIndex(r => r.qid === base);
  raPlayIdx(i < 0 ? 0 : i);
}

function raStop() {
  raOn = false; raIdx = -1;
  speech.stop();
  $('#btn-ra').classList.remove('on');
  $('#ra-bar').hidden = true;
  raClearHighlight();
}

// Runs every time renderAnswer() paints, so Read Along stays correct whether the
// page changed because RA advanced itself or because the user tapped elsewhere.
function syncReadAlong(r) {
  if (!raOn || raNavigating) return;
  const q = raQueue[raIdx];
  if (q && q.qid === r.qid) { raPaintBar(); return; }
  const i = raQueue.findIndex(x => x.qid === r.qid);
  if (i < 0) { raStop(); return; }
  raIdx = i;
  raStartSpeakingCurrent();
}

function raPopulateSettings() {
  const rateSel = $('#ra-rate');
  if (!rateSel.dataset.filled) {
    rateSel.innerHTML = SPEEDS.map(s => `<option value="${s}">${s}×</option>`).join('');
    rateSel.value = speech.rate;
    rateSel.dataset.filled = '1';
    rateSel.onchange = () => { speech.setRate(parseFloat(rateSel.value)); raPaintBar(); };
  }
  const voiceSel = $('#ra-voice');
  const voices = speech.voices();
  if (voices.length && voiceSel.options.length <= 1) {
    voiceSel.innerHTML = `<option value="">Auto</option>` +
      voices.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    voiceSel.value = speech.voiceURI || '';
    voiceSel.onchange = () => speech.setVoice(voiceSel.value);
  }
}

/* ══════════════════ NOTES ══════════════════ */
let NOTES = null, BOOK = {};

async function notesIndex() {
  if (!NOTES) {
    try { NOTES = await (await fetch('data/notes/index.json', { cache: 'no-cache' })).json(); }
    catch { NOTES = []; }
  }
  return NOTES;
}
async function loadBook(id) {
  if (!BOOK[id]) BOOK[id] = await (await fetch(`data/notes/${id}.json`, { cache: 'no-cache' })).json();
  return BOOK[id];
}

const PAPER_NAME = { gs1: 'GS-1', gs2: 'GS-2', gs3: 'GS-3', gs4: 'GS-4' };

async function renderNotes() {
  const books = await notesIndex();
  const L = $('#n-books'); L.innerHTML = '';
  let paper = null;
  for (const b of books) {
    if (b.paper !== paper) {
      paper = b.paper;
      L.append(el('div', 'sec-h', `${PAPER_NAME[paper] || paper} — source notes`));
    }
    const words = b.chapters.reduce((s, c) => s + c.w, 0);
    const btn = el('button', 'paper');
    btn.innerHTML = `<span class="ic">${b.icon}</span>
      <span class="nm"><b>${esc(b.title)}</b>
      <small>📄 full PDF · ${b.chapters.length} chapters · ${(words / 1000).toFixed(0)}k words</small></span>
      <span class="arw">›</span>`;
    btn.onclick = () => go(`#/n/${b.id}`);
    L.append(btn);
  }
}

// The book opens on the original PDF — continuous scroll in the browser's own
// viewer — with the text extraction as the alternative view.
let bookSrc = 'pdf';

function paintBookSrc(b) {
  $('#book-pdf').hidden = bookSrc !== 'pdf';
  $('#book-chapters').hidden = bookSrc !== 'text';
  for (const t of document.querySelectorAll('.srcmode')) t.classList.toggle('active', t.dataset.src === bookSrc);
  const P = $('#book-pdf');
  if (bookSrc === 'pdf' && !P.dataset.for) {
    P.dataset.for = b.id;
    P.innerHTML = `<iframe src="${b.pdf}#view=FitH" title="${esc(b.title)}"></iframe>`;
  }
}

async function renderBook(id) {
  const b = await loadBook(id);
  $('#book-title').textContent = `${b.icon} ${b.title}`;
  const P = $('#book-pdf');
  if (P.dataset.for !== b.id) { P.dataset.for = ''; P.innerHTML = ''; }
  $('#book-dl').href = b.pdf;
  $('#book-dl').setAttribute('download', b.title + '.pdf');
  paintBookSrc(b);
  document.querySelectorAll('.srcmode').forEach(t => t.onclick = () => {
    bookSrc = t.dataset.src; paintBookSrc(b);
  });
  const L = $('#book-chapters'); L.innerHTML = '';
  let part = undefined;
  b.chapters.forEach((c, i) => {
    if (c.part !== part) { part = c.part; if (part) L.append(el('div', 'sec-h', esc(part))); }
    const btn = el('button', 'qrow tier3');
    btn.innerHTML = `<span class="meta"><span>${len2k(c.text)} words</span>
        ${c.pyq?.length ? `<span class="ok">${c.pyq.length} PYQ</span>` : ''}</span>
      <p><span class="qn">${c.n}.</span> ${esc(c.t)}</p>`;
    btn.onclick = () => go(`#/n/${id}/${i}`);
    L.append(btn);
  });
}

const len2k = t => t.split(/\s+/).length;

async function renderChapter(id, i) {
  const b = await loadBook(id);
  const c = b.chapters[+i]; if (!c) return go(`#/n/${id}`);
  $('#ch-title').textContent = `${c.n}. ${c.t}`;
  $('#ch-meta').textContent = `${b.title}${c.part ? ' · ' + c.part : ''} · ${len2k(c.text)} words · p.${c.p}`;
  const P = $('#ch-pyq'); P.innerHTML = '';
  if (c.pyq?.length) {
    P.innerHTML = `<h3>Asked before</h3>` +
      c.pyq.map(q => `<p class="pyq">${esc(q)}</p>`).join('');
  }
  const O = $('#ch-outline'); O.innerHTML = '';
  if (c.subs?.length) O.innerHTML = `<h3>In this chapter</h3><div class="subs">` +
    c.subs.map(x => `<span>${esc(x)}</span>`).join('') + `</div>`;
  const J = $('#ch-pdf');
  if (b.pdf && c.p) { J.hidden = false; J.href = `${b.pdf}#page=${c.p}`; J.target = '_blank'; }
  else J.hidden = true;
  $('#ch-text').textContent = c.text;
  window.scrollTo(0, 0);
}

// Search runs across every book; we load them lazily and cache.
async function searchNotes(q) {
  const R = $('#n-results');
  if (q.length < 3) { R.hidden = true; $('#n-books').hidden = false; return; }
  R.hidden = false; $('#n-books').hidden = true;
  R.innerHTML = '<div class="empty">Searching…</div>';
  const books = await notesIndex();
  const needle = q.toLowerCase(), hits = [];
  for (const b of books) {
    const full = await loadBook(b.id);
    full.chapters.forEach((c, i) => {
      const at = c.text.toLowerCase().indexOf(needle);
      if (at < 0) return;
      const from = Math.max(0, at - 90);
      hits.push({ b, c, i, snip: c.text.slice(from, at + 190).replace(/\s+/g, ' ') });
    });
  }
  R.innerHTML = '';
  if (!hits.length) { R.append(el('div', 'empty', 'No matches.')); return; }
  R.append(el('div', 'sec-h', `${hits.length} chapter${hits.length > 1 ? 's' : ''} mention "${esc(q)}"`));
  for (const h of hits.slice(0, 40)) {
    const btn = el('button', 'qrow tier3');
    const snip = esc(h.snip).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
    btn.innerHTML = `<span class="meta"><span>${h.b.icon} ${esc(h.b.title)}</span></span>
      <p><span class="qn">${h.c.n}.</span> ${esc(h.c.t)}</p><small class="snip">…${snip}…</small>`;
    btn.onclick = () => go(`#/n/${h.b.id}/${h.i}`);
    R.append(btn);
  }
}

/* ══════════════════ PAGER + SIDEBAR ══════════════════ */
// Both walk the same ordered list of main questions, so "next" in the pager and
// the sidebar's order can never disagree.
const mainRows = pid => { const p = paperOf(pid); return p ? rows(p, true) : []; };

function renderPager(r) {
  const list = mainRows(r.pid);
  const base = r.isBranch ? r.parent : r.qid;
  const i = list.findIndex(x => x.qid === base);
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  const label = i >= 0 ? `Q${list[i].n} · ${i + 1} of ${list.length}` : '';
  // top and bottom pagers are identical, so drive both from one loop
  for (const nav of document.querySelectorAll('.pager')) {
    nav.querySelector('.pg-pos').textContent = label;
    for (const btn of nav.querySelectorAll('.pg')) {
      const tgt = btn.dataset.nav === 'prev' ? prev : next;
      btn.disabled = !tgt;
      btn.title = tgt ? tgt.q.slice(0, 90) : '';
      btn.onclick = tgt ? () => go(`#/a/${tgt.qid}`) : null;
    }
  }
}

function paintDone(qid) {
  const done = store.isDone(qid);
  const b = $('#btn-done');
  b.classList.toggle('on', done);
  b.textContent = done ? '✓ Completed — tap to undo' : 'Mark as completed';
}

function renderSidebar(r) {
  const L = $('#sb-list'); L.innerHTML = '';
  const base = r.isBranch ? r.parent : r.qid;
  let sec = null;
  for (const q of mainRows(r.pid)) {
    if (q.sec !== sec) { sec = q.sec; L.append(el('div', 'sb-sec', esc(sec))); }
    const a = ANSWERS[r.pid]?.[q.qid];
    const b = el('button', 'sb-q' + (q.qid === base ? ' on' : '') + (a ? '' : ' todo') + (store.isDone(q.qid) ? ' done' : ''));
    b.innerHTML = `<span class="sb-n">Q${q.n}</span><span class="sb-t">${esc(q.q)}</span>`;
    b.onclick = () => { go(`#/a/${q.qid}`); document.body.classList.remove('sb-open'); };
    L.append(b);
  }
  const on = L.querySelector('.sb-q.on');
  if (on) on.scrollIntoView({ block: 'center' });   // instant — smooth breaks the in-app browser
}

/* ══════════════════ ROUTER ══════════════════ */
function go(hash) { location.hash = hash; }

async function route() {
  const h = location.hash || '#/';
  const [, kind, arg] = h.split('/');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.body.dataset.mode = 'full';
  document.body.classList.remove('sb-open');
  $('#back').hidden = h === '#/';
  $('#btn-sb').hidden = kind !== 'a';
  if (kind !== 'a' && raOn) raStop();

  if (kind === 'n') {
    const [, , bookId, chIdx] = h.split('/');
    if (bookId && chIdx !== undefined) { $('#view-chapter').classList.add('active'); await renderChapter(bookId, chIdx); }
    else if (bookId) { $('#view-book').classList.add('active'); await renderBook(bookId); }
    else { $('#view-notes').classList.add('active'); await renderNotes(); }
  } else if (kind === 'p' && arg) {
    filt.pid = arg; filt.q = ''; $('#q-search').value = '';
    await loadAnswers(arg);
    $('#view-list').classList.add('active'); renderList();
  } else if (kind === 'a' && arg) {
    $('#view-answer').classList.add('active'); await renderAnswer(arg);
  } else {
    $('#view-home').classList.add('active');
    await Promise.all(ORDER.map(loadAnswers));
    renderHome();
  }
}

/* ══════════════════ WIRING ══════════════════ */
$('#back').onclick = () => history.back();
$('#go-notes').onclick = () => go('#/n');
$('#btn-done').onclick = () => { if (cur) { store.toggleDone(cur.qid); paintDone(cur.qid); } };

// Reading size persists — eye comfort is a per-person setting, not a per-session one.
const SIZES = ['s', 'm', 'l'];
let sizeIdx = SIZES.indexOf(localStorage.getItem('mm-size') || 'm');
const applySize = () => document.documentElement.dataset.size = SIZES[sizeIdx < 0 ? 1 : sizeIdx];
$('#btn-size').onclick = () => {
  sizeIdx = (sizeIdx + 1) % SIZES.length;
  localStorage.setItem('mm-size', SIZES[sizeIdx]);
  applySize();
};
applySize();
$('#n-search').oninput = e => searchNotes(e.target.value.trim());
$('#btn-search').onclick = () => { if (filt.pid) { go(`#/p/${filt.pid}`); setTimeout(() => $('#q-search').focus(), 60); } };
$('#q-search').oninput = e => { filt.q = e.target.value; renderList(); };
$('#theme-sel').onchange = e => { filt.theme = e.target.value; renderList(); };
$('#tier-chips').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  filt.tier = c.dataset.tier;
  $('#tier-chips').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c));
  renderList();
};
$('#modes').onclick = e => {
  const m = e.target.closest('.mode'); if (!m) return;
  mode = m.dataset.mode;
  $('#modes').querySelectorAll('.mode').forEach(x => x.classList.toggle('active', x === m));
  applyMode();
};
$('#btn-step').onclick = () => {
  stepOn = !stepOn; $('#btn-step').classList.toggle('on', stepOn);
  if (stepOn) { stepIdx = -1; step(1); }
  else $('#answer').querySelectorAll('.pt').forEach(p => p.classList.remove('focus'));
};
$('#btn-branches').onclick = () => {
  branchesOn = !branchesOn;
  localStorage.setItem('mm-branches', branchesOn ? '1' : '0');
  paintBranchesBtn();
  if (cur) renderAnswer(cur.qid);
  if (raOn && cur) {
    raQueue = raBuildQueue(cur.pid);
    const i = raQueue.findIndex(r => r.qid === cur.qid);
    if (i >= 0) raIdx = i;
    raPaintBar();
  }
};
$('#btn-ra').onclick = () => raOn ? raStop() : raStart();
$('#ra-pause').onclick = () => speech.toggle();
$('#ra-next').onclick = () => raPlayIdx(raIdx + 1);
$('#ra-more').onclick = () => { raPopulateSettings(); $('#ra-settings').hidden = !$('#ra-settings').hidden; };
$('#recall').onclick = e => {
  const b = e.target.closest('.rc'); if (!b || !cur) return;
  const set = store.mark(cur.qid, +b.dataset.r);
  paintRecall(cur.qid);
  if (set === null) return;                    // just cleared — stay put
  b.textContent = '✓';
  setTimeout(() => { b.textContent = { 1: 'Blank', 2: 'Shaky', 3: 'Confident' }[b.dataset.r]; history.back(); }, 450);
};

function paintRecall(qid) {
  const rc = store.rec(qid);
  $('#recall').querySelectorAll('.rc').forEach(x => x.classList.toggle('on', rc && +x.dataset.r === rc.r));
  $('#recall').querySelector('span').textContent =
    rc ? `Marked ${{ 1: 'Blank', 2: 'Shaky', 3: 'Confident' }[rc.r]} — tap again to clear` : 'How well did you recall it?';
}
addEventListener('keydown', e => {
  if (!$('#view-answer').classList.contains('active')) return;
  if (e.key === 'ArrowRight') { stepOn = true; $('#btn-step').classList.add('on'); step(1); }
  if (e.key === 'ArrowLeft') step(-1);
});
const toggleSb = () => document.body.classList.toggle('sb-open');
$('#sb-pin').onclick = toggleSb;
$('#btn-sb').onclick = toggleSb;
addEventListener('keydown', e => {
  if (!$('#view-answer').classList.contains('active')) return;
  if (e.key === 'Escape') document.body.classList.remove('sb-open');
});
addEventListener('hashchange', route);

(async function init() {
  PAPERS = await (await fetch('data/questions.json', { cache: 'no-cache' })).json();
  await route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
