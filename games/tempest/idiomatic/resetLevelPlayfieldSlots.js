// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  STATUS_FLAGS, PLAYER_LEVEL_TBL, SLOT_COUNTDOWN, SLOT_COUNTDOWN_HI, loc_3d, ACTIVE_SLOT_COUNT, LEVEL_ID, SPIKE_TABLE_GUARD, DSW_BONUS_CONFIG,
} from "./names.js";
import { rebuildControlBlocksIfRequested } from "./rebuildControlBlocksIfRequested.js";
import { buildLevelLayout } from "./buildLevelLayout.js";
import { clearChannelStagingBlock } from "./clearChannelStagingBlock.js";
import { selectWaveStartSlot } from "./selectWaveStartSlot.js";

/**
 * resetLevelPlayfieldSlots — reset the per-slot playfield state at level start. ROM 0xc90c.
 *
 * Role in the machine: Tempest's tube is divided into lanes ("slots"), and much of the enemy/timer
 * bookkeeping is kept in per-slot arrays. On entering a level this routine rebuilds the geometry,
 * clears the timing state that governs each lane, and points every slot at its fresh starting values
 * before handing off to slot selection. ACTIVE_SLOT_COUNT ($3e) is the highest slot index for this
 * tube shape, so the seed loop walks the whole live lane set.
 *
 * Behavior: it runs two setup passes — rebuildControlBlocksIfRequested and buildLevelLayout — and,
 * only when STATUS_FLAGS ($5) is negative (bit 7 set), a third, clearChannelStagingBlock. It clears
 * the high byte of the slot countdown (SLOT_COUNTDOWN_HI, $49). Using loc_3d ($3d) as the loop index
 * it counts from ACTIVE_SLOT_COUNT down through 0, seeding each slot's countdown (SLOT_COUNTDOWN,slot)
 * from the DSW bonus config ($158) and marking each slot's player-level entry (PLAYER_LEVEL_TBL,slot)
 * as 0xff (unassigned); the loop stops when the decremented index wraps negative. It then clears
 * LEVEL_ID ($3f) and SPIKE_TABLE_GUARD ($115), reloads loc_3d back to ACTIVE_SLOT_COUNT for the next
 * consumer, and tail-delegates to selectWaveStartSlot (its return value is this routine's return).
 *
 * Live-out: SLOT_COUNTDOWN[0..count] seeded from the bonus config, PLAYER_LEVEL_TBL[0..count]=0xff,
 * SLOT_COUNTDOWN_HI/LEVEL_ID/SPIKE_TABLE_GUARD cleared, loc_3d reset to ACTIVE_SLOT_COUNT, and the
 * rebuilt level layout — plus whatever selectWaveStartSlot leaves, including its exit [X, Y] (the ROM's,
 * since selectWaveStartSlot loads both before reading either). Grounding: [seen].
 */
export function resetLevelPlayfieldSlots(m) {
  const { mem8 } = m;

  // Geometry/control setup passes; the staging-block clear only runs when STATUS_FLAGS is negative.
  rebuildControlBlocksIfRequested(m);
  buildLevelLayout(m);
  if ((mem8[STATUS_FLAGS] & 0x80) !== 0) clearChannelStagingBlock(m);

  mem8[SLOT_COUNTDOWN_HI] = 0;

  // Walk every slot from the top index down to 0, seeding its countdown and marking it unassigned.
  mem8[loc_3d] = mem8[ACTIVE_SLOT_COUNT];
  while (true) {
    const slot = mem8[loc_3d];
    mem8[u16(SLOT_COUNTDOWN + slot)] = mem8[DSW_BONUS_CONFIG]; // per-slot countdown from bonus config
    mem8[u16(PLAYER_LEVEL_TBL + slot)] = 0xff;                 // 0xff = slot not yet assigned
    const next = u8(mem8[loc_3d] - 1);
    mem8[loc_3d] = next;
    if ((next & 0x80) !== 0) break; // index wrapped below 0 -> done
  }

  // Clear level-id / spike guard, reload the index for the next consumer, then hand off.
  mem8[LEVEL_ID] = 0;
  mem8[SPIKE_TABLE_GUARD] = 0;
  mem8[loc_3d] = mem8[ACTIVE_SLOT_COUNT];

  return selectWaveStartSlot(m);
}
