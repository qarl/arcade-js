// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_25a0 — memory-equivalent to the frozen oracle at ROM 0x25A0.
 * Tile-pair stamp: writes `tile` at HL and `tile+1` at HL+1. A crafted entry seats A (tile), HL (dest,
 * in VIDEO RAM) and DE (stride) plus a ret. The advanced A (tile+2) and HL ((HL+1)+stride) are register
 * live-outs the callers consume (0x259a does `add a,0xfc` on A; the 0x255a loop chains HL into the next
 * call), invisible to the RAM diff — so EQUAL asserts the two tile writes (ramDiff) AND registers A + HL.
 * Teeth: no-op, missing +1, single-cell, wrong first value (RAM); wrong-A and wrong-HL advance (registers).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_25a0 as cand } from "../loc_25a0.js";
import { loc_25a0 as oracle } from "../../translated/loc_25a0.js";

const DEST = 0x5100; // VIDEO RAM (0x5000-0x53ff), captured by dumpState, clear of the masked stack window
const TILE = 0x40;
const STRIDE = 0x001f;
const SENTINEL = 0xaa; // pre-poked into the two dest cells (differs from every stamped value) so the
                       // oracle demonstrably changes them and the no-op/short twins cannot alias prior VRAM
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A crafted entry with A=tile, HL=dest, DE=stride, the two dest cells pre-dirtied, and a return address
// on the stack for the oracle's ret.
function entry(tile = TILE, dest = DEST, stride = STRIDE) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.a = tile;
    m.regs.hl = dest;
    m.regs.de = stride;
    mem8[dest] = SENTINEL;
    mem8[(dest + 1) & 0xffff] = SENTINEL;
  });
}

// The advanced A/HL are register live-outs the callers chain; observe them directly (ramDiff is blind).
function ahlDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.a !== b.regs.a) return `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
  if (a.regs.hl !== b.regs.hl) return `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
  return null;
}

// Broken twins (each one wrong write) that must make the RAM diff non-null.
function brokenNoOp() {}
function brokenNoInc(m) { m.mem8[DEST] = TILE; m.mem8[DEST + 1] = TILE; }          // 2nd cell missing +1
function brokenShort(m) { m.mem8[DEST] = TILE; }                                    // only the first cell
function brokenFirst(m) { m.mem8[DEST] = TILE + 1; m.mem8[DEST + 1] = TILE + 1; }  // wrong first value
// Correct RAM writes but wrong register advance.
function brokenAdvA(m) { cand(m); m.regs.a = (m.regs.a + 1) & 0xff; }
function brokenAdvHL(m) { cand(m); m.regs.hl = (m.regs.hl + 1) & 0xffff; }

test("EQUAL: loc_25a0 == oracle across tiles/strides (RAM + A + HL)", { skip }, () => {
  const cases = [
    [0x40, 0x5100, 0x001f],
    [0xff, 0x5200, 0xffdf], // tile wraps 0xff->0x00 on the second cell; up-stride
    [0x00, 0x5040, 0x0020],
  ];
  for (const [t, d, s] of cases) {
    assert.equal(ramDiff(oracle, cand, entry(t, d, s)), null,
      `loc_25a0 RAM diverged (tile=0x${t.toString(16)} dest=0x${d.toString(16)} stride=0x${s.toString(16)})`);
    assert.equal(ahlDiff(cand, entry(t, d, s)), null,
      `loc_25a0 A/HL diverged (tile=0x${t.toString(16)} stride=0x${s.toString(16)})`);
  }
  assert.ok(ramDiff(oracle, brokenNoOp, entry()), "vacuous: oracle changed no RAM");
  // non-vacuous on registers: the oracle advances A by two and HL past the pair.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.regs.a, (TILE + 2) & 0xff, "oracle did not advance A by two");
  console.log("  EQUAL: loc_25a0 == oracle (RAM + A + HL), tile pair stamped");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, brokenNoInc, entry()), "the missing-+1 twin escaped");
  assert.ok(ramDiff(oracle, brokenShort, entry()), "the single-cell twin escaped");
  assert.ok(ramDiff(oracle, brokenFirst, entry()), "the wrong-first-value twin escaped");
  assert.ok(ahlDiff(brokenAdvA, entry()), "the wrong-A-advance twin escaped (register)");
  assert.ok(ahlDiff(brokenAdvHL, entry()), "the wrong-HL-advance twin escaped (register)");
  console.log("  TEETH: no-op, missing-+1, single-cell, wrong-first (RAM), wrong-A, wrong-HL (registers) all caught");
});
