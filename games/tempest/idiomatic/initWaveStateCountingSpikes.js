// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { GAME_MODE, GAME_MODE_PENDING, MODE_DELAY_TIMER, DEPTH_ACCUM_LO, loc_9f, SPIKE_STEP_LO, SPIKE_STEP_HI, SPIKE_ACTIVE_FLAG, SPIKE_HEIGHT_LO, SPIKED_SEGMENT_COUNT, WAVE_PHASE_LATCH, LANE_LIMIT } from "./names.js";

/**
 * initWaveStateCountingSpikes -- wave-start state reset that tallies the spikes. ROM 0xa5cb.
 *
 * Role in the machine: at the start of a wave Tempest has to decide whether the "spikes" cutscene plays.
 * Spikes are the vertical needles Spikers leave growing up the lanes; if any survived the previous wave,
 * the game runs a short intro where the ship dives the tube clearing them. This routine resets the wave
 * state batch, counts how many lanes still carry a spike, and if there are any (on the early waves) it
 * arms that intro sequence.
 *
 * Behavior: seed the wave batch -- game mode loc_0 = 0x20, OR bit7 into the spike-active flag loc_106,
 * clear the spike step-low loc_104, spike height-low loc_107, depth accumulator loc_5c and the spike
 * tally loc_123, and set the spike step-high loc_105 = 0x02. Then walk the sixteen lane-limit cells
 * loc_3ac (X from 0x0f down to 0) and increment loc_123 for every nonzero entry -- that counts the
 * spiked lanes. If any lane is spiked AND the level loc_9f is below 7, overwrite the batch with the
 * intro parameters: mode-delay timer loc_4 = 0x1e, game mode loc_0 = 0x0a, pending mode loc_2 = 0x20,
 * and stamp the tally loc_123 = 0x80 as the intro marker. Finally latch the wave-phase gate loc_125 =
 * 0xff to mark the block ready.
 *
 * Live-out: the reset wave batch (loc_0/loc_104/loc_107/loc_5c/loc_105/loc_106), the spike tally loc_123
 * (count, or 0x80 marker), the intro timers loc_4/loc_2 when armed, and the ready latch loc_125.
 * Returns the exit X the ROM leaves, 0xff (the tally runs X past 0); Y is not touched. Grounding: [seen].
 */
export function initWaveStateCountingSpikes(m) {
  const { mem8 } = m;
  mem8[GAME_MODE] = 0x20;                                       // loc_0 game mode
  mem8[SPIKE_ACTIVE_FLAG] = mem8[SPIKE_ACTIVE_FLAG] | 0x80;     // arm spike-active bit7 (loc_106)
  mem8[SPIKE_STEP_LO] = 0;                                      // loc_104
  mem8[SPIKE_HEIGHT_LO] = 0;                                    // loc_107
  mem8[DEPTH_ACCUM_LO] = 0;                                     // loc_5c
  mem8[SPIKED_SEGMENT_COUNT] = 0;                               // loc_123 tally
  mem8[SPIKE_STEP_HI] = 0x02;                                   // loc_105
  for (let x = 0x0f; x >= 0; x--) {                             // scan the 16 lane cells loc_3ac
    if (mem8[u16(LANE_LIMIT + x)] !== 0) mem8[SPIKED_SEGMENT_COUNT] = u8(mem8[SPIKED_SEGMENT_COUNT] + 1);
  }
  if (mem8[SPIKED_SEGMENT_COUNT] !== 0 && mem8[loc_9f] < 0x07) {  // spikes present on an early wave
    mem8[MODE_DELAY_TIMER] = 0x1e;                             // loc_4 intro delay
    mem8[GAME_MODE] = 0x0a;                                    // loc_0 intro mode
    mem8[GAME_MODE_PENDING] = 0x20;                            // loc_2 pending mode
    mem8[SPIKED_SEGMENT_COUNT] = 0x80;                         // loc_123 intro marker
  }
  mem8[WAVE_PHASE_LATCH] = 0xff;                               // loc_125 ready latch
  return 0xff;
}
