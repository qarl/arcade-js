// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_259e — memory-equivalent to the frozen oracle at ROM 0x259e (dissolves its fall-through call of the
 * tile-pair stamp-and-step into a direct idiomatic call).
 * Seeds the fixed tile code 0x2c, then stamps (HL)=0x2c and (HL+1)=0x2d, advancing HL past the pair by the
 * stride and the tile code by two. The advanced A (0x2e) and HL are register live-outs the caller's loop
 * chains into the next pair (invisible to the RAM diff), so EQUAL asserts ramDiff==null AND registers A+HL.
 * Incoming A is dirtied to prove the routine forces its own seed. Teeth: no-op, missing +1, wrong first
 * value (RAM); wrong-A and wrong-HL advance (registers).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_259e as cand } from "../loc_259e.js";
import { loc_259e as oracle } from "../../translated/loc_259e.js";

const DEST = 0x5100; // VIDEO RAM (0x5000-0x53ff), captured by dumpState, clear of the masked stack window
const SEED = 0x2c; // the fixed tile code the routine forces
const STRIDE = 0x001f;
const SENTINEL = 0xaa; // pre-poked into the two dest cells so the writes are demonstrable
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function entry(dest = DEST, stride = STRIDE) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.a = 0x99; // dirty A: the routine must overwrite it with its own seed
    m.regs.hl = dest;
    m.regs.de = stride;
    mem8[dest] = SENTINEL;
    mem8[(dest + 1) & 0xffff] = SENTINEL;
  });
}

// The advanced A/HL are register live-outs the caller chains; observe them directly (ramDiff is blind).
function ahlDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.a !== b.regs.a) return `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
  if (a.regs.hl !== b.regs.hl) return `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
  return null;
}

test("EQUAL: loc_259e == oracle across dests/strides (RAM + A + HL)", { skip }, () => {
  const cases = [
    [0x5100, 0x001f],
    [0x5200, 0xffdf], // up-stride
    [0x5040, 0x0020],
  ];
  for (const [d, s] of cases) {
    assert.equal(ramDiff(oracle, cand, entry(d, s)), null,
      `loc_259e RAM diverged (dest=0x${d.toString(16)} stride=0x${s.toString(16)})`);
    assert.equal(ahlDiff(cand, entry(d, s)), null,
      `loc_259e A/HL diverged (dest=0x${d.toString(16)} stride=0x${s.toString(16)})`);
  }
  // positive control: the oracle stamps the seed pair and advances A by two.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.mem8[DEST], SEED, "positive control: oracle stamped the first tile");
  assert.equal(a.regs.a, (SEED + 2) & 0xff, "positive control: oracle advanced A by two");
  console.log("  EQUAL: loc_259e == oracle (RAM + A + HL), horizontal pair stamped from the fixed seed");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const noInc = (m) => { m.mem8[DEST] = SEED; m.mem8[DEST + 1] = SEED; };      // 2nd cell missing +1
  const wrongFirst = (m) => { m.mem8[DEST] = SEED + 1; m.mem8[DEST + 1] = SEED + 1; };
  const wrongA = (m) => { cand(m); m.regs.a = (m.regs.a + 1) & 0xff; };
  const wrongHL = (m) => { cand(m); m.regs.hl = (m.regs.hl + 1) & 0xffff; };

  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, noInc, entry()), "the missing-+1 twin escaped");
  assert.ok(ramDiff(oracle, wrongFirst, entry()), "the wrong-first-value twin escaped");
  assert.ok(ahlDiff(wrongA, entry()), "the wrong-A-advance twin escaped (register)");
  assert.ok(ahlDiff(wrongHL, entry()), "the wrong-HL-advance twin escaped (register)");
  console.log("  TEETH: no-op, missing-+1, wrong-first (RAM), wrong-A, wrong-HL (registers) all caught");
});
