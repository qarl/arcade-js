// SPDX-License-Identifier: GPL-3.0-only
/** requestCoinSound — request one sound, with no permission test: it sounds whether or not a game runs.
 * Its code is fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x57F1-0x57F6 (frozen lift loc_57f1). Grounding: [seen] (names.js ROUTINES 0x57F1).
 *
 * Role in the machine: the coin/credit chime. Its callers are the coin and service-credit paths
 * (tallyCoinSlot1AndAwardCredit, meterCoinageTowardCreditOnEdge, awardOneCreditOnDebouncedInputEdge),
 * which run in attract as much as in play — a coin is normally inserted while no game runs, so a
 * gate on PLAY_ACTIVE would silence it. That is why this request goes through
 * enqueueSoundUnconditional rather than one of the two gated entries (mechanisms.md, "The sound
 * queue").
 *
 * The code is COIN_SOUND (0x322E), a byte of the program ROM read as data (0x01 on a genuine
 * image). The frame service later sends it to the audio board, one queued code per run.
 */

import { enqueueSoundUnconditional } from "./enqueueSoundUnconditional.js";
import { COIN_SOUND } from "./names.js";

export function requestCoinSound(m) {
  /* ld a,(0x322e) / jp 0x5628: fetch the code and tail-jump into the ungated entry, whose return
   * goes straight back to our caller. */
  enqueueSoundUnconditional(m, m.mem8[COIN_SOUND]);
}
