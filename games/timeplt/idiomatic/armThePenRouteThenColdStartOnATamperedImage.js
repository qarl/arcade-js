// SPDX-License-Identifier: GPL-3.0-only
/**
 * armThePenRouteThenColdStartOnATamperedImage — put the tracing pen back at the start of its
 * route, then check the program image and cold-start on a tampered one.
 *
 * ROM 0x01E1-0x0200 (loc_01e1). Grounding: [seen] (names.js ROUTINES 0x01E1).
 *
 * What it is: some captions are drawn by a "pen" — a cursor that walks a fixed L-shaped route one
 * leg at a time, interpolating toward each leg's target and stamping a character cell at every
 * step (drawInterpolatedPenRun moves it, plotPenCell stamps). Three cells hold where it has got
 * to: PEN_ROUTE_LEG (0xA9E2) [seen], the leg it is on, and PEN_ROW_POS (0xA9E3) [seen] and
 * PEN_COLUMN_POS (0xA9E5) [seen], each an 8.8 fixed-point word — a whole-cell index in the high
 * byte and a fraction below it. This entry sends the pen back to leg zero at the route's first
 * point.
 *
 * The first point is not a literal: each coordinate is lifted from a fixed pair of program bytes
 * (PEN_ROUTE_START_ROW 0x0D45 = 0x1000, PEN_ROUTE_START_COLUMN 0x280C = 0x0400, i.e. row 0x10,
 * column 0x04 — the same point as entry zero, `10 04`, of the leg table at 0x0290), so the
 * route's start moves with the image.
 *
 * Then the anti-tamper check: a fixed 256-byte run of the image from PEN_ROUTE_CHECKSUM_BASE
 * (0x0E33) is summed into one eight-bit total and compared with 0xFD. The run lies wholly inside
 * the program image and holds neither seed word nor the leg table, so the total is a constant of
 * the image: a genuine image always gives 0xFD and the mismatch arm is dead. The arming above is
 * unconditional — the check gates nothing that came before it.
 *
 * On a tampered image the ROM calls the cold start at 0x0069, which clears two overlapping 48-byte runs (from 0xB411 and from 0xB410) of the second
 * sprite bank and all of work RAM (0xA800-0xAFFF, where the stack sits) and ends `jp 0x5866`,
 * never returning to this caller. That restart is not modelled as a call from inside a
 * frame, so here the mismatch arm raises instead.
 *
 * LIVE-OUT: memory only — the three pen cells.
 */

import { u8, u16 } from "../../../core/int.js";
import { PEN_COLUMN_POS, PEN_ROUTE_LEG, PEN_ROW_POS, PEN_ROUTE_START_ROW, PEN_ROUTE_CHECKSUM_BASE, PEN_ROUTE_START_COLUMN } from "./names.js";
import { NotImplemented } from "../../../boards/timeplt/io.js";

// The check covers 256 bytes (`ld b,0x00` gives djnz 256 turns)...
const CHECKED_BYTES = 0x100;
// ...and a genuine image sums to 0xFD (`sub 0xfd` leaves zero).
const GENUINE_TOTAL = 0xfd;

export function armThePenRouteThenColdStartOnATamperedImage(m) {
  const { mem8, mem16 } = m;
  // Back to the first leg: `xor a / ld (0xa9e2),a`.
  mem8[PEN_ROUTE_LEG] = 0;
  // Drop the pen on the route's first point. Each coordinate is copied as a 16-bit word
  // (`ld hl,(0x0d45) / ld (0xa9e3),hl`, then the same from 0x280C to 0xA9E5), so the whole-cell
  // index and its fraction land together (both seed words have a zero fraction byte).
  mem16[PEN_ROW_POS] = mem16[PEN_ROUTE_START_ROW];
  mem16[PEN_COLUMN_POS] = mem16[PEN_ROUTE_START_COLUMN];

  // Fold the checked run into one byte: `add a,(hl) / inc hl / djnz`, the total wrapping at
  // eight bits exactly as the accumulator does.
  let total = 0;
  for (let i = 0; i < CHECKED_BYTES; i++) total = u8(total + mem8[u16(PEN_ROUTE_CHECKSUM_BASE + i)]);
  // A mismatch is the ROM's `call nz,0x0069` into the cold start; see the header for why this
  // raises instead of restarting.
  if (total !== GENUINE_TOTAL) {
    throw new NotImplemented(
      "armThePenRouteThenColdStartOnATamperedImage: the folded image run missed its expected total, so the " +
        "image is tampered and the original would cold-start; a genuine image always matches",
    );
  }
}
