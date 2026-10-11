// SPDX-License-Identifier: GPL-3.0-only
/** spawnAtEdgeAhead — on a cooldown, and only on passes that find the frame tick's bit 0 set, place a free slot at the
 * field-edge position the player's current heading selects, zero one velocity word and seed the
 * other with 0x40, and mark it live.
 *
 * ROLE. A singleton spawner: its caller seats one dedicated object record (IX) and that object's
 * sprite entry (IY) before calling this (mechanisms.md derives it as the parachutist's manager).
 * Three things hold it off:
 * MOTHER_SHIP_ARMED must read zero (the parachutist spawn refuses outright while the Mother-Ship
 * is up), bit 0 of FRAME_TICK must be set (so it acts only on passes that find that bit set), and the record's own
 * delay byte is counted down on each pass it does act and only lets the placing happen when it
 * reaches zero. The heading is rounded to the nearer of sixteen equal sectors and selects a
 * coordinate pair from EDGE_SPAWN_COORD_TABLE -- positions near a field border, lying roughly in
 * the direction the player is flying, so the object appears ahead of the ship. The pair goes to
 * the sprite entry, four working bytes of the record are reset, and the record is marked live
 * LAST, so the slot is never live with stale contents.
 *
 * ROM 0x4853-0x488C (frozen lift translated/loc_4853.js). Grounding: [seen] (names.js ROUTINES
 * 0x4853). LIVE-OUT: memory -- the record's delay, reset fields and state, and the entry's two
 * coordinate bytes.
 */

import { u8, u16 } from "../../../core/int.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { FRAME_TICK, MOTHER_SHIP_ARMED, PLAYER_HEADING, EDGE_SPAWN_COORD_TABLE } from "./names.js";

// FRAME_TICK advances once per vblank; its low bit alternates frame to frame.
const EVERY_OTHER_FRAME = 0x01;

// Offsets into the object record (IX): the cooldown byte, the state byte (0xFF = live) and the
// four working bytes the ROM stores constants into when it places the object (+0x0C gets 0x40).
const DELAY = 0x0e;
const STATE = 0x00;
const LIVE = 0xff;
const RESET_FIELDS = [[0x0a, 0], [0x0b, 0], [0x0c, 64], [0x0d, 0]];

// A heading is a full byte, 256 steps round the circle; the table has one pair per sixteenth.
const SECTORS = 16;
const STEPS_PER_SECTOR = 256 / SECTORS;
const PAIR_WIDTH = 2;

// Offsets into the sprite entry (IY) that receive the pair -- the whole-pixel coordinates, +0x31
// native Y and +0x00 native X (mechanisms.md, camera section). Byte 0 of the pair goes to +0x31,
// byte 1 to +0x00 (ROM 0x4870 and 0x4875).
const FIRST_COORDINATE = 0x00;
const SECOND_COORDINATE = 0x31;

export function spawnAtEdgeAhead(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;

  // Gate 1: nothing spawns while the Mother-Ship slots are taken (ROM `ret nz` at 0x4857).
  if (mem8[MOTHER_SHIP_ARMED] !== 0) return;
  // Gate 2: act only on frames where FRAME_TICK is odd (ROM `and 0x01 / ret z`).
  if ((mem8[FRAME_TICK] & EVERY_OTHER_FRAME) === 0) return;

  // Gate 3: the cooldown. `dec (ix+0x0e)` -- the byte is stored decremented every acting pass,
  // and the spawn goes ahead only on the pass it hits zero.
  const delay = u8(mem8[u16(record + DELAY)] - 1);
  mem8[u16(record + DELAY)] = delay;
  if (delay !== 0) return;

  // Round the player's heading to the nearest sector: add half a sector (0x08) and keep the top
  // four bits. The ROM does this as `add a,0x08`, three `rrca`s and `and 0x1e`, which yields the
  // sector already doubled into a byte offset into the two-byte pair table.
  const sector = u8(mem8[PLAYER_HEADING] + STEPS_PER_SECTOR / 2) >> 4;
  const entryAddr = u16(EDGE_SPAWN_COORD_TABLE + sector * PAIR_WIDTH);
  // Read the pair: the first byte through the table-fetch restart at 0x0008 (fetchTableByte), the
  // second from the byte after it (`inc hl / ld a,(hl)`), and seat them in the sprite entry.
  mem8[u16(entry + SECOND_COORDINATE)] = fetchTableByte(m, EDGE_SPAWN_COORD_TABLE, sector * PAIR_WIDTH);
  mem8[u16(entry + FIRST_COORDINATE)] = mem8[u16(entryAddr + 1)];

  // Reset the record's working bytes, then arm the slot. The state byte is written last (ROM
  // 0x4888), so nothing that tests "is this slot live" can see it before it is fully set up.
  for (const [field, value] of RESET_FIELDS) mem8[u16(record + field)] = value;
  mem8[u16(record + STATE)] = LIVE;
}
