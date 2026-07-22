// ── MainsMate ── one module, no build step. Data in, reader out.
const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
// **gold** spans are the load-bearing keywords used for rapid visual scanning.
const md = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<i>$2</i>');

const EXAM = { essay: '2026-08-21', gs1: '2026-08-22', gs2: '2026-08-22', gs3: '2026-08-23', gs4: '2026-08-23', pubad1: '2026-08-30', pubad2: '2026-08-30' };
// Actual examination sequence: Essay, four GS papers, then the optional papers.
const ORDER = ['essay', 'gs1', 'gs2', 'gs3', 'gs4', 'pubad1', 'pubad2'];

// Progress is a single signal: completed or not. Recall/SRS was removed — the
// "Not completed" filter is how you find what still needs a read-through.
const store = {
  get k() { return 'mm-progress'; },
  data: JSON.parse(localStorage.getItem('mm-progress') || '{}'),
  save() { localStorage.setItem(this.k, JSON.stringify(this.data)); },
  isDone(qid) { return !!this.data[qid]?.done; },
  toggleDone(qid) {
    const e = this.data[qid] = this.data[qid] || {};
    e.done = !e.done;
    if (e.done) e.doneAt = Date.now(); else delete this.data[qid];
    this.save();
    return !!e.done;
  }
};

// Two reading views: "Model Answer" (full) is the complete answer; "Scan" is a
// 60-second skeleton (intro, headings, point heads + a 1-3 word keyword, examples).
// Read Along narrates the full text in either view.
let PAPERS = [], ANSWERS = {}, cur = null;
let mode = localStorage.getItem('mm-mode') || 'full';
let lineIdx = -1;                       // reading cursor for ↑/↓ line navigation
let answerTheme = 'all';
let readAlong = false, readPaused = false, readRun = 0, readCurrentIndex = 0;
let readProgressTimer = null, readProgressRatio = 0, readSegmentStartedAt = 0;
let readSegmentStartRatio = 0, readSegmentEndRatio = 0, readSegmentDuration = 0;
let readTimelineMeta = null;
let readDetailsOpen = false;
let readVoiceURI = localStorage.getItem('mm-read-voice') || 'auto-uk-female';
let readSpeed = Number(localStorage.getItem('mm-read-speed') || .9);
let readBranches = localStorage.getItem('mm-read-branches') !== 'false';
if (![.75, .9, 1, 1.15, 1.3].includes(readSpeed)) readSpeed = .9;

const paperOf = id => PAPERS.find(p => p.id === id);
const qidOf = (pid, n, b) => b == null ? `${pid}-${n}` : `${pid}-${n}-b${b}`;

async function loadAnswers(pid) {
  if (ANSWERS[pid]) return ANSWERS[pid];
  try {
    const r = await fetch(`data/answers/${pid}.json?v=16`, { cache: 'no-cache' });
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
}

/* ══════════════════ LIST ══════════════════ */
let filt = { tier: 'all', q: '', theme: 'all', pid: null };

function qRow(r) {
  const a = ANSWERS[r.pid]?.[r.qid];
  const b = el('button', `qrow tier${r.tier || 3}${r.isBranch ? ' branch' : ''}`);
  b.innerHTML = `<span class="meta">
      ${r.tier ? `<span class="tag t${r.tier}">T${r.tier}</span>` : ''}
      <span>${r.m}M · ${r.w}w</span>
      ${r.isBranch ? '<span>↳ branch</span>' : ''}
      ${a ? '<span class="ok">✓ written</span>' : ''}
      ${store.isDone(r.qid) ? '<span class="cm">◉ completed</span>' : ''}
      </span><p><span class="qn">Q${r.n}.</span> ${esc(r.q)}</p>`;
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
  const n = { all: all.filter(inTheme).length, 1: 0, 2: 0, 3: 0, todo: 0, undone: 0, done: 0 };
  for (const r of all) {
    if (!inTheme(r)) continue;
    if (r.tier) n[r.tier]++;
    const a = ANSWERS[p.id]?.[r.qid];
    if (!a) n.todo++;
    if (store.isDone(r.qid)) n.done++; else n.undone++;
  }
  for (const c of $('#tier-chips').querySelectorAll('.chip')) {
    const k = c.dataset.tier;
    c.querySelector('.cnt')?.remove();
    const s = document.createElement('span');
    s.className = 'cnt';
    s.textContent = ` (${n[k] ?? 0})`;
    c.append(s);
    c.disabled = (n[k] ?? 0) === 0 && k !== 'all';
    c.hidden = ['todo', 'undone', 'done'].includes(k) && (n[k] ?? 0) === 0;
  }
  return n;
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

  const counts = paintChipCounts(p);
  if (filt.tier !== 'all' && (counts[filt.tier] ?? 0) === 0) {
    filt.tier = 'all';
    $('#tier-chips').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tier === 'all')));
  }
  const needle = filt.q.toLowerCase();
  const list = rows(p, true).filter(r => {
    if (filt.theme !== 'all' && r.sec !== filt.theme) return false;
    const ans = ANSWERS[p.id]?.[r.qid];
    if (filt.tier === 'todo') { if (ans) return false; }
    else if (filt.tier === 'undone') { if (store.isDone(r.qid)) return false; }
    else if (filt.tier === 'done') { if (!store.isDone(r.qid)) return false; }
    else if (filt.tier !== 'all' && String(r.tier) !== filt.tier) return false;
    if (needle) {
      const hay = (r.q + ' ' + (ANSWERS[p.id]?.[r.qid]?.flash || []).join(' ')).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const L = $('#q-list'); L.innerHTML = '';
  if (!list.length) { L.append(el('div', 'empty', 'No questions match these filters.')); return; }
  let sec = null;
  for (const r of list) {
    if (r.sec !== sec) { sec = r.sec; L.append(el('div', 'sec-h', esc(sec))); }
    L.append(qRow(r));
  }
  if (!filt.q && filt.tier === 'all') window.scrollTo(0, 0);
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

function pointHTML(pt) {
  let h = '';
  if (pt.k) h += `<b class="lbl">${md(pt.k)}</b>: `;
  const phrase = scanKeyword(pt);
  if (phrase) h += `<span class="scan-keyword">${esc(phrase)}</span>`;
  h += `<span class="x">${md(pt.x)}</span>`;
  if (pt.ex) h += ` <span class="ex"><b class="lbl">Ex:</b> ${md(pt.ex)}</span>`;
  return h;
}

function scanKeyword(pt) {
  if (pt.kw) return String(pt.kw);
  const bold = String(pt.x || '').match(/\*\*([^*]{2,48})\*\*/)?.[1];
  if (bold) return bold;
  const stop = /^(a|an|the|this|that|these|those|is|are|was|were|be|being|been|to|of|for|and|or|but|in|on|at|by|with|from|into|through|it|its|their|his|her|can|may|must|should)$/i;
  const words = String(pt.x || '').replace(/[*_]/g, '').split(/\s+/)
    .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, ''))
    .filter(word => word && !stop.test(word));
  return words.slice(0, 3).join(' ');
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

// ── Hand-drawable diagrams ──────────────────────────────────────────────────
// A diagram re-presents EXISTING answer points as something a candidate can
// reproduce by hand in ~30s: a flow (A→B→C), a cycle (loop), a hub (centre +
// spokes) or a tree (root + branches). `seg` (0-based) ties it to a body section
// so the Diagram toggle swaps that section's bullets for the picture in place.
function normDiag(d) {
  if (!d) return null;
  // legacy shape {k:'flow', d:'A → B → C'}
  if (d.d && !d.nodes) {
    return { type: d.k || 'flow', seg: d.seg, title: d.title || '', center: d.center,
      nodes: String(d.d).split(/\s*(?:→|->)\s*/).map(s => s.trim()).filter(Boolean),
      note: d.note || 'drawable in 30s' };
  }
  return { type: d.type || 'flow', seg: d.seg, title: d.title || '', center: d.center,
    nodes: (d.nodes || []).slice(), note: d.note || 'drawable in 30s' };
}
const diagList = a => (Array.isArray(a.diag) ? a.diag : (a.diag ? [a.diag] : [])).map(normDiag).filter(d => d && (d.nodes.length || d.center));
const dNode = (x, cls) => `<span class="dnode${cls ? ' ' + cls : ''}">${md(x)}</span>`;

function renderDiag(d) {
  const cap = `<div class="dg-cap">${d.title ? esc(d.title) : esc(d.type)}${d.note ? ` · <i>${esc(d.note)}</i>` : ''}</div>`;
  let inner;
  if (d.type === 'hub') {
    inner = `<div class="dg-hub"><div class="dnode dcenter">${md(d.center || '')}</div>`
      + `<div class="dspokes">${d.nodes.map(n => dNode(n)).join('')}</div></div>`;
  } else if (d.type === 'tree') {
    inner = `<div class="dg-tree"><div class="dnode droot">${md(d.center || '')}</div>`
      + `<div class="dbranches">${d.nodes.map(n => dNode(n)).join('')}</div></div>`;
  } else { // flow | cycle
    inner = `<div class="dg-flow${d.type === 'cycle' ? ' dg-cycle' : ''}">`
      + d.nodes.map(n => dNode(n)).join('<span class="darw">→</span>')
      + (d.type === 'cycle' ? '<span class="dloop" title="repeats">↺</span>' : '') + `</div>`;
  }
  return `<div class="dg dg-${esc(d.type)}">${cap}${inner}</div>`;
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
  if (a.directive || a.flash?.length) {
    h += `<div class="answer-cues">${a.directive ? `<span class="demand-cue">Demand · ${esc(a.directive)}</span>` : ''}`
      + (a.flash || []).slice(0, 5).map(x => `<span class="keyword-cue">${md(x)}</span>`).join('') + `</div>`;
  }
  for (const i of a.intro || []) h += `<p class="intro"><b class="lbl">Intro (${esc(i.t)}):</b> ${md(i.x)}</p>`;
  const digs = diagList(a);
  const bySeg = {};
  digs.forEach(d => { if (Number.isInteger(d.seg)) (bySeg[d.seg] = bySeg[d.seg] || []).push(d); });
  (a.body || []).forEach((bd, bi) => {
    const segdig = (bySeg[bi] || []).map(renderDiag).join('');
    h += `<section class="bsec${segdig ? ' has-diag' : ''}" data-si="${bi}">`
      + `<div class="bh">H${bi + 1} — ${md(bd.h)}</div>`
      + `<div class="pts">` + (bd.p || []).map(pt => `<p class="pt${pt.unv ? ' unv' : ''}">${pointHTML(pt)}</p>`).join('') + `</div>`
      + (segdig ? `<div class="segdiag">${segdig}</div>` : '')
      + `</section>`;
  });
  const standalone = digs.filter(d => !Number.isInteger(d.seg));
  if (standalone.length) h += `<div class="segdiag standalone">${standalone.map(renderDiag).join('')}</div>`;
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
  };
  it.append(head, body);
  return it;
}

async function renderAnswer(qid) {
  // Any in-flight utterance belongs to the page we are leaving. Cancelling here
  // also makes manual question jumps restart cleanly while Read Along is on.
  readRun++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const pid = qid.split('-')[0];
  await loadAnswers(pid);
  const r = findRow(qid); if (!r) return go('#/');
  cur = r; lineIdx = -1; readCurrentIndex = 0;
  const a = ANSWERS[pid]?.[qid];
  const A = $('#answer'); A.innerHTML = '';

  const p = paperOf(pid);
  const themeSelect = $('#answer-theme');
  themeSelect.innerHTML = `<option value="all">All themes</option>` + p.sections.map(s => `<option value="${esc(s.t)}">${esc(s.t)}</option>`).join('');
  if (answerTheme !== 'all' && !p.sections.some(s => s.t === answerTheme)) answerTheme = 'all';
  themeSelect.value = answerTheme;
  A.append(el('h1', 'qtitle', esc(r.q)));
  let wc = '';
  if (a) {
    const w = writtenWords(a), lo = r.wmin || 0;
    const cls = w > r.w * 1.05 ? 'over' : (w < lo ? 'thin' : 'ok');
    wc = ` · <span class="wc ${cls}">${w} / ${lo}-${r.w}w</span>`;
  }
  // Paper · topic · tier · marks · word count — the facts that frame the answer.
  A.append(el('div', 'qmeta',
    `${p.short} · ${esc(r.sec)}${r.tier ? ` · T${r.tier}` : ''} · ${r.m} marks`
    + (r.isBranch ? ` · ↳ branch of Q${r.parent.split('-')[1]}` : '')
    + wc
    + (store.isDone(qid) ? ` · <span class="cm">✓ completed</span>` : '')));

  A.insertAdjacentHTML('beforeend',
    `<div class="abox">${a ? answerHTML(a) : noAnswerHTML(r)}</div>`);

  // Diagram toggle — swaps the diagrammable section(s) between bullets and a
  // hand-drawable picture. Model Answer view only; only when the answer has one.
  if (a && diagList(a).length) {
    const abox = A.querySelector('.abox');
    const db = el('button', 'diag-toggle', '◨ Diagram');
    db.title = 'Show these points as a hand-drawable diagram';
    db.onclick = () => {
      const on = abox.classList.toggle('diag-on');
      db.classList.toggle('on', on);
      db.textContent = on ? '≡ Text' : '◨ Diagram';
    };
    abox.classList.add('has-toggle');
    abox.appendChild(db);
  }

  // Branches ride on the same prepared content, so they live WITH the parent rather
  // than as separate destinations — each expands inline instead of navigating away.
  const parent = r.isBranch ? findRow(r.parent) : r;
  if (parent?.branches?.length) {
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
  const cp = el('button', 'act', '⧉ Copy answer');
  cp.onclick = () => { navigator.clipboard.writeText(A.innerText); cp.textContent = '✓ Copied'; setTimeout(() => cp.textContent = '⧉ Copy answer', 1400); };
  acts.append(gai, cp);
  A.append(acts);

  paintDone(qid);
  paintBranchReadToggle(r);
  renderSidebar(r);
  applyMode();
  window.scrollTo(0, 0);
  if (readAlong) startReadAlong();
}

function applyMode() {
  document.body.dataset.mode = mode;
  $('#modes')?.querySelectorAll('.mode').forEach(x => x.classList.toggle('active', x.dataset.mode === mode));
  // Diagram view is a Model-Answer affordance — leaving that view resets it.
  if (mode !== 'full') {
    $('#answer .abox')?.classList.remove('diag-on');
    const db = $('.diag-toggle'); if (db) { db.classList.remove('on'); db.textContent = '◨ Diagram'; }
  }
}

// The nodes Read Along narrates, in reading order — also the targets for the
// ↑/↓ line cursor and tap-to-read.
function readNodes() {
  const A = $('#answer'); if (!A) return [];
  const abox = A.querySelector('.abox');
  return [A.querySelector('.qtitle'), ...(abox ? abox.querySelectorAll('.intro, .bh, .pt, .diag, .wf, .conc, .nowrite') : [])].filter(Boolean);
}

// ↑/↓ moves a reading cursor between lines; if Read Along is on, narration jumps
// to that line so the voice follows the eye.
function moveLine(dir) {
  const nodes = readNodes();
  if (!nodes.length) return;
  let at = nodes.findIndex(n => n.classList.contains('reading-now'));
  if (at < 0) at = dir > 0 ? -1 : 0;
  lineIdx = Math.max(0, Math.min(nodes.length - 1, at + dir));
  const node = nodes[lineIdx];
  nodes.forEach(n => n.classList.remove('reading-now'));
  node.classList.add('reading-now');
  node.scrollIntoView({ block: 'center' }); // instant — smooth scrolling breaks the in-app browser
  if (readAlong) {
    const i = speechParts().findIndex(part => part.node === node);
    if (i >= 0) startReadAlong(i);
  }
}

/* ══════════════════ READ ALONG ══════════════════ */
// Speech is opt-in for the current session. Once enabled it reads the question,
// walks the answer block-by-block, and then opens the next main question.
const canSpeak = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
// Turn the on-screen shorthand into something a TTS voice says naturally:
// expand exam abbreviations, and convert stray dashes into audible pauses.
const cleanSpeech = s => String(s || '')
  .replace(/H(\d+)\s*[—–-]\s*/g, 'Section $1. ')          // H1 — Thesis → Section 1. Thesis
  .replace(/\bEx\b\.?\s*:?\s*/g, 'Example: ')             // Ex: → Example:
  .replace(/\bArts?\b\.?\s*(?=\d)/g, 'Article ')          // Art. 21 → Article 21
  .replace(/\bAmdt\b\.?/gi, 'Amendment')
  .replace(/\bDPSPs?\b/g, 'Directive Principles')
  .replace(/\bFRs\b/g, 'Fundamental Rights').replace(/\bFR\b/g, 'Fundamental Right')
  .replace(/\bSC\b/g, 'Supreme Court').replace(/\bHC\b/g, 'High Court')
  .replace(/\bw\.r\.t\.?/gi, 'with respect to')
  .replace(/\bi\.e\.?/gi, 'that is').replace(/\be\.g\.?/gi, 'for example')
  .replace(/\bvs?\b\.?\s/gi, ' versus ')
  .replace(/₹\s?/g, ' rupees ').replace(/%/g, ' percent ')
  .replace(/→/g, ', leads to, ').replace(/↔/g, ' versus ')
  .replace(/[▪•·]/g, '. ')
  .replace(/\s[—–]\s/g, ', ')                             // spaced em/en dash → pause
  .replace(/(\w)[—–](\w)/g, '$1, $2')                    // word—word → pause (keeps hyphenated words)
  .replace(/\s-\s/g, ', ')                                // spaced hyphen → pause
  .replace(/&/g, ' and ')
  .replace(/\s+/g, ' ')
  .replace(/\s+([.,;:])/g, '$1')
  .trim();

function speechParts() {
  const nodes = [
    $('#answer .qtitle'),
    ...$('#answer .abox').querySelectorAll('.intro, .bh, .pt, .diag, .wf, .conc, .nowrite')
  ].filter(Boolean);
  const out = [];
  nodes.forEach((node, index) => {
    node.classList.add('read-segment');
    // The scan-keyword is a visual scaffold that repeats the opening words of the
    // expansion — narrate a clone with it stripped, or every point is read twice.
    const clone = node.cloneNode(true);
    clone.querySelectorAll('.scan-keyword').forEach(el => el.remove());
    const prefix = index === 0 ? 'Question. ' : '';
    const words = cleanSpeech(prefix + clone.textContent).split(' ').filter(Boolean);
    let chunk = '';
    for (const word of words) {
      if (chunk && `${chunk} ${word}`.length > 260) {
        out.push({ node, text: chunk });
        chunk = word;
      } else chunk += `${chunk ? ' ' : ''}${word}`;
    }
    if (chunk) out.push({ node, text: chunk });
  });
  return out;
}

const formatReadTime = seconds => {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const clock = `${minutes}:${String(value % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` : clock;
};

function estimatedReadSeconds(parts = speechParts()) {
  const wordCount = parts.reduce((sum, part) => sum + part.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, wordCount / (170 * readSpeed) * 60);
}

function answerReadSeconds(row) {
  const answer = ANSWERS[row.pid]?.[row.qid];
  const strings = [row.q];
  const collect = value => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(answer);
  const wordCount = cleanSpeech(strings.join(' ')).split(/\s+/).filter(Boolean).length;
  return Math.max(1, wordCount / (170 * readSpeed) * 60);
}

function buildReadTimeline(parts) {
  if (!cur) return null;
  const sequence = navSequence(cur.pid).filter(row => ANSWERS[row.pid]?.[row.qid]);
  const target = cur.isBranch && !readBranches ? cur.parent : cur.qid;
  let currentIndex = sequence.findIndex(row => row.qid === target);
  if (currentIndex < 0) currentIndex = 0;
  const durations = sequence.map(answerReadSeconds);
  durations[currentIndex] = estimatedReadSeconds(parts);
  const paperBefore = durations.slice(0, currentIndex).reduce((sum, value) => sum + value, 0);
  const paperTotal = durations.reduce((sum, value) => sum + value, 0);
  const sectionIndexes = sequence.map((row, index) => row.sec === cur.sec ? index : -1).filter(index => index >= 0);
  const sectionCurrent = Math.max(0, sectionIndexes.indexOf(currentIndex));
  const sectionDurations = sectionIndexes.map(index => durations[index]);
  const sectionBefore = sectionDurations.slice(0, sectionCurrent).reduce((sum, value) => sum + value, 0);
  const sectionTotal = sectionDurations.reduce((sum, value) => sum + value, 0) || durations[currentIndex];
  return { questionTotal: durations[currentIndex], paperBefore, paperTotal, sectionBefore, sectionTotal };
}

function setReadProgress(id, ratio) {
  const progress = $(id);
  const value = Math.max(0, Math.min(1, ratio || 0));
  progress.value = Math.round(value * 1000) / 10;
  progress.textContent = `${Math.round(value * 100)}%`;
}

function paintReadProgress(ratio = readProgressRatio, parts = speechParts()) {
  readProgressRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  readTimelineMeta ||= buildReadTimeline(parts);
  const meta = readTimelineMeta || { questionTotal: estimatedReadSeconds(parts), sectionBefore: 0, sectionTotal: 1, paperBefore: 0, paperTotal: 1 };
  const questionElapsed = meta.questionTotal * readProgressRatio;
  const sectionElapsed = meta.sectionBefore + questionElapsed;
  const paperElapsed = meta.paperBefore + questionElapsed;
  setReadProgress('#read-progress', readProgressRatio);
  setReadProgress('#read-section-progress', sectionElapsed / meta.sectionTotal);
  setReadProgress('#read-paper-progress', paperElapsed / meta.paperTotal);
  setReadProgress('#read-paper-summary-progress', paperElapsed / meta.paperTotal);
  $('#read-elapsed').textContent = `Elapsed ${formatReadTime(questionElapsed)}`;
  $('#read-remaining').textContent = formatReadTime(meta.questionTotal - questionElapsed);
  $('#read-section-remaining').textContent = formatReadTime(meta.sectionTotal - sectionElapsed);
  $('#read-paper-remaining').textContent = formatReadTime(meta.paperTotal - paperElapsed);
  $('#read-paper-summary-remaining').textContent = formatReadTime(meta.paperTotal - paperElapsed);
}

function stopReadProgressTimer() {
  if (readProgressTimer) clearInterval(readProgressTimer);
  readProgressTimer = null;
}

function startReadProgressTimer(parts) {
  stopReadProgressTimer();
  readProgressTimer = setInterval(() => {
    if (!readAlong || readPaused || !readSegmentDuration) return;
    const fraction = Math.min(1, (performance.now() - readSegmentStartedAt) / readSegmentDuration);
    paintReadProgress(readSegmentStartRatio + (readSegmentEndRatio - readSegmentStartRatio) * fraction, parts);
  }, 350);
}

// What the status line says while narrating: which question this is within the
// paper (and, on a branch, which branch) — not the internal chunk being spoken.
function readPositionLabel() {
  if (!cur) return 'Reading';
  const p = paperOf(cur.pid);
  const mains = rows(p, true);
  const key = cur.isBranch ? cur.parent : cur.qid;
  const mi = mains.findIndex(r => r.qid === key);
  let s = `${p.short} · Q${mains[mi]?.n ?? '?'} of ${mains.length}`;
  if (cur.isBranch) s += ` · branch ${Number(cur.qid.split('-b')[1] || 0) + 1}`;
  return s;
}

function paintReadAlong(message) {
  const btn = $('#btn-read');
  const status = $('#read-status');
  btn.classList.toggle('on', readAlong);
  btn.setAttribute('aria-pressed', String(readAlong));
  btn.lastChild.textContent = readAlong ? ' Stop Reading' : ' Read Along';
  status.hidden = !readAlong && !message;
  $('#read-details-toggle').hidden = !readAlong;
  $('#read-details-panel').hidden = !readAlong || !readDetailsOpen;
  $('#read-details-toggle').setAttribute('aria-expanded', String(readDetailsOpen));
  $('#read-pause').hidden = !readAlong;
  $('#read-pause').classList.toggle('on', readPaused);
  $('#read-pause').setAttribute('aria-pressed', String(readPaused));
  $('#read-pause').textContent = readPaused ? '▶ Resume' : '❚❚ Pause';
  $('.read-pulse').classList.toggle('paused', readPaused);
  document.body.classList.toggle('read-active', readAlong);
  if (message) $('#read-status-text').textContent = message;
}

function toggleReadPause() {
  if (!readAlong || !canSpeak()) return;
  readPaused = !readPaused;
  if (readPaused) {
    speechSynthesis.pause();
    paintReadAlong(`Paused · ${cur.qid.toUpperCase()} · press Spacebar or Resume`);
  } else {
    readSegmentStartRatio = readProgressRatio;
    readSegmentStartedAt = performance.now();
    speechSynthesis.resume();
    paintReadAlong(`Reading · ${cur.qid.toUpperCase()}`);
  }
}

function stopReadAlong(message = '') {
  readAlong = false;
  readPaused = false;
  readRun++;
  if (canSpeak()) speechSynthesis.cancel();
  stopReadProgressTimer();
  $('#answer').querySelectorAll('.reading-now').forEach(n => n.classList.remove('reading-now'));
  readCurrentIndex = 0;
  readProgressRatio = 0;
  readTimelineMeta = null;
  readDetailsOpen = false;
  paintReadAlong(message);
}

// Read Along walks the very same sequence as the arrows, so "next" is identical
// whether you press → or let narration roll on — and Branches off means it never
// steps into a branch answer.
function advanceReadAlong() {
  if (!readAlong || !cur) return;
  readRun++;
  if (canSpeak()) speechSynthesis.cancel();
  const seq = navSequence(cur.pid);
  const i = navIndex(seq);
  const next = i >= 0 ? seq[i + 1] : null;
  if (next) {
    paintReadAlong(next.isBranch ? 'Branch answer next…' : 'Next question…');
    go(`#/a/${next.qid}`);
  }
  else stopReadAlong('Paper complete — you reached the final answer.');
}

function populateVoiceOptions() {
  const select = $('#read-voice');
  if (!select || !canSpeak()) return;
  const voices = speechSynthesis.getVoices();
  select.innerHTML = '';
  const fallback = document.createElement('option');
  fallback.value = 'auto-uk-female';
  fallback.textContent = 'UK English female · recommended';
  select.append(fallback);
  voices
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
    .forEach(v => {
      const option = document.createElement('option');
      option.value = v.voiceURI;
      option.textContent = `${v.name} · ${v.lang}`;
      select.append(option);
    });
  if ([...select.options].some(o => o.value === readVoiceURI)) select.value = readVoiceURI;
  else select.value = 'auto-uk-female';
}

function preferredVoice(voices) {
  if (readVoiceURI !== 'auto-uk-female') {
    const chosen = voices.find(v => v.voiceURI === readVoiceURI);
    if (chosen) return chosen;
  }
  const exact = voices.find(v => /google uk english female/i.test(v.name));
  if (exact) return exact;
  const femaleNames = /serena|stephanie|kate|martha|siri female|female/i;
  return voices.find(v => /^en[-_]gb$/i.test(v.lang) && femaleNames.test(v.name))
    || voices.find(v => /^en[-_]gb$/i.test(v.lang))
    || voices.find(v => /^en[-_]in$/i.test(v.lang))
    || voices.find(v => /^en/i.test(v.lang));
}

function startReadAlong(startIndex = 0) {
  if (!readAlong) return;
  if (!canSpeak()) {
    stopReadAlong('Read Along is not supported by this browser.');
    return;
  }

  const parts = speechParts();
  if (!parts.length) {
    advanceReadAlong();
    return;
  }

  const run = ++readRun;
  readPaused = false;
  readTimelineMeta = null;
  speechSynthesis.cancel();
  const voices = speechSynthesis.getVoices();
  const voice = preferredVoice(voices);
  const firstIndex = Math.max(0, Math.min(parts.length - 1, Number(startIndex) || 0));
  const lengths = parts.map(part => Math.max(1, part.text.length));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const before = index => lengths.slice(0, index).reduce((sum, length) => sum + length, 0);
  paintReadProgress(before(firstIndex) / totalLength, parts);
  startReadProgressTimer(parts);

  const speak = index => {
    if (!readAlong || run !== readRun) return;
    if (index >= parts.length) {
      advanceReadAlong();
      return;
    }

    const part = parts[index];
    readCurrentIndex = index;
    readSegmentStartRatio = before(index) / totalLength;
    readSegmentEndRatio = (before(index) + lengths[index]) / totalLength;
    readSegmentDuration = Math.max(700, estimatedReadSeconds([part]) * 1000);
    readSegmentStartedAt = performance.now();
    const utterance = new SpeechSynthesisUtterance(part.text);
    utterance.lang = voice?.lang || 'en-IN';
    utterance.rate = readSpeed;
    utterance.pitch = 1;
    if (voice) utterance.voice = voice;
    utterance.onstart = () => {
      if (run !== readRun) return;
      $('#answer').querySelectorAll('.reading-now').forEach(n => n.classList.remove('reading-now'));
      part.node.classList.add('reading-now');
      part.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      paintReadProgress(readSegmentStartRatio, parts);
      paintReadAlong(readPositionLabel());
    };
    utterance.onboundary = event => {
      if (run !== readRun || readPaused) return;
      const within = Math.max(0, Math.min(1, event.charIndex / Math.max(1, part.text.length)));
      readSegmentStartRatio = (before(index) + lengths[index] * within) / totalLength;
      readSegmentStartedAt = performance.now();
      paintReadProgress(readSegmentStartRatio, parts);
    };
    utterance.onend = () => {
      paintReadProgress(readSegmentEndRatio, parts);
      speak(index + 1);
    };
    utterance.onerror = e => {
      if (e.error !== 'canceled' && e.error !== 'interrupted')
        stopReadAlong('Narration stopped. Tap Read Along to try again.');
    };
    speechSynthesis.speak(utterance);
  };

  paintReadAlong(readPositionLabel());
  speak(firstIndex);
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
      <small>${b.chapters.length} chapters · ${(words / 1000).toFixed(0)}k words</small></span>
      <span class="arw">›</span>`;
    btn.onclick = () => go(`#/n/${b.id}`);
    L.append(btn);
  }
}

async function renderBook(id) {
  const b = await loadBook(id);
  $('#book-title').textContent = `${b.icon} ${b.title}`;
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

function noteHTML(text) {
  const noise = /^(click or scan|scan (?:the )?(?:qr|code)|to read more|read more|download the app|metric data|data metric)$/i;
  const rawLines = String(text || '').split(/\r?\n/)
    .map(x => x.replace(/\b(?:click or scan|to read more)\b/ig, '').replace(/\s+/g, ' ').trim())
    .filter(x => x && !noise.test(x));
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (/^\d+(?:\.\d+)*[.)]$/.test(rawLines[i]) && rawLines[i + 1]) {
      lines.push(`${rawLines[i]} ${rawLines[++i]}`);
    } else lines.push(rawLines[i]);
  }
  let html = '', paragraph = [], list = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${md(paragraph.join(' '))}</p>`;
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html += `<ul>${list.map(x => `<li>${md(x)}</li>`).join('')}</ul>`;
    list = [];
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (let line of lines) {
    line = line.replace(/^(?:y|Y)\s+(?=[A-Z₹$0-9])/, '').replace(/\s+[yY]\s+(?=[A-Z₹$0-9])/g, ' — ');
    const numbered = line.match(/^(\d+(?:\.\d+)*[.)])\s+(.+)$/);
    const bullet = line.match(/^[•▪●◆►➤✓✔✦*\-–—]\s*(.+)$/);
    const shortSection = numbered && !line.includes(' — ') && line.length < 78 && !/[₹$%]|\b(?:FY\d+|20\d{2})\b/.test(line);
    const label = /^(introduction|background|context|key facts?|features?|objectives?|significance|challenges?|issues?|impact|measures?|initiatives?|way forward|conclusion|case stud(?:y|ies)|examples?|data|metric)s?\s*:?(.*)$/i.exec(line);

    if (shortSection) {
      flush();
      html += `<h2><span>${esc(numbered[1])}</span>${md(numbered[2])}</h2>`;
    } else if (label && line.length < 95) {
      flush();
      html += `<h3>${md(line.replace(/:$/, ''))}</h3>`;
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
    } else if (numbered && (line.includes(' — ') || line.length < 150)) {
      flushParagraph();
      list.push(`${numbered[1]} ${numbered[2]}`);
    } else if (line.length < 55 && /^[A-Z][A-Za-z0-9 &'()\-/:]+$/.test(line) && !/[.!?]$/.test(line)) {
      flush();
      html += `<h3>${md(line)}</h3>`;
    } else {
      flushList();
      paragraph.push(line);
      if (/[.!?]$/.test(line) && paragraph.join(' ').length > 180) flushParagraph();
    }
  }
  flush();
  return html || '<p class="empty">No readable text was extracted for this chapter.</p>';
}

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
  $('#ch-text').innerHTML = noteHTML(c.text);
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

// The ONE ordered list every prev/next consumer walks (arrows, dock, Read Along
// advance, timeline). Respects the selected theme AND the Branches toggle:
//   branches on  → main, its branches, next main, …
//   branches off → main questions only (arrows and narration skip branches).
function navSequence(pid) {
  const p = paperOf(pid); if (!p) return [];
  const base = readBranches ? rows(p) : rows(p, true);
  return base.filter(row => answerTheme === 'all' || row.sec === answerTheme);
}
const answerNavRows = navSequence;

// Where `cur` sits in the sequence. With branches off while viewing a branch, we
// anchor to its parent so prev/next still make sense.
function navIndex(seq) {
  const key = (!readBranches && cur?.isBranch) ? cur.parent : cur?.qid;
  return seq.findIndex(r => r.qid === key);
}

function paintDone(qid) {
  const done = store.isDone(qid);
  const b = $('#btn-done');
  b.classList.toggle('on', done);
  b.textContent = done ? '✓ Completed — tap to undo' : 'Mark as completed';
}

function paintBranchReadToggle(r) {
  const b = $('#branch-read-toggle');
  const parent = r?.isBranch ? findRow(r.parent) : r;
  const count = parent?.branches?.length || 0;
  b.hidden = count === 0;
  $('#branch-count').textContent = String(count);
  b.querySelector('.branch-label').textContent = readBranches ? 'Branches On' : 'Branches Off';
  b.classList.toggle('on', readBranches);
  b.setAttribute('aria-pressed', String(readBranches));
  b.title = readBranches
    ? `Read ${count} branch answer${count === 1 ? '' : 's'} before the next main question`
    : `Skip ${count} branch answer${count === 1 ? '' : 's'} during Read Along`;
}

function renderSidebar(r) {
  const L = $('#sb-list'); L.innerHTML = '';
  const paper = paperOf(r.pid);
  const all = rows(paper);
  const mainCount = rows(paper, true).length;
  const branchCount = all.length - mainCount;
  const available = all.filter(q => ANSWERS[r.pid]?.[q.qid]).length;
  $('#sb-title').textContent = paper?.short || paper?.name || 'Question map';
  $('#sb-progress').textContent = `${mainCount} main · ${branchCount} branch${branchCount === 1 ? '' : 'es'} · ${available} answered`;
  $('#sb-search').value = '';
  let sec = null;
  for (const q of mainRows(r.pid).filter(q => answerTheme === 'all' || q.sec === answerTheme)) {
    if (q.sec !== sec) { sec = q.sec; L.append(el('div', 'sb-sec', esc(sec))); }
    const a = ANSWERS[r.pid]?.[q.qid];
    const branches = q.branches || [];
    const b = el('button', 'sb-q sb-main' + (q.qid === r.qid ? ' on' : '') + (a ? '' : ' todo') + (store.isDone(q.qid) ? ' done' : ''));
    b.dataset.search = q.q.toLowerCase();
    b.innerHTML = `<span class="sb-n">Q${q.n}</span><span class="sb-t">${esc(q.q)}</span>${branches.length ? `<span class="sb-badge" title="${branches.length} branch question${branches.length === 1 ? '' : 's'}">${branches.length}</span>` : ''}`;
    b.onclick = () => { go(`#/a/${q.qid}`); document.body.classList.remove('sb-open'); };
    L.append(b);
    branches.forEach((branch, i) => {
      const qid = qidOf(r.pid, q.n, i);
      const answer = ANSWERS[r.pid]?.[qid];
      const bb = el('button', 'sb-q sb-branch' + (qid === r.qid ? ' on' : '') + (answer ? '' : ' todo') + (store.isDone(qid) ? ' done' : ''));
      bb.dataset.search = `${q.q} ${branch.q}`.toLowerCase();
      bb.innerHTML = `<span class="sb-tree" aria-hidden="true">└</span><span class="sb-t">${esc(branch.q)}</span>`;
      bb.onclick = () => { go(`#/a/${qid}`); document.body.classList.remove('sb-open'); };
      L.append(bb);
    });
  }
  const on = L.querySelector('.sb-q.on');
  if (on) on.scrollIntoView({ block: 'center' });   // instant — smooth breaks the in-app browser
}

/* ══════════════════ ROUTER ══════════════════ */
function go(hash) { location.hash = hash; }

function subjectHash() {
  const [, kind, arg] = (location.hash || '#/').split('/');
  if ((kind === 'a' || kind === 'p') && (cur?.pid || arg)) return `#/p/${cur?.pid || arg}`;
  if (kind === 'n') {
    const bookId = (location.hash || '').split('/')[2];
    return bookId ? `#/n/${bookId}` : '#/n';
  }
  return filt.pid ? `#/p/${filt.pid}` : '#/n';
}

function dockMove(direction) {
  if (!cur) return;
  const seq = navSequence(cur.pid);
  const i = navIndex(seq);
  const target = direction === 'next' ? seq[i + 1] : seq[i - 1];
  if (target) go(`#/a/${target.qid}`);
}

function paintDock() {
  const answer = $('#view-answer').classList.contains('active');
  const prev = $('#app-dock [data-dock="previous"]');
  const next = $('#app-dock [data-dock="next"]');
  prev.hidden = !answer;
  next.hidden = !answer;
  const seq = cur ? navSequence(cur.pid) : [];
  const i = cur ? navIndex(seq) : -1;
  prev.disabled = i <= 0;
  next.disabled = i < 0 || i >= seq.length - 1;
  document.body.classList.toggle('answer-open', answer);
}

async function route() {
  const h = location.hash || '#/';
  const [, kind, arg] = h.split('/');
  if (kind !== 'a' && readAlong) stopReadAlong();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.body.dataset.mode = mode;
  document.body.classList.remove('sb-open');
  $('#back').hidden = h === '#/';
  $('#btn-sb').hidden = kind !== 'a';

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
    renderHome();
    Promise.all(ORDER.map(loadAnswers)).then(() => {
      if ((location.hash || '#/') === '#/') renderHome();
    });
  }
  paintDock();
}

/* ══════════════════ WIRING ══════════════════ */
$('#back').onclick = () => history.back();
$('#key-home').onclick = () => go('#/');
$('#key-subject').onclick = () => go(subjectHash());
$('#app-dock').onclick = e => {
  const b = e.target.closest('button[data-dock]'); if (!b || b.disabled) return;
  if (b.dataset.dock === 'home') go('#/');
  else if (b.dataset.dock === 'subject') go(subjectHash());
  else dockMove(b.dataset.dock);
};
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

// Day / night. Defaults to the OS preference, then remembers the manual choice.
// Warm-tinted palettes in both — long study sessions, low eye strain.
const prefersLight = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches;
let theme = localStorage.getItem('mm-theme') || (prefersLight ? 'light' : 'dark');
const applyTheme = () => {
  document.documentElement.dataset.theme = theme;
  $('#btn-theme').textContent = theme === 'light' ? '☀' : '☾';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = theme === 'light' ? '#f4efe4' : '#101319';
};
$('#btn-theme').onclick = () => {
  theme = theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('mm-theme', theme);
  applyTheme();
};
applyTheme();

$('#n-search').oninput = e => searchNotes(e.target.value.trim());
$('#q-search').oninput = e => { filt.q = e.target.value; renderList(); };
$('#theme-sel').onchange = e => { filt.theme = e.target.value; renderList(); };
$('#answer-theme').onchange = e => {
  answerTheme = e.target.value;
  const first = navSequence(cur.pid)[0];
  if (first && first.sec !== cur.sec) go(`#/a/${first.qid}`);
  else { paintDock(); renderSidebar(cur); }
};
$('#tier-chips').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  filt.tier = c.dataset.tier;
  $('#tier-chips').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c));
  renderList();
};
$('#modes').onclick = e => {
  const m = e.target.closest('.mode'); if (!m) return;
  mode = m.dataset.mode;
  localStorage.setItem('mm-mode', mode);
  applyMode();
};
$('#btn-read').onclick = () => {
  if (readAlong) stopReadAlong();
  else {
    readAlong = true;
    paintReadAlong('Preparing narration…');
    startReadAlong();
  }
};
$('#read-pause').onclick = toggleReadPause;
$('#read-skip').onclick = advanceReadAlong;
$('#read-details-toggle').onclick = () => {
  readDetailsOpen = !readDetailsOpen;
  paintReadAlong();
};
$('#read-speed').value = String(readSpeed);
$('#branch-read-toggle').onclick = () => {
  readBranches = !readBranches;
  localStorage.setItem('mm-read-branches', String(readBranches));
  paintBranchReadToggle(cur);
  if (readAlong) {
    const parts = speechParts();
    readTimelineMeta = buildReadTimeline(parts);
    paintReadProgress(readProgressRatio, parts);
  }
};
$('#read-speed').onchange = e => {
  readSpeed = Number(e.target.value);
  localStorage.setItem('mm-read-speed', String(readSpeed));
  if (readAlong) startReadAlong(readCurrentIndex);
};
$('#read-voice').onchange = e => {
  readVoiceURI = e.target.value;
  localStorage.setItem('mm-read-voice', readVoiceURI);
  if (readAlong) startReadAlong(readCurrentIndex);
};
populateVoiceOptions();
if (canSpeak()) speechSynthesis.addEventListener('voiceschanged', populateVoiceOptions);
// Tap any line to read from there — works whether or not narration is running.
$('#answer').addEventListener('click', e => {
  const target = e.target.closest('.qtitle, .intro, .bh, .pt, .diag, .wf, .conc, .nowrite');
  if (!target) return;
  const index = speechParts().findIndex(part => part.node === target);
  if (index < 0) return;
  if (!readAlong) { readAlong = true; paintReadAlong('Preparing narration…'); }
  startReadAlong(index);
});
addEventListener('keydown', e => {
  if (e.target.closest('input,select,textarea,[contenteditable="true"]')) return;
  if (e.code === 'Space' && $('#view-answer').classList.contains('active')) {
    e.preventDefault();
    if (readAlong) toggleReadPause();
    else {
      readAlong = true;
      paintReadAlong('Preparing narration…');
      startReadAlong();
    }
    return;
  }
  if (e.key === '1') { e.preventDefault(); go('#/'); return; }
  if (e.key === '2') { e.preventDefault(); go(subjectHash()); return; }
  if (!$('#view-answer').classList.contains('active')) return;
  // ←/→ walk questions (main → its branches → next main); ↑/↓ walk lines
  if (e.key === 'ArrowRight') { e.preventDefault(); dockMove('next'); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); dockMove('previous'); }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveLine(1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveLine(-1); }
});
const toggleSb = () => document.body.classList.toggle('sb-open');
$('#sb-pin').onclick = toggleSb;
$('#btn-sb').onclick = toggleSb;
$('#sb-backdrop').onclick = () => document.body.classList.remove('sb-open');
$('#sb-search').oninput = e => {
  const term = e.target.value.trim().toLowerCase();
  let section = null, visibleInSection = false;
  for (const node of $('#sb-list').children) {
    if (node.classList.contains('sb-sec')) {
      if (section) section.hidden = !visibleInSection;
      section = node; visibleInSection = false; continue;
    }
    const show = !term || node.dataset.search.includes(term);
    node.hidden = !show;
    visibleInSection ||= show;
  }
  if (section) section.hidden = !visibleInSection;
};
addEventListener('keydown', e => {
  if (!$('#view-answer').classList.contains('active')) return;
  if (e.key === 'Escape') document.body.classList.remove('sb-open');
});
addEventListener('hashchange', route);
addEventListener('beforeunload', () => { if (canSpeak()) speechSynthesis.cancel(); });

(async function init() {
  PAPERS = await (await fetch('data/questions.json', { cache: 'no-cache' })).json();
  await route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { });
})();
