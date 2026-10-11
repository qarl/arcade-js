// SPDX-License-Identifier: GPL-3.0-only
/** closeOneTurnOfTheFreeSlotSearch — step both cursors BACKWARD one whole element and strike one off
 * the count; while any remain, hand the stepped cursors and the count back to the body that works one
 * slot, else just return. The cursors and the count travel as arguments from turn to turn and are
 * dead once the search ends. LIVE-OUT: memory.
 *
 * ROM 0x3847-0x3854 (frozen lift translated/loc_3847.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. The loop tail of the search for a free enemy slot. The body,
 * spawnEnemyIntoFreeSlotElseStepSearch (0x37D6), looks at one slot: a free slot is claimed and
 * stocked and the search ends there; an OCCUPIED slot jumps here (`jp nz,0x3847` at 0x37DA is the
 * only reference to this address in the image). So every turn closed here is a turn that found
 * its slot taken, and the loop walks the slot bank DOWNWARD until a free slot is found or the
 * count runs out, in which case the search ends having filled nothing.
 *
 * Its near-twin closeOneTurnOfTheSlotSweep (0x410B) steps its cursors FORWARD and ends in a real
 * `djnz`; this one steps backward and is `dec b / jp nz`, so the jump reads the decrement's flags.
 */

import { spawnEnemyIntoFreeSlotElseStepSearch } from "./spawnEnemyIntoFreeSlotElseStepSearch.js";
import { u8, u16 } from "../../../core/int.js";

// The two banks walked in lockstep: object records are sixteen bytes apart (ROM `ld de,0xfff0 /
// add ix,de`, i.e. minus 16) and their sprite entries two bytes apart (`dec iy / dec iy`).
const RECORD_STRIDE = 16;
const ENTRY_STRIDE = 2;

// ix = the current object record, iy = its sprite entry, b = slots still to try; the body passes
// all three in and they come back to it here, stepped.
export function closeOneTurnOfTheFreeSlotSearch(m, record = m.regs.ix, entry = m.regs.iy, turnsLeft = m.regs.b) {
  // Strike one off the count (ROM `dec b` at 0x3850).
  const remaining = u8(turnsLeft - 1); // a count of zero wraps, so it runs 256 turns
  // While slots remain, back both cursors off one element and go round again (ROM `jp nz,0x37d6`,
  // a tail jump into the body); when the count is spent the search simply returns.
  if (remaining !== 0) return spawnEnemyIntoFreeSlotElseStepSearch(m, u16(record - RECORD_STRIDE), u16(entry - ENTRY_STRIDE), remaining);
}
