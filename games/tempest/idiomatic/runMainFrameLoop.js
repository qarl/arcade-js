// SPDX-License-Identifier: GPL-3.0-only
import { GAME_MODE, IRQ_HEARTBEAT } from "./names.js";
import { resetBothPokeyChips } from "./resetBothPokeyChips.js";
import { dispatchFramePhaseHandler } from "./dispatchFramePhaseHandler.js";
import { seedFramePhaseAndTick } from "./seedFramePhaseAndTick.js";
import { buildFrameVectors } from "./buildFrameVectors.js";

/**
 * runMainFrameLoop -- the game's top-level frame loop, as a generator. ROM 0xc7a0.
 *
 * Role in the machine: this is the outermost loop of the whole game. After a one-time board-init pass it
 * free-runs forever, pacing itself off the interrupt-driven frame counter IRQ_HEARTBEAT ($53), which the
 * ~246Hz hardware IRQ increments. Every game update it waits for nine interrupts to accumulate, clears the
 * counter, and runs the three per-update passes that dispatch the current mode, tick the phase clock, and
 * build the display list. Nine interrupts per update pace the game at ~26.5Hz.
 *
 * Behavior: one-time setup runs resetBothPokeyChips ($... POKEY reset) and seeds GAME_MODE ($00) = 0, the
 * live mode/state code. Then the infinite loop: busy-wait while IRQ_HEARTBEAT < 9 (yielding each turn),
 * zero the counter, then call dispatchFramePhaseHandler, seedFramePhaseAndTick, and buildFrameVectors in
 * order. Expressed as a generator so the wait IS the frame boundary -- the clock-free JS engine resumes
 * the generator once the interrupts it fires bring IRQ_HEARTBEAT up to nine, collapsing the original 6502
 * busy-wait into a single yield per game update.
 *
 * Live-out: GAME_MODE ($00) seeded to 0 on entry and IRQ_HEARTBEAT ($53) cleared each update; the frame's
 * real output is the state and display list left by the three passes. Non-terminating: validated by the
 * bounded equivalence-c7a0 gate and the whole-game boot/convergence. Grounding: [seen].
 *
 * Register flow: this loop writes neither X nor Y, and each pass returns the exit [X, Y] the ROM leaves,
 * which the next pass is entered with: resetBothPokeyChips' into the first update's dispatch, the mode
 * handler's into seedFramePhaseAndTick, its into buildFrameVectors, and the build's across the wait (the
 * IRQ restores both) into the next dispatch. The dispatcher's spike pre-pass may reload Y, and the handlers
 * and the phase tick pass the X/Y they hold to the sound loader and object insert, which stash them in RAM.
 */
export function* runMainFrameLoop(m) {
  const { mem8 } = m;
  let [x, y] = resetBothPokeyChips(m);         // one-time: reset both POKEY sound/IO chips
  mem8[GAME_MODE] = 0;                         // seed the live game mode/state code to 0
  for (;;) {
    while (mem8[IRQ_HEARTBEAT] < 9) yield;     // frame boundary: wait for nine IRQs (~26.5Hz)
    mem8[IRQ_HEARTBEAT] = 0;                   // consume them, start the next frame's count
    [x, y] = dispatchFramePhaseHandler(m, y, x);   // run the handler for the current mode/phase
    [x, y] = seedFramePhaseAndTick(m, x, y);       // seed the next phase and advance the frame clock
    [x, y] = buildFrameVectors(m, x, y);       // build this frame's display vector list
  }
}
