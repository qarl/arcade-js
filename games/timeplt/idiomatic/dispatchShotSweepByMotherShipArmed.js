// SPDX-License-Identifier: GPL-3.0-only
/** dispatchShotSweepByMotherShipArmed — choose this pass's shot sweep, and on the clear arm run it against the full run of seven targets.
 * MOTHER_SHIP_ARMED picks which of two sweeps runs: while set, the sweep that also covers the standing
 * object runs (staging its own runs); while clear, this stages the shared sweep's two cursor cells and
 * hands it the seven-target run (both counts seven). LIVE-OUT: memory only. */
//
// ROM 0x4F35-0x4F5C (lift: translated/loc_4f35.js). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. Time Pilot splits each round-engine pass's collision work by frame parity. names.js
// records dispatchCollisionPassByEra (0x4E4F) sending odd frames here (outside eras 1 and 4), and the
// era-1 frame-parity splitter doing the same: on those frames the player's shots are tested against
// the enemy craft. This entry decides WHICH shot sweep runs, and for one of the two it also sets the
// sweep up.
//
// LIVE-OUT: memory only -- SCRATCH_PTR_A/SCRATCH_PTR_B, plus every kill, spent shot and score the
// chosen sweep writes.

import { destroyCraftAndMotherShipHitByShots } from "./destroyCraftAndMotherShipHitByShots.js";
import { destroyTargetsHitByShots } from "./destroyTargetsHitByShots.js";
import { CRAFT_ENTRY_SLOT0, CRAFT_RECORD_SLOT0, MOTHER_SHIP_ARMED, PLAYER_SHOT_ARRAY, SCRATCH_PTR_A, SCRATCH_PTR_B } from "./names.js";

// The sweep's shape, as the ROM loads it into registers before `jp 0x5211`:
//   SHOTS   -- C = 6 (0x4F4C), the outer count: the player's six shot records at PLAYER_SHOT_ARRAY.
//   TARGETS -- B = 7 (`ld a,0x07` / `ld b,a` at 0x4F48), and the same 7 parked in A' for 0x5211
//              to reload between passes, so the first pass is no shorter than the rest: the
//              seven-slot craft band.
//   REACH   -- L = 7 (0x4F56), the half-width added before the bound test.
//   SPAN    -- H = 0x0F (0x4F58), the bound itself; together they make the hit box.
const SHOTS = 6;
const TARGETS = 7;
const REACH = 7;
const SPAN = 15;


export function dispatchShotSweepByMotherShipArmed(m) {
  const { mem8, mem16 } = m;
  // ARMED: THE OTHER SWEEP. MOTHER_SHIP_ARMED (0xAD0D, [seen]) stays up from the Mother-Ship's
  // arming until the round or life turns over. While it is set, slots 5 and 6 of the band belong to
  // the Mother-Ship, so the plain seven-craft sweep would be wrong; tail into the sweep that covers
  // five ordinary craft and then the Mother-Ship itself (`jp nz,0x4FBF`). That sweep stages its own
  // cursors and counts, so nothing is set up here.
  if (mem8[MOTHER_SHIP_ARMED] !== 0) {
    destroyCraftAndMotherShipHitByShots(m);
    return;
  }

  // NOT ARMED: STAGE THE SEVEN-CRAFT RUN. The shared sweep reloads its target cursors from these two
  // scratch cells between passes, so seating them here to slot 0 of the craft band -- record 0xA850,
  // sprite entry 0xAA1A -- makes every pass restart at the band's first slot. (ROM: `ld (0xa993),de` with DE = 0xA850, `ld (0xa991),iy` with IY = 0xAA1A.)
  mem16[SCRATCH_PTR_B] = CRAFT_RECORD_SLOT0;
  mem16[SCRATCH_PTR_A] = CRAFT_ENTRY_SLOT0;
  // Hand the sweep its run: six player shots (IX = 0xAA80) against seven craft, inside a box of
  // half-width 7 and bound 0x0F; it destroys every craft a live shot has reached and posts the score.
  destroyTargetsHitByShots(
    m, PLAYER_SHOT_ARRAY, CRAFT_ENTRY_SLOT0, CRAFT_RECORD_SLOT0,
    TARGETS, TARGETS, SHOTS, REACH, SPAN,
  );
}
