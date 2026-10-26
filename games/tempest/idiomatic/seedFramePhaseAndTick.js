// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import {
  GAME_MODE, MODE_DISPATCH_SEL, FRAME_COUNTER, STATUS_FLAGS, PHASE_COUNTER, DSW1_SNAPSHOT, DSW2_SNAPSHOT, SOUND_STEP_GATE, loc_a2, INPUT_EDGE_FLAGS, IN0_PORT,
} from "./names.js";
import { advanceLevelCounter } from "./advanceLevelCounter.js";
import { stepEaromTransfer } from "./stepEaromTransfer.js";
import { requestActiveSoundCue } from "./requestActiveSoundCue.js";

/**
 * seedFramePhaseAndTick -- per-frame mode/timing driver + periodic sub-step pump. ROM 0xc891.
 *
 * Role in the machine: one of the three per-update passes runMainFrameLoop fires each ~26.5Hz tick (with
 * dispatchFramePhaseHandler and buildFrameVectors). It is the machine's frame heartbeat: a short setup
 * decides this frame's phase/speed cells from the coin input, the status/mode flag and the phase counters,
 * then a common tail advances the master frame counter and fires the periodic housekeeping sub-steps
 * (EAROM transfer, sound register).
 *
 * Behavior -- setup: if the coin input (IN0_PORT/0xc00 bit4) is clear it forces GAME_MODE (0x00) = 0x22 and
 * skips to the tail; else if STATUS_FLAGS (0x5) bit6 is set it also skips to the tail; else it branches on
 * phase parity (DSW2_SNAPSHOT/0xa bit0). On the odd phase it reads PHASE_COUNTER (0x6) into y and works the
 * loc_a2 gate: an expired counter arms it, and depending on y it either routes to the level-counter step,
 * sets GAME_MODE = 0x14, or seeds MODE_DISPATCH_SEL (0x1) = 0x16 with GAME_MODE = 0x0a. When not tailing
 * early, advanceLevelCounter runs on a live phase and every fourth frame (DSW1_SNAPSHOT/0x9 low two bits
 * zero) reseeds PHASE_COUNTER = 0x02.
 *
 * Behavior -- common tail: increments FRAME_COUNTER (0x3); on odd frames runs stepEaromTransfer (the
 * non-volatile high-score EAROM shift); when SOUND_STEP_GATE (0xc) is live calls requestActiveSoundCue to
 * register the active sound; then trims bit7 of INPUT_EDGE_FLAGS (0x4e). The slot index rides X/Y from the
 * setup step and the odd-frame step into the sound call, so both are threaded as locals rather than through
 * the register file. A decimal-mode arm in the original is dead here (see the note at the tail).
 *
 * Live-out: GAME_MODE, MODE_DISPATCH_SEL, loc_a2, PHASE_COUNTER, FRAME_COUNTER, INPUT_EDGE_FLAGS, plus the
 * side effects of advanceLevelCounter / stepEaromTransfer / requestActiveSoundCue.
 *
 * x and y are the X/Y the ROM enters with: the exit registers of the mode handler dispatchFramePhaseHandler
 * ran (or, when its DSW gate skipped the pass, the ones it was entered with). Whichever of them the setup and
 * the odd-frame EAROM step leave unloaded reach the sound loader when SOUND_STEP_GATE is live, and it stashes
 * them in loc_31/loc_32. Returns the exit [X, Y] (the loader hands both back unchanged), which the frame loop
 * enters buildFrameVectors with.
 * Grounding: [seen].
 */
export function seedFramePhaseAndTick(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;

  let toC81b = false, toTail = false;
  if ((mem8[IN0_PORT] & 0x10) === 0) {           // coin input bit4 clear
    mem8[GAME_MODE] = 0x22;
    toTail = true;
  } else if ((mem8[STATUS_FLAGS] & 0x40) !== 0) {      // mode flag bit6 set
    toTail = true;
  } else if ((mem8[DSW2_SNAPSHOT] & 0x01) === 0) {      // even phase
    toC81b = true;
  } else {
    y = mem8[PHASE_COUNTER];
    if (y === 0) mem8[loc_a2] = 0x80;
    if ((mem8[loc_a2] & 0x80) === 0) {          // gate bit7 clear
      toC81b = true;
    } else if (y >= 2) {
      mem8[GAME_MODE] = 0x14;
      mem8[loc_a2] = 0x00;
      toC81b = true;
    } else if (y !== 0) {                        // y === 1
      mem8[MODE_DISPATCH_SEL] = 0x16;
      mem8[GAME_MODE] = 0x0a;
    }
  }

  if (!toTail) {
    if (toC81b && mem8[PHASE_COUNTER] !== 0) [x, y] = advanceLevelCounter(m, x);
    if ((mem8[DSW1_SNAPSHOT] & 0x03) === 0) mem8[PHASE_COUNTER] = 0x02;  // every fourth frame reseed
  }

  // Common tail.
  mem8[FRAME_COUNTER] = u8(mem8[FRAME_COUNTER] + 1);
  if ((mem8[FRAME_COUNTER] & 0x01) !== 0) [x, y] = stepEaromTransfer(m, x, y);  // odd frames
  if (mem8[SOUND_STEP_GATE] !== 0) requestActiveSoundCue(m, x, y);                    // live -> register the sound
  // (The decimal-mode arm here -- SED gated on DECIMAL_MODE_FLAG != 0 && loc_9f > 0x13 -- is dead: DECIMAL_MODE_FLAG holds a
  // fixed checksum that is always 0, so the gate never opens. Verified statically and by observation of the
  // running game, where DECIMAL_MODE_FLAG is written 0 every time.)
  if ((mem8[INPUT_EDGE_FLAGS] & 0x80) !== 0) mem8[INPUT_EDGE_FLAGS] = 0x00;
  return [x, y];
}
