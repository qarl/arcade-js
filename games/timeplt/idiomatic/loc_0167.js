// SPDX-License-Identifier: GPL-3.0-only
/** loc_0167 — not a routine: these bytes are a caption record that only runs as code on one derail
 * arm, and a genuine image never arms it. The sole caller folds a fixed run of the program image
 * into an eight-bit total, subtracts the value a genuine image folds to, and hands control here ONLY
 * when the two miss; the bytes then decode as instructions, drop two words off the stack that leave
 * the frame unwinding one word out of step, and return to a value that is not an address — control
 * destroyed rather than reported. So the mismatch arm has no faithful transcription as a routine:
 * raise where it would land instead of transcribing junk. Reaching this is a tampered-image derail;
 * on a genuine image it is dead.
 * ROM 0x0167-0x0173, falling through into 0x0174. Grounding: [code] (names.js ROUTINES 0x0167). */

import { NotImplemented } from "../../../boards/timeplt/io.js";

export function loc_0167() {
  throw new NotImplemented(
    "loc_0167: caption-record data reached as code on the tamper derail; a genuine image never reaches it",
  );
}
