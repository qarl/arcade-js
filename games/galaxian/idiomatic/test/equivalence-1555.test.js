// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1555 — memory-equivalent to the frozen oracle at ROM 0x1555.
 * A guarded two-tier timer updater; all live-outs are work-RAM cells (register A is dead — the next handler
 * in the call chain reloads it), so RAM equivalence is the whole story. We cover every path:
 *   - GATE CLOSED: an enable bit disagrees -> nothing written.
 *   - OUTER TICK: mode clear, outer timer not elapsed -> only the outer timer decrements.
 *   - FIXED ARM: mode clear, both cascade timers elapse -> reload timers + the fixed output triple.
 *   - MODE=2: mode set, its selector bit set -> value 2 fanned into the output triple.
 *   - DERIVE: mode set, selector clear, both word sums nonzero -> derived value into the triple.
 *   - DERIVE ABORT: mode set, selector clear, second word sum == 0 -> restore inner timer, write no output.
 * EQUAL asserts ramDiff==null on each with a non-vacuous positive control. Teeth: no-op, gate-ignoring,
 * wrong-reload, wrong-rotate twins each diverge. The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_1555 as cand } from "../loc_1555.js";
import { loc_1555 as oracle } from "../../translated/loc_1555.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const G0 = 0x4200, G1 = 0x41ef, G2 = 0x422b; // enable gates (bit 0): set, set, clear
const MODE = 0x4006, SEL = 0x4221;            // mode bit and its selector (bit 0)
const OUTER = 0x4245, INNER = 0x4246;         // cascade timers
const W1 = 0x4177, W2 = 0x421a;               // word cells feeding the derive path
const O1 = 0x422f, O2 = 0x424a, FLAG = 0x422e; // output triple
const SENT = 0xaa;                             // sentinel in output cells so writes are observable

// Open the three enable gates and pre-dirty the output triple.
function base(mem) {
  mem[G0] = 0x01; mem[G1] = 0x01; mem[G2] = 0x00;
  mem[O1] = SENT; mem[O2] = SENT; mem[FLAG] = SENT;
}

// An enable bit disagrees: the routine must write nothing (timers armed as if it would otherwise fire).
const gateClosed = () => craft((mem, mm) => {
  mm.push16(0x9999); base(mem); mem[G0] = 0x00;
  mem[MODE] = 0x00; mem[OUTER] = 1; mem[INNER] = 1;
});
// Mode clear, outer timer still counting.
const outerTick = () => craft((mem, mm) => {
  mm.push16(0x9999); base(mem); mem[MODE] = 0x00; mem[OUTER] = 5;
});
// Mode clear, both cascade timers elapse this frame.
const fixedArm = () => craft((mem, mm) => {
  mm.push16(0x9999); base(mem); mem[MODE] = 0x00; mem[OUTER] = 1; mem[INNER] = 1;
});
// Mode set, selector set -> value 2.
const modeTwo = () => craft((mem, mm) => {
  mm.push16(0x9999); base(mem); mem[MODE] = 0x01; mem[OUTER] = 1; mem[SEL] = 0x01;
});
// Mode set, selector clear, both word sums nonzero -> derive.
const derive = () => craft((mem, mm) => {
  mm.push16(0x9999); base(mem); mem[MODE] = 0x01; mem[OUTER] = 1; mem[SEL] = 0x00; mem[INNER] = 1;
  mem[W1] = 0x02; mem[W1 + 1] = 0x01; // word 0x0102 -> byte-sum 3
  mem[W2] = 0x02; mem[W2 + 1] = 0x01; // word 0x0102 -> byte-sum 3
});
// Mode set, selector clear, second word byte-sum == 0 -> abort after restoring the inner timer.
const deriveAbort = () => craft((mem, mm) => {
  mm.push16(0x9999); base(mem); mem[MODE] = 0x01; mem[OUTER] = 1; mem[SEL] = 0x00; mem[INNER] = 1;
  mem[W1] = 0x02; mem[W1 + 1] = 0x01;
  mem[W2] = 0x80; mem[W2 + 1] = 0x80; // word 0x8080 -> byte-sum 0x100 & 0xff == 0
});

function ramAfter(fn, e) { const m = e.clone(); m.routines = STUBS; fn(m); return m; }

// Twins.
const noOp = () => {};
const ignoreGate = (m) => { // arms the fixed triple regardless of the gates
  m.mem8[OUTER] = 60; m.mem8[INNER] = 5; m.mem8[O1] = 90; m.mem8[O2] = 45; m.mem8[FLAG] = 1;
};
const wrongReload = (m) => { cand(m); m.mem8[OUTER] = 59; };       // outer reload off by one
const wrongRotate = (m) => { cand(m); m.mem8[O1] = (m.mem8[O1] + 1) & 0xff; }; // corrupt an output

test("EQUAL (crafted): loc_1555 == oracle across every path", { skip }, () => {
  for (const [name, e] of [
    ["gate-closed", gateClosed], ["outer-tick", outerTick], ["fixed-arm", fixedArm],
    ["mode-2", modeTwo], ["derive", derive], ["derive-abort", deriveAbort],
  ]) {
    assert.equal(ramDiff(oracle, cand, e()), null, `loc_1555 diverged on ${name}`);
  }

  // Positive controls: the oracle really moves the live-outs on each active path.
  assert.equal(ramAfter(oracle, gateClosed()).mem8[FLAG], SENT, "gate-closed should write nothing");
  assert.equal(ramAfter(oracle, outerTick()).mem8[OUTER], 4, "outer-tick should decrement 5->4");
  const fa = ramAfter(oracle, fixedArm());
  assert.equal(fa.mem8[O1], 90, "fixed-arm O1"); assert.equal(fa.mem8[O2], 45, "fixed-arm O2");
  assert.equal(fa.mem8[OUTER], 60, "fixed-arm outer reload"); assert.equal(fa.mem8[INNER], 5, "fixed-arm inner reload");
  const m2 = ramAfter(oracle, modeTwo());
  assert.equal(m2.mem8[O1], 8, "mode-2 O1 = rotl2(2)"); assert.equal(m2.mem8[O2], 16, "mode-2 O2 = rotl3(2)");
  const dv = ramAfter(oracle, derive());
  assert.equal(dv.mem8[INNER], 6, "derive computes inner = 6"); assert.equal(dv.mem8[O1], 24, "derive O1 = rotl2(6)");
  const da = ramAfter(oracle, deriveAbort());
  assert.equal(da.mem8[INNER], 1, "derive-abort restores inner to 1"); assert.equal(da.mem8[FLAG], SENT, "derive-abort writes no output");
  console.log("  EQUAL: loc_1555 == oracle on all six paths");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, fixedArm()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, ignoreGate, gateClosed()), "the gate-ignoring twin escaped");
  assert.ok(ramDiff(oracle, wrongReload, fixedArm()), "the wrong-reload twin escaped");
  assert.ok(ramDiff(oracle, wrongRotate, modeTwo()), "the wrong-rotate twin escaped");
  console.log("  TEETH: no-op, gate-ignoring, wrong-reload, wrong-rotate all caught");
});
