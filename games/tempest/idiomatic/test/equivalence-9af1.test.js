// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_9af1 (ROM 0x9af1) -- the shared pointer-pair setup entered one step later than
// loc_9aee: the low pointer comes straight from the caller (A) instead of the 0x9b02 table, the high pointer
// is loaded by index (0x9afd[y]->$2d), the index is stashed (y->$2b), and A is reloaded from its holding
// cell ($29). Inputs are A (low pointer) and Y (index); live-out is RAM (dumpState minus STACK_SCRATCH)
// plus A. The oracle is the frozen mid-entry export loc_9af1 in translated/loc_9aee.js.
// Run: node --test games/tempest/idiomatic/test/equivalence-9af1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9af1 as oracle } from "../../translated/loc_9aee.js";
import { loc_9af1 } from "../loc_9aee.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, loc_29, loc_2b, loc_2c, loc_2d, loc_9afd } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9af1;
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

test("CAPTURE: real 0x9af1 dispatches -- loc_9af1 == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9af1(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, low, y, a29) {
  m.regs.a = low; m.regs.y = y; // A carries the low pointer, Y the high-table index
  m.mem.write8(loc_29, a29);
  m.mem.write8(loc_2c, 0xa1); m.mem.write8(loc_2b, 0xa2); m.mem.write8(loc_2d, 0xa3); // dirty sentinels
}

test("CRAFTED: caller low pointer + index seated, A reloaded -- RAM and A equal", () => {
  for (const [low, y] of [[0x6e, 0x02], [0x00, 0x05], [0xff, 0x00]]) {
    const o = new Machine(ROM, OPTS); seed(o, low, y, 0x42);
    const c = new Machine(ROM, OPTS); seed(c, low, y, 0x42);
    oracle(o); loc_9af1(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after setup (low=${low},y=${y})`);
    assert.equal(c.regs.a, o.regs.a, `A live-out matches (low=${low},y=${y})`);
    assert.equal(c.mem.read8(loc_2c), low, `$2c = caller low pointer (low=${low},y=${y})`);
    assert.equal(c.mem.read8(loc_2b), y, `$2b holds the index (low=${low},y=${y})`);
    assert.equal(c.mem.read8(loc_2d), o.mem.read8(loc_2d), `$2d high pointer matches oracle (low=${low},y=${y})`);
    assert.equal(c.regs.a, 0x42, `A reloaded from $29 (low=${low},y=${y})`);
  }
});

test("MUTATION: a twin that skips the index stash diverges from the oracle in RAM", () => {
  const low = 0x6e, y = 0x02;
  const o = new Machine(ROM, OPTS); seed(o, low, y, 0x42);
  const c = new Machine(ROM, OPTS); seed(c, low, y, 0x42);
  oracle(o);
  const broken = (m, a = m.regs.a, yy = m.regs.y) => {
    const { mem8 } = m;
    mem8[loc_2c] = a;
    mem8[loc_2d] = mem8[u16(loc_9afd + yy)];
    // BUG: never stashes the index, so the $2b sentinel survives
    m.regs.a = mem8[loc_29];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped index stash");
});
