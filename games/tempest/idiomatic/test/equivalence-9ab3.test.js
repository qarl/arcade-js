// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for the loc_9ab3 mid-entry (ROM 0x9ab3) -- it presets the index to 4 and runs the
// shared pointer-pair setup (0x9b02[4]->$2c, 0x9afd[4]->$2d, 4->$2b, A<-$29). Neither the incoming A nor
// Y is read (the entry sets its own index), so live-out is RAM (dumpState minus STACK_SCRATCH) plus A.
// The mid-entry is not a separate export in the frozen translated module, so the oracle is composed from
// the mid-entry's own preset (index 4) feeding the frozen translated setup routine loc_9aee.
// Run: node --test games/tempest/idiomatic/test/equivalence-9ab3.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9aee as oracleSetup } from "../../translated/loc_9aee.js";
import { loc_9ab3 } from "../loc_9a9d.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, loc_29, loc_2b, loc_2c, loc_2d, loc_9afd, loc_9b02 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9ab3;
// The mid-entry: preset the index to 4, then run the frozen setup routine.
const oracle = (m) => { m.regs.y = 0x04; return oracleSetup(m); };
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9ab3 dispatches -- loc_9ab3 == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9ab3(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, a29) {
  m.regs.a = 0x00; m.regs.y = 0x77; // incoming A/Y are dead -- the entry sets its own index
  m.mem.write8(loc_29, a29);
  m.mem.write8(loc_2c, 0xa1); m.mem.write8(loc_2b, 0xa2); m.mem.write8(loc_2d, 0xa3); // dirty sentinels
}

test("CRAFTED: index-4 pointer-pair seated and A reloaded -- RAM and A equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x55);
  const c = new Machine(ROM, OPTS); seed(c, 0x55);
  oracle(o); loc_9ab3(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after setup");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8(loc_2b), 0x04, "$2b holds the index");
  assert.equal(c.mem.read8(loc_2c), o.mem.read8(loc_2c), "$2c low pointer matches oracle");
  assert.equal(c.mem.read8(loc_2d), o.mem.read8(loc_2d), "$2d high pointer matches oracle");
  assert.equal(c.regs.a, 0x55, "A reloaded from $29");
});

test("MUTATION: a twin that skips the index stash diverges from the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x55);
  const c = new Machine(ROM, OPTS); seed(c, 0x55);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    mem8[loc_2c] = mem8[u16(loc_9b02 + 0x04)];
    mem8[loc_2d] = mem8[u16(loc_9afd + 0x04)];
    // BUG: never stashes the index, so the $2b sentinel survives
    m.regs.a = mem8[loc_29];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped index stash");
});
