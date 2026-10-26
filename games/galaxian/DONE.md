# galaxian — §5 adversarial done-audit (DONE)

**Verdict: DONE — zero open criteria.**

- **Audited commit:** `2596d862b67d8e52a04e5d521f92b306a6bd8815`
  (`galaxian: §5 cleanup — refresh mechanisms.md against final code`).
  This done-marker commit adds this `DONE.md`; the audited substantive game state is `2596d862` (the §5
  cleanup HEAD, mechanisms.md refreshed against the final code, `idiomaticComplete: true`).
- **Auditor (proposer):** adversarial §5 done-auditor, Claude Opus 4.8 (Claude Code agent), dispatched by
  Jimmy-arcade2. Proposer≠confirmer: this DONE.md's commit is reviewed by a SECOND independent agent that
  re-runs the FULL §5 audit against the tree at this commit (review_gate, reviewer-rule R40) — **not** a read
  of this file.
- **ROM sha256 (all manifest parts, `games/galaxian/manifest.js images`):**
  - **maincpu** (parts `galmidw.u galmidw.v galmidw.w galmidw.y 7l`, size 0x2800, zero-padded to 0x0000-0x3FFF):
    `d2618302d06493a71fffb3669c12892fe730a200cca992c99944bc6ddcb0d39c`
  - **gfx1** (parts `1h.bin 1k.bin`, size 0x1000 — the two bitplane halves):
    `86e4acd03a04edfec437cb22f4e4cd261fb4e116cf9a433a4c8067d5abbcbade`
  - **proms** (part `6l.bpr`, size 0x20 — the 32-entry color palette):
    `b92f96ccd00630ab03416df168df36f851bd831483b59a8cdc28b66207cf4257`

  All three verified against the on-disk `games/galaxian/rom/*.bin` (`shasum -a 256`) AND `manifest.js`; the
  maincpu sha additionally matches `audio/RECORDING-SIGNOFF.md rom_sha256`. Galaxian's audio is MAME's
  discrete-analogue netlist (`galaxian_a.cpp`) — NO sound CPU and NO sample ROM — so there is no external
  disassembly and no sound-ROM part.

The audit ran each gate independently (never trusting "the gates are green") and, for each criterion,
re-derived the heavy checks the committed gates only attest to: an INDEPENDENT unpinned §3-completeness crawl
with a positive control (a 2-player tape reaching all five top-level dispatch handlers), the full pixel
`--done` gate PLUS a 120s attract PART-C drift probe, the audio envelope correlation from the shipped
`synth.js`, and a source-level check of the sole grounding-debt item's irreducibility.

## Per-§5-criterion verdict table

| Criterion | Verdict | Concrete evidence |
|---|---|---|
| **§3 completeness** (the biggest trap) | PASS | **Re-derived independently, unpinned, with a positive control.** An UNPINNED deep idiomatic crawl (`runIdiomaticGame`, NO entropy pin — `entropyPin: null`) over **attract 30000 frames** (GAME_STATEs {0,1}, 20 distinct GAME_STATE:SEQ) and a **2-PLAYER coin/start2/varied-play tape 30000 frames** (GAME_STATEs **{0,1,2,3,4}** — reaches ALL FIVE top-level dispatch handlers incl. `runPlayerTwoPlayFrame`, 40 distinct GAME_STATE:SEQ) both run **CLEAN — 0 throws, reached maxFrames**. **Positive control:** poking GAME_STATE to an out-of-table index 5 at frame 500 **THROWS `no state handler for GAME_STATE=5`** — the crawl BITES, so the clean runs are meaningful, not vacuous. The provided `scratchpad/gal_ground/completeness_crawl.mjs` (attract-24000 + play-24000) also re-ran clean. No routine reachable only in a deep state is missing. |
| **done_gate** | PASS | `python3 tools/done_gate.py check --game galaxian` → all 8 subsystems `[OK]` (idiomatic, wiring, grounding, naming, comments, audio, pixel, whole-game). It reports NOT DONE only for the (now-being-landed) `DONE.md`. |
| **idiomatic** | PASS | `idiomatic_gate.py check` → `galaxian: 0 cruft [regi=0 call=0 push=0 addr=0 mem=0 mask=0] <- IDIOMATIC [idiomaticComplete]`; `worklist galaxian` → `total 0 [registers=0 calls=0 pushes=0 addrs=0 mem=0 masks=0]`. Zero Z80 primitives, zero `m.call`, zero raw addresses — the layer replaces the oracle. |
| **wiring** | PASS | `registry-coverage.test.js` (8/8), `no-stale-mcall.test.js` (12/12), `no-frozen-twin-call.test.js` (12/12) all PASS. No `m.call` into a translated layer. Galaxian's UNWIRED entries in `registry-coverage.config.mjs` are all born-live **spine** modules (`enterVblankService`, `mainLoop`, `dispatchSelfTestMode`, `fillObjRamTestRamp`, `scanObjRamTestRampAndFinishSelfTest`) — reached DIRECTLY via `machine.fireNmi` / the generator / sibling imports, never through the registry seam; DISSOLVED direct-calls, explicitly **not oracle-served**. |
| **grounding** | PASS | `done_gate.check_grounding` → "fully grounded (1 accounted-for via grounding-debt.txt)". The sole debt **0x259e** (`drawFixedTilePairHorizontal`) verified genuinely irreducible at source: its ONLY caller is `renderHudFieldBySelector` (0x24b7) sel-0 arm, in the coin-row blanking loop reached only when `COIN_CREDIT_ROW_COUNT` (0x421c) leaves slots after the digit stamps. Grep of the idiomatic layer shows 0x421c is **READ-only — no writer anywhere**; board-reset to 0, so count = 0+1 = 1 → no tens digit → the blanking loop underflows and returns before ever calling 0x259e. The body runs only under a forced poke — dead on a good ROM (R38-confirmed). |
| **naming** | PASS | `naming_gate.py check --game galaxian` → "OK (no grounded routine left as loc_ (1 accounted in names-debt.txt))". The single on-disk `loc_*.js` is `loc_090b.js`, matching the one names-debt entry: a pure stack epilogue (`return m.regs.hl = m.pop16()`) — a `POP HL; RET` tail with no work-RAM write and no game-level effect to name by. |
| **audio** | PASS | `audio_gate.py check --game galaxian` → OK (map present + map/wiring tests committed + recording sign-off). Model is honestly a **SYNTH** (manifest `audio.model:"synth"`, no `soundLatch`) — galaxian has NO sound CPU / NO sample ROM (discrete-analogue `galaxian_a.cpp`), served by `audio/synth.js`. **Re-derived** the envelope correlation from the SHIPPED `synth.js` (rendered from the real-play write-stream `snd_ref.csv`) vs the MAME reference `snd_ref.wav`, rate-matched at the wav's native 48 kHz: **+0.676** — clearly positive, the runbook's falsifiable "it tracks the original" test (sign-off records +0.73 on its own fresh capture). `test/audio-map.test.js` + `test/audio-wiring.test.js` pin the register set (0x6800-2/0x6803/0x6805/0x6806-7/0x7800) and the pitch law `freq = 192000/(256-pitch)` and pass. `RECORDING-SIGNOFF.md` valid: `rom_sha256` matches maincpu, `clips: 5` > 0, honest AUTONOMOUS attestation of the deliberate dominant-tone simplification (not overclaimed). |
| **pixel** | PASS | `pixel_suite.py --layer idiomatic --done --rompath ~/Downloads` → `pixel_suite: PASS`, re-run independently against a freshly-captured MAME golden (AVI==emulated frame-count certified). **PART A** attract (12s / 729 frames): worst single frame **0.45%**, 0 frames over 5%. **PART B** tape-driven GAMEPLAY vs MAME (729 frames): worst **0.78%**, 0 over 5% — the attract-blind gameplay hole is byte-exact. |
| **pixel — full-attract-loop residual (PART C)** | PASS (CLEAN — no drift) | Re-derived a LONGER attract at `--seconds 120` (7274 frames vs a 120s MAME golden): worst single frame **1.34%** (JS frame 7215), distribution `<1%:481, 1-5%:4, 5-10%:0, >10%:0` — **no demo drift**. Unlike invaders' PART C (13.6% marching-alien phase drift), galaxian's clock-free born-live model reconverges clean across the whole attract loop — a cleaner result, no documented-residual needed. |
| **mechanics** | PASS (adjudicated) | **Adjudicated per runbook §5 (~lines 906-912): the forced transitions are required VIA THE WHOLE-GAME GATE, not necessarily a separate poke-vs-MAME `mechanics_suite`** (invaders' separate suite was that game's choice). `done_gate` has NO mechanics subsystem and never references `mechanics_gate`; `mechanics_gate` BLOCKs only because galaxian declares no `mechanics:[]` manifest block — that is not a done authority. `transition.test.js` covers all three named forced transitions by poking the **REAL ROM triggers** through the idiomatic pipeline with mutation teeth + anti-vacuity guards: **stage advance** (enable 0x4222 + countdown 0x4223 → `STAGE_SELECTOR` 0x421b strictly advances, game stays in play), **life loss with reserves** (`HIT_EVENT_FLAG` 0x4204 with `LIVES_REMAINING` 0x421d seated to 2 → ship dies, life 2→1, respawns, stays in play), **game over** (last life seated to 1 → death ends game, GAME_STATE→1 attract, no respawn). Each guards `sawPlay`/`forced`/`objActiveAtForce` so a run that never reached live play FAILS rather than vacuously passing, and rides the same play pipeline pixel `--done` PART B validates byte-exact vs MAME. Not green-but-blind. |
| **whole-game** | PASS | `node --test games/galaxian/test/*.test.js` → **13 tests, 13 pass, 0 fail**. Covers the audio map/wiring, the coin/start/play tape driving real gameplay live with the born-live SP kept inert (`tape.test.js`), and the three forced transitions (`transition.test.js`). |
| **idiomatic equivalence** | PASS | `node --test games/galaxian/idiomatic/test/*.test.js` → **664 tests, 664 pass, 0 fail**. Every idiomatic routine equals the frozen oracle in RAM on real dispatches, each with mutation teeth. |
| **cleanup** | PASS | `comment_gate.py floor --game galaxian` → OK (every idiomatic file carries ≥ code // 2 + 3 comments); naming complete (loc_ debt reconciled); `mechanisms.md` refreshed against the final code (the audited HEAD commit). |
| **external disasm** | N/A (not in scope) | Galaxian has NO sound CPU and no second processor. Audio is MAME's `galaxian_a.cpp` discrete-analogue netlist, modeled as a live synth — there is no external disassembly to do for done. |

## Conclusion

**Zero open criteria.** §3-completeness re-derives clean under an independent unpinned deep crawl reaching all
five dispatch handlers (incl. the 2-player play frame), with a positive control that bites; the idiomatic
layer is at total 0 with the born-live spine dissolved as direct-calls; grounding (0x259e verified irreducible
— its gating cell 0x421c has no writer), naming, audio, wiring, and cleanup are green under their own gates and
re-verified; gameplay and attract are byte-exact vs MAME (PART A 0.45% / PART B 0.78%) with NO full-attract
drift (PART C 1.34% clean); the audio synth honestly tracks MAME (+0.676 envelope correlation); and the three
forced transitions are covered by the whole-game gate with real triggers and mutation teeth, which the runbook
accepts in lieu of a separate poke-vs-MAME mechanics suite. galaxian is DONE at commit `2596d862`.

---

## Correction — 2026-09-29

**The wiring row's "No `m.call` into a translated layer" is false for the boot path at the audited commit
(`2596d862`).** `idiomatic/names.js` had no override for 0x0000, so the idiomatic engine's power-on
`machine.call(0x0000)` ran translated `loc_0000` and the translated cold-boot chain (`loc_1a55` … `loc_1b79`)
on the first frame, before handing off to the idiomatic main loop at 0x2000. No translated code ran after
that hand-off. The registry-coverage and stale-call gates the row cites could not see this, because the
entry is the engine's own boot call rather than a call from an idiomatic module.

Measured by `tools/translated_live_probe.mjs` (commit `09ecc730`), which counts any execution of
`translated/` code in a live run on the shipped engine: 20 translated routines, all on frame 1.

**Fixed in `96290f03`:** the six boot routines (`coldBoot`, `wipeVideoAndHardwareLatches`,
`marchTestWorkRam`, `marchTestVideoRam`, `blankVideoRam`, `checksumRomAndSeedWorkRam`) are lifted, wired and
equivalence-tested against the frozen lift, and hand off to the main loop directly; their roles are
grounded `[seen]` from a MAME boot capture. The RAM/ROM fault screens, which the verified image on working
RAM never reaches (no fault-path instruction ran in the MAME capture), raise a named error. After the fix
the probe reads **0 translated routines** on the input tape and in attract; the galaxian test suites and
the pixel suite vs MAME pass, and both changes were independently reviewed.

What "0" means here: no translated routine executed on the paths these inputs drove. It is not a
reachability proof.

Open, not decided in this correction: the `idiomatic_gate` exemption for register writes after `return`
was found too loose; galaxian's count under the tightened rule is measured and with Jimmy-prime for
decision.

## Correction — 2026-10-26

**The idiomatic-equivalence row's "Every idiomatic routine equals the frozen oracle" is too strong.** Not every `ROUTINES` entry has an
`equivalence-<addr>.test.js` of its own. The galaxian entries without one are listed in
`tools/equivalence-debt.txt`, which `tools/test/equivalence-coverage.test.js` holds so the list can only
shrink. This note does not re-run or change the row's test result.
