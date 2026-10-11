// SPDX-License-Identifier: GPL-3.0-only
/** awardOneCreditOnDebouncedInputEdge — debounce bit 2 of the input-port mirror through a rolling history cell, and only on a
 * clean leading edge (its low three bits reading 001) request a sound and award one credit. LIVE-OUT: the history cell, and on the edge the credit count, the sound queue and the coin-counter latch.
 *
 * ROM 0x48E7-0x48FF (frozen lift translated/loc_48e7.js), ending in a tail jump to
 * awardCoinCreditThenPulseCoinCounter at 0x496E. Grounding: [seen] in names.js.
 *
 * Role in the machine: a flat one-credit input, distinct from the coinage-metered coin-1 handler
 * at 0x4941 (tallyCoinSlot1AndAwardCredit): each clean press of this line is worth exactly one
 * credit, whatever the coinage switches say. names.js records the history cell as
 * SERVICE_CREDIT_DEBOUNCE (0xA983); IN0 bit 2 is the cabinet's Service 1 input. */

import { requestCoinSound } from "./requestCoinSound.js";
import { awardCoinCreditThenPulseCoinCounter } from "./awardCoinCreditThenPulseCoinCounter.js";
import { IN0_MIRROR, SERVICE_CREDIT_DEBOUNCE } from "./names.js";

// The input line watched: bit 2 of IN0_MIRROR (the ROM shifts it out with three `rrca`).
const INPUT_BIT = 2;
// The one history pattern that counts, 001 in the low three bits: idle, idle, then asserted.
const EDGE = 0x01;
const LOW3 = 0x07;
// `ld c,0x01` at 0x48FB: the number of credits awarded per edge.
const ONE_CREDIT = 0x01;

export function awardOneCreditOnDebouncedInputEdge(m) {
  const { mem8 } = m;
  /* Debounce (0x48E7-0x48F7). IN0_MIRROR (0xA9AE) is the per-frame, complemented copy of the IN0
   * port, so a set bit means the line is asserted. The ROM rotates bit 2 into the bottom of the
   * history byte (`rl (hl)`), giving one bit per frame with the newest in bit 0. A held or
   * idle line never shows 001, so the award fires once per press, on its first frame. */
  const bit = (mem8[IN0_MIRROR] >> INPUT_BIT) & 1;
  const history = ((mem8[SERVICE_CREDIT_DEBOUNCE] << 1) | bit) & 0xff;
  mem8[SERVICE_CREDIT_DEBOUNCE] = history;
  if ((history & LOW3) !== EDGE) return;
  /* On the edge (0x48F8-0x48FD): blip the coin sound (0x57F1), then hand C = 1 to the shared credit
   * tail at 0x496E, which (outside free play) adds it to the packed-decimal credit count at 0xA986,
   * clamped at 99, repaints that field and pulses the coin counter. */
  requestCoinSound(m);
  return awardCoinCreditThenPulseCoinCounter(m, ONE_CREDIT);
}
