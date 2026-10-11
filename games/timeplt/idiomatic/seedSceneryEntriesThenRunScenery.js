// SPDX-License-Identifier: GPL-3.0-only
/**
 * seedSceneryEntriesThenRunScenery — ROM 0x3117 [seen]
 *
 * WHAT IT IS. The below-era-4 half of scenery set-up. clearSceneryEntriesThenRunEraScenery clears
 * eight scenery sprite cells and, for eras 0-3, continues here; this seeds the first eight scenery
 * sprite slots from a four-row ROM table and then hands on to the frame's scenery run
 * (runSceneryForEra, 0x2CBC [seen]) with a tail jump.
 *
 * ROLE IN THE MACHINE. The seeding is guarded by an anti-tamper check. TAMPER_WITNESS (0xAD39
 * [seen]) is a glyph/colour pair the attract screen seeds with 0x68 and 0x05; this routine goes on
 * only when it reads 0x68 and the next cell 0x10 or 0x05. Under MAME the check always passes. On a
 * mismatch the ROM jumps (via trampolineToLoc_307f, 0x3114 [code]) into bytes at 0x307F that are
 * really caption data, the "READY" record, decoded as code (mechanisms.md, anti-tamper), instead
 * of seeding the scenery.
 *
 * Each table row (SCENERY_SEED_TABLE 0x316E) is a packed byte pair that fills TWO sprite slots, at
 * the entry cursor and two bytes on: the first byte goes to +0x31 of the first slot and, plus 0x10,
 * to +0x31 of the second; the second byte goes to +0x00 of both. +0x31 and +0x00 are where a
 * sprite entry keeps its native-Y and native-X, so each pair is a starting position.
 *
 * PARAMETERS (all from the caller, and read only by the divert arm): `era` (the ROM's C),
 * `entryCursor` (IY), `clearStride` (E), `clearCount` (B, the caller's clear loop's spent count) and
 * `recordCursor` (IX, which the placed tile's closing step advances with the entry cursor).
 * On the seat arm every register the body touches is dead-after-return scratch -- the scenery run
 * reseats both cursors before reading either -- so it lives here as JS locals. The divert arm is
 * different: the divert's destination stores the caller's clear stride through the walked pointer,
 * folds the byte under it, counts the caller's spent clear count down (wrapping, so it keeps to its
 * one-tile arm) and places one tile through the caller's entry cursor offset by the era -- so the
 * pointer, the byte, the era, the cursors, the stride and the count are all handed across.
 * LIVE-OUT: memory.
 */

import { u16 } from "../../../core/int.js";
import { trampolineToLoc_307f } from "./trampolineToLoc_307f.js";
import { runSceneryForEra } from "./runSceneryForEra.js";
import { SCENERY_ENTRY_SLOT0, TAMPER_WITNESS, SCENERY_SEED_TABLE } from "./names.js";

// Four table rows (`ld b,0x04` ... `djnz`), two sprite slots seeded per row.
const OBJECTS = 4;
// The values the witness pair must hold: glyph 0x68, then 0x10 or 0x05 (ROM 0x311B-0x3129).
const SENTINEL_MATCH = 0x68;
const SUBGUARD_A = 0x10;
const SUBGUARD_B = 0x05;
const SEED_STRIDE = 2; // packed (nativeY,nativeX) pair a row
const SEAT_STRIDE = 4; // entry cursor steps four bytes (two two-byte slots) a row
const NATIVE_Y = 0x31; // native Y lands at entry +0x31
const NEXT_SLOT_NATIVE_Y = 0x33; // the next slot's native Y
const NEXT_SLOT_Y_STEP = 0x10; // next slot's Y = this slot's Y plus this

export function seedSceneryEntriesThenRunScenery(m, era = m.regs.c, entryCursor = m.regs.iy, clearStride = m.regs.e, clearCount = m.regs.b, recordCursor = m.regs.ix) {
  const { mem8 } = m;

  // The sentinel pointer and the byte under it both ride on into the divert, with the caller's inputs.
  const divert = (guard, sentinel) =>
    trampolineToLoc_307f(m, guard, clearStride, sentinel, clearCount, entryCursor, era, recordCursor);
  // Step 1 -- the witness check. First cell must read 0x68 (`cp 0x68` / `jp nz,0x3114`) ...
  let guard = TAMPER_WITNESS;
  let sentinel = mem8[guard];
  if (sentinel !== SENTINEL_MATCH) return divert(guard, sentinel);
  // ... and the cell after it 0x10 or 0x05 (`inc hl` / `cp 0x10` / `cp 0x05` / `jp nz,0x3114`).
  guard = u16(guard + 1);
  sentinel = mem8[guard];
  if (sentinel !== SUBGUARD_A && sentinel !== SUBGUARD_B) return divert(guard, sentinel);

  // Step 2 -- seed. Walk the four rows from SCENERY_SEED_TABLE 0x316E while the entry cursor starts at
  // SCENERY_ENTRY_SLOT0 0xAA30 [seen] (ROM 0x312C-0x3151). Per row: the first byte to +0x31 of this
  // slot and, 0x10 higher, to +0x31 of the next slot (+0x33 from the cursor); the second byte to +0
  // of both slots. The ROM also steps IX by 0x10 a row, but nothing reads IX afterwards.
  let src = SCENERY_SEED_TABLE;
  let entry = SCENERY_ENTRY_SLOT0;
  for (let n = OBJECTS; n !== 0; n--) {
    const nativeY = mem8[src];
    mem8[u16(entry + NATIVE_Y)] = nativeY;
    mem8[u16(entry + NEXT_SLOT_NATIVE_Y)] = nativeY + NEXT_SLOT_Y_STEP;
    const nativeX = mem8[u16(src + 1)];
    mem8[entry] = nativeX;
    mem8[u16(entry + 2)] = nativeX;
    src = u16(src + SEED_STRIDE);
    entry = u16(entry + SEAT_STRIDE);
  }

  // Step 3 -- hand on to the scenery run (`jp 0x2cbc`, a tail jump: its return is this routine's).
  return runSceneryForEra(m);
}
