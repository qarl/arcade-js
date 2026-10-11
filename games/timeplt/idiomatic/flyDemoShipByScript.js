// SPDX-License-Identifier: GPL-3.0-only
/** flyDemoShipByScript — the demo pilot's auto-steer. A countdown byte carries a dwell in its low six bits and
 *  a two-bit turn command in its top two. Each pass ticks the dwell and keeps the byte; when it is
 *  spent (zero or one) the pass steps a script pointer, reloads from the next entry and looks again,
 *  so a run of spent entries is skipped at once. The surviving command nudges the heading one way,
 *  the other, or not at all, then hands off to the world-scroll mover. LIVE-OUT: memory. */
//
// ROM 0x214B-0x218B (lift: translated/loc_214b.js). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. In the attract demo nobody holds the joystick, yet the ship must fly about
// convincingly. dispatchPlayerFrameByState (0x1EDF) sends a live ship (state byte 0xFF) here while
// PLAY_ACTIVE (0xAD30) is clear, instead of reading the controls. The pilot follows a byte-coded
// script in ROM, chosen before the demo starts (mechanisms.md, "Flying"); each script byte says
// "for this many passes of the player's handler, turn this way" (or hold). When it turns, it moves
// the heading directly by 3 steps per pass,
// and then ends in the same world-scroll routine the live ship uses.
//
// LIVE-OUT: DEMO_SCRIPT_DWELL (0xADF2), the script cursor DEMO_SCRIPT_POINTER_LO/HI (0xADF3/0xADF4),
// PLAYER_HEADING (0xA802) -- all [seen] -- and whatever scrollWorldAtTheEraPace writes.

import { u8, u16 } from "../../../core/int.js";
import { scrollWorldAtTheEraPace } from "./scrollWorldAtTheEraPace.js";
import { DEMO_SCRIPT_DWELL, DEMO_SCRIPT_POINTER_LO, PLAYER_HEADING } from "./names.js";

// Low six bits of the dwell byte: the pass count (`and 0x3f` at 0x2150).
const DWELL_BITS = 0x3f;
// How far one pass's turn moves the heading, out of 256 steps round the circle (`sub 0x03` /
// `add a,0x03`).
const TURN_STEP = 3;

export function flyDemoShipByScript(m) {
  const { mem8, mem16 } = m;

  // STEP 1 -- TICK THE DWELL, FETCHING NEW SCRIPT BYTES AS NEEDED (0x214B-0x2169).
  let command;
  for (;;) {
    // The whole byte is kept: the count in bits 0-5 and the steering command in bits 6-7.
    const countByte = mem8[DEMO_SCRIPT_DWELL];
    // Still running (count 2 or more): decrement the WHOLE byte and store it back. Because the low
    // six bits are at least 2, the borrow never reaches the command bits, so the command survives.
    if ((countByte & DWELL_BITS) > 1) {
      command = u8(countByte - 1);
      mem8[DEMO_SCRIPT_DWELL] = command;
      break;
    }
    // Spent (count 0 or 1): advance the little-endian script cursor by one and load the next script
    // byte PLUS ONE -- the same "+1" the demo start uses -- so that the tick taken when the loop goes
    // round again lands the stored byte back on the script's own value. A script byte whose low bits
    // are zero reloads as 1, which is spent again at once, so it is skipped within this same frame.
    const next = u16(mem16[DEMO_SCRIPT_POINTER_LO] + 1);
    mem16[DEMO_SCRIPT_POINTER_LO] = next;
    mem8[DEMO_SCRIPT_DWELL] = u8(mem8[next] + 1);
  }

  // STEP 2 -- STEER (0x216A-0x218B). The top two bits of the ticked byte are the turn command
  // (`rlca` twice then `and 0x03`): 00 holds the heading, 01 turns it down 3, and 10 or 11 turns it
  // up 3. The heading is a full byte, so the turn wraps round the circle.
  const turn = (command >> 6) & 3;
  if (turn === 1) mem8[PLAYER_HEADING] = u8(mem8[PLAYER_HEADING] - TURN_STEP);
  else if (turn !== 0) mem8[PLAYER_HEADING] = u8(mem8[PLAYER_HEADING] + TURN_STEP);

  // STEP 3 -- FLY (tail `jp 0x1F42`). Move the world past the ship along the (possibly new) heading
  // at the era's pace, exactly as for a player-flown ship.
  return scrollWorldAtTheEraPace(m, mem8[PLAYER_HEADING]);
}
