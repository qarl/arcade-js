# RAM verification — the player (Mario) — adversarial re-derivation

**Verifier's independent re-derivation of `ram-findings-player.md`.** Every named address was treated
as WRONG until my own experiment proved it. I re-ran the drafter's controls from scratch (I did not
trust their captures), reproduced the ballistic law from my own jump dumps, opened every cited
`translated/*.js` site and confirmed the mnemonics, and took the requested cheap shot at `0x621A`.

Method: `games/dkong/tools/emit.js --state-out` (5120 B/frame: work `0x6000–0x6BFF` = bytes 0–3071),
coin `0x7d00=0x80@400`, start `0x7d00=0x04@460`. Gameplay begins frame 1462; Mario spawns X=0x3F,
Y=0xF0 on 25m (I reproduced this). Scratch kept outside the repo and deleted.

## Headline

- **28 named addresses examined; 28 UPHELD, 0 REFUTED, 0 DOWNGRADED.** The draft is strong.
- **23 confirmed-grade** reproduced by control or unambiguous ROM; **5 inferred-grade** kept as inferred.
- **One evidence correction (not a name change):** `0x6218`'s poke-persistence is *not* robust — it has a
  conditional upstream writer (`entry_2954`) that wiped my isolated poke. The name still holds on the
  unambiguous ROM transfer + the natural hammer lifecycle; its confidence rests there, not on the poke.
- **Both `translated/` comment corrections CONFIRMED** by my own measurements (0x6202 not "facing";
  0x620F not "jump phase").
- **The `0x621B`/`0x621C` top/bottom swap is CONFIRMED in source** — the two writer paths store the pair
  in opposite order. Inferred grade is correct; the doc comment must not over-commit to top vs bottom.
- **`0x621A` rejection UPHELD.** The second writer (`loc_2227`, ROM 0x2236/0x223F) is a *hardcoded
  absolute* `ld (0x621a),a` in an object state-machine — a real shared byte, not a scan artifact. My
  cheap 50m/75m shot could not settle it. Stays hex.
- The 16 rejected addresses are correctly rejected; I spot-checked the load-bearing ones.

Headline UPHELD (my strongest reproductions): the **ballistic law `ΔY16 = −(V+8−16n)`** held with **0
mismatches over 142 airborne frames across 4 velocity regimes** (V=328 plain, 384 and 584 by poking
`0x6212`/`0x6213`, and 0 for a ledge fall) — a byte that is not the low half of Y and a pair that is not
the 16-bit big-endian initial velocity cannot both satisfy that identity. The analogous **X integrator
`ΔX16 = velocity`** held 0/39.

---

## Player block `0x6200–0x6228` — verdict table

| addr | drafter name | verdict | the experiment I ran | final {name, confidence} |
|---|---|---|---|---|
| `0x6200` | MARIO_ACTIVE | **UPHELD** | Poked `0x6200=0`@1490 → Mario froze at (63,240), death→respawn cycle ran, `0x6200` restored to 1 at respawn f2016, lives 3→2. ROM `entry_1c4f` @0x1C57 `(0x6200)=(0x6220)⊕1` (state0.js:9178) read + confirmed. | MARIO_ACTIVE · **confirmed** |
| `0x6202` | MARIO_WALK_ANIM | **UPHELD** | Walk Right vs Left both give value set **{0,1,2,4}** (Right cycles 0→2→4→1, Left 0→1→4→2), `(0x6207&3)==(0x6202&3)` on all 79 walk frames, 0 exceptions. Only 3 writers (state0.js:8920,9286,9317 = two walk routines + freeze-clear). | MARIO_WALK_ANIM · **confirmed** |
| `0x6203` | MARIO_X | **UPHELD** | Poked `0x6203=0xA0`@1600 → held 160 through 1601–1639 (poke released), then Left walked it 160→...→147 (2px/3frames), Y tracking slope. ROM `loc_1cd2` @0x1CD5 `add a,b; ld (hl),a` RMW (state0.js:9351). | MARIO_X · **confirmed** |
| `0x6204` | MARIO_X_FRAC | **UPHELD** | In a Right-held jump `Δ(0x6203·256+0x6204)` == signed `0x6210:0x6211` for **39/39** airborne frames; `0x6204` alternates 0/128. Cleared at jump init `loc_1b8a` @0x1B99 (state0.js:8977). | MARIO_X_FRAC · **confirmed** |
| `0x6205` | MARIO_Y | **UPHELD** | Same calibration poke (persists, later motion relative); walking follows girder slope 240→241. ROM `loc_1d11` @0x1D14 `add a,(hl); ld (hl),a` RMW (state0.js:10644). | MARIO_Y · **confirmed** |
| `0x6206` | MARIO_Y_FRAC | **UPHELD** | Ballistic identity `ΔY16=−(V+8−16n)` with `Y16=0x6205·256+0x6206` — **0 mismatches / 142 frames** over 4 V regimes. Cleared at jump init @0x1B9C (state0.js:8979). | MARIO_Y_FRAC · **confirmed** |
| `0x6207` | MARIO_SPRITE_CODE | **UPHELD** | Observed bit7=1 walking Right, 0 walking Left; codes 0x8E air/0x8F land/03–06 climb; sprite record `0x694D`==`0x6207` exactly. Every ROM writer does `and 0x80` then ORs a code (0x1BA1/0x1C62/0x1B1F/loc_1d3f). Not control-testable (copy gated by `entry_1da6`). | MARIO_SPRITE_CODE · **confirmed** |
| `0x6208` | MARIO_SPRITE_ATTR | **UPHELD (inferred)** | `entry_1da6` @0x1DB2 copies it to sprite-record byte +2 (`0x694E`); `video.js` decodes +2 as colour/bank/flip. Constant 2 in every frame; can't poke (same gating). Field is fixed, meaning isn't. | MARIO_SPRITE_ATTR · **inferred** |
| `0x620B` | MARIO_AIR_PREV_X | **UPHELD** | Lags `0x6203` by exactly one frame through a jump (all frames 1490–1504), untouched walking. ROM `loc_1bb2` @0x1BBC `ld (ix+0x0b),a` from `0x6203` (state0.js:9008). | MARIO_AIR_PREV_X · **confirmed** |
| `0x620C` | MARIO_AIR_PREV_Y | **UPHELD** | Lags `0x6205` by one frame; untouched walking. ROM `loc_1bb2` @0x1BC2 `ld (ix+0x0c),a` from `0x6205` (state0.js:9012). | MARIO_AIR_PREV_Y · **confirmed** |
| `0x620E` | MARIO_AIR_START_Y | **UPHELD** | Set to 240 on take-off, held whole arc. ROM `entry_1c76` @0x1C7F `ld a,(0x6205); sub 0x0F; cp (0x620E)` = the fatal-fall test (state0.js:9243–9250); set at jump/fall init. | MARIO_AIR_START_Y · **confirmed** |
| `0x620F` | MARIO_MOVE_STEP_TIMER | **UPHELD** | Poked to 20 while walking Right → exactly 20 frames of 1px/frame (70→90) with `0x6202` frozen, then 2px/3frames resumes. **Constant through a whole jump (untouched)**. ROM `loc_1c8f/loc_1cab` read it, reload 2/3/4. | MARIO_MOVE_STEP_TIMER · **confirmed** |
| `0x6210`/`0x6211` | MARIO_AIR_VX_HI/LO | **UPHELD** | Poked `0x6211=0x80` in a vertical jump → X advances 0.5px/frame (63→70) vs base pinned 63; `ΔX16`==velocity 39/39. ROM `loc_1b8a` @0x1B8C `ld (hl),b; inc l; ld (hl),c` HL=0x6210, B/C from 0x0080/0xFF80 (state0.js:8959). Big-endian confirmed (hi at 0x6210). | MARIO_AIR_VX_HI/LO · **confirmed** |
| `0x6212`/`0x6213` | MARIO_AIR_VY_HI/LO | **UPHELD (strong)** | Re-derived the arc law from my own dumps: `ΔY16=−(V+8−16n)`, V=`0x6212·256+0x6213`. **0 mismatches / 142 frames**; poking `0x6213=0x80` (V→384) and `0x6212=2` (V→584) both preserved the identity, ledge-fall V=0 too. ROM `loc_1b8a` @0x1B91/94 `ld (hl),0x01 / ld (hl),0x48`. Big-endian confirmed. | MARIO_AIR_VY_HI/LO · **confirmed** |
| `0x6214` | MARIO_AIR_FRAMES | **UPHELD** | Counts 0…42 across a jump. Poked to 0x13 at air-frame 4 → `0x621F` flipped to 1 the next frame (vs f20 unpoked). ROM `entry_1c05` @0x1C16 `sub 0x14; ...→(0x621F)=1` (state0.js:9096). | MARIO_AIR_FRAMES · **confirmed** |
| `0x6215` | MARIO_ON_LADDER | **UPHELD** | Poked 1 (held) + Up on flat ground → Mario climbed mid-air Y 240→234 with the ladder-centre X snap 63→59 and climb sprite 3. ROM: dispatched at 0x1ADB, Up-branch gated at 0x1B43; set `loc_1d49` @0x1D4B, cleared `loc_1d67` @0x1D73. | MARIO_ON_LADDER · **confirmed** |
| `0x6216` | MARIO_AIRBORNE | **UPHELD** | Poked 1 while standing → airborne handler took over: `0x6214` counted, Y-frac accumulated on the V=0 fall law, landing sprite 0x8F. ROM `entry_1ac3` @0x1AC6 first test `dec a; jp z` (state0.js:8693). | MARIO_AIRBORNE · **confirmed** |
| `0x6217` | MARIO_HAMMER_ACTIVE | **UPHELD** | Poked 1 → next frame `0x6089=4` (BGM), `0x694D=0x88` (hammer sprite), `0x6394` timer started. Natural grab (tape mirror) held it **511 frames** (f1609→2120). ROM `entry_1ac3` @0x1AD4 skips the jump test; `entry_2ed4` @0x2F03 sets `0x6089=4`. | MARIO_HAMMER_ACTIVE · **confirmed** |
| `0x6218` | MARIO_HAMMER_PENDING | **UPHELD** ⚠ | Natural grab: `0x6218` 0→1 at f1580 (mid-jump at hammer), 1→0 at f1609 as `0x6217` went live. ROM transfer `loc_1b55` @0x1B5D `ld a,(0x6218); ld (0x6217),a` (state0.js:8906). **BUT the drafter's isolated-poke-persistence did NOT reproduce** — `entry_2954` @0x295A writes `0x6218=A` whenever it runs and wiped my poke. Name holds on ROM+lifecycle, not on poke. | MARIO_HAMMER_PENDING · **confirmed** (note evidence basis) |
| `0x621B` | MARIO_CLIMB_LIMIT_TOP | **UPHELD (inferred)** | Climb stepper compares `newY+8` to `0x621C` (cp) then `0x621B` (dec l; sub); either match ends the climb (`loc_1d11` @0x1D28/0x1D2E, state0.js:10664–10674). 25m: 0x621B held the smaller value. **Swap CONFIRMED**: `loc_1afe` found-path stores (D,B) @0x1B36/38, `entry_1b4e` stores (B,D) @0x1B50/52 — opposite order into 0x621B/0x621C. | climb-limit (Y+8 form) · **inferred**, don't fix top/bottom |
| `0x621C` | MARIO_CLIMB_LIMIT_BOTTOM | **UPHELD (inferred)** | Same routine; 25m: 0x621C held the larger value. Same confirmed swap caveat. | climb-limit (Y+8 form) · **inferred**, don't fix top/bottom |
| `0x621E` | MARIO_FREEZE_TIMER | **UPHELD** | Poked to 40 while walking → X pinned 40 frames (70), then on expiry `0x6202→0` and `0x6207` 0x81→0x80 (low nibble stripped). ROM `loc_1b55` @0x1B59 `dec (hl); ret nz`; landing loads 4 @0x1C65. | MARIO_FREEZE_TIMER · **confirmed** |
| `0x621F` | MARIO_AIR_LANDCHECK | **UPHELD** | Observed 0 for jump frames 1–19, 1 from 20 (apex); **1 from frame 1 of a ledge fall** — so not "descending". ROM `entry_1c05` @0x1C0F `dec a; jp z→entry_1c76`; set @0x1C1D and @0x1F68. Control via the `0x6214=0x13` poke. | MARIO_AIR_LANDCHECK · **confirmed** |
| `0x6220` | MARIO_FATAL_FALL | **UPHELD** | Poked 1 held through landing → landing set `0x6200=0` (dead) where the base jump kept 1. ROM set `entry_1c76` @0x1C87; read `entry_1c4f` @0x1C55 `xor 0x01; ld (0x6200),a` (state0.js:9178). | MARIO_FATAL_FALL · **confirmed** |
| `0x6221` | MARIO_START_FALL | **UPHELD** | Poked 1 for one frame → next frame `0x6216=1, 0x621F=1, 0x620E=240, 0x6212:13=0`, and `0x6221` back to 0; the V=0 fall law then held. ROM `entry_2acd` @0x2ACF `ld a,1; ld (0x6221),a`; `sub_1f46` @0x1F49 consumes+clears (state0.js:11674). | MARIO_START_FALL · **confirmed** |
| `0x6224` | MARIO_CLIMB_SOUND_TOGGLE | **UPHELD (inferred)** | Toggles across climb half-steps; the footstep sound (`0x6080`) fired only while `0x6224==0`. ROM: its only sites are in `loc_1d51` @0x1D5C `xor 0x01` then `call z,0x1d8f` (state0.js:10737). Gates but nothing else reads it. | MARIO_CLIMB_SOUND_TOGGLE · **inferred** |
| `0x6228` | PLAYER_LIVES | **UPHELD** | Poked 5, killed Mario → read **4** at respawn; natural runs 3→2 across a death. ROM `entry_06b8` @0x06C7 redraws markers from it; `sub_0350` @0x037B `inc (hl)` on the bonus threshold (mainloop.js:395,499). | PLAYER_LIVES · **confirmed** |
| `0x622D` | EXTRA_LIFE_AWARDED | **UPHELD (inferred)** | ROM `sub_0350` @0x0350 `ld a,(0x622d); and a; ret nz` (early-out) and @0x0375 `ld a,1; ld (0x622d),a` immediately before `inc (0x6228)` (mainloop.js:337,393) — its only two sites. Never observed set (score never crossed the threshold), not pokeable to a visible effect. | EXTRA_LIFE_AWARDED · **inferred** |

## Adjacent to the player block

| addr | drafter name | verdict | the experiment I ran | final {name, confidence} |
|---|---|---|---|---|
| `0x6010` | P1_INPUT | **UPHELD** | Up held → `0x6010=0x04` continuously; jump held → `0x80` for **exactly one frame** then 0. ROM `readControls` @0x00AC `ld (0x6010),hl`; `entry_1ac3` reads bit7 (rla) for jump, bits 0–3 for dirs. | P1_INPUT · **confirmed** |
| `0x6011` | P1_INPUT_RAW | **UPHELD** | Jump held → `0x6011=0x10` steady (raw IN0 bit4) while `0x6010` pulsed once. Stored as the high half of the same `ld (0x6010),hl`; next frame's `cpl/and b` edge-detects. | P1_INPUT_RAW · **confirmed** |
| `0x694C–0x694F` | MARIO_SPRITE_RECORD | **UPHELD** | Sampled f1500: `0x694C–F=[76,129,2,240]` == `[0x6203,0x6207,0x6208,0x6205]` byte-exact. ROM `entry_1da6` @0x1DA6 copies that tuple in that order; hammer overrides +1 via `loc_2f43`. | MARIO_SPRITE_RECORD · **confirmed** |
| `0x6394`/`0x6395` | HAMMER_TIMER_LO/HI | **UPHELD** | Natural grab ramped `0x6394` to 255 / `0x6395` 0→1 over 511 active frames, hammer cleared as it wrapped past 512; poking `0x6217=1` started it from 0. ROM `loc_2f43` @0x2F4C `inc (hl)`, @0x2F53 `inc (0x6395); cp 0x02→clear 0x6217`. | HAMMER_TIMER_LO/HI · **confirmed** |

---

## The two `translated/` comment corrections — both CONFIRMED

1. **`state0.js:9277` annotates `0x6202` as `// facing` — WRONG.** Right and Left both produce the value
   set `{0,1,2,4}` (opposite cycle orders), so `0x6202` does not encode direction. Facing is `0x6207`
   bit 7 alone (Right→1, Left→0, observed). `(0x6207&3)==(0x6202&3)` on every walk frame.
2. **`state0.js:9271` annotates `0x620F` as `// jump phase` — WRONG.** Poking it changes ground walking
   speed (20→20 frames of 1px/frame); it is **constant and untouched through an entire jump**. It is the
   ground walk/climb sub-step timer.

Both are the kind of guess that would have propagated into a wrong `ram.js` name; note them but do not
edit `translated/`.

## `0x621A` — rejection UPHELD

The drafter rejected it and I agree. I confirmed in source that `loc_2227` (an object state-machine arm,
`sub_2207` body) writes `0x621A` with a **hardcoded absolute** store — `ld (0x621a),a` = 1 @0x2236 and
= 0 @0x223F (state0.js:18104,18116) — unrelated to Mario's ladder collision path (`loc_1afe` @0x1B28).
This is a genuine shared byte, not a disassembly-scan false positive. My cheap shot (idle 50m and 75m,
board pre-set poked) left `0x621A` at 0 throughout — I could neither force `loc_2227` to stomp a live
value nor exercise a broken-ladder set on those boards (that needs real ladder-X search, not cheap). So
it stays **ambiguous → hex**. A future settling experiment: a genuine broken-ladder climb on 50m/75m
while logging whether `loc_2227` fires in the same window.

## Other rejections — spot-checked, all correctly rejected

- `0x6209/0x620A` (hit-box half-extents?): confirmed the player's hit-box routine `sub_2808` @0x2813
  hard-codes `ld hl,0x0407` (state0.js:13431) instead of reading them — so the player's copies are
  demonstrably unused. Correct reject.
- `0x6219`, `0x6222` — toggles with a second unrelated writer / zero real reads (same class as 0x621A).
  Correct rejects.
- `0x6201`, `0x620D`, `0x621D`, `0x6223`, `0x6226` — zero throughout, no absolute sites. Correct.
- Sound latches `0x6081/84/85/89`, `0x6394/5` region, and stack `0x6BE0–0x6BFF` deferred/excluded
  appropriately.

---

## Ready-to-paste `ram.js` doc comments (UPHELD + inferred only)

Everything below is recommended IN. Everything in the Rejected list stays hex (OUT) — the good outcome.

```js
/** Player-alive flag: 1 = alive and processed, 0 = dead/inert. Set on landing to
 *  (0x6220) XOR 1 by entry_1c4f (ROM 0x1C57). Poking 0 mid-play freezes Mario and
 *  runs the death -> life-decrement -> respawn cycle, which restores it to 1. */
export const MARIO_ACTIVE = 0x6200;

/** Walk-cycle animation index (values {0,1,2,4}); its low 2 bits feed the sprite code
 *  0x6207 every frame. Written ONLY by the two walk routines (loc_1c8f/loc_1cab, ROM
 *  0x1CA4/0x1CC0) and cleared on freeze-expiry (loc_1b55, 0x1B6B). NOT facing: Right and
 *  Left produce the same value set in reversed order. */
export const MARIO_WALK_ANIM = 0x6202;

/** Mario's X position, in screen pixels. The movement code read-modify-writes it
 *  (loc_1cd2, ROM 0x1CD5 `add a,b`); a poked value persists and later walking is relative
 *  to it, and prize collision compares it exactly against each item's stored X. */
export const MARIO_X = 0x6203;

/** Low byte of the 16.8 fixed-point X (0x6203:0x6204, big-endian). Per airborne frame,
 *  delta(X*256 + this) equals the signed velocity 0x6210:0x6211 exactly. Cleared at jump
 *  init (loc_1b8a, ROM 0x1B99). */
export const MARIO_X_FRAC = 0x6204;

/** Mario's Y position, in screen pixels (larger = lower on screen). Read-modify-written by
 *  the climb/slope code (loc_1d11, ROM 0x1D14 `add a,(hl)`); a poked value persists and
 *  motion is relative to it; follows the girder slope while walking. */
export const MARIO_Y = 0x6205;

/** Low byte of the 16.8 fixed-point Y (0x6205:0x6206, big-endian) -- the value the ballistic
 *  integrator updates. Per-frame delta(Y*256 + this) = -(V + 8 - 16n) with V = 0x6212:0x6213
 *  and n = 0x6214 (verified 0 mismatches over 142 airborne frames). Cleared at jump init. */
export const MARIO_Y_FRAC = 0x6206;

/** Mario's sprite tile code in bits 0-6; bit 7 = horizontal flip / facing (1 = facing right).
 *  Copied to sprite-record byte +1 (0x694D) by entry_1da6. Every writer preserves bit 7 and
 *  ORs a state code (0x0E jump / 0x0F land / 0x06 ladder-top / walk-anim&3 walk / 03-05 climb). */
export const MARIO_SPRITE_CODE = 0x6207;

/** Colour/attribute byte of Mario's sprite record (byte +2), copied to 0x694E by entry_1da6
 *  (ROM 0x1DB2); the video model decodes byte +2 as colour|bank|flip. Constant 2 in every
 *  observed frame -- named for the hardware field; LOW confidence (never varied, not pokeable). */
export const MARIO_SPRITE_ATTR = 0x6208;

/** Snapshot of X (0x6203) taken at the head of each airborne frame, before that frame's motion.
 *  Written by loc_1bb2 (ROM 0x1BBC `ld (ix+0x0b),a`); observed to lag 0x6203 by exactly one
 *  frame through a jump, untouched while walking. */
export const MARIO_AIR_PREV_X = 0x620B;

/** Snapshot of Y (0x6205) taken at the head of each airborne frame, before gravity. Written by
 *  loc_1bb2 (ROM 0x1BC2); lags 0x6205 by one frame; read by collision code at 0x29D6/0x29EE/0x2BE1. */
export const MARIO_AIR_PREV_Y = 0x620C;

/** Y at the instant Mario left the ground. The fall-height test computes (curY - 0x0F) cp this
 *  (entry_1c76, ROM 0x1C7F); not-below makes the fall fatal (sets 0x6220). Written at jump init
 *  (0x1BAC) and fall init (0x1F6E). */
export const MARIO_AIR_START_Y = 0x620E;

/** Ground walk/climb sub-step timer. While nonzero the move code shifts Mario 1px and decrements
 *  it (loc_1c8f/loc_1cab, ROM 0x1C94/0x1CB0); at zero it advances the walk animation and reloads
 *  (2 walk / 3-4 climb). Poking 20 gives 20 frames of 1px/frame. NOT "jump phase" -- a jump never
 *  touches it. */
export const MARIO_MOVE_STEP_TIMER = 0x620F;

/** Signed 16-bit horizontal velocity while airborne, big-endian (hi at 0x6210), 1/256 px/frame.
 *  Jump init loads +0x0080 (Right) / 0xFF80 (Left) / 0x0000 (loc_1b8a, ROM 0x1B8C). Each airborne
 *  frame delta(X16) equals this; poking the lo byte to 0x80 moves a vertical jump 0.5px/frame. */
export const MARIO_AIR_VX_HI = 0x6210;
export const MARIO_AIR_VX_LO = 0x6211;

/** Signed 16-bit INITIAL vertical velocity of the current jump/fall, big-endian (hi at 0x6212),
 *  1/256 px/frame; constant across the whole arc. Jump init sets 0x0148, a fall sets 0 (loc_1b8a,
 *  ROM 0x1B91/94). Gravity is derived from it and frame counter 0x6214: ΔY16 = -(V + 8 - 16n),
 *  verified exact including after poking V (0 mismatches / 142 frames). */
export const MARIO_AIR_VY_HI = 0x6212;
export const MARIO_AIR_VY_LO = 0x6213;

/** Frames elapsed since Mario became airborne; drives the ballistic term. At exactly 0x14 the
 *  airborne handler arms the landing/fall check (0x621F := 1; entry_1c05, ROM 0x1C16). Poking to
 *  0x13 makes 0x621F flip one frame later. Zeroed at jump/fall init. */
export const MARIO_AIR_FRAMES = 0x6214;

/** 1 = Mario is on a ladder / mid-climb; enables the Up/Down climb branch (gated at ROM 0x1ADB and
 *  0x1B43). Set per climb step (loc_1d49, 0x1D4B), cleared on reaching a ladder end (loc_1d67,
 *  0x1D73). Poking 1 (held) + Up makes Mario climb in mid-air with the ladder-centring X snap. */
export const MARIO_ON_LADDER = 0x6215;

/** Primary movement state: 0 = grounded, 1 = airborne (jumping or falling). First test in the
 *  movement machine (entry_1ac3, ROM 0x1AC6). Set by jump init (0x1B73) and fall init (0x1F68),
 *  cleared on landing (0x1C52). Poking 1 while standing triggers the airborne handler immediately. */
export const MARIO_AIRBORNE = 0x6216;

/** 1 = a hammer is in Mario's hands. Makes the input handler skip the jump-button test (entry_1ac3,
 *  ROM 0x1AD4 -> 0x1AE6) and entry_2ed4 swap in the hammer sprite + BGM (0x6089 := 4). Poking 1
 *  turns on hammer BGM + sprite (0x694D = 0x88) + the duration counter 0x6394; a real grab holds it
 *  511 frames until 0x6394:0x6395 wraps past 512. */
export const MARIO_HAMMER_ACTIVE = 0x6217;

/** A touched-but-not-yet-held hammer, latched during the airborne frames by the object search
 *  (entry_2954, ROM 0x295A) and transferred into 0x6217 when the post-landing freeze expires
 *  (loc_1b55, ROM 0x1B5D `ld a,(0x6218); ld (0x6217),a`). NB entry_2954 also clears it each time it
 *  runs, so an isolated poke does not always persist -- the transfer, not the poke, is the evidence. */
export const MARIO_HAMMER_PENDING = 0x6218;

/** One of the two ladder-extent limits for the current climb, in (Y+8) units. The climb stepper
 *  stops and clears MARIO_ON_LADDER when (newY+8) equals EITHER 0x621B or 0x621C (loc_1d11, ROM
 *  0x1D28/0x1D2E). On 25m 0x621B was the smaller (top). CAUTION: the two writer paths (loc_1afe vs
 *  entry_1b4e) store the pair in OPPOSITE order, so top/bottom is not settled -- treat as a pair. */
export const MARIO_CLIMB_LIMIT_A = 0x621B;
export const MARIO_CLIMB_LIMIT_B = 0x621C;

/** Post-landing freeze countdown; while nonzero the movement machine only decrements it (loc_1b55,
 *  ROM 0x1B59) and Mario is unresponsive. Landing loads 4 (entry_1c4f, 0x1C65); on expiry it applies
 *  0x6218 -> 0x6217, strips the sprite low nibble and clears MARIO_WALK_ANIM. Poking 40 freezes Mario
 *  for exactly 40 frames. */
export const MARIO_FREEZE_TIMER = 0x621E;

/** Airborne sub-phase: while 1 the handler runs the fall-height test each frame (entry_1c05, ROM
 *  0x1C0F -> entry_1c76). Set at airborne-frame 0x14 of a jump (near apex) OR immediately for a
 *  ledge/slope fall; cleared on landing. Observed 0 for jump frames 1-19, 1 from 20; 1 from frame 1
 *  of a fall (so not "descending"). */
export const MARIO_AIR_LANDCHECK = 0x621F;

/** "This fall will kill him." Set by the fall-height test when Mario is >0x0F px below his take-off
 *  Y (entry_1c76, ROM 0x1C87); consumed on landing as MARIO_ACTIVE = (this) XOR 1 (entry_1c4f,
 *  0x1C55). Poking 1 mid-jump makes the landing kill Mario. */
export const MARIO_FATAL_FALL = 0x6220;

/** One-shot "the ground went away -- start falling" trigger. Set by the slope/ledge contact check
 *  (entry_2acd, ROM 0x2ACF); the player-state reset sub_1f46 (0x1F49) consumes + clears it and puts
 *  Mario airborne with zero initial velocity. Poking 1 for one frame does exactly that next frame. */
export const MARIO_START_FALL = 0x6221;

/** Toggles 0/1 across climb half-steps; the footstep sound (0x6080 := 3 via sub_1d8f) fires only on
 *  the 0 phase. Its only ROM sites are inside loc_1d51 (0x1D5C `xor 0x01` then `call z,0x1d8f`). It
 *  gates the sound but nothing else reads it -- low confidence. */
export const MARIO_CLIMB_SOUND_TOGGLE = 0x6224;

/** Lives remaining for the current player. The on-screen lives indicator is redrawn from it
 *  (entry_06b8, ROM 0x06C7) and the score-threshold bonus increments it (sub_0350, 0x037B). Poking 5
 *  then dying reads 4 and draws 4 markers; observed 3->2->1->0 across deaths. */
export const PLAYER_LIVES = 0x6228;

/** Sticky flag: the score-threshold bonus life has already been granted, so it is not granted twice.
 *  sub_0350 (ROM 0x0350) early-outs on it (`ret nz`) and sets it to 1 (0x0375) immediately before
 *  `inc (0x6228)`. ROM-unambiguous but never observed set (score never crossed the threshold). */
export const EXTRA_LIFE_AWARDED = 0x622D;

/** Cooked control word the movement code reads: bit0 Right, bit1 Left, bit2 Up, bit3 Down (held),
 *  bit7 = jump press-edge (set exactly one frame per press). Built and stored by readControls (ROM
 *  0x00AC `ld (0x6010),hl`) and consumed by entry_1ac3. */
export const P1_INPUT = 0x6010;

/** Raw IN0/IN1 port byte for this frame (bit4 = jump button), kept so the next frame's edge detector
 *  (`cpl / and b`) can tell newly-pressed from still-held. Stored as the high half of readControls'
 *  `ld (0x6010),hl`. Steady 0x10 while jump held. */
export const P1_INPUT_RAW = 0x6011;

/** Mario's 4-byte hardware sprite record: +0 X (0x6203), +1 code (0x6207), +2 attr (0x6208), +3 Y
 *  (0x6205), copied in that deliberate order by entry_1da6 (ROM 0x1DA6) and DMA'd to sprite RAM
 *  0x704C. Observed byte-identical to the source tuple; the hammer overrides +1 via loc_2f43. */
export const MARIO_SPRITE_RECORD = 0x694C;

/** 16-bit up-counter for how long the current hammer has been active (loc_2f43, ROM 0x2F4C `inc (hl)`);
 *  the hammer ends when the high byte reaches 2 (~512 frames), clearing 0x6217 and restoring the BGM.
 *  Bit 3 of the low byte drives the 8-frame swing animation. */
export const HAMMER_TIMER_LO = 0x6394;
export const HAMMER_TIMER_HI = 0x6395;
```
