// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_9a87 (ROM 0x9a87) -- a lone `txa` (A=X) that falls through into the RTS-trick
// COMPUTED-JUMP dispatcher at 0x9a88. The idiomatic form dissolves the txa+fall-through into passing X
// as the dispatch index: loc_9a87(m, x) === loc_9a88(m, x). The five list-setup entries are selected by
// X (0..4) and none reads the incoming A/Y/X as data (X is the dispatch index, consumed), so this is a
// tail delegation -- the exit registers are the delegate's, NOT loc_9a87's. Contract is RAM
// (dumpState minus STACK_SCRATCH); the oracle's stack gymnastics land in STACK_SCRATCH and are excluded.
// Run: node --test games/tempest/idiomatic/test/equivalence-9a87.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9a87 as oracle } from "../../translated/loc_9a87.js";
import { loc_9a87 } from "../loc_9a87.js";
import { loc_9a88 } from "../loc_9a88.js";
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

const TARGET = 0x9a87;
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

test("CAPTURE: real 0x9a87 dispatches -- loc_9a87 == oracle in RAM (-stack)", () => {
  const xs = new Set();
  for (const cap of CAPS) {
    xs.add(cap.regs.x);
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9a87(c);
    assert.equal(ramDiff(o, c), null, `RAM equal for captured X=${cap.regs.x}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked; distinct X seen: [${[...xs].sort((a, b) => a - b).join(",")}]`);
});

// Seed the setup cells the five entries read, then aim X at a table entry. Cloning makes the two arms
// deterministic regardless of any POKEY-sourced value the entries chase.
function seedBase(x) {
  const m = new Machine(ROM, OPTS);
  m.regs.x = x; m.regs.a = 0x00;
  m.mem.write8(loc_29, 0x42);  // holding cell -> A on the setup entries
  m.mem.write8(loc_15d, 0x6e); // source byte the entries read
  m.mem.write8(loc_16d, 0x30); // second held byte OR'd into a low pointer
  return m;
}

test("CRAFTED: each entry index X=0..4 -- loc_9a87 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const x of [0, 1, 2, 3, 4]) {
    const base = seedBase(x);
    const o = base.clone(), c = base.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an entry the generic seed cannot fully provision -- CAPTURE carries it
    loc_9a87(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching entry X=${x}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/5 entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

test("TEETH: a twin that dispatches the WRONG entry (x^1) diverges in RAM", () => {
  let caught = false, tried = 0;
  for (const x of [0, 1, 2, 3, 4]) {
    const base = seedBase(x);
    const o = base.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const flipped = x ^ 1;
    if (flipped > 4) continue;
    const c = base.clone();
    let brokeThrew = false;
    try { loc_9a88(c, flipped); } catch { brokeThrew = true; } // twin: dispatch the wrong index
    if (brokeThrew) continue;
    tried++;
    if (ramDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no entry pair could be exercised for the teeth arm");
  assert.ok(caught, "the RAM diff FAILED to catch a wrong-entry dispatch on every exercised pair");
});

test("SP-TOOTH: the omitted-ret delegator (moved 0) is seam-placeable", () => {
  const m = seedBase(0x00);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loc_9a87, TARGET, m);
  assert.equal(r.placeable, true, `loc_9a87 must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret delegator (moved 0) placeable");
});
