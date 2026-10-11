// SPDX-License-Identifier: GPL-3.0-only
/** fireAndSweepPlayerShots — on a fire-button rising edge arm a three-shot burst; while a shot is owed (in the attract demo,
 * whenever) and the fire-rate cooldown has run out, seed one shot into a free slot of the
 * six-slot player-shot bank, aimed along the ship heading; then move every live shot by the world scroll,
 * dropping any that leaves the field or whose head byte is stale.
 *
 * ROM 0x23E3-0x2508 (lift: translated/loc_23e3.js). Grounding: [seen] (names.js ROUTINES 0x23E3).
 *
 * ROLE IN THE MACHINE. The whole of the player's gun. The round engine calls it right after the
 * player's own frame (serviceRoundThenResolvePlayerState; flyEnemyFreeLeadInThenStepSequence
 * also calls it), so a shot always moves by the scroll the ship
 * has just set. The player's shots are NOT sprites: each lives in a 16-byte record of
 * PLAYER_SHOT_ARRAY 0xAA80 [seen] holding its whole 8.8 position, and is drawn as a two-by-two
 * block of character cells by queueTileStampForObject (mechanisms.md, "The player's shots").
 *
 * Shot record layout used here: +0 head byte (0 free, 0xFF live, anything else marked -- e.g. the
 * 0xF0 destroyTargetsHitByShots writes on a hit); +3/+4 the first coordinate as an 8.8 word
 * (fraction, whole); +5/+6 the second; +10/+11 and +12/+13 the two per-frame seeds.
 * LIVE-OUT: memory. */

import { u8, u16 } from "../../../core/int.js";
import { readPlayerControls } from "./readPlayerControls.js";
import { requestPlayerShotSound } from "./requestPlayerShotSound.js";
import { fetchWideTableWord } from "./fetchWideTableWord.js";
import { queueTileStampForObject } from "./queueTileStampForObject.js";
import { FIRE_BUTTON_EDGE_SHIFT, PLAYER_HEADING, PLAYER_SHOT_ARRAY, PLAYER_STATE, PLAY_ACTIVE, ROUND_TRANSITION_HOLD, SHOT_BURST_PENDING, SHOT_SPAWN_COOLDOWN, WORLD_SCROLL_X, WORLD_SCROLL_Y, PLAYER_SHOT_SLOT_STRIDE_WORD, PLAYER_SHOT_SPAWN_POSITION_TABLE } from "./names.js";

// Six shot records of 16 bytes each (`ld b,0x06`, `ld de,0x0010` in the sweep at 0x24A4/0x24F3).
const SLOT_COUNT = 6;
const RECORD_STRIDE = 16;

// Record offsets (see the header).
const OCC = 0;
const AXIS1 = 3;
const AXIS2 = 5;
const SEED1 = 10;
const SEED2 = 12;

export function fireAndSweepPlayerShots(m) {
  const { mem8, mem16 } = m;

  /* Step 1 -- is firing possible at all? (0x23E3-0x23F1) Only while PLAYER_STATE 0xA800 [seen]
   * reads 0xFF (alive) and ROUND_TRANSITION_HOLD 0xACC6 [seen] is clear. Otherwise the fire
   * button is not even sampled and only the sweep runs, so shots already in flight keep moving. */
  if (mem8[PLAYER_STATE] !== 0xff) return sweepSlots(m);
  if (mem8[ROUND_TRANSITION_HOLD] !== 0) return sweepSlots(m);

  /* Step 2 -- rising-edge detect (0x23F1-0x2409). The fire bit (bit 4 of the control word
   * readPlayerControls hands back) is shifted into bit 0 of FIRE_BUTTON_EDGE_SHIFT 0xA98E [seen];
   * its low two bits read 01 -- released last frame, pressed now -- only on the frame of a new
   * press. That press loads SHOT_BURST_PENDING 0xAA81 [seen] with 3: one press owes a three-shot
   * burst, and holding the button does not re-arm it. */
  const controls = readPlayerControls(m);
  mem8[FIRE_BUTTON_EDGE_SHIFT] = u8((mem8[FIRE_BUTTON_EDGE_SHIFT] << 1) | ((controls >> 4) & 1));
  if ((mem8[FIRE_BUTTON_EDGE_SHIFT] & 0x03) === 1) mem8[SHOT_BURST_PENDING] = 3;

  /* Step 3 -- may a shot leave this frame? (0x240C-0x241A) During credited play (PLAY_ACTIVE
   * 0xAD30 [seen] set) a shot needs an owed burst; with PLAY_ACTIVE clear the burst count is not
   * consulted, so the attract demo fires whenever the cooldown allows. In both cases
   * SHOT_SPAWN_COOLDOWN 0xAA82 [seen] must have run out. */
  if (mem8[PLAY_ACTIVE] !== 0 && mem8[SHOT_BURST_PENDING] === 0) return sweepSlots(m);
  if (mem8[SHOT_SPAWN_COOLDOWN] !== 0) return sweepSlots(m);

  /* Step 4 -- take the first free record (0x241E-0x242E). The stride comes from a ROM word at
   * 0x0D46 that holds 16 (PLAYER_SHOT_SLOT_STRIDE_WORD). If all six are busy nothing is launched:
   * no sound, and neither the burst nor the cooldown is spent. */
  let slot = PLAYER_SHOT_ARRAY;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (mem8[slot] === 0) { spawnIntoFreeSlot(m, slot); break; }
    slot = u16(slot + mem16[PLAYER_SHOT_SLOT_STRIDE_WORD]);
  }
  return sweepSlots(m);
}

/* Launch one shot into the free record at SLOT (0x2449-0x2496). */
function spawnIntoFreeSlot(m, slot) {
  const { mem8, mem16 } = m;
  requestPlayerShotSound(m);

  /* The shot's velocity. Each seed is -4 x one component of the world scroll (`xor a`,
   * `sbc hl,bc`, `add hl,hl` twice). The world scroll is the negated ship velocity (names.js
   * WORLD_SCROLL_Y), so the seed is four times the ship's velocity: the shot flies the way the
   * ship is flying, four times as fast through the world. */
  mem16[slot + SEED1] = u16(-4 * mem16[WORLD_SCROLL_Y]);
  mem16[slot + SEED2] = u16(-4 * mem16[WORLD_SCROLL_X]);

  /* The shot's starting point. PLAYER_HEADING 0xA802 [seen] is rounded to the nearest of 32
   * directions ((heading + 4) >> 3) and used to fetch a word from the 32-entry ROM table at 0x2771
   * (PLAYER_SHOT_SPAWN_POSITION_TABLE). Its two bytes are the WHOLE parts of the two coordinates --
   * a muzzle position by direction, not a velocity. */
  const muzzle = fetchWideTableWord(m, PLAYER_SHOT_SPAWN_POSITION_TABLE, (u8(mem8[PLAYER_HEADING] + 4) >> 3) & 0x1f);

  /* Seat the record: the head goes 0 -> 0xFF (live, `dec (ix+0x00)`), both fractions start at
   * zero and the whole parts take the muzzle bytes (low byte first axis, high byte second). */
  mem8[slot + OCC] = u8(mem8[slot + OCC] - 1);
  mem8[slot + AXIS1] = 0;
  mem8[slot + AXIS1 + 1] = muzzle;
  mem8[slot + AXIS2] = 0;
  mem8[slot + AXIS2 + 1] = muzzle >> 8;

  /* Spend one shot of the burst and start the six-frame fire-rate cooldown. */
  mem8[SHOT_BURST_PENDING] = u8(mem8[SHOT_BURST_PENDING] - 1);
  mem8[SHOT_SPAWN_COOLDOWN] = 6;
}

/* Move every live shot and draw it (0x2496-0x2508). Runs on every call, fired or not. */
function sweepSlots(m) {
  const { mem8, mem16 } = m;

  /* Wind the cooldown down by one. Counting the launch frame's own decrement, a new shot can
   * leave at most once every six calls (mechanisms.md). */
  if (mem8[SHOT_SPAWN_COOLDOWN] !== 0) mem8[SHOT_SPAWN_COOLDOWN] = u8(mem8[SHOT_SPAWN_COOLDOWN] - 1);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = PLAYER_SHOT_ARRAY + i * RECORD_STRIDE;

    /* A zero head is a free record: skip it. Any head other than 0xFF has been marked by something
     * else (a hit writes 0xF0), so the record is freed on the spot -- this is how a spent shot
     * leaves the field. */
    const head = mem8[slot + OCC];
    if (head === 0) continue;
    if (u8(head + 1) !== 0) { cullSlot(m, slot); continue; }

    /* First coordinate: add the seed plus the current WORLD_SCROLL_Y component as one 8.8 word,
     * so sub-pixel motion accumulates in the fraction. Since the seed is -4 x the scroll and the
     * scroll is added again, a shot on a steady course moves across the screen at three times the
     * ship's velocity. A whole part in 0xF0-0xFF is off the field: free the record. */
    const x = u16(u16(mem16[slot + SEED1] + mem16[WORLD_SCROLL_Y]) + mem16[slot + AXIS1]);
    if (u8((x >> 8) + 0x10) < 0x10) { cullSlot(m, slot); continue; }
    mem16[slot + AXIS1] = x;

    /* Second coordinate, the same with WORLD_SCROLL_X; this axis is off the field in 0xF8-0xFF or
     * 0x00-0x0F. */
    const y = u16(u16(mem16[slot + SEED2] + mem16[WORLD_SCROLL_X]) + mem16[slot + AXIS2]);
    if (u8((y >> 8) + 0x08) < 0x18) { cullSlot(m, slot); continue; }
    mem16[slot + AXIS2] = y;

    /* Still on the field: queue its two-by-two character block onto the deferred write list,
     * painted at the next vertical blank (mechanisms.md). */
    queueTileStampForObject(m, slot);
  }
}

/* Free a shot record (0x24FC-0x2506): clear the head and both whole parts. */
function cullSlot(m, slot) {
  const { mem8 } = m;
  mem8[slot + OCC] = 0;
  mem8[slot + AXIS1 + 1] = 0;
  mem8[slot + AXIS2 + 1] = 0;
}
