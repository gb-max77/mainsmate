# MainsMate content enrichment — working instructions

Working notes for the multi-session pass raising every T1 (priority-tier) model
answer to genuine UPSC AIR-1–20 standard. Written so the task can resume cleanly
in a fresh session/context window.

## Objective (user's own words)

> add any additional points, concepts, value additions, analysis, IMPORTANTLY —
> subject/paper specific additions and methods. do not go beyond planned word
> limits. seamlessly integrate content with existing answers — it should not be
> presented separately as a current addition. refine, enrich and make answers
> High Scoring UPSC topper expert level — should make me score AIR 1-20 if
> replicated in exam.

## Scope and order (user-set, do not reorder without asking)

**Priority tier only (T1)** across all papers, section by section within each
paper. Order: **PubAd I → PubAd II → push → GS-3 → GS-2 → push → GS-1**.
(Essay/GS4 not yet scheduled — ask before starting them.)

T1 counts per paper (main questions; branches not yet in scope):
- PubAd I: 68 T1 — **DONE, deployed (v7)**
- PubAd II: 63 T1 — **next**
- GS-3: 29 T1
- GS-2: 46 T1
- GS-1: 37 T1
- (GS-4: 36 T1, Essay: 7 T1 — out of current scope)

**Deploy cadence:** push after PubAd I + PubAd II together are both done (user
said "push at end of PubAd1" for the first half, then continue to GS papers
before another push — confirm cadence per-paper if ambiguous, default to
"push when a full paper's T1 pass is complete").

## Method (repeat per section)

1. Read the section's T1 answers from `data/answers/<pid>.json` + word band
   (`wmin`–`w`) from `data/questions.json`.
2. Classify each:
   - **Good** — leave, or 1–2 surgical adds (Indian bridge, a thinker, a current
     scheme/data point, a diagram).
   - **Enrich** — swap a weak/generic point for a real value-add; keep in band.
   - **Rewrite** — template-broken or wrong-content body (see defect below).
3. Apply via a scratchpad Python script that mutates the JSON in place and
   prints a word-count audit table. Always `git checkout data/answers/<pid>.json`
   before re-running a script so edits are idempotent.
4. **Facts must be real and verifiable** — no invented committees, cases,
   articles, data. Omit rather than fabricate.
5. Add a **flip diagram** only where a body *section* naturally maps to a
   flow/hub/cycle/tree AND its nodes can carry that section's full content (no
   leakage — user will handwrite from it). Most analytical answers get none.
6. Commit per section/batch (local). Push only per the cadence above.

## Known defect pattern (check every paper)

A batch of answers (in PubAd I: `pubad1-86` through `pubad1-97`, 12 answers)
were auto-generated **template boilerplate** that doesn't answer the question —
tell-tale point keys: `"Disciplinary anchor"`, `"Constitutional Morality"`,
`"Rights Capacity"`, `"Federal Consultation"`, `"Waldo–Simon test"`,
`"Institutional Balance"`, `"Transparency By Design"`, `"Indian application"`
(generic, not question-specific), identical boilerplate conclusion across
different questions. **Check every paper for this pattern before assuming
answers only need light enrichment** — grep for `"Disciplinary anchor"` or
`"Federal Consultation"` as a fast detector. These need full rewrites, not
enrichment. Also watch for: wrong-content bodies (body answers a different
question than the stem), contaminated intros (copy-pasted from an unrelated
answer), and malformed/duplicated points (empty `k`, or a point whose `k`
repeats the section heading, e.g. `"X — Section Name"`).

## Word-band discipline (the recurring failure mode)

**I consistently under-write full rewrites on the first pass**, landing
15–45 words under the floor, especially on 15/20-markers. Budget accordingly:
- 10m → 6–7 points across 2 sections
- 15m → 9–10 points across 2–3 sections
- 20m → 12–14 points across 3 sections (this is where I under-write most —
  budget 4+ points per section from the start, not 3)

Always run the audit script after every batch; if under, add real points
(don't pad prose) until inside `wmin`–`w`; if over `w×1.05`, trim connective
tissue first, cut facts last.

## Diagram feature (built, do not rebuild)

- Per-section **flip button** (`.seg-flip`) sits on the section's own `<div
  class="bh">` heading — flips that section's bullets to a diagram and back,
  in place, like a card.
- Diagram types: `flow` (A→B→C), `cycle` (flow + loop glyph), `hub` (center +
  spokes), `tree` (root + branches). Schema: `a.diag = {type, seg, title,
  center, nodes:[...], note}` (or an array of these for multiple diagrams per
  answer). `seg` = 0-based index into `a.body[]`.
- **No leakage rule:** node text must carry that section's real content
  (not just a short label) since the diagram fully replaces the bullets when
  flipped. Keep compact — well under half a page.
- Only appears in **Model Answer** view, not Scan. Read Along is completely
  independent — it reads `.pt` text from the DOM regardless of flip state.
- Only add where a section is a *genuine* process/structure/timeline — most
  analytical answers should have none. Don't force one.

## Verification per batch

```bash
python3 -c "import json; json.load(open('data/answers/<pid>.json')); print('OK')"
```
Word-band audit is printed by each batch script — confirm every answer inside
`wmin`–`w` (small tolerance up to `w*1.05` acceptable, prefer inside `w`).

Spot-check rendering on a **fresh port** (the service worker aggressively
caches `127.0.0.1:<same-port>` across edits — always use a new port per
session to see real changes):
```bash
python3 -m http.server <new-port> --bind 127.0.0.1 &
```
Open `#/a/<qid>` in the Browser pane, check Model Answer + Scan render, flip
diagram (if any) is content-complete, console has zero errors.

## Deploy

```bash
sed -i '' "s/mainsmate-vN/mainsmate-vN+1/" sw.js   # bump cache
git add -A && git commit -m "..."
git push origin main
# poll until live:
curl -s https://gb-max77.github.io/mainsmate/sw.js | grep -o "mainsmate-v[0-9]*"
```

## Status (update this section as work proceeds)

- [x] Diagram feature built, corrected (flip-card in place, per-section button,
      content-complete, Read-Along-independent), deployed.
- [x] 4 cross-paper calibration samples enriched (gs2-1, gs3-1, pubad1-2,
      pubad2-4) with the user's sign-off on depth/style.
- [x] **PubAd I: 68/68 T1 complete** — enriched or rewritten, all in band, 0
      template-broken remaining. Deployed live (v7).
- [x] **PubAd II: 63/63 T1 complete** — only 4 mains were template-broken
      (93-96, rewritten); rest were strong, needed only artifact/headless
      cleanup + 2 ceiling trims. 0 out-of-band, 0 template-broken. Deployed (v9).
- [ ] GS-3: 0/29 T1 — next up.
- [ ] GS-2: 0/46 T1 — push after this one per user's stated cadence
- [ ] GS-1: 0/37 T1
- Note: GS papers may or may not share the PubAd template defect — run the
  detector first (grep `"Disciplinary anchor"` / `"Federal Consultation"`, and
  the structural detector for artifact/headless/empty points).

## Live site

https://gb-max77.github.io/mainsmate/ — repo `gb-max77/mainsmate`, GitHub
Pages from `main`. PWA + site, day/night themes, Model Answer/Scan views, Read
Along (TTS, spacebar, voice/speed, flip-independent), tier-filterable
navigation (T1/T2/T3 toggle — see below), flip diagrams.
