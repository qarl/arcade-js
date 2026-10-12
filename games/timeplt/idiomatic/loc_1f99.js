// SPDX-License-Identifier: GPL-3.0-only
/** loc_1f99 — a stretch of table bytes decoded as instructions rather than a hand-written routine.
 * The ADDRESS lies inside live data (the player-animation shape strips at 0x1F76-0x200B) that advancePlayerAnimationStrip reads as DATA; only
 * this ROUTINE, decoding those bytes as CODE, is a dead arm. It is reached as code only through a fold
 * arm that the whole live-in space proves is never taken (0 of 65536), itself downstream of a
 * copyright-glyph tamper divert that a genuine image never fires.
 * Decoded as code the bytes churn a long run of stack pops through the flag pair and finally transfer
 * to a computed / off-map address. Unreachable in real play, so it is modeled as a throw rather than
 * reproducing the churn. LIVE-OUT: none — control never returns; entry is the trap.
 * Kept as the ROUTINES override of 0x1F99: no idiomatic module calls
 * it: its only way in is a jr nz that is not taken even on a tampered image (grounding-debt.txt 0x1f99).
 * ROM 0x1F99-0x1FE1. Grounding: [code] (names.js ROUTINES 0x1F99). */

import { NotImplemented } from "../../../boards/timeplt/io.js";

export function loc_1f99() {
  throw new NotImplemented(
    "loc_1f99: table-as-code reached — control-flow corruption / a tampered image; unreachable in real play",
  );
}
