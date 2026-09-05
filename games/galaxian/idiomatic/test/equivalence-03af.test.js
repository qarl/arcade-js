// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_03af — memory-equivalent to the frozen oracle at ROM 0x03af.
 * Copies three source bytes up a video-RAM column (destination low byte -0x20 per byte), then advances
 * the low byte +0x62 to line up the next column. A crafted entry seats HL (source), DE (VRAM column) and
 * a ret. The three VRAM writes are visible to ramDiff; the advanced HL (src+3), DE (E+2) and A (=E) are
 * REGISTER live-outs the caller loop chains into the next call and are invisible to the RAM diff — so
 * EQUAL asserts ramDiff==null AND a register compare. Teeth: no-op, contiguous stride, two-byte (RAM);
 * wrong-HL, wrong-DE, wrong-A advance (registers). The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_03af as cand } from "../loc_03af.js";
import { loc_03af as oracle } from "../../translated/loc_03af.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SRC = 0x41f0; // work-RAM source, pre-poked (captured by dumpState, clear of the masked stack)
const DST = 0x5193; // VIDEO RAM column top; -0x20 walks up to 0x5173, 0x5153
const BYTES = [0x11, 0x22, 0x33];

// A crafted entry: HL=source, DE=VRAM column, three recognizable source bytes, plus a ret address.
function entry(src = SRC, dst = DST) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.hl = src;
    m.regs.de = dst;
    m.regs.c = 0x77; // a nonzero C the oracle overwrites with its own count -- must not leak out
    for (let i = 0; i < BYTES.length; i++) mem8[(src + i) & 0xffff] = BYTES[i];
  });
}

// The advanced HL/DE/A are register live-outs the caller chains; observe them directly (ramDiff is blind).
function regDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.hl !== b.regs.hl) return `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
  if (a.regs.de !== b.regs.de) return `DE: 0x${a.regs.de.toString(16)} vs 0x${b.regs.de.toString(16)}`;
  if (a.regs.a !== b.regs.a) return `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
  return null;
}

// Broken twins (each one wrong write) that must make the RAM diff non-null.
const brokenNoOp = () => {};
const brokenContig = (m) => { m.mem8[DST] = BYTES[0]; m.mem8[DST + 1] = BYTES[1]; m.mem8[DST + 2] = BYTES[2]; };
const brokenTwoByte = (m) => { m.mem8[DST] = BYTES[0]; m.mem8[DST - 0x20] = BYTES[1]; };
// Correct RAM writes but wrong register advance.
const brokenAdvHL = (m) => { cand(m); m.regs.hl = (m.regs.hl + 1) & 0xffff; };
const brokenAdvDE = (m) => { cand(m); m.regs.de = (m.regs.de + 1) & 0xffff; };
const brokenAdvA = (m) => { cand(m); m.regs.a = (m.regs.a + 1) & 0xff; };

test("EQUAL: loc_03af == oracle up a VRAM column (RAM + HL + DE + A)", { skip }, () => {
  const cases = [
    [SRC, 0x5193], // low byte high enough that the walk stays in page
    [SRC, 0x5010], // low byte 0x10 < 0x20: the walk wraps within the page (0x5010 -> 0x50f0 -> 0x50d0)
    [SRC, 0x5220],
  ];
  for (const [s, d] of cases) {
    assert.equal(ramDiff(oracle, cand, entry(s, d)), null, `loc_03af RAM diverged (dst=0x${d.toString(16)})`);
    assert.equal(regDiff(cand, entry(s, d)), null, `loc_03af HL/DE/A diverged (dst=0x${d.toString(16)})`);
  }
  // non-vacuous: the oracle really writes the first byte and advances HL/DE/A.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.mem8[DST], BYTES[0], "positive control: oracle did not write the first byte");
  assert.equal(a.mem8[DST - 0x20], BYTES[1], "positive control: oracle did not write up one row");
  assert.equal(a.regs.hl, (SRC + 3) & 0xffff, "positive control: oracle did not advance HL by three");
  assert.equal(a.regs.de & 0xff, (DST + 2) & 0xff, "positive control: oracle did not advance E by two");
  console.log("  EQUAL: loc_03af == oracle (RAM + HL + DE + A), three bytes up the column");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, brokenContig, entry()), "the contiguous-stride twin escaped");
  assert.ok(ramDiff(oracle, brokenTwoByte, entry()), "the two-byte twin escaped");
  assert.ok(regDiff(brokenAdvHL, entry()), "the wrong-HL-advance twin escaped (register)");
  assert.ok(regDiff(brokenAdvDE, entry()), "the wrong-DE-advance twin escaped (register)");
  assert.ok(regDiff(brokenAdvA, entry()), "the wrong-A-advance twin escaped (register)");
  console.log("  TEETH: no-op, contiguous, two-byte (RAM), wrong-HL, wrong-DE, wrong-A (registers) all caught");
});
