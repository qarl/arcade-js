// SPDX-License-Identifier: GPL-3.0-only
/** trampolineToLoc_307f — a bare tail transfer into a lifted destination: every input the destination reads is handed
 * straight through, control does not return here, and the live-out is whatever the destination leaves.
 *
 * ROM 0x3114-0x3116: the single instruction `jp 0x307f`. names.js tag: [code] -- "a bare transfer to
 * 0x307F and no return; no cell is read or written and no register moves".
 *
 * Role in the machine: the landing point of the divert arm of seedSceneryEntriesThenRunScenery. When
 * that routine's tamper-witness guard (TAMPER_WITNESS 0xAD39 not holding its planted glyph and colour)
 * fails, it jumps here instead of seating scenery, and this entry passes straight on to loc_307f --
 * the bytes of caption record 2 ("READY") at 0x307F decoded as code, which read as the tail of an
 * unrelated sprite-entry fill ([code] in names.js; mechanisms.md). The jump adds nothing of its own.
 *
 * What each argument carries (the Z80 register it rides in, as loc_307f reads it):
 *   pointer    (HL) -- the address the divert's guard was walking; loc_307f stores `coordinate` there;
 *   coordinate (E)  -- the caller's attribute stride, the byte stored through `pointer`;
 *   fold       (A)  -- the sentinel byte the guard read, folded against the stored byte;
 *   counter    (B)  -- the caller's spent attribute count, counted down by loc_307f's `djnz`;
 *   entry      (IY) -- the caller's sprite-entry cursor, where the placer lays its tile;
 *   offset     (C)  -- the era, the offset the placer applies to the tile;
 *   record     (IX) -- the caller's record cursor, stepped on with the entry cursor after the tile. */
import { loc_307f } from "./loc_307f.js";

export function trampolineToLoc_307f(m, pointer = m.regs.hl, coordinate = m.regs.e, fold = m.regs.a, counter = m.regs.b, entry = m.regs.iy, offset = m.regs.c, record = m.regs.ix) {
  // `jp 0x307f`: hand every input across unchanged and return whatever the destination returns.
  return loc_307f(m, pointer, coordinate, fold, counter, entry, offset, record);
}
