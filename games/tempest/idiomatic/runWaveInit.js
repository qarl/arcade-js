// SPDX-License-Identifier: GPL-3.0-only
import { MODE_DISPATCH_SEL, DEPTH_LO, DEPTH_HI, SPIKE_ACTIVE_FLAG } from "./names.js";
import { reseedStateTables } from "./reseedStateTables.js";
import { seedPerLaneSpikeArray } from "./seedPerLaneSpikeArray.js";
import { resetWorkingRamForStateEntry } from "./resetWorkingRamForStateEntry.js";
import { clearReadyLatchPair } from "./clearReadyLatchPair.js";

/**
 * runWaveInit — initialize state for the start of a wave. ROM 0x9009.
 *
 * Role in the machine: at the top of each new wave (tube level) Tempest must rebuild its per-wave working
 * state before enemies begin to appear — reseed the shared state tables, lay out the per-lane spikes,
 * clear the scratch RAM the incoming mode will use, and reset the depth counter that governs how far down
 * the tube the action currently reaches. This routine is that fixed setup sequence.
 *
 * Behavior: run the four setup passes in order — reseedStateTables (repopulate the state tables),
 * seedPerLaneSpikeArray (lay out this wave's spikes per lane), resetWorkingRamForStateEntry (clear the
 * working RAM for the state being entered), and clearReadyLatchPair (drop a pair of ready latches). Then
 * seed DEPTH_LO = 250 (the initial 16-bit tube depth, high byte zeroed just below) and clear the wave-entry
 * flags: SPIKE_ACTIVE_FLAG, DEPTH_HI, and MODE_DISPATCH_SEL. It is tail-reached from bumpLevelEnemyQuota.
 *
 * Live-out: the four passes' reseeded tables/spikes/RAM/latches, plus DEPTH_LO = 250 with DEPTH_HI = 0
 * (depth counter primed) and SPIKE_ACTIVE_FLAG / MODE_DISPATCH_SEL cleared to 0.
 *
 * Returns the exit [X, Y] the ROM leaves: resetWorkingRamForStateEntry's (clearReadyLatchPair and the closing
 * stores write no register). Grounding: [seen].
 */
export function runWaveInit(m) {
  const { mem8 } = m;

  reseedStateTables(m);            // repopulate the shared per-wave state tables
  seedPerLaneSpikeArray(m);        // lay out this wave's spikes, one per lane
  const exit = resetWorkingRamForStateEntry(m); // clear working RAM for the state being entered
  clearReadyLatchPair(m);          // drop the paired ready latches

  mem8[DEPTH_LO] = 250;            // prime the tube-depth counter (low byte)
  mem8[SPIKE_ACTIVE_FLAG] = 0;     // no spike active yet
  mem8[DEPTH_HI] = 0;              // depth high byte
  mem8[MODE_DISPATCH_SEL] = 0;     // reset the mode dispatch selector
  return exit;
}
