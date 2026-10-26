// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { SLOT_LOOP_INDEX, ACTIVE_ENEMY_COUNT, OBJECT_VELOCITY_HI, OBJECT_VELOCITY_LO, ACTIVE_OBJECT_COUNT, PLAYER_SHOT_DEPTH, SLOT_STATE, loc_2e6, HIT_TALLY } from "./names.js";
import { advanceShotAndScoreLaneHit } from "./advanceShotAndScoreLaneHit.js";
import { primeTopObjectOnTargetMatch } from "./primeTopObjectOnTargetMatch.js";

/**
 * stepActiveShots — advance every active shot/object slot one tick down its lane. ROM 0xa18f.
 *
 * Role in the machine: the twelve object slots (0x0b..0) hold in-flight shots and the objects they become.
 * This routine ticks all of them each frame, split into two classes by index: the high slots (8..0x0b) are
 * fast objects whose depth is integrated from a 16-bit velocity, and the low slots (0..7) are lane shots
 * whose depth steps by a fixed increment and gets scored against enemies on the lane. Slots that run off the
 * end of the tube are retired and their live count decremented.
 *
 * Behavior: it seeds the loop index SLOT_LOOP_INDEX to 0x0b and counts down. A slot is skipped when its
 * SLOT_STATE,x (the high/depth byte) is 0 (inactive). For a high slot (x >= 8): add OBJECT_VELOCITY_LO into
 * the low position loc_2e6,x, carry into the new high = SLOT_STATE,x + OBJECT_VELOCITY_HI + carry. If that
 * high is still at/beyond the floor PLAYER_SHOT_DEPTH the object lives (store the new high); otherwise it has
 * fallen past the near edge — drop ACTIVE_ENEMY_COUNT, finalize via primeTopObjectOnTargetMatch, and clear
 * the slot. For a low slot (x < 8): step the counter SLOT_STATE,x by +9 (less 4 when HIT_TALLY,x is flagged),
 * store it, then advanceShotAndScoreLaneHit resolves the shot against the lane and returns the effective slot
 * index xEff (it may retarget). If SLOT_STATE,xEff has reached the far limit >= 0xf0, drop ACTIVE_OBJECT_COUNT
 * and clear that slot. The loop decrements SLOT_LOOP_INDEX and stops when it wraps negative (bit7 set).
 *
 * Live-out: updated SLOT_STATE / loc_2e6 position bytes for every live slot, cleared slots at the limits,
 * decremented ACTIVE_ENEMY_COUNT / ACTIVE_OBJECT_COUNT, SLOT_LOOP_INDEX left at 0xff, plus any scoring the
 * lane-hit and prime helpers apply. y is the Y the ROM enters with: the high slots come first in the
 * sweep and nothing before a retire touches Y, so it is exactly what primeTopObjectOnTargetMatch's insert
 * chain sees (and its sound loader and object insert stash). Returns the exit [X, Y] the ROM leaves: X is
 * the last slot index the sweep worked on (advanceShotAndScoreLaneHit's when it ran on that slot), and Y is
 * advanceShotAndScoreLaneHit's exit Y from the last live low slot, or the incoming y when no low slot was
 * live. Grounding: [seen].
 */
export function stepActiveShots(m, y = m.regs.y) {
  const { mem8 } = m;

  mem8[SLOT_LOOP_INDEX] = 0x0b;            // sweep slots 0x0b..0
  let x;
  for (;;) {
    x = mem8[SLOT_LOOP_INDEX];
    if (mem8[u16(SLOT_STATE + x)] !== 0) { // skip inactive slots
      if (x >= 0x08) {
        // high slot: integrate 16-bit velocity into the position pair
        const lo = mem8[u16(loc_2e6 + x)] + mem8[OBJECT_VELOCITY_LO];
        mem8[u16(loc_2e6 + x)] = lo;
        const hi = (mem8[u16(SLOT_STATE + x)] + mem8[OBJECT_VELOCITY_HI] + (lo > 0xff ? 1 : 0)) & 0xff;
        if (hi >= mem8[PLAYER_SHOT_DEPTH]) {
          mem8[u16(SLOT_STATE + x)] = hi;  // still above the floor -> keep flying
        } else {
          // fell past the near edge -> retire the object
          mem8[ACTIVE_ENEMY_COUNT] = mem8[ACTIVE_ENEMY_COUNT] - 1;
          primeTopObjectOnTargetMatch(m, x, y);
          mem8[u16(SLOT_STATE + x)] = 0x00;
        }
      } else {
        // low slot: step the lane-shot counter (+9, less 4 when tagged) then score it
        let counter = mem8[u16(SLOT_STATE + x)] + 0x09;
        if (mem8[u16(HIT_TALLY + x)] !== 0) counter -= 0x04;
        mem8[u16(SLOT_STATE + x)] = counter;
        [x, y] = advanceShotAndScoreLaneHit(m, x); // may retarget the slot index
        if (mem8[u16(SLOT_STATE + x)] >= 0xf0) {
          // reached the far limit -> retire
          mem8[ACTIVE_OBJECT_COUNT] = mem8[ACTIVE_OBJECT_COUNT] - 1;
          mem8[u16(SLOT_STATE + x)] = 0x00;
        }
      }
    }
    const next = (mem8[SLOT_LOOP_INDEX] - 1) & 0xff;
    mem8[SLOT_LOOP_INDEX] = next;
    if (next & 0x80) break;                // stop when the index wraps past 0
  }
  return [x, y];
}
