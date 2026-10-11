// SPDX-License-Identifier: GPL-3.0-only
/** loadActivePlayerContextAndPostRoundHud — set up the active player's turn and guard the picture on a program-image checksum.
 * Blank a run of character cells and copy the active player's saved sixteen-byte context into the
 * live block. When play is inactive, just step the sequence sub-index; otherwise also post the round
 * number and the lives-less-one as commands and fold a fixed program span into an XOR and write it,
 * less one, to the picture-enable latch, which takes bit 0 — darkening the screen if the fold comes out odd.
 *
 * ROM 0x4C75-0x4CB3 (frozen lift translated/loc_4c75.js). Grounding: [seen] (names.js ROUTINES 0x4c75).
 *
 * Role in the machine: a sequence arm (computed-dispatch entry 3 of the table at 0x0F29) that
 * starts a turn. Each player's state lives in a sixteen-byte block (player one at 0xAD10, player
 * two at 0xAD20) and the game plays out of the live copy at 0xAD00; this is the swap-in. The two
 * posted commands go to the command ring (postCommand): the round number, and the lives count
 * less one that names.js (LIVES_REMAINING) identifies as the reserve display. The checksum is a
 * tamper guard: names.js records that the program-image checksums fold into VIDEO_ENABLE_LATCH so
 * that a patched image blanks the picture.
 *
 * LIVE-OUT: memory only. */

import { u8 } from "../../../core/int.js";
import { blankFourteenCharCells } from "./blankFourteenCharCells.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { postCommand } from "./postCommand.js";
import {
  ACTIVE_PLAYER, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES,
  LIVES_REMAINING, ROUND_NUMBER, PLAY_ACTIVE,
  TAMPER_CHECKSUM_SPAN_BASE, VIDEO_ENABLE_LATCH,
} from "./names.js";

// Sixteen bytes of per-player context; 256 bytes of program folded (the ROM's `ld b,0x00` loop).
// Command 6 carries the round number, command 5 the reserve count.
const CONTEXT_BYTES = 16;
const CHECKSUM_BYTES = 256;
const ROUND_COMMAND = 6;
const LIVES_COMMAND = 5;

export function loadActivePlayerContextAndPostRoundHud(m) {
  const { mem8 } = m;
  // Clear a fixed run of character cells (ROM 0x07D2).
  blankFourteenCharCells(m);

  // Swap in the active player: ACTIVE_PLAYER 0 selects player one's block, else player two's, and
  // all sixteen bytes are copied over the live block starting at LIVES_REMAINING (an LDIR).
  const saved = mem8[ACTIVE_PLAYER] === 0 ? PLAYER_ONE_LIVES : PLAYER_TWO_LIVES;
  for (let i = 0; i < CONTEXT_BYTES; i++) mem8[LIVES_REMAINING + i] = mem8[saved + i];

  // Not in play (the attract demo also runs with PLAY_ACTIVE clear): no readouts, no checksum,
  // just step the sequence (the ROM's `jp z,0x0f1a`).
  if (mem8[PLAY_ACTIVE] === 0) return advanceSequenceSubStep(m);

  // Post the round number, then the lives count less one — the ship in play is not shown in
  // reserve, so the readout is one below LIVES_REMAINING.
  postCommand(m, ROUND_COMMAND, mem8[ROUND_NUMBER]);
  postCommand(m, LIVES_COMMAND, u8(mem8[LIVES_REMAINING] - 1));

  // Tamper guard: XOR the 256 bytes from TAMPER_CHECKSUM_SPAN_BASE (0x5B50) into one byte, and
  // write that value less one (the ROM's `add a,0xff`) to the picture-enable latch.
  let checksum = 0;
  for (let i = 0; i < CHECKSUM_BYTES; i++) checksum ^= mem8[TAMPER_CHECKSUM_SPAN_BASE + i];
  mem8[VIDEO_ENABLE_LATCH] = u8(checksum - 1);

  // Either way the sequence moves on to its next sub-step.
  return advanceSequenceSubStep(m);
}
