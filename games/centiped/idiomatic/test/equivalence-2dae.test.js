// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for decrementActiveObjectDelay (ROM 0x2dae) -- saves the caller index, decrements the
// active object's $94,X delay counter, and TAIL-falls into the accumulator-advance spine (0x2db6). No
// register/flag live-out, so the arms compare work RAM (dumpState, minus stack scratch below the entry SP). Both sides invoke
// the SAME frozen 0x2db6, so the only routine-local effect under test is the delay decrement. The dispatch
// is a +2 tail-transfer (2db6's ret pops the caller slot), so the SP-tooth expects a placeable tail and a
// stray-stack mutant refused.
// Run: node --test games/centiped/idiomatic/test/equivalence-2dae.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2dae as oracleRom } from "../../translated/loc_2dae.js";
import { decrementActiveObjectDelay } from "../decrementActiveObjectDelay.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_86, loc_88, loc_8d, loc_94 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2dae;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before a boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seat the delay bank + active-object selector + caller index. $86 negative makes the frozen spine an
// instant return (no BCD math), which keeps the crafted arms fast and watchdog-free unless a case overrides.
function seed({ x = 3, obj = 0, delay = 0x05, m86 = 0x80, extra } = {}) {
  const m = new Machine(ROM);
  m.regs.x = x;
  m.mem8[loc_88] = obj;
  m.mem8[(loc_94 + obj) & 0xff] = delay;
  m.mem8[loc_86] = m86;
  if (extra) extra(m);
  return m;
}

test("CAPTURE: real 0x2dae dispatches -- decrementActiveObjectDelay == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); decrementActiveObjectDelay(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: delay decrement + tail into the spine == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "spine early-out ($86 negative), obj 0", x: 3, obj: 0, delay: 0x05 },
    { tag: "delay wraps 0->0xff", x: 1, obj: 2, delay: 0x00 },
    { tag: "obj != caller index", x: 7, obj: 5, delay: 0x40 },
    // $86 non-negative: exercise the real BCD advance, seeded so the target is never reached (no watchdog).
    { tag: "spine BCD advance (target unreached)", x: 2, obj: 0, delay: 0x09, m86: 0x00,
      extra: (m) => { m.mem8[0x00ad] = 0xff; m.mem8[0x00af] = 0xff; } },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); decrementActiveObjectDelay(c);
    assert.equal(ramDiff(o, c), null, cs.tag);
  }
});

test("CRAFTED: the decremented $94,X entry matches the oracle byte-for-byte", () => {
  const cs = { x: 4, obj: 3, delay: 0x07 };
  const o = seed(cs), c = seed(cs);
  oracle(o); decrementActiveObjectDelay(c);
  assert.equal(c.mem8[(loc_94 + 3) & 0xff], 0x06, "delay counter decremented");
  assert.equal(c.mem8[loc_8d], 4, "caller index saved");
  assert.equal(o.mem8[(loc_94 + 3) & 0xff], c.mem8[(loc_94 + 3) & 0xff], "matches oracle");
});

test("TEETH: a twin that skips the decrement is caught by the RAM diff", () => {
  const brokenNoDec = (mm) => {
    mm.mem8[loc_8d] = mm.regs.x;
    const obj = mm.mem8[loc_88]; // BUG: never decrements $94,obj
    void obj;
    return mm.call(0x2db6);
  };
  const cs = { x: 4, obj: 3, delay: 0x07 };
  const o = seed(cs), c = seed(cs);
  oracle(o); brokenNoDec(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped delay decrement");
});

test("SP-TOOTH: the +2 tail-transfer places; a stray-stack mutant is refused", () => {
  const mk = () => {
    const m = seed({ x: 3, obj: 0, delay: 0x05, m86: 0x80 });
    m.regs.s = 0xfb;
    m.mem.write16(0x0100 | ((m.regs.s + 1) & 0xff), 0xabcd); // a real caller-return word for the seam
    return m;
  };
  assert.equal(
    seamPlaceable(withOmittedRet, decrementActiveObjectDelay, TARGET, mk()).placeable,
    true,
    "decrementActiveObjectDelay must reach its ret as a +2 tail-transfer",
  );
  // A net-nonzero SP move (two stray pushes over the +2 tail base) is not 0 and not +2/slot -> refused.
  const strayMutant = (mm) => { const r = decrementActiveObjectDelay(mm); mm.push16(0x1234); mm.push16(0x5678); return r; };
  assert.equal(seamPlaceable(withOmittedRet, strayMutant, TARGET, mk()).placeable, false, "the seam must REFUSE a strayed SP");
  console.log("  SP-TOOTH: +2 tail-transfer placeable, stray-stack refused");
});
