// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1ceb — memory-equivalent to the frozen oracle at ROM 0x1ceb (the up-a-column character draw loop).
 * GATE: crafted-entry. The routine reads its count from B and its source/destination/stride from the
 * ALTERNATE register bank (the ROM runs the loop through `exx`), so a post-attract seed is cloned and
 * those shadow bytes (b_/c_/d_/e_/h_/l_) plus B are poked: count 8, source at the ROM table 0x1d71,
 * destination at a VRAM column 0x5140, stride 0xffe0 (-0x20, one row up). The destination cells are
 * sentinelled and a return address pushed for the oracle's `ret`. Live-out is memory only, so RAM is
 * compared and the stack window masked. Teeth: a no-subtract twin (skips the '0' offset) and a stride-1
 * twin (writes across a row, not up a column) — each makes a RAM difference the diff catches.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { drawTextColumn as cand } from "../drawTextColumn.js";
import { loc_1ceb as oracle } from "../../translated/loc_1ceb.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const COUNT = 8;
const SRC = 0x1d71;      // ROM source bytes (deterministic)
const DEST = 0x5140;     // VRAM column cell the run starts at
const STRIDE = 0xffe0;   // -0x20: one tilemap row up per character
const CHAR_ZERO = 48;    // '0'
const SENTINEL = 0xee;

// Poke count (B) and the alternate-bank source/destination/stride, sentinel the destination column.
const entry = () => craft((mem, m) => {
  m.regs.b = COUNT;
  m.regs.d_ = (SRC >> 8) & 0xff; m.regs.e_ = SRC & 0xff;
  m.regs.h_ = (DEST >> 8) & 0xff; m.regs.l_ = DEST & 0xff;
  m.regs.b_ = (STRIDE >> 8) & 0xff; m.regs.c_ = STRIDE & 0xff;
  for (let k = 0; k < COUNT; k++) mem[(DEST + k * STRIDE) & 0xffff] = SENTINEL;
  m.push16(0x9999);
});

test("EQUAL (crafted): loc_1ceb == oracle over the column draw", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "the draw loop diverged");

  // Positive control: each character is (source byte - '0') and lands one row up from the last.
  const a = entry(); oracle(a);
  assert.equal(a.mem8[DEST], (a.mem8[SRC] - CHAR_ZERO) & 0xff, "control: char 0 at the column top");
  assert.equal(a.mem8[(DEST + STRIDE) & 0xffff], (a.mem8[SRC + 1] - CHAR_ZERO) & 0xff, "control: char 1 one row up");
  console.log("  EQUAL: 8 chars drawn up a column, each source byte mapped by -'0'");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const shadow = (m) => ({
    rd: (m.regs.d_ << 8) | m.regs.e_,
    wr: (m.regs.h_ << 8) | m.regs.l_,
    stride: (m.regs.b_ << 8) | m.regs.c_,
    passes: m.regs.b === 0 ? 256 : m.regs.b,
  });
  // Stores the raw source byte without the '0' offset — wrong tile codes.
  const noSub = (m) => { const { mem8 } = m; let { rd, wr, stride, passes } = shadow(m); for (let i = 0; i < passes; i++) { mem8[wr] = mem8[rd]; rd += 1; wr += stride; } };
  // Walks the destination by 1 (across a row) instead of by the stride (up a column) — wrong cells.
  const stride1 = (m) => { const { mem8 } = m; let { rd, wr, passes } = shadow(m); for (let i = 0; i < passes; i++) { mem8[wr] = mem8[rd] - CHAR_ZERO; rd += 1; wr += 1; } };
  assert.ok(ramDiff(oracle, noSub, entry()), "no-subtract twin escaped");
  assert.ok(ramDiff(oracle, stride1, entry()), "stride-1 twin escaped");
  console.log("  TEETH: no-subtract and stride-1 both caught by the RAM diff");
});
