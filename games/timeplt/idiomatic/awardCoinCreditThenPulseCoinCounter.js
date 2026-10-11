// SPDX-License-Identifier: GPL-3.0-only
/** awardCoinCreditThenPulseCoinCounter — credit one coin's worth on screen, then pulse the mechanical counter. Outside free
 * play the low decimal digit arriving in C is folded into the packed-decimal credit count (decimal
 * add, saturated at 99) and its two-digit field repainted; then the coin-counter pulse runs either
 * way. LIVE-OUT: memory, plus the latched counter line. */
//
// ROM 0x496E-0x4983, falling through into 0x4984 (pulseSlot1CoinCounter); lift: translated/loc_496e.js,
// which carries both stretches as one body. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. This is the shared tail of the coin/credit pipeline. names.js records two
// entries into it: awardOneCreditOnDebouncedInputEdge (0x48E7), which hands in C = 1 on a clean edge
// of IN0 bit 2 to award exactly one credit, and meterCoinageTowardCreditOnEdge (0x4911), which hands
// in C = the whole slot-2 coinage byte (COIN_SLOT_2_RATIO, 0xA9CC) when its metering step pays out. Either way the
// number of credits to add arrives in the low decimal digit of C.
//
// LIVE-OUT: CREDIT_COUNT (0xA986) and its on-screen field; the coin-counter pulse state and the
// counter's output latch line, both driven by pulseSlot1CoinCounter.

import { CREDIT_COUNT, FREE_PLAY } from "./names.js";
import { paintCreditCountPanel } from "./paintCreditCountPanel.js";
import { pulseSlot1CoinCounter } from "./pulseSlot1CoinCounter.js";
import { bcdAddByte } from "../../../core/bcd.js";

// The credit count is packed BCD (two decimal digits in one byte), so its ceiling is 0x99 -- "99" on
// screen -- which the ROM stores with `ld (hl),0x99` at 0x497F when the decimal add carries out.
const CREDIT_CAP = 0x99;
// Only the low nibble of C -- one decimal digit, 0-9 -- is added (`and 0x0f` at 0x4975).
const DIGIT_MASK = 0x0f;

export function awardCoinCreditThenPulseCoinCounter(m, coins = m.regs.c) {
  const { mem8 } = m;
  // FREE PLAY SKIPS THE ARITHMETIC. FREE_PLAY (0xA9C0, [seen]) is raised to all-ones by the coinage
  // unpack when a coin switch is set to free play; then a coin never has to buy a credit, so the
  // count and its readout are left alone (`jr nz,0x4984` at 0x4972 skips straight to the pulse).
  if (mem8[FREE_PLAY] === 0) {
    // BCD-add the coin's low digit into the packed-BCD credit count; a carry out means it passed 99,
    // so it saturates at 0x99.
    // In the ROM this is `add a,(hl)` + `daa` on CREDIT_COUNT (0xA986; the coin/credit group in
    // names.js is tagged [code]); bcdAddByte performs the same decimal-adjusted add and reports the
    // carry the `jr nc` at 0x497D tests.
    const { value, carry } = bcdAddByte(mem8[CREDIT_COUNT], coins & DIGIT_MASK);
    mem8[CREDIT_COUNT] = carry ? CREDIT_CAP : value;
    // Repaint the two-digit credit readout so the player sees the new total at once (call 0x4AFB).
    paintCreditCountPanel(m);
  }
  // ALWAYS PULSE THE COUNTER. Whether or not a credit was added, fall through into 0x4984: drive coin
  // slot 1's mechanical counter through one pulse for each coin still owed to it, so the operator's
  // meter counts coins even on free play.
  return pulseSlot1CoinCounter(m);
}
