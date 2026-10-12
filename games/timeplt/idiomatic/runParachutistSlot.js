// SPDX-License-Identifier: GPL-3.0-only
/**
 * runParachutistSlot — ROM 0x47B3 [seen]
 *
 * WHAT IT IS. The per-pass manager of the single parachutist -- the rescue object that drifts
 * across the sky and pays a bonus when the player's ship touches it (grounded under MAME as the
 * canopy + bonus object, removed by a negative control; names.js). Its state record is
 * PARACHUTIST_RECORD 0xA8F0 and its sprite entry PARACHUTIST_ENTRY 0xAA2E (both [seen]); the ROM
 * seats them in IX and IY. serviceRoundThenResolvePlayerState calls it once per round-engine pass.
 *
 * ROLE IN THE MACHINE. The slot's state byte (record +0) is a small state machine:
 *   0x00       free -- hand to the spawner, which places it at the field edge ahead;
 *   0xFF       in flight -- fly it along its stored velocity, retire it on a retire line, else
 *              step its flight shape;
 *   0x10       post the next bonus rung;
 *   0x3C..0xFE show the award (the pickup mark written by the collision pass is 0xF0);
 *   anything else a countdown, retired when it reaches zero.
 * Every state but 0x00 and 0xFF first drifts with the world.
 * In era 4 there is no parachutist at all, and the routine returns at once.
 *
 * LIVE-OUT: memory.
 */

import { ERA_INDEX, FRAME_TICK, PARACHUTIST_ENTRY, PARACHUTIST_RECORD, PARACHUTIST_FLIGHT_SHAPE_TABLE } from "./names.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { driftWithWorldScroll } from "./driftWithWorldScroll.js";
import { flyAlongStoredVelocity } from "./flyAlongStoredVelocity.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";
import { spawnAtEdgeAhead } from "./spawnAtEdgeAhead.js";
import { postNextParachutistBonus } from "./postNextParachutistBonus.js";
import { showParachutistAward } from "./showParachutistAward.js";
import { retireSlotIntoCooldown } from "./retireSlotIntoCooldown.js";

// ERA_INDEX 0xAD04 value of the era with no parachutist (`cp 0x04` / `ret z` at 0x47B6).
const ERA_WITH_NO_PARACHUTISTS = 4;

// The state-byte values the dispatch below tests (ROM 0x47C4, 0x47C8, 0x47FA, 0x47FF).
const FREE_SLOT = 0x00;
const IN_FLIGHT = 0xff;
const POST_BONUS_STATE = 0x10;
const SHOW_AWARD_FROM = 0x3c;

// Sprite-entry offsets: the shape byte at +1 and the attribute byte at +0x30, which the in-flight
// arm fills with a fixed 0x75 (`ld (iy+0x30),0x75`).
const SHAPE_OFFSET = 0x01;
const ATTRIBUTE_OFFSET = 0x30;
const FLIGHT_ATTRIBUTE = 0x75;

export function runParachutistSlot(m) {
  const { mem8 } = m;
  // Era 4 has no parachutist: nothing to run.
  if (mem8[ERA_INDEX] === ERA_WITH_NO_PARACHUTISTS) return;

  // A free slot goes to spawnAtEdgeAhead (0x4853 [seen]) -- it respawns on a cooldown, on alternate
  // frames, at the edge the player's heading points toward. The ROM reaches it by `jp z,0x4853`.
  const state = mem8[PARACHUTIST_RECORD];
  if (state === FREE_SLOT) return spawnAtEdgeAhead(m, PARACHUTIST_RECORD, PARACHUTIST_ENTRY);

  // Any value other than 0 and 0xFF (ROM 0x47F2 onward): the parachutist is no longer in flight, so it
  // just drifts with the world scroll (driftWithWorldScroll, 0x2B60 [seen]), then --
  //   0x10: post the next rung of the rescue award (postNextParachutistBonus, 0x4831 [seen]);
  //   0x3C and up: start its exit, swapping the sprite to the award glyph (showParachutistAward,
  //                0x4809 [seen]);
  //   otherwise: count down, and at zero retire it into its respawn cooldown
  //                (retireSlotIntoCooldown, 0x48AD [seen]).
  if (state !== IN_FLIGHT) {
    driftWithWorldScroll(m, PARACHUTIST_RECORD, PARACHUTIST_ENTRY);
    if (state === POST_BONUS_STATE) return postNextParachutistBonus(m, PARACHUTIST_RECORD);
    if (state >= SHOW_AWARD_FROM) return showParachutistAward(m, PARACHUTIST_RECORD, PARACHUTIST_ENTRY);
    mem8[PARACHUTIST_RECORD] = state - 1;
    if (mem8[PARACHUTIST_RECORD] !== 0) return;
    return retireSlotIntoCooldown(m, PARACHUTIST_RECORD, PARACHUTIST_ENTRY);
  }

  // In flight (0xFF): one step along the velocity stored in its record, which also carries it with the
  // world (flyAlongStoredVelocity, 0x3E05 [seen]). On reaching a retire line (hasReachedRetireLine,
  // 0x2B83 [seen], carry set in the ROM) it is taken out into its cooldown; otherwise its sprite takes
  // the next of the eight entries (shapes 0-3 and back) from PARACHUTIST_FLIGHT_SHAPE_TABLE (0x47EA), chosen by bits 4-6
  // of FRAME_TICK 0xA980 [seen] -- four `rrca`s and `and 0x07`, so the shape changes every 16 frames.
  flyAlongStoredVelocity(m, PARACHUTIST_RECORD, PARACHUTIST_ENTRY);
  if (hasReachedRetireLine(m, PARACHUTIST_ENTRY)) return retireSlotIntoCooldown(m, PARACHUTIST_RECORD, PARACHUTIST_ENTRY);
  mem8[PARACHUTIST_ENTRY + SHAPE_OFFSET] = fetchTableByte(m, PARACHUTIST_FLIGHT_SHAPE_TABLE, (mem8[FRAME_TICK] >> 4) & 7);
  mem8[PARACHUTIST_ENTRY + ATTRIBUTE_OFFSET] = FLIGHT_ATTRIBUTE;
}
