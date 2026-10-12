// SPDX-License-Identifier: GPL-3.0-only
/**
 * runAllCollisionSweepsThisFrame — ROM 0x4E63 [seen]
 *
 * WHAT IT IS. One round-engine pass's full collision-and-destruction work. dispatchCollisionPassByEra
 * sends here on even FRAME_TICK values in eras 0, 2 and 3, and dispatchEra4CollisionByFrameParity on
 * even ticks in era 4 (mechanisms.md, collision). Every sweep compares positions (sprite entries; for the player's shots, the shot record's +6/+4 against the target's entry)
 * and, on a touch, writes the destroyed code 0xF0 into state bytes; the object handlers act on it
 * later in their own frames.
 *
 * ROLE IN THE MACHINE. Six stages, in ROM order:
 *   1. the player's shots against the three-slot era-object bank
 *      (stagePlayerShotSweepAgainstTargetsAndRun);
 *   2. the player against the four enemy-shot slots (destroyPlayerAndObjectsTouchingIt, unscored);
 *   3. the player against the craft band (destroySlotsAndPlayerOnContact, scored);
 *   4. only while the Mother-Ship is armed: the player against the Mother-Ship (destroyPlayerAndMotherShipOnContactByEra);
 *   5. the player against the era weapons (destroyEraObjectsAndPlayerOnContact, scored);
 *   6. the parachutist pickup (markObjectsTouchingPlayer), the only contact that leaves the player alive.
 * Stages 2, 3, 5 and 6 share ONE cursor pair (a record cursor, 16-byte stride, and a sprite-entry
 * cursor, 2-byte stride -- the ROM's DE and IY), each sweep handing it on one past its last slot, so
 * together they walk the object array in address order: 0xA810 + 4 x 16 = 0xA850 (the craft band),
 * + 7 x 16 = 0xA8C0 (the era weapons), + 3 x 16 = 0xA8F0 (the parachutist), when the Mother-Ship is unarmed. While it is armed, stage 3 walks only
 * the first five craft and stage 5 reseats the pair at 0xA8C0 / 0xAA28 (ROM 0x4EA5). The pair now travels
 * through each callee's returned tuple rather than through registers. Every player sweep refuses
 * outright unless PLAYER_STATE reads 0xFF, and a refusing sweep hands the cursor back unmoved --
 * harmless, since then every later sweep refuses too.
 *
 * The small numbers passed to each sweep are the ROM's B, L and H loads -- a slot count and the two
 * box dimensions the callee measures a touch against (see each callee's own parameter list).
 *
 * LIVE-OUT: memory, plus the cursors the final mark leaves.
 */

import { stagePlayerShotSweepAgainstTargetsAndRun } from "./stagePlayerShotSweepAgainstTargetsAndRun.js";
import { destroyPlayerAndObjectsTouchingIt } from "./destroyPlayerAndObjectsTouchingIt.js";
import { destroySlotsAndPlayerOnContact } from "./destroySlotsAndPlayerOnContact.js";
import { destroyPlayerAndMotherShipOnContactByEra } from "./destroyPlayerAndMotherShipOnContactByEra.js";
import { destroyEraObjectsAndPlayerOnContact } from "./destroyEraObjectsAndPlayerOnContact.js";
import { markObjectsTouchingPlayer } from "./markObjectsTouchingPlayer.js";
import { ACTOR_ENTRY_SLOT0, ACTOR_RECORD_SLOT0, ERA_OBJECT_ENTRY_SLOT0, ERA_OBJECT_RECORD_SLOT0, MOTHER_SHIP_ARMED } from "./names.js";

export function runAllCollisionSweepsThisFrame(m) {
  const { mem8 } = m;
  // Stage 1 (`call 0x4f5d`): the player's six shots against the three era-object slots. It stages
  // its own runs, so it takes and leaves nothing this routine threads.
  stagePlayerShotSweepAgainstTargetsAndRun(m);

  // Stage 2 (ROM 0x4E66-0x4E73, `call 0x5185`): the player against the four enemy-shot slots from
  // ACTOR_RECORD_SLOT0 0xA810 / ACTOR_ENTRY_SLOT0 0xAA12 [seen]; B = 4 slots, L = 5, H = 0x0B.
  // A touch marks both the player and the shot, and nothing is scored.
  // Player against the actor object run; the callee hands back { occupancy, entry } (DE/IY).
  const afterPlayer = destroyPlayerAndObjectsTouchingIt(m, ACTOR_RECORD_SLOT0, ACTOR_ENTRY_SLOT0, 5, 11, 4);

  // MOTHER_SHIP_ARMED (0xAD0D [seen]) picks the shape of the rest (`ld a,(0xad0d)` / `and a` /
  // `jr nz,0x4e97`). The Mother-Ship occupies the last two craft records (MOTHER_SHIP_STATE 0xA8A0 =
  // craft slot 5), so while it is armed the craft sweep stops short of it and it gets its own test.
  if (mem8[MOTHER_SHIP_ARMED] !== 0) {
    // Armed: the contact sweep's cursor is discarded (the era-object sweep restarts at the era slots).
    // Stage 3, armed (ROM 0x4E97-0x4E9D, `call 0x5152`): only the first five craft (B = 5, L = 7,
    // H = 0x0F), continuing from where stage 2 stopped.
    destroySlotsAndPlayerOnContact(m, afterPlayer.occupancy, afterPlayer.entry, 5, 7, 15);
    // Stage 4 (`call 0x50b1`): the Mother-Ship's own box, chosen by era inside the callee.
    destroyPlayerAndMotherShipOnContactByEra(m);

    // Stage 5, armed (ROM 0x4EA3-0x4EB0, `call 0x5121`): the stage-3 cursor stopped at the Mother-Ship
    // records, so the cursor is reseated at ERA_OBJECT_RECORD_SLOT0 0xA8C0 / ERA_OBJECT_ENTRY_SLOT0
    // 0xAA28 [seen]; B = 3 era-object slots, L = 6, H = 0x0D.
    const afterTargets = destroyEraObjectsAndPlayerOnContact(m, ERA_OBJECT_RECORD_SLOT0, ERA_OBJECT_ENTRY_SLOT0, 3, 6, 13);
    // Stage 6 (ROM 0x4EB3-0x4EB9, tail `jp 0x51b3`): one object (B = 1, L = 8, H = 0x11) at the
    // cursor stage 5 left -- the parachutist slot, PARACHUTIST_RECORD 0xA8F0 [seen]. A touch stores
    // 0xF0 into its state only.
    return markObjectsTouchingPlayer(m, 8, 17, afterTargets.target, afterTargets.entry, 1);
  }

  // Unarmed: the contact sweep's cursor threads straight into the era-object sweep.
  // Stage 3, unarmed (ROM 0x4E7C-0x4E82, `call 0x5152`): all seven craft (B = 7, L = 7, H = 0x0F),
  // Mother-Ship records included; there is no stage 4.
  const afterSlots = destroySlotsAndPlayerOnContact(m, afterPlayer.occupancy, afterPlayer.entry, 7, 7, 15);

  // Stage 5, unarmed (ROM 0x4E85-0x4E8B): seven craft on from 0xA850 is already 0xA8C0, the era-object
  // bank, so no reseat is needed; B = 3, L = 6, H = 0x0D as on the armed path.
  const afterTargets = destroyEraObjectsAndPlayerOnContact(m, afterSlots.record, afterSlots.entry, 3, 6, 13);
  // Stage 6, unarmed (ROM 0x4E8E-0x4E94, tail `jp 0x51b3`): the same parachutist mark as the armed path.
  return markObjectsTouchingPlayer(m, 8, 17, afterTargets.target, afterTargets.entry, 1);
}
