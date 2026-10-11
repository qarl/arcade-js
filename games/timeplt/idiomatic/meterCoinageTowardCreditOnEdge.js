// SPDX-License-Identifier: GPL-3.0-only
/** meterCoinageTowardCreditOnEdge — one tick of coin slot 2's debounced coin accept. The slot's input bit is rotated into a debounce
 * history; unless its low three bits read 0b001 (a fresh leading edge) the tick does nothing. When they
 * do it requests a sound, bumps the slot's accepted-coin counter, and steps the slot's accumulator by
 * sixteen; only once that exceeds the coinage setting byte is the accumulator pulled back and the
 * credit-and-coin tail run. LIVE-OUT: memory. */
//
// ROM 0x4911-0x4940, ending in a `jr 0x496e` tail into awardCoinCreditThenPulseCoinCounter;
// lift: translated/loc_4911.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. This is the coin-slot-2 accept arm of the coin/credit pipeline. Its sibling
// awardOneCreditOnDebouncedInputEdge (0x48E7) does the same debounce on IN0 bit 2 but awards one
// credit flat; this one METERS coins against the cabinet's coinage setting before it pays. The
// setting lives in COIN_SLOT_2_RATIO (0xA9CC) [seen], unpacked once at boot from the DIP switches:
// high nibble = coins required minus one, low nibble = credits paid. Each accepted coin steps the
// slot's own accumulator (COIN_SLOT_2_ACCUMULATOR, 0xA9CB) by 0x10 -- one coin in the high nibble --
// and a payout happens only once that count has passed the setting's coins-minus-one.
//
// LIVE-OUT: COIN_SLOT_2_DEBOUNCE, and on an accepted coin a sound request, COIN_ACCEPTED_SLOT_2 and
// COIN_SLOT_2_ACCUMULATOR; on a payout, whatever awardCoinCreditThenPulseCoinCounter writes (the
// credit count, its on-screen field, the coin-counter pulse).

import { requestCoinSound } from "./requestCoinSound.js";
import { awardCoinCreditThenPulseCoinCounter } from "./awardCoinCreditThenPulseCoinCounter.js";
import { COIN_ACCEPTED_SLOT_2, COIN_SLOT_2_ACCUMULATOR, COIN_SLOT_2_DEBOUNCE, IN0_MIRROR, COIN_SLOT_2_RATIO } from "./names.js";

// One coin is worth 0x10 in the accumulator, so the coin count sits in the high nibble where it can be
// compared against the setting's high nibble (`add a,0x10` at 0x492C).
const STEP = 0x10;
// The debounce looks at the last three samples of the coin line (`and 0x07 / cp 0x01` at 0x491C):
// 0b001 is "absent, absent, now present" -- a clean leading edge -- so a coin that holds the line for
// several frames is counted once, on the frame it arrives.
const PHASE_MASK = 0x07;
const READY = 0x01;

export function meterCoinageTowardCreditOnEdge(m) {
  const { mem8 } = m;

  // Sample the coin line. IN0_MIRROR (0xA9AE) [seen] is this frame's inverted (`cpl`) copy of the IN0 input port; the
  // ROM's two `rrca` put its bit 1 into carry and `rl (hl)` shifts that carry into the bottom of the
  // debounce history at 0xA9CA, so the history holds one sample per call, newest in bit 0.
  const selectorBit = (mem8[IN0_MIRROR] >> 1) & 1; // two rrca land IN0 bit 1 in carry
  mem8[COIN_SLOT_2_DEBOUNCE] = (mem8[COIN_SLOT_2_DEBOUNCE] << 1) | selectorBit; // selector bit shifted in as the low bit
  if ((mem8[COIN_SLOT_2_DEBOUNCE] & PHASE_MASK) !== READY) return;

  // A coin has been accepted: ask for the coin sound (requestCoinSound, 0x57F1) and count the coin
  // in COIN_ACCEPTED_SLOT_2 (0xA982, `inc (hl)` at 0x4928), the slot-2 twin of COIN_ACCEPTED.
  requestCoinSound(m);
  mem8[COIN_ACCEPTED_SLOT_2] = (mem8[COIN_ACCEPTED_SLOT_2] + 1);

  // Meter the coin: one more 0x10 into the accumulator. While the setting byte is still at or above the
  // new total (`sub b / ret nc` at 0x4932) the coins so far are not yet enough -- e.g. with a two-coins
  // setting (0x1n) the first coin makes 0x10 and waits, the second makes 0x20 and pays.
  const stepped = (mem8[COIN_SLOT_2_ACCUMULATOR] + STEP) & 0xff;
  mem8[COIN_SLOT_2_ACCUMULATOR] = stepped;
  if (mem8[COIN_SLOT_2_RATIO] >= stepped) return; // not enough coins yet: the setting byte still reaches the new total

  // Enough coins: take the coins just paid for back out of the accumulator -- the setting's
  // coins-minus-one plus the one, i.e. (high nibble) + 0x10 (`and 0xf0 / add a,0x10 / neg / add a,(hl)`
  // at 0x4936-0x493E) -- so the next coin starts a fresh count. Then hand the whole setting byte
  // to the shared credit tail, which, unless free play is set, adds its low nibble (the credits per payout) to the credit count.
  mem8[COIN_SLOT_2_ACCUMULATOR] = (stepped - ((mem8[COIN_SLOT_2_RATIO] & 0xf0) + STEP));
  return awardCoinCreditThenPulseCoinCounter(m, mem8[COIN_SLOT_2_RATIO]);
}
