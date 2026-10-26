// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for writeScriptVariableToSlot (ROM 0x9bdd) -- the counter-driven indexed fetch that bumps $010b, reads
// the ROM table $a0f7 with it, folds that byte back as a zero-page pointer, and stores the pointed-at byte
// into slot X's $0298,x. Live-out is RAM only ($010b + $0298,x); A/Y are scratch, so the arms compare RAM
// (-stack). It is a plain (non-dispatching) rewrite -- no SP tooth. No POKEY read, so the CRAFTED seed
// diffs are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-9bdd.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9bdd } from "../../translated/loc_9bdd.js";
import { writeScriptVariableToSlot } from "../writeScriptVariableToSlot.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SCRIPT_CURSOR, loc_298 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9bdd;
const oracle = atEntry(loc_9bdd);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Run oracle vs rewrite from one captured seed. X (the slot index) is the only register read on entry;
// the clone carries it, so pass c.regs.x to the rewrite's param bridge.
function diffFrom(cap) {
  const o = cap.clone(), c = cap.clone();
  oracle(o); writeScriptVariableToSlot(c, c.regs.x);
  return ramDiff(o, c);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9bdd dispatches -- writeScriptVariableToSlot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) assert.equal(diffFrom(cap), null);
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v);
}
// Fill the whole zero page with a fixed distinct pattern so the indirect $0000,y fetch is well-defined
// (and, in the fill-0x55 case, nonzero for every pointer value the table can produce).
function fillZeroPage(m, v) {
  for (let a = 0x00; a <= 0xff; a++) m.mem.write8(a, typeof v === "function" ? v(a) : v);
}

test("CRAFTED: counter bump + table/indirect fetch + slot store == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "x=3, counter=0x05, ZP=i*7", x: 0x03, counter: 0x05, zp: (a) => (a * 7) & 0xff },
    { tag: "x=0x10, counter=0xff wraps to 0x00", x: 0x10, counter: 0xff, zp: (a) => (a ^ 0x3c) & 0xff },
    { tag: "x=0, counter=0x7f", x: 0x00, counter: 0x7f, zp: (a) => (a + 0x11) & 0xff },
    { tag: "x=0x2a, counter=0x00", x: 0x2a, counter: 0x00, zp: 0x55 },
  ];
  for (const t of cases) {
    const o = new Machine(ROM, OPTS); fillZeroPage(o, t.zp); seed(o, { [SCRIPT_CURSOR]: t.counter }); o.regs.x = t.x;
    const c = new Machine(ROM, OPTS); fillZeroPage(c, t.zp); seed(c, { [SCRIPT_CURSOR]: t.counter }); c.regs.x = t.x;
    oracle(o); writeScriptVariableToSlot(c, c.regs.x);
    assert.equal(ramDiff(o, c), null, `RAM: ${t.tag}`);
  }
});

test("TEETH: a twin that skips the $0298,x store diverges from the oracle", () => {
  // ZP all 0x55 -> the fetched byte is 0x55 for any pointer; $0298,x starts 0x00. The oracle stamps
  // 0x55 into the slot; a twin that bumps the counter but never stores must be caught by the RAM diff.
  const x = 0x04, counter = 0x05;
  const o = new Machine(ROM, OPTS); fillZeroPage(o, 0x55); seed(o, { [SCRIPT_CURSOR]: counter }); o.regs.x = x;
  const c = new Machine(ROM, OPTS); fillZeroPage(c, 0x55); seed(c, { [SCRIPT_CURSOR]: counter }); c.regs.x = x;
  const brokenSkipStore = (mm, xr = mm.regs.x) => {
    // BUG: performs the counter bump but omits sta $0298,x entirely.
    void xr;
    mm.mem8[SCRIPT_CURSOR] = mm.mem8[SCRIPT_CURSOR] + 1;
  };
  oracle(o);
  brokenSkipStore(c, c.regs.x);
  assert.notEqual(o.mem.read8((loc_298 + x) & 0xffff), 0x00, "precondition: oracle stamped $0298,x nonzero");
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $0298,x store");
});
