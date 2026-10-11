// SPDX-License-Identifier: GPL-3.0-only
/** loc_1f2e — sixteen direction-table bytes decoded as instructions rather than a hand-written routine.
 * The ADDRESS is a live data table (the heading-snap step reads it as DATA); only this ROUTINE,
 * decoding those bytes as CODE, is a dead arm. It is reached as code only through a copyright-glyph
 * tamper divert in the per-frame animation step: the divert fires only when the sampled copyright
 * glyph/colour departs from its genuine value — i.e. only on a tampered image — so a good image never
 * takes it. Decoded as code the bytes fold a register into A and fall through into the heading snap.
 * Unreachable in real play,
 * so it is modeled as a throw rather than reproducing the churn. LIVE-OUT: none — entry is the trap.
 * ROM 0x1F2E-0x1F3D. Grounding: [code] (names.js ROUTINES 0x1F2E). */

import { NotImplemented } from "../../../boards/timeplt/io.js";

export function loc_1f2e() {
  throw new NotImplemented(
    "loc_1f2e: direction-table-as-code reached — the copyright-glyph tamper divert fired, so the image is bad",
  );
}
