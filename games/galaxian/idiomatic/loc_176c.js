// SPDX-License-Identifier: GPL-3.0-only
// One step of a sound-sequence channel selected by descPtr. An inactive descriptor (byte 0) does nothing.
// Otherwise stage the output-shadow pair (2, the current tone) and tick the tone's duration timer; while
// it still runs there is nothing more to do. When it expires, pull the next command byte from the sequence
// cursor: an end marker deactivates the channel; any other byte splits into a low-5-bit tone-table index
// (the new tone) and a high-3-bit duration-table index (the new timer), and the cursor advances past it.
import {
  SOUND_PITCH, SOUND_SEQ_PTR,
  SOUND_TONE_TABLE, SOUND_DURATION_TABLE,
  loc_41c0, loc_41d5, loc_41d6,
} from "./names.js";

const SEQ_END = 0xe0; // command byte that terminates a channel

export function loc_176c(m, descPtr = m.regs.hl) {
  const { mem8, mem16 } = m;

  if (mem8[descPtr] === 0) return; // channel inactive

  mem8[loc_41c0] = 2;
  mem8[SOUND_PITCH] = mem8[loc_41d5]; // publish the current tone to the output shadow

  const timer = (mem8[loc_41d6] - 1) & 0xff;
  if (timer !== 0) { mem8[loc_41d6] = timer; return; } // still counting down

  const cursor = mem16[SOUND_SEQ_PTR];
  const cmd = mem8[cursor];
  if (cmd === SEQ_END) { mem8[descPtr] = 0; return; } // end marker deactivates the channel

  mem16[SOUND_SEQ_PTR] = cursor + 1; // consume the command byte
  mem8[loc_41d5] = mem8[SOUND_TONE_TABLE + (cmd & 0x1f)]; // low 5 bits -> new tone
  mem8[loc_41d6] = mem8[SOUND_DURATION_TABLE + (cmd >> 5)]; // high 3 bits -> new duration timer
}
