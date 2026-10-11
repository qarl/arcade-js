// SPDX-License-Identifier: GPL-3.0-only
/** destroyTargetsHitByShots — destroy every target a live shot has reached, and post the score for each one.
 *
 * ROM 0x5211-0x5269. Grounding: [seen] (names.js ROUTINES 0x5211).
 *
 * ROLE IN THE MACHINE. This is the shots-against-targets half of the round engine's collision pass
 * (mechanisms.md, "Shots against targets"). Every caller fixes the outer run at the six-record
 * player shot table (PLAYER_SHOT_ARRAY 0xAA80 [seen], the table fireAndSweepPlayerShots owns) and
 * varies only the inner run of targets -- so the sweep runs shots against targets, not the
 * reverse. stagePlayerShotSweepAgainstTargetsAndRun, for example, sweeps six shots against three
 * era-object slots with a reach of 7 and a span of 15, i.e. a box of 7 either side.
 *
 * A run of shot slots is swept against a run of target slots. A shot whose state byte does not
 * hold the live code is passed over entirely. A live one is tested against every target in the
 * run: the target must itself be live, neither of its two coordinates may lie in the narrow band
 * around zero that an unplaced or retired slot leaves behind, and both must fall inside a box
 * centred on the shot — one half-width and one width, from the caller, shared by both axes.
 * A target that passes is destroyed together with the shot that reached it: both state bytes take
 * the same destroyed code and the chained hit score is posted for that single kill. The sweep
 * does NOT stop there, so one shot can take several targets in one pass and is paid for each.
 * The two coordinate sources are parallel tables read at different strides: the shot keeps its
 * whole-part coordinates inside its own record, the target keeps them in a two-byte entry whose
 * halves sit 49 apart. Between passes the target cursors are RELOADED from two fixed cells and
 * the inner count from the shadow accumulator; none of the three is carried on, so every shot
 * starts the same run over.
 *
 * The destroyed code 0xF0 is not this routine's bookkeeping: it is the state stepDyingObjectState
 * turns into a death countdown before retiring the slot (names.js), and for a shot record the
 * shot sweep frees any head other than 0xFF on its next pass (mechanisms.md).
 *
 * PARAMETERS (where the values come from): shot = first shot record (the ROM's IX); entry = first
 * target sprite entry (IY); target = first target record (DE); targetsFirstPass / targetsPerPass =
 * the inner count for the first shot and for every later shot (B, and the shadow A'); shots = the
 * outer count (C); reach and span = the box half-width and width (L and H). The caller also seats
 * SCRATCH_PTR_A with the entry run start and SCRATCH_PTR_B with the record run start.
 * LIVE-OUT: memory only. */

import { u8, u16 } from "../../../core/int.js";
import { postChainedHitScore } from "./postChainedHitScore.js";
import { SCRATCH_PTR_A, SCRATCH_PTR_B } from "./names.js";
import { within, nextRecordInPage } from "./objectGeometry.js";

// Record/entry offsets. A record's byte 0 is its state (head) byte. A shot keeps each coordinate
// as an 8.8 word at +3 and +5 of its record, so the WHOLE parts sit at +4 and +6. A sprite entry
// keeps native X at +0x00 and native Y at +0x31 (= 49) (mechanisms.md, world scroll section). Shot +6 is compared with entry +0, shot +4 with entry +49.
const STATE = 0;
const SHOT_FIRST_AXIS = 6;
const SHOT_SECOND_AXIS = 4;
const ENTRY_SECOND_AXIS = 49;
// 0xFF is the "flying/live" head, 0xF0 the destroyed code both parties take on a hit.
const LIVE = 255;
const DESTROYED = 240;
// Sprite entries are two bytes apart (the paired-slot layout); records step by nextRecordInPage.
const ENTRY_STRIDE = 2;

// A coordinate this close to zero is not a position yet: on the first axis the 8 values below
// zero through the 16 above it, on the second the 16 below zero and zero itself.
// (ROM: `add a,0x08 / cp 0x19` at 0x521E-0x5220 and `add a,0x10 / cp 0x11` at 0x5227-0x5229.)
const FIRST_AXIS_LEAD = 8;
const FIRST_AXIS_BAND = 25;
const SECOND_AXIS_LEAD = 16;
const SECOND_AXIS_BAND = 17;

/** The per-pair hit test, in the ROM's order (0x5217-0x523F): each failed test skips to the
 * cursor step at 0x524A without touching anything. */
function reached(mem8, shot, entry, target, reach, span) {
  // The target must be flying: `ld a,(de) / inc a / jr nz` -- only 0xFF becomes zero.
  if (mem8[target + STATE] !== LIVE) return false;
  // An entry parked in the near-zero band on either axis is an unplaced or retired slot, not a
  // real position; reject it before the distance test so it can never be "hit".
  const first = mem8[entry];
  if (u8(first + FIRST_AXIS_LEAD) < FIRST_AXIS_BAND) return false;
  const second = mem8[entry + ENTRY_SECOND_AXIS];
  if (u8(second + SECOND_AXIS_LEAD) < SECOND_AXIS_BAND) return false;
  // Finally the box: the same reach and span on both axes, shot coordinate minus target.
  return (
    within(mem8[shot + SHOT_FIRST_AXIS], first, reach, span) &&
    within(mem8[shot + SHOT_SECOND_AXIS], second, reach, span)
  );
}

export function destroyTargetsHitByShots(m, shot = m.regs.ix, entry = m.regs.iy, target = m.regs.de, targetsFirstPass = m.regs.b, targetsPerPass = m.regs.a_, shots = m.regs.c, reach = m.regs.l, span = m.regs.h) {
  const { mem8, mem16 } = m;
  // Working cursors: the shot being tested, and the target pair (entry + record) walked in
  // lockstep beneath it, as every paired-slot sweep in the game does.
  let shotSlot = shot;
  let entryCursor = entry;
  let targetCursor = target;
  let targets = targetsFirstPass;
  let shotsLeft = shots;

  // OUTER LOOP: one pass per shot record (ROM 0x5211, closed by `dec c / jp nz,0x5211`).
  do {
    // Only a live shot (head 0xFF) is swept; any other head jumps straight to the reload at
    // 0x5254. A shot that is already spent this pass keeps sweeping -- the inner test looks at the
    // target's state, not the shot's -- which is why one shot can take several targets.
    if (mem8[shotSlot + STATE] === LIVE) {
      let left = targets;
      // INNER LOOP: every target in the run (ROM 0x5217, closed by `djnz 0x5217`).
      do {
        if (reached(mem8, shotSlot, entryCursor, targetCursor, reach, span)) {
          // A hit: shot and target both take 0xF0 (`ld (ix+0),a / ld (de),a`), and the kill is
          // scored through postChainedHitScore (call 0x51DE), which steps the award up while
          // consecutive hits land inside the chain window.
          mem8[shotSlot + STATE] = DESTROYED;
          mem8[targetCursor + STATE] = DESTROYED;
          postChainedHitScore(m);
        }
        // Step the target pair to its next slot: entry by 2 (`inc iy` twice), record by 16.
        entryCursor = u16(entryCursor + ENTRY_STRIDE);
        targetCursor = nextRecordInPage(targetCursor);
        left = u8(left - 1);
      } while (left !== 0);
    }
    // Rewind the target run for the next shot (ROM 0x5254-0x525F): cursors come back from the
    // two scratch cells, the count from the shadow accumulator -- nothing advanced by the inner
    // loop survives, so every shot faces the same targets.
    entryCursor = mem16[SCRATCH_PTR_A];
    targetCursor = mem16[SCRATCH_PTR_B];
    targets = targetsPerPass;
    // Next shot record, within its page.
    shotSlot = nextRecordInPage(shotSlot);
    shotsLeft = u8(shotsLeft - 1);
  } while (shotsLeft !== 0);
}
