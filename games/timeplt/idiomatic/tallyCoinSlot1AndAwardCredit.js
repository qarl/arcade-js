// SPDX-License-Identifier: GPL-3.0-only
/** tallyCoinSlot1AndAwardCredit — one frame of coin slot 1's accounting. The raw coin line is clocked into a debounce
 * shift register and only a clean rising edge (its low three bits reading 1) counts as a coin: it
 * blips the coin sound, bumps the tally, and adds a unit to the coins-inserted accumulator. Once the
 * accumulator passes the coinage threshold (coins-required-minus-one in the high nibble, credits awarded in
 * the low), the overshoot is carried forward and — unless the free-play flag is set — the low nibble
 * is added to the packed-decimal credit count (saturated at 99) and its panel repainted. Either way
 * the mechanical coin counter is pulsed. LIVE-OUT: memory, plus the latched counter line.
 *
 * ROM 0x4941-0x4983 (frozen lift translated/loc_4941.js), falling into pulseSlot1CoinCounter at
 * 0x4984. Grounding: [seen] in names.js.
 *
 * The three slot-1 cells sit together: COIN_SLOT_1_DEBOUNCE 0xA9C7 (history of the coin line, one bit
 * per frame), COIN_SLOT_1_ACCUMULATOR 0xA9C8 (coins so far, 0x10 per coin) and COIN_SLOT_1_RATIO 0xA9C9
 * (the coinage the operator's DIP switches chose, unpacked at boot). The flat one-credit input on
 * IN0 bit 2 is handled separately, by awardOneCreditOnDebouncedInputEdge. */

import { requestCoinSound } from "./requestCoinSound.js";
import { paintCreditCountPanel } from "./paintCreditCountPanel.js";
import { pulseSlot1CoinCounter } from "./pulseSlot1CoinCounter.js";
import { bcdAddByte } from "../../../core/bcd.js";
import { COIN_ACCEPTED, COIN_SLOT_1_ACCUMULATOR, COIN_SLOT_1_DEBOUNCE, COIN_SLOT_1_RATIO, CREDIT_COUNT, FREE_PLAY, IN0_MIRROR } from "./names.js";

export function tallyCoinSlot1AndAwardCredit(m) {
  const { mem8 } = m;

  /* Step 1 — debounce the coin line (0x4941-0x494F).
   * IN0_MIRROR (0xA9AE) is the vblank service's complemented copy of the IN0 port, so bit 0 reads 1
   * while a coin is breaking the slot-1 switch. The ROM rotates that bit into the bottom of the
   * history byte (`rrca / rl (hl)`), so the byte holds the last eight frames of the line, newest in
   * bit 0. Only the pattern 001 in the low three bits — idle, idle, then asserted — counts, so a
   * line held down is counted once, on the frame it is first seen after two idle frames. */
  const coinBit = mem8[IN0_MIRROR] & 0x01; // the coin line (bit 0)
  const debounce = ((mem8[COIN_SLOT_1_DEBOUNCE] << 1) | coinBit) & 0xff; // shift the coin line in
  mem8[COIN_SLOT_1_DEBOUNCE] = debounce;
  if ((debounce & 0x07) !== 0x01) return; // not the clean rising edge

  /* Step 2 — a coin was taken (0x4950-0x4958).
   * Request the coin blip (0x57F1) and add one to COIN_ACCEPTED (0xA981), the count of pulses the
   * machine owes the mechanical coin counter; the pulse driver at the tail spends it. */
  requestCoinSound(m);
  mem8[COIN_ACCEPTED] = mem8[COIN_ACCEPTED] + 1;

  /* Step 3 — meter the coin against the coinage (0x4959-0x4962).
   * The accumulator counts coins in its high nibble (+0x10 each). The ratio byte holds
   * coins-required-minus-one in its high nibble and credits-per-purchase in its low nibble; the ROM
   * compares the WHOLE ratio byte against the accumulator (`sub b / ret nc`), so the routine keeps
   * returning until the accumulator has climbed past it — i.e. until enough coins are in. */
  const accumulator = (mem8[COIN_SLOT_1_ACCUMULATOR] + 0x10) & 0xff;
  mem8[COIN_SLOT_1_ACCUMULATOR] = accumulator;
  const coinage = mem8[COIN_SLOT_1_RATIO]; // coins/credit hi nibble, credits lo nibble
  if (coinage >= accumulator) return; // still short of a credit

  /* Step 4 — spend the coins that bought this credit (0x4963-0x496E).
   * Subtract (high nibble + 0x10) — the full coin price in accumulator units — so any excess stays
   * in the accumulator toward the next purchase (`and 0xf0 / add a,0x10 / neg / add a,(hl)`). */
  mem8[COIN_SLOT_1_ACCUMULATOR] = accumulator - ((coinage & 0xf0) + 0x10); // carry the overshoot forward (write8 truncates)

  /* Step 5 — free play (0x496E-0x4972): FREE_PLAY (0xA9C0) is all-ones when either coin setting is
   * free play; then no credit is banked, and control goes straight to the coin-counter pulse. */
  if (mem8[FREE_PLAY] !== 0) return pulseSlot1CoinCounter(m);

  /* Step 6 — bank the credits (0x4974-0x4981).
   * Add the ratio's low nibble to CREDIT_COUNT (0xA986), a packed-BCD byte shown on screen, with a
   * decimal adjust (`add a,(hl) / daa`); a decimal overflow saturates the count at 99. Repaint the
   * credit panel (0x4AFB) and fall into pulseSlot1CoinCounter (0x4984), which drives the cabinet's
   * mechanical coin counter one pulse for each coin still owed. */
  const { value, carry } = bcdAddByte(mem8[CREDIT_COUNT], coinage & 0x0f);
  mem8[CREDIT_COUNT] = carry ? 0x99 : value; // BCD add, saturated at 99
  paintCreditCountPanel(m);
  return pulseSlot1CoinCounter(m);
}
