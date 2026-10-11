// SPDX-License-Identifier: GPL-3.0-only
/** hasReachedRetireLine — true once an actor's screen position lands on a retire line.
 * One line per axis; a hit is the line or either neighbouring pixel, three values wide, which
 * lets a coordinate moving up to three pixels a frame land ON the line rather than step over
 * it. Both coordinates wrap at 256, so the window is a wrapped distance, not a range.
 * LIVE-OUT: the boolean, returned; memory and every register untouched.
 *
 * ROM 0x2B83-0x2B92 (frozen lift translated/loc_2b83.js). Grounding: [seen] (names.js ROUTINES 0x2b83:
 * "answer whether an actor has drifted onto either of two fixed retire lines, within a narrow wrapped
 * window, which is what makes its caller free the slot").
 *
 * Role in the machine: the common off-field test (mechanisms.md, "Retire lines and edge tests"). The
 * craft services, the chasers, the parachutist and serviceSlotByHeadByte all ask it; the callers that
 * act on a yes free the object's slot, though at least one path discards the answer (names.js "why").
 * Objects leave play by their SCREEN position -- the whole bytes of their sprite entry -- because the
 * world itself has no edge.
 *
 * Why these two lines: resetPlayfieldAndArmNewRound pins the player's own sprite entry at (0x84, 0x78)
 * and nothing that flies the ship moves it, so 0xF8 and 0x04 are each exactly 0x80 -- half the wrapping
 * coordinate range -- away from the player's: its antipode in a coordinate that wraps at 256 (names.js "why").
 *
 * Parameter: entry — the address of the actor's sprite entry; the ROM hands it in IY. The entry's +0
 * byte is its native-X coordinate (the display's vertical under ROT90) and its +0x31 byte its native-Y
 * one (the display's horizontal); see WORLD_SCROLL_X/Y in names.js.
 */

import { u8, u16 } from "../../../core/int.js";

// Offset of the entry's native-Y coordinate byte (the display's horizontal) from the entry's first byte; the ROM reads
// it as (iy+0x31).
const SCREEN_ROW_CELL = 49;
// The retire line tested on the +0 (native-X) byte and the one tested on the +0x31 (native-Y) byte.
const RETIRE_COLUMN = 4;
const RETIRE_ROW = 248;

// "Within one of the line": shift so line-1 lands on 0, then an unsigned eight-bit compare against 3
// accepts line-1, line and line+1. The ROM spells the two instances as `add a,0x09 / cp 0x03`
// (row 247..249) and `sub 0x03 / cp 0x03` (column 3..5); the carry from the `cp` is its answer.
const atLine = (coord, line) => u8(coord - line + 1) < 3;

export function hasReachedRetireLine(m, entry = m.regs.iy) {
  const { mem8 } = m;
  // The ROM tests the row first and returns at once (`ret c`) on a hit; only when the row misses
  // does it read and test the column. `||` keeps that order, and the column test's result is the
  // answer when the row test fails.
  const reached =
    atLine(mem8[u16(entry + SCREEN_ROW_CELL)], RETIRE_ROW) ||
    atLine(mem8[entry], RETIRE_COLUMN);
  return reached;
}
