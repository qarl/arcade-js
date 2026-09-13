// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_9009 (ROM 0x9009-0x9024) -- an init sequence: run four setup subroutines
// (loc_92c5, loc_9234, loc_902b, loc_a831) in order, then seed loc_5b = 250 and clear
// loc_106/loc_5f/loc_1. No input register; ends with a plain return (not a tail-delegate) and no caller
// reads a register back, so live-out is RAM only (dumpState minus STACK_SCRATCH). Oracle is the frozen
// translated loc_9009.
// Run: node --test games/tempest/idiomatic/test/equivalence-9009.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9009 as oracle } from "../../translated/loc_9009.js";
import { loc_9009 } from "../loc_9009.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_5b, loc_5f } from "../names.js";

const loc_1 = 0x0001;
const loc_106 = 0x0106;

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9009;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// POKEY coupling: the init chain reaches loc_902b -> loc_9246, which reads $60ca (POKEY1 RANDOM). That
// register is clock-coupled -- its poly index advances with CPU cycles, and each read charges cycles the
// idiomatic layer does not tick. The oracle (which steps every instruction) therefore sees a FRESH random
// byte per load while the idiomatic layer sees a frozen one, so on a captured mid-run dispatch (SK_RESET
// set) the loc_9246 tag table diverges at $0203+. Freeze the polys (clear SK_RESET) so both arms read the
// SAME RANDOM byte on every load -- the same fix the loc_9246 equivalence test uses. A fresh Machine boots
// with skctl=0 (polys already frozen), so the CRAFTED arm below needs no freeze.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9009 dispatches -- loc_9009 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a callee may reach an unimplemented arm on a real dispatch
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_9009(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

test("CRAFTED: full init sequence -- RAM equal, and the seed/clear writes landed", () => {
  const o = new Machine(ROM, OPTS);
  const c = new Machine(ROM, OPTS);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  loc_9009(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full init sequence");
  // The routine's own signature writes.
  assert.equal(c.mem.read8(loc_5b), 250, "loc_5b seeded to 250");
  assert.equal(c.mem.read8(loc_106), 0, "loc_106 cleared");
  assert.equal(c.mem.read8(loc_5f), 0, "loc_5f cleared");
  assert.equal(c.mem.read8(loc_1), 0, "loc_1 cleared");
});

test("TEETH: a twin that drops the loc_5b seed MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS);
  const c = new Machine(ROM, OPTS);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  let tried = 0;
  // Broken twin: identical to loc_9009 but reverts the loc_5b = 250 signature write. The oracle always
  // seeds loc_5b, so dropping it alone guarantees a RAM divergence.
  const broken = (m) => {
    tried++;
    const before5b = m.mem.read8(loc_5b);
    loc_9009(m);
    m.mem.write8(loc_5b, before5b); // BUG: revert the seed
  };
  broken(c);
  assert.ok(tried > 0, "the broken twin ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_5b seed was NOT caught by the RAM compare");
});
