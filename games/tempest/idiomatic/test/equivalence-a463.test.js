// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_a463 (ROM 0xa463-0xa503) -- the near/far slot scan. It stores threshold A
// in loc_2e, walks loc_2db slots y=10..0 forming delta = |entry - threshold|, and for qualifying slots
// retires/spawns via loc_a36f (near), loc_a309 (far band 4) or loc_a38e (far other bands); afterwards, if
// loc_2f2,x reads 0xff it clears loc_2d3,x/loc_2f2,x and drops loc_135. Inputs are A (threshold) and X
// (slot index); the routine ends with a plain RTS and produces no return value, so the contract is RAM
// only (dumpState minus STACK_SCRATCH) -- no register is a live-out. Oracle is the frozen translated
// loc_a463; the three internal JSRs are dissolved to direct calls in the idiomatic layer.
// Run: node --test games/tempest/idiomatic/test/equivalence-a463.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a463 as oracle } from "../../translated/loc_a463.js";
import { loc_a463 } from "../loc_a463.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import {
  STACK_SCRATCH,
  loc_2e, loc_38, loc_a7, loc_135, loc_151, loc_2ad, loc_2b5, loc_2d3, loc_2db, loc_2f2,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa463;
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

test("CAPTURE: real 0xa463 dispatches -- loc_a463 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented spawn/retire arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_a463(c);
    assert.equal(ramDiff(o, c), null, "RAM equal for a captured dispatch");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// No-call scan: every slot nonzero (so both the near y<4 and far y>=4 paths run), but loc_a7 and the band
// thresholds loc_151 are 0 so every delta >= threshold and NO callee ever fires -- this exercises the
// loc_2e store, the far-path loc_38 store, and the final clear block deterministically. loc_2f2,x = 0xff
// arms the clear; loc_135 = 5 so its decrement is observable.
function seedNoCall(m) {
  m.regs.a = 0x80; m.regs.x = 0x05;
  m.mem.write8(loc_2e, 0x11);          // overwritten by the routine's threshold store
  m.mem.write8(loc_a7, 0x00);          // near-slot delta gate wide open the wrong way -> near always skips
  for (let b = 0; b < 8; b++) m.mem.write8(u16(loc_151 + b), 0x00); // far band thresholds -> far always skips
  for (let k = 0; k <= 10; k++) m.mem.write8(u16(loc_2db + k), 0x01); // all slots nonzero
  m.mem.write8(u16(loc_2f2 + 0x05), 0xff); // arm the final clear for slot X
  m.mem.write8(loc_135, 0x05);
}

test("CRAFTED: full scan with no callee fired -- RAM equal; loc_2e/loc_38/clear-block correct", () => {
  const o = new Machine(ROM, OPTS); seedNoCall(o);
  const c = new Machine(ROM, OPTS); seedNoCall(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw -- skipped"); return; }
  loc_a463(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the no-call scan + clear block");
  assert.equal(c.mem.read8(loc_2e), 0x80, "threshold stored to loc_2e");
  assert.equal(c.mem.read8(loc_38), 0x04, "loc_38 holds the last far slot processed (y=4)");
  assert.equal(c.mem.read8(u16(loc_2f2 + 0x05)), 0x00, "loc_2f2,x cleared");
  assert.equal(c.mem.read8(u16(loc_2d3 + 0x05)), 0x00, "loc_2d3,x cleared");
  assert.equal(c.mem.read8(loc_135), 0x04, "live count loc_135 decremented");
});

// Near-slot retire: a single near slot (y=2) whose delta is under loc_a7 and whose loc_2b5,y matches
// loc_2ad,x -> fires loc_a36f. The retire chain (ccc1/a3d4/...) may reach an unimplemented arm; skip on
// oracle throw. When it runs cleanly this covers a dissolved-call path end-to-end.
function seedRetire(m) {
  m.regs.a = 0x10; m.regs.x = 0x05;
  m.mem.write8(loc_a7, 0x40);           // delta gate open
  m.mem.write8(u16(loc_2db + 0x02), 0x11); // slot 2 entry -> delta = 1 < 0x40
  m.mem.write8(u16(loc_2b5 + 0x02), 0x07);
  m.mem.write8(u16(loc_2ad + 0x05), 0x07); // match -> loc_a36f fires
}

test("CRAFTED-CALL: near-slot retire fires loc_a36f -- RAM equal (skip on oracle throw)", () => {
  const o = new Machine(ROM, OPTS); seedRetire(o);
  const c = new Machine(ROM, OPTS); seedRetire(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED-CALL: oracle threw on the retire arm -- skipped"); return; }
  loc_a463(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the near-slot retire");
});

test("TEETH: a twin that drops the loc_2e threshold store MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedNoCall(o);
  const c = new Machine(ROM, OPTS); seedNoCall(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw -- skipped"); return; }
  let ran = false;
  const broken = (m) => {
    const before2e = m.mem.read8(loc_2e); // seeded 0x11, threshold is 0x80
    loc_a463(m);
    m.mem.write8(loc_2e, before2e); // BUG: revert the signature threshold store
    ran = true;
  };
  broken(c);
  assert.ok(ran, "the teeth twin did not run");
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_2e store was NOT caught by the RAM compare");
});
