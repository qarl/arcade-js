// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_22f1 — memory-equivalent to the frozen oracle at ROM 0x22f1.
 * Message painter: the index (A) picks a record from the pointer table at 0x235c and its top two bits
 * pick the mode. Record 0 is "GAME  OVER" at VRAM 0x5296. We exercise all three modes off that record:
 *   - GLYPH (index 0): each char's tile (char - 0x30) painted up the column.
 *   - BLANK (index | 0x80): tile 0x40 painted over each char cell up the column.
 *   - POSITION (index | 0x40): stash the dest/text/cursor pointers (0x40b5/0x40b3/0x40b1), pack the row
 *     byte into the cursor cell, clear a 32-cell column to tile 0x10, and raise the scroll flag (0x40b0).
 * All writes land in work RAM / VIDEO RAM, so ramDiff sees them (no register or io live-out; callers
 * overwrite A right after). EQUAL asserts ramDiff==null on each mode with positive controls; teeth cover
 * a no-op plus one wrong reimplementation per mode. The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_22f1 as cand } from "../loc_22f1.js";
import { loc_22f1 as oracle } from "../../translated/loc_22f1.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TABLE = 0x235c; // record-pointer table base
const REC0_DEST = 0x5296; // record 0's VRAM column top ("GAME  OVER")
const MSG_ENABLE = 0x40b0; // scroll enable flag (raised by the position path)
const MSG_DEST = 0x40b5; // stashed VRAM dest pointer (16-bit)
const CLEARED_CELL = 0x5016; // 0x5000 + (0x96 & 0x1f): first cell of the cleared column
const CURSOR_CELL = 0x404c; // 0x4020 + 2*(0x96 & 0x1f): the packed row byte lands here
const END = 63;

// Craft an entry running message index `idx` (with mode bits), plus a ret address.
const at = (idx) => craft((mem8, m) => { m.push16(0x9999); m.regs.a = idx; });

// Independent wrong reimplementations that walk record 0's real text with one deliberate bug.
function walkWrong(m, tileOf) {
  const { mem8, mem16 } = m;
  const dest = mem16[mem16[TABLE]];
  for (let dst = dest, src = mem16[TABLE] + 2; mem8[src] !== END; src++, dst = (dst - 0x20) & 0xffff) {
    mem8[dst] = tileOf(mem8[src]);
  }
}
const brokenNoOp = () => {};
const glyphRaw = (m) => walkWrong(m, (b) => b); // forgets the char->tile bias
const blankTile10 = (m) => walkWrong(m, () => 0x10); // wrong blank tile
const posNoFlag = (m) => { cand(m); m.mem8[MSG_ENABLE] = 0; }; // never raised the scroll flag
const posBadPack = (m) => { cand(m); m.mem8[CURSOR_CELL] = (m.mem8[CURSOR_CELL] ^ 0xff) & 0xff; }; // wrong packed byte

test("EQUAL (glyph): loc_22f1 == oracle paints each char's tile up the column", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, at(0)), null, "loc_22f1 diverged on the glyph path");
  const a = at(0); oracle(a);
  assert.equal(a.mem8[REC0_DEST], 0x47 - 0x30, "positive control: oracle painted the first glyph");
  assert.equal(a.mem8[REC0_DEST - 0x20], 0x41 - 0x30, "positive control: oracle painted up one row");
  console.log("  EQUAL: loc_22f1 == oracle (glyph), tiles painted up the column");
});

test("EQUAL (blank): loc_22f1 == oracle blanks each char cell up the column", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, at(0x80)), null, "loc_22f1 diverged on the blank path");
  const a = at(0x80); oracle(a);
  assert.equal(a.mem8[REC0_DEST], 0x40, "positive control: oracle blanked the first cell");
  assert.equal(a.mem8[REC0_DEST - 0x20], 0x40, "positive control: oracle blanked up one row");
  console.log("  EQUAL: loc_22f1 == oracle (blank), cells blanked up the column");
});

test("EQUAL (position): loc_22f1 == oracle stashes the cursor and clears the column", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, at(0x40)), null, "loc_22f1 diverged on the position path");
  const a = at(0x40); oracle(a);
  assert.equal(a.mem8[MSG_ENABLE], 1, "positive control: oracle raised the scroll flag");
  assert.equal(a.mem8[MSG_DEST] | (a.mem8[MSG_DEST + 1] << 8), REC0_DEST, "positive control: oracle stashed the dest pointer");
  assert.equal(a.mem8[CLEARED_CELL], 0x10, "positive control: oracle cleared the column");
  assert.equal(a.mem8[CURSOR_CELL], 0xa0, "positive control: oracle wrote the packed row byte");
  console.log("  EQUAL: loc_22f1 == oracle (position), cursor stashed and column cleared");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, at(0)), "the no-op twin escaped (glyph)");
  assert.ok(ramDiff(oracle, brokenNoOp, at(0x80)), "the no-op twin escaped (blank)");
  assert.ok(ramDiff(oracle, brokenNoOp, at(0x40)), "the no-op twin escaped (position)");
  assert.ok(ramDiff(oracle, glyphRaw, at(0)), "the raw-glyph twin escaped");
  assert.ok(ramDiff(oracle, blankTile10, at(0x80)), "the wrong-blank-tile twin escaped");
  assert.ok(ramDiff(oracle, posNoFlag, at(0x40)), "the no-flag twin escaped");
  assert.ok(ramDiff(oracle, posBadPack, at(0x40)), "the wrong-packed-byte twin escaped");
  console.log("  TEETH: no-op (x3 modes), raw-glyph, wrong-blank, no-flag, wrong-pack all caught");
});
