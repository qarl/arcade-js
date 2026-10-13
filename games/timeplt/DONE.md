# timeplt — DONE

**Game:** Time Pilot (`timeplt`, Konami, 1982), arcade-js, Z80 / timeplt.cpp.

- **rom_sha256 (maincpu program ROM):** `ec89258096bfcf64f5940f85cc58a67b89b6061834fb13f6829e88534a8e9066`.
  The other images are tpsound `d98da26e5ae670504d48b610d1956907c17fd8ecb9e3f0192b010bcb351023e8`, tiles
  `c557f9c38a04c15c11c981708a59510d50f00e86bb920831595d41260584bf95`, sprites
  `e92b2ffbe01ee8ede0f0a1df0ef5b3c31776a2ac140cd46959d65535006588c5` and proms
  `09aae834a5310925d8700fbbaececbcee7868177634bbcb4314df0b57f129a66`. All five were checked at audit time with
  `shasum -a 256 games/timeplt/rom/*.bin`; each equals its `games/timeplt/manifest.js` part, and
  `mame -rompath games/timeplt/rom -verifyroms timeplt` reports the romset good.
- **Audited commit:** `27571596516997ac70c607b7fa44c54403dcbe66` (`timeplt: prose — three sixteen-sector dressers;
  life-start retires vs frees; R40 minors`). The audit ran in a private clone built with `git archive 27571596`
  plus the local ROM images and the gitignored recorded clips; the real tree and index were not touched.
- **Auditor:** `opus-r40ad-timeplt-auditor-1`, a fresh adversarial agent that did not build timeplt.
  Proposer≠confirmer: the commit of this DONE.md goes through `review_gate`, whose reviewer is a second
  independent adversarial agent that re-runs the full §5 audit (reviewer-rule R40); reading this file does
  not count.

## Method

Every criterion was re-executed in the clone; no earlier audit's claim was taken on trust. `done_gate check` ran
once through a wrapper that only (a) forces `--test-concurrency=1` on its `node --test` children and (b) points
its long-golden subprocess at a shim setting `long_golden.MIN_FREE_GIB = 28` (see disclosure 1); every child's
full output was logged. Everything ran under `nice -n 15`, one node test worker and one MAME run at a time.
Three read-only helpers checked shipped prose statically against the ROM bytes decoded with
`tools/z80_decode.py` (never against the CA page under audit) and the MAME captures in `scratchpad/tp-ground/cap`:
A — mechanisms.md and the CA README/Hardware/Code.md/RAMUse.md preambles (about 250 claims, by its count);
B — names.js roles/whys/cells, 34 module headers, 204 sampled ca-lines glosses plus an automated scan of all of
them, and a 25-routine cross-surface read; C — CA data-as-code reachability, every grounding-debt line (R39) and
every names-debt line. All three re-decoded every text 27571596 changed. I re-checked the 0x2B93, 0x2A97 and
0x19F0 (life-start retire) texts myself from the decode.

**Disclosures.**
1. *Disk floor.* `df -h ~` showed 42 Gi free at launch (recorded in the audit log), so per the brief the long
   golden ran with `long_golden.MIN_FREE_GIB` set to 28 at runtime for that process only; the file was not
   edited, and pins, tapes and verdict logic are unchanged. Both 600 s goldens were captured fresh.
2. *Recorded clips.* `git archive` does not carry the gitignored `games/timeplt/audio/samples/`; I copied them
   from `~/arcade-js` into the clone before running `done_gate`, so audio and the browser gate ran with clips
   present. `tools/browser_runtime_gate.mjs` ran once (inside `done_gate`).

## Per-§5-criterion verdict

| Criterion | Verdict | Evidence (independently re-executed at `27571596`) |
|---|---|---|
| **`done_gate check`** (pre-filter) | PASS | Every subsystem `[OK ]`: idiomatic, wiring, grounding, understanding, naming, comments, audio, pixel, whole-game, browser, disasm. Its only refusal is the expected one: no committed `games/timeplt/DONE.md` yet. |
| **Full ~10-minute pixel golden vs MAME** (§2/§5, `tools/long_golden.py`) | PASS | `long_golden: PASS -- timeplt`, exit 0. **Attract:** idiomatic RAM byte-exact on 35766 frames at offset 236, no shift; pixel worst 449px whole / 34px band; 292 frames above the band (cap 292); 0 tears. Oracle RAM byte-exact on 36002 frames at offset 0, no shift; worst 7px; 1 above the band (cap 1). **Gameplay** (tape: coins on both slots, service, 1P/2P starts, stick incl. diagonals, fire): idiomatic RAM byte-exact on 35766 frames, no shift; worst 2261px whole / 551px band; 455 above the band (cap 455); 7 isolated tears. Oracle RAM byte-exact on 36002 frames; worst 4px; 5 above the band (cap 5). Every render `stop null` (idiomatic painted 36002, oracle 36001). **Teeth:** `run --part attract --null-mutant` → `long_golden: FAIL -- attract/idiomatic: pixels: 29216 frame(s) differ above the band, over the pinned top_frames cap 292`, rc=1. |
| **30 s pixel `--done` bar** | PASS | `pixel_suite.py --layer idiomatic --done` → `pixel_suite: PASS`. Golden 1802 frames (1050 distinct), render 1566 (1044 distinct), `CLEAN … no translation gap`. Attract residual 32 (pinned 32). Gameplay non-vacuous: coin accepted f402–448, play active f502–1801; residual 59 (pinned 59); tight band rows 113.. worst 33px (budget 100, over 0). Sound 0xC000: 40 writes, value and frame equal to MAME. |
| **Distant tapes, both layers** (forced transitions) | PASS | 17 `games/timeplt/tapes/*.poke.json`, each with a fresh MAME capture. Idiomatic: all 17 inside `done_gate`'s pixel subsystem, each logged `distant_suite: PASS -- <name>` rc=0. Oracle: I ran all 17 — each `distant_suite: PASS -- <name>` rc=0. They cover game over, high-score entry then a 2P start, pass-turn, two-player handoff, round won (bonus-life mark crossed), all four Mother-Ship eras plus both ram boxes, era 1, era 4, the countdown slot, the deepest rung and the parachutist. |
| **Whole-game gates + input-tape replay** | PASS | `done_gate` whole-game → `PASS (+ per-routine equivalence suite)`: its `distant-reach-tape` + `idiomatic` run was 88/88 pass, and the 392 `*.test.js` files under `games/timeplt/idiomatic/test` ran `tests 6847, pass 6847, fail 0, skipped 0`. I also ran every `games/timeplt/test/*.test.js`: `tests 132, pass 132, fail 0, skipped 0`. Gameplay replay vs MAME on both layers: the long-golden gameplay part and the distant tapes above. |
| **Fully idiomatic** (tightened rule) | PASS | `idiomatic_gate.py worklist timeplt` → `timeplt: total 0 [registers=0 calls=0 pushes=0 addrs=0 mem=0 masks=0 imports=0 stack=0 unlifted=0]`; `TIGHT_GAMES = {"timeplt"}`. My own grep finds no `m.call`/`m.push*`/`m.step`/flag-register reference in `games/timeplt/idiomatic/*.js`; the remaining `m.regs.*` text is parameter defaults and return-assignments, the forms §4 sanctions. |
| **Wiring + live translated-code probe** | PASS | `done_gate` wiring → `PASS (registry-coverage, no-stale-mcall, no-frozen-twin-call; live probe 0 translated (tape+attract))`. My own probe runs: tape 3600 frames → `reached maxFrames`, stopError null, instrumented 418, routines/uncounted/late/deferred all 0, PLAY_ACTIVE 0xad30 true for 3439 frames from f162; `--attract` 7200 frames → reached maxFrames, all four lists 0, witness never true (first −1). So `tools/test/translated-live-all-done.test.js` will pass once this file exists: timeplt has a `TAPES` entry and a `PLAY_WITNESS`, `KNOWN_FAILING` is empty, and tape play (f162) comes before attract play (never). |
| **Stage-B grounding complete** (R16 strict + R39) | PASS | `done_gate` grounding → `fully grounded, every cell carries its own tag [strict R16] (15 accounted-for via grounding-debt.txt)`; `strict-report` → `cells=473 seen=471 untagged=0 code=0 guess=0 debt-covered=2`. **R39 (helper C):** for every one of the 15 debt lines, a whole-image scan for the address as a word, jp/call target and jr/djnz target matches the stated entries; no capture fetches any debt address, while each guard site executes and falls through. The folds recompute from the bytes (sum 0x4AA0×256 = 0xB8, XOR 0x176A×0x18 = 0xC9, sum 0x4BA5×240 = 0x11, seed 0x4A40 + 0x33 bytes from 0x0B06 = 0xEF), and the witness cells read only their good values. The 13 `cert:"code"` routines plus the two `[code]` cells are exactly the 15 debt lines. There is no 0x10fd line; names.js 0x10fd is `cert:"seen"`. The rewritten 0x0bdd line's three other readers (folds at 0x4B23, 0x588D, 0x5BE3) are confirmed in the bytes. |
| **§3 completeness crawl** | PASS | Long golden: no boot gap, dropped frame or short run on any part or layer (`stop null` throughout); pixel suite `CLEAN … no translation gap`; `unlifted=0`; probe 0 translated. |
| **Naming / cleanup RENAME obligation** | PASS | `naming_gate.py check --game timeplt` → `OK (no grounded routine left as loc_ (23 accounted in names-debt.txt))`; timeplt is not in naming `LEGACY`. The 23 `loc_` modules, the 23 `loc_` names in names.js and the 23 names-debt lines are the same set (helper C). Reasons verified: the ten data-landing and filler entries; 0x10F8 (word hits only in data, transfers only `jr` inside multiplexSpriteSlots); 0x3793; 0x43F0 (no `F0 43` word in the image, only transfer `jr nz` at 0x43C0); the doubled-velocity family (peaks 206/231/256/281/306/331 recomputed, the 0x59A0 body doubles both components); loc_5854/loc_594e (dead rungs 0x5846/0x585A/0x5948/0x595F unreferenced and never fetched). See residual 3. |
| **Comment floor + cleanup phase** | PASS | `comment_gate.py floor --game timeplt` → `OK (every idiomatic file carries >= code // 2 + 3 comments)`; `manifest.idiomaticComplete: true`. |
| **mechanisms.md current / shipped-prose truth** | PASS | `done_gate` understanding → `PASS (mechanisms.md and module-comment citations match names.js)`. No port plumbing (m.call, seam, withOmittedRet, push16, "this port") in mechanisms.md, and no "not observed / under MAME" admissions between the first `## ` heading and `## §9`. The helpers found **no** ROM-false claim a plausible reader would take away; the minor items are listed under residuals. **Every 27571596 text re-decoded and TRUE:** the 0x2A97 why names three sixteen-sector siblings (0x2A57 returns the pair; 0x2AFC and 0x3FAF store it; 0x2A97 resolves thirty-two sectors: `add a,4 / and 0xf8 / rrca / rrca / and 0x3f`); the life-start retire list in mechanisms.md:135 and :596 (0x3C0D clears 0xA8C0 and 0xA8D0, 0x3DFB takes 0xA8E0, 0x48AD the parachutist at 0xA8F0, then a seven-pass `call 0x2bde` loop over 0xA8F0 and 0xA900–0xA950, the first six of the eight scenery records 0xA900–0xA970; 0x1AE4 frees and renumbers every record from 0xA810); the hideAllSprites caller list (nine `call 0x15b6` sites, 0x135A in the round-won band animation); SCREEN_UNFLIPPED readers (0x0106, 0x036B, 0x13DF, 0x1ED1); the 0x2B93 role (0xF0 arm stores 0x3B and calls 0x2BBA at 0x2BB0; 0x3C arm `call z,0x2bba` at 0x2B9D, then `jp nc` always flies it on); the 0x460E award sound (`call z,0x580b` at 0x463A; 0x580B is `ld a,(0x49ee) / jp 0x560c`); the 0x10FD and 0x10F8 rewordings; the cold-start rewordings at 0x2E2E/0x49D3/0x49A8 (`jp 0x32eb`, twelve-pass delay, then 0x00A8 and the foreground loop at 0x0B93); the paintLabelledNumericReadoutColumn digit order (0x4C48 steps to +3, 0x0D73 reads +3, +2, +1); and the port-shape whys restated as ROM facts. |
| **External disassembly (CA) in scope** | PASS | `done_gate` disasm → `leak scan clean; pages match gen_ca_contrib (re-traced from the ROM)`. Helper C: Code.md covers every byte 0x0000–0x5FFF and matches the ROM; every executed PC in the 27 read and 27 write captures is a Code.md instruction start, none inside a data block or mid-instruction; the only data rendered as code are the six tamper landings (0x0167, 0x0F8D, 0x1F2E, 0x2251–0x22BE, 0x307F, 0x461B), each with a comment saying so; all nine dispatch tables render as data; all labels sit at their own address and match names.js; no port self-reference on any of the four pages. |
| **Audio recorded + signed off** | PASS | `audio_gate.py check --game timeplt` → `audio-coverage [timeplt]: OK (model=clips; map + map/wiring tests + recording sign-off)`; timeplt is not in `LEGACY_NO_SIGNOFF`. `RECORDING-SIGNOFF.md` rom_sha256 = the tpsound part; `clips: 30` = the 32 index.json entries minus the 2 marked silent. |
| **Browser / web-worker contract** | PASS | `done_gate` browser → `PASS (worker-form boot; input map == MAME ports; headless browser boot+canvas+keys+audio, mutants red)`: `web/test/games-boot.test.js` "timeplt: boots the way the web worker constructs it" ok; `input_map: PASS -- timeplt`; `browser_runtime_gate.mjs` → `control: PASS`, `mutant latch (must fail audio): FAIL`, `mutant coinbit (must fail keys): FAIL`, `browser_runtime: PASS -- timeplt`. |
| **Screenshot** | PASS | `games/timeplt/screenshot.png` 672×768 8-bit RGB PNG, viewed: a portrait gameplay frame (1-UP/HI-SCORE header, clouds, era-0 biplanes, the player ship, reserve ships, CREDIT). `timeplt.jpg` 224×256 is byte-identical at `games/timeplt/` and `contrib/computerarcheology/`, and the CA README references it. |
| **Prior blocking findings closed** | PASS | r40ac2 O1 is closed: the 0x2A97 why names all three sixteen-sector siblings, verified above. Of the earlier minors, the texts 27571596 rewrote (mechanisms.md :135/:328/:392/:596, the 0x2B93, 0x460E, 0x10FD, 0x49A8 roles, the 0x10F8, 0x07B1, 0x1F3E, 0x40AB, 0x46DB and loc_43f0 whys, the readout-column, loc_594e and velocityForHeadingAt* headers, the 0x0bdd debt line) all decode true. Two earlier minors are NOT fully closed and are carried as residuals: r40ac residual 4 (naming consistency, residual 3 below) and part of r40ac2 minor 7 (port-shape wording survives in the names.js:681-684 block comment, residual 1). tp-comp spot-reproduced at this tree: SHIP-1 (no mechanisms.md/names.js/gameplay.md or naming-meta wording in any CA page), SHIP-2/GO-1 (`LONG_GOLDEN_GAMES = {"timeplt"}`, run and passed), GO-3 (timeplt not in `LEGACY_NO_SIGNOFF`, audio tests run), GO-4/CC-1 (browser runtime and input-map gates run with mutants red), GO-5 (timeplt not in naming `LEGACY`), GO-6 (`MAP_GAMES` includes timeplt), CD-1/CD-2/GI-4 (`TIGHT_GAMES = {"timeplt"}`, gate 0), U4 (Code.md "raise" hits are signal/flag raises, no RAISES/throw/fault claims), C1/PG-1 (round advance, steering and the Mother-Ship kill are in the distant tapes above). |

## Residuals (recorded transparently; none done-blocking)

1. **Minor prose.** `ca-lines.md:4001` / Code.md 0x4623 "step the sequence counter": the instruction is
   `dec (ix+0x00)` on the Mother-Ship wreck countdown (IX = 0xA8A0), which the neighbouring glosses (0x45F9,
   0x45FC) also call "the sequence"; it reads as SEQUENCE_SUBSTEP. `mechanisms.md:927` cites names.js as an
   authority in the body text ("names.js gives the on-glass mapping…"); the mapping is correct. Unpublished:
   the names.js 0x5628 why lists the fetches from 0x5634's call sites and tail jump but not the third entrant,
   requestCoinSound's `jp 0x5628` at 0x57F4; names.js:681-684 keeps "No file calls more than one", port-shape
   wording the 0x40AB why itself dropped.
2. **CA cosmetics (re-judged).** None makes a false data/code claim. The unreferenced code at 0x0B54–0x0B7A,
   0x46A6–0x46B9, 0x4B07–0x4B18 and 0x5277–0x5285 sits under bare "data" headers (the page header defines data
   as spans never reached); `loc_08fa` has no label line; the 0x22BF–0x23E2 block carries the rest of script 2
   and all of DEMO_AUTOPILOT_SCRIPT_THIRD (0x22FA) with no heading for that name; PEN_ROUTE_TABLE's last word
   shares its high byte with the first opcode of publishSpriteShadow (0x0365) without a note; RAMUse.md lists
   RAM names in camelCase only, so most SNAKE_CASE names on Code.md are not searchable there.
3. **Naming consistency.** loc_43f0, loc_10f8 and loc_3793 stay hex under the binding no-absolute-entry rule,
   but 0x1253, 0x1F01, 0x4008, 0x4108 and 0x50EE also have no absolute entry word (reached only by `jr` from
   0x1214, 0x1EFC, 0x4001, 0x40F2, 0x50B5/0x50B9) and carry descriptive, grounded names. No name is false and
   every kept hex has a recorded reason, so the RENAME obligation holds; the rule's application is uneven.

## Conclusion

**Verdict: DONE — zero open criteria.** Every §5 criterion was re-executed at `27571596` and passes: the full
10-minute golden (attract and gameplay, both layers, RAM byte-exact on every compared frame, null mutant red);
the 30 s `--done` bar; all 17 distant tapes on both layers; the whole-game tests and the 6847-test equivalence
suite; idiomatic gate 0 under the tightened rule; wiring and the live probe at 0 translated on tape and attract;
strict stage-B grounding with every debt entry irreducible on a good ROM; naming, comment floor and cleanup flag;
mechanisms.md and the shipped prose with no ROM-false finding, including every text the last fix changed; the CA
disassembly with no undocumented data shown as code; audio recorded and signed off; browser input map and runtime
with mutants red; the screenshot; and all five ROM sha256s. The residuals above are minor wording and
consistency items for a later prose pass.

*Auditor: opus-r40ad-timeplt-auditor-1. Every line above comes from a command run in this audit, not from a prior
claim.*

## Lead note — 2026-10-13

Residual 1 above was fixed after this audit in `47ac7de6` (prose only, independently reviewed): the 0x45F9,
0x45FC and 0x4623 glosses name the Mother-Ship wreck countdown, mechanisms.md states the on-glass mapping
without citing names.js, the 0x5628 why names requestCoinSound's `jp 0x5628` at 0x57F4, and the retire-helper
comment says no routine calls both helpers. Residuals 2 and 3 stand as recorded. The R40 reviewer of this file
re-audited the game at the commit that lands it.
