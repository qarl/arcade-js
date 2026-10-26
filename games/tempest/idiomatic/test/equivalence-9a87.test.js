// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for dispatchListSetupByColumn (ROM 0x9a87) -- a lone `txa` (A=X) that falls through into the RTS-trick
// COMPUTED-JUMP dispatcher at 0x9a88. The idiomatic form dissolves the txa+fall-through into passing X
// as both the dispatch index and the slot index: dispatchListSetupByColumn(m, x) ===
// dispatchCoordListSetup(m, x, x). The five list-setup entries are selected by A=X (0..4); X is read only by
// entry 2 (selectClimberSpawnLane) as its slot index, the other entries ignore it. This is a tail delegation --
// the exit registers are the delegate's, NOT dispatchListSetupByColumn's. Contract is RAM
// (dumpState minus stack scratch below the entry SP); the oracle's stack gymnastics land below the entry SP and are excluded.
// Run: node --test games/tempest/idiomatic/test/equivalence-9a87.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9a87 } from "../../translated/loc_9a87.js";
import { dispatchListSetupByColumn } from "../dispatchListSetupByColumn.js";
import { dispatchCoordListSetup } from "../dispatchCoordListSetup.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, LIST_PTR_HI, LIST_SELECT_FLAGS } from "../names.js";

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
const oracle = atEntry(loc_9a87);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9a87 dispatches -- dispatchListSetupByColumn == oracle in RAM (-stack)", () => {
  const xs = new Set();
  for (const cap of CAPS) {
    xs.add(cap.regs.x);
    const o = cap.clone(), c = cap.clone();
    oracle(o); dispatchListSetupByColumn(c);
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
  m.mem.write8(LIST_PTR_HI, 0x6e); // source byte the entries read
  m.mem.write8(LIST_SELECT_FLAGS, 0x30); // second held byte OR'd into a low pointer
  return m;
}

test("CRAFTED: each entry index X=0..4 -- dispatchListSetupByColumn == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const x of [0, 1, 2, 3, 4]) {
    const base = seedBase(x);
    const o = base.clone(), c = base.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an entry the generic seed cannot fully provision -- CAPTURE carries it
    dispatchListSetupByColumn(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching entry X=${x}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/5 entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

// R37 arm: the column must reach the selected handler by the explicit arg, never by a stale register.
// The idiomatic side gets the column as its arg while m.regs.x holds a poison value; the oracle side
// keeps the real X. A rewrite that leaks the column into the callee's A slot and lets the callee's X
// fall back to m.regs.x makes entry 2 (selectClimberSpawnLane) index its cells by the poison and diverge.
test("STALE-X: column passed explicitly, m.regs.x poisoned on the idiomatic side only -- == oracle in RAM (-stack)", () => {
  let checked = 0;
  const arms = [...CAPS.map((cap) => [cap, cap.regs.x]), ...[0, 1, 2, 3, 4].map((x) => [seedBase(x), x])];
  for (const [base, x] of arms) {
    const o = base.clone(), c = base.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    c.regs.x = (x + 0x0b) & 0xff; // poison: a different, still in-range-for-RAM slot index
    dispatchListSetupByColumn(c, x);
    assert.equal(ramDiff(o, c), null, `RAM equal for column X=${x} with m.regs.x poisoned`);
    checked++;
  }
  assert.ok(checked >= 1, "no arm could be provisioned -- the stale-X check is inert");
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
    try { dispatchCoordListSetup(c, flipped, x); } catch { brokeThrew = true; } // twin: dispatch the wrong index
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
  const r = seamPlaceable(withOmittedRet, dispatchListSetupByColumn, TARGET, m);
  assert.equal(r.placeable, true, `dispatchListSetupByColumn must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret delegator (moved 0) placeable");
});
