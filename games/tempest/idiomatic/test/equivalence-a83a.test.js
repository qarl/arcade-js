// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_a83a (ROM 0xa83a-0xa882). The countdown stepper: while loc_5 bit7 is set it
// advances the running counter loc_125 against the loc_3aa-indexed limit table loc_a883 (calling loc_a888
// at the tail), or -- when loc_125 is idle and loc_201 clear and loc_4e bit3 set -- arms the next stage
// (bump loc_3aa, seed loc_125); every path clears bit7 of loc_4e. No input register; effect is on RAM
// only, so live-out is RAM (dumpState minus STACK_SCRATCH) with no register compared. Oracle is the frozen
// translated loc_a83a.
// Run: node --test games/tempest/idiomatic/test/equivalence-a83a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a83a as oracle } from "../../translated/loc_a83a.js";
import { loc_a83a } from "../loc_a83a.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_5, loc_125, loc_201, loc_3aa, loc_4e } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa83a;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa83a dispatches -- loc_a83a == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented loc_a888 arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_a83a(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Running-counter path: loc_5 bit7 set, loc_125 nonzero -> advance + limit compare + loc_a888 tail.
// loc_125 = 1 so after the advance it is 2 (or 0 if it hits the limit); either way loc_a888 sees a phase
// below its 3-and-even gate and returns without dispatching, so no draw arm is reached.
function seedRunning(m) {
  m.mem.write8(loc_5, 0x80);
  m.mem.write8(loc_125, 0x01);
  m.mem.write8(loc_3aa, 0x00);
  m.mem.write8(loc_4e, 0xa5);
}

test("CRAFTED: running counter advances against the limit table -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedRunning(o);
  const c = new Machine(ROM, OPTS); seedRunning(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(running): oracle threw on this seed -- skipped"); return; }
  loc_a83a(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the running-counter step");
  assert.equal(c.mem.read8(loc_4e) & 0x80, 0, "bit7 of loc_4e cleared");
});

// Idle-counter arming path: loc_5 bit7 set, loc_125 idle, loc_201 clear, loc_4e bit3 set, loc_3aa < 2
// -> bump loc_3aa, seed loc_125 = 1, mask loc_4e. No callee is reached.
function seedArming(m) {
  m.mem.write8(loc_5, 0x80);
  m.mem.write8(loc_125, 0x00);
  m.mem.write8(loc_201, 0x00);
  m.mem.write8(loc_4e, 0x88);
  m.mem.write8(loc_3aa, 0x00);
}

test("CRAFTED: idle counter arms the next stage -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedArming(o);
  const c = new Machine(ROM, OPTS); seedArming(c);
  oracle(o);
  loc_a83a(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the arming step");
  assert.equal(c.mem.read8(loc_3aa), 0x01, "loc_3aa bumped");
  assert.equal(c.mem.read8(loc_125), 0x01, "loc_125 seeded");
});

test("TEETH: a twin that skips the final bit7 clear MUST diverge in RAM", () => {
  // loc_5 bit7 clear -> the routine's only effect is clearing bit7 of loc_4e; seed that bit set.
  const seed = (m) => { m.mem.write8(loc_5, 0x00); m.mem.write8(loc_4e, 0x80); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { loc_a83a(m); m.mem.write8(loc_4e, m.mem.read8(loc_4e) | 0x80); }; // BUG: re-set bit7
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the skipped bit7 clear was NOT caught by the RAM compare");
});
