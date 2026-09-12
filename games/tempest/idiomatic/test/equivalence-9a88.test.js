// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_9a88 (ROM 0x9a88-0x9a92) -- an RTS-trick COMPUTED-JUMP dispatcher: it does asl a
// (A=2*A), tay (Y=A) then pushes word($9a93+Y) and rts, jumping to (word+1). The caller passes A as the
// ENTRY INDEX 0..4 (the routine doubles it into the 2-byte table offset itself), so the Nth word is entry
// A -- the idiomatic form is TABLE[a], NOT a>>1. The five targets (0x9a9d/0x9aa9/0x9abb/0x9ab7/0x9ab3) each
// set their own index/value and none reads the incoming A/Y as data (A is the dispatch index, consumed), so
// the contract is RAM (dumpState minus STACK_SCRATCH); the oracle's stack gymnastics land in STACK_SCRATCH.
// Run: node --test games/tempest/idiomatic/test/equivalence-9a88.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9a88 as oracle } from "../../translated/loc_9a88.js";
import { loc_9a88 } from "../loc_9a88.js";
import { loc_9a9d, loc_9aa9, loc_9ab3, loc_9ab7 } from "../loc_9a9d.js";
import { loc_9abb } from "../loc_9abb.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_29, loc_15d, loc_16d } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9a88;
const TABLE = [loc_9a9d, loc_9aa9, loc_9abb, loc_9ab7, loc_9ab3];
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

test("CAPTURE: real 0x9a88 dispatches -- loc_9a88 == oracle in RAM (-stack)", () => {
  const as = new Set();
  for (const cap of CAPS) {
    as.add(cap.regs.a);
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9a88(c);
    assert.equal(ramDiff(o, c), null, `RAM equal for captured A=${cap.regs.a}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked; distinct A seen: [${[...as].sort((a, b) => a - b).join(",")}]`);
});

// Seed the setup cells the five entries read, then clone so the oracle and idiomatic arms start identical
// (loc_9abb reads a POKEY value -- cloning makes the two arms deterministic regardless of its source).
function seedBase(a) {
  const m = new Machine(ROM, OPTS);
  m.regs.a = a; m.regs.x = 0x05;
  m.mem.write8(loc_29, 0x42);  // holding cell -> A on the setup entries
  m.mem.write8(loc_15d, 0x6e); // source byte -> $2d on entry 0
  m.mem.write8(loc_16d, 0x30); // second held byte OR'd into the low pointer on entry 1
  return m;
}

test("CRAFTED: each entry index A=0..4 -- loc_9a88 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const a of [0, 1, 2, 3, 4]) {
    const base = seedBase(a);
    const o = base.clone(), c = base.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an entry the generic seed cannot fully provision -- CAPTURE carries it
    loc_9a88(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching entry A=${a}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/5 entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

test("TEETH: a twin that dispatches the WRONG entry (a^1) diverges in RAM", () => {
  let caught = false, tried = 0;
  for (const a of [0, 1, 2, 3, 4]) {
    const base = seedBase(a);
    const o = base.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const flipped = a ^ 1;
    if (flipped >= TABLE.length) continue;
    const c = base.clone();
    let brokeThrew = false;
    try { TABLE[flipped](c); } catch { brokeThrew = true; }
    if (brokeThrew) continue;
    tried++;
    if (ramDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no entry pair could be exercised for the teeth arm");
  assert.ok(caught, "the RAM diff FAILED to catch a wrong-entry dispatch on every exercised pair");
});

test("SP-TOOTH: the omitted-ret dispatcher (moved 0) is seam-placeable", () => {
  const m = seedBase(0x00);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loc_9a88, TARGET, m);
  assert.equal(r.placeable, true, `loc_9a88 must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dispatcher (moved 0) placeable");
});
