// SPDX-License-Identifier: GPL-3.0-only
/** splitCollisionWorkByFrameParity — split one round-engine pass's collision work by frame parity: on odd frames run the shot-versus-
 * target sweeps; on even frames run the player-versus-object collision chain, adding the mother-ship
 * mutual-kill check only while the mother ship is armed.
 * LIVE-OUT: memory only. */
//
// ROM 0x4EBC-0x4F29; lift: translated/loc_4ebc.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. Once per round-engine pass, dispatchCollisionPassByEra (0x4E4F) [seen] runs the
// collision pass for the current era; era 1 comes here. Collision work is split over two frames: odd
// FRAME_TICK values run the player's shots against the targets, even values run everything that can
// touch the player's own ship. Era 1 is the one era with a BOMBER -- a two-tile object in the
// era-object bank at 0xA8C0 that soaks hits -- so its even-frame chain splices bomber tests into the
// usual player-contact chain (mechanisms.md, "Era 1 is built differently").
//
// The even-frame chain, in ROM order (steps 3 and 7 start where steps 2 and 6 left their cursors,
// one past their last slot):
//   1. the player's shots against the bomber (markEra1BomberAndShotHitByShots, 0x4F7E);
//   2. the player against the four enemy-shot slots from 0xA810 (destroyPlayerAndObjectsTouchingIt, 0x5185);
//   3. the player against the craft band that follows at 0xA850 (destroySlotsAndPlayerOnContact, 0x5152);
//   4. while the Mother-Ship is armed, the player against it (destroyPlayerAndMotherShipOnContactByEra, 0x50B1);
//   5. the player against the bomber (destroyPlayerAndBomberOnContact, 0x507E);
//   6. the player against the bomber's launched object at 0xA8E0 (destroyPlayerAndObjectsTouchingIt);
//   7. the next record, the parachutist at 0xA8F0, marked if the player touches it
//      (markObjectsTouchingPlayer, 0x51B3) -- the touch that collects it.
//
// LIVE-OUT: memory only -- the state bytes the sweeps mark and the scores they post.

import { dispatchShotSweepByMotherShipArmed } from "./dispatchShotSweepByMotherShipArmed.js";
import { markEra1BomberAndShotHitByShots } from "./markEra1BomberAndShotHitByShots.js";
import { destroyPlayerAndObjectsTouchingIt } from "./destroyPlayerAndObjectsTouchingIt.js";
import { destroySlotsAndPlayerOnContact } from "./destroySlotsAndPlayerOnContact.js";
import { destroyPlayerAndMotherShipOnContactByEra } from "./destroyPlayerAndMotherShipOnContactByEra.js";
import { destroyPlayerAndBomberOnContact } from "./destroyPlayerAndBomberOnContact.js";
import { markObjectsTouchingPlayer } from "./markObjectsTouchingPlayer.js";
import { ACTOR_ENTRY_SLOT0, ACTOR_RECORD_SLOT0, ERA_OBJECT_ENTRY_SLOT2, ERA_OBJECT_RECORD_SLOT2, FRAME_TICK, MOTHER_SHIP_ARMED } from "./names.js";

export function splitCollisionWorkByFrameParity(m) {
  const { mem8 } = m;
  // Odd frame (`ld a,(0xa980) / and 0x01 / jp nz,0x4f35`): only the shots-against-targets sweep, which
  // itself picks its target run by whether the Mother-Ship is armed.
  if (mem8[FRAME_TICK] & 0x01) return dispatchShotSweepByMotherShipArmed(m);

  // Even frame. Step 1: the player's shots against the bomber, the one target that only the even
  // frame shoots at in this era.

  markEra1BomberAndShotHitByShots(m);

  // Step 2: the player's ship against the four enemy-shot slots, record 0xA810 / entry 0xAA12
  // (`ld de,0xa810 / ld iy,0xaa12 / call 0x5185`): a box of 5 either side (slack 5, width 11) on both
  // axes; the player and any slot it touches are both marked destroyed.
  const afterSlot0 = destroyPlayerAndObjectsTouchingIt(m, ACTOR_RECORD_SLOT0, ACTOR_ENTRY_SLOT0, 5, 11, 4);

  // The sweep above left the record cursor (page unchanged from ACTOR_RECORD_SLOT0) and the entry
  // cursor; the slot sweep reads them one past its last, now threaded through the returned tuple.
  // Step 3: the player against the craft band, starting at 0xA850 where step 2 stopped. While the
  // Mother-Ship is armed (MOTHER_SHIP_ARMED, 0xAD0D [seen]) only five slots are swept: the band's last
  // two records, 0xA8A0/0xA8B0, are then the Mother-Ship's own two-slot record (MOTHER_SHIP_STATE is
  // 0xA8A0), and step 4 tests it with its own player-contact check instead. The first-axis box is bias 7, width 15.
  const armed = mem8[MOTHER_SHIP_ARMED] !== 0;
  destroySlotsAndPlayerOnContact(m, afterSlot0.occupancy, afterSlot0.entry, armed ? 5 : 7, 7, 15);
  if (armed) destroyPlayerAndMotherShipOnContactByEra(m);
  // Step 5: the player ramming the bomber -- a touch marks both and posts a chained score.
  destroyPlayerAndBomberOnContact(m);

  // Step 6: the player against the bomber's third record (0xA8E0 / entry 0xAA2C), which holds what the
  // bomber launches: one target, 5 either side. No shot sweep covers this record in era 1, so whatever
  // the bomber launches can hit the player but cannot be shot (mechanisms.md).

  const afterSlot2 = destroyPlayerAndObjectsTouchingIt(m, ERA_OBJECT_RECORD_SLOT2, ERA_OBJECT_ENTRY_SLOT2, 5, 11, 1);

  // The tail marks objects near the player using the cursors that sweep just left.
  return markObjectsTouchingPlayer(m, 8, 17, afterSlot2.occupancy, afterSlot2.entry, 1);
}
