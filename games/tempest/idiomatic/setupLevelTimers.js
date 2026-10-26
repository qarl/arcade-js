// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import {
  GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, MODE_DELAY_TIMER, STATUS_FLAGS, loc_3d, LEVEL_ID, PLAYER_LEVEL_TBL, loc_9f, loc_117,
} from "./names.js";
import { swapParallelTables } from "./swapParallelTables.js";
import { selectProjectionScale } from "./selectProjectionScale.js";
import { runLevelInit } from "./runLevelInit.js";
import { resetBothPokeyChips } from "./resetBothPokeyChips.js";

/**
 * setupLevelTimers -- seed the per-level mode/timer cells at level setup. ROM 0xc940.
 *
 * Role in the machine: run at the start of a level to arm the game-mode state machine and, on a
 * genuine level change, install the new-level timers and swap the paired geometry tables before
 * converging into the shared level-init path. This is what lets a fresh level pick up its size,
 * timing, and readout.
 *
 * Behavior: it seeds MODE_DISPATCH_SEL = 0, GAME_MODE = 30, GAME_MODE_PENDING = 30. It then reads
 * LEVEL_ID and compares it to the last-seen id loc_3d: if they differ it latches loc_3d = level, and
 * when STATUS_FLAGS is negative (bit7 set) it overrides with the new-level timers -- MODE_DISPATCH_SEL
 * = 14, GAME_MODE = 10, MODE_DELAY_TIMER = 40 when loc_117 is nonzero else 80 -- and swaps the
 * parallel tables via swapParallelTables. It then converges unconditionally: selectProjectionScale
 * sizes the projection, PLAYER_LEVEL_TBL indexed by loc_3d is copied into loc_9f, runLevelInit does
 * the startup init, and it tail-delegates to resetBothPokeyChips (the POKEY/readout reset).
 *
 * Live-out: MODE_DISPATCH_SEL, GAME_MODE, GAME_MODE_PENDING, MODE_DELAY_TIMER, loc_3d, loc_9f, the
 * swapped table pointers, and whatever the tail reset leaves. Returns the exit [X, Y] the ROM leaves, the tail
 * reset's. Grounding: [seen].
 */
export function setupLevelTimers(m) {
  const { mem8 } = m;

  mem8[MODE_DISPATCH_SEL] = 0;
  mem8[GAME_MODE] = 30;
  mem8[GAME_MODE_PENDING] = 30;

  const level = mem8[LEVEL_ID];
  if (level !== mem8[loc_3d]) {
    mem8[loc_3d] = level;
    if (mem8[STATUS_FLAGS] & 0x80) {
      mem8[MODE_DISPATCH_SEL] = 14;
      mem8[GAME_MODE] = 10;
      mem8[MODE_DELAY_TIMER] = mem8[loc_117] !== 0 ? 40 : 80;
      swapParallelTables(m);
    }
  }

  selectProjectionScale(m);
  mem8[loc_9f] = mem8[u8(PLAYER_LEVEL_TBL + mem8[loc_3d])];
  runLevelInit(m);
  return resetBothPokeyChips(m);
}
