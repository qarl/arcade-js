// SPDX-License-Identifier: GPL-3.0-only
/**
 * The Donkey Kong binding of the equivalence gate.
 *
 * The engine that actually proves an optimized/ routine equals its translated/
 * oracle is game-agnostic and lives in core/equivalence.js — see its header for
 * what the gate does and why (whole-machine vs unit, why cycles are not
 * compared, the invocation counter, the health assertion). All that is here is
 * the DK-specific wiring: bake this game's Machine (its ROM + assets) into the
 * `makeMachine(overrides)` factory the engine drives, so callers keep the same
 * `(rom, assets, …)` shape they always had.
 *
 * README §"The equivalence harness" documents the contract this satisfies.
 */

import { Machine } from "../machine.js";
import {
  unitEquivalence as coreUnitEquivalence,
  wholeMachineEquivalence as coreWholeMachineEquivalence,
} from "../../../core/equivalence.js";

/**
 * The factory the engine asks for: given an optional resolved override map,
 * build a DK Machine on this ROM + assets. No override argument is the baseline
 * (shipped) path; the state dump the gate compares needs no gfx/proms, so `{}`
 * assets is the fast path. Machine.clone() carries the ROM + assets forward, so
 * the engine's clones stay on this same game without knowing what game it is.
 */
function dkMachineFactory(rom, assets) {
  return (overrides) =>
    new Machine(rom, overrides ? { ...assets, overrides } : assets);
}

/**
 * Whole-machine gate for Donkey Kong. Same signature as before the engine was
 * extracted: (rom, assets, nFrames, overrides).
 */
export function wholeMachineEquivalence(rom, assets, nFrames, overrides) {
  return coreWholeMachineEquivalence(dkMachineFactory(rom, assets), nFrames, overrides);
}

/**
 * Unit gate for Donkey Kong. Same signature as before:
 * (rom, assets, target, translatedFn, optimizedFn, opts).
 */
export function unitEquivalence(rom, assets, target, translatedFn, optimizedFn, opts) {
  return coreUnitEquivalence(dkMachineFactory(rom, assets), target, translatedFn, optimizedFn, opts);
}
