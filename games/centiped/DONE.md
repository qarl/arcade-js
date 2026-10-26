# centiped — §5 adversarial done-audit (DONE)

**Verdict: DONE — zero open criteria.**

- **Audited commit:** `e3f923b85e469bf998d19c3bbd2d41f75e934f72`
  (`centiped: boot the IRQ game in the web worker (+ trackball input)`), `== origin/main`.
  This done-marker commit adds this `DONE.md`; the audited substantive game state is `e3f923b8` (HEAD, the
  web-worker boot + trackball input, `idiomaticComplete: true`).
- **Auditor (proposer):** adversarial §5 done-auditor, Claude Opus 4.8 (Claude Code agent), dispatched by
  Jimmy-arcade2, NOT involved in building the port. Proposer≠confirmer: this DONE.md's commit is reviewed by
  a SECOND independent agent that re-runs the FULL §5 audit against the tree at this commit (review_gate,
  reviewer-rule R40) — **not** a read of this file.
- **ROM sha256 (all manifest parts, `games/centiped/manifest.js` images):**
  - **maincpu** (parts `136001-307.d1 136001-308.e1 136001-309.fh1 136001-310.j1`, four 2KB program ROMs
    contiguous at 0x2000-0x3FFF):
    `5edba8a30cd31c4ca67538fc83c6f6ea9303cc73168d26f46e47ec6753509a88`
  - **gfx1** (parts `136001-211.f7 136001-212.hj7`, size 0x1000 — the two bitplane halves):
    `ff6403bd4313c269984f476a35dbe6ed1e9d4433a368e4579a5f4d8964b35177`

  Both verified against the on-disk `games/centiped/rom/*.bin` (`shasum -a 256`) AND `manifest.js`. Centipede
  has **NO colour PROM** (colours from writable RAM 0x1400, `centiped_v.cpp:186`) so there is no `proms`
  image, and **NO sound CPU / no sample ROM** (a single POKEY PSG driven straight off the 6502,
  `centiped.cpp:1821`) so there is no external sound disassembly.

The audit ran each gate independently (never trusting "the gates are green") and, for each criterion,
re-derived the heavy checks the committed gates only attest to: the full pixel `--done` gate re-run against
the cached full 600s attract golden + a gameplay-tape golden, the pixel-bound teeth (a fork-floor extension
must RED), an independent confirmation of the §3-completeness positive control at source, a source-level
read of two of the seven grounding-debt items, and the audio per-voice null-mutant.

## Per-§5-criterion verdict table

| Criterion | Verdict | Concrete evidence |
|---|---|---|
| **§3 completeness** (the biggest trap) | PASS | **Re-derived on two independent angles with a real positive control.** (a) The pixel `--done` completeness path runs the live idiomatic layer over the WHOLE 600s attract golden and it completed **36002/36001 frames CLEAN — no gap, crash, or throw** (a demo that plays through waves, deaths, respawns, and a full board-recycle at frame ~33730). The gameplay tape drove **coin/start/PLAY for 902 frames clean**. (b) The idiomatic gate is at **total 0 / unlifted 0** — no reachable routine still served by the translated oracle. **Positive control (verified at source, not assumed):** `machine.js:127` throws `NotImplemented("m.call: no routine registered at 0x…")` for ANY unregistered routine the live path reaches, and `convergence.mjs:404` REDs the run when `out.length < frames` (truncation from that throw) — so a boot gap in a deep state would bite; the clean full run proves none exists. The two ROM "gaps" spot-checked are **DATA, not missed code**: `loc_346d` (0x346d, ROM row-descriptor pointer table) and `HIGH_SCORE_INIT_TABLE` (0x3a69, high-score init table) are both `[seen]` grounded tables in `names.js`. The high-score/initials-entry subsystem is fully **lifted** (loadHighScoreTableFromEarom, readEaromCell, tickEaromWriteback, validateOrResetHighScores, foldHighScoreChecksum) — a pixel-coverage residue (see below), not a completeness gap. |
| **done_gate** | PASS | `python3 tools/done_gate.py check --game centiped` → all 9 subsystems `[OK]` (idiomatic, wiring, grounding, naming, comments, audio, pixel, whole-game, browser). It reports NOT DONE only for the (now-being-landed) `DONE.md`. |
| **idiomatic** | PASS | `idiomatic_gate.py check` → `centiped: 0 cruft (budget 0) [regi=0 call=0 push=0 addr=0 mem=0 mask=0 stack=0 unlifted=0] <- IDIOMATIC [idiomaticComplete]`; `worklist centiped` → `total 0`. Zero Z80/6502 primitives, zero `m.call`, zero raw addresses, zero unlifted routines — the layer replaces the oracle. `idiomatic-budget.txt` = 0. |
| **wiring** | PASS | `node --test tools/test/{registry-coverage,no-stale-mcall,no-frozen-twin-call}.test.js` → **35 tests, 35 pass, 0 fail**. Centiped has **no UNWIRED exemptions** in `registry-coverage.config.mjs` (nothing exempted — the strongest form); no `m.call` into a still-translated layer; no import+call of a frozen twin. The live path builds its override table from `idiomatic/names.js ROUTINES` (`machine.js:298-303`). |
| **grounding** | PASS | `done_gate` grounding line → "fully grounded (7 accounted-for via grounding-debt.txt)". Two of the seven verified genuinely irreducible-on-a-good-ROM at source: **0x2120** (`CODE_CHECKSUM_BASE`) — `loc_2119`'s `runTailWriters` folds an EOR checksum of its own 20-byte code block ($2120..$2133) into $fe; a code/data overlap (the byte is an `lda #$03` opcode), read only by that anti-tamper sweep, grounds nothing role-specific. **0x140c** (`PALETTE_COLOR_0C`) — written only in `loc_3d57` (the operator self-test INPUT screen, an endless service loop reached only while the service switch is held), `mem8[PALETTE_COLOR_0C + y] = a`; unreachable in play, read by nothing in play. Both honestly account for a cell a frame-scripted good-ROM capture cannot reach. |
| **naming** | PASS | `naming_gate.py check --game centiped` → "OK (no grounded routine left as loc_)". No `names-debt.txt` needed. |
| **comments** | PASS | `comment_gate.py floor --game centiped` → OK (every idiomatic file carries ≥ code // 2 + 3 comments). |
| **audio** | PASS | `audio_gate.py check --game centiped` → OK (`model=synth`; map + map/wiring tests + per-voice null-mutant test passes + no self-documented simplification). Model is honestly a **SYNTH** (manifest `audio.model:"synth"`, no `soundLatch`) — centiped has NO sound CPU / no sample ROM (single POKEY PSG off the 6502), served by `audio/synth.js` from the POKEY register writes (`io.js pokeyWrite → onSoundWrite`, 0x1000-0x100F). The oracle is the **per-voice NULL-MUTANT** test the runbook requires for a synth game: `node --test games/centiped/test/synth-voices.test.js` → **7 pass, 0 fail** (silence any one voice → RED). No aggregate-correlation blindness. |
| **pixel** | PASS | `python3 games/centiped/tools/pixel_suite.py --layer idiomatic --done --rompath ~/Downloads` → `pixel_suite: PASS` (re-run independently). Four teethed sub-checks against the full 600s attract golden + a gameplay-tape golden: **attract bounded pixel** [W,33000] avg **0.000%** / max **0.078%** (thresh avg<0.1 max<0.25), null-mutant avg 5.343% (bites); **attract bounded state** avg **3.0B** / max **9B** (thresh avg<20 max<40), null-mutant avg 184.3B; **completeness over all 36001** frames asserted clean in both; **gameplay (a)** idiomatic-vs-oracle avg **25.8B** / max **67B** (thresh avg<50 max<100), null-mutant 74.4B; **gameplay (c)** oracle-vs-MAME avg **72.8B** / max **138B** (thresh avg<110 max<180), null-mutant 155B. |
| **pixel — bound has teeth** | PASS | Re-derived the fork-floor teeth myself: `convergence.mjs --mode state --layer idiomatic --converge-until 34000 --t-avg 20 --t-max 40` → **FAIL** (residual max 82B ≥ 40B, exit 1) — extending the correctness bound to include the frame-33730 fork REDs; the gate's `--converge-until 33000` PASSes (max 9B). Completeness teeth are structural + unconditional (`convergence.mjs:404` fails on truncation from any gap/crash, always over the full golden even in bounded mode). |
| **whole-game** | PASS | `node --test games/centiped/test/*.test.js` → **22 tests, 22 pass, 0 fail** (audio map/wiring + per-voice null-mutant, the coin/start/play tape, and the forced level/round/game-over transitions). |
| **idiomatic equivalence** | PASS | `node --test games/centiped/idiomatic/test/*.test.js` → **396 tests, 396 pass, 0 fail**. Every idiomatic routine equals the frozen oracle in RAM on real dispatches, with mutation teeth. |
| **browser** | PASS | `node --test web/test/games-boot.test.js` → **8 pass, 0 skipped**; `centiped: boots the way the web worker constructs it`. The manifest wires the IRQ-engine entry for the coroutine engine (`convergence.idiomatic.irq: {bootAddr:0x3b04, irqVblank:[0,0,0,1]}`), Inputs across IN0/IN1/IN2 + trackball. Actual browser runtime + trackball motion are human-confirm-only per runbook §5 (node cannot drive pointer/canvas). |
| **cleanup** | PASS | `comment_gate floor` OK; naming complete (no loc_ debt); `mechanisms.md` present (532 lines, narrated subsystem-by-subsystem against the final idiomatic code) and does not discuss the port seam. |
| **external disasm** | N/A | Centipede's sound is a single POKEY PSG driven straight off the 6502 (`centiped.cpp:1821`) — NO sound CPU and NO sample ROM. There is no external disassembly to do for done. |

## The three named residues — each honest, bounded, and not a blocker

1. **Attract-demo clock-free fork at frame ~33730 (562s).** The idiomatic (clock-free) layer matches
   MAME/oracle **perfectly** for frames 5..33729, then hard-forks on a heavy wave-restart / board-recycle in
   the demo (RNG count 5706 vs 5726 = −20). Diagnosed to `serviceTimerBank`'s countdown-bank timing on the
   heavy iteration (pinning $34-$41 to the golden reconverges RNG to MAME's exact 5726; the RNG reads match
   ri-for-ri — a reorder hypothesis was falsified). Crucially, the **cycle-driven ORACLE matches MAME EXACTLY
   over the full 600s** (RNG 5726/5726, avg 24.6B), so this is **exclusive to the clock-free layer's timing
   approximation** — the classic clock-free hazard (# interrupts during a computation depends on how long it
   takes), which the runbook's clock-free block explicitly permits as an honest bounded residual. It is
   **attract-demo only** (a player never watches a 9.4-minute attract) with **zero player-visible impact**.
   The pixel `--done` gate bounds attract CORRECTNESS to [W,33000] (tight: max 0.078% px / 9B state) AND
   asserts COMPLETENESS (clean run, no gap) over ALL 36001 frames, with **verified teeth** (extending the
   bound to 34000 REDs; a truncation REDs). Not a completeness gap: the layer runs clean to 36001.

2. **Trackball INPUT-MODEL boundary vs MAME.** `io.applyTrackball` (an integrator model) is not MAME's
   quadrature decode, so BOTH JS layers diverge from MAME under gameplay trackball input (idiomatic ~54B,
   oracle ~73B — the oracle, cycle-accurate, diverges MORE, isolating the cost to the shared input model, not
   to the idiomatic layer). Byte-exact gameplay-vs-MAME is therefore an unreasonable bar. Gameplay is instead
   gated by **(a)** idiomatic-vs-oracle (the two JS layers must agree in play — tight floor avg<50/max<100,
   null-mutant 74.4B bites; confound-free, both share the trackball model) and **(c)** oracle-vs-MAME (names
   the boundary; bounded floor avg<110/max<180, null-mutant 155B bites; a real gameplay regression blows
   past it). Named, bounded, teethed on both sides — not chased.

3. **High-score INITIALS-ENTRY — pixel-uncovered residue.** The attract demo never reaches a
   game-over-with-qualifying-score, and the gameplay tape is one board, so the initials-entry VISUAL path is
   not pixel-asserted. It is **not a missing routine**: the whole high-score/EAROM subsystem is lifted
   (`loadHighScoreTableFromEarom`, `readEaromCell`, `tickEaromWriteback`, `validateOrResetHighScores`,
   `foldHighScoreChecksum`) and dispatched (idiomatic total 0 / unlifted 0), and covered by the equivalence
   suite. An honest pixel-coverage residue, analogous to a grounding-debt dead path.

**Also (expected per runbook §5):** browser trackball MOTION is human-confirm-only — node cannot drive
pointer/canvas — so the browser gate confirms the worker-form construct/render/input/sound seam and boot, and
leaves live trackball feel to a human, as the runbook prescribes for a new render/input path.

## Conclusion

**Zero open criteria.** §3-completeness re-derives clean on two independent angles (a clean 36001-frame
attract run + a clean 902-frame gameplay run, with a source-verified positive control that bites on any
unregistered routine) and the idiomatic gate is at total 0 with nothing exempted; grounding (7 accounted,
two spot-checked irreducible at source), naming, comments, audio (per-voice null-mutant), wiring, whole-game,
idiomatic-equivalence, and browser boot are all green under their own gates and re-verified; the pixel
`--done` gate PASSes all four sub-checks with verified fork-floor + completeness teeth; and the three named
residues (attract clock-free fork, trackball input-model boundary, high-score initials-entry) are each honest,
bounded, and player-invisible with the correct gating. centiped is DONE at commit `e3f923b8`.

## Correction — 2026-10-26

**The idiomatic-equivalence row's "Every idiomatic routine equals the frozen oracle" is too strong.** Not every `ROUTINES` entry has an
`equivalence-<addr>.test.js` of its own. The centiped entries without one are listed in
`tools/equivalence-debt.txt`, which `tools/test/equivalence-coverage.test.js` holds so the list can only
shrink. This note does not re-run or change the row's test result.
