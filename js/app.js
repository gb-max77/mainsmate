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
let answerTier = null; // null = filter by theme dropdown; '1'|'2'|'3' = filter nav + Read Along to that tier
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
      cols: [], rows: [], foot: d.foot || '',
      note: d.note || 'drawable in 30s', sketch: d.sketch };
  }
  return { type: d.type || 'flow', seg: d.seg, title: d.title || '', center: d.center,
    nodes: (d.nodes || []).slice(),
    // `table` carries a multi-attribute comparison; `foot` is the dashed box that
    // holds the decisive holding or caveat the boxes themselves cannot state.
    cols: (d.cols || []).slice(), rows: (d.rows || []).map(r => r.slice()), foot: d.foot || '',
    fig: d.fig || '', note: d.note || 'drawable in 30s', sketch: d.sketch };
}
const diagList = a => (Array.isArray(a.diag) ? a.diag : (a.diag ? [a.diag] : [])).map(normDiag).filter(d => d && (d.nodes.length || d.center || d.rows.length || d.fig));
// Does this answer carry a diagram/map (for the sidebar star)?
const hasDiag = a => !!(a && diagList(a).length);
const dNode = (x, cls) => `<span class="dnode${cls ? ' ' + cls : ''}">${md(x)}</span>`;

function renderDiag(d) {
  // Geography / IR / concept answers may carry a hand-drawable sketch behind a
  // view-hide toggle. Built first because a figure can carry one too.
  let sketch = '';
  if (d.sketch && d.sketch.svg) {
    const label = d.sketch.label || 'Sketch / map';
    sketch = `<div class="dg-sketch-wrap"><button class="dg-sketch-btn" type="button" data-label="${esc(label)}">▤ ${esc(label)}</button>`
      + `<div class="dg-sketch" hidden>${d.sketch.svg}${d.sketch.note ? `<div class="dg-sketch-note">${esc(d.sketch.note)}</div>` : ''}</div></div>`;
  }
  // `fig` = the figure as it is actually drawn in the Logic & Fact Sheet, cropped
  // straight out of the source. It already carries its own title and caption, so
  // nothing else is drawn around it — but a sketch still rides underneath.
  if (d.fig) {
    return `<div class="dg dg-figure"><img class="dg-img" src="${esc(d.fig)}" alt="${esc(d.title || 'diagram')}" loading="lazy" decoding="async">${sketch}</div>`;
  }
  const cap = `<div class="dg-cap">${d.title ? esc(d.title) : esc(d.type)}${d.note ? ` · <i>${esc(d.note)}</i>` : ''}</div>`;
  let inner;
  if (d.type === 'hub') {
    inner = `<div class="dg-hub"><div class="dnode dcenter">${md(d.center || '')}</div>`
      + `<div class="dspokes">${d.nodes.map(n => dNode(n)).join('')}</div></div>`;
  } else if (d.type === 'tree') {
    inner = `<div class="dg-tree"><div class="dnode droot">${md(d.center || '')}</div>`
      + `<div class="dbranches">${d.nodes.map(n => dNode(n)).join('')}</div></div>`;
  } else if (d.type === 'table') {
    // Multi-attribute comparison — the form the sheets use for 'compare X and Y'.
    inner = `<table class="dg-table"><thead><tr>${d.cols.map(c => `<th>${md(c)}</th>`).join('')}</tr></thead>`
      + `<tbody>${d.rows.map(r => `<tr>${r.map(c => `<td>${md(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  } else if (d.type === 'stack') {
    // Stacked bands — layers read top-to-bottom (e.g. border / economic / systemic).
    inner = `<div class="dg-stack">${d.nodes.map(n => `<div class="dband">${md(n)}</div>`).join('')}</div>`;
  } else { // flow | cycle
    inner = `<div class="dg-flow${d.type === 'cycle' ? ' dg-cycle' : ''}">`
      + d.nodes.map(n => dNode(n)).join('<span class="darw">→</span>')
      + (d.type === 'cycle' ? '<span class="dloop" title="repeats">↺</span>' : '') + `</div>`;
  }
  // The dashed box: the caveat, holding or remedy that turns a procedural figure
  // into a constitutional one. Drawn dashed so it reads as commentary, not a node.
  const foot = d.foot ? `<div class="dg-foot">${md(d.foot)}</div>` : '';
  return `<div class="dg dg-${esc(d.type)}">${cap}${inner}${foot}${sketch}</div>`;
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
  (a.body || []).forEach((bd, bi) => {
    h += `<section class="bsec" data-si="${bi}">`
      + `<div class="bh">H${bi + 1} — ${md(bd.h)}</div>`
      + `<div class="pts">` + (bd.p || []).map(pt => `<p class="pt${pt.unv ? ' unv' : ''}">${pointHTML(pt)}</p>`).join('') + `</div>`
      + `</section>`;
  });
  if (a.wf?.length) h += `<p class="wf"><b class="lbl">Way Forward:</b> ${a.wf.map(md).join(' · ')}</p>`;
  if (a.mne) h += `<p class="wf"><b class="lbl">Mnemonic:</b> ${md(a.mne)}</p>`;
  if (a.conc) h += `<p class="conc">Conclusion: ${md(a.conc)}</p>`;
  // Every figure for this answer sits together at the foot of it.
  if (digs.length) h += `<div class="segdiag"><div class="dg-head">Visuals</div>${digs.map(renderDiag).join('')}</div>`;
  return h;
}

const noAnswerHTML = r => `<div class="nowrite"><p>No model answer written for this question yet.</p>
  <small>Tier ${r.tier || '—'} · generate one in Google AI Mode below, pre-loaded with the paper's answer brief.</small></div>`;

// A collapsed branch: question line + toggle. Expanding reveals the answer in place.
function branchItem(id, b, ans, expand) {
  const it = el('div', 'bitem');
  const head = el('button', 'bhead');
  head.innerHTML = `<span class="caret">▸</span><span class="btxt">↳ ${esc(b.q)}</span>
    <span class="bmeta">${b.m}M${ans ? ' <i class="ok">✓</i>' : ''}</span>`;
  const body = el('div', 'bbody');
  const fill = () => {
    if (body.dataset.filled) return;
    body.innerHTML = (ans ? answerHTML(ans) : noAnswerHTML(b))
      + `<a class="bopen" href="#/a/${id}">Open full ↗</a>`;
    body.dataset.filled = '1';
  };
  head.onclick = () => {
    const open = body.hidden;
    if (open) fill();
    body.hidden = !open;
    it.classList.toggle('open', open);
  };
  // Branches On → show the branch answer inline right away.
  if (expand) { fill(); body.hidden = false; it.classList.add('open'); }
  else body.hidden = true;
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
  paintTierToggle();
  paintAnswerCount();
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

  // Evidence from the bank that fits this answer. Loaded lazily and rendered when
  // it arrives, so the answer never waits on it.
  applyHighlights(A.querySelector('.abox'), `a::${qid}`);
  hl.paint();

  $('#fns').hidden = true;
  loadFacts().then(() => {
    if (cur?.qid !== qid) return;                 // navigated on while loading
    renderFNS($('#fns'), `${r.q} ${A.querySelector('.abox')?.innerText || ''}`, pid);
  });

  // The Diagram flip lives on each diagrammable section's heading (see the
  // #answer click handler); nothing to add at the answer level.

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
      bx.append(branchItem(id, b, ANSWERS[pid]?.[id], readBranches));
    });
    A.append(bx);
  }

  const acts = el('div', 'actions');
  const gai = el('button', 'act gai', '⟳ Regenerate in Google AI Mode');
  gai.onclick = () => window.open(gaiURL(r), '_blank', 'noopener');
  const cp = el('button', 'act', '⧉ Copy answer');
  cp.onclick = () => { navigator.clipboard?.writeText(A.innerText).catch(() => {}); cp.textContent = '✓ Copied'; setTimeout(() => cp.textContent = '⧉ Copy answer', 1400); };
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
  .replace(/\bIntro\s*\([^)]*\)/gi, 'Intro')               // "Intro (concept):" → "Intro:" — the (type) tag is a visual cue, not spoken
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
// A tier filter, when active, takes over navigation (all sections, one tier);
// otherwise the theme dropdown governs. Branches inherit their parent's tier.
function rowTier(row) {
  if (row.tier) return String(row.tier);
  const parent = row.isBranch ? findRow(row.parent) : null;
  return parent?.tier ? String(parent.tier) : null;
}
function navSequence(pid) {
  const p = paperOf(pid); if (!p) return [];
  const base = readBranches ? rows(p) : rows(p, true);
  if (answerTier) return base.filter(row => rowTier(row) === answerTier);
  return base.filter(row => answerTheme === 'all' || row.sec === answerTheme);
}

// Reflect the active tier on the T1/T2/T3 chips and grey out the theme dropdown
// while a tier governs navigation.
function paintTierToggle() {
  $('#answer-tier')?.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.tier === answerTier)));
  const sel = $('#answer-theme');
  if (sel) { sel.disabled = !!answerTier; sel.classList.toggle('muted', !!answerTier); }
}

// position / total — where the current question sits within the active
// theme/tier selection (the same ordered list Prev/Next and Read Along walk).
function paintAnswerCount() {
  const el = $('#answer-count'); if (!el) return;
  if (!cur) { el.textContent = ''; return; }
  const seq = navSequence(cur.pid);
  const i = navIndex(seq), total = seq.length;
  if (i < 0 || !total) { el.textContent = ''; return; }
  el.textContent = `${i + 1}/${total}`;
  const where = answerTier ? `Tier-${answerTier}` : (answerTheme === 'all' ? 'the paper' : 'this theme');
  el.title = `Question ${i + 1} of ${total} in ${where}`;
}

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
  const sbFilter = q => answerTier ? rowTier(q) === answerTier : (answerTheme === 'all' || q.sec === answerTheme);
  for (const q of mainRows(r.pid).filter(sbFilter)) {
    if (q.sec !== sec) { sec = q.sec; L.append(el('div', 'sb-sec', esc(sec))); }
    const a = ANSWERS[r.pid]?.[q.qid];
    const branches = q.branches || [];
    const b = el('button', 'sb-q sb-main' + (q.qid === r.qid ? ' on' : '') + (a ? '' : ' todo') + (store.isDone(q.qid) ? ' done' : ''));
    b.dataset.search = q.q.toLowerCase();
    const mainStar = hasDiag(a) ? `<span class="sb-diag" title="Has a diagram from the fact sheet">✦</span>` : '';
    b.innerHTML = `<span class="sb-n">Q${q.n}</span><span class="sb-t">${esc(q.q)}</span>${mainStar}${branches.length ? `<span class="sb-badge" title="${branches.length} branch question${branches.length === 1 ? '' : 's'}">${branches.length}</span>` : ''}`;
    b.onclick = () => { go(`#/a/${q.qid}`); document.body.classList.remove('sb-open'); };
    L.append(b);
    branches.forEach((branch, i) => {
      const qid = qidOf(r.pid, q.n, i);
      const answer = ANSWERS[r.pid]?.[qid];
      const bb = el('button', 'sb-q sb-branch' + (qid === r.qid ? ' on' : '') + (answer ? '' : ' todo') + (store.isDone(qid) ? ' done' : ''));
      bb.dataset.search = `${q.q} ${branch.q}`.toLowerCase();
      bb.innerHTML = `<span class="sb-tree" aria-hidden="true">└</span><span class="sb-t">${esc(branch.q)}</span>${hasDiag(answer) ? `<span class="sb-diag" title="Has a diagram from the fact sheet">✦</span>` : ''}`;
      bb.onclick = () => { go(`#/a/${qid}`); document.body.classList.remove('sb-open'); };
      L.append(bb);
    });
  }
  const on = L.querySelector('.sb-q.on');
  if (on) on.scrollIntoView({ block: 'center' });   // instant — smooth breaks the in-app browser
}

/* ══════════════════ REVISION FEED ══════════════════ */
// A phone-first, Twitter/Stories-style drill: two axes. Horizontal = the cards of
// ONE answer (question → intro → each body heading → way forward + conclusion), so
// swiping right rehearses the skeleton you'd actually write. Vertical = the next
// question. Both axes are native CSS scroll-snap — no gesture library.
const feed = {
  src: localStorage.getItem('mm-feed-src') || 'answers',   // 'answers' | 'facts'
  pid: localStorage.getItem('mm-feed-paper') || 'all',
  fpid: localStorage.getItem('mm-feed-fpaper') || 'all',   // paper while in facts mode
  theme: 'all',
  kind: 'all',
  tier: null,
  diagOnly: false,
  shuffle: localStorage.getItem('mm-feed-shuffle') === 'true',
  seq: [],          // filtered rows, in display order
  drawn: 0,         // how many of seq are in the DOM
  playing: false,
  playRun: 0
};
const FEED_PAGE = 6;      // questions appended per batch
const FEED_MAX = 24;      // questions kept in the DOM (older ones are trimmed)

// One answer → its cards. Body sections each get their own card, so a 2-section
// answer is 5 cards, a 3-section 6, and an Essay (12 lenses) one card per lens.
function feedCards(row, a) {
  const cards = [{ kind: 'q' }];
  if (a) {
    if (a.intro?.length) cards.push({ kind: 'intro' });
    (a.body || []).forEach((_, si) => cards.push({ kind: 'sec', si }));
    if (a.wf?.length || a.conc) cards.push({ kind: 'close' });
    if (diagList(a).length) cards.push({ kind: 'visuals' });
  }
  return cards;
}

const PAPER_TAG = { essay: 'Essay', gs1: 'GS-1', gs2: 'GS-2', gs3: 'GS-3', gs4: 'GS-4', pubad1: 'PubAd I', pubad2: 'PubAd II' };

function feedCardHTML(card, row, a) {
  if (card.kind === 'q') {
    // Some older flash arrays are just the question's opening words — worthless as
    // memory hooks. Keep multi-word cues and any single word not lifted from the stem.
    const stem = new Set(String(row.q || '').toLowerCase().match(/[a-z0-9]+/g) || []);
    const cueList = (a?.flash || []).map(x => String(x).trim()).filter(t => {
      const w = t.toLowerCase().match(/[a-z0-9]+/g) || [];
      return w.length > 1 || (w.length === 1 && !stem.has(w[0]));
    }).slice(0, 5);
    // A single word reads well as a hashtag; a phrase does not — keep phrases as pills.
    const cues = cueList.length > 1 ? cueList.map(t =>
      `<span class="fcue">${/^[\w-]+$/.test(t) ? '#' : ''}${md(t)}</span>`).join('') : '';
    return `<div class="fc-kind">Question</div>
      <p class="fc-q">${esc(row.isBranch ? row.q : row.q)}</p>
      ${a?.directive ? `<p class="fc-demand"><b>Demand</b> · ${esc(a.directive)}</p>` : ''}
      ${cues ? `<div class="fcues">${cues}</div>` : ''}
      ${a ? '' : '<p class="fc-none">No model answer written yet.</p>'}`;
  }
  if (card.kind === 'intro') {
    const i = a.intro[0];
    return `<div class="fc-kind">Intro <span class="fc-tag">${esc(i.t || '')}</span></div>
      <p class="fc-body">${md(i.x)}</p>`;
  }
  if (card.kind === 'sec') {
    const b = a.body[card.si];
    const pts = (b.p || []).map(pt => `<li class="fc-pt">${pt.k ? `<b>${md(pt.k)}</b> ` : ''}${md(pt.x || '')}${pt.ex ? ` <span class="fc-ex">Ex: ${md(pt.ex)}</span>` : ''}</li>`).join('');
    return `<div class="fc-kind">H${card.si + 1}</div>
      <p class="fc-h">${md(b.h || '')}</p>
      <ul class="fc-pts">${pts}</ul>`;
  }
  if (card.kind === 'visuals') {
    return `<div class="fc-kind">Visuals</div>
      <div class="segdiag">${diagList(a).map(renderDiag).join('')}</div>`;
  }
  const wf = (a.wf || []).map(md).join(' · ');
  return `<div class="fc-kind">Close</div>
    ${wf ? `<p class="fc-body"><b>Way Forward</b> — ${wf}</p>` : ''}
    ${a.conc ? `<p class="fc-body fc-conc"><b>Conclusion</b> — ${md(a.conc)}</p>` : ''}`;
}

/* ══════════════════ MODEL COMPENDIUM ══════════════════ */
let COMP = null;
const comp = { pid: localStorage.getItem('mm-comp-paper') || 'gs2',
               tier: localStorage.getItem('mm-comp-tier') || 'all', q: '' };

async function loadComp() {
  if (!COMP) COMP = await fetch('data/compendium.json').then(r => r.json()).catch(() => ({}));
  return COMP;
}
const compKey = (pid, n) => `c:${pid}-${n}`;

async function renderComp() {
  await loadComp();
  localStorage.setItem('mm-comp-paper', comp.pid);
  localStorage.setItem('mm-comp-tier', comp.tier);
  $('#comp-papers').innerHTML = Object.entries(COMP).map(([pid, d]) =>
    `<button class="chip${pid === comp.pid ? ' on' : ''}" data-cp="${pid}">${esc(d.label)}</button>`).join('');
  $('#comp-tiers').innerHTML = [['all', 'All'], ['1', 'Tier 1 · 15m'], ['2', 'Tier 2 · 10m']].map(([v, l]) =>
    `<button class="chip t${v === 'all' ? '' : v}" data-ct="${v}" aria-pressed="${comp.tier === v}">${l}</button>`).join('');
  const d = COMP[comp.pid]; const q = comp.q.trim().toLowerCase();
  const rows = (d?.topics || []).filter(t =>
    (comp.tier === 'all' || String(t.tier) === comp.tier) &&
    (!q || t.t.toLowerCase().includes(q) || (t.q || '').toLowerCase().includes(q)));
  $('#comp-count').textContent = `${rows.length} of ${d?.topics.length || 0} topics`;
  $('#comp-body').innerHTML = rows.map(t => `
    <a class="qrow t${t.tier}${store.isDone(compKey(comp.pid, t.n)) ? ' done' : ''}" href="#/c/${comp.pid}/${t.n}">
      <p><span class="qn">${t.n}.</span> ${esc(t.t)}</p>
      <div class="qmeta"><span class="tag t${t.tier}">T${t.tier}</span>${t.marks} marks · ${t.words} words${t.bank?.length ? ` · ${t.bank.length} variants` : ''}${t.draw ? ' · figure' : ''}</div>
    </a>`).join('') || `<p class="fs-none">No topic matches.</p>`;
}

/* Read Along for a compendium topic: the same walk-and-highlight as the bank, over
   the topic's own blocks. Kept separate from the answer narration, which carries
   paper-wide timelines and a branch sequence a single topic has no use for. */
const compRead = {
  on: false, paused: false, run: 0, i: 0, nodes: [],
  collect() {
    this.nodes = [...($('#comptopic')?.querySelectorAll(
      '.qtitle, .abox .intro, .abox .c-para, .abox .pt, .abox .wf, .abox .conc, .c-bankrow') || [])];
  },
  start(i = 0) {
    if (!canSpeak()) return this.stop('This browser cannot speak.');
    this.collect();
    if (!this.nodes.length) return this.stop('Nothing to read.');
    if (readAlong) stopReadAlong();
    if (factRead.on) factRead.stop();
    feedStop?.();
    this.on = true; this.paused = false;
    this.i = Math.max(0, Math.min(this.nodes.length - 1, i));
    this.speak();
  },
  speak() {
    if (!this.on) return;
    const node = this.nodes[this.i];
    if (!node) return this.stop('End of the topic.');
    $('#comptopic').querySelectorAll('.reading-now').forEach(n => n.classList.remove('reading-now'));
    node.classList.add('reading-now');
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const run = ++this.run;
    this.paint();
    const text = cleanSpeech(node.textContent);
    if (!text.trim()) { this.i++; return this.speak(); }
    const u = new SpeechSynthesisUtterance(text);
    const voice = preferredVoice(speechSynthesis.getVoices());
    u.lang = voice?.lang || 'en-IN';
    u.rate = readSpeed; u.pitch = 1;
    if (voice) u.voice = voice;
    const on = () => { if (this.on && run === this.run) { this.i++; this.speak(); } };
    u.onend = on; u.onerror = on;
    speechSynthesis.speak(u);
  },
  step(dir) {
    if (!this.on) return;
    this.run++; speechSynthesis.cancel();
    this.i = Math.max(0, Math.min(this.nodes.length - 1, this.i + dir));
    this.speak();
  },
  togglePause() {
    if (!this.on) return;
    this.paused = !this.paused;
    if (this.paused) speechSynthesis.pause(); else speechSynthesis.resume();
    this.paint();
  },
  toggle() { this.on ? this.stop() : this.start(); },
  stop(message = '') {
    this.on = false; this.paused = false; this.run++;
    if (canSpeak()) speechSynthesis.cancel();
    $('#comptopic')?.querySelectorAll('.reading-now').forEach(n => n.classList.remove('reading-now'));
    this.paint(message);
  },
  paint(message = '') {
    const btn = $('#comp-read'), bar = $('#comp-readbar');
    if (!btn || !bar) return;
    btn.setAttribute('aria-pressed', String(this.on));
    btn.classList.toggle('on', this.on);
    bar.hidden = !this.on && !message;
    if (message && !this.on) { $('#comp-readpos').textContent = message; return; }
    if (!this.on) return;
    $('#comp-readpos').textContent = `${this.i + 1} / ${this.nodes.length}`;
    $('#comp-readpause').textContent = this.paused ? '\u25b6 Resume' : '\u2759\u2759 Pause';
  }
};

// The topic list as the browser is currently showing it — tier filter included,
// so Previous/Next never jumps to a topic the list has filtered away.
function compSequence() {
  const [, , pid] = (location.hash || '').split('/');
  const topics = COMP?.[pid]?.topics || [];
  return topics.filter(x => comp.tier === 'all' || String(x.tier) === comp.tier)
               .map(x => ({ pid, n: x.n }));
}
function compIndex(seq) {
  const [, , , n] = (location.hash || '').split('/');
  return seq.findIndex(x => String(x.n) === String(n));
}
function compMove(direction) {
  const seq = compSequence();
  const to = seq[compIndex(seq) + (direction === 'next' ? 1 : -1)];
  if (to) go(`#/c/${to.pid}/${to.n}`);
}

function renderCompTopic(pid, n) {
  const t = (COMP?.[pid]?.topics || []).find(x => String(x.n) === String(n));
  if (!t) { $('#comptopic').innerHTML = '<p class="fs-none">Topic not found.</p>'; return; }
  const bank = t.bank?.length ? `<div class="c-bank"><div class="dg-head">Variant expansion bank</div>`
    + t.bank.map(([k, v]) => `<p class="c-bankrow"><b>${md(k)}</b> ${md(v)}</p>`).join('') + `</div>` : '';
  $('#comptopic').innerHTML = `
    <h1 class="qtitle">${esc(t.t)}</h1>
    <div class="qmeta">${esc(COMP[pid].label)} · <span class="tag t${t.tier}">T${t.tier}</span>${t.marks} marks · ${t.words} words</div>
    <article class="abox">
      ${t.q ? `<p class="intro"><b class="lbl">Q:</b> ${md(t.q)}</p>` : ''}
      ${(t.body || []).map(p => p.startsWith('•')
        ? `<p class="pt">${md(p.replace(/^•\s*/, ''))}</p>`
        : `<p class="c-para">${md(p)}</p>`).join('')}
      ${t.position ? `<p class="wf"><b class="lbl">Position:</b> ${md(t.position)}</p>` : ''}
      ${t.conc ? `<p class="conc">${md(t.conc)}</p>` : ''}
      ${(t.figure || t.draw) ? `<div class="segdiag"><div class="dg-head">Figure</div>${t.figure ? `<p class="c-para">${md(t.figure)}</p>` : ''}${t.draw ? `<p class="c-draw"><b>Draw it —</b> ${md(t.draw)}</p>` : ''}</div>` : ''}
      ${bank}
    </article>`;
  // Walk the same list the browser shows, so prev/next respect the tier filter.
  const list = (COMP[pid].topics || []).filter(x => comp.tier === 'all' || String(x.tier) === comp.tier);
  const at = list.findIndex(x => String(x.n) === String(n));
  const nav = (d, label) => {
    const to = list[at + d];
    return to ? `<a class="c-nav" href="#/c/${pid}/${to.n}">${label === 'prev' ? '‹ Previous' : 'Next ›'}</a>`
              : `<span class="c-nav off">${label === 'prev' ? '‹ Previous' : 'Next ›'}</span>`;
  };
  $('#comptopic').insertAdjacentHTML('beforeend',
    `<div class="c-navbar">${nav(-1,'prev')}<span class="c-pos">${at + 1} / ${list.length}</span>${nav(1,'next')}</div>`);
  compRead.stop();                       // a new topic replaces the blocks being read
  $('#fns-c').hidden = true;
  loadFacts().then(() => {
    if (!location.hash.includes(`/c/${pid}/${n}`)) return;
    renderFNS($('#fns-c'), `${t.t} ${t.q || ''} ${$('#comptopic .abox')?.innerText || ''}`, pid);
  });

  const b = $('#comp-done');
  const k = compKey(pid, n);
  const paint = () => { const on = store.isDone(k); b.textContent = on ? '✓ Completed' : 'Mark as completed'; b.classList.toggle('on', on); };
  b.onclick = () => { store.toggleDone(k); paint(); };
  paint();
}

$('#comp-read')?.addEventListener('click', () => compRead.toggle());
$('#comp-readbar')?.addEventListener('click', e => {
  const id = e.target.id;
  if (id === 'comp-readpause') compRead.togglePause();
  else if (id === 'comp-readnext') compRead.step(1);
  else if (id === 'comp-readprev') compRead.step(-1);
  else if (id === 'comp-readstop') compRead.stop();
});
// Tapping a block reads from there, as in the answer view and the bank.
$('#comptopic')?.addEventListener('click', e => {
  if (!compRead.on) return;
  const n = e.target.closest('.qtitle,.intro,.c-para,.pt,.wf,.conc,.c-bankrow');
  if (!n) return;
  compRead.collect();
  const i = compRead.nodes.indexOf(n);
  if (i >= 0) { compRead.run++; speechSynthesis.cancel(); compRead.i = i; compRead.speak(); }
});

$('#comp-papers')?.addEventListener('click', e => {
  const b = e.target.closest('[data-cp]'); if (!b) return; comp.pid = b.dataset.cp; renderComp();
});
$('#comp-tiers')?.addEventListener('click', e => {
  const b = e.target.closest('[data-ct]'); if (!b) return; comp.tier = b.dataset.ct; renderComp();
});
$('#comp-q')?.addEventListener('input', e => { comp.q = e.target.value; renderComp(); });

/* ══════════════════ FNS — the bank, matched to one answer ══════════════════ */
// Words that appear in every second UPSC sentence carry no signal, so matching on
// them would surface the same handful of entries under every answer.
const FNS_STOP = new Set(('the and for with that this from have has had are was were which their its not but all any '
  + 'can may must under over into than then also such been being more most other some only when where what who how why '
  + 'they them these those there here after before between within without through during against upon while both each '
  + 'india indian indias state states government governments public national central union policy policies act acts law '
  + 'laws right rights power powers court courts scheme schemes report reports committee commission article articles '
  + 'system systems people social economic development need needs role issue issues case cases year years new').split(' '));
const fnsWords = s => (String(s).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []).filter(x => !FNS_STOP.has(x));

// Everything the answer actually says, as one lowercased haystack plus a token set.
function fnsHaystack(text) {
  const low = ' ' + String(text).toLowerCase().replace(/\s+/g, ' ') + ' ';
  return { low, set: new Set(fnsWords(low)) };
}

// A phrase counts only as a whole term: "Article 1" must not match "Article 142".
function fnsHasPhrase(low, phrase) {
  let at = low.indexOf(phrase);
  while (at >= 0) {
    const before = low[at - 1] || ' ', after = low[at + phrase.length] || ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    at = low.indexOf(phrase, at + 1);
  }
  return false;
}

function fnsMatches(hay, pid, limit = 7) {
  if (!FACTS) return [];
  const out = [];
  for (const [fpid, d] of Object.entries(FACTS)) {
    // Same paper first, cross-cutting next, another paper's bank only on a strong hit.
    const weight = fpid === pid ? 1.3 : (fpid === 'universal' ? 1 : 0.55);
    for (const s of d.sections) for (const g of s.groups) for (const it of g.items) {
      if (!it.t) continue;
      if (!it._w) it._w = fnsWords(it.t);          // cached on first use
      const phrase = it.t.toLowerCase().replace(/\s+/g, ' ').split(' —')[0];
      let score = 0;
      // A whole named thing — "Kesavananda Bharati (1973)", "Jal Jeevan Mission" —
      // appearing verbatim is far stronger evidence than scattered word overlap.
      // Boundary-checked: without it "Article 1" matches inside "Article 142".
      // Multi-word only: a term like "Authority — three theories" reduces to the
      // single generic word "authority", which matches almost any answer.
      if (phrase.includes(' ') && phrase.length >= 8 && fnsHasPhrase(hay.low, phrase)) score += 9;
      for (const t of it._w) if (hay.set.has(t)) score += 2;
      // Another paper's bank may only surface on a verbatim hit — loose word
      // overlap there drags administrative theory into art-history answers.
      const foreign = fpid !== pid && fpid !== 'universal';
      if (foreign && score < 9) continue;
      if (it._w.length && score) score = score * weight;
      if (score >= 6) out.push({ it, pid: fpid, label: d.label, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return out.filter(r => !seen.has(r.it.t) && seen.add(r.it.t)).slice(0, limit);
}

function renderFNS(box, text, pid) {
  if (!box) return;
  const hay = fnsHaystack(text);
  const rows = fnsMatches(hay, pid);
  box.hidden = !rows.length;
  if (!rows.length) { box.innerHTML = ''; return; }   // never leave the last answer's evidence behind
  box.innerHTML = `<div class="fns-head"><b>FNS</b><span>${rows.length}</span>
      <a href="#/facts/${esc(pid)}" title="Open the full bank">bank ↗</a></div>`
    + rows.map(r => `<div class="fns-row" data-k="${r.it.k}" title="Tap to expand, double-tap to copy">
        <b>${md(r.it.t)}</b><span class="fns-d">${md(r.it.d)}</span>
        ${r.it.s ? `<i class="fns-s">${esc(r.it.s)}</i>` : ''}</div>`).join('');
}

// One row at a time expands — the box is a reminder, not a second answer.
document.addEventListener('click', e => {
  const row = e.target.closest('.fns-row'); if (!row) return;
  row.classList.toggle('open');
});

/* ══════════════════ FACTNSTAT — the paper-wise fact bank ══════════════════ */
let FACTS = null;
const facts = { pid: localStorage.getItem('mm-facts-paper') || 'gs2', q: '', k: '' };

async function loadFacts() {
  if (FACTS) return FACTS;
  FACTS = await fetch('data/factnstat.json').then(r => r.json()).catch(() => ({}));
  return FACTS;
}

// Highlight the matched run so the eye lands on it without re-reading the line.
const factMark = (s, q) => !q ? md(s)
  : md(s).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');

// Every entry carries a kind, so a search can be narrowed to one class of evidence.
const FKIND = {
  data: 'Data', index: 'Indices', prov: 'Provisions', case: 'Case law', law: 'Statutes',
  sch: 'Schemes', cmte: 'Committees', eg: 'Examples', quote: 'Quotes', term: 'Concepts'
};
const factText = it => `${it.t || ''} ${it.d} ${it.s || ''}`.toLowerCase();

function factItemHTML(it, q, badge, key) {
  const bits = [];
  if (badge) bits.push(`<span class="fi-k" data-k="${it.k}">${FKIND[it.k] || it.k}</span>`);
  if (it.t) bits.push(`<b class="fi-t">${factMark(it.t, q)}</b>`);
  bits.push(`<span class="fi-d">${factMark(it.d, q)}</span>`);
  if (it.s) bits.push(`<span class="fi-s">${factMark(it.s, q)}</span>`);
  return `<li class="fi" data-k="${it.k}" data-key="${esc(key || '')}" tabindex="0" title="Click to copy">${bits.join(' ')}</li>`;
}

// A paper's own sections, followed by the cross-cutting groups tagged as serving
// it. The Cross-cutting bank stays the single source — these are the same objects,
// shown a second time where they are actually needed.
function factSections(pid) {
  const own = FACTS?.[pid]?.sections || [];
  if (pid === 'universal') return own;
  const borrowed = [];
  for (const s of FACTS?.universal?.sections || []) {
    const groups = s.groups.filter(g => (g.p || []).includes(pid));
    if (groups.length) borrowed.push({ h: `${s.h} · cross-cutting`, groups });
  }
  return borrowed.length ? own.concat(borrowed) : own;
}

/* ══════════ HIGHLIGHTER + INLINE EDIT for the bank ══════════
   Highlights and edits are stored per entry in localStorage: the bank itself is a
   static file served to everyone, so a personal mark cannot live in it. Entries are
   keyed by paper + a slug of the term, which survives re-ordering and rebuilds. */
// A pointer gesture that made a mark must not also be read as a tap: finishing a
// drag-select would otherwise start narration or copy the line. Checking the live
// selection is not enough — making the mark clears it, so the click that follows
// sees nothing. The stamp below is what the click actually consults.
let hlMarkedAt = 0;
const hlGesture = () => hl.on &&
  (Date.now() - hlMarkedAt < 500 || String(window.getSelection()).trim().length > 1);

const HL_COLOURS = [['gold', 'Gold'], ['blue', 'Blue'], ['green', 'Green'], ['lav', 'Violet']];
const hlStore = {
  marks: JSON.parse(localStorage.getItem('mm-hl') || '{}'),
  meta: JSON.parse(localStorage.getItem('mm-hl-meta') || '{}'),
  edits: JSON.parse(localStorage.getItem('mm-fedits') || '{}'),
  save() {
    localStorage.setItem('mm-hl', JSON.stringify(this.marks));
    localStorage.setItem('mm-hl-meta', JSON.stringify(this.meta));
    localStorage.setItem('mm-fedits', JSON.stringify(this.edits));
  },
  add(key, text, colour, meta) {
    const list = this.marks[key] || (this.marks[key] = []);
    if (!list.some(m => m.x === text)) list.push({ x: text, c: colour });
    this.meta[key] = meta;
    this.save();
  },
  remove(key, text) {
    if (!this.marks[key]) return;
    this.marks[key] = this.marks[key].filter(m => m.x !== text);
    if (!this.marks[key].length) { delete this.marks[key]; delete this.meta[key]; }
    this.save();
  },
  count() { return Object.values(this.marks).reduce((n, l) => n + l.length, 0); }
};
const factKeyOf = (pid, it) => `${pid}::${factSlug(it.t || it.d)}`;

const hl = {
  on: localStorage.getItem('mm-hl-on') === 'true',
  colour: localStorage.getItem('mm-hl-colour') || 'gold',
  toggle() { this.on = !this.on; localStorage.setItem('mm-hl-on', String(this.on)); this.paint(); },
  setColour(c) { this.colour = c; localStorage.setItem('mm-hl-colour', c); this.paint(); },
  paint() {
    const btn = $('#facts-hl'), bar = $('#facts-hlbar');
    if (!btn) return;
    for (const b of [btn, $('#ans-hl'), $('#mx-hl')]) {
      if (!b) continue;
      b.setAttribute('aria-pressed', String(this.on));
      b.classList.toggle('on', this.on);
      b.dataset.c = this.colour;
    }
    if (bar) {
      bar.hidden = !this.on;
      bar.innerHTML = HL_COLOURS.map(([c, label]) =>
        `<button class="hl-sw${c === this.colour ? ' on' : ''}" data-c="${c}" title="${label}" aria-label="${label}"></button>`).join('')
        + `<span class="hl-hint">Select text to mark it · click a mark to remove</span>`;
    }
    document.body.classList.toggle('hl-on', this.on);
  }
};

// Re-apply stored marks by walking text nodes, rather than by rewriting HTML: the
// entry's markup already carries bold and italics, and a string replace would break them.
function applyHighlights(li, key) {
  const list = hlStore.marks[key]; if (!list?.length) return;
  for (const m of list) {
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    const hits = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement.closest('.hl')) continue;
      const at = n.nodeValue.indexOf(m.x);
      if (at >= 0) { hits.push([n, at]); break; }      // first occurrence is enough
    }
    for (const [node, at] of hits) {
      const after = node.splitText(at);
      after.splitText(m.x.length);
      const mark = document.createElement('mark');
      mark.className = 'hl'; mark.dataset.c = m.c;
      mark.title = 'Click to remove (highlighter on)';
      after.parentNode.replaceChild(mark, after);
      mark.appendChild(after);
    }
  }
}

/* ── inline edit: e enters and leaves, the bar saves ── */
const factEdit = {
  node: null, key: null,
  start(li) {
    if (!li) return;
    this.stop();
    this.node = li; this.key = li.dataset.key;
    li.classList.add('editing');
    li.querySelectorAll('.fi-t,.fi-d').forEach(n => { n.contentEditable = 'true'; n.spellcheck = false; });
    li.insertAdjacentHTML('beforeend',
      `<span class="fi-edit">editing · <b data-ed="save">Save</b> (Ctrl+S) · <b data-ed="cancel">Cancel</b> (Esc) · e to exit</span>`);
    li.querySelector('.fi-d')?.focus();
  },
  save() {
    if (!this.node) return;
    const t = this.node.querySelector('.fi-t')?.innerText.replace(/\s*—\s*$/, '').trim();
    const d = this.node.querySelector('.fi-d')?.innerText.trim();
    hlStore.edits[this.key] = { t: t || '', d: d || '' };
    hlStore.save();
    this.stop(); renderFacts();
  },
  stop() {
    if (!this.node) return;
    this.node.classList.remove('editing');
    this.node.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    this.node.querySelector('.fi-edit')?.remove();
    this.node = null; this.key = null;
  },
  toggle(li) { this.node ? (this.stop(), renderFacts()) : this.start(li); }
};

async function renderFacts(arg) {
  await loadFacts();
  // Any re-render replaces the nodes narration is walking, so it cannot continue.
  if (factRead.on) factRead.stop();
  if (arg && FACTS[arg]) facts.pid = arg;
  localStorage.setItem('mm-facts-paper', facts.pid);
  const chips = $('#facts-papers');
  chips.innerHTML = Object.entries(FACTS).map(([pid, d]) =>
    `<button class="chip${pid === facts.pid ? ' on' : ''}" data-fp="${pid}" aria-pressed="${pid === facts.pid}">${esc(d.label)}</button>`).join('');
  const d = FACTS[facts.pid];
  const q = facts.q.trim().toLowerCase();
  const sections = factSections(facts.pid);
  const all = sections.flatMap(s => s.groups.flatMap(g => g.items));
  // Kind chips are drawn from this paper only, and count what the search leaves.
  const hitsQ = all.filter(it => !q || factText(it).includes(q));
  const byKind = {};
  for (const it of hitsQ) byKind[it.k] = (byKind[it.k] || 0) + 1;
  if (facts.k && !byKind[facts.k]) facts.k = '';
  const kindBar = $('#facts-kinds');
  if (kindBar) kindBar.innerHTML = !all.length ? '' :
    `<button class="chip${facts.k ? '' : ' on'}" data-fk="">All ${hitsQ.length}</button>` +
    Object.keys(FKIND).filter(k => byKind[k]).map(k =>
      `<button class="chip${facts.k === k ? ' on' : ''}" data-fk="${k}" aria-pressed="${facts.k === k}">${FKIND[k]} ${byKind[k]}</button>`).join('');
  const badge = !!(q || facts.k);
  let shown = 0;
  let html = '';
  for (const s of sections) {
    let secHTML = '';
    for (const g of s.groups) {
      const items = g.items.filter(it => (!facts.k || it.k === facts.k) && (!q || factText(it).includes(q)));
      if (!items.length) continue;
      shown += items.length;
      secHTML += `<div class="fs-group"><h3>${esc(g.g)}</h3><ul>`
        + items.map(it => {
            const key = factKeyOf(facts.pid, it);
            const ed = hlStore.edits[key];
            return factItemHTML(ed ? { ...it, t: ed.t || it.t, d: ed.d || it.d } : it,
                                facts.q.trim(), badge, key);
          }).join('') + `</ul></div>`;
    }
    if (secHTML) html += `<section class="fs-sec"><h2>${esc(s.h)}</h2>${secHTML}</section>`;
  }
  const total = all.length;
  $('#facts-body').innerHTML = html || `<p class="fs-none">Nothing matches “${esc(facts.q)}” in ${esc(d?.label || '')}.</p>`;
  // Marks are re-applied after every paint — filtering and search rebuild the list.
  $('#facts-body').querySelectorAll('.fi').forEach(li => applyHighlights(li, li.dataset.key));
  hl.paint();
  buildFactJump();
  $('#facts-count').textContent = (q || facts.k) ? `${shown} of ${total} shown` : `${total} facts`;
}

/* Jump strip: one row instead of a sidebar. The select carries every section and
   its groups; the arrows step across sections; scrolling updates the label. */
function buildFactJump() {
  const sel = $('#facts-sel'); if (!sel) return;
  const anchors = [];
  const opts = [...$('#facts-body').querySelectorAll('.fs-sec')].map((sec, si) => {
    const h2 = sec.querySelector('h2'); h2.id = `fsx-${si}`;
    anchors.push({ id: h2.id, el: h2, sec: true });
    const subs = [...sec.querySelectorAll('.fs-group>h3')].map((h3, gi) => {
      h3.id = `fsx-${si}-${gi}`;
      anchors.push({ id: h3.id, el: h3, sec: false });
      return `<option value="${h3.id}">— ${esc(h3.textContent)}</option>`;
    }).join('');
    return `<optgroup label="${esc(h2.textContent)}"><option value="${h2.id}">${esc(h2.textContent)}</option>${subs}</optgroup>`;
  }).join('');
  sel.innerHTML = opts;
  factJump.list = anchors;
  factJump.cur = anchors[0]?.id || '';
  factJump.measure();
  factJump.sync(true);
  factRail.measure();
}

// The strip always names where you are. Position is computed from the headings
// themselves rather than observed asynchronously, so it never lands stale.
const factJump = {
  list: [], cur: '', pend: '', pendAt: 0, queued: false, top: 104,
  mark(id) { this.cur = id; const s = $('#facts-sel'); if (s && s.value !== id) s.value = id; },
  // Where a heading comes to rest: just under the frozen search + nav block.
  // Use the block's sticky OFFSET, not its current position — measured before a
  // scroll it is still down the page, which would put the read line off-screen.
  measure() {
    const s = document.querySelector('.facts-stick');
    if (!s) { this.top = 104; return; }
    const stuck = parseFloat(getComputedStyle(s).top) || 56;
    this.top = Math.round(stuck + s.getBoundingClientRect().height) + 8;
    document.documentElement.style.setProperty('--fstick', `${this.top}px`);
  },
  sync(force) {
    if (!this.list.length) return;
    // A jump owns the label until its target actually settles under the block.
    if (this.pend && !force) {
      const a = this.list.find(x => x.id === this.pend);
      const settled = !a || Math.abs(a.el.getBoundingClientRect().top - this.top) < 12
        || Date.now() - this.pendAt > 2500;
      if (!settled) { this.mark(this.pend); return; }
      this.pend = '';
    }
    let best = this.list[0];
    for (const a of this.list) { if (a.el.getBoundingClientRect().top <= this.top + 16) best = a; else break; }
    this.mark(best.id);
  },
  onScroll() {
    if (this.queued) return; this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.sync(); factRail.paint(); });
  },
  go(id) {
    const a = this.list.find(x => x.id === id); if (!a) return;
    this.pend = id; this.pendAt = Date.now();
    this.mark(id);
    a.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  // Arrows step section to section; the select is what reaches an individual group.
  secIndex() {
    let last = -1;
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].sec) last++;
      if (this.list[i].id === this.cur) return Math.max(0, last);
    }
    return Math.max(0, last);
  },
  step(dir) {
    const secs = this.list.filter(a => a.sec); if (!secs.length) return;
    const i = Math.min(secs.length - 1, Math.max(0, this.secIndex() + dir));
    this.go(secs[i].id);
  }
};
window.addEventListener('scroll', () => { if ($('#view-facts')?.classList.contains('active')) factJump.onScroll(); }, { passive: true });

/* Read Along for the bank: walks the filtered entries in order, in the same voice
   and at the same speed as the answer narration, so the two feel like one feature.
   The source line is left unspoken — it reads as noise between entries and is on
   screen anyway. */
const factRead = {
  on: false, paused: false, run: 0, i: 0, nodes: [],
  collect() { this.nodes = [...($('#facts-body')?.querySelectorAll('.fi') || [])]; },
  // Where the eye already is, so ▶ picks up from what you were reading.
  nearestToView() {
    const y = factJump.top + 40;
    let best = 0;
    for (let n = 0; n < this.nodes.length; n++) {
      if (this.nodes[n].getBoundingClientRect().top <= y) best = n; else break;
    }
    return best;
  },
  start(i) {
    if (!canSpeak()) return this.stop('This browser cannot speak.');
    this.collect();
    if (!this.nodes.length) return this.stop('Nothing to read.');
    if (readAlong) stopReadAlong();          // the two narrations never overlap
    feedStop?.();
    this.on = true; this.paused = false;
    this.i = Math.max(0, Math.min(this.nodes.length - 1, i ?? this.nearestToView()));
    this.speak();
  },
  speak() {
    if (!this.on) return;
    const node = this.nodes[this.i];
    if (!node) return this.stop('End of the bank.');
    this.mark(node);
    const term = node.querySelector('.fi-t')?.textContent || '';
    const detail = node.querySelector('.fi-d')?.textContent || '';
    const text = cleanSpeech(`${term} ${detail}`);
    const run = ++this.run;
    this.paint();
    if (!text.trim()) return this.advance();
    const u = new SpeechSynthesisUtterance(text);
    const voice = preferredVoice(speechSynthesis.getVoices());
    u.lang = voice?.lang || 'en-IN';
    u.rate = readSpeed; u.pitch = 1;
    if (voice) u.voice = voice;
    u.onend = () => { if (this.on && run === this.run) this.advance(); };
    u.onerror = () => { if (this.on && run === this.run) this.advance(); };
    speechSynthesis.speak(u);
  },
  mark(node) {
    $('#facts-body')?.querySelectorAll('.reading-now').forEach(n => n.classList.remove('reading-now'));
    node.classList.add('reading-now');
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
  advance() { this.i++; this.speak(); },
  step(dir) {
    if (!this.on) return;
    this.run++; speechSynthesis.cancel();
    this.i = Math.max(0, Math.min(this.nodes.length - 1, this.i + dir));
    this.speak();
  },
  togglePause() {
    if (!this.on) return;
    this.paused = !this.paused;
    if (this.paused) speechSynthesis.pause(); else speechSynthesis.resume();
    this.paint();
  },
  toggle() { this.on ? this.stop() : this.start(); },
  stop(message = '') {
    this.on = false; this.paused = false; this.run++;
    if (canSpeak()) speechSynthesis.cancel();
    $('#facts-body')?.querySelectorAll('.reading-now').forEach(n => n.classList.remove('reading-now'));
    this.paint(message);
  },
  paint(message = '') {
    const btn = $('#facts-read'), bar = $('#facts-readbar');
    if (!btn || !bar) return;
    btn.setAttribute('aria-pressed', String(this.on));
    btn.classList.toggle('on', this.on);
    bar.hidden = !this.on && !message;
    if (message && !this.on) { $('#facts-readpos').textContent = message; return; }
    if (!this.on) return;
    $('#facts-readpos').textContent = `${this.i + 1} / ${this.nodes.length}`;
    $('#facts-readpause').textContent = this.paused ? '▶ Resume' : '❚❚ Pause';
    factJump.measure();                       // the bar changes the frozen block's height
  }
};

/* The right-edge rail: how much of the filtered bank is behind you, how much is left.
   Entry offsets are cached per render and the lookup is a binary search, so this
   stays cheap even at a thousand entries. */
const factRail = {
  tops: [], total: 0, hide: 0,
  index() {                                   // entries whose top has passed the read line
    const y = window.scrollY + factJump.top;
    let lo = 0, hi = this.tops.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.tops[mid] <= y) lo = mid + 1; else hi = mid; }
    return lo;
  },
  measure() {
    const nodes = $('#facts-body')?.querySelectorAll('.fi') || [];
    this.tops = [...nodes].map(n => n.getBoundingClientRect().top + window.scrollY);
    this.total = this.tops.length;
    this.paint();
  },
  paint() {
    const rail = $('#facts-rail'); if (!rail) return;
    if (!this.total) { rail.classList.remove('live'); rail.querySelector('i').style.height = '0'; return; }
    const seen = this.index();
    const frac = Math.min(1, seen / this.total);
    rail.querySelector('i').style.height = `${(frac * 100).toFixed(1)}%`;
    const left = this.total - seen;
    const label = rail.querySelector('span');
    label.textContent = left ? `${left} left` : 'end';
    label.style.top = `${(frac * 100).toFixed(1)}%`;
    // The count shows while you move and fades once you settle to read, so it
    // never sits over the text you are actually on.
    rail.classList.add('live');
    clearTimeout(this.hide);
    this.hide = setTimeout(() => rail.classList.remove('live'), 1100);
  }
};
$('#facts-sel')?.addEventListener('change', e => factJump.go(e.target.value));
$('#facts-jump')?.addEventListener('click', e => {
  const b = e.target.closest('[data-jump]'); if (!b) return;
  factJump.step(b.dataset.jump === 'next' ? 1 : -1);
});

$('#facts-papers')?.addEventListener('click', e => {
  const b = e.target.closest('[data-fp]'); if (!b) return;
  facts.pid = b.dataset.fp; facts.k = ''; renderFacts();
  $('#view-facts')?.scrollIntoView({ block: 'start' });
});
$('#facts-kinds')?.addEventListener('click', e => {
  const b = e.target.closest('[data-fk]'); if (!b) return;
  facts.k = b.dataset.fk; renderFacts();
});
$('#facts-q')?.addEventListener('input', e => { facts.q = e.target.value; renderFacts(); });
// A fact is only useful in the answer copy — one tap lifts the whole line. While
// Read Along is running the same tap means "read from here", matching the answer view.
$('#facts-body')?.addEventListener('click', e => {
  const li = e.target.closest('.fi'); if (!li) return;
  if (hlGesture()) return;                 // that click ended a mark, not a tap
  if (factRead.on) {
    factRead.collect();
    const i = factRead.nodes.indexOf(li);
    if (i >= 0) { factRead.run++; speechSynthesis.cancel(); factRead.i = i; factRead.speak(); }
    return;
  }
  const t = [...li.querySelectorAll('.fi-t,.fi-d,.fi-s')].map(n => n.textContent).join(' — ');
  navigator.clipboard?.writeText(t).catch(() => {});
  li.classList.add('copied'); setTimeout(() => li.classList.remove('copied'), 900);
});
/* ── highlighter: select to mark, click a mark to remove.
   Marking is independent of edit mode — it touches nothing but the marks store,
   and while it is on, tap-to-copy stands down so a drag-select cannot fire it. ── */
$('#facts-hl')?.addEventListener('click', () => hl.toggle());
$('#ans-hl')?.addEventListener('click', () => hl.toggle());
document.addEventListener('click', e => {
  const b = e.target.closest('.facts-hlbar [data-c]'); if (b) hl.setColour(b.dataset.c);
});

// One handler for both surfaces: the bank's entries and an answer's blocks.
function hlSurface(node) {
  const li = node?.parentElement?.closest?.('.fi');
  if (li) return { host: li, key: li.dataset.key };
  const mb = node?.parentElement?.closest?.('.mx-b');
  if (mb) return { host: mb, key: mb.dataset.key };
  const blk = node?.parentElement?.closest?.('#answer .abox');
  if (blk && cur) return { host: blk, key: `a::${cur.qid}` };
  return null;
}
function hlMeta(host, key) {
  if (key.startsWith('mx::')) {
    const bk = MX?.books.find(b => b.id === mx.book);
    return { pid: 'pubad1', label: 'Maximus', sec: `${bk?.label || ''} · ${mxUnit()?.name || ''}`,
             grp: host.closest('.mx-g')?.querySelector('h2')?.firstChild.textContent || '',
             term: host.querySelector('.mx-t')?.textContent || '', href: `#/mx/${mx.book}` };
  }
  if (key.startsWith('a::')) {
    const p = paperOf(cur.pid);
    return { pid: cur.pid, label: PAPER_TAG[cur.pid] || cur.pid, sec: cur.sec || p?.short || '',
             grp: 'Model answer', term: cur.q?.slice(0, 90) || '', href: `#/a/${cur.qid}` };
  }
  const d = FACTS?.[facts.pid];
  return { pid: facts.pid, label: d?.label || facts.pid,
           sec: host.closest('.fs-sec')?.querySelector('h2')?.textContent || '',
           grp: host.closest('.fs-group')?.querySelector('h3')?.textContent || '',
           term: host.querySelector('.fi-t')?.textContent || '', href: `#/facts/${facts.pid}` };
}
document.addEventListener('mouseup', () => {
  if (!hl.on) return;
  const sel = window.getSelection();
  const text = String(sel).trim();
  if (!text || text.length < 2) return;
  const a = hlSurface(sel.anchorNode), b = hlSurface(sel.focusNode);
  if (!a || !b || a.key !== b.key) return;          // one block at a time
  hlStore.add(a.key, text, hl.colour, hlMeta(a.host, a.key));
  hlMarkedAt = Date.now();
  sel.removeAllRanges();
  applyHighlights(a.host, a.key);
});

/* ── inline edit: e enters and leaves; Ctrl+S or the bar saves ── */
let factHover = null;
$('#facts-body')?.addEventListener('mouseover', e => {
  const li = e.target.closest('.fi'); if (li) factHover = li;
});
$('#facts-body')?.addEventListener('focusin', e => {
  const li = e.target.closest('.fi'); if (li) factHover = li;
});
$('#facts-body')?.addEventListener('click', e => {
  const ed = e.target.closest('[data-ed]');
  if (ed) { e.stopPropagation(); ed.dataset.ed === 'save' ? factEdit.save() : (factEdit.stop(), renderFacts()); return; }
  const mark = e.target.closest('.hl');
  if (mark && hl.on) {
    e.stopPropagation();
    const li = mark.closest('.fi');
    hlStore.remove(li.dataset.key, mark.textContent);
    renderFacts();
  }
}, true);
// The same, for a mark inside an answer.
$('#answer')?.addEventListener('click', e => {
  const mark = e.target.closest('.hl'); if (!mark || !hl.on || !cur) return;
  e.stopPropagation();
  hlStore.remove(`a::${cur.qid}`, mark.textContent);
  const p = mark.parentNode; p.replaceChild(document.createTextNode(mark.textContent), mark); p.normalize();
}, true);
addEventListener('keydown', e => {
  const onFacts = $('#view-facts')?.classList.contains('active');
  const onAnswer = $('#view-answer')?.classList.contains('active');
  const onMx = $('#view-mx')?.classList.contains('active');
  if (!onFacts && !onAnswer && !onMx) return;
  if (onMx) {
    if (e.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); hl.toggle(); }
    return;
  }
  if (onAnswer) {
    if (e.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); hl.toggle(); }
    return;
  }
  if (factEdit.node) {                      // inside the editor
    if (e.key === 'Escape') { e.preventDefault(); factEdit.stop(); renderFacts(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); factEdit.save(); }
    return;
  }
  if (e.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
  if (e.key === 'h' || e.key === 'H') { e.preventDefault(); hl.toggle(); }
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); factEdit.toggle(factHover); }
});

$('#facts-read')?.addEventListener('click', () => factRead.toggle());
$('#facts-readbar')?.addEventListener('click', e => {
  const id = e.target.id;
  if (id === 'facts-readpause') factRead.togglePause();
  else if (id === 'facts-readnext') factRead.step(1);
  else if (id === 'facts-readprev') factRead.step(-1);
  else if (id === 'facts-readstop') factRead.stop();
});

function feedQuestionEl(row) {
  const a = ANSWERS[row.pid]?.[row.qid];
  const cards = feedCards(row, a);
  const sec = el('section', 'fq');
  sec.dataset.qid = row.qid;
  const tier = rowTier(row);
  const handle = `${PAPER_TAG[row.pid] || row.pid} · ${esc(row.sec)}`;
  sec.innerHTML =
    `<header class="fq-head">
       <span class="fq-av" aria-hidden="true">${esc((PAPER_TAG[row.pid] || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2))}</span>
       <span class="fq-who"><b>${handle}</b><small>@${esc(row.pid)} · Q${esc(String(row.n ?? ''))}${row.isBranch ? '·b' : ''}${row.m ? ` · ${esc(String(row.m))}m` : ''}</small></span>
       ${tier ? `<span class="tag t${tier}">T${tier}</span>` : ''}
       ${hasDiag(a) ? '<span class="sb-diag" title="Has a diagram / map">✦</span>' : ''}
     </header>
     <div class="fq-pips">${cards.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>
     <div class="fq-rail">${cards.map(c => `<article class="fcard"><div class="fc-in">${feedCardHTML(c, row, a)}</div></article>`).join('')}</div>
     <footer class="fq-foot">
       <button class="fq-act" data-act="done" aria-pressed="${store.isDone(row.qid)}" title="Mark as completed">✓</button>
       <button class="fq-act" data-act="play" title="Read this card aloud, then roll on">▶</button>
       <button class="fq-act" data-act="open" title="Open the full answer">↗</button>
       <span class="fq-pos"></span>
     </footer>`;
  const rail = sec.querySelector('.fq-rail');
  rail.addEventListener('scroll', () => feedPaintPips(sec), { passive: true });
  feedPaintPips(sec);
  return sec;
}

/* ── the same feed, fed by FactnStat: one entry per screen, doomscrollable ── */
const factSlug = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);
const factKey = row => `f:${row.pid}:${factSlug(row.it.t || row.it.d)}`;

function feedFactEl(row) {
  const { it } = row;
  const sec = el('section', 'fq fq-fact');
  sec.dataset.qid = factKey(row);
  const kindLabel = FKIND[it.k] || it.k;
  sec.innerHTML =
    `<header class="fq-head">
       <span class="fq-av" aria-hidden="true">${esc((row.label || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2))}</span>
       <span class="fq-who"><b>${esc(row.label)} · ${esc(row.group)}</b><small>@${esc(row.pid)} · ${esc(row.sec)}</small></span>
       <span class="fi-k" data-k="${it.k}">${esc(kindLabel)}</span>
     </header>
     <div class="fq-rail"><article class="fcard" data-k="${it.k}"><div class="fc-in">
       ${it.t ? `<p class="fc-term">${md(it.t)}</p>` : ''}
       <p class="fc-fact">${md(it.d)}</p>
       ${it.s ? `<p class="fc-src">${esc(it.s)}</p>` : ''}
     </div></article></div>
     <footer class="fq-foot">
       <button class="fq-act" data-act="done" aria-pressed="${store.isDone(factKey(row))}" title="Mark as revised">✓</button>
       <button class="fq-act" data-act="play" title="Read this aloud, then roll on">▶</button>
       <button class="fq-act" data-act="copy" title="Copy this fact">⧉</button>
       <button class="fq-act" data-act="open" title="Open this bank in FactnStat">↗</button>
       <span class="fq-pos"></span>
     </footer>`;
  return sec;
}

// Flatten the fact bank into feed rows, honouring the paper and kind filters.
function factSequence() {
  const pids = feed.fpid === 'all' ? Object.keys(FACTS || {}) : [feed.fpid];
  const out = [];
  for (const pid of pids) {
    const d = FACTS?.[pid]; if (!d) continue;
    for (const s of d.sections) for (const g of s.groups) for (const it of g.items) {
      if (feed.kind !== 'all' && it.k !== feed.kind) continue;
      out.push({ pid, label: d.label, sec: s.h, group: g.g, it });
    }
  }
  return out;
}

const feedCardIndex = sec => {
  const rail = sec.querySelector('.fq-rail');
  return Math.round(rail.scrollLeft / Math.max(1, rail.clientWidth));
};

function feedPaintPips(sec) {
  const i = feedCardIndex(sec);
  const pips = sec.querySelectorAll('.fq-pips i');
  pips.forEach((p, n) => p.classList.toggle('on', n === i));
  const pos = sec.querySelector('.fq-pos');
  if (pos) pos.textContent = `${i + 1}/${pips.length}`;
}

// Build the filtered, ordered list the feed walks — questions or facts.
function feedSequence() {
  let out = [];
  if (feed.src === 'facts') {
    out = factSequence();
  } else {
    const papers = feed.pid === 'all' ? ORDER : [feed.pid];
    for (const pid of papers) {
      const p = paperOf(pid); if (!p) continue;
      out = out.concat(rows(p).filter(r => {
        if (feed.tier && rowTier(r) !== feed.tier) return false;
        if (feed.pid !== 'all' && feed.theme !== 'all' && r.sec !== feed.theme) return false;
        if (feed.diagOnly && !hasDiag(ANSWERS[pid]?.[r.qid])) return false;
        return true;
      }));
    }
  }
  if (feed.shuffle) for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function feedAppend(n = FEED_PAGE) {
  const scroll = $('#feed-scroll');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n && feed.drawn < feed.seq.length; i++, feed.drawn++) {
    const row = feed.seq[feed.drawn];
    frag.append(feed.src === 'facts' ? feedFactEl(row) : feedQuestionEl(row));
  }
  scroll.append(frag);
  // Keep the DOM bounded: drop questions well above the viewport and subtract the
  // exact height removed (every .fq is one viewport tall) so scroll stays put.
  const kids = scroll.children;
  if (kids.length > FEED_MAX) {
    const drop = kids.length - FEED_MAX;
    const h = scroll.clientHeight;
    const seen = Math.floor(scroll.scrollTop / Math.max(1, h));
    const cut = Math.min(drop, Math.max(0, seen - 2));
    for (let i = 0; i < cut; i++) kids[0].remove();
    if (cut) scroll.scrollTop -= cut * h;
  }
}

// The topbar's height varies (the brand wraps on narrow screens), so measure it
// rather than hard-coding: the feed fills exactly the space below it, and
// FactnStat's frozen search + nav block hangs from it.
function syncTopbarHeight() {
  const tb = document.querySelector('.topbar');
  if (tb) document.documentElement.style.setProperty('--tb', `${Math.round(tb.getBoundingClientRect().height)}px`);
}
addEventListener('resize', () => {
  if ($('#view-feed')?.classList.contains('active')) syncTopbarHeight();
  if ($('#view-facts')?.classList.contains('active')) { syncTopbarHeight(); factJump.measure(); factRail.measure(); }
  if ($('#view-mx')?.classList.contains('active')) { syncTopbarHeight(); mxJump.measure(); }
});

function renderFeed() {
  syncTopbarHeight();
  const scroll = $('#feed-scroll');
  feedStop();
  scroll.innerHTML = '';
  feed.seq = feedSequence();
  feed.drawn = 0;
  $('#feed-count').textContent = feed.seq.length
    ? `${feed.seq.length} ${feed.src === 'facts' ? 'facts' : 'Q'}` : '';
  $('#feed-empty').hidden = !!feed.seq.length;
  feedAppend(FEED_PAGE * 2);
  scroll.scrollTop = 0;
}

function feedPaintBar() {
  const onFacts = feed.src === 'facts';
  $('#feed-src').querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.src === feed.src)));
  // The paper list differs by source: papers with answers, versus banks of facts.
  const paper = $('#feed-paper');
  paper.innerHTML = `<option value="all">All papers</option>` + (onFacts
    ? Object.entries(FACTS || {}).map(([id, d]) => `<option value="${id}">${esc(d.label)}</option>`).join('')
    : ORDER.map(id => `<option value="${id}">${esc(PAPER_TAG[id] || id)}</option>`).join(''));
  paper.value = onFacts ? feed.fpid : feed.pid;
  if (paper.selectedIndex < 0) { paper.value = 'all'; if (onFacts) feed.fpid = 'all'; else feed.pid = 'all'; }

  const theme = $('#feed-theme');
  const p = (!onFacts && feed.pid !== 'all') ? paperOf(feed.pid) : null;
  theme.hidden = !p;
  if (p) {
    theme.innerHTML = `<option value="all">All themes</option>` +
      p.sections.map(s => `<option value="${esc(s.t)}">${esc(s.t)}</option>`).join('');
    if (!p.sections.some(s => s.t === feed.theme)) feed.theme = 'all';
    theme.value = feed.theme;
  }
  const kind = $('#feed-kind');
  kind.hidden = !onFacts;
  if (onFacts) {
    const present = new Set(factSequenceKinds());
    kind.innerHTML = `<option value="all">All kinds</option>` +
      Object.entries(FKIND).filter(([k]) => present.has(k))
        .map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
    if (feed.kind !== 'all' && !present.has(feed.kind)) feed.kind = 'all';
    kind.value = feed.kind;
  }
  // Tier, diagram and theme filters only mean something for answers.
  $('#feed-tier').hidden = onFacts;
  $('#feed-diag').hidden = onFacts;
  $('#feed-tier').querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.tier === feed.tier)));
  $('#feed-diag').setAttribute('aria-pressed', String(feed.diagOnly));
  $('#feed-shuffle').setAttribute('aria-pressed', String(feed.shuffle));
}

// Which kinds exist in the currently selected bank(s) — so the filter never offers an empty one.
function factSequenceKinds() {
  const pids = feed.fpid === 'all' ? Object.keys(FACTS || {}) : [feed.fpid];
  const set = new Set();
  for (const pid of pids) for (const s of FACTS?.[pid]?.sections || [])
    for (const g of s.groups) for (const it of g.items) set.add(it.k);
  return set;
}

/* ── feed navigation ── */
const feedCurrent = () => {
  const scroll = $('#feed-scroll');
  const i = Math.round(scroll.scrollTop / Math.max(1, scroll.clientHeight));
  return scroll.children[Math.max(0, Math.min(scroll.children.length - 1, i))] || null;
};

function feedMoveCard(dir) {
  const sec = feedCurrent(); if (!sec) return false;
  const rail = sec.querySelector('.fq-rail');
  const n = sec.querySelectorAll('.fcard').length;
  const i = feedCardIndex(sec) + dir;
  if (i < 0 || i >= n) return false;
  rail.scrollTo({ left: i * rail.clientWidth, behavior: 'smooth' });
  return true;
}

function feedMoveQuestion(dir) {
  const scroll = $('#feed-scroll');
  const sec = feedCurrent(); if (!sec) return false;
  const target = dir > 0 ? sec.nextElementSibling : sec.previousElementSibling;
  if (!target) { if (dir > 0) feedAppend(); return false; }
  // Always land on the first card of the next question — Stories convention.
  target.querySelector('.fq-rail').scrollTo({ left: 0, behavior: 'auto' });
  scroll.scrollTo({ top: target.offsetTop - scroll.offsetTop, behavior: 'smooth' });
  if (feed.drawn - Array.from(scroll.children).indexOf(target) < FEED_PAGE) feedAppend();
  return true;
}

/* ── feed autoplay: read this card, slide right, then drop to the next question ── */
function feedStop(message) {
  feed.playing = false;
  feed.playRun++;
  if (canSpeak()) speechSynthesis.cancel();
  $('#view-feed')?.querySelectorAll('.fq-act[data-act="play"]').forEach(b => b.classList.remove('on'));
  if (message) $('#feed-count') && ($('#feed-count').textContent = message);
}

function feedSpeakCurrent() {
  if (!feed.playing) return;
  const sec = feedCurrent();
  if (!sec) return feedStop();
  sec.querySelector('.fq-act[data-act="play"]')?.classList.add('on');
  const card = sec.querySelectorAll('.fcard')[feedCardIndex(sec)];
  const text = cleanSpeech(card ? card.textContent : '');
  const run = ++feed.playRun;
  if (!text) return feedNextInPlay(run);
  const u = new SpeechSynthesisUtterance(text);
  const voice = preferredVoice(speechSynthesis.getVoices());
  u.lang = voice?.lang || 'en-IN';
  u.rate = readSpeed; u.pitch = 1;
  if (voice) u.voice = voice;
  u.onend = () => feedNextInPlay(run);
  u.onerror = () => feedNextInPlay(run);
  speechSynthesis.speak(u);
}

function feedNextInPlay(run) {
  if (!feed.playing || run !== feed.playRun) return;
  // right through the answer's cards, then down to the next question
  const moved = feedMoveCard(1) || feedMoveQuestion(1);
  if (!moved) return feedStop('End of feed');
  setTimeout(feedSpeakCurrent, 420);   // let the snap settle before speaking
}

function feedTogglePlay() {
  if (feed.playing) return feedStop();
  if (!canSpeak()) return;
  if (readAlong) stopReadAlong();
  feed.playing = true;
  feedSpeakCurrent();
}

/* ── the home panel: every mark you have made, grouped by where it came from ──
   Built from storage on each home render, so it is current the moment you come
   back from the bank. Grouped paper → section, which is the bank's own subject
   organisation, then listed newest group first. */
function renderHighlights() {
  const n = hlStore.count();
  const cta = $('#go-hl');
  if (cta) {
    cta.hidden = !n;
    const sub = $('#hl-sub');
    if (sub && n) sub.textContent = `${n} passage${n === 1 ? '' : 's'} marked, grouped by subject`;
  }
  const body = $('#hl-body'); if (!body) return;
  $('#hl-count') && ($('#hl-count').textContent = n ? `${n} marked` : '');
  if (!n) { body.innerHTML = `<p class="fs-none">Nothing marked yet. Turn the highlighter on in FactnStat or in any answer — the button, or press h — and select the text you want to keep.</p>`; return; }
  // Grouped paper → section, which is the app's own subject organisation.
  const byPaper = {};
  for (const [key, list] of Object.entries(hlStore.marks)) {
    const m = hlStore.meta[key] || {};
    const label = m.label || key.split('::')[0];
    const sec = m.sec || 'Marked';
    ((byPaper[label] ||= {})[sec] ||= []).push({ key, m, list });
  }
  body.innerHTML = Object.entries(byPaper).map(([label, secs]) => `
    <section class="fs-sec"><h2>${esc(label)}</h2>`
    + Object.entries(secs).map(([sec, entries]) => `
      <div class="fs-group"><h3>${esc(sec)}</h3>`
      + entries.map(en => `<div class="hl-entry">
          <a href="${esc(en.m.href || '#/')}"><b>${esc(en.m.term || '')}</b></a>
          <button class="hl-drop" data-drop="${esc(en.key)}" title="Remove every mark on this entry" aria-label="Remove every mark on this entry">✕</button>
          ${en.list.map(mk => `<span class="hl-wrap"><mark class="hl" data-c="${mk.c}" data-key="${esc(en.key)}">${esc(mk.x)}</mark><button class="hl-x" data-key="${esc(en.key)}" data-x="${esc(mk.x)}" title="Remove this mark" aria-label="Remove this mark">✕</button></span>`).join(' ')}
        </div>`).join('')
      + `</div>`).join('')
    + `</section>`).join('');
}

$('#hl-clear')?.addEventListener('click', () => {
  hlStore.marks = {}; hlStore.meta = {}; hlStore.save(); renderHighlights();
});
$('#hl-copy')?.addEventListener('click', () => {
  const lines = [];
  for (const [key, list] of Object.entries(hlStore.marks)) {
    const m = hlStore.meta[key] || {};
    lines.push(`${m.label || ''} · ${m.term || ''}`);
    list.forEach(mk => lines.push(`  — ${mk.x}`));
  }
  navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
  const b = $('#hl-copy'); b.textContent = '✓ Copied';
  setTimeout(() => b.textContent = '⧉ Copy all', 1200);
});
// Removing, three ways: the small x on a mark, the x on an entry (all of its
// marks), or clicking the mark itself.
$('#hl-body')?.addEventListener('click', e => {
  const x = e.target.closest('.hl-x');
  if (x) { e.preventDefault(); hlStore.remove(x.dataset.key, x.dataset.x); return renderHighlights(); }
  const drop = e.target.closest('.hl-drop');
  if (drop) {
    e.preventDefault();
    delete hlStore.marks[drop.dataset.drop]; delete hlStore.meta[drop.dataset.drop];
    hlStore.save(); return renderHighlights();
  }
  const mark = e.target.closest('mark.hl'); if (!mark) return;
  e.preventDefault();
  hlStore.remove(mark.dataset.key, mark.textContent);
  renderHighlights();
});
$('#go-hl')?.addEventListener('click', () => go('#/hl'));

/* ══════════════════ MAXIMUS WEBERUS ══════════════════
   The final revision pod for the optional. The same blocks are cut three ways —
   Paper I and Paper II in strict syllabus order, and Joint, where each Paper-I
   unit sits beside the Paper-II twin it explains. Within a book the select walks
   the syllabus; the theme chips cut across it by what a block IS, and the ⚙ lens
   by where it GOES in an answer. */
let MX = null;
const mx = {
  book: localStorage.getItem('mm-mx-book') || 'p1',
  unit: localStorage.getItem('mm-mx-unit') || '',
  q: '',
  tiers: new Set(JSON.parse(localStorage.getItem('mm-mx-tiers') || '[]')),
  kinds: new Set(JSON.parse(localStorage.getItem('mm-mx-kinds') || '[]')),
  slots: new Set(JSON.parse(localStorage.getItem('mm-mx-slots') || '[]')),
  lens: localStorage.getItem('mm-mx-lens') === '1'
};
async function loadMx() {
  if (!MX) MX = await fetch('data/maximus.json').then(r => r.json()).catch(() => null);
  return MX;
}
const mxSave = () => {
  localStorage.setItem('mm-mx-book', mx.book);
  localStorage.setItem('mm-mx-unit', mx.unit);
  localStorage.setItem('mm-mx-tiers', JSON.stringify([...mx.tiers]));
  localStorage.setItem('mm-mx-kinds', JSON.stringify([...mx.kinds]));
  localStorage.setItem('mm-mx-slots', JSON.stringify([...mx.slots]));
};
const mxBook = () => MX.books.find(b => b.id === mx.book) || MX.books[0];
// "*" is the whole book read straight through — every section, in order.
const mxAllUnit = bk => ({
  u: '*', name: `All of ${bk.label}`, tag: 'everything', sel: `All of ${bk.label}`, n: bk.n,
  groups: bk.units.flatMap(u => u.groups.map(g => ({ g: `${u.tag} · ${g.g}`, items: g.items })))
});
const mxUnit = () => {
  const bk = mxBook();
  if (mx.unit === '*') return mxAllUnit(bk);
  return bk.units.find(u => u.u === mx.unit) || bk.units[0];
};

const mxText = b => `${b.t} ${b.d} ${b.u} ${b.s || ''}`.toLowerCase();
// Empty filter set means "everything" — chips are additive, never exclusive.
const mxPass = b =>
  (!mx.tiers.size || mx.tiers.has(String(b.tr))) &&
  (!mx.kinds.size || mx.kinds.has(b.k)) &&
  (!mx.slots.size || mx.slots.has(b.sl));
const mxFilters = () => mx.tiers.size + mx.kinds.size + mx.slots.size;

/* The lead term and the bolded keywords are the event; what a block is and where
   it goes are hairline marks that must never compete with them for attention. */
function mxBlockHTML(b, q) {
  const mk = t => factMark(t, q);
  const key = `mx::${factSlug(b.t)}`;
  return `<article class="mx-b" tabindex="0" data-key="${key}" data-k="${b.k}" data-sl="${b.sl}" data-tr="${b.tr}">
    <b class="mx-t">${mk(b.t)}</b>
    <p class="mx-d">${mk(b.d)}</p>
    ${b.x ? `<p class="mx-x">↔ ${mk(b.x)}</p>` : ''}
    <footer class="mx-f">
      <span class="mx-kind">${esc(MX.kinds[b.k]?.label || b.k)}</span>
      <span class="mx-slot">${esc(MX.slots[b.sl]?.label || b.sl)}</span>
      <span class="mx-unit">${esc(b.u)}</span>
      ${b.s ? `<span class="mx-src">${mk(b.s)}</span>` : ''}
      <span class="mx-tr" title="Tier ${b.tr}">T${b.tr}</span>
    </footer>
  </article>`;
}

async function renderMx(arg) {
  await loadMx();
  if (!MX) { $('#mx-body').innerHTML = '<p class="fs-none">Could not load the pod.</p>'; return; }
  if (arg && MX.books.some(b => b.id === arg)) mx.book = arg;
  if (mxRead.on) mxRead.stop();

  const bk = mxBook();
  if (mx.unit !== '*' && !bk.units.some(u => u.u === mx.unit)) mx.unit = bk.units[0].u;
  const unit = mxUnit();
  mxSave();
  const q = mx.q.trim().toLowerCase();

  $('#mx-books').innerHTML = MX.books.map(b =>
    `<button class="mx-bk${b.id === mx.book ? ' on' : ''}" data-book="${b.id}" role="tab"
      aria-selected="${b.id === mx.book}"><b>${esc(b.label)}</b><small>${esc(b.sub)} · ${b.n}</small></button>`).join('');
  $('#mx-sel').innerHTML =
    `<option value="*"${mx.unit === '*' ? ' selected' : ''}>▦ All of ${esc(bk.label)} (${bk.n})</option>`
    + bk.units.map(u =>
      `<option value="${u.u}"${u.u === mx.unit ? ' selected' : ''}>${esc(u.sel)}${mx.book === 'joint' ? ` · ${esc(u.tag)}` : ''} (${u.n})</option>`).join('');
  $('#mx-blurb').textContent = mx.book === 'joint' ? (unit.blurb || '') : '';

  // Chip counts come from this section only, so a chip never promises rows it cannot show.
  const all = unit.groups.flatMap(g => g.items);
  const chip = (map, sel, attr, chosen) => Object.entries(map).map(([k, v]) => {
    const n = all.filter(b => b[attr] === k).length; if (!n) return '';
    return `<button class="mx-th" data-${sel}="${k}" data-k="${k}" aria-pressed="${chosen.has(k)}"
      title="${esc(v.hint)}">${esc(v.label)}<i>${n}</i></button>`;
  }).join('');
  $('#mx-kinds').innerHTML =
    `<button class="mx-th mx-all" data-kind="*" aria-pressed="${!mx.kinds.size}"
      title="Every kind of block in this section">All<i>${all.length}</i></button>`
    + chip(MX.kinds, 'kind', 'k', mx.kinds);
  $('#mx-slots').innerHTML =
    `<button class="mx-th mx-all" data-slot="*" aria-pressed="${!mx.slots.size}">All</button>`
    + chip(MX.slots, 'slot', 'sl', mx.slots);
  [...$('#mx-tier').children].forEach(b =>
    b.setAttribute('aria-pressed', String(mx.tiers.has(b.dataset.tier))));
  $('#mx-lensbtn').classList.toggle('on', !!mx.slots.size);
  $('#mx-lens').hidden = !mx.lens;
  $('#mx-lensbtn').setAttribute('aria-expanded', String(mx.lens));

  let shown = 0, words = 0, html = '';
  for (const g of unit.groups) {
    const items = g.items.filter(b => mxPass(b) && (!q || mxText(b).includes(q)));
    if (!items.length) continue;
    shown += items.length;
    words += items.reduce((s, b) => s + b.n, 0);
    html += `<section class="mx-g"><h2>${esc(g.g)}<span>${items.length}</span></h2>`
      + items.map(b => mxBlockHTML(b, mx.q.trim())).join('') + '</section>';
  }
  $('#mx-body').innerHTML = html || `<p class="fs-none">Nothing in this section matches. <button class="mx-inline" data-mxclear>Clear the filters</button></p>`;
  $('#mx-body').querySelectorAll('.mx-b').forEach(el => applyHighlights(el, el.dataset.key));
  const nf = mxFilters();
  $('#mx-count').textContent = (q || nf)
    ? `${shown} of ${all.length} shown here · ${MX.n} across the optional`
    : `${all.length} blocks here · ${bk.n} in ${bk.label} · ${MX.n} in all`;
  $('#mx-left').textContent = `${shown} blocks · ${mxSpokenTime(words)} read aloud`;
  mxJump.build();
}

/* Roughly 150 words a minute at 1×; scale with the chosen speed. Whole sections
   run to hours, so anything past sixty minutes reads as hours, not as 284:29. */
const mxSpokenTime = words => {
  const secs = Math.round(words / (150 * (readSpeed || .9)) * 60) + 1;
  const m = Math.floor(secs / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}:${String(secs % 60).padStart(2, '0')}`;
};

/* ── group navigation inside the section; the select walks whole sections ── */
const mxJump = {
  list: [], cur: '', pend: '', pendAt: 0, queued: false, top: 130,
  build() {
    const secs = [...$('#mx-body').querySelectorAll('.mx-g')];
    secs.forEach((sec, i) => { sec.querySelector('h2').id = `mxx-${i}`; });
    this.list = secs.map((sec, i) => ({ id: `mxx-${i}`, el: sec.querySelector('h2') }));
    this.measure();
  },
  measure() {
    const st = $('#mx-stick'); if (!st) return;
    this.top = Math.round((parseFloat(getComputedStyle(st).top) || 56)
      + st.getBoundingClientRect().height) + 8;
    document.documentElement.style.setProperty('--mxstick', `${this.top}px`);
  },
  go(id) {
    const a = this.list.find(x => x.id === id); if (!a) return;
    this.cur = id; a.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  // Step through the groups of this section, then roll on to the next section.
  step(dir) {
    if (!this.list.length) return mxStepUnit(dir);
    let i = 0;
    for (let n = 0; n < this.list.length; n++) {
      if (this.list[n].el.getBoundingClientRect().top <= this.top + 16) i = n; else break;
    }
    const to = this.list[i + dir];
    if (to) this.go(to.id); else mxStepUnit(dir);
  }
};
function mxStepUnit(dir) {
  const bk = mxBook(); if (!bk || mx.unit === '*') return;
  const i = bk.units.findIndex(u => u.u === mx.unit);
  const to = bk.units[i + dir];
  if (!to) return;
  mx.unit = to.u; renderMx(); window.scrollTo(0, 0);
}
window.addEventListener('scroll', () => {
  if ($('#view-mx')?.classList.contains('active')) mxJump.measure();
}, { passive: true });

/* ══ Read Along ══
   One utterance per SENTENCE, not per block, so the highlighter can track what is
   actually being said. The sentence is marked with a Range through the CSS Custom
   Highlight API — no DOM mutation, so pen marks and search hits survive narration. */
const MXHL = 'mx-speaking';
function mxSentences(el) {
  const nodes = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let text = '', n, part = null;
  while ((n = walk.nextNode())) {
    if (n.parentElement.closest('.mx-f')) continue;   // the footer marks are not read
    // The lead term ends a sentence of its own — it has no full stop, and without
    // a break the highlighter would run it into the opening line of the body.
    const owner = n.parentElement.closest('.mx-t,.mx-d,.mx-x');
    if (part && owner !== part && !/[.!?…]\s*$/.test(text)) text += '. ';
    part = owner;
    nodes.push({ n, at: text.length }); text += n.nodeValue;
  }
  const out = [];
  for (const m of text.matchAll(/[^.!?…]+(?:[.!?…]+["'’”)]*|$)/g)) {
    if (!m[0].trim()) continue;
    out.push({ text: m[0].trim(), from: m.index, to: m.index + m[0].length, nodes });
  }
  return out.length ? out : [{ text: text.trim(), from: 0, to: text.length, nodes }];
}
function mxRange(s) {
  const pick = off => {
    let last = s.nodes[0];
    for (const e of s.nodes) { if (e.at <= off) last = e; else break; }
    return { node: last.n, offset: Math.max(0, Math.min(last.n.nodeValue.length, off - last.at)) };
  };
  try {
    const a = pick(s.from), b = pick(Math.max(s.from, s.to - 1));
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, Math.min(b.node.nodeValue.length, b.offset + 1));
    return r;
  } catch { return null; }
}
const mxPaintSentence = s => {
  if (!('highlights' in CSS)) return;
  const r = s && mxRange(s);
  if (r) CSS.highlights.set(MXHL, new Highlight(r)); else CSS.highlights.delete(MXHL);
};

const mxRead = {
  on: false, paused: false, run: 0, i: 0, si: 0, sents: [], nodes: [],
  collect() { this.nodes = [...($('#mx-body')?.querySelectorAll('.mx-b') || [])]; },
  nearestToView() {
    let best = 0;
    for (let n = 0; n < this.nodes.length; n++) {
      if (this.nodes[n].getBoundingClientRect().top <= mxJump.top + 40) best = n; else break;
    }
    return best;
  },
  start(i) {
    if (!canSpeak()) return this.stop('This browser cannot speak.');
    this.collect();
    if (!this.nodes.length) return this.stop('Nothing to read.');
    if (readAlong) stopReadAlong();
    if (factRead.on) factRead.stop();
    if (compRead.on) compRead.stop();
    feedStop?.();
    this.on = true; this.paused = false;
    this.i = Math.max(0, Math.min(this.nodes.length - 1, i ?? this.nearestToView()));
    this.si = 0; this.speak();
  },
  speak() {
    if (!this.on) return;
    const node = this.nodes[this.i];
    if (!node) return this.stop('End of the section.');
    if (this.si === 0) {
      $('#mx-body').querySelectorAll('.reading-now').forEach(n => n.classList.remove('reading-now'));
      node.classList.add('reading-now');
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.sents = mxSentences(node);
    }
    if (this.si >= this.sents.length) { this.i++; this.si = 0; return this.speak(); }
    const s = this.sents[this.si];
    mxPaintSentence(s);
    const run = ++this.run;
    this.paint();
    const text = cleanSpeech(s.text);
    if (!text.trim()) { this.si++; return this.speak(); }
    const u = new SpeechSynthesisUtterance(text);
    const voice = preferredVoice(speechSynthesis.getVoices());
    u.lang = voice?.lang || 'en-IN';
    u.rate = readSpeed; u.pitch = 1;
    if (voice) u.voice = voice;
    const next = () => { if (this.on && run === this.run) { this.si++; this.speak(); } };
    u.onend = next; u.onerror = next;
    speechSynthesis.speak(u);
  },
  step(dir) {
    if (!this.on) return;
    this.run++; speechSynthesis.cancel();
    this.i = Math.max(0, Math.min(this.nodes.length - 1, this.i + dir));
    this.si = 0; this.speak();
  },
  togglePause() {
    if (!this.on) return;
    this.paused = !this.paused;
    if (this.paused) speechSynthesis.pause(); else speechSynthesis.resume();
    this.paint();
  },
  toggle() { this.on ? this.stop() : this.start(); },
  stop(message = '') {
    this.on = false; this.paused = false; this.run++;
    if (canSpeak()) speechSynthesis.cancel();
    mxPaintSentence(null);
    $('#mx-body')?.querySelectorAll('.reading-now').forEach(n => n.classList.remove('reading-now'));
    this.paint(message);
  },
  // Time left is counted in words still to be spoken — in this group, and in the section.
  paint(message = '') {
    const btn = $('#mx-read'), bar = $('#mx-readbar');
    if (!btn || !bar) return;
    btn.setAttribute('aria-pressed', String(this.on));
    btn.classList.toggle('on', this.on);
    bar.hidden = !this.on && !message;
    if (message && !this.on) { $('#mx-readpos').textContent = message; $('#mx-times').textContent = ''; return; }
    if (!this.on) return;
    const words = el => (el.querySelector('.mx-d')?.textContent || '').split(/\s+/).length;
    const group = this.nodes[this.i]?.closest('.mx-g');
    let gLeft = 0, sLeft = 0;
    this.nodes.forEach((el, n) => {
      if (n < this.i) return;
      sLeft += words(el);
      if (el.closest('.mx-g') === group) gLeft += words(el);
    });
    const total = this.nodes.length, done = this.i;
    $('#mx-readpos').textContent = `${done} of ${total} read`;
    $('#mx-readpause').textContent = this.paused ? '▶' : '❚❚';
    const fill = $('#mx-fill');
    if (fill) fill.style.width = `${total ? Math.round(done / total * 100) : 0}%`;
    $('#mx-times').innerHTML = `<span title="Left in this group">◐ group ${mxSpokenTime(gLeft)}</span>`
      + `<span title="Left in this section">◉ section ${mxSpokenTime(sLeft)}</span>`;
    mxJump.measure();
  }
};

/* ── wiring ── */
$('#mx-books')?.addEventListener('click', e => {
  const b = e.target.closest('[data-book]'); if (!b) return;
  mx.book = b.dataset.book; mx.unit = ''; renderMx(); window.scrollTo(0, 0);
});
$('#mx-sel')?.addEventListener('change', e => {
  mx.unit = e.target.value; renderMx(); window.scrollTo(0, 0);
});
$('#mx-tier')?.addEventListener('click', e => {
  const b = e.target.closest('[data-tier]'); if (!b) return;
  mx.tiers.has(b.dataset.tier) ? mx.tiers.delete(b.dataset.tier) : mx.tiers.add(b.dataset.tier);
  renderMx();
});
$('#mx-kinds')?.addEventListener('click', e => {
  const b = e.target.closest('[data-kind]'); if (!b) return;
  if (b.dataset.kind === '*') mx.kinds.clear();
  else mx.kinds.has(b.dataset.kind) ? mx.kinds.delete(b.dataset.kind) : mx.kinds.add(b.dataset.kind);
  renderMx();
});
$('#mx-slots')?.addEventListener('click', e => {
  const b = e.target.closest('[data-slot]'); if (!b) return;
  if (b.dataset.slot === '*') mx.slots.clear();
  else mx.slots.has(b.dataset.slot) ? mx.slots.delete(b.dataset.slot) : mx.slots.add(b.dataset.slot);
  renderMx();
});
function mxClearFilters() {
  mx.tiers.clear(); mx.kinds.clear(); mx.slots.clear();
  mx.q = ''; const q = $('#mx-q'); if (q) q.value = '';
  renderMx();
}
$('#mx-clear')?.addEventListener('click', mxClearFilters);
$('#mx-body')?.addEventListener('click', e => {
  if (e.target.closest('[data-mxclear]')) return mxClearFilters();
  const b = e.target.closest('.mx-b'); if (!b || !mxRead.on) return;
  if (hlGesture()) return;
  mxRead.collect();
  const i = mxRead.nodes.indexOf(b);
  if (i >= 0) { mxRead.run++; speechSynthesis.cancel(); mxRead.i = i; mxRead.si = 0; mxRead.speak(); }
});
function mxToggleLens() {
  mx.lens = !mx.lens;
  localStorage.setItem('mm-mx-lens', mx.lens ? '1' : '0');
  $('#mx-lens').hidden = !mx.lens;
  $('#mx-lensbtn').setAttribute('aria-expanded', String(mx.lens));
  mxJump.measure();
}
$('#mx-lensbtn')?.addEventListener('click', mxToggleLens);
$('#mx-q')?.addEventListener('input', e => { mx.q = e.target.value; renderMx(); });
$('#mx-stick')?.addEventListener('click', e => {
  const b = e.target.closest('[data-mjump]'); if (!b) return;
  mxJump.step(b.dataset.mjump === 'next' ? 1 : -1);
});
function mxFillVoices() {
  const sel = $('#mx-voice');
  if (!sel || !canSpeak()) return;
  const voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  if (!voices.length) return;
  sel.innerHTML = `<option value="auto-uk-female">Automatic</option>`
    + voices.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  if ([...sel.options].some(o => o.value === readVoiceURI)) sel.value = readVoiceURI;
}
if (canSpeak()) {
  mxFillVoices();
  speechSynthesis.addEventListener?.('voiceschanged', mxFillVoices);
}
$('#mx-speed') && ($('#mx-speed').value = String(readSpeed));
$('#mx-voice')?.addEventListener('change', e => {
  readVoiceURI = e.target.value;
  localStorage.setItem('mm-read-voice', readVoiceURI);
  const rv = $('#read-voice'); if (rv) rv.value = readVoiceURI;
  if (mxRead.on) { mxRead.run++; speechSynthesis.cancel(); mxRead.si = 0; mxRead.speak(); }
});
$('#mx-speed')?.addEventListener('change', e => {
  readSpeed = Number(e.target.value);
  localStorage.setItem('mm-read-speed', String(readSpeed));
  const rs = $('#read-speed'); if (rs) rs.value = String(readSpeed);
  if (mxRead.on) { mxRead.run++; speechSynthesis.cancel(); mxRead.speak(); }
  renderMx();                      // the read-aloud estimates move with the speed
});
$('#mx-read')?.addEventListener('click', () => mxRead.toggle());
$('#mx-readbar')?.addEventListener('click', e => {
  const id = e.target.id;
  if (id === 'mx-readpause') mxRead.togglePause();
  else if (id === 'mx-readnext') mxRead.step(1);
  else if (id === 'mx-readprev') mxRead.step(-1);
  else if (id === 'mx-readstop') mxRead.stop();
});
addEventListener('keydown', e => {
  if (!$('#view-mx')?.classList.contains('active')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target?.closest?.('input,select,textarea,[contenteditable="true"]')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); mxRead.on ? mxRead.togglePause() : mxRead.start(); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); mxJump.step(1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); mxJump.step(-1); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : -1;
    mxRead.on ? mxRead.step(d) : (mxRead.collect(), mxRead.start(mxRead.nearestToView() + d));
    return;
  }
  // [ and ] step syllabus sections; p cycles the paper; t cycles the tier.
  if (e.key === '[' || e.key === ']') { e.preventDefault(); mxStepUnit(e.key === ']' ? 1 : -1); return; }
  if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    const i = MX.books.findIndex(b => b.id === mx.book);
    mx.book = MX.books[(i + 1) % MX.books.length].id; mx.unit = '';
    renderMx(); window.scrollTo(0, 0);
    return;
  }
  if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    const order = ['0', '1', '2', '3'];
    const cur = order.findIndex(t => mx.tiers.size === 1 && mx.tiers.has(t));
    mx.tiers.clear();
    if (cur < order.length - 1) mx.tiers.add(order[cur + 1]);
    renderMx();
    return;
  }
  if (e.key === 'l' || e.key === 'L') { e.preventDefault(); mxToggleLens(); return; }
  if (e.key === '/') { e.preventDefault(); $('#mx-q')?.focus(); }
});

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
  const topic = $('#view-comptopic').classList.contains('active');
  const prev = $('#app-dock [data-dock="previous"]');
  const next = $('#app-dock [data-dock="next"]');
  prev.hidden = next.hidden = !(answer || topic);
  // The compendium walks its own list, filtered exactly as the browser shows it.
  const seq = topic ? compSequence() : (cur ? navSequence(cur.pid) : []);
  const i = topic ? compIndex(seq) : (cur ? navIndex(seq) : -1);
  prev.disabled = i <= 0;
  next.disabled = i < 0 || i >= seq.length - 1;
  document.body.classList.toggle('answer-open', answer || topic);
  const feedOn = $('#view-feed').classList.contains('active');
  document.body.classList.toggle('feed-open', feedOn);
  if (feedOn) syncTopbarHeight();   // after the class lands — it compacts the topbar
}

async function route() {
  const h = location.hash || '#/';
  const [, kind, arg] = h.split('/');
  if (kind !== 'a' && readAlong) stopReadAlong();
  if (kind !== 'facts' && factRead.on) factRead.stop();
  if (kind !== 'mx' && mxRead.on) mxRead.stop();
  if (!(kind === 'c' && h.split('/').length > 3) && compRead.on) compRead.stop();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.body.dataset.mode = mode;
  document.body.classList.remove('sb-open');
  $('#back').hidden = h === '#/';
  $('#btn-sb').hidden = kind !== 'a';

  if (kind !== 'feed' && feed.playing) feedStop();

  if (kind === 'feed') {
    $('#view-feed').classList.add('active');
    if (feed.src === 'facts') await loadFacts();
    else await Promise.all((feed.pid === 'all' ? ORDER : [feed.pid]).map(loadAnswers));
    feedPaintBar();
    renderFeed();
  } else if (kind === 'c') {
    await loadComp();
    const [, , cpid, cn] = h.split('/');
    if (cpid && cn !== undefined) { $('#view-comptopic').classList.add('active'); renderCompTopic(cpid, cn); }
    else { $('#view-comp').classList.add('active'); await renderComp(); }
  } else if (kind === 'hl') {
    $('#view-hl').classList.add('active');
    renderHighlights();
  } else if (kind === 'mx') {
    $('#view-mx').classList.add('active');
    syncTopbarHeight();
    await renderMx(arg);
  } else if (kind === 'facts') {
    $('#view-facts').classList.add('active');
    syncTopbarHeight();          // the frozen block and the rail hang off the topbar
    await renderFacts(arg);
  } else if (kind === 'n') {
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
    renderHighlights();      // refreshes the Highlights entry's count and visibility
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
  else if (b.dataset.dock === 'feed') go('#/feed');
  else if (b.dataset.dock === 'facts') go('#/facts');
  else if ($('#view-comptopic').classList.contains('active')) compMove(b.dataset.dock);
  else dockMove(b.dataset.dock);
};
$('#go-notes').onclick = () => go('#/n');
$('#go-facts').onclick = () => go('#/facts');
$('#go-mx').onclick = () => go('#/mx');
$('#go-comp').onclick = () => go('#/c');
$('#go-feed').onclick = () => go('#/feed');

/* ── feed wiring ── */
$('#feed-src').onclick = e => {
  const b = e.target.closest('button[data-src]'); if (!b || b.dataset.src === feed.src) return;
  feed.src = b.dataset.src;
  localStorage.setItem('mm-feed-src', feed.src);
  route();                       // the source decides which data the route loads
};
$('#feed-paper').onchange = e => {
  if (feed.src === 'facts') {
    feed.fpid = e.target.value; feed.kind = 'all';
    localStorage.setItem('mm-feed-fpaper', feed.fpid);
    feedPaintBar(); renderFeed();
    return;
  }
  feed.pid = e.target.value; feed.theme = 'all';
  localStorage.setItem('mm-feed-paper', feed.pid);
  go('#/feed'); route();
};
$('#feed-theme').onchange = e => { feed.theme = e.target.value; renderFeed(); };
$('#feed-kind').onchange = e => { feed.kind = e.target.value; renderFeed(); };
$('#feed-tier').onclick = e => {
  const b = e.target.closest('button[data-tier]'); if (!b) return;
  feed.tier = feed.tier === b.dataset.tier ? null : b.dataset.tier;
  feedPaintBar(); renderFeed();
};
$('#feed-diag').onclick = () => { feed.diagOnly = !feed.diagOnly; feedPaintBar(); renderFeed(); };
$('#feed-shuffle').onclick = () => {
  feed.shuffle = !feed.shuffle;
  localStorage.setItem('mm-feed-shuffle', String(feed.shuffle));
  feedPaintBar(); renderFeed();
};
$('#feed-scroll').addEventListener('scroll', () => {
  const s = $('#feed-scroll');
  if (s.scrollTop + s.clientHeight * 2 > s.scrollHeight) feedAppend();
}, { passive: true });
$('#view-feed').addEventListener('click', e => {
  const b = e.target.closest('.fq-act'); if (!b) return;
  const sec = b.closest('.fq'); const qid = sec.dataset.qid;
  const onFact = sec.classList.contains('fq-fact');
  if (b.dataset.act === 'done') { const on = store.toggleDone(qid); b.setAttribute('aria-pressed', String(on)); }
  else if (b.dataset.act === 'play') feedTogglePlay();
  else if (b.dataset.act === 'copy') {
    const t = [...sec.querySelectorAll('.fc-term,.fc-fact,.fc-src')].map(n => n.textContent).join(' — ');
    navigator.clipboard?.writeText(t).catch(() => {});
    b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 900);
  }
  else if (b.dataset.act === 'open') {
    feedStop();
    go(onFact ? `#/facts/${qid.split(':')[1]}` : `#/a/${qid}`);
  }
});
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
  else { paintDock(); renderSidebar(cur); paintAnswerCount(); }
};
// Tier chips: toggling one filters Prev/Next, the sidebar and Read Along to that
// tier (all sections). Clicking the active chip clears it, restoring the theme.
$('#answer-tier').onclick = e => {
  const b = e.target.closest('button'); if (!b || !cur) return;
  answerTier = answerTier === b.dataset.tier ? null : b.dataset.tier;
  paintTierToggle();
  const seq = navSequence(cur.pid);
  if (seq.length && !seq.some(r => r.qid === cur.qid)) go(`#/a/${seq[0].qid}`);
  else { paintDock(); renderSidebar(cur); paintAnswerCount(); }
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
  paintDock(); paintAnswerCount();
  // Expand (or collapse) the inline branch panels to match — reuse each panel's
  // own toggle so unfilled bodies get their answer rendered on expand.
  $('#answer').querySelectorAll('.bitem').forEach(it => {
    const isOpen = !it.querySelector('.bbody').hidden;
    if (readBranches !== isOpen) it.querySelector('.bhead').click();
  });
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
  // Sketch/map view-hide toggle nested inside a diagram dialog.
  const sk = e.target.closest('.dg-sketch-btn');
  if (sk) {
    e.stopPropagation();
    const panel = sk.nextElementSibling;
    const show = panel.hidden;
    panel.hidden = !show;
    sk.classList.toggle('on', show);
    sk.textContent = (show ? '✕ ' : '▤ ') + (sk.dataset.label || 'Sketch / map');
    return;
  }
  if (hlGesture()) return;                 // finishing a highlight must not start narration
  const target = e.target.closest('.qtitle, .intro, .bh, .pt, .diag, .wf, .conc, .nowrite');
  if (!target) return;
  const index = speechParts().findIndex(part => part.node === target);
  if (index < 0) return;
  if (!readAlong) { readAlong = true; paintReadAlong('Preparing narration…'); }
  startReadAlong(index);
});
addEventListener('keydown', e => {
  if (e.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
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
  if ($('#view-comptopic').classList.contains('active')) {
    if (e.code === 'Space') { e.preventDefault(); compRead.on ? compRead.togglePause() : compRead.start(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); compMove('next'); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); compMove('previous'); return; }
    if (compRead.on && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); compRead.step(e.key === 'ArrowDown' ? 1 : -1); return;
    }
    return;
  }
  // In the bank: Space starts or pauses narration, ↑/↓ step entry by entry.
  if ($('#view-facts').classList.contains('active')) {
    if (e.code === 'Space') {
      e.preventDefault();
      factRead.on ? factRead.togglePause() : factRead.start();
      return;
    }
    if (factRead.on && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); factRead.step(e.key === 'ArrowDown' ? 1 : -1); return;
    }
    return;
  }
  // In the feed the two axes are literal: ←/→ move within one answer's cards,
  // ↑/↓ move to the next question. Space toggles autoplay.
  if ($('#view-feed').classList.contains('active')) {
    if (e.code === 'Space') { e.preventDefault(); feedTogglePlay(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); feedStop(); feedMoveCard(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); feedStop(); feedMoveCard(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); feedStop(); feedMoveQuestion(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); feedStop(); feedMoveQuestion(-1); }
    return;
  }
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
