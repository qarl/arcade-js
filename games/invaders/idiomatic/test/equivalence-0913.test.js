// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickSaucerSpawnTimer -- gate a 16-bit countdown timer: if the gate cell is high, do
// nothing; else decrement the counter, and when it was zero reload it and raise a wrap flag. Inputs
// and live-out are all memory, so each side runs on a fresh clone and the contract is RAM
// (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/invaders/idiomatic/test/equivalence-0913.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0913 as oracleBody } from "../../translated/loc_0913.js";
import { tickSaucerSpawnTimer } from "../tickSaucerSpawnTimer.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_2009, SAUCER_TIMER, loc_2083, TIMER_RELOAD } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0913;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0913 dispatches -- tickSaucerSpawnTimer == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); tickSaucerSpawnTimer(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// {gate, counter, flag0, wantCounter, wantFlag} -- every arm of the routine.
const CRAFTED = [
  { gate: 0x78, counter: 0x0100, flag0: 0x00, wantCounter: 0x0100, wantFlag: 0x00 }, // gate high (==): early return
  { gate: 0xff, counter: 0x0005, flag0: 0x00, wantCounter: 0x0005, wantFlag: 0x00 }, // gate high: early return
  { gate: 0x77, counter: 0x0100, flag0: 0x00, wantCounter: 0x00ff, wantFlag: 0x00 }, // gate low, counter != 0: dec
  { gate: 0x00, counter: 0x0001, flag0: 0x00, wantCounter: 0x0000, wantFlag: 0x00 }, // gate low, counter -> 0: dec, no wrap
  { gate: 0x40, counter: 0x0000, flag0: 0x00, wantCounter: (TIMER_RELOAD - 1) & 0xffff, wantFlag: 0x01 }, // wrap: reload + flag
];

test("CRAFTED: each arm matches the oracle in RAM and hits the expected cells", () => {
  for (const s of CRAFTED) {
    const seed = (m) => { m.mem.write8(loc_2009, s.gate); m.mem.write16(SAUCER_TIMER, s.counter); m.mem.write8(loc_2083, s.flag0); };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); tickSaucerSpawnTimer(c);
    const label = `gate=0x${s.gate.toString(16)} counter=0x${s.counter.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.mem.read16(SAUCER_TIMER), s.wantCounter, `counter ${label}`);
    assert.equal(c.mem.read8(loc_2083), s.wantFlag, `flag ${label}`);
  }
});

test("TEETH: a wrong stored counter is caught", () => {
  const seed = (m) => { m.mem.write8(loc_2009, 0x40); m.mem.write16(SAUCER_TIMER, 0x0000); m.mem.write8(loc_2083, 0x00); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  tickSaucerSpawnTimer(c); c.mem.write16(SAUCER_TIMER, 0x1234); // BUG: wrong stored counter
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored counter");
  assert.equal(d.addr, SAUCER_TIMER & 0xffff);
});
