// SPDX-License-Identifier: GPL-3.0-only
/** pulseSlot2CoinCounter — drive one hardware output line as a train of square pulses, one pulse per unit of a
 * pending count, and stop when the count reaches zero.
 * With nothing pending it does nothing at all. With something pending and no pulse under way it
 * arms a fixed-length phase counter and raises the line. Otherwise it counts that phase down one
 * per call: at exactly the halfway value it drops the line again, so the line is high for the
 * first half of a phase and low for the second; at zero it takes one off the pending count, which
 * lets the next call start the next pulse. The halfway test is an equality, so a phase counter
 * disturbed past that value from outside would run the whole phase with the line still high.
 * LIVE-OUT: memory, plus the output line.
 *
 * ROM: 0x49D6. Tag [seen] (names.js). Role in the machine: coin slot 2's mechanical coin counter. It
 * is the twin of pulseSlot1CoinCounter (0x4984) — byte-identical but for the three addresses it uses: the debt
 * cell COIN_COUNTER_PULSES_OWED_SLOT_2 0xA982 [seen], the timer COIN_PULSE_TIMER_SLOT_2 0xA985 [seen] and the
 * latch line COIN_COUNTER_1_LATCH 0xC30C (bit 6 of the board's LS259 latch, the board's
 * LATCH_COIN_COUNTER_1). Each coin taken on slot 2 owes one click of that counter, and this routine
 * pays the debt off one separate on-then-off pulse at a time, so two quick coins give two clicks.
 */

import { u8 } from "../../../core/int.js";
import { COIN_COUNTER_PULSES_OWED_SLOT_2, COIN_PULSE_TIMER_SLOT_2, COIN_COUNTER_1_LATCH } from "./names.js";

// Same pulse shape as slot 1: 48 steps, line released at 24.
const PHASE_LENGTH = 48;
const HALFWAY = 24;

export function pulseSlot2CoinCounter(m) {
  const { mem8 } = m;
  // Nothing owed on this slot: do nothing, not even touch the line.
  if (mem8[COIN_COUNTER_PULSES_OWED_SLOT_2] === 0) return;

  // No pulse under way: arm the phase counter and energise the counter's line together.
  if (mem8[COIN_PULSE_TIMER_SLOT_2] === 0) {
    mem8[COIN_PULSE_TIMER_SLOT_2] = PHASE_LENGTH;
    mem8[COIN_COUNTER_1_LATCH] = 1;
    return;
  }

  // Pulse running: step the phase down. At zero the pulse is complete, one owed coin is paid off,
  // and the idle timer lets the next call start the next pulse.
  const phase = u8(mem8[COIN_PULSE_TIMER_SLOT_2] - 1);
  mem8[COIN_PULSE_TIMER_SLOT_2] = phase;
  if (phase === 0) {
    mem8[COIN_COUNTER_PULSES_OWED_SLOT_2] = u8(mem8[COIN_COUNTER_PULSES_OWED_SLOT_2] - 1);
    return;
  }
  // Half-way: release the line for the second half of the phase.
  if (phase === HALFWAY) mem8[COIN_COUNTER_1_LATCH] = 0;
}
