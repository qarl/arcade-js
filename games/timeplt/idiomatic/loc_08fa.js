// SPDX-License-Identifier: GPL-3.0-only
/** loc_08fa — the checksum-fail landing: a stretch of table bytes an integrity check jumps into as
 * code only when the sum MISMATCHES. It is a self-checksum's dead failure arm aimed at data — on a
 * genuine image the sum always matches, so the two live sites that could branch here never take it.
 * Decoded as code the bytes churn the index registers then derail into unmapped space, which faults.
 * Unreachable in real play, so it is modeled as a throw rather than reproducing the churn.
 * LIVE-OUT: none — every path faults; entry is the trap.
 * ROM 0x08FA-0x094C. Grounding: [code] (names.js ROUTINES 0x08FA). */

import { NotImplemented } from "../../../boards/timeplt/io.js";

export function loc_08fa() {
  throw new NotImplemented(
    "loc_08fa: checksum-fail table-as-code reached — the ROM-integrity sum mismatched, so the image is bad",
  );
}
