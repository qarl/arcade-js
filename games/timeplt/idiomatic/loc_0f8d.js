// SPDX-License-Identifier: GPL-3.0-only
/** loc_0f8d — the image-checksum tamper trap. The original drops four return words off the stack to
 * unwind its caller chain, falls into the sprite position-fixup pass at 0x0F97, and returns through
 * a fifth. This layer lays no return words (every routine is a direct call and the frame interrupt fires
 * as one), so there is no chain on the stack to unwind and no faithful transcription of the unwind; it
 * raises where the transfer lands instead. It is reached only when the one image block the credit line
 * folds does not total 0x67, and that block is fixed program bytes, so a genuine image never arrives
 * here. No cell is read or written before the raise. LIVE-OUT: none — it never returns.
 * ROM 0x0F8D-0x0F96. Grounding: [code] (names.js ROUTINES 0x0F8D). */

import { NotImplemented } from "../../../boards/timeplt/io.js";

export function loc_0f8d() {
  throw new NotImplemented(
    "loc_0f8d: the image checksum is not 0x67, so the image is tampered and the original unwinds four " +
      "return words off the stack as a trap; a genuine image always folds to 0x67",
  );
}
