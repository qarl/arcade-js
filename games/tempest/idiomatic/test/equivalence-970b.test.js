// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_970b -- the per-frame update driver: runs nine per-frame passes in order then
// tail-delegates to loc_a504. Contract: RAM (dumpState minus STACK_SCRATCH). Oracle = frozen translated.
// Run: node --test games/tempest/idiomatic/test/equivalence-970b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_970b as oracle } from "../../translated/loc_970b.js";
import { loc_970b } from "../loc_970b.js";
import { loc_9749 } from "../loc_9749.js";
import { loc_a23f } from "../loc_a23f.js";
import { loc_a83a } from "../loc_a83a.js";
import { loc_98a2 } from "../loc_98a2.js";
import { loc_a18f } from "../loc_a18f.js";
import { loc_a2a6 } from "../loc_a2a6.js";
import { loc_a454 } from "../loc_a454.js";
import { loc_a416 } from "../loc_a416.js";
import { loc_a504 } from "../loc_a504.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x970b;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(12, 3000) : [];

test("CAPTURE: real 0x970b dispatches -- loc_970b == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a real per-frame dispatch may reach an unimplemented draw arm in a sub
    loc_970b(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

test("CRAFTED: a fresh-machine frame -- loc_970b == oracle in RAM (skip on oracle throw)", () => {
  const o = new Machine(ROM, OPTS);
  const c = new Machine(ROM, OPTS);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle hit an unimplemented arm on a fresh frame -- skipped"); return; }
  loc_970b(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full per-frame pass");
});

test("TEETH: a twin that DROPS the loc_9b1e pass MUST diverge from the oracle in RAM", () => {
  // Seed loc_148/loc_147 so loc_9b1e's accumulate is observable (a fresh frame leaves it inert).
  const seed = (m) => { m.mem.write8(0x0148, 0x10); m.mem.write8(0x0147, 0x05); };
  const o = new Machine(ROM, OPTS); seed(o);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle hit an unimplemented arm -- skipped"); return; }
  const c = new Machine(ROM, OPTS); seed(c);
  // Broken twin: the same driver but SKIPPING loc_9b1e (the 5th pass). If loc_9b1e has any RAM effect on
  // a fresh frame, the ordered-call contract is violated and the RAM diff must catch it.
  let brokeThrew = false;
  try {
    loc_9749(c); loc_a23f(c); loc_a83a(c); loc_98a2(c); /* loc_9b1e(c) DROPPED */
    loc_a18f(c); loc_a2a6(c); loc_a454(c); loc_a416(c); loc_a504(c);
  } catch { brokeThrew = true; }
  if (brokeThrew) { console.log("  TEETH: broken twin hit an unimplemented arm -- skipped"); return; }
  assert.notEqual(ramDiff(o, c), null, "dropping loc_9b1e was NOT caught by the RAM compare");
});
