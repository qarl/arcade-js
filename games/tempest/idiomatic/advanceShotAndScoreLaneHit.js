// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_29, loc_2a, loc_2b, SLOT_LOOP_INDEX, ACTIVE_OBJECT_COUNT, TARGET_SEG, SLOT_STATE, HIT_TALLY, LANE_TARGET_FLAG, LANE_LIMIT } from "./names.js";
import { requestSegmentHitSound } from "./requestSegmentHitSound.js";
import { addBcdScoreAndAwardAtThreshold } from "./addBcdScoreAndAwardAtThreshold.js";

/**
 * advanceShotAndScoreLaneHit — resolve a player shot's arrival on its lane target. ROM 0xa1fa
 * (score a lane hit).
 *
 * Role in the machine: Tempest fires shots down the tube's lanes at the enemies and flippers crawling
 * up them. Each active shot slot x tracks how far its shot has travelled toward the target that sits in
 * the lane it was launched into; stepActiveShots (0xa18f) drives that counter forward every frame and,
 * for the near slots (<8), calls here to ask "has the shot reached its mark yet, and if so what does the
 * hit do?". This routine is the scoring/kill body for one such slot: it compares the shot's progress
 * against the per-lane target depth and, when the shot lands, registers the hit — sound, target flag,
 * tally, and points — and, on a shot's second landing, spends it and drops it from the live object count.
 *
 * Behaviour: the slot's target segment y comes from TARGET_SEG,x (loc_2ad,x); the lane's remaining
 * target depth is LANE_LIMIT,y (loc_3ac,y). A zero depth means nothing is there to hit, so it returns x
 * untouched. Otherwise it reads the shot's travel counter SLOT_STATE,x (loc_2d3,x): once that counter
 * has reached the depth, the shot has arrived — it shrinks/clears the lane depth (writing the counter
 * back unless it has already saturated at >=0xf0, in which case it clears to 0), bumps this slot's hit
 * tally HIT_TALLY,x (loc_2f2,x), stamps the target-hit flag LANE_TARGET_FLAG,y = 0xc0 (loc_39a,y),
 * chimes via requestSegmentHitSound, primes the three award scratch cells (loc_2a/loc_2b = 0, loc_29 =
 * 1), and awards points with addBcdScoreAndAwardAtThreshold. It then reloads the working index from the
 * shared slot-loop index SLOT_LOOP_INDEX, since the award path may have re-entered the slot loop. Finally,
 * whichever index is now live, if its hit tally has reached two the shot is spent: clear its travel
 * counter SLOT_STATE and decrement the active object count ACTIVE_OBJECT_COUNT.
 *
 * Live-out: LANE_LIMIT,y (shrunk/cleared), HIT_TALLY,x (bumped), LANE_TARGET_FLAG,y (=0xc0), the award
 * scratch loc_29/loc_2a/loc_2b, SLOT_STATE (cleared on a spent shot), ACTIVE_OBJECT_COUNT (decremented
 * on a spent shot), plus the score and any sound queued by the callees. Returns the exit [X, Y] the ROM
 * leaves. X is the slot index live at exit (the reloaded SLOT_LOOP_INDEX when a hit fired, else the entry
 * x), so the caller resumes on the right slot. Y is the award's exit Y when a hit fired and scoring was
 * armed, else the target segment the routine indexes the lane tables with. Grounding: [code].
 */
export function advanceShotAndScoreLaneHit(m, x = m.regs.x) {
  const { mem8 } = m;
  // y = the target segment this shot was aimed at; limit = how deep the lane target still sits.
  const y = mem8[u16(TARGET_SEG + x)];
  const limit = mem8[u16(LANE_LIMIT + y)];
  // No target left in this lane -> nothing to score; hand the slot index straight back.
  if (limit === 0) return [x, y];

  let xEff = x, yOut = y;
  // counter = how far this shot has travelled down its lane so far.
  const counter = mem8[u16(SLOT_STATE + x)];
  // The shot has reached (or passed) the target's depth: register the hit.
  if (counter >= limit) {
    mem8[u16(LANE_LIMIT + y)] = counter < 0xf0 ? counter : 0x00; // clamp: clear unless already saturated
    mem8[u16(HIT_TALLY + x)] = mem8[u16(HIT_TALLY + x)] + 1;      // bump hit tally
    mem8[u16(LANE_TARGET_FLAG + y)] = 0xc0;                            // flag the target
    requestSegmentHitSound(m, x, y);                                        // chime
    // Seed the award scratch cells the score routine consumes (loc_2a/loc_2b clear, loc_29 = 1).
    mem8[loc_2a] = 0x00;
    mem8[loc_2b] = 0x00;
    mem8[loc_29] = 0x01;
    const [, awardY] = addBcdScoreAndAwardAtThreshold(m, 0xff);                     // award
    if (awardY !== undefined) yOut = awardY;                                // unarmed, the award leaves Y alone
    // Reload the live slot from the shared loop index -- the award path may have re-entered the loop.
    xEff = mem8[SLOT_LOOP_INDEX];
  }

  // Second landing on this slot: the shot is spent -- clear its counter and drop it from the live count.
  if (mem8[u16(HIT_TALLY + xEff)] >= 0x02) {                    // second hit: reset + drop a life
    mem8[u16(SLOT_STATE + xEff)] = 0x00;
    mem8[ACTIVE_OBJECT_COUNT] = mem8[ACTIVE_OBJECT_COUNT] - 1;
  }
  return [xEff, yOut];
}
