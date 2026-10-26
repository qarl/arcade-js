// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { loc_2f, FRAME_COUNTER, ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, ENEMY_SLOT_TOP, WAVE_PHASE_LATCH, SPIKE_LANE_MASK_ACC, SPIKE_LANE_MASK_OUT, OBJECT_INDEX_TABLE, OBJECT_RECORD_TABLE, SLOT_BIT_MASK } from "./names.js";
import { spawnEnemyOnTimerExpiry } from "./spawnEnemyOnTimerExpiry.js";

/**
 * tickSpawnSlotTimers -- age the 64-entry spawn-timer table and rebuild the spike-lane mask. ROM 0x98a2.
 *
 * Role in the machine: Tempest schedules enemy spawns and spike growth per lane through a 64-entry timer
 * table. Each pass this routine ages every armed timer toward zero, fires the spawn handler when one
 * expires, and rebuilds the bit mask of lanes that currently carry a spike, publishing it for the render
 * and collision code. Ageing can be frozen for the pass when the field is already too crowded or a wave
 * transition is underway.
 *
 * Behavior: zero the accumulator SPIKE_LANE_MASK_ACC (0x14f). Compute the freeze gate loc_2f: set it to
 * 0xff (bit 7 raised = freeze) when ENEMY_TOTAL_COUNT (0x108) + ENEMY_TYPE_COUNT (0x109) overshoots
 * ENEMY_SLOT_TOP (0x11c), or when WAVE_PHASE_LATCH (0x125) is nonzero; else 0x00. Then walk slot 0x3f
 * down to 0 over OBJECT_RECORD_TABLE (0x243): skip empty (timer 0) slots. For an armed slot, if the gate
 * is clear, age it by 1 and store back -- on reaching 0 fire spawnEnemyOnTimerExpiry(slot) (which may
 * itself raise loc_2f for the rest of the scan); on reaching 0x3f, if this slot's lane bit (via
 * OBJECT_INDEX_TABLE (0x203) -> SLOT_BIT_MASK (0xca38)) is already set in the accumulator, bump the timer
 * back to 0x40 to hold it. Re-read the (possibly changed) timer and classify: a value < 0x40 that is also
 * >= 0x20 ORs this slot's lane bit into the accumulator; a value >= 0x40 advances this slot's lane index
 * (OBJECT_INDEX_TABLE) by 1 mod 16, but only on even frames (FRAME_COUNTER bit 0 clear). After the scan,
 * copy the accumulator out to SPIKE_LANE_MASK_OUT (0x150).
 *
 * Live-out: the aged OBJECT_RECORD_TABLE timers, the freeze gate loc_2f, advanced OBJECT_INDEX_TABLE lane
 * indices, the rebuilt mask in SPIKE_LANE_MASK_ACC and its published copy SPIKE_LANE_MASK_OUT, plus any
 * state spawnEnemyOnTimerExpiry writes. Returns the exit X, 0xff: the ROM counts X down through the
 * slots and leaves it past 0, and runPerFrameUpdates hands that X to runObjectMotionScripts.
 * Grounding: [seen].
 */
export function tickSpawnSlotTimers(m) {
  const { mem8 } = m;

  mem8[SPIKE_LANE_MASK_ACC] = 0;

  // Freeze ageing this pass when the field is overcrowded or a wave transition is latched.
  const pairedSum = u8(mem8[ENEMY_TOTAL_COUNT] + mem8[ENEMY_TYPE_COUNT]);
  mem8[loc_2f] = (pairedSum > mem8[ENEMY_SLOT_TOP] || mem8[WAVE_PHASE_LATCH] !== 0) ? 0xff : 0x00;

  for (let slot = 0x3f; slot >= 0; slot--) {
    const timer = mem8[u16(OBJECT_RECORD_TABLE + slot)];
    if (timer === 0) continue;

    // Age the slot unless the gate is raised.
    if ((mem8[loc_2f] & 0x80) === 0) {
      const aged = timer - 1;
      mem8[u16(OBJECT_RECORD_TABLE + slot)] = aged;
      if (aged === 0) {
        spawnEnemyOnTimerExpiry(m, slot); // timer expired -> spawn (may raise the gate for the rest of the scan)
      } else if (aged === 0x3f) {
        // Crossing into the mask band: if this lane already carries a spike, hold the timer at 0x40.
        const bit = mem8[u16(OBJECT_INDEX_TABLE + slot)];
        if ((mem8[SPIKE_LANE_MASK_ACC] & mem8[u16(SLOT_BIT_MASK + bit)]) !== 0) {
          mem8[u16(OBJECT_RECORD_TABLE + slot)] = aged + 1;
        }
      }
    }

    // Classify the (possibly re-armed or expired) timer.
    const t = mem8[u16(OBJECT_RECORD_TABLE + slot)];
    if (t < 0x40) {
      if (t >= 0x20) {
        // In the 0x20..0x3f band: this lane carries a spike -> set its bit in the mask.
        const bit = mem8[u16(OBJECT_INDEX_TABLE + slot)];
        mem8[SPIKE_LANE_MASK_ACC] = mem8[SPIKE_LANE_MASK_ACC] | mem8[u16(SLOT_BIT_MASK + bit)];
      }
    } else if ((mem8[FRAME_COUNTER] & 0x01) === 0) {
      // High band: on even frames, rotate this slot's lane index (mod 16).
      mem8[u16(OBJECT_INDEX_TABLE + slot)] = (mem8[u16(OBJECT_INDEX_TABLE + slot)] + 1) & 0x0f;
    }
  }

  // Publish the rebuilt spike-lane mask for the rest of the frame.
  mem8[SPIKE_LANE_MASK_OUT] = mem8[SPIKE_LANE_MASK_ACC];
  return 0xff; // the exit X: the slot scan runs X past 0
}
