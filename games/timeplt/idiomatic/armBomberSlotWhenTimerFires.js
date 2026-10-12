// SPDX-License-Identifier: GPL-3.0-only
/**
 * armBomberSlotWhenTimerFires — ROM 0x3C25 [seen]
 *
 * WHAT IT IS. The launch step of the 1940 era's middle-size bomber (the 1,500-point craft that dies on
 * the fourth hit, per mechanisms.md). Its sole caller, serviceEra1BomberObject (0x3B5F), runs only in
 * era 1 and dispatches here while the object's record head byte is 0 (idle). Per names.js this is
 * the bomber, not the Mother-Ship: it seeds the hit counter with three (it absorbs three hits and
 * dies on the fourth) where the Mother-Ship's is seeded with seven.
 *
 * ROLE. On even frames only, tick the slot's arming countdown; when it reaches zero and the
 * Mother-Ship is not already armed, arm the slot: pick a screen-edge position from the player's
 * heading, snap the heading to a single facing bit, fetch the velocity pair for that facing, write
 * position, facing and velocity into the slot, set the shared hit count, and mark the slot live.
 *
 * PARAMETERS: record = the object's record (ERA_OBJECT_RECORD_SLOT0 0xA8C0 from the caller);
 * entry = its sprite entry (ERA_OBJECT_ENTRY_SLOT0 0xAA28).
 *
 * LIVE-OUT: memory.
 */

import { u8, u16 } from "../../../core/int.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { loc_5942 } from "./loc_5942.js";
import { FRAME_TICK, BOMBER_HITS_TO_ABSORB, MOTHER_SHIP_ARMED, PLAYER_HEADING, HEADING_EDGE_POSITION_TABLE } from "./names.js";

export function armBomberSlotWhenTimerFires(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;

  // Pace: FRAME_TICK (0xA980) counts vblanks; testing its low bit runs the countdown only on passes
  // that find it even (ROM 0x3C25: and 0x01 / ret nz).
  if (mem8[FRAME_TICK] & 0x01) return;

  // The idle bomber's arming delay lives at record +0x0E. Tick it; until it reaches zero the
  // bomber stays idle (ROM 0x3C2B: dec (ix+0x0e) / jp z).
  const countdown = u16(record + 0x0e);
  mem8[countdown] = u8(mem8[countdown] - 1);
  if (mem8[countdown] !== 0) return;
  // The delay has run out, but no bomber launches while this round's Mother-Ship has been armed
  // (MOTHER_SHIP_ARMED 0xAD0D, all-ones or zero).
  if (mem8[MOTHER_SHIP_ARMED] !== 0) return;

  // The launch is keyed to where the player is pointing: PLAYER_HEADING (0xA802) is a full byte,
  // 256 steps of the circle.
  const heading = mem8[PLAYER_HEADING];
  // When the heading lies within 8 steps of 0x00 or 0x80 ((heading + 8) & 0x7F below 0x10), the
  // table index is moved 16 steps off it -- forward when FRAME_TICK bit 3 is set, back otherwise
  // (ROM 0x3C75-0x3C82: bit 3,c / neg / add a,b). Elsewhere the heading is used as is.
  let index = heading;
  if (((heading + 8) & 0x7f) < 0x10) {
    index = u8(heading + (mem8[FRAME_TICK] & 0x08 ? 0x10 : u8(-0x10)));
  }

  // Edge-position record: rotate the heading to an even table offset, take its two bytes.
  // Two rrca and mask 0x3E turn the 256-step index into one of 32 sectors times two, the offset
  // of a two-byte record in HEADING_EDGE_POSITION_TABLE (0x3C84, shared with loc_43f0). The first
  // byte goes to sprite entry +0x31, the second to entry +0x00 (ROM 0x3C44-0x3C54, via rst 0x08).
  const positionIndex = ((index >> 2) | (index << 6)) & 0x3e;
  mem8[u16(entry + 0x31)] = fetchTableByte(m, HEADING_EDGE_POSITION_TABLE, positionIndex);
  const positionEntry = u16(HEADING_EDGE_POSITION_TABLE + positionIndex);
  mem8[u16(entry + 0x00)] = mem8[u16(positionEntry + 1)];

  // The bomber's own heading (record +0x02) is snapped to one of two opposite directions: 0x00
  // or 0x80, the top bit of the RAW player heading plus 0xC0 (ROM 0x3C55-0x3C5C).
  const facing = u8(heading + 0xc0) & 0x80;
  mem8[u16(record + 0x02)] = facing;

  // loc_5942 looks that facing up in the bottom-rung velocity table (0x59D7) and hands back a
  // pair of 16-bit components; they are stored little-endian at record +0x0A/+0x0B and
  // +0x0C/+0x0D, the bomber's per-step motion (ROM 0x3C5C-0x3C6B).
  const [alongFirstAxis, alongSecondAxis] = loc_5942(m, facing);
  mem8[u16(record + 0x0a)] = alongFirstAxis;
  mem8[u16(record + 0x0b)] = alongFirstAxis >> 8;
  mem8[u16(record + 0x0c)] = alongSecondAxis;
  mem8[u16(record + 0x0d)] = alongSecondAxis >> 8;

  // BOMBER_HITS_TO_ABSORB (0xA8DC) is how many more hits the big two-slot object can absorb before it
  // dies: three here. Finally the record head becomes 0xFF, the "live" marker, so the caller's
  // next dispatch runs the two-tile move (flyBomberThenTryAimedShot) instead of this
  // arming step.
  mem8[BOMBER_HITS_TO_ABSORB] = 3;
  mem8[u16(record + 0x00)] = 0xff;
}
