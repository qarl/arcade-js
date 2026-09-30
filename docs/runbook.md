# Runbook — porting an arcade game, start to finish

**This is the authoritative, self-contained procedure.** Execute it top to bottom. Where it conflicts
with any other `docs/` file, **this runbook wins**, and it is where the process is tweaked going
forward. The goal: turn a ROM into validated, *understood* JavaScript that renders pixel-exact against
MAME — with no decision kicked to a human.

## The two governing rules

- **Novel decision (no rule below covers it):** ground it in **MAME** (never the JS engine), pick the
  **truthful/conservative** reading, **act** (a parked decision is a dropped decision), and **write the
  new rule into this runbook** so it sticks.
- **Feedback loop:** every process miss found on a port becomes a baked-in step here *before* the next
  port. This document is the living method; it gets sharper each game, never stale.

## Standing discipline (applies to every step)

**Keep going — don't stop.** Drive the work to done autonomously: a landed milestone or a green gate is
never a stopping point, and neither is any decision, validation, or sign-off: **there is no human in
this loop.** The system makes every call itself — grounded in MAME, the truthful/conservative reading,
act. Nothing is human-only: audio and the deepest gameplay test are validated against MAME BY THE SYSTEM
(below), not a human ear or eye. The only legitimate wait is on the system's OWN in-flight work (a build,
a review, a golden capture); resume the instant it reports and drive every OTHER track meanwhile. After a unit lands, launch the next in-order work the SAME turn;
never end on a status-and-wait. Set the idle-timer as a keep-going backstop.
Commit **and push** each unit; the system gates its own push (pre-push suite + independent review), no
human in the loop. ROM is **never** committed
(bring-your-own, sha256-verified). Stage **explicit paths** (never `git add -A`); python not sed for
identifier renames; never `--no-verify` without per-commit approval. Work **in batches — ~15 agents ×
3–4 routines each (≈50/batch); fan aggressively**, **one commit per batch, single-threaded** (don't
author the next batch while one is under review), and **fan the review at the same scale** (≈1 agent per
8 routines). Never retreat to one-routine-at-a-time when a batchable pool exists. **A "coordinated
refactor" or an "ABI seam" is NOT a synonym for un-fannable: decompose it to its fannable UNIT — a
caller/callee cluster, a shared callee, a single-owner shared cell — and fan THAT. A flat per-file fan
stalling is evidence of the wrong unit, never proof the work is serial** (the legacy-retrofit
register-seam miss, 2026-09-20; the fan-out method is in §4). Every commit gets an
**independent reviewer** — a gate is not a review; run the repo's gates *before* the reviewer, and
verify a reviewer's *reasons*, not just its ruling. **Grounding always uses MAME, never the JS engine**
(self-grounding is circular). **Author ≠ checker** — mutation-test every routine. **Quote from a command
you just ran, never recollection; no derived counts in commits/docs/prose.**

---

## 0 — Set up and know the game

- Build a properly-named, `-verifyroms`-verified romset first (a loose chip dump lacks the `.icNN`
  names verify needs). Symlink/read the MAME driver locally
  (`mame-src/src/mame/<manufacturer>/<driver>.cpp`) — never a web summary.
- Stand up the MAME observation rig (per-frame RAM dump + poke/input harness) on day zero.
- Write `games/<game>/gameplay.md` — outside-in, from **public sources only, blind to the ROM**
  (objective, cast, controls, win/lose, boards). Flag single-source/contradictory items and expect play
  to overturn some. This adjudicates mechanics the code can't settle later.
- Do the behavioural grounding **day-zero, before any naming** — running it late forces re-deriving
  every name chosen at partial understanding.

## 1 — Identify the machine

Three layers: **CPU** (`core/cpu/<chip>.js` — reuse or new), **board** (`boards/<driver>/`, named after
the **MAME driver**, shared by games on that PCB), **game** (`games/<id>/` = manifest + lift).

- Read the driver `.cpp` for the memory map, I/O ports (active-low vs -high), interrupts/watchdog,
  palette/PROM decode, DMA. Get **every address and offset** from the driver's memory-map *and* its
  video/draw code — never by inference (a guessed sprite base / scroll base / plane order / mirror mask
  is where subtle bugs hide). Verify every hardware fact against MAME source, not a listing.
- **Copy the exact MAME `ROT` into the manifest — never a `"vertical"`/`"horizontal"` boolean.** `ROT90`
  = 90° CW, `ROT270` = 90° CCW; a boolean keeps "portrait" but throws away *which way* and renders 180°
  wrong.
- A **read and a write at one address are different devices**; a read may have a side effect (watchdog
  kick, coin-counter clock); an LS259 control latch is **one address per bit**. State these invariants in
  the board source up front.
- Model the board from the ROM's own accesses; pin video addressing against the driver's draw routine
  and **cite it in the board source** — a render-addressing offset is invisible to the state diff and
  only the pixel gate catches it. Pin reset facts (CPU reset registers, IX/IY) and `cyclesPerFrame` from
  the pixel clock. The frame origin is the **vblank point** (the interrupt lands at frame N.000x); don't
  confuse the first visible raster line with the vblank offset.
- Model the **WHEN**, not just the WHAT: a DMA sprite transfer **costs the CPU time** (bus stolen —
  derive the per-byte cost), or the CPU reaches later routines early. Derive device direction/behaviour
  from the ROM (which region it writes heavily vs once), not the datasheet.
- `boards/<driver>/hardware.json` declares state-dump regions, MMIO, screen size, driver name, frame
  timing; a drift test asserts it matches `memory.js`/`io.js`.

## 2 — Skeleton first

Stand up a bootable machine and its gates *before* any routine work, so every later gate measures the
real running game, not attract mode.

- Manifest: cpu, board, ROM images + sha256, `inputs` (ports/actions/keys — **coin/start are not always
  the same port**), `entropyPin`, exact ROT. Register the id in `games/registry.js`. Makefile `rom`
  target.
- Board layer (`memory.js`/`io.js`/`video.js`/`hardware.json`): **every unimplemented I/O stub THROWS,
  never returns 0** — a silent 0 is indistinguishable from correct until a pixel diff fails hundreds of
  frames later; throwing turns "not implemented" into a self-naming coverage signal. State lives at its
  real address (the RAM arrays are what gets diffed vs MAME).
- **The game runs on the generator engine `runIdiomaticGame` from the start** — a clock-free engine whose
  frame boundary is the ROM's own vblank-wait yield. Until routines are rewritten it runs **entirely on
  the translated fallback** (`resolveAllIdiomatic` supplies the translated routine for anything not yet
  done), so it is always a complete runnable game. There is no separate "make it live" milestone. Declare
  `manifest.convergence.idiomatic.nmiReturnPC` (the ROM PC the vblank NMI returns to — the main-loop top):
  the engine sets it before firing each NMI, and the browser worker refuses `runtime: "idiomatic"` without
  it.
- **Plumb `--input`, `--poke`, and `--pin` into `render.js` in this first pass**, not once the layer
  "looks done." `io.inputAssert` = `{portAddr: pressedBits}`; apply inputs/pokes at the frame boundary
  before the state dump; `emit.js` forwards tape/pokes. Tapes in **pressed-bit** form even on active-low
  hardware; rebuild the assert map each frame; apply inputs for frame 0 too. The MAME-vs-JS frame origin
  differs, so the same tape lands at a different emulated frame per side — the offset is a per-game
  **constant you MEASURE** and write beside the tape. Find input bits empirically (press each bit, diff
  the whole run vs a no-input baseline of identical call structure).
- `mame_golden.py` captures the reference (video/sound off, no throttle/frameskip, fresh nvram+cfg, no
  autosave; self-checked, fails closed); `emit.js` emits the same three formats from the JS machine and
  exits non-zero on a partial run. **Diff order = state → writes → pixels** (state differs ⇒ CPU/logic;
  state matches but pixels differ ⇒ video model; writes catch timing the snapshots miss).
- **Build the whole-machine equivalence gate in the FIRST unit** (while there's one routine to bisect)
  and **commission it to FAIL** — break it deliberately (a plausible wrong twin, one wrong byte, a leak
  under a loose window, the seam adapter removed) and keep the teeth running. A gate scoped to one routine
  cannot observe an assembled-system property — a leak in a shared helper or a dropped return at the
  dispatch seam is invisible to it; build it whole-machine, and a gate built to pass is decoration.
- **Run the whole-machine state diff continuously — it is the worklist**: boot, see where it diverges, fix
  that routine, boot again (`emit.js` names the next boot gap). There is no standalone CPU interpreter, so
  the only way to execute is the running layer → the gate is forced boot-first.
- **Turn the pixel gate on now and keep it green for the layer's life** (a precondition, not a capstone).
  Declare the game's suite in `tools/pixel_gate_required.py` (an undeclared game's commit is refused). The
  interlock requires the literal `PASS` line; SKIP/INCOMPLETE/FAIL/crash/timeout all count as refusal —
  **never trust the suite's exit code** (it exits 0 when it can't run). **One narrow exception — a missing
  romset:** when a commit must touch a game whose romset this machine does not have (a shared-tool change
  that edits every suite), `python3 tools/pixel_gate_required.py skip-romset --game <g> --reason "..."`
  records a single-use waiver bound to the staged diff and appends (and stages) `<g>` to
  `tools/pixel-rerun-owed.txt`. The gate honours it only for that game, only for that exact staged diff,
  and only when the suite's last line is a romset-missing SKIP (never FAIL/INCOMPLETE/crash/timeout/no-mame);
  it prints `<g> SKIPPED -- romset missing -- NOT validated ... RE-RUN OWED` and never a PASS for `<g>`.
  While the ledger has a line, **every** gate run prints it. Remove a line by hand, and only after
  `pixel_gate_required.py run <g>` PASSes: the commit that deletes it re-runs `<g>`'s suite and is refused
  unless it PASSes (the gate does not edit the ledger itself — a hook that rewrites and restages files
  changes the very diff it is checking; the deletion stays a reviewed line). Which layer the gate renders vs
  MAME is a **CLI switch** (`render.js --idiomatic` vs the translated path), never `manifest.runtime`.
  Confirm the render path paints **sprites**, not just the tilemap. **Bootstrapping a NEW game:** it cannot
  render a frame matching MAME until translation reaches a rendering state (the boot must clear its
  computed-jump dispatchers), so add a TEMPORARY, checkable `EXEMPT` entry for the game in
  `pixel_gate_required.py` (reason: mid-translation, no rendered frame yet — a reviewer verifies by booting
  it to an unregistered-routine gap) and **REMOVE it, declaring the real suite, at the first rendered
  frame.** That removal trigger is a **live checklist item, not a code comment** — re-test the render
  precondition every batch (does the boot reach a drawn frame yet?); a temporary waiver turns permanent the
  moment its exit condition stops being watched. Track it by *does it render vs MAME yet*, **never by
  routines translated** — the primary-goal gate outranks lift throughput.
- `make verify` is **not** the pixel gate (it is a disassembly decoder check for another game's ROM).

### Building the pixel gate (the mechanics behind "turn it on now")

The gate is a JS render diffed byte-for-byte against a freshly captured, self-certified MAME golden.
Stand up these pieces in the skeleton; none of them needs a finished layer.

- **The JS render emitter (`games/<id>/tools/render.js`).** Instantiate the machine, run the frames, and
  write a raw frame dump `frames.rgb` (screen_w × screen_h × 3 bytes per frame, RGB888, no header) plus a
  `frames.json` manifest carrying a per-frame sha256. **Paint at the point the player sees** — the vblank
  yield for the idiomatic layer, the plain frame loop for the translated oracle — and exit **non-zero** on
  any boot gap, dropped frame, or short run, so a truncated artifact is never diffed.
- **The certified golden (`tools/mame_golden.py`, shared).** It drives MAME headless with a pinned,
  determinism-controlled command line (video/sound off, no throttle, `-frameskip 0`, fresh empty nvram+cfg
  per run, no autosave — two runs must be byte-identical) and converts the AVI to the same raw
  `frames.rgb`. Two ffmpeg conversions are mandatory: MAME's AVI is **bgr24**, so `-pix_fmt rgb24` is
  required or every frame differs by a swapped R/B that looks like a palette bug; and `-map 0:v:0` is
  required because MAME writes an audio stream even under `-sound none`. The tool **self-certifies and
  fails closed** — a frame-count mismatch or a mid-capture watchdog reset (the boot image recurring *after*
  content first appears) exits non-zero rather than hand back quietly-wrong data. The golden is
  ROM-derived; **never commit it.**
- **Per-game capture inputs.** `mame_golden.py` is game-agnostic: it takes the board from
  `--hardware boards/<board>/hardware.json` and the RAM dumpers from `--lua-dir games/<id>/tools/lua/`.
  Write a `dump_state.lua` that dumps the state that gets diffed (work RAM + VRAM + sprite/object RAM at
  their real addresses). **Ground the board's I/O in `hardware.json`** — the control-latch byte and DSW
  expected values read off MAME, input idle values from the dip-switch defaults — and enforce each where
  it is checked: the board unit tests assert the input/DSW values, and `mame_golden.py`'s config probe
  rejects any capture whose control byte disagrees (a wrong control byte silently poisons every golden).
- **Delete the raw dumps after the verdict.** Wrap the suite's work in `tools/raw_dumps.py`'s
  `raw_dumps(...)` (a temp dir with `rmtree=True`, a `--work` dir swept) and give it `--keep-frames`; an
  ad-hoc capture-and-diff runs under `python3 tools/raw_dumps.py run --dir <out> -- <command>`.
  `tools/test/raw-dumps.test.js` fails a producer-driving script that skips it (docs/mame-golden.md).
- **Measure the frame offset; never hardcode it.** MAME's AVI lags the JS render by a per-game constant
  (one frame is typical: `render[N] == golden[N+1]`). Sweep a small window of offsets and pick the one
  that minimises total differing pixels, so a drift either way shows up instead of being assumed.
- **One tight band, fail-closed.** After aligning, the verdict is a single full-frame pixel budget set
  just above the measured **correct-layer floor** (a few pixels of mid-frame beam residual) and far below
  one 8×8 tile — loose enough for the known residual, tight enough that a wrong sprite blows past it. Guard
  it with a positive control: require a minimum count of **distinct** frames on both sides so a frozen or
  black screen cannot pass by matching nothing. Print the literal `pixel_suite: PASS` only on a clean
  comparison; every cannot-compare path exits non-zero.
- **Expand the frame count — the fast gate is a tripwire, not coverage.** The default `SECONDS` window
  (`pixel_suite.py --seconds`, ~10 s) is a per-commit REGRESSION check, NOT a done-proof: a defect can hide
  just past it. Before a game is DONE, pixel-validate the **full attract cycle AND gameplay** — expand
  `--seconds` to cover ≥1 complete attract loop, and drive an input tape from `games/<game>/tapes/`
  (`mame_golden.py --tape`, `render.js --inputs`) to cover play.
  Run the pixel gate against MAME for a **FULL ~10-MINUTE golden — and treat that long run as a DUAL check,
  completeness AND correctness.** Capture ONCE (`mame_golden.py --seconds 600`, ~36k frames) and reuse it
  as the boot deepens batch by batch; ROM-derived, gitignored (never commit).
  - **(1) COMPLETENESS — the biggest trap.** Run the oracle/boot the FULL golden length; a translation gap
    anywhere in it means a routine reached only in a **deep gameplay state** is still untranslated, and
    **neither a static call-graph closure NOR a short boot will find it.** A dispatch-table handler whose
    `DISPATCH_TABLE_` constant lists no entries is invisible to the static closure and can sit unreached
    until deep in the full golden. The long boot-gap crawl is the only trustworthy §3-completeness signal.
  - **(2) CORRECTNESS** — the pixel/state diff over the whole run.
  State is cheap (~48 MB at 180 s) and `tools/golden_mp4.py compress <dir> --drop-rgb` shrinks frames.rgb
  ~300× to a byte-exact lossless `frames.mp4` (~6 MB at 180 s, ~20 MB at 600 s; verified against the
  frames.json sha256, fails closed); `golden_mp4.py decode <dir>` regenerates frames.rgb before a diff.
  Keep the full 10-minute frames golden; `--no-frames` (state-only) is a quick spot-check, NEVER the
  done-proof. 10 minutes is a **FLOOR, not a ceiling** — extend it for a game with states reachable only
  much later (a late level, the attract-loop wrap); pick the length from where the deepest state the game
  can enter actually occurs, never a fixed count.
  **The fixed-offset compare aligns only within ONE landmark segment.** The "collapse pure delay, align on
  a landmark" model runs the attract cycle faster than MAME, so the offset SHIFTS at the loop wrap; a single
  swept offset breaks there even when the layer is correct. An extended / cross-loop / gameplay run must use
  the **drift-tolerant reconverge rule** (`tools/convergence.mjs`, nearest-golden-frame over the whole
  golden), never the fixed `pixel_suite` offset. Settle any cross-loop divergence with reconverge (or a
  longer golden that contains it) before ruling it a bug.
- **Wire it in and drop the waiver.** Declare the suite in `SUITES` in `pixel_gate_required.py` and remove
  the game's `EXEMPT` entry. The gate invokes each suite with `--layer {oracle,idiomatic}`; a
  translated-only game accepts the flag and renders the oracle for both until an idiomatic render exists.
- **Gotcha — the comment cap can block the golden edit.** `mame_golden.py` is a shared tool that documents
  external-system quirks, so it can sit over the comment-density cap; editing an over-cap file trips the
  whole-file freeze by design. Bring it under the cap first (relocate the long rationale to a doc,
  preserving every load-bearing note) as its own prerequisite unit, then make the change.

## 3 — Translation pass (disassemble + faithful lift → the frozen oracle)

- Disassemble with **reachability-driven recursive descent** from the real entries (reset and NMI
  vectors) — a linear sweep decodes data as garbage. Cross-check the tracer against **what MAME proves is
  code** (a coin+play executed-instruction trace); the tracer alone can miss executed addresses.
- **Build the WHOLE call graph UP FRONT with `tools/callgraph.py` — do NOT discover routines
  one-at-a-time off the boot gap.** The boot-gap crawl (translate until `m.call` throws, translate the
  gap, repeat) is a reachability *oracle* — reliable but strictly sequential. A one-pass static extractor
  recovers ~all of the routine set before any lift. It must do four things plain recursive descent does
  not:
  1. **Recover the ONE computed-jump that is a code table: `rst 0x28`.** Its handler (0x0028) does
     `pop hl`, so the word table is **inline** — the base is the bytes RIGHT AFTER the rst (the address the
     rst pushed), NOT a preceding `ld hl,nn`. Index by A; bound the length by the `and mask` / `cp N` guard
     just before the dispatch (or where the words leave the code range); read every word and add each to
     the entry set. ⚠ `rst 0x20` and `rst 0x10` are NOT code-table dispatches: `rst 0x20` is a **byte-table
     LOOKUP returning A** (its table is DATA) and `rst 0x10` is a block-fill helper — treat both as ordinary
     page-zero calls (flow continues) and decode their tables as data, or you inject the data-as-code
     cascade item 4 warns about.
  2. **Flag mid-routine entries.** A `call`/`jp` target that lands *inside* an already-decoded routine's
     `[start,end)` is a **second entry point** → its own `loc_<addr>` (re-emitting the shared tail), never
     folded into the parent.
  3. **Derive data-vs-code from REACHABILITY — never a hand-maintained exclusion list.** A stale "this is a
     latch/data" guess is precisely what hides a real routine (a routine wrongly hand-listed as a
     non-routine can still have a literal `m.call` to it). Unreached bytes are data; reached bytes are code.
     Full stop.
  4. **Report the irreducible residue explicitly** — arithmetically-computed `jp (hl)` with no static
     table, self-modifying code. It is small; resolve those few by MAME executed-trace, not by crawling.
  ⚠ **NO static count is a completeness proof — the FULL-LENGTH boot-gap crawl (§2, the ~10-minute golden)
  is the only one.** The raw `--frontier` OVER-COUNTS (data decoded as code). The m.call closure (distinct
  `m.call` targets + recovered rst-28 table entries minus the registry) is a useful WORKLIST but it
  UNDER-counts: it is blind to any dispatch-table handler whose `DISPATCH_TABLE_` constant lists no entries.
  Use the closure to SCOPE the next batch, but **prove §3 done only by running the oracle the FULL 10-minute
  golden with zero translation gaps** — the deep gameplay states a short boot never enters are exactly where
  the last routines hide.
- Translate each routine one instruction at a time via `m.step(addr, tstates)` — `addr` is the **next**
  instruction (where execution lands). Charge T-states exactly (video depends on *when* each write lands;
  `stepcheck`/`stepaudit` audit it). Keep flags exact (BCD/half-carry/parity/signed); pin each flag helper
  against the reference CPU before use. Model control flow honestly (a tail-jump discarding the return →
  return to the caller's caller; an rst-dispatch → switch on the state byte).
- Name every translated routine **`loc_<addr>`** — no `sub_`/`handler_` prefixes, no English. **One file
  per routine** (`loc_<addr>.js` + `equivalence-<addr>.test.js`). **Export every routine from line one**
  (the idiomatic rewrite reuses the oracle's copy of any un-rewritten callee — exactly one copy). Write
  every call as **`m.call(0xADDR)`** (the registry seam is what makes a routine isolable for
  capture/replay); keep `push16`/`step` at the call site.
- Boundaries: an externally-entered `loc_<addr>` is a routine boundary → one file; the parent stops at
  boundary-1 and **delegates** (`return m.call(0xBOUNDARY)`), never inlines across it. Partition the lift
  by **range, not filename** (walk control flow to a real terminator; subtract vs tracer **coverage**,
  never filenames). An interior branch target is not an entry point.
- **Evaluate a conditional's guard before believing its target** — a self-checksum ROM aims its dead
  failure arm into **data**; model the trap (aimed at data → `throw`; aimed at real re-entered code →
  delegate); what the guard READS decides severity (a ROM-sum guard firing ⇒ the image is wrong; a work-RAM
  guard firing ⇒ the port has a bug).
- Faithful lift = **memory-equivalent + mutation-tested, validated in isolation off the live game**. The
  translated layer carries **no prose** (SPDX, a one-line identity, per-instruction address/mnemonic
  comments; a trailing `--` clause names what bytes *are*, never a mechanism). **Write it UNDER the
  `comment_gate` density cap (comments ≤ code//2 + 8) from the first draft** — keep the checkable `--`
  clauses, drop mnemonic-only restatements (an address/mnemonic line with no `--` clause is usually
  cuttable, and a two-line JSDoc that fits on one should be one). This binds **boards, manifests and test
  files too** — Time Pilot is the quality model (its files predate the cap and are grandfathered, so match
  their KIND, not their higher density). **≈50 routines/batch (~15 agents × 3–4) — fan aggressively;
  shrinking the batch out of caution is the failure mode, not the safe default.** Scope the batch from the
  whole reachable closure, not just the
  current boot frontier — the deferred callees are provably reached (translated code already `m.call`s
  them), so translate them in bulk ahead of the boot; the boot-statediff still runs each merge and
  live-validates the swath as the boot advances into it. Regenerate the registry after batches land
  (`gen-registry.mjs`), not per batch.
- **Fan out every batch — parallelise as much as possible; do NOT get scared and start one-by-one.** Serial
  pace is the failure mode, not the safe default: when a batchable pool exists, going one-at-a-time is the
  mistake. A batch is a serial→parallel→serial sandwich:
  ONE setup (fold the entrypoints, re-trace to a single stable disassembly, pre-assign each routine's
  RANGE), **~15 agents × 3–4 routines each (≈50/batch)** (scale the agent count to the pool — a 13-routine
  pool is 4–5 agents, not 13), then ONE merge (regenerate the registry, run the boot gate + stepcheck on
  the assembled set). Distinct `loc_<addr>.js`/`<addr>.test.js` (and idiomatic module/test) files never
  merge-conflict; the only cross-agent care is those pre-assigned ranges (so two agents don't disagree on a
  boundary) plus a style/ABI check at review.
  ⚠ **When a batch RE-DECOMPOSES or REWRITES a pre-existing translated routine** — splitting a lumped file,
  moving a second-entry to its own file, or dropping an over-read span — **run the WHOLE
  `games/<game>/translated/test/` subset in reconcile, not just the task-named subset.** A re-split breaks
  pre-existing tests that import the OLD lumped exports (an ES-module link error) or whose mock lacks a
  method the rewrite now calls, and the task-named subset (tape / registry-coverage / no-stale-mcall) MASKS
  it — it surfaces only at pre-push. Also grep the whole translated layer for external `m.call`/`jp` into
  the region's interior addresses and for pre-existing `loc_` files overlapping the range: a purely-internal
  recursive descent misses boundaries introduced by external callers and prior SPLITs.
  ⚠ **A decompile batch is ADD-ONLY w.r.t. previously-committed routines — enforced.** A partition that
  overlaps a committed routine once had agents re-translate + DELETE shipped, reviewed code, caught only by a
  stray "41 M" in staging. `tools/decompile_addonly_gate.py` (pre-commit) REFUSES a commit that ADDS new
  idiomatic/translated routine modules AND ALSO modifies/deletes a previously-committed one. A rename
  (loc_->descriptive) is an understanding pass (git `R`) and is allowed; a genuine one-off dissolve takes the
  per-commit-approved `--no-verify`.
  ⚠ **Balance the split by estimated CODE VOLUME, not seed-entry count.** A seed entry with a large gap to
  the next known entry expands into however many in-range sub-routines the disassembly holds, so "N entries
  per agent" fans out wildly lopsided. In setup, ESTIMATE routines-per-range from each span's decoded
  instruction blocks (NOT the byte gap — most of a large gap is data/unreached) and size the groups to the
  ~3-routine target; a genuinely huge span gets its OWN batch or a sub-split at interior routine entries,
  never buried in a mixed group.
  Shared files (the registry, `names.js`, board files) stay under serial control — agents RETURN their
  `names.js`/registry additions, the coordinator merges them. This parallelism is *within* a batch — the
  across-batch rule still holds (don't open the next batch while this one is under review).
- **Fan the REVIEW too, at the same scale as the translation.** A ~50-routine batch cannot be full-decoded
  by one reviewer — split the independent by-execution review across **~1 agent per ~8 routines** (a
  workflow returning compact per-routine verdicts, not N loose parallel agents), then reconcile the blockers
  serially. The review-fan is what keeps per-routine rigor at batch scale: it catches defects (missing
  `push16`, T-state mischarges in untested paths, mis-scoped loop-latches) that every mechanical gate and
  the per-routine tests pass clean. Each review agent decodes its routines' whole range against the ROM (not
  just tested paths) and runs its own positive control. Routines translated ahead of the boot lean on their
  equivalence tests + this review until the boot reaches them.
- **Even the hard spine parallelises — in clusters, not one-by-one.** "Hard" means each unit needs a
  bespoke fixture (tape/golden, pixel gate) or careful grounding, NOT that authoring conflicts. Group the
  interdependent routines into coherent CLUSTERS (siblings sharing state, a render group sharing the pixel
  gate) and run ~1 agent per cluster in parallel; generator `m.call` fallback decouples the authoring, and
  equivalence gates correctness regardless of order. Keep the GROUNDING careful (the spine is where
  grounding-overturns hide) and **wire the spine dispatchers LAST, validating them serially** (a bad
  dispatcher wire breaks the whole live game — the pixel/live gate is what catches it). **Before opening the
  next batch, re-check any waived gate's removal trigger** — a pixel-gate waiver comes off the instant the
  game first renders, not once the lift is finished.

## 4 — Idiomatic pass (the spiral)

Rewrite the lift into readable JavaScript **and** recover what it means, spiralling up the call graph. The
spiral has two alternating halves — **decompile** (correctness) and **understand** (meaning) — run as
separate commits (never two decompile commits in a row); understanding compounds batch over batch and
feeds the next batch's targets.

### The decompile half

- **Batches of ≥40 routines, leaves-first** (the idiomatic and translation passes are the **same size** —
  floor **40** — so fan aggressively, ~15 agents × 3–4; do NOT retreat to tiny leaf batches). A caller
  decompiled before its callee has to hand-marshal the callee's register ABI, an assembly leak the
  equivalence gate can't see, so go leaves-first: re-derive the leaf set **each batch** by closing the call
  graph over current `m.call` targets, and pull ≥40 of them per batch.
- **`batch_size_gate` enforces THIS pass too, at the SAME floor (40).** It counts the idiomatic MODULE
  files a commit adds (N) and holds them to the shared floor while routines remain to decompile (R = the
  game's `loc_` routine files minus the idiomatic modules present); a genuinely small final cluster clears
  with the `--reason` waiver.
- **The legacy-RETROFIT campaign (reducing cruft by MODIFYING existing modules) has its own MODIFY floor
  in the same gate (Karl 2026-09-21: "find ways to make sure you don't keep forgetting to fan-out").** The
  ADD floor is inert for a modify-only commit, so nothing used to stop dribbling tiny per-category waves. Now
  a pure-modify idiomatic commit for a game whose layer still carries broad cruft must touch **≥20 modules**
  (`MOD_FLOOR`), or record the `--reason` waiver; it relaxes only near true 0 (≤15 dirty modules). **Scope the
  WHOLE reducible pool before firing — `python3 tools/batch_size_gate.py plan --game <g>` reports how many
  modules still carry cruft across ALL categories — then fan regi+addr+m.call+m.push in ONE workflow, one
  commit; never one category at a time.**
- Per routine ship all **four**: module + `equivalence-<addr>.test.js` + `ROUTINES` entry + green gate.
  **Done only when DISPATCHED** — `resolveAllIdiomatic` walks `ROUTINES`, so a module no entry names is
  never overridden. Done requires that **no routine runs as the frozen oracle in the live game**: every
  reachable routine is either wired as a live override (in `ROUTINES`) OR — for a genuine caller-skip whose
  net +4 SP move the withOmittedRet seam cannot seat — DISSOLVED into a direct-called boolean and recorded
  in **BOTH** files a dissolution touches: a `dead` entry in `tools/idiomatic-boundaries.txt` (which
  subtracts it from the `idiomatic_gate` closure count) AND an `UNWIRED` entry in
  `tools/registry-coverage.config.mjs` with a `DISSOLVED ... not oracle-served` reason (which satisfies
  `registry-coverage.test.js`'s dispatch-or-exempt check). These are **separate checks in separate files**;
  a dissolution that updates only one passes every pre-commit gate but is caught red by the pre-push suite.
  An `UNWIRED`/`DEBT` entry that means "oracle-served, can't-seat, left translated by design" is a
  **transient debt state, never done** — a seam throw is the signal to DISSOLVE, never to leave the routine
  translated. Silence reads as oversight.
- Fidelity = **memory-equivalence**: RAM minus stack scratch + `pc` + `SP` + declared live-out; **never
  the full register file, never cycles**. **Derive live-out from the oracle, never the module header** (a
  gate whose excluded set matches its module asserts the divergence — green on broken, red on correct).
  When a routine's live-out **is** a register, add a **standing register-comparison arm** — a memory-only
  gate passes a register-valued rewrite that is wholly wrong. Every gate carries teeth. Test by
  **capture-clone-replay** (hook the address, `m.clone()` at each real dispatch, replay in isolation); for
  arms the run never reaches, craft an entry — a real captured state with one variable poked identically on
  both sides.
  - **SP-tooth for a DISPATCHING rewrite (the missing-`push16` class is invisible to memory-eq).** A
    rewrite that seats a return then dispatches (`m.push16(<slot>)` before an rst-28 / tail-dispatcher
    `m.call`, or `return m.call(<translated>)`) can drop the `push16` and still pass eq-green — the adrift
    stack word lives in dead stack scratch, which the RAM diff excludes; it corrupts the live game and is
    caught only whole-game by `tape.test.js`. Give such a routine an SP-tooth in its eq test: run it through
    the game's `withOmittedRet` seam via `core/equivalence.js` `seamPlaceable(withOmittedRet, fn, addr,
    entry)` and assert `placeable === true`. The seam is the authority — it completes an omitted ret (SP
    moved 0), accepts a legit tail-dispatch (moved +2, pc on the caller slot — no false positive), and
    THROWS when SP is adrift. **Null-mutant it once per game** (drop a real `push16`, prove it goes RED): a
    check never observed failing cannot be trusted. See `games/pooyan/idiomatic/test/sp-seam-tooth.test.js`.
    Enforced at review by reviewer-rules R36.
  - **Audit register live-out completeness — a leading escaped-defect class.** For **every** register the
    oracle modifies and does not pop/restore before its `ret`, ask "does a caller read it back?"; if yes it
    is a live-out the module MUST set (return-assignment) AND the gate MUST compare (derived from the
    oracle). The oracle typically `push16`/`pop16`s **BC/DE/HL** (restored to entry) but **NOT AF**, so **A
    and the flags** left modified are the first place to look for a missed live-out, along with a
    `djnz`/loop counter left in **B** or an advanced pointer/cursor left in **A/HL**. A memory-only gate
    goes green on a register-wrong rewrite, so these escape the per-routine test and surface only in the
    whole-game tape or a register-focused review — the whole-game replay and a review pass that audits
    live-out completeness are therefore BOTH mandatory. When unsure a caller reads it, set + test it anyway
    (a value that matches the oracle can never cause a false failure).
  - **The ONE exception: every reader of the register is itself rewritten (the HAND-OFF form).** A register
    an oracle caller reads back is a live-out the module MUST set and the gate MUST compare — EXCEPT when
    every such reader is itself an idiomatic override that takes the value explicitly (a param, or the
    callee's return), so no code that reads the register runs in the wired game. Dropping it needs all
    three: **(1)** a **HAND-OFF arm** in the module's eq test that MEASURES the reader set on the ORACLE —
    the register complemented as the frozen routine hands back, one caller (return address) at a time,
    over sessions covering the game's reachable states (attract, coin-start, and every poke-driven distant
    state in `tapes/*.poke.json`), with an SP flip at the same exit that must be heard — pins the heard
    set, and requires the routine owning each reader to be an idiomatic override (an entry in the game's
    `idiomatic/names.js` `ROUTINES`, the set the idiomatic runtime wires — NOT the translated registry in
    `routines.js`, which holds every frozen routine); **(2)** the live **translated-code probe**
    (`tools/translated_live_probe.mjs`) reading 0, so no frozen reader runs by a path the arm did not name; **(3)** the header states the HOLE: a reader reached only in a state no
    session drives is not measured. Then the register is dead in the live game and need not be set; move
    it to the excluded set, and relabel a twin whose only defect is that register HARMLESS (asserted caught
    nowhere) instead of deleting it. That each override computes the value itself is a REVIEW check, not
    the arm's. So is the **reader->owner pairing**: the arm MEASURES which return addresses hear the
    register, but the table naming the override that owns each one (timeplt's `HL_READERS` / `A_READERS`) is authored,
    and the arm only checks that every owner it is handed is in `ROUTINES`, never that the return
    address lies in that owner's code. The reviewer re-derives each pair from the disassembly (the
    instruction after the call, and the routine whose body it sits in): a reader paired to the wrong
    owner passes the arm, and if its real owner is an override that still takes the value from the
    register (a `m.regs` default parameter), no frozen code runs and the live probe passes too. This relaxes the held set only as LAST MILE (a) below does (derived from the oracle,
    proposer≠confirmer); it never licenses dropping a register a still-FROZEN routine reads (R37, next).
    Reference: timeplt `equivalence-0008` (HL) / `equivalence-0018` (A), via `_deadAtExit.js`
    `TAPE_SESSIONS` + `handOffReaders`.
  - **A register moved into the ceiling because NO caller reads it (DEAD AT EXIT) is measured, not argued,
    and always with its exit-side control.** Complement it where the frozen routine hands back and require
    silence over the sessions that reach it; an entry-side poison says nothing about whether the exit poison
    lands, so the same exit also gets an SP flip that must be heard. Write the arm through the shared helper
    (timeplt `_deadAtExit.js` `assertDeadAtExit`), which runs both and fails without the control, and give it
    the arm's other poisons (entry-side controls, a register that must be heard live, a second poison that
    must stay silent) as its `controls` — never a hand-rolled poison loop, which is how the exit control went
    missing more than once. The session poisoner itself is private to `_deadAtExit.js`: its only other use
    is the HAND-OFF measurement above (`handOffReaders`, which carries the same SP exit control), so
    `git grep -l poisonedRun games/timeplt/idiomatic/test` lists that one file.
  - **Register-bridge live-out into a FROZEN callee — a distinct sub-case (reviewer-rules R37).** A rewrite
    that forwards a value as an explicit JS param, while a still-frozen callee (or an idiomatic callee whose
    signature is `fn(m, x = m.regs.X)`) reads it from the register bridge, passes a STALE register in the
    live game. RE-SEAT `m.regs.X` before delegating (idiom: `m.regs.ix = rec; // record base flows through
    IX to the deeper scan-state chain`). Invisible to memory-eq AND the by-execution reviewer fan; ONLY the
    whole-game tape catches it.
- **Dissolve an `m.call` when you write the CALLER**, not when the callee lands. Before writing
  `m.call(0xADDR)`, check whether the callee is already decompiled (a stale marshalled call is
  memory-equivalent → the gate misses it, it reaches the reviewer). The `no-stale-mcall` lint must resolve
  file-local `const NAME = 0x…` aliases, not just literal hex. A bare-return no-op module dissolves to
  nothing (inline + delete module/entry/test). A strongly-connected cycle lands as one unit. Partition
  caller files across agents; don't run a rename pass while authoring agents are live.
- **Fan agents WRITE + parse-check only; the LEAD runs the equivalence tests.** A decompile fan must NOT
  have each agent run `node --test` — N agents each spawning a Machine-booting test at once starve CPU, and
  an agent that retries a slow/hung test livelocks the whole fan. Agents verify only `node --check <module>`
  (parses) + `idiomatic_gate worklist <game>` (cruft-0) then return; the LEAD runs every
  `equivalence-<addr>.test.js` SERIALLY in reconcile, each wrapped in an OS `timeout`, and judges each by
  its **exit code — never by grepping the test output** (a grep on `# fail`/pass text false-passes a red
  gate whose failures print in a different shape). A timeout is a **bug to fix** — a non-terminating test is
  a real defect — **never a retry**. A background fan is not fire-and-forget: after a compaction FIRST check
  whether one is still live (`ps` for `node --test`; the fan's `agent-*.jsonl` mtimes) and kill a stalled
  run (`TaskStop <task-id>`); a large fan gets a stall watchdog.
- **Run the WIRING tests in reconcile PRE-COMMIT, not only at push.** The pre-commit gates do NOT include
  `tools/test/registry-coverage.test.js` (every idiomatic module dispatched-or-exempt) or
  `tools/test/no-stale-mcall.test.js` (no stale marshalled `m.call` a decompiled callee should have
  dissolved) — so a mis-wired override, a missing `UNWIRED` entry, or a stale `m.call` passes every
  pre-commit gate and is caught only by the slow pre-push suite. The LEAD runs both SERIALLY in reconcile
  alongside the equivalence tests (again, by exit code), so a wiring miss is found before the reviewer.
- Idiomatic rewrite = routine-**local** rules + routine-**wide** rules (input-register → optional param
  defaulting to the register `fn(m, x = m.regs.a)`; interface-register → explicit value/return; phantom
  no-op → inline+delete). Never weaken an assertion. **Address-retrofit:** no idiomatic routine references a
  data address by raw hex or a routine-local const — import it from `names.js`; use the **`_ADDR`
  convention** when an address is also a routine entry.
- **Registers become params/vars/returns AS YOU AUTHOR each idiomatic module — never as a later sweep.**
  The goal is **all CPU registers gone** from the idiomatic layer: no `regs.*` in a body or an idiomatic
  call site. (The `= m.regs.X` in a param default is the one sanctioned exception — the load-bearing bridge
  for register-based `m.call` dispatch from the *frozen* translated layer, which cannot pass named args, so
  it stays; it is exempt from the count.) **Enforced by `tools/idiomatic_gate.py` (pre-commit)** — the
  single gate that counts ALL idiomatic-layer cruft (register refs + `m.call` + `m.push*` + raw `0xHHHH`)
  and holds every `games/*/idiomatic/` to a per-game budget (implicit 0), so a NEW game is fail-closed from
  its first module and an author literally cannot commit new cruft. Each game's own
  `games/<game>/idiomatic-budget.txt` (a single integer — game-local config, NOT in common `tools/`) is a
  **shrinking ratchet** (legacy games frozen at their count); a game with no such file is held at 0, and a
  game is IDIOMATIC (a done requirement) only at 0.
- **The register / ABI-seam residual FANS — it is not a serial "coordinated refactor" (the 2026-09-20
  miss).** The `regs.*` left after the leaf conversions is the register-passing ABI seam (live-in/live-out
  between a caller and a callee), and the reflex to call it un-fannable is wrong: a per-FILE flat fan stalls
  (a file cannot drop a register the callee only returns via the register), so it *reads* as serial while
  the work fans at a different UNIT. Fan it:
  - **Agents convert with the three BRIDGE-PRESERVING, memory-equivalent forms** — input→param-default
    (`fn(m, x = m.regs.X)`), output→**return-assignment** (`return (m.regs.X = v)`, a tuple for several),
    dead-scratch→plain local. Each is MEMORY-EQUIVALENT by a DIFFERENT mechanism — return-assignment KEEPS the
    register write, param-default READS the register bridge (both leave a register-reading caller untouched),
    and dead-scratch→local is safe ONLY when nothing reads the register back. Misclassifying a live register as
    dead is the R37 live-game breakage, and the module's OWN eq test can MISS it — the drop surfaces in a
    TRANSITIVE caller's eq test, so run the WHOLE game's eq suite before commit, NOT a scoped pick; a
    misclassification then reddens and reverts. Agents WRITE + `node --check` + worklist-delta only; the LEAD
    runs each eq test by exit code and REVERTS any red (the §4 fan contract). When unsure input-vs-output, treat
    it as OUTPUT (return-assignment) — always safe, it keeps the write.
  - **The residual bottleneck is a SHARED CALLEE that leaves an output in a register instead of RETURNING
    it** — its callers cannot drop the read until it returns. So the fannable unit is the **shared
    output-callee cluster**: make the callee tuple-RETURN its outputs, then fan its callers to consume the
    return. **Organize the fan around the callee, not the caller.**
  - **The flatly-mechanical levers fan with ZERO coordination, value-identical, per file:**
    `mem.read8/write8(x)` → the indexed `mem8[x]` view; a redundant width-mask on a `mem8[]=`/`mem16[]=`
    write; `(x) & 0xffff` → `u16(x)`. Do these first — they need no classification.
  - **A raw-address (`addr`) residual fans as the GROUNDED-NAMING workflow, NOT a flat guess-fan** — a shared
    cell gets ONE owner (never each caller's local view, which collides and ships a wrong name), and each
    name is grounded in MAME (stage B). A jump-TABLE dispatcher (the raw words ARE the table) stays serial.
  - **⚠ The genuinely-harder LAST MILE (fan it, but with care — do not over-promise it all falls to the three
    forms):** two sub-classes resist the bridge-forms. **(a) The eq test OVER-PINS the register file** — it
    holds a register the runbook says must NOT be held (memory-eq is RAM + pc + SP + *declared* live-out,
    never the full register file), so localizing the register reddens a test that should not have compared it.
    RELAX the HELD set to the oracle's TRUE live-outs FIRST (derive from the oracle, proposer≠confirmer — this
    is the blessed "adapt the eq test, never delete coverage"), THEN the register localizes. **(b) The
    register is the OPERAND of a retained Z80 machine op** (`m.lddrAt` block copy reads bc/de/hl; `daa` reads
    the incoming carry; `exx`/`exAf` bank-swap; `djnz` counter) — no bridge-form touches it; it needs the
    machine op itself re-expressed idiomatically (a deeper rewrite), else it is the honest "Z80 primitive
    still present" residue. Neither sub-class is un-fannable — both fan — but each carries an extra step, so a
    seam-fan's yield is "most of it," not "all of it in one pass."
- **Closure — a reachable routine still served by the oracle is cruft too.** A generator layer silently
  falls back to the translated routine for anything unlifted, so it *runs correctly* and the behavioural
  worklist (the state diff, §2) never flags it — a whole reachable sub-tree can stay frozen while every gate
  is green. So `idiomatic_gate` also counts, for a **closure-enrolled game** (`CLOSURE_GAMES`), every
  **reachable-but-unlifted routine** — the translated `_registry.generated.js` set (graph-closed by the §3
  recursive descent) minus the idiomatic `ROUTINES` overrides minus a reviewed
  `tools/idiomatic-boundaries.txt` allowlist (`dead` = callers dissolved, `boundary` = genuinely left ROM) —
  and **lists them by address** in the worklist. The total cannot reach 0 while any reachable routine is
  oracle-served, so the frozen tail is a **named, finite work-list, not an inferred number**, and
  completeness is STRUCTURAL (the call-graph closure) rather than behavioural.
- **Outgoing registers: `return` by default; a return-assignment for the load-bearing case.** The gate
  cannot infer input-vs-output from a `regs.a = value` write, and it does not try — **the author declares
  intent in the form and the gate enforces the form.** A routine that produces an interface register
  **returns it**; idiomatic callers use the return, no `regs.*` write, gate-clean by construction. Several
  idiomatic outputs return a tuple (`return [a, hl];` → `const [a, hl] = fn(m);`). The one exception is a
  **load-bearing** register-out: the routine is register-dispatched via `m.call` from the *frozen*
  translated layer, whose caller reads the result straight out of the register, so a plain `return` is
  invisible to it. Write those as a **return-assignment** — `return (m.regs.a = value);` — which sets the
  register (for the translated dispatch) *and* returns the value (for idiomatic callers); never a bare
  `regs.a = value;`. So the exempt forms are: a param-default (incoming), a `return`/tuple (idiomatic
  outgoing), and a `regs.X` write that is **part of a `return`** (load-bearing outgoing) — for a game in
  `idiomatic_gate.TIGHT_GAMES` (timeplt) only when the write IS the return's value (the whole expression,
  the last comma operand, a tuple/object element, a `?:` branch, or a `u8`/`u16` argument) with no call
  after it inside the return, and the param-default exemption covers the parameter list only, not the rest
  of the signature's line. For a TIGHT game an input seat riding a return (`return (regs.ix = X,
  callee(m))`, a call argument, a `void` operand, a `?:` condition) counts as debt; every other game keeps
  the legacy rule (any write after `return` on the line) until it is re-baselined. The gate flags
  **every other** body register reference as debt, and the **reviewer audits** each return-assignment as a
  genuine dispatch-out under proposer≠confirmer. Multiple load-bearing outputs generalize the same way —
  `return [ m.regs.a = foo, m.regs.hl = bar ];`. (An assignment evaluates to its RHS *before* the register's
  width mask, so the returned value equals the stored register only for an in-range output — always true for
  a genuine register-out.)

### The understand half

**An understanding pass is TWO stages, and the second is MANDATORY. Naming is stage A; GROUNDING is stage
B; a pass that stops after stage A is not finished and MUST NOT be committed as done.** Stage A (name from
body + callers, two blind derivers, promote on convergence) produces `[code]` *proposals* — a
self-consistent reading of the code, nothing more. Stage B plays and pokes each proposal — **both a
routine's role AND a data address's role** (grounding is not routines-only) — on the **real ROM under
MAME** (never our own engine, which is our own model, so grounding against it is circular) — to lift it
`[code]`→`[seen]` or to OVERTURN it. **A batch of fresh `[code]` names plus a `[code]`/`[guess]`
`mechanisms.md` is a grounding WORK-LIST, not a finished map**; the pass completes only when that list is
grounded-or-accounted-for, under **proposer≠confirmer** (whoever grounds a name is not who proposed it — a
prose review is not grounding). Honestly tagging an uncertain item `[guess]` does **not** discharge stage
B. If you did not run MAME this pass, you have not grounded. (Full formula and method in `understanding.md`;
it is not optional there and not optional here.)

- **The grounding CONFIRMER confirms a `[seen]` from EVIDENCE — re-run MAME, or be handed the MAME
  write-tap per cert — NEVER inferred from the code diff.** Grounding is a MAME fact (a watched write /
  value-change), and by the tag-only rule that fact is NOT in the commit diff. So a reviewer who reads only
  the staged `names.js` + code sees every `[code]`→`[seen]` promotion as *unrecorded* and can only flag its
  absence — it can never *confirm* it. The confirmer therefore either (a) re-runs the game's grounding
  write-tap under MAME (`games/<game>/tools/lua/ground_writes.lua`) and re-derives the `[seen]` from the
  capture, or (b) is handed, per cert, that cert's
  MAME write-tap evidence to check the promotion against. The mechanism for (b): the grounding-commit-review
  workflow attaches to each reviewer's slice the per-cert evidence from the capture the grounding fan
  produced (`ground-evidence.json` / the gwtrace CSV), extracted by `tools/grounding_evidence.mjs` —
  `routine <lo> <hi>` gives a routine's OWN write-set (return-stack scratch separated out, its window read
  per-game from `names.js` `STACK_SCRATCH`), `cell <addr>` gives a cell's watched value-changes. A routine
  is `[seen]` only when a role-defining MAME observation grounds ITS role — but that observation is **not
  always a write**. A routine that PRODUCES state is `[seen]` on a role-defining own write; a DISPATCHER or
  driver, whose role is to READ a cell and vector to the matching handler, is `[seen]` when MAME confirms
  that vectoring — observed reachability + correct handler selection across the states it routes — even with
  no own write, OR derivatively once its dispatch cell and handlers are themselves `[seen]` (`routine` mode
  reporting only stack scratch is the signal to check the vectoring, not an automatic `[code]`). What stays
  `[code]` is a role that is NEITHER write-grounded NOR dispatch-grounded — e.g. a writer whose only writes
  land in cells still `[code]`/contested (it cannot be more grounded than the cells it writes). A
  **REGISTER-COMPUTE helper** (a register live-out with no own memory write and no un-validated side effect of
  its own — no render, no sound, no port-OUTPUT; but a pure side-effect-free INPUT read, i.e. a port IN or a
  ROM-table read whose result is returned in a register, DOES qualify, since it carries no side effect the
  consumer cannot confirm) grounds the same derivative way — `[seen]` when it is REACHED and its register output is consumed by a
  `[seen]` consumer that uses that output for the consumer's own validated (pixel/state) `[seen]` role, so the
  consumer's confirmed-correct behaviour confirms the helper's output was correct. It stays `[code]` if its
  only consumer is itself `[code]`, or its output is not actually consumed for a role — a SPECIFIC `[seen]`
  consumer must be named, never a rubber-stamp for any reached helper (this is how a game with many pure
  register/pointer helpers grounds them instead of mis-parking a large set in `grounding-debt.txt`, which is
  reserved for the genuinely un-groundable-on-a-good-ROM residue). Enforced at review by `reviewer-rules.md`
  R38 [U].

**★★ Ground at SCALE — capture broadly, then ONE mega-fan. NEVER dribble small serial waves.** Grounding
the whole `[code]` set is a **capture-then-fan pipeline**, and the failure mode (learned the hard way on
pooyan: waves of 33/55/77) is trickling it out as many tiny serial waves — each paying a full
workflow+review+push cycle. Do it once, wide. The steps:
- **Build ALL the MAME captures up front** (one rig, several taps/scenarios), because different item classes
  need different evidence:
  - **Write-tap** (`games/<game>/tools/lua/ground_writes.lua`): per-instruction write attribution over
    attract+coin/start/1P-play → grounds *producer* routines (own role-defining write) and work-RAM cells
    (value change). ⚠ **Tap the FULL RAM+MMIO write space, not just work RAM** — a renderer's role write
    lands in VRAM, a sound/port-writer's in the sound/control latches; a work-RAM-only tap misreads every
    such producer as a writeless register-helper (the confirmer then can't reproduce the evidence). Also run
    a **deep-gameplay** write capture (coin/start then drive real play — sweep + fire through waves, death,
    game-over): it reaches far more of the play code than a coin+hold-fire tape, cheaply.
  - **Variant captures** (a lua read-tap that OVERRIDES an input port): a **DSW-variant** forces a
    non-default dip value so DSW-derived cells hold a different value → grounded by **value-SPREAD across the
    union of captures**; a **2P capture** (coin×2 + "2 Players Start") reaches the two-player cells.
  - **Poke-cycle capture**: drive the in-play **sub-state index** through its handler table and bump the
    **round counter**, forcing the in-play gate set, so the trace enters sub-states the fixed tape never
    reaches (thousands of new PCs). Poking a state to make MAME *run* a handler is valid grounding — you are
    observing the real hardware execute it.
  - **Read-tap** (`ground_reads.lua`): the write-tap **cannot** ground ROM constants/tables (ROM is never
    written) — tap **reads** on `0x0000-0x7fff` and record `(addr,pc)`. ⚠ **EXCLUDE the ROM-checksum sweep
    PC and generic anti-tamper sweeps** (one PC that reads *hundreds* of addresses grounds nothing
    role-specific). A **direct** read by a role PC grounds a constant; for a **table base**, tap the **RANGE**
    `[base,base+N)` so the role code's **entry** reads (`base+offset`, a different address) are caught, then
    trace any shared-helper reader (an `rst`-table lookup) back to the caller that loaded the table pointer.
  - **UNION** all captures (the evidence tools take multiple CSVs).
- **Triage the WHOLE ungrounded set ONCE against the union**, tagging each item with the METHOD that grounds
  it: routine = *producer* (own write) / *driver-dispatcher* (reached, writes only stack-scratch → ground on
  reachability + correct vectoring: the pushed return vectors back into its OWN body and the handler it calls
  is reached) / *unreached*; cell = *write-change* / *direct-ROM-read* / *range-ROM-read* / *deep*.
  ⚠ **Measure reachability from the PC (curpc) column, NEVER the read-tap's addr column.** The boot
  checksum/anti-tamper sweep reads *every* ROM byte (e.g. `0x0000-0x27ff`), so a routine's address appears in
  the read **addr** column even if it never executed — addr-column "reached" is a false positive that
  mis-tags deep routines as groundable register-helpers. A routine truly executed iff its body PCs appear as
  **curpc** values (in the write-tap or read-tap pc column). This is the same sweep the read-grounding step
  excludes — it contaminates reachability too.
- **Fan the ENTIRE groundable-now set in ONE workflow** (proposer≠confirmer — the fan agents are not the
  namers), one slice per agent, returning compact schema verdicts `{seen|insufficient|overturn}`; **fan the
  independent grounding-review at scale too**. Apply is a pure **tag-flip** (`[code]→[seen]` /
  `cert:"code"→"seen"`) — it clears the gates with **no `mechanisms.md` regen** — one commit per fan, the R38
  reviewer re-deriving from the same capture.
- **★ Fan WIDE, and run the reached-set and deep-tail tracks CONCURRENTLY, collapsed into ONE commit.**
  Size the fan for wall-clock, not caution: **~3–4 routines per agent (≈20–25 agents for a full set), not
  ~10** — the routines are independent, so width is nearly-free speed; the same goes for the review-fan.
  The two grounding tracks — the reached-set fan (above) and the deep-tail poke-capture fan (below) — are
  INDEPENDENT: **launch them at the same time**, then combine both sets of verdicts into ONE apply + ONE
  wide review-fan + ONE commit, rather than as separate serial waves. The dominant serial cost of a
  grounding wave is the per-commit **push — the pre-push suite plus the rom-guard stranger-clone, minutes
  each** — so **collapsing concurrent tracks into fewer commits saves more wall-clock than any narrower
  split**. That push tax, not just reviewer cost, is *why* the "ONE mega-fan / never dribble" rule exists.
  (Grounding-only tag-flips do not trip `understanding_gate` CHECK A — the export SET is unchanged — so
  batching more per commit is safe.)
- **⚠ Use each routine's TIGHT body range** (its translated `// loc_<addr> (ROM 0x<lo>-0x<hi>)` header), NOT
  the next-registry address — the latter overshoots into a fall-through callee and **mis-credits the callee's
  writes**, manufacturing false groundings (the confirmer must verify the grounding write's PC is inside the
  routine's OWN body).
- **The DEEP TAIL is CAPTURE-limited, not fan-limited.** Items exercised only in genuine deep gameplay (later
  boards, the bonus/eagle stage, game-over) cannot be grounded by the fixed tape or poked states — **more
  agents do not help**. Fan the deep-**capture** research instead: agents each force a deep state (poke the
  board-advance flag, the stage trigger, drain lives) and report which reaches new code; then re-capture and
  re-fan the grounding. A ROM constant read only by the checksum sweep, or a routine reached only in an
  unreached state, stays honest `[code]` until a capture reaches it. The genuinely-IRREDUCIBLE ones — an
  anti-tamper clone / error arm reached only on a TAMPERED ROM (its guard never fails on the real image),
  or a ROM constant read only by the checksum sweep in EVERY reachable state — are ACCOUNTED-FOR in
  `games/<game>/grounding-debt.txt` (one `0xADDR  reason` per line), which `done_gate.check_grounding`
  SUBTRACTS from the ungrounded count so the ship can pass. The gate rejects a reasonless or stale entry;
  each is independently reviewed as truly un-groundable-on-a-good-ROM (reviewer-rules R39). A routine or
  cell a deep capture COULD reach (a later board, the eagle/bonus stage, a sound event, a forced
  transition) is GROUNDED, never allowlisted — allowlist only the true irreducible residue.
- **Per-cell tag accounting (R16, strict mode).** For a game listed in `tools/done_gate.py`
  `STRICT_TAG_GAMES`, done_gate's grounding subsystem counts every `export const NAME = 0x…` cell (except a `<routine>_ADDR` alias whose address is a ROUTINES key, which is graded by that routine's `cert:`) whose OWN
  comment (its inline `// …` or the `/** … */` block directly above it) carries no tag as ungrounded — a `//`
  section-header tag does not count — and a `[code]`/`[guess]` cell is accounted-for only when its address is
  in `grounding-debt.txt`. `python3 tools/done_gate.py strict-report --game <g>` measures any game, enrolled
  or not. Games are enrolled one at a time together with their grounding pass, never flipped red first.

**Derive the method from this runbook and `understanding.md`, never from the shape of an old commit.**
Grounding leaves almost no *diff* artifacts — it is `[seen]` tags, notes, and the occasional overturned
name, not `git mv` renames — so reconstructing "how an understanding pass works" from a past commit's diff
shows only stage A (the renames + the map) and silently omits stage B.

- **Confidence-tag every claim:** `[seen]` (chain ends in a MAME observation), `[code]` (from a translated
  routine's behaviour — harness replay), `[guess]`. A confidently-wrong role is worse than a neutral `loc_`.
- **Front-load RAM/variable naming before routine naming** — named memory is the biggest legibility lever,
  and routine names derive from what a routine does to memory. Variable names = consensus of every routine
  touching an address (never one routine's local view); routine names = mechanism + callers.
- **A cell earns its DESCRIPTIVE identifier the moment it reaches `[code]` — the `[guess]`→`[code]`
  transition — not at grounding.** As soon as a cell's reading is confident enough to be `[code]`
  (understood from the routines, consistent across the ones that touch it), RENAME its `names.js`
  `export const` from `loc_<addr>` to a DESCRIPTIVE name (the `PLAYER_X`/`CREDIT_BCD` style — see
  `names-registry.md`) and update every importer. This is **value-identical** — the address never changes,
  only the identifier. A `[guess]`/unknown cell takes a **`loc_<addr>`** name, allowlisted in
  `tools/names-debt.txt` — a readable placeholder that clears the raw-hex cruft and marks the role pending;
  promote it to a descriptive name the moment it reaches `[code]` (loc_ is never valid for a `[code]`/`[seen]`
  cell). Grounding (`[code]`→`[seen]`) then only CONFIRMS the name — or OVERTURNS it, forcing a re-rename —
  it does not *first* bestow it. A confidently-read cell (`[code]` **or** `[seen]`) still named `loc_<addr>`
  is an unfinished job: every reader pays the `mem16[loc_83ef]`-vs-`mem16[HIGH_SCORE]` legibility tax the
  idiomatic layer exists to remove. **Enforced** at review by `reviewer-rules.md` R31 (a `loc_<addr>`
  idiomatic cell const FAILs) and mechanically by the `names_consistency` gate rule (B): it FAILs any new
  `loc_` cell while grandfathering the existing debt (`names-debt.txt`).
- **DECOMPILE the routines FIRST — THE priority; get as many routines done as possible. Cells come
  automatically from routine work.** Maximizing routine throughput — the decompile half above, plus
  grounding routine ROLES here — is THE priority; do NOT divert into a standalone cell-grinding campaign. A
  cell's role IS what the routines do to it, so decompiling and grounding a routine — observing it run under
  MAME and confirming what it reads/writes — grounds the cells it touches in the SAME work. Do NOT isolate
  an ungrounded cell and build a bespoke experiment to force its value; that is backwards and slow. When a
  cell's routine is understood but the cell only changes on an unreachable arm (an anti-tamper error path, a
  state no valid play reaches), it is ACCOUNTED FOR by the routine's grounding + a reasoned note — not chased
  with a tailored capture.
- **Ground addresses, not just routines — stage B applies to every claim in `names.js`, cells included.** A
  data address carries a confidence tag exactly as a routine does, and a fresh batch's data-name cells land
  at `[code]` (a code-only reading) until grounded. Lift a **RAM cell** `[code]`→`[seen]` by watching it
  under MAME — the value change, poke, or write-tap that confirms its role (a countdown draining to zero at
  spawn; a slot cursor advancing 1..5). A **ROM address** (a constant, a table base) is grounded by
  confirming what the machine *reads* from it and does with it, not by watching it change; it never changes —
  this is the harder, still-open case, so tag it `[code]` honestly when the chain cannot yet terminate in a
  MAME observation. Ground the cells a routine touches in the SAME pass as the routine — never lift the
  routine roles to `[seen]` and leave their cells at `[code]`.
- **Every understanding-pass worker reads `games/<game>/gameplay.md` first** — the naming derivers, the
  adversarial re-deriver, the grounders, and the mechanisms.md writers. It is the game's cast/objective/
  controls written outside-in from public sources, blind to the ROM (§0): the sanctioned *vocabulary* for
  saying what a routine does **in the game** (so a "spawn-gate counter that fires when the field thins" is
  named for *the flea*, not a generic counter). It is a **frame, not a source** — a name is still earned
  from the code effect and grounded in MAME, keeps its tag, and where gameplay.md disagrees with the code
  the code+MAME win (flag the gameplay.md line overturned). It matters most on the FIRST pass, when
  mechanisms.md does not exist yet. Full rule in `understanding.md` ("The outside-in frame: gameplay.md").
- Both get **three looks**: two BLIND independent derivations (from body + callers **+ gameplay.md as the
  outside-in frame**, neither sees the other), promote **only on convergence**, then a third **adversarial**
  re-derivation — two blind derivers can converge on the same wrong reading. The lead edits `names.js`,
  never a proposer. A name isn't done until code **uses** it (`names.js` + retrofit in one commit).
- **Promoting an idiomatic name = a rename retrofit in ONE commit — the concrete steps:** `git mv
  games/<game>/idiomatic/loc_<addr>.js <name>.js`; rename the **exported function** to match the file
  (`resolveAllIdiomatic` imports `mod[name]`, so export name = the ROUTINES `name` = the filename); in the
  equivalence gate, repoint the **idiomatic** import + its usages to `../<name>.js` but **leave the frozen
  oracle import `../../translated/loc_<addr>.js as oracle` untouched** — the translated layer keeps `loc_`
  forever, and the gate file itself keeps its `equivalence-<addr>` address name; update the `names.js`
  ROUTINES `name` field (and prose that cites the routine); rewrite `mechanisms.md` in the **same** commit
  (`understanding_gate` CHECK A binds a names.js change to a staged `mechanisms.md`; CHECK B forbids any
  **retired** `loc_` name from appearing in the map). Do the identifier swap with a **word-boundary
  script**, never a blanket replace — a blanket replace rewrites the frozen oracle import and the shared
  data-name consts. `git mv` stages the OLD blob, so `git add` the edited file and `git diff --cached` to
  confirm the rename **and** the content landed. The commit subject is `<game>: understanding pass N — …`
  (classifies UNDERSTANDING for R1). **The repoint scope is repo-wide, not just the game dir:** shared
  tooling (corpus scanners like `tools/bridge_reseat_scan.mjs`, gate configs) imports a game's routines by
  name/filename, so a bulk rename that scans only `games/<game>/**` leaves those dangling — and a missed one
  throws only in the FULL pre-push suite (a `tools/` change forces FULL scope), never in the idiomatic-test
  subset. Run the pre-push suite scope after a rename, not just `node --test games/<game>/idiomatic/test`.
- **Name by EFFECT**, not internal mechanism — trace each live-out to its final consumer and name the verb
  it causes (`steer`/`spawn`, not `classify`/`detect`); if the output is read in place of another input, the
  routine *generates* that input. Name a routine whose **mechanism** is confident even if its game-purpose is
  open (purpose as `[guess]`); `loc_` is reserved for an unclear mechanism.
- **A wrong name is worse than none.** When derivers diverge or the reading is underdetermined, stay hex
  and flag. **Recorded keep-hex decisions are binding:** a routine with no absolute entry point stays hex (a
  range fragment isn't its own routine); a refused name is not re-proposed; **read the `names.js` `why` and
  `mechanisms.md` before renaming** — a regex scan of the `why` is a broken instrument.
- **Ground a load-bearing, code-undecidable pick IN-LOOP before committing the name** — deferring
  propagates the wrong pick into everything built on it. Take four **theory-free** measurements first: does
  it execute and where; write-set (clone+diff vs the memory map); who calls it and what they do with the
  result; what changes on screen. Experiment: hypothesis → reach the state → watch → A/B with a **negative
  control** (the control is the proof) → prefer a natural run; verify a positive control actually moved
  pixels (a no-op write reads like an invisible one). On a write tap the reported PC is the **next**
  instruction.
- **Sweep reachability before deciding anything is blocked** ("unnamed" ≠ "unreachable"). A hit count is
  not a dispatch count for a routine that WAITS; tap a known-executing address first and confirm it's
  non-zero; without a driver the sweep measures attract only. A search's zero is not absence until the
  instrument is shown working on something known-present.
- **`mechanisms.md` is REGENERATED WHOLE every understanding pass — never patched, never an incremental
  edit, even for a one-routine change.** Throw the prior map away and re-derive the ENTIRE document from the
  current code, every time. Method: fan out one code-reading subagent per subsystem, each re-deriving
  mechanism from the ACTUAL routine bodies (idiomatic override + frozen oracle) **with `gameplay.md` as the
  outside-in frame** (the game's vocabulary, not a source — the code+MAME still decide) — **blind to the prior
  map**, forbidden to paraphrase it or the `names.js` role strings; the lead stitches the sections, VERIFIES
  every mechanism claim against the code, and carries grounding TAGS from the `names.js` `cert` field
  (`[seen]` is never re-invented by a code read — the TAG, not prose, is how the map records that MAME
  confirmed a role). **Grounding is conveyed by the tag, NEVER by narrative** — no "MAME overturned/confirmed
  X", no wave dates, no golden names; that is development history and gets stripped. A current-state WARNING
  that a reading is counterintuitive ("X is a counter, not a static base") stays, but stated about the code
  as it IS, with no before/after framing. **It is a CURRENT-STATE description, NOT a development history** —
  no "batch N did X" chronicle. **And it reads as NARRATION** — flowing, human-readable exposition a person
  follows to understand how the machine works, NOT a bare fact-listing (comma-strings of cells/offsets,
  bulleted catalogues). Every fact is present — cells, addresses, control flow, grounding tags — but woven
  into explanatory prose with the connective tissue (why a step matters, how the pieces fit) that makes it
  readable. `understanding_gate` CHECK A binds the regenerated map to the commit and fires on **additions**
  too; a fresh-vs-patched regeneration is a reviewer call. `names.js` is the single source for a cell's
  name/role/tag; prose cites it, never contradicts it (`names_consistency`). Promotion requires a
  proposer≠confirmer who **independently re-derives** — a prose review is not a confirmation.
- **Exception — a value-identical CELL-naming pass THREADS the map, it does not blind-regen.** When a
  commit only ADDS `names.js` cell consts + retrofits raw hex to those imports, proven value-identical
  (per-routine equivalence 0 fail, **no routine rename, no role/behaviour change, no new `[seen]`
  grounding**), the mechanism narrative is UNCHANGED — so a blind whole-regen would reproduce identical
  substance while risking LOSS of hard-won `[code]` insights the current map already holds (a blind
  re-derivation need not rediscover a subtle finding, e.g. a vestigial divider). Instead THREAD the
  newly-named cells into the citations the map already makes (matching its `NAME 0xADDR` convention) and
  re-verify each threaded claim against code, staged in the same commit — this satisfies
  `understanding_gate` CHECK A (mechanisms.md is staged) without a destructive regen. A routine RENAME,
  or ANY role/behaviour change, still takes the whole regen above: the ripple through the narrative is
  real there, so the blind re-derivation earns its cost. The one exempt rename is a value-identical rename
  made in the cleanup sweep (roles unchanged, right after the cleanup milestone's whole regen/currency
  check), which threads too — see the cleanup phase's "(1) RENAME". (Codified 2026-09-18 on the thepit RAM-naming
  pass; runbook rule-1 novel-decision.)

### The clock-free block — handle these four together

The idiomatic layer charges no cycles, so anything the real hardware ties to time or the beam needs
deliberate handling. These four are one problem and are decided together, once, per game:

- **Vblank / interrupt handling.** Running clock-free means a cycle-driven vblank busy-wait would never
  tick — so the frame boundary *is* the ROM's vblank-wait yield, and the interrupt is fired **at that
  yield** (the real machine only accepts it when the main loop idles). Spine routines that can reach a
  vblank wait become `function*` (callers use `yield*`; the classic bug is a `function*` called without
  `yield*`, which silently skips the wait); the vblank wait becomes `yield`; a warm restart is a boundary
  sentinel, **not** a `yield*`; leave the emulated CPU stack ops alone.
  - **No main-loop wait (the NMI is the sole heartbeat) → collapse to one iteration per frame.** Some games
    never busy-wait: the main loop free-runs and the vblank NMI, firing asynchronously, does ALL per-frame
    work (render + input + the game-state dispatch), so the CPU is interrupted at a PC spread ∝ execution
    frequency with NO single-PC spin. MEASURE this before assuming a dkong-style wait — an NMI-return-PC
    histogram off a MAME read-tap on the NMI vector (gate CURPC, read the pushed return PC off SP). With no
    ROM wait to yield at, the generator yield is SYNTHETIC: make the main loop a `function*` that `yield`s
    once per outer iteration, and set `nmiReturnPC` = `pollPCs` = the main-loop TOP. Firing one NMI per
    iteration keeps game-time 1:1 with MAME (every NMI is one frame) and collapses only the ~N redundant
    intra-frame iterations — VALID only because those are memory-idempotent (anti-tamper re-checks, VRAM
    refreshes that rewrite the same bytes). PROVE the idempotence, don't assume it: run the translated layer
    under `runCycleFree(pollPCs=[top])` and reconverge vs a MAME golden (`convergence.mjs --mode state`); a
    clean reconverge (only the RNG residual) confirms the collapse, a large persistent diff means an
    intra-frame iteration is NOT idempotent and the model is wrong.
  - **Retiring SP — the last register — by firing the idiomatic NMI as a DIRECT JS call.** The idiomatic
    layer targets zero registers, but `m.regs.sp` outlives every value register: once the value registers are
    threaded away, the only remaining SP user is how the generator engine fires the vblank NMI — through the
    **Z80 call/ret seam** (`fireNmi` does `push16(pc)`, the `withOmittedRet` wrapper does `read16(sp)` +
    `ret`), plus the boot's `m.regs.sp = <top>` seat that exists only to serve that push. **Do not exempt
    SP** — it is a CPU register like any other, the VBI included; remove what needs it, in two moves done
    together per game: (1) LIFT the frozen main-loop-step spine to idiomatic JS (no `m.step`/`m.call`/
    `m.push`) so the main loop never touches the seam; (2) in idiomatic mode FIRE the NMI as a direct JS call
    to the vblank-vector handler (`this.nmiCount += 1; return loc_<vector>(this)`) — no `push16`, no seam —
    gated on a per-machine flag the generator engine sets (`machine.idiomaticNmi = true` in
    `runIdiomaticGame`); the oracle / cycle-driven engine is a real Z80 with a real stack, so ITS `fireNmi`
    keeps the `push16 + step + call(vector)` path. The boot's SP seat is then vestigial (nothing reads SP) →
    drop it. Memory-equivalent: all the push+seam did was park the return PC on the guest stack and pop it —
    that word lands in `STACK_SCRATCH` (excluded from the diff) and the handler is SP-neutral, so no diffed
    cell moves; a fixed-address self-test tally the ROM keeps at the stack top is written by the idiomatic
    boot to that address directly, not via SP, so it is unaffected. The whole-game tape (it runs BOTH
    engines) is the arbiter; **update its stack guard to assert SP stays INERT** (never moves from its
    power-on value) rather than "SP stays within the stack window" — a retired SP sits at its reset value,
    below that window, so the old floor guard now mandates the very defect it should permit; the inert-SP
    check is the stronger, correct invariant. With this done the idiomatic layer holds no `m.regs.*` and
    `idiomatic_gate` registers reach 0.
- **Entropy pinning.** Most arcade RNG seeds from a spin counter the main loop increments while waiting for
  vblank — timing-derived, so a clock-free layer forks it within a few frames and every RNG-driven sprite
  drifts. **Pin it for testing only** (it forfeits falsifiability): discover the set by attract-diffing the
  two engines per frame (the spin counter forks first), declare `manifest.entropyPin`, express the pin
  **twice** (a JS seam and a cycle-neutral ROM operand patch) so the two check each other, and **never pin
  the shipped game.**
  - **A hardware-LFSR RNG read directly has no seed to freeze — pin it by RECORD/REPLAY.** Some machines read
    the RNG straight from a device register clocked by hardware (Tempest reads the two POKEYs' RANDOM registers
    at 0x60ca/0x60da), so there is no RAM seed and no store operand to patch — the `seedBytes`/`romPatches`
    model does not apply. Capture MAME's actual RANDOM read VALUES in read order, per register, from the SAME
    run as the golden (a lua read-tap), and replay them into the JS device read. The "express twice" cross-check
    becomes the per-register read COUNT matching MAME's — a drained or unread queue is a code-path divergence,
    not just an RNG one (surface it, never pad silently). Falsifiability is weaker than a seed-freeze (you feed
    the layer MAME's own RNG), so the real correctness anchors stay the DETERMINISTIC screens (no RNG —
    byte-exact WITHOUT any pin) and input-tape gameplay; the record/replay pin only removes RNG-fork noise so a
    genuine logic regression still shows (it never touches vector generation, proven by the gate's null-mutant).
    A clock-free layer that runs one update per rendered frame consumes RNG faster than MAME's higher-Hz render,
    so the capture must cover the JS layer's game-time.
  - **The PINNED gates are BLIND to the free-run states the shipped game reaches — add a standing FREE-RUN
    idiomatic-vs-oracle DISPLAY gate.** The pin is testing-only and the shipped clock-free RNG diverges from
    MAME's per-cycle timing, so the game builds display lists in states MAME never visits — and BOTH the
    per-routine equivalence tests and the pixel gate feed MAME's captured RANDOM, so a display-list port bug
    that only diverges in an unpinned state passes every one of them and surfaces only as a stray on-screen
    vector (Tempest: `emitEnemySlotEntry` discarded a callee's advanced cursor and emitted a 2-byte-short
    record, shifting every later enemy record → a stray green line in ~1% of attract frames, green while every
    gate was clean). Close the blind spot with a standing gate that runs the idiomatic layer UNPINNED over the
    full attract and, each frame, rebuilds the ORACLE's display list from the SAME entry state and the SAME
    RANDOM values the idiomatic frame consumed, then asserts the render inputs (vector RAM + colour RAM + beam
    flips) are byte-equal — pixel-confirmed on any mismatch (stale post-terminator bytes tolerated; any
    RENDERED divergence fails). It replays the per-frame display chain on a no-override oracle Machine, so it
    needs no pin and no golden: pure idiomatic-vs-oracle, fast, null-mutant-proven (reintroduce the bug → it
    fails). This is the class-level teeth for the "wrong only in an unpinned RNG state" bug the pinned gates
    cannot see. Model: `games/tempest/test/freerun-equivalence.test.js`.
- **Loose (convergent) pixel gating.** With entropy pinned, RNG- and DMA-driven pixels don't land
  byte-identical — they **converge**. Gate them with an **align-tolerant diff** (each frame vs its nearest
  golden frame): small deviations allowed, but the residual must **reconverge, never diverge**. **Never
  lower the floor to reach green** — the tolerance is a hardware-jitter property, calibrated once and
  committed, not a knob. **For a VECTOR game, diff PIXELS, never raw vector RAM:** bytes past the AVG's
  display-list terminator are stale and never render, so two byte-different vecrams can be pixel-identical (a
  large raw-vecram "diff" that is 0 pixels). Render both sides through the proven vector pipeline and compare
  the frames; a separate gate proves that pipeline byte-exact vs MAME.
- **Scan-line tricks (sprite multiplexing, split-scroll, status/palette splits).** Wherever the game
  mutates video state mid-frame in step with the raster, a single end-of-frame snapshot can't reproduce it.
  Use a **beam-sync band accumulator** (`startBeamFrame` / `paintBeamBand(row)` / `finishBeamFrame`)
  painting each band from current RAM, driven once per frame by a per-game beam routine; declare
  `manifest.convergence.beam`. It is **state-neutral** (final RAM identical); non-beam games cost nothing;
  validate with a positive control forcing the single-snapshot path so the residual returns.

### Driving coverage

- **Poke-tapes are required per game** — they pixel-validate the DISTANT routines (later levels, 2P,
  game-over, boss) the base tape never reaches, moving them `[code]`→`[seen]`. Key pokes on the **NMI
  ordinal**, never a raw frame index; use `POKE_OFFSET = 0` (a direct RAM poke has no input-debounce
  pipeline); poke the **trigger** then play in — poking a raw end-state renders coherent-looking garbage on
  both sides, a weak check.
- **Run a long continuous idiomatic run** (many minutes) diffed vs a matching golden, RAM first — the base
  and poke tapes are each too short to catch time-accumulated bugs that surface only deep into a session.
  ⚠ A RAM diff is BLIND to render and audio: the RAM can be byte-correct while the screen or the sound is
  wrong, so RAM-clean is necessary, not sufficient.
- **The deepest gameplay test is a long DRIVEN playthrough validated against MAME on pixels AND audio —
  not just a RAM replay-diff.** The system drives a long session itself (a scripted/agent input tape that
  exercises the collision / scroll / audio paths the attract gates and RAM state-diffs cannot see), run in
  BOTH the idiomatic engine and MAME (`mame -record`/`-playback`, and pass NO `-input_directory` or it
  silently no-ops). What a human would catch by EYE and EAR the system catches by diffing the two render +
  audio streams against MAME (the oracle), because these bugs never surface in RAM alone (a tilemap scroll drawn with the
  wrong sign renders every lane backwards yet stays RAM-clean and ~2-4% pixel-similar; a repeated effect
  that played only once because each hop re-writes the SAME sound-latch byte and the edge-deduped stream
  dropped the repeats).
- **Do NOT trust a fixed-origin frame-by-frame replay of a recorded tape vs MAME.** The idiomatic
  boot/board collapse warps the timeline NON-UNIFORMLY (a ~44-frame board wipe busy-wait drops to one
  frame), so a tape replayed at one constant frame-offset drifts and manufactures FALSE divergences (a
  "carry bug" that is pure replay desync). To replay-diff a real tape you must re-sync on a landmark per
  life/board — or reproduce the collapsed busy-waits' frame counts so the timeline stays aligned. The offset
  is not a constant across a whole session; it jumps at every collapse.
- **Per-mechanic POKE tests vs MAME are the reliable per-mechanic detector** (`tools/mechanics_gate.py`,
  game-agnostic; a game supplies `games/<g>/tools/mechanics_suite.py` printing `MECHANIC <id> PASS|FAIL`).
  For EACH declared mechanic, poke the exact scenario (frog on a log, mid-hop, at a bay) identically into the
  JS engine AND MAME, drive one input, and compare — MAME is the oracle, so there is no author-guessed
  expected value, and poking the setup sidesteps the tape-alignment problem entirely. The honest limit is
  that the mechanic LIST is not mechanically enumerable, so its completeness stays the adversarial
  done-audit's job.
- The dispatch **seam leaks two stack bytes** — MEASURE per dispatch what heals it (SP unmoved ⇒ the
  resolver supplies the `ret`; SP up two with `pc` on the held slot ⇒ the transfer did it; anything else ⇒
  raise, naming the routine). Bound the stack exclusion by the **measured** stack, not the game-state
  ceiling. Attract-only gates are blind — gates must **replay input tapes and assert the game responds**
  (banks credits, starts at the contract frame, player moves/scores), plus idiomatic==translated through the
  sequence and video RAM byte-identical, including **forced transitions the tapes never reach** (poke the
  ROM's own trigger).

### The cleanup phase — end of the idiomatic pass

Once `idiomatic_gate` reports **0 total cruft** (all six categories + 0 unlifted for a closure game) the
port is COMPLETE but terse. The cleanup phase turns it into a clean, self-documenting artifact. It is a
distinct phase, gated on a flag, and runs in this order.

- **Declare completeness — a GAME-LOCAL flag.** Set `idiomaticComplete: true` in
  `games/<game>/manifest.js` (NOT a repo-wide list; game settings live with the game). `idiomatic_gate`
  **enforces** it — a game that declares it at cruft > 0 is blocked — and `comment_gate` reads it to drop
  **both** its rules (density + reference) for that game's `idiomatic/**`, so cleaned routines may carry
  verbose comments that cite the ROM/hardware. The flag is the phase's precondition. (`docs/comment-gate.md`.)
- **Regenerate `mechanisms.md` whole, from code (blank-slate).** Per-subsystem agents write each section
  FROM THE CODE BODIES **with `gameplay.md` as the outside-in frame** (forbidden to read the old map or
  paraphrase role strings); tags come from `names.js` certs. The lead assembles, PRESERVES the grounding provenance (`[seen]` narratives — not code-derivable),
  writes intro/legend/open, and **verifies every claim against code** — fan that out: one adversarial
  checker per section, fold the real findings. The map carries **NO port plumbing** (`m.call`, the seam,
  `withOmittedRet`, `push16`, "address-dispatched") — that is how the port is wired, not how the machine
  works.
  **Exception — a map regenerated whole since the last role change needs a currency check, not another regen.**
  When the map was already regenerated blind (and section-checked) at a commit after which only register
  plumbing, value-identical renames and grounding tags changed — no routine's role or behaviour — the
  cleanup milestone runs the per-section adversarial checkers against the CURRENT code instead of regenerating:
  each claim re-verified, each fix given as literal replacement prose, applied by an editor and re-verified.
  A blind regen re-derives the same substance at real cost and risks losing grounding narrative; the checker
  pass catches exactly what drifted. Any role or behaviour change since the regen still requires the whole
  regen. (Codified 2026-09-30 on timeplt's cleanup; runbook rule-1 novel decision.)
- **Rewrite `names.js`.** It accretes run-on role strings and port-plumbing prose across the pass. Make
  every role concise, consistent, plumbing-free, correctly tagged. It is ONE file (edit contention): agents
  PROPOSE cleaned entries per disjoint address range; the lead APPLIES them serially as the single writer.
  Do this before the routine sweep, so the sweep references clean names.
- **Clean every routine, LEAVES-FIRST.** Topo-sort the idiomatic call graph (imports = calls) and clean in
  leaf-first waves — a callee cleaned (and any rename settled) before its callers — fanning out each wave
  fully. "Cleaned" = TWO obligations, BOTH required — do NOT let a comment-only verifier silently drop the
  rename half (that shipped a sweep comment-only once):
  - **(1) RENAME.** A routine whose role is understood — any `cert:"seen"`, and any `cert:"code"` whose
    mechanism is confident — still named `loc_<addr>` gets a descriptive EFFECT name, settled leaf-first
    before its callers. `loc_` is reserved for a genuinely-unclear mechanism, else allowlisted (with a
    reason) in `games/<game>/names-debt.txt`.
    **A cleanup-sweep rename THREADS the map, it does not regenerate it:** the rename is value-identical
    (roles unchanged, per-routine equivalence 0 fail), and the cleanup milestone has just done the whole
    regen / currency check, so thread the new names into the citations `mechanisms.md` already makes (and
    re-verify each threaded claim against code) in the same commit — CHECK A is satisfied, CHECK B still
    forbids the retired `loc_` names. A rename that changes a role still takes the whole regen.
  - **(2) COMMENT.** Verbose explanatory comments PLUS light code cleanup (fix misnomers, simplify locals).
  Never a behaviour change. **The byte-identical proof below verifies (2) ONLY** — a rename is not
  byte-identical, so verify it with the equivalence subset instead. **Enforced BOTH WAYS:** `done_gate`'s
  `naming` subsystem (`tools/naming_gate.py`) refuses the ship while any grounded routine is still `loc_`, and
  its `comments` subsystem (`tools/comment_gate.py floor`) refuses it while any idiomatic file sits below the
  comment floor (`code // 2 + 3`). So a comment-only sweep that skips (1), OR a rename-only sweep that skips
  (2) (the gap that let invaders ship DONE with a 0.27 comment ratio), cannot reach DONE.
  - **Comment standard:** a rich header (what it is, its role in the machine, ROM address, grounding tag,
    live-out) + a block comment before each logical step explaining the mechanism and WHY, citing the
    ROM/hardware — the level where someone who has never seen the game's internals could follow it.
  - **Prove it changed nothing but comments:** for a comment-only unit, strip comments + blank lines and
    assert the code is BYTE-IDENTICAL to pre-clean; run the equivalence subset + pixel as a backstop.
- **Land per the usual cadence.** Each unit: gates first (`comment_gate` now in verbose mode for the game),
  then an independent reviewer, then commit as Jimmy + push, single-threaded. Order across the phase:
  complete-flag + mechanisms regen (one milestone) → `names.js` → the leaf-first sweep.

## 5 — Ship

- **Web-worker contract** (get each right the first time): (1) register the id in `games/registry.js` or
  it never appears in the selector; (2) assemble **every** declared ROM image to `games/<id>/rom/`
  **honoring `offsets`** — a gapped image otherwise assembles to wrong bytes, fails sha256, and the others
  silently never build; (3) build the registry with **static imports** — never `node:fs`/`file://` (the
  browser rejects both); no `node:` builtin anywhere on the browser load path; (4) the Machine satisfies the
  worker contract — synchronous constructor, exported `resolveOverrides()`, live-render interface
  (`captureVideo`/`videoFrames`/`finishRasterFrame()`), exported `Inputs` class in the board io; (5) inputs
  manifest-driven across IN0/IN1/IN2; (6) exact ROT (step 1); (7) unported audio → silent, not broken; (8)
  `runtime: "idiomatic"` reads `manifest.convergence.idiomatic.nmiReturnPC` (§2) — the worker throws
  without it.
- **Ship a representative screenshot — the web selector REQUIRES it.** Every game gets
  `games/<game>/screenshot.png` — **this exact filename**, because `web/index.html` loads
  `games/<game>/screenshot.png` for the game's card; a game without it renders a broken card image on the
  live site (centiped shipped that way once — its card had no picture until the file was added). It is one
  representative frame (an attract title or clean gameplay, **never** a black boot/self-test frame),
  produced by `tools/screenshot.py <game> --golden <dir>` from the pixel-gate MAME golden's `frames.rgb`
  (decode a compressed golden with `golden_mp4.py decode` first). The tool applies the manifest's **ROT**
  (a portrait game comes out portrait, not sideways — verify by eye), scales ~3× to match the other games'
  cards, and writes `screenshot.png` by default. **Commit it** — a single small representative screenshot
  is **fair use** (the posture computerarcheology.com and every game wiki takes), an explicit carve-out
  from the "no ROM graphics" guardrail that covers *raw* graphics data (the gfx ROM, whole sprite/tile
  sheets), NOT one attract screenshot. **If the game also has a Computer-Archaeology disassembly**, produce
  the same frame as a smaller `.jpg` in **two** spots for the CA pages — `games/<game>/<game>.jpg` and a
  copy at `games/<game>/contrib/computerarcheology/<game>.jpg` (so `![<Game>](<game>.jpg)`, a path relative
  to the `.md`, resolves on GitHub). Do NOT commit a full-res sheet or the raw frames.
- **Deploy: the live site is a re-deploy, not per-game work.** The games appear from `games/registry.js`,
  so `https://www.qarl.com/arcade-js/` is refreshed by re-deploying the current `main` HEAD — coordinate
  with Jimmy-www.qarl.com (she owns the docroot + the live write); do not push the server yourself. After a
  deploy, spot-check the new game's CARD renders (its `screenshot.png` loads) and its manifest serves with
  the COOP/COEP headers. ROMs stay BYO — new games show as drag-and-drop "ROM required" cards unless a
  demo ROM is separately hosted for them.
- **Ground the sound-register writes during real gameplay BEFORE choosing the audio model.** The model
  (per-command clips vs a parameterized synth) is a decision to GROUND, not to guess from the MAME
  sound-device class: run a **write-tap on the sound registers over real play** (coin/start, then drive
  the game through its actual sounds) and classify each register — a **gated one-shot** (a brief pulse
  produces the whole sound) fits the **clip** recorder; a **sustained/parameterized** register (written
  continuously, the tone tracked by ongoing writes) needs the **synth** (`audio/synth.js`). Choose from
  that ground truth. Galaxian's audio phase started on the invaders per-clip model by analogy and had to
  reorient wholesale once the tap showed the dominant sound was a continuous synth (FS tones written ~900×,
  pitch continuously varying, the "fire" register never even enabled) — hours a five-minute tap saves.
- **Audio by record/replay** (don't emulate the second CPU): tap the soundlatch write and play a recorded
  clip per command (the tap is a nullable field, runs after the store, return discarded, must not throw).
  **Record, don't extract** — a game's sound may be discrete-analog or only exist once the audio CPU runs. A
  recorder drives real MAME headless, injects each command, captures a clip + an `index.json`. Gotchas:
  **mute the ROM's own soundlatch writes while injecting** (prove it with the silent-gap residual); **read
  the driver for how a command triggers** (a latch write may not raise the audio IRQ — the audio CPU can
  poll it on its own VSYNC IRQ, so "trigger" is *hold the byte ≥1 frame*); **do NOT loop off the recorder's
  `loop` flag** — it can't tell a looping tune from a sustained one-shot, so model **one voice** (a new
  command stops the previous and plays once) and earn looping only by detecting a real loop point via
  autocorrelation; **median-center** each segment (a PSG idle DC bias steps by thousands of LSB, and
  mean-centering reads silent tails as signal); isolate commands by pulse-vs-sustain stop timing, not by
  reset (a soft reset re-runs the autoboot). Committed = `manifest.audio.map` (data-only, evidence-based
  names, no invented sound names, no file paths); the WAVs + `index.json` are **gitignored copyright**
  (silence in a fresh clone is the point). Web side: dedup by raw write **address**, forward only changed
  edges; guard any polled surface behind a board-capability check. **Report evidence disagreements — never
  silently pick a winner**; when the driver and the measured hardware disagree, ship what the hardware does.
- **SYNTH model (discrete-analogue sound — no sound CPU, no sample ROM; galaxian `galaxian_a.cpp`):** there
  are no clips to record — the sound is a live parameterized tone synthesised above the emulation from the
  register writes (`manifest.audio.model: "synth"`, `audio/synth.js`). Its oracle is NOT a by-ear clip
  sign-off (nothing to audition) and NOT an aggregate envelope correlation — an aggregate CANNOT FAIL
  per-voice, so a model missing whole voices passes it (galaxian shipped silent on 3 of its 4 voices under a
  passing +0.7). The oracle is a **per-voice NULL-MUTANT test** (`test/synth-voices.test.js`: silence any one
  voice → the test goes RED), which `audio_gate.py` REQUIRES and RUNS for a synth game, and which refuses a
  synth that self-documents a stubbed/collapsed voice. Model every register; never dress a simplification as
  coverage.
- **★ New-subsystem DONE doctrine (the general rule the synth-audio gate instances):** the first time a game
  needs a NEW subsystem (a synthesised sound, a browser shell, a new render path), the DONE-gate almost
  certainly has NO TEETH for it — maximal rigor on the OLD surfaces manufactures false confidence (galaxian
  passed R40 "zero open" + an adversarial audio review, then a human found the browser + audio defects). Before
  DONE, run a **null-mutant "can this gate even fail?" pass** on each subsystem's gate: break the thing it
  checks; if it stays green it is decoration, not a gate. Build the teeth before claiming DONE.
- **Background music the clip model can't carry** (pooyan): the per-command recorder handles SFX and short
  self-contained tunes, but a game whose MUSIC is *sequenced* by the audio CPU (continuous, evolving,
  per-board) has NO per-command music clip — the music-select codes sound **nothing** in isolation, so the
  clip player goes silent/sparse where the real machine plays a score. **Diagnose before building**: tap the
  soundlatch stream AND the sound chip's register writes over real gameplay — a Konami `timeplt_audio`-style
  driver shows hundreds of AY-3-8910 writes/sec with continuous *software* pitch-slides + volume envelopes
  (the hardware envelope/noise generators unused), music and SFX mixed on shared channels, and a tempo read
  from the game timer. That is NOT reimplementable as "a few note tables". The choices are **(a)** per-context
  recorded music **beds** the port loops (a "stem jukebox" — simplest, "very similar"), or **(b)** run the real
  audio ROM on a 2nd CPU instance + a datasheet-simple sound-chip device — **exact**, and because the game CPU
  core already exists it is often the *smaller* path; a hand-reimplementation of the driver is the worst of
  both (re-porting the sequencer without the correctness). Default to (a); take (b) when exact is required.
- **The stem-jukebox method** (a): capture one MUSIC-ONLY bed per context (intro, each board tune) by recording
  MAME with the SFX/accent commands **suppressed** (the inverse of the recorder's inject-mute) — the real
  per-note synth detail bakes into the recording. Extract a clean loop (autocorrelation period → zero-cross cut
  → equal-power seam crossfade), captured long enough for the true musical period (weak self-similarity makes
  short loops audibly repetitive). At runtime the port already sees every soundlatch write, so **select** the
  bed by the music-select code, play it looping on a **separate voice**, equal-power **crossfade** on a context
  change, **stop** on the silence selector; SFX layer on their own voices (they sum — hardware voice-steals, so
  the port reads slightly fuller; an SFX-triggered duck approximates it). A tempo hurry-up is a **captured fast
  tier** selected off the timer RAM — never a `playbackRate` stretch (that raises pitch; the hardware shortens
  note durations, not pitch).
- **The faithful balance — match the ORIGINAL, not a loudness** (the level trap): measure on **DC-removed (AC)**
  audio — a PSG idle DC bias inflates raw RMS by tens of dB and makes the music look far quieter than it is; the
  real music is a **quiet AC background under loud SFX**. Capture beds at their **natural** per-context level
  (do not normalize them loud) so the port's music sits at the machine's music level, and raise the SFX to the
  machine's SFX level with a **per-game** gain — **never the shared clip-player master** (it would boost the
  frozen clips games). **Validate** autonomously against MAME by (i) per-context AC level match vs MAME and (ii) the port-vs-MAME
  AC-envelope **correlation flipping clearly positive** — the falsifiable "it tracks the original" test that a
  music-forward or static-loop mix fails (both are objective MAME comparisons, no human ear). Do **not** gate on tight sample-aligned spectral
  cross-correlation: a looped bed drifts phase and scores low even when it sounds right. A select-only control
  code sounds nothing in isolation — prove it is control, not a missing sound, with a **mutation control**
  (muting it in a gameplay run removes no audible energy). Honest residuals of record/replay music: frozen
  loops, a tempo staircase not a continuous ramp, no true voice-stealing. Beds are gitignored copyright with a
  recorder `--background` mode; the committed map keys beds by music-select code with start/stop + per-context
  gains; the audio sign-off covers the music too.
- **ROM stays out:** bring-your-own — tests guard on ROM presence and skip when absent; a rom-guard clone
  verifies a no-ROM checkout still passes. The manifest lists part filenames + sha256; `make rom` assembles
  from the user's dump and verifies.
- The standing whole-game gates (`idiomatic.test.js` boot→attract, `tape.test.js` coin/start/play,
  `transition.test.js` level/round/game-over) have run since the skeleton and gate the ship as-is.
- **Definition of done — a named gate, not a claim.** *Done* means a named gate ran and passed
  (`how-the-agents-worked.md`), never "it looks finished." A game is shippable only when **every** completion
  subsystem is green under its own gate — the live pixel gate **run against the FULL ~10-minute MAME golden
  (§2), never a short window** (that long run is also the authoritative §3-completeness check — a boot gap in
  a deep state = a still-missing routine a short gate never reaches), stage-B grounding complete (every
  `[code]` either lifted to `[seen]` or accounted-for as genuinely irreducible in `grounding-debt.txt` —
  see §4), the idiomatic gate at 0 (no registers/m.call/m.push*/raw addresses), the whole-game
  gates above, the external disassembly if in scope, and **audio**. Each is executed, not reasoned about; the
  ship is refused while any is red.
- **A fully idiomatic layer is required — zero translated routines, zero `m.call()`, zero `m.push*()`, zero
  register references.** The idiomatic layer REPLACES the frozen oracle; a game is not done while any
  reachable routine still runs as translated code in the live game, or while the idiomatic layer still holds
  Z80-level primitives. Concretely: **(a)** every reachable routine runs as JS in the live game — wired as a
  live override, or dissolved to a direct-called boolean for a caller-skip that cannot seat; the game's
  `UNWIRED` map in `tools/registry-coverage.config.mjs` holds **only such DISSOLVED entries**, never an
  "oracle-served / can't-seat" one, and there is no `m.call` into the still-translated layer. Dissolve an
  unbalanced tail-call (`return m.call(<translated>)`, whose translated `ret` drifts SP and throws at the
  override seam) into a **direct JS call**, and a caller-skip into a **boolean skip-signal** the caller
  early-returns on. **(b)** zero `m.push16`/`m.push*` — the ROM's stack trampolines become JS control flow; a
  coroutine/main-loop handoff uses the generator engine (`yield*`), not an `m.call`. **(c)** zero register
  references (`m.regs.*`/`regs.*`) in the body, and **(d)** zero raw `0xHHHH` addresses — every cell is a
  named import from names.js. Enforced mechanically and fail-closed by `tools/idiomatic_gate.py` (counts all
  four on a per-game ratchet toward 0) and folded into `done_gate` as the **idiomatic** subsystem, so any
  surviving primitive refuses the ship. dkong is the model. (Balanced legacy trampolines are not an exception
  — they too must be dissolved before done; the seam merely tolerates them meanwhile.)
- **Gameplay must be validated by INPUT-TAPE REPLAY — an attract-only gate does not count as done.** A pixel
  or whole-game gate that runs only boot→attract is BLIND to every in-play routine: the gameplay layer renders
  and runs identically whether it is correct, un-wired, or broken, because gameplay never executes. So done
  REQUIRES the pixel gate and the whole-game gate to **replay a coin/start/play input tape** through the
  *idiomatic* layer and assert it matches the MAME golden AND the oracle in GAMEPLAY, plus the **forced
  transitions the tapes never reach** (life loss, level/round advance, game-over). A boot→attract-only gate
  must NOT be counted green for done.
- **A game is NOT done until an independent adversarial agent agrees it is done.** The gates are necessary
  but not sufficient: a gate can be green while *blind* — measuring too little (an attract-only gate never
  exercises gameplay) or not covering a criterion at all (lifting/wiring, `m.call` dissolution, `loc_` cell
  naming). So the FINAL, MANDATORY step of done is a fresh **adversarial reviewer agent**, handed this
  runbook, that audits the game against *every* completion criterion and must independently conclude it is
  done — proposer≠confirmer applied to the done-claim itself, never the author's word and never "the gates
  are green." If it finds any open criterion, OR any gate that passes while validating too little, the game
  is not done. Record its verdict; a game with no adversarial done-audit on record is not done.
- **The done-audit is RECORDED as a committed `games/<game>/DONE.md`, and its commit is gated by the
  standing review gate.** The verdict above is not a chat claim or a scratch note — it is a committed file,
  and *that is the whole enforcement*: no new machinery, it rides `review_gate` (which already refuses any
  commit whose exact staged bytes lack an independent reviewer's PASS). `DONE.md` is written by the
  adversarial done-auditor and holds: `rom_sha256` (matching the manifest parts) + the commit it was
  audited at; a **per-§5-criterion verdict table** (each criterion → PASS + its evidence — the full ~10-min
  pixel golden, stage-B grounding complete, idiomatic gate at 0, the whole-game tapes + forced transitions,
  the external disasm if in scope, audio recorded+signed-off, the §3 completeness crawl, `loc_` naming, the
  cleanup phase, the `games/<game>/screenshot.png` selector image produced); and the auditor agent's identity + an
  explicit "zero open criteria" conclusion.
  Committing `DONE.md` triggers `review_gate`; the reviewer of that commit is a SECOND, independent
  adversarial agent (proposer≠confirmer) that re-runs the FULL §5 audit against the game state at that
  commit — **not** a read of `DONE.md` — and records PASS only on independent agreement (see
  reviewer-rules **R40**). So a *landed* `DONE.md` is itself proof that an independent agent verified done;
  **no committed `DONE.md` ⇒ the game is not done.** Honest ceiling (already stated in `review_gate`'s own
  header): `--no-verify` bypasses any hook and an agent could forge a token — the same trust the whole repo
  rests on for every commit; the audit can be re-run at any time to check it.
- **Audio-coverage gate.** Audio was the only ship step with no gate (historically "by ear"), so it is the
  step that silently gets skipped. `tools/audio_gate.py` is a completion gate requiring the committed
  artifacts a complete audio layer has (the model is dkong): `manifest.audio.map` + the map file; for a clips
  model, a `soundLatch` matching names.js `SOUND_CMD_LATCH`; and BOTH `test/audio-map.test.js` (coverage —
  every emitted command has a mapped clip) and `test/audio-wiring.test.js` (the soundlatch tap reaches the
  player). Those two committed tests do the enumeration/verification in the standing suite — the WAVs +
  index.json are gitignored copyright, so the gate cannot parse coverage itself; it guarantees the tests were
  not skipped. Because structure alone cannot tell a recorded+auditioned layer from an un-recorded stub,
  GREEN also requires a committed audio sign-off `games/<game>/audio/RECORDING-SIGNOFF.md` (`rom_sha256`,
  `clips`>0, `date`, `by_ear`) — an AUTONOMOUS attestation, not a human listen: the recorder
  (`record_samples.py`) drives MAME and captures MAME's OWN audio per sound trigger, so the clips are
  oracle-correct BY SOURCE (MAME is the reference — stronger than "sounds plausible"). The `by_ear` line
  records that basis (MAME-sourced clips + the map/wiring coverage above); rom_sha + clip count come from
  the recorder run. Legacy pre-runbook ports are grandfathered. Fail-closed when the layer, a test, or the
  sign-off is absent. The gate cannot re-audition the gitignored WAVs, but because they are captured from
  MAME their correctness is pinned at the source; a *missing or untested* audio layer becomes impossible to ship.

---

## Cross-cutting — the "plausible-but-wrong" class

The failure hardest to distrust is a **recognizable-but-wrong** image or a check that **passes for the
wrong reason**. Guard against it everywhere:

- Render **pens before RGB** so a pixel diff attributes to one half; **say which coordinate zero** every
  time (frame-origin vs raster line vs visible row differ by fixed offsets — the ambiguity breeds mislabels
  and cycle bugs). A **wrong constant can produce a perfect match** by hiding the pixels that would falsify
  it — any "is this displayed?" probe must write a value known to differ. **Raster-time the renderer** where
  a mid-frame write splits the frame. Carry MAME's own "this is wrong" notes faithfully rather than inventing
  a fix.
- **A gate arm that cannot fail is decoration; a gate that mandates the defect** (asserting a faithful
  rewrite's divergence) must be changed — measure the exclusion from the oracle. **A property with no owner
  AND no record of being unowned is a trap** (T-states, the full register file, DMA sub-frame position are
  deliberately unowned — write it down). While a review is in flight **nothing stages the index** (the review
  token binds to the exact staged diff).
- **Treat a stall/contradiction as a claim about the instrument first.** An empty capture/comparison
  directory is not a pass (0 comparisons and 0 failures share the success exit code). Retain **every** Lua
  tap token in a global (a GC'd tap flatlines and reads as a stall). A class fix by scripted string-replace
  propagates a per-site fact wrongly — **script the finding, never the fix.** A labelled-wrong constant beats
  a plausible unlabelled one; an UNVERIFIED placeholder says so and names where the real value comes from.
- Small language traps that read as data: a default parameter is a landmine for a `.map(fn)` callback (arg 2
  is the index → a NaN that looks like data); integer division truncates toward zero (use `Math.trunc`, not
  `Math.floor`, on signed values). Numbers base-10 (hex only for irreducible bit ops); `u8()`/`u16()` for a
  load-bearing wrap. `comment_gate`: comments ≤ code//2 + 8, each describes *this* file only — when it trips,
  cut prose (whole-file freeze). Commit messages ≤ 10 lines.

---

## Legacy games — do not be surprised they diverge

The ports already in `games/` were built under earlier iterations of this method and **do not yet follow
this runbook**. They work and are pixel-validated against MAME, but their test names, gate wiring, and
configuration predate the process here, so expect inconsistencies. **This is known, not a defect to
chase.** The runbook is the go-forward spec; the existing ports are legacy it supersedes. **Do not retrofit
them** — reconcile them only once this process is proven on a new game.
