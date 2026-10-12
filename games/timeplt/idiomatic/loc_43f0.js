// SPDX-License-Identifier: GPL-3.0-only
/** loc_43f0 — one round-engine pass of the Mother-Ship, a deep state machine seated on a fixed
 * record/sprite pair. The record's lead byte is the phase: idle counts a delay down and, once spent,
 * seeds a fresh launch placed by the player heading; once its hits are spent the dying phase counts
 * the head down and, at one exact value, sweeps the fifteen object records (each live one gets a
 * staggered dying code and pays 200 points, each held one is freed); the live phase drifts the pair
 * with the world, dresses it, and — while off cooldown, with a tile on screen but outside the near
 * band around the player — fires a shot into a free enemy-shot slot (it flies straight on a stored velocity and does not home), with a heading and velocity pair
 * computed here. Every callee, the
 * inline jump-table arm included, is reached as a direct call. LIVE-OUT: memory. The record/sprite
 * pair is threaded explicitly through the whole recursion and into every callee. */
//
// ROM 0x43F0-0x47B2 (the entry at 0x43F0 plus the arms exported below, each named for its effect and
// headed with its ROM address; the arms are interior to 0x43F0 and are not routines of their own);
// lift: translated/loc_43f0.js. Grounding: [seen] (names.js ROUTINES 0x43F0) -- every arm was watched
// under MAME making its own role-defining writes. Reached from armMotherShipOrStep (0x43B7) [seen]
// while MOTHER_SHIP_ARMED (0xAD0D) [seen] is set.
//
// ROLE IN THE MACHINE. Once the round's kill quota (KILLS_REMAINING) is spent, armMotherShipOrStep
// arms the Mother-Ship: it takes the last two records of the craft band, MOTHER_SHIP_STATE (0xA8A0)
// [seen] and the one after it (0xA8B0), with its sprite entry at MOTHER_SHIP_ENTRY (0xAA24) [seen],
// and seeds the record's +0x04 byte (MOTHER_SHIP_HITS_TO_ABSORB, which counts the hits it can absorb)
// with 7 and the idle delay at +0x0E. From then on this routine is its whole life, and the record's
// head byte (+0x00) is its phase:
//
//   0x00         IDLE      count the delay at +0x0E down; when spent, launch (launchMotherShipFromPlayerHeading).
//   0xFF         LIVE      move with its velocity and the world, dress the sprite, and fire at the
//                          player when it may (flyMotherShipOneFrame -> tryToFireFromMotherShip -> fireMotherShipShotIntoFreeSlot ->
//                          launchAimedMotherShipShot).
//   0xF0         HIT       written by a collision sweep. While hits remain one is absorbed and the ship
//                          goes back to LIVE (absorbMotherShipHitElseStepItsDeath); so a ship never
//                          relaunched takes eight hits to kill.
//   0xEF..0x01   DYING     with no hits left the head counts down one per step
//                          (stepMotherShipWreckCountdown): the fatal hit's own step, at 0xF0, already
//                          writes one wreck shape, at 0xEF it sweeps the whole field
//                          (sweepFieldOnMotherShipDeathElseStepWreck), from 0xE4 down it plays its wreck
//                          shapes, at 0xB4 it swaps them for a '3000' label and pays 3,000 points
//                          (swapWreckForThreeThousandLabelAndPay), at 0x5A its sprite codes are set to
//                          0xFF, and at 0 it goes idle, which hands over to the round advance, and raises
//                          ROUND_TRANSITION_HOLD to 0xFF (retireMotherShipAndRaiseRoundHold).
//
// SPRITE ENTRY LAYOUT (mechanisms.md). An entry's +0x00 is one coordinate and +0x01 the sprite code
// (shape); 0x30 bytes on, +0x30 is the attribute (colour and flip) and +0x31 the other coordinate. The
// Mother-Ship is two sprites: the second tile uses the next entry (+0x02/+0x03/+0x32/+0x33), placed one
// sprite pitch (16) further along the +0x31 coordinate. Each coordinate is a 16-bit number: the whole
// byte in the entry and a fraction byte in the record (+0x03 for the +0x31 coordinate, +0x05 for +0x00).
//
// LIVE-OUT: memory only -- the record pair and sprite entries, the fifteen swept records, the scoring
// ring, the sound requests, ROUND_TRANSITION_HOLD, BOMBER_HITS_TO_ABSORB, the launch cooldown and the aim toggle.

import { u8, u16 } from "../../../core/int.js";
import { NotImplemented } from "../../../boards/timeplt/io.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { loc_598e } from "./loc_598e.js";
import { loc_5994 } from "./loc_5994.js";
import { postCommand } from "./postCommand.js";
import { driftWithWorldScroll } from "./driftWithWorldScroll.js";
import { headingToward } from "./headingToward.js";
import { dressSpriteForHeadingOrRetireAtEdge } from "./dressSpriteForHeadingOrRetireAtEdge.js";
import { derailIntoMotherShipWreckCountdown } from "./derailIntoMotherShipWreckCountdown.js";
import { setMotherShipVelocityFromHeading } from "./setMotherShipVelocityFromHeading.js";
import { enqueueTransitionSoundStops } from "./enqueueTransitionSoundStops.js";
import { requestEnemyLaunchSound } from "./requestEnemyLaunchSound.js";
import { requestTwoSounds } from "./requestTwoSounds.js";
import { requestDestructionSoundBurst } from "./requestDestructionSoundBurst.js";
import { requestCurrentEraSound } from "./requestCurrentEraSound.js";
import { requestMotherShipAwardSound } from "./requestMotherShipAwardSound.js";
import { ACTOR_ENTRY_SLOT2, ACTOR_RECORD_SLOT0, ACTOR_RECORD_SLOT2, BANK_LAUNCH_COOLDOWN, BANK_LAUNCH_COOLDOWN_PERIOD, BANK_LAUNCH_NEAR_HALF_WIDTH, ENEMY_STANDOFF_AIM_MAIN, ERA_INDEX, FRAME_TICK, BOMBER_HITS_TO_ABSORB, MOTHER_SHIP_AIM_SIDE_TOGGLE, MOTHER_SHIP_ENTRY, MOTHER_SHIP_STATE, PLAYER_HEADING, PLAYER_STATE, ROUND_TRANSITION_HOLD, SCRATCH_PTR_A, SCRATCH_PTR_B, TAMPER_GLYPH_COPY, WORLD_SCROLL_X, WORLD_SCROLL_Y, HEADING_EDGE_POSITION_TABLE, MOTHER_SHIP_WRECK_SHAPE_TABLE } from "./names.js";

// The field sweep (sweepFieldOnMotherShipDeathElseStepWreck): fifteen sixteen-byte records from ACTOR_RECORD_SLOT0 (0xA810) up
// to the parachutist's (0xA8F0); the dying codes it hands out start at 0x14 and step 10 per record;
// each swept live record posts scoring-ring command (4, 2) -- 200 points (`ld de,0x0402` at 0x4574).
const SLOT_STRIDE = 0x10;
const SLOT_COUNT = 0x0f;
const FIRST_SLOT_CODE = 0x14;
const CODE_STEP = 0x0a;
const SWEEP_SCORE_AWARD_COMMAND = 0x04;
const TWO_HUNDRED_POINTS_INDEX = 0x02;
// After the sweep: the head restarts at 0xE4, ROUND_TRANSITION_HOLD is set to 0xFE, and both tiles'
// attribute bytes are seeded with 0x3D. A PHASE (head + 1) of 0xF0 -- the head at 0xEF -- is the sweep's trigger.
const WRECK_COUNTDOWN_START = 0xe4;
const ROUND_HOLD_SWEEPING = 0xfe;
const SPRITE_SEED = 0x3d;
const FIELD_SWEEP_TRIGGER = 0xf0;

// Record offsets: the idle delay (+0x0E), the hit counter MOTHER_SHIP_HITS_TO_ABSORB (+0x04), the head.
const IDLE_DELAY = 0x0e;
const HITS_TO_ABSORB = 0x04;
const STATE = 0x00;

// Scoring-ring command (4, 13): 3,000 points, posted at the award-label step (`ld de,0x040d` at 0x463D).
const LABEL_SCORE_AWARD_COMMAND = 0x04;
const THREE_THOUSAND_POINTS_INDEX = 0x0d;

// Dying-countdown landmarks (see the table in the header), and the anti-tamper witness the finished
// wreck checks: TAMPER_GLYPH_COPY must hold glyph 0x7C followed by colour 0x10 or 0x05.
const AWARD_LABEL_STATE = 0xb4;
const WRECK_HIDE_STATE = 0x5a;
const WITNESS_GLYPH = 0x7c;
const WITNESS_COLOUR_A = 0x10;
const WITNESS_COLOUR_B = 0x05;

// The launch test (tryToFireFromMotherShip): the player's fixed screen position (0x84, 0x78) is the centre of
// the near band, and the two on-screen floors keep a ship that is off the picture from firing.
const NEAR_X = 0x84;
const NEAR_Y = 0x78;
const ON_SCREEN_X = 0x28;
const ON_SCREEN_Y = 0x20;

const FIRST_ATTRIBUTE = 0x30; // +0x30 off an entry: its attribute byte (colour and flip), not a second entry

// ── Entry (0x43F0): seat the record (0xA8A0) and entry (0xAA24) and dispatch on the head.
export function loc_43f0(m) {
  const { mem8 } = m;
  const state = mem8[MOTHER_SHIP_STATE];
  // The record/sprite pair is handed EXPLICITLY into the arm, and on by every arm to its callees.
  if (state === 0x00) return countDownIdleDelayThenLaunchMotherShip(m, MOTHER_SHIP_STATE, MOTHER_SHIP_ENTRY); // idle
  if (u8(state + 1) !== 0x00) return absorbMotherShipHitElseStepItsDeath(m, u8(state + 1), MOTHER_SHIP_STATE, MOTHER_SHIP_ENTRY); // mid-phase (C = phase + 1)
  return flyMotherShipOneFrame(m, MOTHER_SHIP_STATE, MOTHER_SHIP_ENTRY); // live
}

// ── LIVE (0x4403): move the ship one step, dress it, then look for a chance to fire.
// Each coordinate is glued from its whole byte (entry) and fraction (record), has the ship's own
// velocity word and the world's scroll word added, and is split back -- so sub-pixel speeds build up in
// the fraction. The ship moves with the scrolling sky, as every object does.
export function flyMotherShipOneFrame(m, record, entry) {
  const { mem8, mem16 } = m;
  const atRecord = (offset) => u16(record + offset);
  const atEntry = (offset) => u16(entry + offset);

  // The native-Y word: record velocity (record+0x0c/0d) + WORLD_SCROLL_Y + the ship's native Y
  // (entry+0x31 : record+0x03), split back to entry+0x31 : record+0x03.
  let nativeYWord = u16(((mem8[atRecord(0x0c)] << 8) | mem8[atRecord(0x0d)]) + mem16[WORLD_SCROLL_Y]);
  nativeYWord = u16(nativeYWord + ((mem8[atEntry(0x31)] << 8) | mem8[atRecord(0x03)]));
  mem8[atEntry(0x31)] = nativeYWord >> 8;
  mem8[atRecord(0x03)] = u8(nativeYWord);

  // The native-X word (+0x00 coordinate): its velocity word sits at +0x0C/+0x0D of the SECOND record
  // (ix+0x1C/+0x1D), where setMotherShipVelocityFromHeading parks it; the world's part is
  // WORLD_SCROLL_X (0xA80A) [seen].
  let nativeXWord = u16(((mem8[atRecord(0x1c)] << 8) | mem8[atRecord(0x1d)]) + mem16[WORLD_SCROLL_X]);
  nativeXWord = u16(nativeXWord + ((mem8[atEntry(0x00)] << 8) | mem8[atRecord(0x05)]));
  mem8[atEntry(0x00)] = nativeXWord >> 8;
  mem8[atRecord(0x05)] = u8(nativeXWord);

  // Butt the second tile against the first: same native X (+0x00), native Y (+0x31) 16 further on.
  mem8[atEntry(0x33)] = u8(mem8[atEntry(0x31)] + 0x10);
  mem8[atEntry(0x02)] = mem8[atEntry(0x00)];

  // Dress the sprites for the heading, or -- if the ship has reached the field edge -- retire it back
  // to idle with a fresh delay (dressSpriteForHeadingOrRetireAtEdge, 0x4447 [seen]); then the fire test.
  dressSpriteForHeadingOrRetireAtEdge(m, record, entry);
  return tryToFireFromMotherShip(m, record, entry);
}

// ── IDLE (0x4535): count the delay at +0x0E down one per step; launch once it is already zero.
export function countDownIdleDelayThenLaunchMotherShip(m, record, entry) {
  const { mem8 } = m;
  const atRecord = (offset) => u16(record + offset);
  if (mem8[atRecord(IDLE_DELAY)] === 0x00) return launchMotherShipFromPlayerHeading(m, record, entry);
  mem8[atRecord(IDLE_DELAY)] = u8(mem8[atRecord(IDLE_DELAY)] - 1);
}

// ── Any head other than 0x00 and 0xFF (0x4540). `phase` is the head plus one (the ROM's C).
// A collision sweep marks a hit by writing 0xF0 into the head. While MOTHER_SHIP_HITS_TO_ABSORB (+0x04)
// is non-zero the hit is ABSORBED: spend one, put the head back to 0xFF (live), request the pair of hit
// sounds (requestTwoSounds, 0x5683 [seen]) and run the live step in this same pass. Armed with 7 and
// never relaunched, the ship survives seven hits and the eighth, finding the counter at zero, starts
// its death. From then on the counter stays zero, so every later step of the dying countdown also
// passes straight through here.
export function absorbMotherShipHitElseStepItsDeath(m, phase, record, entry) {
  const { mem8 } = m;
  const atRecord = (offset) => u16(record + offset);
  if (mem8[atRecord(HITS_TO_ABSORB)] === 0x00) return sweepFieldOnMotherShipDeathElseStepWreck(m, phase, record, entry);
  mem8[atRecord(HITS_TO_ABSORB)] = u8(mem8[atRecord(HITS_TO_ABSORB)] - 1);
  mem8[atRecord(STATE)] = 0xff; // back to live
  requestTwoSounds(m);
  return flyMotherShipOneFrame(m, record, entry);
}

// ── Dying (0x4554). On the step where the head reads 0xEF (phase 0xF0, `cp 0xf0`) the ship sweeps the
// whole field; on every other dying step it goes on to the countdown at 0x45B3.
export function sweepFieldOnMotherShipDeathElseStepWreck(m, phase, record, entry) {
  const { mem8 } = m;
  const atRecord = (offset) => u16(record + offset);
  const atEntry = (offset) => u16(entry + offset);

  if (phase !== FIELD_SWEEP_TRIGGER) return stepMotherShipWreckCountdown(m, record, entry);

  // The Mother-Ship's death clears BOMBER_HITS_TO_ABSORB (0xA8DC) [seen] -- the bomber's hit counter -- and
  // queues the transition sound stops (0x5634) and the destruction sound burst (0x56D2).
  mem8[BOMBER_HITS_TO_ABSORB] = 0x00;
  enqueueTransitionSoundStops(m);
  requestDestructionSoundBurst(m);

  // Sweep the fifteen records (the ROM loop from `ld hl,0xa810` at 0x4564): a record holding 0xFF (a live object)
  // is given its staggered dying code and pays 200 points through the scoring ring; a record held at
  // 0xFE is cleared to 0x00 (free); anything else is left alone. Because the codes climb 10 per record,
  // the swept objects' own death handlers take them down one after another rather than all at once;
  // every craft record gets 0x3C or more, so each passes through the kill-count step on its way down.
  let slot = ACTOR_RECORD_SLOT0;
  let code = FIRST_SLOT_CODE;
  let count = SLOT_COUNT;
  do {
    const head = mem8[slot];
    if (head === 0xff) {
      mem8[slot] = code;
      postCommand(m, SWEEP_SCORE_AWARD_COMMAND, TWO_HUNDRED_POINTS_INDEX); // post 200 points (command 4, award entry 2) for this record
    } else if (u8(head + 2) === 0x00) {
      mem8[slot] = 0x00; // slot held 0xFE
    }
    slot = u16(slot + SLOT_STRIDE);
    code = u8(code + CODE_STEP);
    count = u8(count - 1);
  } while (count !== 0);

  // Hold the round (ROUND_TRANSITION_HOLD, 0xACC6 [seen]: nonzero while a transition is underway,
  // `ld (0xacc6),a` at 0x4584), restart the head at 0xE4 and seed both tiles' attribute bytes.
  mem8[ROUND_TRANSITION_HOLD] = ROUND_HOLD_SWEEPING;
  mem8[atRecord(STATE)] = WRECK_COUNTDOWN_START;
  mem8[atEntry(FIRST_ATTRIBUTE)] = SPRITE_SEED;
  mem8[atEntry(0x32)] = SPRITE_SEED;
}

// ── The dying countdown (0x45B3): one step of the wreck and its award label, run every step the head
// is neither 0x00 nor 0xFF with no hits left (the fatal hit at head 0xF0 included), other than the
// sweep step at head 0xEF.
export function stepMotherShipWreckCountdown(m, record, entry) {
  const { mem8 } = m;
  const atRecord = (offset) => u16(record + offset);
  const atEntry = (offset) => u16(entry + offset);

  // No velocity of its own any more: the wreck only drifts with the world scroll (0x2B60 [seen]).
  driftWithWorldScroll(m, record, entry);

  // Dress the pair unless a coordinate is out of range -> flag 0xFF instead. The second tile is placed
  // 16 on, as in the live step, but if either coordinate has drifted into its edge window -- +0x31 in
  // 0xED..0xEF (`cp 0x03` at 0x45BC) or +0x00 + 8 below 0x28 (`cp 0x28` at 0x45CC) -- both tiles'
  // sprite codes are set to 0xFF instead.
  const nativeY = mem8[atEntry(0x31)];
  let hideBothTiles = false;
  if (u8(nativeY + 0x13) < 0x03) {
    hideBothTiles = true;
  } else {
    mem8[atEntry(0x33)] = u8(nativeY + 0x10);
    const nativeX = mem8[atEntry(0x00)];
    if (u8(nativeX + 0x08) < 0x28) hideBothTiles = true;
    else mem8[atEntry(0x02)] = nativeX;
  }
  if (hideBothTiles) {
    mem8[atEntry(0x01)] = 0xff;
    mem8[atEntry(0x03)] = 0xff;
  }

  // The wreck shapes: at exactly 0xB4 the '3000' label (below). Above it, the ship's two sprite
  // codes come from MOTHER_SHIP_WRECK_SHAPE_TABLE (0x461B), an eight-entry table indexed by the
  // falling head: (head - 0xB4) rotated right three times, less one, masked to 0..7 (`and 0x07` at
  // 0x45EC), then `rst 0x08` fetches the entry. The second tile (+0x03) gets the shape and the first
  // tile (+0x01) the shape plus one.
  const state = mem8[atRecord(STATE)];
  if (state === AWARD_LABEL_STATE) return swapWreckForThreeThousandLabelAndPay(m, record, entry);
  if (state > AWARD_LABEL_STATE) {
    let sh = u8(state - AWARD_LABEL_STATE);
    sh = ((sh >> 3) | (sh << 5)) & 0xff; // RRCA x3
    sh = u8(sh - 1) & 0x07;
    const shape = fetchTableByte(m, MOTHER_SHIP_WRECK_SHAPE_TABLE, sh);
    mem8[atEntry(0x03)] = shape;
    mem8[atEntry(0x01)] = u8(shape + 1);
  }

  // Count the head down. At zero the death is over (0x4646). At 0x5A (`cp 0x5a` at 0x4602) both sprite
  // codes are set to 0xFF, as at the edge above.
  const spent = u8(mem8[atRecord(STATE)] - 1);
  mem8[atRecord(STATE)] = spent;
  if (spent === 0x00) return retireMotherShipAndRaiseRoundHold(m, record);
  if (mem8[atRecord(STATE)] !== WRECK_HIDE_STATE) return;
  mem8[atEntry(0x01)] = 0xff;
  mem8[atEntry(0x03)] = 0xff;
}

// ── The award label (0x4623), the step the head reads 0xB4: count the head down, swap the wreck for
// the '3000' label sprite codes (0xFE and 0xFD) with attribute 0x6C on both tiles (held until 0x5A,
// or an earlier edge-window hide, sets them to 0xFF), request the award sound only if the player is
// alive (PLAYER_STATE 0xA800 [seen] reading 0xFF, `ld a,(0xa800)` at 0x4636), and post the 3,000-point
// award to the scoring ring as a tail (`jp 0x0038`).
export function swapWreckForThreeThousandLabelAndPay(m, record, entry) {
  const { mem8 } = m;
  const atRecord = (offset) => u16(record + offset);
  const atEntry = (offset) => u16(entry + offset);

  mem8[atRecord(STATE)] = u8(mem8[atRecord(STATE)] - 1);
  mem8[atEntry(0x01)] = 0xfe;
  mem8[atEntry(0x03)] = 0xfd;
  mem8[atEntry(FIRST_ATTRIBUTE)] = 0x6c;
  mem8[atEntry(0x32)] = 0x6c;

  if (u8(mem8[PLAYER_STATE] + 1) === 0x00) requestMotherShipAwardSound(m);
  return postCommand(m, LABEL_SCORE_AWARD_COMMAND, THREE_THOUSAND_POINTS_INDEX);
}

// ── The end (0x4646), the step the head reaches zero: raise ROUND_TRANSITION_HOLD from the sweep's 0xFE to 0xFF
// (still nonzero, so every zero-test reader stays held; 0xFF alone makes armMotherShipOrStep 0x43B7 stop
// stepping/re-arming the ship), and return the record head to idle (0x464B) -- the zeroed head at 0xA8A0 is
// what lets advanceRoundWhenFieldCleared's fifteen-record scan pass. Then the anti-tamper check: TAMPER_GLYPH_COPY
// (0xAB43) [seen] holds a glyph copied from the screen (during attract, and again at every credited one-player start), and the next byte its colour.
// A genuine image reads 0x7C with colour 0x10 or 0x05 (`cp 0x7c`, `cp 0x10`, `cp 0x05`, 0x4653-0x465D)
// and simply returns. Anything else is a patched caption, and the ROM jumps into
// derailIntoMotherShipWreckCountdown (0x459B) [code] through a misaligned prologue that pops the stack out
// of step -- a deliberate derail, not a routine this ship means to run.
export function retireMotherShipAndRaiseRoundHold(m, record) {
  const { mem8 } = m;
  const atRecord = (offset) => u16(record + offset);

  mem8[ROUND_TRANSITION_HOLD] = 0xff;
  mem8[atRecord(STATE)] = 0x00; // idle
  if (mem8[TAMPER_GLYPH_COPY] === WITNESS_GLYPH) {
    const next = mem8[u16(TAMPER_GLYPH_COPY + 1)];
    if (next === WITNESS_COLOUR_A) return;
    if (next === WITNESS_COLOUR_B) return;
  }
  return derailIntoMotherShipWreckCountdown();
}

// ── LAUNCH (0x4663), reached from IDLE when the delay is spent. Nothing happens while
// ROUND_TRANSITION_HOLD is set (`ld a,(0xacc6)` at 0x4663). Otherwise the ship appears at a position
// chosen from the player's heading and is set flying.
export function launchMotherShipFromPlayerHeading(m, record, entry) {
  const { mem8 } = m;
  const atRecord = (offset) => u16(record + offset);
  const atEntry = (offset) => u16(entry + offset);

  if (mem8[ROUND_TRANSITION_HOLD] !== 0x00) return; // locked out

  const player = mem8[PLAYER_HEADING];
  // Where it appears: HEADING_EDGE_POSITION_TABLE (0x3C84) holds a two-byte coordinate pair per heading sector.
  // The index is PLAYER_HEADING (0xA802) [seen] nudged 16 steps one way or the other by bit 3 of
  // FRAME_TICK (0xA980) [seen], then two RRCA and `and 0x3e`
  // (0x467B) to an even index into the pairs; `rst 0x08` fetches the first byte and leaves HL on it.
  // +/-0x10 by the tick's bit 3, biased by the player heading, then two RRCA and mask -> table index
  let idx = (mem8[FRAME_TICK] & 0x08) ? 0x10 : u8(0 - 0x10);
  idx = u8(idx + player);
  idx = ((idx >> 2) | (idx << 6)) & 0xff; // RRCA x2
  idx &= 0x3e;
  const positionEntry = u16(HEADING_EDGE_POSITION_TABLE + idx);
  mem8[atEntry(0x31)] = fetchTableByte(m, HEADING_EDGE_POSITION_TABLE, idx);
  mem8[atEntry(0x00)] = mem8[u16(positionEntry + 1)];

  // The ship's heading (record +0x02) is 0 or 128, the top bit of PLAYER_HEADING + 0xC0 (`and 0x80` at
  // 0x468C); setMotherShipVelocityFromHeading (0x46BA) [seen] turns it into the two velocity words.
  mem8[atRecord(0x02)] = u8(player + 0xc0) & 0x80;

  setMotherShipVelocityFromHeading(m, record);

  // The hit counter at launch (`cp 0x06` at 0x4697): below 6 it is raised to 5. A fresh ship keeps the 7
  // it was armed with; one that went idle after two or more hits and relaunched comes back needing six.
  if (mem8[atRecord(HITS_TO_ABSORB)] < 0x06) mem8[atRecord(HITS_TO_ABSORB)] = 0x05; // floor
  mem8[atRecord(STATE)] = 0xff; // activate the mothership
  // Announce it with the era's sound (requestCurrentEraSound, `jp 0x57f7`, a tail).
  return requestCurrentEraSound(m);
}

// ── FIRE TEST (0x46F0), after every live step: only while the head is 0xFF and BANK_LAUNCH_COOLDOWN
// (0xA817) [seen] -- the cooldown the Mother-Ship shares with the bank launcher -- has run out
// (`ld a,(0xa817)` at 0x46F5). The half-width of the near band is BANK_LAUNCH_NEAR_HALF_WIDTH (0xA827)
// [seen], doubled into the band's width.
export function tryToFireFromMotherShip(m, record, entry) {
  const { mem8 } = m;
  // `tile` walks the ship's two sprite entries; on a spawn it carries the current one into
  // fireMotherShipShotIntoFreeSlot.
  let tile = entry;
  const atRecord = (offset) => u16(record + offset);
  const atEntry = (offset) => u16(tile + offset);

  if (u8(mem8[atRecord(STATE)] + 1) !== 0x00) return; // not live
  if (mem8[BANK_LAUNCH_COOLDOWN] !== 0x00) return; // cooling down

  const halfBand = mem8[BANK_LAUNCH_NEAR_HALF_WIDTH]; // D
  const band = u8(halfBand + halfBand); // E
  let count = 0x02;
  do {
    // Each of the ship's two tiles in turn. It must be on the picture on both coordinates
    // (`cp 0x28` at 0x4707, `cp 0x20` at 0x4710), and then it fires if it is OUTSIDE the near band on
    // either coordinate: the byte-wrapped (centre - coordinate + half) lands at or above the band's
    // width (`cp e / jr nc,0x4734` at 0x471A and 0x4723; mechanisms.md: "more than BANK_LAUNCH_NEAR_HALF_WIDTH from the
    // player's fixed screen position ... on either axis").
    if (u8(mem8[atEntry(0x00)] + 0x08) >= ON_SCREEN_X && u8(mem8[atEntry(0x31)] + 0x10) >= ON_SCREEN_Y) {
      if (u8(u8(NEAR_X - mem8[atEntry(0x00)]) + halfBand) >= band) return fireMotherShipShotIntoFreeSlot(m, tile);
      if (u8(u8(NEAR_Y - mem8[atEntry(0x31)]) + halfBand) >= band) return fireMotherShipShotIntoFreeSlot(m, tile);
    }
    // Next entry (2 bytes): the ship's second tile.
    tile = u16(tile + 2);
    count = u8(count - 1);
  } while (count !== 0);
  // walked off with no spawn
}

// ── FIND A SLOT (0x4734): the shot goes into the first free one of the last two enemy-shot slots,
// records ACTOR_RECORD_SLOT2 (0xA830) and 0xA840 with entries from ACTOR_ENTRY_SLOT2 (0xAA16) [seen]
// (`ld hl,0xa830` at 0x4734). A record head of 0x00 is free; with neither free the ship does not fire.
// `origin` (the tile that passed the fire test) rides along as the shot's origin.
export function fireMotherShipShotIntoFreeSlot(m, origin) {
  const { mem8 } = m;

  let recordPtr = ACTOR_RECORD_SLOT2;
  let entryPtr = ACTOR_ENTRY_SLOT2;
  let count = 0x02;
  do {
    if (mem8[recordPtr] === 0x00) return launchAimedMotherShipShot(m, recordPtr, entryPtr, origin); // a free entry
    recordPtr = u16(recordPtr + 0x10);
    entryPtr = u16(entryPtr + 2);
    count = u8(count - 1);
  } while (count !== 0);
  // no free slot
}

// ── LAUNCH A SHOT (0x474C) into the free slot found above. recordPtr/entryPtr are the new shot's
// record and sprite entry; `origin` is the Mother-Ship tile it leaves from.
export function launchAimedMotherShipShot(m, recordPtr, entryPtr, origin) {
  const { mem8, mem16 } = m;

  // Park the new shot's record and entry in the scratch pointer pair (SCRATCH_PTR_A 0xA991 /
  // SCRATCH_PTR_B 0xA993 [seen], `ld (0xa991),hl` / `ld (0xa993),hl` at 0x474C-0x4750) and request
  // the launch sound (0x565F).
  mem16[SCRATCH_PTR_A] = recordPtr;
  mem16[SCRATCH_PTR_B] = entryPtr;

  requestEnemyLaunchSound(m);

  // Aim: the heading at the player, nudged +/-0x18 by an alternating side toggle. The mother-ship
  // entry is the threaded origin, passed to headingToward's object slot.
  // Precisely: headingToward (0x33B8) [seen] returns the 256-step heading from the tile to the aim
  // point whose X byte is ENEMY_STANDOFF_AIM_MAIN (0xAC7F) [seen]. MOTHER_SHIP_AIM_SIDE_TOGGLE (0xA8B4)
  // [seen] steps once per shot and its bit 0 swings the aim 0x18 one way or the other, so successive
  // shots alternate sides of the aim point.
  const heading = headingToward(m, ENEMY_STANDOFF_AIM_MAIN, origin);
  mem8[MOTHER_SHIP_AIM_SIDE_TOGGLE] = u8(mem8[MOTHER_SHIP_AIM_SIDE_TOGGLE] + 1);
  let aim = (mem8[MOTHER_SHIP_AIM_SIDE_TOGGLE] & 0x01) ? 0x18 : u8(0 - 0x18);
  aim = u8(aim + heading);

  // Carry the Mother-Ship tile's coordinates (+0x31 native Y, +0x00 native X) onto the new slot.
  const tileNativeY = mem8[u16(origin + 0x31)];
  const tileNativeX = mem8[u16(origin + 0x00)];
  const atRecord = (offset) => u16(recordPtr + offset);
  const atEntry = (offset) => u16(entryPtr + offset);
  mem8[atRecord(0x02)] = aim;
  mem8[atEntry(0x31)] = tileNativeY;
  mem8[atEntry(0x00)] = tileNativeX;

  // Dispatch the era's velocity arm directly. The slowest-sample arm serves the two opening eras and
  // the faster arm eras two through four; each reads the record's heading and returns the doubled
  // component pair, split little-endian into the record's 0x0a..0x0d cells just below. Later eras
  // name no arm and are surfaced as a fault, exactly as reaching past the table would.
  const era = mem8[ERA_INDEX];
  let alongFirstAxis, alongSecondAxis;
  switch (era) {
    case 0:
    case 1:
      [alongFirstAxis, alongSecondAxis] = loc_598e(m, mem8[atRecord(0x02)]);
      break;
    case 2:
    case 3:
    case 4:
      [alongFirstAxis, alongSecondAxis] = loc_5994(m, recordPtr);
      break;
    default:
      throw new NotImplemented(`launchAimedMotherShipShot: no velocity arm for era ${era}`);
  }

  // Seat the shot: its velocity pair at +0x0A..+0x0D (`ld (ix+0x0a),e` .. `ld (ix+0x0d),b`), sprite code
  // 0x4D and attribute 0x62, and its head counted down from 0x00 to 0xFF so the slot is live. Last,
  // re-arm the shared cooldown from BANK_LAUNCH_COOLDOWN_PERIOD (0xA814) [seen] (0x47AC-0x47AF), which
  // spaces the ship's shots out.
  mem8[atRecord(0x0a)] = alongFirstAxis;
  mem8[atRecord(0x0b)] = alongFirstAxis >> 8;
  mem8[atRecord(0x0c)] = alongSecondAxis;
  mem8[atRecord(0x0d)] = alongSecondAxis >> 8;
  mem8[atEntry(0x01)] = 0x4d;
  mem8[atEntry(FIRST_ATTRIBUTE)] = 0x62;
  mem8[atRecord(STATE)] = u8(mem8[atRecord(STATE)] - 1); // 0x00 -> 0xFF: the entry is live
  mem8[BANK_LAUNCH_COOLDOWN] = mem8[BANK_LAUNCH_COOLDOWN_PERIOD]; // re-arm the cooldown
}
