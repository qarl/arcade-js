// SPDX-License-Identifier: GPL-3.0-only

/**
 * Donkey Kong work-RAM constants for the optimized layer.
 *
 * Maps Donkey Kong work RAM (0x6000-0x6BFF) to meaningful names for the
 * optimized layer. Every constant here was proposed by a drafter and then
 * independently re-derived by a SEPARATE verifier — each holds on either a
 * reproduced control-poke or an unambiguous ROM cite, never on the drafter's
 * word alone.
 *
 * The addresses stay hex in `../translated/` on purpose: that layer is the
 * oracle. This file is a naming convenience for the optimized layer and must
 * never be treated as the source of truth for behaviour.
 *
 * The full evidence trail — the drafters' proposals and the verifiers'
 * adversarial re-derivations — lives in `ram-findings-player.md`,
 * `ram-findings-world.md`, `ram-verify-player.md`, and `ram-verify-world.md`
 * beside this file.
 *
 * TWO BYTES WERE NAMED BY BOTH VERIFIERS (their halves overlapped on the live
 * player-context block) — independent corroboration, not a conflict. Each keeps
 * ONE canonical name; the other verifier's name is preserved in the findings
 * files and noted inline where it aids a code search:
 *   0x6228  LIVES               (player findings also called it PLAYER_LIVES)
 *   0x622D  BONUS_LIFE_AWARDED  (player findings also called it EXTRA_LIFE_AWARDED)
 */

// ── Player & motion ──────────────────────────────────────────────────────────
// Source: ram-verify-player.md (adversarial re-derivation of ram-findings-player.md).

/** Cooked control word the movement code reads: bit0 Right, bit1 Left, bit2 Up, bit3 Down (held),
 *  bit7 = jump press-edge (set exactly one frame per press). Built and stored by readControls (ROM
 *  0x00AC `ld (0x6010),hl`) and consumed by entry_1ac3. */
export const P1_INPUT = 0x6010;

/** Raw IN0/IN1 port byte for this frame (bit4 = jump button), kept so the next frame's edge detector
 *  (`cpl / and b`) can tell newly-pressed from still-held. Stored as the high half of readControls'
 *  `ld (0x6010),hl`. Steady 0x10 while jump held. */
export const P1_INPUT_RAW = 0x6011;

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

// The player verifier also named 0x6228 (lives) and 0x622D (bonus-life-granted latch),
// as PLAYER_LIVES / EXTRA_LIFE_AWARDED. Canonical names LIVES and BONUS_LIFE_AWARDED are
// in the Board/level section below; both verifiers confirmed them independently, and the
// player-side evidence is folded into those entries.

/** 16-bit up-counter for how long the current hammer has been active (loc_2f43, ROM 0x2F4C `inc (hl)`);
 *  the hammer ends when the high byte reaches 2 (~512 frames), clearing 0x6217 and restoring the BGM.
 *  Bit 3 of the low byte drives the 8-frame swing animation. */
export const HAMMER_TIMER_LO = 0x6394;
export const HAMMER_TIMER_HI = 0x6395;

/** Mario's 4-byte hardware sprite record: +0 X (0x6203), +1 code (0x6207), +2 attr (0x6208), +3 Y
 *  (0x6205), copied in that deliberate order by entry_1da6 (ROM 0x1DA6) and DMA'd to sprite RAM
 *  0x704C. Observed byte-identical to the source tuple; the hammer overrides +1 via loc_2f43. */
export const MARIO_SPRITE_RECORD = 0x694C;

// ── Game state & NMI dispatch ────────────────────────────────────────────────
// Source: ram-verify-world.md.

/** Top-level game state: 0 power-on, 1 attract, 2 credited, 3 in-game. NMI dispatches through the
 *  4-entry rst 0x28 table at ROM 0x00CA on this value. Observed: →1@f5, →2 at the coin frame, →3 at
 *  the start frame. */
export const GAME_STATE = 0x6005;

/** Non-zero while no credited game is in progress (attract). Gates the NMI joystick read
 *  (`jp nz` @ROM 0x0080), the sound driver (`ret nz` @0x00EA), and rst 0x08. 1 from power-on, 0 the
 *  frame a credit is accepted (@ROM 0x08BE), 1 again at game over. */
export const ATTRACT = 0x6007;

/** Prescaler paired with SUBSTATE_TIMER: rst 0x20 (ROM 0x0020) decrements this and, on underflow,
 *  falls into rst 0x18 to tick 0x6009. Low/fast half of the two-byte sub-state timer. */
export const SUBSTATE_TIMER_LO = 0x6008;

/** Frames remaining before the current sub-state may proceed; counts down 1/frame. rst 0x18
 *  (ROM 0x0018) decrements it and, unless it hit 0, discards the caller's remainder. The
 *  "wait N then go to sub-state M" idiom writes N here and M into 0x600A (the next byte). */
export const SUBSTATE_TIMER = 0x6009;

/** Sub-state dispatch index WITHIN the current GAME_STATE. In-game (state 3) the handler at
 *  ROM 0x06FE does `ld a,(0x600a) / rst 0x28` through the 29-entry table at 0x0702:
 *  7=opening Kong-climb cutscene (NOT a rescue), 8=how-high, 10=board setup, 13=gameplay,
 *  14=P1 death, 0x16=board-cleared/advance. Board-complete writes 0x16 (ROM 0x1E80 rivet-zero;
 *  girder/rescue boards likewise). NOTE: this is a corrected name — arcade2 commit 14da179 called
 *  this address a "rescue flag" after seeing 7 at a board transition; 7 is the NEXT board's intro.
 *  Board-to-board progression and the level loop are real and validated-by-play regardless of this
 *  byte's name. Proven: poking 7 mid-board replays the intro and freezes BOARD/LEVEL/SEQPTR;
 *  poking 0x16 advances 25m->100m. */
export const GAME_SUBSTATE = 0x600A;

/** Step index of the opening Kong-climb cutscene; ROM 0x0A76 does `ld a,(0x6385) / rst 0x28` on it
 *  against the 8-entry table at 0x0A7A. Walks 1→7 over the cutscene (roar audio 0x608A=0x0F at
 *  step 7). Reached only while GAME_SUBSTATE (0x600A) == 7. */
export const INTRO_STEP = 0x6385;

// ── Board / level / sequence ─────────────────────────────────────────────────
// Source: ram-verify-world.md (live player-context block 0x6228-0x622F + board/rivet state).

/** Player 1's saved 8-byte context (LIVES,LEVEL,SEQPTR_lo,SEQPTR_hi,PLAY_INTRO,BONUS_LIFE,
 *  HOW_HIGH_INDEX,HOW_HIGH_LAST_SEQ). `ldir`'d to the live block 0x6228 on restore (ROM 0x09AB) and
 *  from it on death (ROM 0x12FE). */
export const P1_CONTEXT = 0x6040;

/** Player 2's saved 8-byte context, same field order. Restore ldir at ROM 0x09FE (0x6048→0x6228),
 *  save at ROM 0x1350. NOTE: 0x6049/0x604A/0x604B are P2's saved LEVEL/SEQPTR — NOT board registers;
 *  move_suite pokes them so this ldir doesn't clobber the live poke on the next restore. */
export const P2_CONTEXT = 0x6048;

/** Current board type: 1=25m girders, 2=50m conveyors, 3=75m elevators, 4=100m rivets. Re-derived
 *  from *BOARD_SEQ_PTR on every context restore (ROM 0x09B6/0x0A09). Per-board setup dispatch at
 *  ROM 0x0FCB. Proven: poking 1..4 selects the four boards; the sequence table pins the mapping. */
export const BOARD = 0x6227;

/** Lives remaining for the player currently up; offset 0 of the live context (0x6228-0x622F).
 *  Init from DIP_LIVES; `dec (hl)` on death (ROM 0x12FC), `inc` on bonus-life award; the on-screen
 *  lives indicator is redrawn from it (entry_06b8, ROM 0x06C7). Both verifiers confirmed it
 *  independently — poking 5 then dying reads 4 and draws 4 markers, and 3@f463 → 2@f1957 one frame
 *  into the death sub-state. (Player findings named it PLAYER_LIVES.) */
export const LIVES = 0x6228;

/** Level number, 1-based binary, clamped to 99 (`cp 0x64` @ROM 0x06E4). Bonus = min(10*LEVEL+40,80).
 *  Incremented once per completed level at ROM 0x1951 (`ld hl,0x6229 / inc (hl)`) when the board
 *  sequence hits its 0x7F terminator. */
export const LEVEL = 0x6229;

/** 16-bit ROM pointer (lo,hi) into the board-order table; init 0x3A65. Board-complete does
 *  `inc hl / ld a,(hl) / cp 0x7f`; on the 0x7F terminator it reloads 0x3A73 (start of the L5+ group),
 *  so levels 5+ repeat forever. The byte it points at is copied to BOARD. */
export const BOARD_SEQ_PTR = 0x622A; // +1 = high byte

/** 1 = still play the opening cutscene for this player. Template value 1; zeroed by BOTH death
 *  handlers (ROM 0x12F6 `xor a / ld (0x622c),a`). ROM 0x0A71 reads it: non-zero advances 0x600A to
 *  sub-state 7 (cutscene), zero advances to 8 (how-high) — which is why post-death boards skip the
 *  intro. */
export const PLAY_INTRO = 0x622C;

/** Latch so the score-threshold extra life is granted once per player. sub_0350 (ROM 0x0350)
 *  early-outs on it (`ret nz`) and sets it to 1 (ROM 0x0375) immediately before `inc (LIVES)`.
 *  ROM-unambiguous but never observed set (score never crossed the threshold); 0 at each board
 *  start. (Player findings named it EXTRA_LIFE_AWARDED.) */
export const BONUS_LIFE_AWARDED = 0x622D;

/** Height index for the "HOW HIGH CAN YOU GET?" interlude, clamped to 5. Stepped when BOARD_SEQ_PTR
 *  differs from the copy in 0x622F; reset to 0 on level increment (ROM 0x195C). */
export const HOW_HIGH_INDEX = 0x622E;

/** Copy of BOARD_SEQ_PTR's low byte, used only to detect the pointer moved (ROM 0x0C11). */
export const HOW_HIGH_LAST_SEQ = 0x622F;

/** Rivets still in place on 100m; init 8 from ROM template 0x3DAC. `dec (hl)` per rivet removed
 *  (ROM 0x1A86); at 0 the board-complete test at ROM 0x1E80 forces GAME_SUBSTATE = 0x16. */
export const RIVETS_LEFT = 0x6290;

/** 8 per-rivet present flags (1 = still there) at 0x6292-0x6299; ROM 0x1A7B indexes 0x6292+b,
 *  tests+clears it, then decrements RIVETS_LEFT. (0x6291 sits just below and is NOT part of the array.) */
export const RIVET_PRESENT = 0x6292; // [8]

// ── Score & bonus ────────────────────────────────────────────────────────────
// Source: ram-verify-world.md.

/** Player 1 score: 3-byte LITTLE-endian packed BCD (0x60B4 = most-significant pair). Award opcode 0
 *  adds a 3-byte entry from the table at ROM 0x3529 (arg = index). Slot selected by sub_055f
 *  (ROM 0x055F) on 0x600D. Proven: award 5 (+500) landed in 0x60B3, the middle byte. */
export const P1_SCORE = 0x60B2;

/** Player 2 score, same 3-byte little-endian BCD format. sub_055f returns 0x60B5 when 0x600D != 0.
 *  Attract-mode placeholder is AA AA AA (ROM template 0x01BA). */
export const P2_SCORE = 0x60B5;

/** High score, same format; default 007650 from ROM template 0x01BA. Updated by the downward
 *  MSB-pair-first compare at ROM 0x0540; on a new high, 3 bytes are copied here. Proven: forcing
 *  P1 to 990500 overwrote this with 00 05 99. */
export const HIGH_SCORE = 0x60B8;

/** The board's starting bonus, held constant for the whole board (denominator for barrel-release
 *  pacing at ROM 0x2C12/0x2C33 and the end-of-board tally). Written only at ROM 0x0F8E. */
export const BONUS_START = 0x62B0;

/** Bonus counter in units of 100 points (on-screen value = BONUS*100). Set at board start to
 *  min(10*LEVEL+40, 80); reaching 0 sets 0x6386=1. Ticks down via two mechanisms: the timed
 *  decrementer (boards 2/3/4, ROM 0x2FCB) or the barrel-release routine (board 1, ROM 0x2CB8). */
export const BONUS = 0x62B1;

/** Next BONUS value at which the board's periodic spawn event fires; init to BONUS_START, stepped
 *  down by 8 on each match. ROM 0x2C57 `cp c / sub 0x08 / ld (0x62b2),a`. */
export const BONUS_EVENT_MARK = 0x62B2;

/** Frames between bonus ticks = max(0xDC - 2*bonus, 0x28); reload value for BONUS_TICK. Computed at
 *  ROM 0x0F97. Measured: L2→100, L3→80, L4→60 frames (metronomic on boards 2/3/4). */
export const BONUS_PERIOD = 0x62B3;

/** Countdown to the next bonus tick; reloaded from BONUS_PERIOD. ROM 0x2FCE `dec (hl) / ret nz`. */
export const BONUS_TICK = 0x62B4;

/** Small state machine (0-3) run by `ld a,(0x6386) / rst 0x28` at ROM 0x1A07; set to 1 by both
 *  bonus-decrement sites the moment BONUS hits 0. */
export const BONUS_EXPIRED_STEP = 0x6386;

// ── Coins & DIPs ─────────────────────────────────────────────────────────────
// Source: ram-verify-world.md.

/** Credit count, BCD, capped at 0x90 (ROM 0x01AC). Consumed by the start handlers; while non-zero
 *  the attract handler advances GAME_STATE. Observed 0→1 at coin, →0 at start. */
export const CREDITS = 0x6001;

/** Coins accumulated toward the next credit; reset to 0 when it reaches DIP_COINS_PER_CREDIT
 *  (ROM 0x01A0). Coin test 3C/1C: 1,2 coins → 1,2; the 3rd rolls a credit and resets it to 0. */
export const COINS_PARTIAL = 0x6002;

/** Edge latch for the coin line (IN2 bit 7). Held 1 while no coin present; a coin counts only when
 *  it finds the latch set, then clears it — so holding the coin line does not repeat-credit
 *  (ROM 0x017B). Proven by the coin test: each pulse counted exactly once. */
export const COIN_EDGE = 0x6003;

/** Lives per game, 3-6, from DSW0 (ROM 0x020E `and 0x03 / add a,0x03`). Copied into LIVES at game
 *  start. DIP sweep: 0x80/81/82/83 → 3/4/5/6. */
export const DIP_LIVES = 0x6020;

/** Extra-life threshold in BCD thousands: 0x07/0x10/0x15/0x20 = 7000/10000/15000/20000. Derived
 *  from DSW0 bits 2-3 at ROM 0x0214; compared against the score's thousands pair at ROM 0x036E. */
export const DIP_BONUS_LIFE = 0x6021;

/** Coins needed for a 1-player game — DISPLAY value only, written to VRAM 0x756C by ROM 0x07AD. */
export const DIP_COINS_FOR_1P = 0x6022;

/** Coins needed for a 2-player game — DISPLAY value only, written to VRAM 0x756E by ROM 0x07B1
 *  (with a tens-digit split for "10"). */
export const DIP_COINS_FOR_2P = 0x6023;

/** Coins the mechanism must swallow per credit group (ROM 0x01A2). Coin test: 3 coins at 3C/1C →
 *  1 credit, partial resets. */
export const DIP_COINS_PER_CREDIT = 0x6024;

/** Credits awarded per completed coin group (ROM 0x01A9). Coin test: 1 coin at 1C/2C → 2 credits. */
export const DIP_CREDITS_PER_COIN = 0x6025;

/** Cabinet: 1 = upright, 0 = cocktail (DSW0 bit 7, ROM 0x024F). Selects whether P2 reads IN1 in the
 *  NMI (`jp nz,0x0098` @0x0087); mirrored to the flip-screen latch 0x7D82. Sweep: 0x80→1, 0x00→0. */
export const DIP_UPRIGHT = 0x6026;

// ── Frame-sync & PRNG ────────────────────────────────────────────────────────
// Source: ram-verify-world.md.

/** Pseudo-random accumulator: sub_0057 (ROM 0x0057, called each vblank) does
 *  0x6018 += FRAME + SPIN_COUNT — a decrementing counter plus a jittery one. Read as entropy at
 *  ROM 0x2186 etc. Measured: 2576 changes over 2600 frames, full byte range. */
export const RANDOM = 0x6018;

/** Spin counter: incremented once per main-loop pass, ~140×/frame (NOT a frame counter). Its jitter
 *  with per-frame workload is the point — it feeds the PRNG. Measured +138..+142 in gameplay, never
 *  +1 (ROM 0x02CD). */
export const SPIN_COUNT = 0x6019;

/** Frame counter: DECREMENTED once per vblank NMI (ROM 0x00B5). Everything periodic keys off it
 *  (`and 0x0F`, `and 0x1F`, rst 0x30 guards). Measured: exactly -1 every frame. */
export const FRAME = 0x601A;

/** Difficulty ramp = min(LEVEL + (DIFFICULTY_CLOCK >> 3), 5) — rises with level AND time on board
 *  (ROM 0x038F). Consumed by barrel/enemy behaviour (ROM 0x2186 etc). =1 on level 1. */
export const DIFFICULTY = 0x6380;

/** Increments every 256 frames; every 8th increment recomputes DIFFICULTY (ROM 0x0386). Reset at
 *  board start. Measured: 257-frame cadence, resets when the board is built. */
export const DIFFICULTY_CLOCK = 0x6381;

/** The main loop's latched copy of the last FRAME it serviced; the loop spins on
 *  `ld a,(0x601A) / cp (hl) / jr z` (ROM 0x02D1) — the wait-for-vblank. Byte-identical to FRAME at
 *  the frame boundary except on overrun frames. */
export const FRAME_SEEN = 0x6383;

/** Increments once per serviced frame; sub_037f (ROM 0x037F) returns unless it wrapped, so the block
 *  below runs every 256 frames. Measured +1/frame. */
export const DIFFICULTY_PRESCALER = 0x6384;

// ── Task scheduler ───────────────────────────────────────────────────────────
// Source: ram-verify-world.md.

/** Enqueue pointer — low byte of an address in page 0x60. sub_309f writes [D,E] at 0x6000+TAIL and
 *  advances by 2, wrapping 0xFE→0xC0 (ROM 0x30A3); a full slot silently drops the request. Init 0xC0. */
export const TASK_TAIL = 0x60B0;

/** Dequeue pointer, same encoding. The main loop reads (0x6000+HEAD); 0xFF opcode = "no task".
 *  Advances by 2 after dispatch (ROM 0x02BF). Proven: 0xC4→0xC6 the frame after a task ran. */
export const TASK_HEAD = 0x60B1;

/** Task ring: 32 slots × 2 bytes [opcode, argument] at 0x60C0-0x60FF. 0xFF opcode = free (boot fills
 *  all 64 bytes 0xFF, ROM 0x0298; the dispatcher writes 0xFF back on consume). Opcode 0 = add-to-
 *  score. Proven by injecting (0,5) and watching P1_SCORE = 000500. */
export const TASK_RING = 0x60C0;

// ── Sound scheduler ──────────────────────────────────────────────────────────
// Source: ram-verify-world.md.

/** 8 per-latch-bit sound trigger counters at 0x6080-0x6087 (ls259.6h). sub_00e0 (ROM 0x00E0, per
 *  NMI) walks them with 0x7D00-0x7D07: non-zero → decrement and assert the bit, zero → deassert.
 *  Game code stores 3 (a 3-frame assert). Per-bit sound names are audio/README.md's, not re-derived. */
export const SND_TRIGGER = 0x6080; // [8]

/** Same countdown shape, driving the I8035 sound-CPU interrupt line at 0x7D80 (ROM 0x010E). */
export const SND_IRQ_TRIGGER = 0x6088;

/** Background tune index → 0x7C00 while SND_PRIORITY_FRAMES is 0; held, so the tune loops
 *  (ROM 0x0102). Observed 0x08 (25m theme) from f1395 on board 1. */
export const SND_BGM = 0x6089;

/** Priority tune index → 0x7C00 while SND_PRIORITY_FRAMES != 0, overriding SND_BGM (ROM 0x0108).
 *  Observed 0x01 (intro) then 0x0F (roar) during the cutscene, 0x02 at level start. */
export const SND_PRIORITY = 0x608A;

/** Countdown for SND_PRIORITY; game code stores 3, so a priority tune is a 3-frame pulse
 *  (ROM 0x00FA). Observed writes are 3 then 2,1,0 on consecutive frames. */
export const SND_PRIORITY_FRAMES = 0x608B;

// ── Deliberately unnamed ─────────────────────────────────────────────────────
// Addresses that appear in the findings files (ram-findings-*.md) but were
// examined and left as hex — recorded here so the omissions are visible, not
// silent. Each is a REJECT (evidence too thin / shared byte / no reader) or a
// deferral to another owner. They stay hex in ../translated/.
//
// From ram-findings-player.md §Rejected (16 examined; 15 stay unnamed —
// 0x622C was promoted to PLAY_INTRO by the world verifier and IS named above):
//   0x6201                      zero every frame, no absolute ROM site
//   0x6209 0x620A               constant 4/8; the player's hit-box routine hard-codes
//                               0x0407 instead of reading them (demonstrably unused copies)
//   0x6219                      climb toggle; two writers, ZERO absolute reads
//   0x621A                      "broken-ladder"-looking flag BUT also written by an
//                               unrelated object arm (0x2236/0x223F) — shared byte, one
//                               board can't settle it; rejection UPHELD (stays hex)
//   0x620D 0x621D 0x6223 0x6226 zero throughout, no absolute sites
//   0x6222                      climb-centring toggle; also written by loc_2259 (0x2295) — shared
//   0x6225                      prize/score-domain collection flag, out of the player half
//   0x6081 0x6084 0x6085        sound latches — covered by the named SND_TRIGGER[8] span
//                               (0x6080-0x6087); deferred to audio/README.md, not named individually
//   0x6089                      sound latch — IS named above as SND_BGM (world verifier)
//
// From ram-findings-world.md §10 Rejected (50 examined, all stay unnamed):
//   No ROM reference at all:    0x6004 0x6006 0x600B 0x600C
//   Written once at boot:       0x6000
//   Board/animation scratch:    0x6030 0x6031 0x6032 0x6034 0x6035 0x6036 0x6038 0x603A
//                               0x6060 0x6100 0x611C 0x61A5 0x61B1 0x61C6 0x61C7
//   0x63xx engine scratch:      0x6300 0x6310 0x6340 0x6341 0x6342 0x6343 0x6345 0x6346
//                               0x6348 0x6350 0x6382 0x6387 0x6388 0x638C 0x638F 0x6390
//                               0x6391 0x6392 0x6393 0x63A0
//   Board-object bookkeeping:   0x62AA 0x62AC 0x62AF 0x62B5 0x62B6 0x62B7 0x62B8 0x62B9
//                               0x62BA 0x6291 (0x6291 sits below the rivet array, NOT part of it)
//
// Deferred-not-rejected, and NOW named above from the OTHER half:
//   0x6010 0x6011  world left them "for whoever owns input" — named here as
//                  P1_INPUT / P1_INPUT_RAW (player verifier).
