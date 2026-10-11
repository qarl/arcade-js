// SPDX-License-Identifier: GPL-3.0-only
/** loc_315b — a bare transfer into a packed table of bytes: the original jumps there and the bytes
 * would run as instructions, which destroys control rather than reporting anything. There is no
 * faithful transcription of table bytes run as code, so this raises where the jump would land. It is
 * reached only when a caption witness sampled off the screen reads something other than what a
 * genuine image paints there. No cell is read or written before the raise. LIVE-OUT: none — it
 * never returns.
 * ROM 0x315B-0x315D. Grounding: [code] (names.js ROUTINES 0x315B). */

import { NotImplemented } from "../../../boards/timeplt/io.js";

export function loc_315b() {
  throw new NotImplemented(
    "loc_315b: the caption witness read wrong, and the original jumps into a packed table run as code; " +
      "a genuine image paints the witness it expects",
  );
}
