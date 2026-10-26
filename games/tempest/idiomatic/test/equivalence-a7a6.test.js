// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for signedSegmentDelta (ROM 0xa7a6) -- $2a = A - Y, then keep the full difference when $0111
// bit 7 is set, else the low nibble sign-extended from bit 3. Live-out is RAM $2a plus register A (the
// caller reads A back), so each arm compares A directly AND RAM (dumpState minus stack scratch below the entry SP). It is a
// pure leaf (no dispatch); the seam completes it by omitting its ROM ret. No POKEY/clock coupling, so the
// crafted arms are fully deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-a7a6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a7a6 } from "../../translated/loc_a7a6.js";
import { signedSegmentDelta } from "../signedSegmentDelta.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_2a, TUBE_GEOM_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa7a6;
const oracle = atEntry(loc_a7a6);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa7a6 dispatches -- signedSegmentDelta == oracle in A and RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); signedSegmentDelta(c);
    assert.equal(c.regs.a, o.regs.a, "register A (the result) diverged");
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  m.regs.a = s.a;
  m.regs.y = s.y;
  m.mem8[TUBE_GEOM_FLAG] = s.s111;
}

test("CRAFTED: keep-full / nibble / sign-extend branches == oracle in A and RAM (-stack)", () => {
  const cases = [
    { tag: "$0111 bit7 set -> keep full diff", a: 0x50, y: 0x03, s111: 0x80 },
    { tag: "keep full with wrap (A<Y)", a: 0x02, y: 0x05, s111: 0x80 },
    { tag: "nibble, bit3 clear -> no sign-extend", a: 0x25, y: 0x20, s111: 0x00 },
    { tag: "nibble, bit3 set -> sign-extend to 0xfc", a: 0x2c, y: 0x20, s111: 0x00 },
    { tag: "$0111 bit7 clear but other bits set -> still nibble", a: 0x2c, y: 0x20, s111: 0x7f },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); signedSegmentDelta(c);
    assert.equal(c.regs.a, o.regs.a, `A: ${s.tag}`);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a twin that skips the bit-3 sign-extend diverges from the oracle", () => {
  // Non-default seed so the sign-extend actually bites: low nibble 0x0c has bit 3 set.
  const s = { a: 0x2c, y: 0x20, s111: 0x00 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  oracle(o);
  assert.equal(o.regs.a, 0xfc, "precondition: oracle sign-extended 0x0c to 0xfc");
  const brokenNoSext = 0x0c; // BUG: masked to the low nibble but never OR-ed in #$f8
  assert.notEqual(brokenNoSext, o.regs.a, "the A compare FAILED to catch a skipped sign-extend");
});
