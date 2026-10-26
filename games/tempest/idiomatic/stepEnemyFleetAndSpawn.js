// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { GAME_MODE, FRAME_COUNTER, SLOT_LOOP_INDEX, SPAWN_FOUND_FLAG, SPAWN_BUDGET_TIMER, ENEMY_SLOT_FLAGS } from "./names.js";
import { advanceEnemyFreeFlight } from "./advanceEnemyFreeFlight.js";
import { decayEnemyFreeFlightVelocity } from "./decayEnemyFreeFlightVelocity.js";
import { spawnEnemyInSlot } from "./spawnEnemyInSlot.js";

/**
 * stepEnemyFleetAndSpawn — drive one frame of the enemy bank. ROM 0xa618.
 *
 * Role in the machine: once per frame this walks the 16 enemy slots, moving every active enemy and
 * refilling empty slots with fresh spawns as long as the per-wave spawn budget still has entries. It is
 * the top of the enemy update: the slot walk here calls the motion steps and the spawner, and its exit
 * decides when the wave has emptied (no enemies live, none spawned) and asks the mode machine to move on.
 *
 * Behavior: seed the frame-active flag SPAWN_FOUND_FLAG from the spawn budget SPAWN_BUDGET_TIMER, then
 * walk slots 0x0f..0. A live slot (ENEMY_SLOT_FLAGS,x != 0) integrates its free-flight position and then
 * decays its velocity, and marks the frame active (SPAWN_FOUND_FLAG = 0xff). A free slot spawns a new
 * enemy while the budget is nonzero. The register y threads the last live slot's decay return forward:
 * spawnEnemyInSlot stamps it into the new enemy, so the last-stepped axis carries into each later spawn.
 * After the walk SLOT_LOOP_INDEX settles at 0xff; on even frames (FRAME_COUNTER bit0 clear) the budget
 * ticks one toward zero; and if nothing was live or spawned, GAME_MODE is raised to the mode-request 0x12.
 *
 * Live-out: the stepped enemy slots, SPAWN_BUDGET_TIMER (decremented on even frames), SLOT_LOOP_INDEX
 * = 0xff, and GAME_MODE = 0x12 when the bank came up empty. Returns the exit [X, Y] the ROM leaves: X = 0,
 * the last slot index the walk loaded (no callee changes X), and the threaded y (the spawn path loads no
 * Y). Grounding: [seen].
 */
export function stepEnemyFleetAndSpawn(m, y = m.regs.y) {
  const { mem8 } = m;
  mem8[SPAWN_FOUND_FLAG] = mem8[SPAWN_BUDGET_TIMER];

  for (let x = 0x0f; x >= 0; x--) {
    if (mem8[u16(ENEMY_SLOT_FLAGS + x)] !== 0) {
      // Live slot: integrate then step; only the step's return threads onward.
      advanceEnemyFreeFlight(m, x);
      y = decayEnemyFreeFlightVelocity(m, x);
      mem8[SPAWN_FOUND_FLAG] = 0xff;
    } else if (mem8[SPAWN_BUDGET_TIMER] !== 0) {
      // Free slot with budget: spawn, consuming the threaded register.
      spawnEnemyInSlot(m, x, y);
    }
  }
  mem8[SLOT_LOOP_INDEX] = 0xff; // slot counter settles here after the walk

  // Even frames tick the spawn countdown toward zero.
  if ((mem8[FRAME_COUNTER] & 0x01) === 0 && mem8[SPAWN_BUDGET_TIMER] !== 0) {
    mem8[SPAWN_BUDGET_TIMER] = u8(mem8[SPAWN_BUDGET_TIMER] - 1);
  }
  // Nothing live or spawned -> raise the mode-request byte.
  if (mem8[SPAWN_FOUND_FLAG] === 0) mem8[GAME_MODE] = 0x12;
  return [0x00, y];
}
