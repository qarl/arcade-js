# RAM findings — the player (Mario)

**Status: DRAFT. Nothing here has been independently verified.** These are *proposed* names with the
evidence behind each, for a separate verifier to re-derive. Per `README.md` §4, a wrong name is worse
than hex, so anything I could not evidence is **left out** and listed under [Rejected](#rejected) with
what I actually saw — that list is part of the finding, not an omission.

---

## What counts as evidence here

The two grades below are not "sure" vs "less sure". They are two different *kinds* of claim, and the
distinction decided several of the calls in this document:

* **Correlation** — differential state diffing. Run twice with inputs differing in exactly one way,
  dump RAM per frame, diff. This shows *this byte moved when I held Right*. It cannot tell a cause
  from a consequence: a byte that merely mirrors Mario's position for the renderer moves under Right
  exactly as the real position does.
* **Control** — poke the byte and watch the world obey. If the poked value **persists** across later
  frames (nothing upstream rewrites it) and **subsequent behaviour is relative to it**, the game logic
  reads that byte, modifies it, and writes it back. There is no upstream owner. This is strictly
  stronger, and it is cheap here, so I used it wherever I could.

`confirmed` is reserved for control evidence, or for a ROM use so unambiguous that the routine and its
docstring mnemonics settle it (cited per row). `inferred` means reasoned from the disassembly and
consistent with observation, but I never poked it and never saw it vary enough to discriminate.

### The calibration standard: `0x6203` / `0x6205`

This project already ran the decisive experiment on these two, and I reproduced it. Poked mid-game,
Mario renders at the poked location, **the value persists on subsequent frames** (it is not rewritten
from some logical position held elsewhere), and he can then be **walked around from there** — later
input moves him relative to the poked value. That discriminates the two readings differential diffing
cannot separate: sprite coordinates recomputed each frame would snap back within one frame. They do
not; they become the basis for further motion.

So the names are `MARIO_X` / `MARIO_Y`, **not** `MARIO_SPRITE_X` / `MARIO_SPRITE_Y`.

My reproduction: `--poke 0x6203=0xa0@1600:once --poke 0x6205=0xf0@1600:once`, then Left held from frame
1640. X held 160 through frames 1601–1639 with the poke long released, then walked 160→157→153→147→140
under Left, with Y tracking the girder slope (240→242) as it does for un-poked walking. Corroborated by
`games/dkong/tools/prize_suite.py`, whose collision gate compares `0x6203`/`0x6205` **exactly** against
the item's stored x/y and fires the pickup — so game logic consumes them, not only the renderer.

---

## Method

* Engine driven through `games/dkong/tools/emit.js` (`--input`, `--poke`, `--frames`, `--state-out`),
  coin at frame 400 / start at 460 — the pinned tape contract in `games/dkong/tapes/README.md`.
  Gameplay begins ~frame 1462; Mario spawns at X=0x3F, Y=0xF0 on 25m.
* State dumps are 5120 B/frame; work RAM `0x6000–0x6BFF` is bytes 0–3071, sprite RAM `0x7000–0x73FF`
  is 3072–4095, video RAM `0x7400–0x77FF` is 4096–5119.
* **Differential diffs**: hold Right / Left / Up / Down / Jump for N frames vs. hold nothing, diff work
  RAM across the window, keep the addresses that move.
* **Poke-control tests** on every candidate that could take one (13 of them).
* **Ladder search**: swept the release frame of a held Right and then held Up, 43 runs — found climbable
  ladders at X≈99 (broken, stalls at Y=228) and X≈203 (full, top at Y=211).
* **Hammer**: mirrored `games/dkong/tapes/test_hammer_25m_lower.lua` (poke Mario to 0xBB,0xD0; jump to
  grab), against a poke-only control.
* **Death / lives**: 9000-frame idle run — three deaths, three respawns, game over, attract demo.
* Cross-checked every candidate against a ROM-wide scan of absolute-addressing opcodes
  (`32/3A/21/22/2A/DD21/FD21 nn nn`) over `rom/maincpu.bin`, to count *all* sites touching an address
  rather than only the ones I happened to read in `translated/`. That scan is what rejected several
  otherwise-plausible names: a byte with a second writer in an unrelated routine cannot carry a name
  derived from one of them.

All scratch was kept outside the repo and deleted.

---

## The player block: `0x6200–0x6226`

`sub_0f56` (ROM 0x0F56, `games/dkong/translated/state0.js:6108`) clears **0x6200–0x6226, 0x27 bytes**
at board/life init — that is the player record's extent, stated by the ROM itself. `0x6200` is also the
`IX`/`IY` base loaded by seven routines (0x124B, 0x1BB2, 0x2808, 0x2853, 0x2974, 0x29B2, 0x2B1C), so the
block is an instance of the game's generic object layout.

| address | proposed name | what it means | evidence | confidence |
|---|---|---|---|---|
| `0x6200` | `MARIO_ACTIVE` | Player-alive/active flag (object-format byte +0; bit 0 is the "slot active" bit `entry_2913` tests at ROM 0x2915). 1 = alive and processed, 0 = dead/inert. | **Control**: poked 0 at frame 1600 mid-play → Mario froze at (63,240) permanently, the death→life-decrement→respawn cycle ran, and respawn restored it to 1. Second control: poking `0x6220=1` mid-jump made the landing set it to 0 (see that row) while the identical un-poked jump kept it at 1. **Observation**: in the idle run it goes 1→0 at each death (f1660/2383/3106) and 0→1 at each respawn (f2185/2908). **ROM**: `entry_1c4f` @0x1C57 `ld (0x6200),a` with `a = (0x6220) xor 1` (`state0.js:9182`). | confirmed |
| `0x6202` | `MARIO_WALK_ANIM` | Walk-cycle index. Advanced by `entry_3009` each time a walk *step* completes; `0x6207`'s low bits are `0x6202 & 3` every frame. Cleared to 0 when the post-landing freeze expires. | **ROM (unambiguous)**: the only writers are the two walk routines — `loc_1c8f` @0x1CA1 (move +, `entry_3009` arg 5) and `loc_1cab` @0x1CC0 (move −, arg 1) — plus `loc_1b55` @0x1B68 `xor a; ld (0x6202),a` (`state0.js:9286,9317,8920`). **Observation**: Right cycles 0,2,4,1…; Left cycles 0,1,4,2… (same value set, reversed order), and `0x6207 & 3` equals `0x6202 & 3` on every one of 140 frames. ⚠️ **The inline comment `// facing` on `state0.js:9277` is not supported by this data** — both directions produce the same value set, so `0x6202` does not encode direction. Facing lives only in `0x6207` bit 7. | confirmed |
| `0x6203` | `MARIO_X` | Mario's X position, whole pixels. | See [calibration standard](#the-calibration-standard-0x6203--0x6205) above: poke persists and later movement is relative to it (control, not correlation), plus `prize_suite.py`'s exact-match pickup gate. **Correlation**: +1 under Right, −1 under Left (2 px per 3 frames). **ROM**: `loc_1cd2` @0x1CD5 `ld hl,0x6203; ld a,(hl); add a,b; ld (hl),a` — read-modify-write of this very byte (`state0.js:9351`). | confirmed |
| `0x6204` | `MARIO_X_FRAC` | Fractional part of X, 1/256 px. `0x6203:0x6204` is a 16.8 fixed-point X. | **Observation (exact arithmetic)**: in a Right-held jump it alternates 0/128 while X advances exactly 0.5 px/frame, matching the 0x0080 velocity in `0x6210:0x6211`. **ROM**: cleared alongside `0x6206` at jump init (`loc_1b8a` @0x1B99, `state0.js:8977`) and by `sub_1f46` @0x1F4C (`state0.js:11683`). Those are its only two write sites in the whole ROM. | confirmed |
| `0x6205` | `MARIO_Y` | Mario's Y position, whole pixels (larger = lower on screen). | Same calibration experiment as `0x6203`. **Correlation**: arcs 240→226→240 across a jump; −2 per climb step; follows the girder slope while walking. **ROM**: `loc_1d11` @0x1D14 `ld hl,0x6205; add a,(hl); ld (hl),a` (`state0.js:10644`). | confirmed |
| `0x6206` | `MARIO_Y_FRAC` | Fractional part of Y, 1/256 px. `0x6205:0x6206` is a 16.8 fixed-point Y and is what the ballistic integrator actually updates. | **Observation (exact arithmetic)**: treating `Y16 = 0x6205*256 + 0x6206`, the per-frame delta over a whole jump is exactly `−(V + 8 − 16n)` with `V = 0x6212:0x6213` and `n = 0x6214` — **0 mismatches over 40 frames**, and still 0 mismatches after poking V (see those rows). A byte that is not the low half of Y cannot satisfy that identity. **ROM**: same two write sites as `0x6204`. | confirmed |
| `0x6207` | `MARIO_SPRITE_CODE` | Mario's sprite tile code in bits 0–6; **bit 7 is the horizontal flip = facing** (set = facing right). Copied to the player's sprite record at `0x694D`, whose byte the sprite hardware decodes as code + flip. | **ROM (unambiguous)**: every writer preserves bit 7 and ORs a code — `and 0x80 / or 0x0E` at jump init (0x1BA1), `or 0x0F` on landing (0x1C62), `or 0x06` on grabbing a ladder (0x1B1F), `xor 0x80 / or b` per climb step (`loc_1d3f` @0x1D47), `ld (hl),6` at a climb limit (0x1D69); `loc_1c8f` (move right) ORs 0x80 and its twin `loc_1cab` (move left) does not (`state0.js:9290,9319`). **Observation**: Right → 0x80,0x82,0x81; Left → 0x00,0x01,0x02; 0x8E airborne; 0x8F for the 4-frame landing; 0x03/0x04/0x05 climbing; 0x06 at a ladder limit. ⚠️ **Not** control-tested: poking it while Mario is idle does not reach the sprite buffer, because the copy routine `entry_1da6` only runs on a frame where the movement state machine does work. | confirmed |
| `0x6208` | `MARIO_SPRITE_ATTR` | Colour/attribute byte of Mario's sprite record (constant 2 in every frame I sampled). | **ROM**: `entry_1da6` @0x1DB2 copies it to `0x694E` (`state0.js:10607`), i.e. byte +2 of the 4-byte record; `boards/dkong/video.js:704-705` decodes sprite byte +2 as `colour = b & 0x0f` plus the bank/flip bits. That fixes *which hardware field it is*. It does **not** fix the name: the byte never varies, and I could not poke it (same `entry_1da6` gating as `0x6207`), so I cannot distinguish "colour" from "colour+attribute". Named for the field, graded down for the lack of variation. | inferred |
| `0x620B` | `MARIO_AIR_PREV_X` | Copy of `0x6203` taken at the head of every airborne frame, before that frame's motion is applied. | **ROM (unambiguous)**: `loc_1bb2` @0x1BB6/0x1BBC `ld ix,0x6200; ld a,(0x6203); ld (ix+0x0b),a` (`state0.js:9006`). **Observation**: during a Right-held jump it lags `0x6203` by exactly one frame; it is untouched while walking (absent from the walk diff). Consumers are not interpreted here. | confirmed |
| `0x620C` | `MARIO_AIR_PREV_Y` | Copy of `0x6205` taken at the head of every airborne frame, before gravity. | Same routine, @0x1BBF/0x1BC2 `ld a,(0x6205); ld (ix+0x0c),a` (`state0.js:9010`). **Observation**: lags `0x6205` by exactly one frame through a whole jump; untouched while walking. Read at ROM 0x29D6, 0x29EE, 0x2BE1 (collision) — those uses not interpreted. | confirmed |
| `0x620E` | `MARIO_AIR_START_Y` | Y at the moment Mario left the ground. The fall-height test compares current Y − 0x0F against it; exceeding it is what makes a fall fatal. | **ROM**: written at jump init `loc_1b8a` @0x1BA9 `ld a,(0x6205); ld (0x620e),a` (`state0.js:8989`) and at fall init `sub_1f46` @0x1F6E (`state0.js:11695`); read by `entry_1c76` @0x1C79 `ld a,(0x6205); ld hl,0x620e; sub 0x0f; cp (hl); jp c → skip; else 0x6220 := 1` (`state0.js:9243`). **Observation**: set to 240 at f1601 of a jump from Y=240 and held for the whole arc. | confirmed |
| `0x620F` | `MARIO_MOVE_STEP_TIMER` | Sub-step timer for ground movement. While non-zero the movement code moves Mario **1 px this frame** and decrements it; at zero it instead advances the animation and reloads (2 for a walk step, 3/4 for a climb step). This is what makes walking 2 px per 3 frames. | **Control (quantitative)**: poked to 20 while walking Right → Mario moved 1 px **every** frame for exactly 20 frames (X 69→89) with `0x6202` frozen, then resumed the normal 2-per-3 cadence. **ROM**: `loc_1c8f`/`loc_1cab` @0x1C94/0x1CB0 `ld a,(0x620f); and a; jp nz → loc_1cd2` (apply the pixel), `loc_1cc2` @0x1CCC `ld a,0x02; ld (0x620f),a`, `loc_1ceb` @0x1CEE `dec (hl)`, `entry_1d03` @0x1D0C `ld a,0x04` (`state0.js:9271,9340,9384,9629`). ⚠️ The inline comment `// jump phase` at `state0.js:9271` is misleading — this counts *ground* walk/climb sub-steps; a jump does not use it. | confirmed |
| `0x6210` `0x6211` | `MARIO_AIR_VX_HI` `MARIO_AIR_VX_LO` | Signed 16-bit horizontal velocity while airborne, **big-endian** (hi at 0x6210), units 1/256 px per frame. Jump init loads +0x0080 (Right held), 0xFF80 (Left), or 0x0000. | **Control**: poked `0x6211=0x80` during a vertical jump → X immediately began advancing 0.5 px/frame (63→69 over 10 frames) where the un-poked run stayed at 63. **Observation**: a Right-jump shows 0x00/0x80 and +0.5 px/frame; a Left-jump shows 0xFF/0x80 and −0.5. **ROM**: `loc_1b6e` @0x1B7C `ld bc,0x0080` / @0x1B83 `ld bc,0xff80`, stored by `loc_1b8a` @0x1B8C/0x1B8E `ld (hl),b; inc l; ld (hl),c` with HL=0x6210 (`state0.js:8937,8943,8959`). | confirmed |
| `0x6212` `0x6213` | `MARIO_AIR_VY_HI` `MARIO_AIR_VY_LO` | Signed 16-bit **initial upward velocity** of the current jump or fall, big-endian, units 1/256 px per frame. Constant for the whole arc — gravity is applied by deriving the displacement from this value and the frame counter `0x6214`, not by decrementing it. Jump init sets 0x0148 (=328); a ledge/slope fall sets 0. | **Control (exact, twice)**: the per-frame `Y16` delta obeys `−(V + 8 − 16n)` with `V = 0x6212:0x6213`, `n = 0x6214`. Poking `0x6213 = 0x80` (V 328→384) shifted every subsequent delta by exactly +56; poking `0x6212 = 2` (V 328→584) shifted it by exactly +256; a poked ledge-fall has V=0 and the same formula still holds. **0 mismatches** across all four runs. **ROM**: `loc_1b8a` @0x1B91/0x1B94 `ld (hl),0x01; inc l; ld (hl),0x48`; zeroed by `sub_1f46` @0x1F5B/0x1F5E (`state0.js:8967,8971,11688`). The integrator itself (`sub_239c` @0x239C, `sub_2407`) is not interpreted here. | confirmed |
| `0x6214` | `MARIO_AIR_FRAMES` | Frames elapsed since Mario became airborne. Drives the ballistic term above, and at exactly 0x14 the airborne handler arms the landing check. | **Control**: poked to 0x13 at airborne-frame 4 → `0x621F` flipped to 1 on the very next frame (vs. frame 20 in the un-poked jump) and the jump ended early. **ROM**: `entry_1c05` @0x1C16 `ld a,(0x6214); sub 0x14; jp nz → loc_1c33; else ld a,1; ld (0x621f),a` (`state0.js:9096`); zeroed at jump init @0x1B96 and by `sub_1f46` @0x1F61. **Observation**: counts 0…42 across a jump and freezes on landing. | confirmed |
| `0x6215` | `MARIO_ON_LADDER` | Mario is on a ladder / mid-climb. 1 enables the Up/Down climb inputs; the climb stepper sets it on each step and clears it on reaching a ladder end. | **Control**: poked to 1 (held) with Up held on flat ground → Mario climbed **in mid-air**, Y 240→222, with the ladder-centring X snap (63→59) that only the climb path performs. **ROM**: `entry_1ac3` @0x1ADB dispatches on it; `loc_1b38` @0x1B43 gates the Up branch on it; set by `loc_1d49` @0x1D4B `ld a,1; ld (0x6215),a`, cleared by `loc_1d67` @0x1D73 (`state0.js:8714,8860,10716,10765`). **Observation**: 0 while walking; 1 from the first climb frame; back to 0 the frame Y reaches the ladder top (Y=211 on the X=203 ladder) as `0x6207` is set to 6. | confirmed |
| `0x6216` | `MARIO_AIRBORNE` | Primary movement state: 0 = on the ground, 1 = airborne (jumping or falling). The head of the movement state machine branches on it first. | **Control**: poked to 1 while standing → the airborne handler took over immediately (Y-fraction began accumulating under gravity, `0x6214` started counting, and Mario "landed" with the 0x8F crouch sprite and the freeze lock). **ROM**: `entry_1ac3` @0x1AC6 `ld a,(0x6216); dec a; jp z → loc_1bb2` — its first test (`state0.js:8693`); set by `loc_1b6e` @0x1B73 (jump init) and `sub_1f46` @0x1F68 (fall init); cleared by `entry_1c4f` @0x1C52 on landing. **Observation**: exactly 1 for the duration of every jump. | confirmed |
| `0x6217` | `MARIO_HAMMER_ACTIVE` | A hammer is in Mario's hands. While 1 he cannot jump, the hammer sprite replaces his, and the hammer BGM plays. | **Control (full lifecycle from one byte)**: poked to 1 for a single frame → the next frame `0x6089` = 4 (hammer BGM), `0x694D` = 0x88 (hammer sprite), and the hammer duration counter `0x6394` started from 0; the game then ran the hammer to completion on its own. **ROM**: `entry_1ac3` @0x1AD4 `ld a,(0x6217); dec a; jp z → loc_1ae6`, which **skips the jump-button test at 0x1AE2** — the ROM's own encoding of "you cannot jump with a hammer" (`state0.js:8707`); `entry_2ed4` @0x2EF8 branches the sprite build on its bit 0 and sets `0x6089=0x04` (`state0.js:14935`); cleared by `loc_2f43` @0x2F61. Corroborated by `games/dkong/audio/sounds.js:528` and `games/dkong/tapes/README.md:20`, which already call it the hammer latch. **Observation**: the tape-mirrored grab holds it at 1 from frame 1609 to 2119 — 511 frames — matching `audio/README.md`'s independently recorded MAME trace. | confirmed |
| `0x6218` | `MARIO_HAMMER_PENDING` | A hammer was touched but not yet in hand: latched during the airborne frames, transferred into `0x6217` when the post-landing freeze expires. Cleared when the hammer goes active. | **Control**: poked to 1 mid-jump → it persisted through the arc, and at the exact frame `0x621E` hit 0 it moved into `0x6217` and the hammer went live (BGM + sprite). **ROM**: `loc_1b55` @0x1B5D `ld a,(0x6218); ld (0x6217),a` on lock expiry (`state0.js:8906`); written by `entry_2954` @0x295A from the object-hit search (`state0.js:13249`); zeroed by `entry_2ed4` @0x2F00. **Observation**: in the real hammer grab it went 0→1 at f1580 (mid-jump, at the hammer) and 1→0 at f1609 as `0x6217` went 0→1. | confirmed |
| `0x621B` | `MARIO_CLIMB_LIMIT_TOP` | Upper end of the ladder Mario is on, expressed as **Y + 8** (so the smaller number). The climb stepper stops and clears `MARIO_ON_LADDER` when `Y+8` reaches it. | **ROM**: `loc_1d11` @0x1D2D–0x1D2E `dec l; sub (hl); jp z → loc_1d67` with HL walking down from 0x621C (`state0.js:10670`); written by `loc_1afe`/`entry_1b4e` from `sub_236e`'s ladder search. **Observation**: 219 on the X=203 ladder, whose top Mario reached at Y=211 (211+8=219) exactly as `0x6215` cleared; 213 on the X=99 ladder. ⚠️ Graded down deliberately: the two write paths (@0x1B36/0x1B38 and @0x1B50/0x1B52) store the pair `(D,B)` in **opposite order**, so I cannot rule out a case where top and bottom swap. Two ladders is not enough to settle that. | inferred |
| `0x621C` | `MARIO_CLIMB_LIMIT_BOTTOM` | Lower end of the same ladder, also as **Y + 8** (the larger number). | Same routine, @0x1D28–0x1D29 `ld hl,0x621c; cp (hl); jp z → loc_1d67` (`state0.js:10664`); also read by `loc_1d76` @0x1D83. **Observation**: 243 where the climb began at Y=235 (243), and 248 where it began at Y=240 (248) — both exact, on two different ladders. Same swap caveat as `0x621B`. | inferred |
| `0x621E` | `MARIO_FREEZE_TIMER` | Post-landing freeze. While non-zero Mario is unresponsive and the movement state machine does nothing but decrement it; on expiry it applies `MARIO_HAMMER_PENDING`, strips the sprite's low nibble and clears `MARIO_WALK_ANIM`. Landing loads 4. | **Control (quantitative)**: poked to 40 while walking Right → Mario froze in place for exactly 40 frames (X pinned at 69, animation pinned), then resumed; and on the expiry frame `0x6202` went to 0 and `0x6207` 0x81→0x80, exactly the ROM's cleanup. **ROM**: `entry_1ac3` @0x1ACD `ld a,(0x621e); and a; jp nz → loc_1b55`; `loc_1b55` @0x1B59 `dec (hl); ret nz`; `entry_1c4f` @0x1C65 `ld a,0x04; ld (0x621e),a` (`state0.js:8700,8902,9196`). | confirmed |
| `0x621F` | `MARIO_AIR_LANDCHECK` | Airborne sub-phase. While 1 the airborne handler runs the fall-height test against `MARIO_AIR_START_Y` every frame. Set at airborne frame 0x14 of a jump (roughly the apex), or **immediately** for a ledge/slope fall — which is why "descending" would be the wrong name for it. Cleared on landing. | **ROM (unambiguous)**: `entry_1c05` @0x1C0F `ld a,(0x621f); dec a; jp z → entry_1c76` (the fall-height test); set @0x1C1D when `0x6214 == 0x14`; set @0x1F68 by `sub_1f46` at fall init; cleared @0x1C69 on landing (`state0.js:9090,9104,11694,9200`). **Control (indirect)**: poking `0x6214=0x13` made it flip on the next frame and visibly shortened the jump. **Observation**: 0 for jump frames 1–19, 1 for 20–41, 0 after landing; 1 from the first frame of a poked ledge fall. | confirmed |
| `0x6220` | `MARIO_FATAL_FALL` | "This fall will kill him." Set when the fall-height test finds Mario more than 0x0F px below where he left the ground; consumed on landing, where `MARIO_ACTIVE = (0x6220) xor 1`. | **Control**: poked to 1 mid-jump → the landing frame set `0x6200 = 0` (dead), where the byte-identical un-poked jump kept `0x6200 = 1`. **ROM**: set by `entry_1c76` @0x1C87 alongside the fall sound `0x6084=3` (`state0.js:9255`); read by `entry_1c4f` @0x1C55 `ld a,(0x6220); xor 0x01; ld (0x6200),a` (`state0.js:9178`) and by `loc_1bd8` @0x1BDB. | confirmed |
| `0x6221` | `MARIO_START_FALL` | One-shot trigger: "the ground went away — start falling". Set by the slope/ledge contact check; the player-state reset consumes and clears it, putting Mario airborne with zero initial velocity. | **Control**: poked to 1 for one frame → the **next** frame had `0x6216=1`, `0x621F=1`, `0x620E=240` (Y snapshot) and `0x6221` back to 0, and Mario fell with V=0 exactly as the ballistic formula predicts. **ROM**: `entry_2acd` @0x2ACF `ld a,1; ld (0x6221),a` — the routine's whole body (`state0.js:12118`); `sub_1f46` @0x1F49 `ld a,(0x6221); and a; ret z`, then clears it @0x1F52 and sets state 1 (`state0.js:11674`). Its docstring calls the trigger "slope-contact". | confirmed |
| `0x6224` | `MARIO_CLIMB_SOUND_TOGGLE` | Alternates 0/1 on every second climb half-step; the footstep sound fires only on the 0 phase. | **ROM**: its only two sites in the entire ROM are inside `loc_1d51` — @0x1D5C `ld a,(0x6224)`, `xor 0x01`, @0x1D5E `ld (0x6224),a`, then `call z,0x1d8f` (the sound trigger, which writes `0x6080=3`) (`state0.js:10737`). **Observation**: toggles every two climb steps through a 30-step climb, in step with `0x6080` activity. Not poke-tested and it never does anything but toggle, so I cannot show it *causes* the sound rather than merely gating it. | inferred |
| `0x6228` | `PLAYER_LIVES` | Lives remaining for the current player. | **Control**: poked to 5 → after the next death it read 4 and the on-screen life indicator drew **4** markers where the un-poked run drew 2 — the marker count tracks the byte one-for-one across two sample points. **ROM**: `entry_06b8` @0x06C7 `ld a,(0x6228); sub c` then writes that many 0xFF markers into the tilemap; its docstring: *"Redraws the lives indicator… then fills 0xFF markers for the current life count"* (`mainloop.js:418,499`). `sub_0350` @0x037B `ld hl,0x6228; inc (hl)` on crossing the bonus-life threshold at `0x6021` (`mainloop.js:324,395`). **Observation**: 3→2→1→0 across the idle run's three deaths. | confirmed |
| `0x622D` | `EXTRA_LIFE_AWARDED` | Sticky flag: the score-threshold bonus life has already been given, so it is not given twice. | **ROM**: `sub_0350` @0x0353 `ld a,(0x622d); and a; ret nz` (early-out) and @0x0375 `ld a,1; ld (0x622d),a` immediately before `inc (0x6228)` — its only two sites (`mainloop.js:324`). The routine docstring says *"sets the 'awarded' flag at 0x622D, bumps the life count at 0x6228"*. Never observed set in my runs (no run scored high enough), and not poke-tested. | inferred |

---

## Adjacent to the player block

| address | proposed name | what it means | evidence | confidence |
|---|---|---|---|---|
| `0x6010` | `P1_INPUT` | The **cooked** control word the movement code reads: bit 0 Right, bit 1 Left, bit 2 Up, bit 3 Down held; **bit 7 = the jump button's press edge**, set for exactly one frame per press. | **ROM (unambiguous)**: `readControls` (ROM 0x0087–0x00B4) builds `L` = direction nibble OR (new-this-frame jump bit rotated up three places) and stores it with one `ld (0x6010),hl` @0x00AC — so `0x6010` is `L` (`nmi.js:266-323`). `entry_1ac3` consumes it exactly that way: `ld a,(0x6010); rla; jp c → jump init` (bit 7) and `bit 0/1/2/3` for directions (`state0.js:8721,8742,8758,8856,8874`). **Observation**: holding each direction gives 0x01/0x02/0x04/0x08 continuously; holding jump gives **0x80 for one frame only**, then 0. | confirmed |
| `0x6011` | `P1_INPUT_RAW` | The raw port byte for this frame (bit 4 = jump). Kept so the next frame's edge detector can tell "newly pressed" from "still held". | Same routine: `H = B` = the unmodified `IN0`/`IN1` read, stored as the high half of that `ld (0x6010),hl`; the next frame does `ld a,(0x6011); cpl; and b` — the edge detect. Docstring: *"0x6011 holds the previous reading, so `cpl / and b` keeps only bits that are newly set"* (`nmi.js:260,305`). **Observation**: reads 0x10 continuously while jump is held, where `0x6010` pulses once. | confirmed |
| `0x694C`–`0x694F` | `MARIO_SPRITE_RECORD` | Mario's 4-byte hardware sprite record: `+0` = `MARIO_X`, `+1` = `MARIO_SPRITE_CODE`, `+2` = `MARIO_SPRITE_ATTR`, `+3` = `MARIO_Y`. Copied to sprite RAM at `0x704C`. | **ROM**: `entry_1da6` (ROM 0x1DA6) copies `0x6203, 0x6207, 0x6208, 0x6205` into `0x694C…0x694F` in that order — the docstring flags the order as deliberate ("OUT OF ORDER, do not sort") (`state0.js:10586-10611`). **Observation**: at a sampled frame `0x694C..F` = `[203, 4, 2, 221]` and sprite RAM `0x704C..F` = `[203, 4, 2, 223]` — same low address, Y differing only by the two pixels moved between the copy and the DMA. Note the hammer overrides `+1` (0x88/0x89) via `loc_2f43` @0x2F47/0x2F72 rather than through `entry_1da6`. | confirmed |
| `0x6394` `0x6395` | `HAMMER_TIMER_LO` `HAMMER_TIMER_HI` | 16-bit up-counter for how long the current hammer has been active; the hammer ends when the high byte reaches 2, i.e. after **512 frames**. Bit 3 of the low byte also drives the hammer's swing animation (8-frame alternation). | **ROM**: `loc_2f43` @0x2F4C `ld hl,0x6394; inc (hl)`, and on wrap @0x2F53 `ld hl,0x6395; inc (hl); cp 0x02` → clear `0x6395`, clear `0x6217`, restore the BGM from `0x6389` (`state0.js:15002-15050`); the swing test is @0x2F21 `ld a,(0x6394); bit 3,a`. **Observation**: the tape-mirrored hammer ran frames 1609→2119 (511 frames) with `0x6394` ramping and `0x6395` going 0→1; poking `0x6217=1` started `0x6394` from 0 on the next frame. | confirmed |

---

## Rejected

**16 addresses examined and left unnamed.** Each was in scope and each had *something* going for it —
that is exactly why they are recorded rather than silently dropped.

| address | what I saw | why it is not enough |
|---|---|---|
| `0x6201` | Zero in every frame of every run. | Zero absolute-addressing sites in the ROM scan. Nothing to name. |
| `0x6209` `0x620A` | Constant 4 and 8, set at board init (`sub_0f56` @0x0FA8/0x0FAB). Their generic-object siblings `(iy+9)/(iy+0x0a)` are used as a hit-box pair by `loc_281d` @0x2838 for a *different* object. | Tempting to name them Mario's hit-box half-extents — but the routine that does the equivalent job **for the player**, `sub_2808` @0x2813, hard-codes `ld hl,0x0407` instead of reading them. So the player's copies are demonstrably not the ones used, and I found no reader that does use them. |
| `0x620D` `0x621D` `0x6223` `0x6226` | Zero throughout. | No absolute sites; never observed non-zero. |
| `0x6219` | Toggles 0/1 during a climb; set from `0x621A` @0x1D80, cleared @0x1D70. | Two write sites, **zero absolute reads** anywhere in the ROM. I cannot show anything consumes it, so any name would be a guess about a value nothing reads. |
| `0x621A` | **1 on the broken 25m ladder (X≈99, where Mario stalls at Y=228), 0 on the intact ladder (X≈203).** Set/cleared by `loc_1afe` @0x1B28 from `sub_236e`'s residual count, and gates the blocking path in `loc_1d76` @0x1D79. | This reads convincingly as a "broken/blocked ladder" flag and I nearly kept it. But the ROM scan shows it is **also written at 0x2236 and 0x223F** by `loc_2227`, an unrelated board-object state arm — so either the byte is shared between two mechanics or my reading is incomplete. One board is not enough to resolve that, and a shared byte cannot carry a name from one of its users. Flagged for the verifier: this is the most likely of the rejects to be nameable with one more experiment (a 50m/75m climb). |
| `0x6212`/`0x6213` — *(kept, noted here for contrast)* | — | These were on this list until the poke test; correlation alone showed only "constants 1 and 0x48". Control turned them into an exact velocity. |
| `0x6222` | Toggles 0/1 on each climb half-step in `loc_1d11` @0x1D1C; the 1 phase snaps X to the ladder centre. | **Also written at 0x2295** by `loc_2259`, a different state machine that separately moves the player's Y. Same objection as `0x621A`. |
| `0x6225` | Set to 1 at @0x1AB5 next to `0x6340`/`0x6342` (`state0.js:8639`, commented "collection flags"); read on landing @0x1C6F into `sub_1d95`. | Prize/score domain, not player motion — out of my half, and ambiguous besides. Left for whoever drafts the item/score block. |
| `0x622C` | 1 during the first life, 0 from the first death onward. Written by `loc_12f2` @0x12F6 and `loc_1344` @0x1348, the play-start handlers. | The observation fits half a dozen readings ("first life", "intro pending", "player 1 in play"). I found no read site that discriminates them, and no poke I ran moved anything downstream. |
| `0x6081` `0x6084` `0x6085` `0x6089` | Move at jump start (3), fatal-fall detect (3), hammer/prize events, and hammer BGM (4). | These are sound latches. `games/dkong/audio/` already documents this block from MAME traces; naming them from my runs would duplicate — and risk contradicting — better evidence. Deferred, not rejected on merit. |

Also seen moving in the player diffs and deliberately **not** pursued, as belonging to other halves:
`0x6390`–`0x6395` (BGM/state), `0x63B9`, `0x6384`, `0x62A8`–`0x62B1` (barrels + bonus timer), `0x6400`+
(object slots), `0x6690`+ / `0x6A1C` (hammer objects), `0x6BE0`–`0x6BFF` (the Z80 stack — `ld sp,0x6c00`
at ROM 0x02B2 puts the stack top at 0x6BFF, which is why that range churns in every diff and means
nothing).

---

## Two corrections to inline comments in `translated/`

Not edits — `translated/` is the oracle and is not to be touched — but the verifier should know that two
of its inline annotations disagree with the measurements above, and both are the kind of guess that
would propagate into a wrong name:

1. `state0.js:9277` annotates `0x6202` as `// facing`. Right and Left produce the **same** value set
   `{0,1,2,4}` in opposite orders, so it does not encode direction. Facing is `0x6207` bit 7 only.
2. `state0.js:9271` annotates `0x620F` as `// jump phase`. It is the ground walk/climb sub-step timer;
   poking it changes walking speed and it is untouched by a jump.

## Open questions for the verifier

* `0x621B`/`0x621C` — confirm the top/bottom assignment on a board other than 25m, and specifically
  through the `entry_1b4e` write path (@0x1B50/0x1B52), which stores the pair in the opposite order to
  the path my runs exercised.
* `0x621A` — one 50m or 75m climb would probably settle whether it is a broken-ladder flag or a byte
  shared with `loc_2227`.
* `0x6208` — a run in which Mario's sprite colour actually changes (if one exists) would upgrade it.
* The exact `+8` offset in the ballistic identity `ΔY16 = −(V + 8 − 16n)` comes from `sub_239c`, which I
  did not read. The identity is measured, not derived.
