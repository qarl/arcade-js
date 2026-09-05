// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0598 — memory-equivalent to the frozen oracle at ROM 0x0598 (the strided 32-byte table copy).
 * GATE: crafted-entry. The routine takes its source base in HL, so a post-attract seed is cloned, HL
 * pointed at the ROM data table its usual caller uses (0x1d71), the destination region sentinelled so
 * every write is observable, and a return address pushed for the oracle's `ret`. Live-out is memory
 * only (the ROM's drained counter and advanced pointers are dead), so RAM is compared and the stack
 * window masked. Teeth: no-op, a stride-1 (contiguous) twin, and a short (16-entry) twin — each makes a
 * RAM difference the diff catches.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { loc_0598 as cand } from "../loc_0598.js";
import { loc_0598 as oracle } from "../../translated/loc_0598.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SRC = 0x1d71;   // the ROM data table the usual caller (0x0595) points HL at
const DEST = 0x4021;  // destination base; the copy lands at 0x4021, 0x4023 … 0x405f
const SENTINEL = 0xee;

// HL = the source base; sentinel the whole 0x4020..0x405f window so a missed/extra/wrong write shows.
const entry = () => craft((mem, m) => {
  for (let a = 0x4020; a <= 0x405f; a++) mem[a] = SENTINEL;
  m.regs.hl = SRC;
  m.push16(0x9999);
});

test("EQUAL (crafted): loc_0598 == oracle over the strided copy", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "the copy diverged");

  // Positive control: odd cells take the source bytes in order; the even cells between are untouched.
  const a = entry(); oracle(a);
  assert.equal(a.mem8[0x4021], a.mem8[SRC], "control: entry 0 copied to 0x4021");
  assert.equal(a.mem8[0x4023], a.mem8[SRC + 1], "control: entry 1 copied to 0x4023");
  assert.equal(a.mem8[0x405f], a.mem8[SRC + 31], "control: entry 31 copied to 0x405f");
  assert.equal(a.mem8[0x4022], SENTINEL, "control: the even cell between stays untouched");
  console.log("  EQUAL: 32 bytes copied to odd cells 0x4021..0x405f, even cells left alone");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  // Writes contiguously (stride 1) instead of stride 2 — clobbers the even cells the ROM leaves alone.
  const stride1 = (m, srcPtr = m.regs.hl) => { const { mem8 } = m; for (let i = 0; i < 32; i++) mem8[DEST + i] = mem8[srcPtr + i]; };
  // Copies only the first 16 entries — leaves 0x4041..0x405f unwritten.
  const short = (m, srcPtr = m.regs.hl) => { const { mem8 } = m; for (let i = 0; i < 16; i++) mem8[DEST + i * 2] = mem8[srcPtr + i]; };
  assert.ok(ramDiff(oracle, noOp, entry()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, stride1, entry()), "stride-1 twin escaped");
  assert.ok(ramDiff(oracle, short, entry()), "short twin escaped");
  console.log("  TEETH: no-op, stride-1, short all caught by the RAM diff");
});
