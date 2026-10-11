// SPDX-License-Identifier: GPL-3.0-only
/** destroyEraObjectsAndPlayerOnContact — destroy every target the player's ship touches, and the ship with it, and post the score for each.
 *
 * The player's ship is not a parameter: its state byte and its two screen coordinates live at fixed
 * cells, so this sweeps a caller's run of target slots against that one object. It returns at
 * once unless the ship's state byte holds the live code. Otherwise every slot of the run is
 * tested: the target must itself be live, and both of its coordinates must fall inside a box
 * centred on the ship — one half-width and one width, from the caller, shared by both axes
 * and measured as a wrapped distance. A target that passes is destroyed together with the
 * ship, both state bytes taking the same destroyed code, and the chained hit score is posted
 * for that single kill. The sweep does NOT stop there and does not re-read the ship's state,
 * so the ship can take several targets in one pass and is paid for each. The record cursor
 * advances a record at a time WITHOUT leaving its page; the entry cursor advances a stride.
 * LIVE-OUT: memory, plus the two cursors left where the sweep ended (record in DE, entry in IY).
 *
 * The cursor pair is also returned as { target, entry }, each wrapped to sixteen bits, so the
 * final mark takes the record page/index and entry pointer from the return. On the early
 * ship-not-live exit neither register is written and the pair echoes the inputs, so the
 * caller's mark sees the un-advanced cursor.
 * ROM 0x5121-0x5151. Grounding: [seen] (names.js ROUTINES 0x5121). */

import { u8, u16 } from "../../../core/int.js";
import { postChainedHitScore } from "./postChainedHitScore.js";
import { PLAYER_ENTRY, PLAYER_SPRITE_Y, PLAYER_STATE } from "./names.js";
import { within, nextRecordInPage } from "./objectGeometry.js";

const STATE = 0;
const LIVE = 255;
const DESTROYED = 240;
const ENTRY_STRIDE = 2;
const ENTRY_SECOND_AXIS = 49;

export function destroyEraObjectsAndPlayerOnContact(m, target = m.regs.de, entry = m.regs.iy, targets = m.regs.b, reach = m.regs.l, span = m.regs.h) {
  const { mem8, regs } = m;
  // Ship not live: neither cursor moves (declared live-out); the tuple echoes the seated inputs.
  if (mem8[PLAYER_STATE] !== LIVE) return { target: u16(target), entry: u16(entry) };

  let targetCursor = target;
  let entryCursor = entry;
  let left = targets;
  do {
    if (
      mem8[targetCursor + STATE] === LIVE &&
      within(mem8[PLAYER_ENTRY], mem8[entryCursor], reach, span) &&
      within(
        mem8[PLAYER_SPRITE_Y],
        mem8[entryCursor + ENTRY_SECOND_AXIS],
        reach,
        span,
      )
    ) {
      mem8[PLAYER_STATE] = DESTROYED;
      mem8[targetCursor + STATE] = DESTROYED;
      postChainedHitScore(m);
    }
    entryCursor = u16(entryCursor + ENTRY_STRIDE);
    targetCursor = nextRecordInPage(targetCursor);
    left = u8(left - 1);
  } while (left !== 0);

  // The cursors where the sweep ended: left in DE and IY, as the ROM leaves them, and returned.
  return { target: u16(regs.de = targetCursor), entry: u16(regs.iy = entryCursor) };
}
