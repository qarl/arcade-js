// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceCoinInputs — one frame of coin-input service.
 *
 * ROM 0x48BE-0x48CD (five calls and a return). Grounding: [seen] (names.js ROUTINES 0x48be).
 *
 * WHAT IT IS. The coin inputs are switch lines the CPU samples every frame; an input only counts on a
 * clean, debounced edge. Every coin the machine accepts must also tick the cabinet's mechanical coin
 * counters, one pulse per coin. This routine runs the whole of that bookkeeping once per frame, in the ROM's
 * order:
 *   1. awardOneCreditOnDebouncedInputEdge (0x48E7) -- debounce IN0 bit 2 and award a credit on a
 *      clean leading edge;
 *   2. tallyCoinSlot1AndAwardCredit (0x4941) -- debounce coin slot 1, count the coin and convert
 *      coins to credits by the coinage setting;
 *   3. meterCoinageTowardCreditOnEdge (0x4911) -- debounce coin slot 2, count the coin and convert
 *      coins to credits by the coinage setting;
 *   4. pulseSlot1CoinCounter (0x4984) and
 *   5. pulseSlot2CoinCounter (0x49D6) -- drive each mechanical counter through one pulse per coin
 *      it is still owed.
 *
 * The three input calls rotate the debounce histories; crediting and pulsing fire only on an edge or a debt,
 * so on an ordinary frame with no coin activity nothing but those histories changes.
 *
 * ROLE IN THE MACHINE. Called from the vertical-blank service (serviceVerticalBlankInterrupt), so it
 * runs every frame whatever the game is doing -- attract, credit screen or play.
 *
 * LIVE-OUT: memory, plus the latched coin-counter lines.
 */

import { awardOneCreditOnDebouncedInputEdge } from "./awardOneCreditOnDebouncedInputEdge.js";
import { tallyCoinSlot1AndAwardCredit } from "./tallyCoinSlot1AndAwardCredit.js";
import { meterCoinageTowardCreditOnEdge } from "./meterCoinageTowardCreditOnEdge.js";
import { pulseSlot1CoinCounter } from "./pulseSlot1CoinCounter.js";
import { pulseSlot2CoinCounter } from "./pulseSlot2CoinCounter.js";

export function serviceCoinInputs(m) {
  // Input side: debounce the inputs and turn accepted coins into credits.
  awardOneCreditOnDebouncedInputEdge(m);
  tallyCoinSlot1AndAwardCredit(m);
  meterCoinageTowardCreditOnEdge(m);
  // Output side: pulse each slot's mechanical coin counter for any coin still owed to it.
  pulseSlot1CoinCounter(m);
  pulseSlot2CoinCounter(m);
}
