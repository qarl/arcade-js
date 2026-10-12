// SPDX-License-Identifier: GPL-3.0-only
/** restartAttractSequence — restart the outer sequence from a standing start.
 * The in-play flag, the inner step index and the active-player index are cleared, then the outer
 * phase is set from a byte of the program image rather than an immediate. A fold over three more
 * program bytes then writes the inner index a SECOND time: an address is stepped by one byte, its
 * low half combined with its high half and a constant taken off. On an unaltered image that fold
 * comes back to zero and the second write agrees with the first; on a moved image it does not, and
 * the sequence restarts at some other step. LIVE-OUT: memory only.
 *
 * ROM 0x12FB-0x1318 (frozen lift translated/loc_12fb.js). Grounding: [seen] (names.js ROUTINES
 * 0x12fb). Role in the machine: the way out of the round engine (outer phase 3) back to the top
 * of the attract sequence (phase 1). It is the shared teardown reached both when the attract
 * demo ends and when a real game ends; only the game-over path arrives with PLAY_ACTIVE still
 * set (names.js). Under MAME every firing wrote the same five stores, the last one zero.
 *
 * Anti-tamper: the folded bytes 0x4901-0x4903 sit inside the copyright caption's record, so an
 * image with an altered copyright line restarts attract at a wrong step instead of failing cleanly.
 */

import { u8 } from "../../../core/int.js";
import { PLAY_ACTIVE, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, ACTIVE_PLAYER, ATTRACT_SEQUENCE_START_PHASE, ATTRACT_RESTART_FOLD_BYTE, ATTRACT_RESTART_FOLD_WORD } from "./names.js";
import { offsetAddress } from "./offsetAddress.js";

// The ROM's `sub 0x9b`: the constant the genuine image's fold must reach for the result to be 0.
const FOLD_BIAS = 155;

export function restartAttractSequence(m) {
  const { mem8, mem16 } = m;
  /* Stand the machine down: `xor a` then three stores — PLAY_ACTIVE [seen] (no game running),
   * SEQUENCE_SUBSTEP [seen] (inner step 0), ACTIVE_PLAYER [seen] (back to player one). */
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[ACTIVE_PLAYER] = 0;
  /* Pick the destination: SEQUENCE_PHASE [seen] is loaded from the ROM byte at 0x16D3
   * (ATTRACT_SEQUENCE_START_PHASE), which reads 0x01 — the attract sequence. */
  mem8[SEQUENCE_PHASE] = mem8[ATTRACT_SEQUENCE_START_PHASE];

  /* The tamper fold, which rewrites SEQUENCE_SUBSTEP. `ld a,(0x4901)` / `ld hl,(0x4902)` read
   * one image byte and one image word; `rst 0x18` (offsetAddress, HL += A) adds them; `xor h`
   * folds the resulting low byte with the high byte and `sub 0x9b` takes the constant off. On
   * the genuine image (0xA6 at 0x4901, the word 0x3005 at 0x4902) this lands on zero, so the inner
   * step stays 0; any other bytes start the sequence at some other step. */
  const moved = offsetAddress(m, mem16[ATTRACT_RESTART_FOLD_WORD], mem8[ATTRACT_RESTART_FOLD_BYTE]);
  mem8[SEQUENCE_SUBSTEP] = u8(u8(moved) ^ (moved >> 8)) - FOLD_BIAS;
}
