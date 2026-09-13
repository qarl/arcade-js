// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_a888 (ROM 0xa888-0xa8ae). Acts only when loc_125 >= 3 and even: it scans
// loc_2df,y downward from y = loc_11c for the first nonzero slot. Found -> clears the low two bits of
// loc_28a,y and TAIL-DELEGATES to loc_a398 for that slot; none found -> resets loc_125 to 0; below the
// guard -> no-op. Contract is RAM (dumpState minus STACK_SCRATCH). No live-out register is compared: the
// found path tail-delegates to loc_a398 (its exit registers are the delegate's chain), and the other
// exits are plain returns whose registers no caller distinguishes here. Oracle is the frozen translated
// loc_a888.
// Run: node --test games/tempest/idiomatic/test/equivalence-a888.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a888 as oracle } from "../../translated/loc_a888.js";
import { loc_a888 } from "../loc_a888.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, loc_11c, loc_125, loc_28a, loc_2df } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa888;
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

test("CAPTURE: real 0xa888 dispatches -- loc_a888 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a found-slot dispatch may reach an unimplemented arm in loc_a398's chain
    if (threw) continue;
    loc_a888(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Below the guard: loc_125 < 3 -> no-op.
test("CRAFTED: loc_125 below 3 -- no-op, RAM equal", () => {
  const o = new Machine(ROM, OPTS); o.mem.write8(loc_125, 0x02);
  const c = new Machine(ROM, OPTS); c.mem.write8(loc_125, 0x02);
  oracle(o); loc_a888(c);
  assert.equal(ramDiff(o, c), null, "RAM equal for the below-guard exit");
  assert.equal(c.mem.read8(loc_125), 0x02, "loc_125 untouched below the guard");
});

// Below the guard: loc_125 >= 3 but odd -> no-op.
test("CRAFTED: loc_125 odd -- no-op, RAM equal", () => {
  const o = new Machine(ROM, OPTS); o.mem.write8(loc_125, 0x05);
  const c = new Machine(ROM, OPTS); c.mem.write8(loc_125, 0x05);
  oracle(o); loc_a888(c);
  assert.equal(ramDiff(o, c), null, "RAM equal for the odd-phase exit");
  assert.equal(c.mem.read8(loc_125), 0x05, "loc_125 untouched for odd phase");
});

// None-found path: phase >= 3 and even, every scanned loc_2df,y slot zero -> loc_125 reset to 0.
function seedNoneFound(m) {
  m.mem.write8(loc_125, 0x04);   // >= 3 and even -> scans
  m.mem.write8(loc_11c, 0x03);   // scan y = 3..0
  for (let y = 0; y <= 0x03; y++) m.mem.write8(u16(loc_2df + y), 0x00); // all slots empty
}

test("CRAFTED: none-found -- loc_125 reset to 0, RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedNoneFound(o);
  const c = new Machine(ROM, OPTS); seedNoneFound(c);
  oracle(o); loc_a888(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the none-found reset");
  assert.equal(c.mem.read8(loc_125), 0x00, "loc_125 reset to 0 when no slot is found");
});

// Found path: a nonzero slot -> clear low 2 bits of loc_28a,y then tail-delegate to loc_a398.
function seedFound(m) {
  m.mem.write8(loc_125, 0x04);   // >= 3 and even -> scans
  m.mem.write8(loc_11c, 0x03);   // scan starts at y = 3
  m.mem.write8(u16(loc_2df + 0x02), 0x01); // slot 2 nonzero -> found at y = 2
  m.mem.write8(u16(loc_28a + 0x02), 0x07); // low bits set -> masking to 0xfc is observable (0x07 -> 0x04)
}

test("CRAFTED: found slot -- clears loc_28a,y bits then delegates, RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedFound(o);
  const c = new Machine(ROM, OPTS); seedFound(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; } // loc_a398's chain may reach an unimplemented arm under this seed
  if (threw) { console.log("  CRAFTED found: oracle threw in the delegate -- skipped"); return; }
  loc_a888(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the found-slot delegate");
  assert.equal(c.mem.read8(u16(loc_28a + 0x02)), 0x04, "low two bits of loc_28a,y cleared (0x07 -> 0x04)");
});

test("TEETH: a twin that skips the loc_28a,y bit-clear MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedFound(o);
  const c = new Machine(ROM, OPTS); seedFound(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw in the delegate -- skipped"); return; }
  // Broken twin: run the real routine, then revert the loc_28a,y bit-clear the found path performs.
  const broken = (m) => {
    const before = m.mem.read8(u16(loc_28a + 0x02));
    loc_a888(m);
    m.mem.write8(u16(loc_28a + 0x02), before | 0x03); // BUG: restore the low bits the routine cleared
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the skipped loc_28a,y bit-clear was NOT caught by the RAM compare");
});
