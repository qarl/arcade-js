// SPDX-License-Identifier: GPL-3.0-only
/** copyThreeTilemapCellsFromBothPlanes — take a copy of three tilemap cells, each into its own two-byte keep.
 * A table in the program image supplies three records of two addresses: where to read, and where
 * to put what was read. Each cell is read TWICE, a fixed distance apart, because the two planes of
 * the tilemap sit that far from one another — so what a keep holds is the pair of bytes belonging
 * to ONE cell, not two cells. The pair is stored the second read first. Both of the arithmetic
 * steps are deliberately narrow: the distance is added to the high half of the source alone and
 * the keep is stepped in its low half alone, so either would wrap inside its own page rather than
 * carry out of it.
 *
 * ROM 0x4B30-0x4B4A (frozen lift translated/loc_4b30.js). Grounding: [seen].
 *
 * Role in the machine: its one caller is startOnePlayerGame, which runs it after painting the
 * credit-count panel and before seating sequence phase 3. The ROM parks the first byte in the
 * alternate accumulator (`ex af,af'`) while it reads the second; here it is simply held in a local.
 *
 * LIVE-OUT: memory, six bytes. */

import { u8, u16 } from "../../../core/int.js";
import { TILEMAP_CELL_KEEP_RECORD_TABLE } from "./names.js";

// Three records (`ld b,0x03`).
const CELLS = 3;
// The gap between a cell and its twin in the other plane is 0x0400, i.e. 4 added to the high byte
// (ROM `ld a,0x04 / add a,d / ld d,a`).
const PLANE_GAP_HIGH = 4;

export function copyThreeTilemapCellsFromBothPlanes(m) {
  const { mem8, mem16 } = m;
  // The ROM table of three four-byte records {source lo, source hi, keep lo, keep hi} (`ld hl,0x0d1b`).
  let record = TILEMAP_CELL_KEEP_RECORD_TABLE;
  for (let i = 0; i < CELLS; i++) {
    /* Read the record: the source cell's address, then the keep's address, and step to the next
     * record four bytes on. */
    const source = mem16[record];
    const keep = mem16[u16(record + 2)];
    record = u16(record + 4);

    /* Read the cell in its first plane, then its twin 0x0400 higher. Only the high byte takes the
     * gap (an eight-bit `add a,d`), so a source near the top of memory would wrap within the high
     * byte rather than carry. */
    const first = mem8[source];
    const otherPlane = (u8((source >> 8) + PLANE_GAP_HIGH) << 8) | (source & 0xff);
    const second = mem8[otherPlane];

    /* Store the pair, the second read at the keep and the first read one byte on. The ROM steps
     * the keep with `inc e`, the low byte only, so the second byte stays in the keep's page. */
    mem8[keep] = second;
    mem8[(keep - (keep & 0xff)) | u8(keep + 1)] = first;
  }
}
