// SPDX-License-Identifier: GPL-3.0-only
/** pulseSlot1CoinCounter — drive one pulse of the mechanical counter for each coin the machine still owes, one
 * pulse at a time. With nothing owed it does nothing at all. Otherwise a frame timer runs the
 * pulse: idle, it is loaded to its full length and the counter line is driven high; running, it
 * drops by one a frame, the line is driven low again exactly at the half-way count, and on the
 * frame it reaches zero the debt drops by one instead — so the next owed pulse starts on the
 * frame after, and a debt of two comes out as two separate pulses rather than one long one.
 * The line is a latch, not memory, so nothing here reads back what it wrote.
 * LIVE-OUT: memory, plus the latched line.
 *
 * ROM: 0x4984. Tag [seen] (names.js). Role in the machine: coin slot 1's mechanical counter, a solenoid
 * the timer's period gives its on-time; each owed coin becomes a separate on-then-off pulse, so two
 * quick coins give two distinct clicks (mechanisms.md). The coin path bumps COIN_COUNTER_PULSES_OWED 0xA981 [seen] once per coin; this
 * routine pays that debt off one pulse at a time. Its twin for the second slot, pulseSlot2CoinCounter
 * (0x49D6), is byte-identical but for the three addresses it uses. mechanisms.md notes that the shared crediting
 * tail (awardCoinCreditThenPulseCoinCounter) ends by falling into THIS slot's driver whichever input
 * the credit came from, so on a frame that completes a credit this driver runs twice.
 */

import { COIN_COUNTER_PULSES_OWED, COIN_PULSE_TIMER, COIN_COUNTER_0_LATCH } from "./names.js";

// A pulse lasts 48 timer steps (ROM: ld (hl),0x30); the line is held high for the first half and
// dropped at 24 (cp 0x18), giving an equal on and off time.
const PULSE_FRAMES = 48;
const LINE_DROPS_AT = 24;

// The counter line: COIN_COUNTER_0_LATCH 0xC30A, bit 5 of the board's LS259 addressable latch
// (the board's LATCH_COIN_COUNTER_0, boards/timeplt/io.js). Write-only hardware; 1 energises the counter, 0 releases it.
const drive = (m, level) => {
  m.mem8[COIN_COUNTER_0_LATCH] = level;
};

export function pulseSlot1CoinCounter(m) {
  const { mem8 } = m;
  // Nothing owed: leave the timer and the line alone (ROM: ld a,(0xa981) / and a / ret z).
  if (mem8[COIN_COUNTER_PULSES_OWED] === 0) return;

  // An idle timer (COIN_PULSE_TIMER 0xA984 [seen] at zero) means no pulse is under way: start one
  // by loading the full length and energising the line in the same step.
  const remaining = mem8[COIN_PULSE_TIMER];
  if (remaining === 0) {
    mem8[COIN_PULSE_TIMER] = PULSE_FRAMES;
    drive(m, 1);
    return;
  }

  // A pulse is running: count it down one step. On the step it reaches zero the pulse is over and
  // one owed coin is paid off; the timer now reads idle, so the next call starts the next pulse.
  const left = remaining - 1;
  mem8[COIN_PULSE_TIMER] = left;
  if (left === 0) {
    mem8[COIN_COUNTER_PULSES_OWED] = mem8[COIN_COUNTER_PULSES_OWED] - 1;
    return;
  }
  // Half-way through: release the line. The test is an exact match, as in the ROM, so the drop
  // happens on the one step the count passes 24.
  if (left === LINE_DROPS_AT) drive(m, 0);
}
