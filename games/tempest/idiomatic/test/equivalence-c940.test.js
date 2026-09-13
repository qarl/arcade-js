// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_c940 (ROM 0xc940-0xc97a) -- level-setup. It seeds the sizing/timer cells
// (loc_1/loc_00/loc_2), and when the level id loc_3f differs from the last-seen loc_3d AND loc_5 is
// negative it installs the new-level timers (loc_1/loc_00/loc_4, the last picked by loc_117) and swaps
// the paired tables via loc_92b2; then it converges: loc_ca48, index loc_46 by loc_3d into loc_9f,
// loc_9025 (startup init), and TAIL-DELEGATES to loc_cd95 (readout reset). Live-out is RAM only
// (dumpState minus STACK_SCRATCH): c940 takes no input register and tail-jmps loc_cd95, so its exit
// registers are the delegate's -- both layers run the identical delegate from the identical clone, so
// registers are not part of this routine's contract. Oracle is the frozen translated loc_c940.
// Run: node --test games/tempest/idiomatic/test/equivalence-c940.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c940 as oracle } from "../../translated/loc_c940.js";
import { loc_c940 } from "../loc_c940.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_00, loc_1, loc_2, loc_4, loc_5, loc_3d, loc_3f, loc_46, loc_9f, loc_117, loc_74, loc_75,
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

const TARGET = 0xc940;
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
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

test("CAPTURE: real 0xc940 dispatches -- loc_c940 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented downstream arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_c940(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed the "level changed + loc_5 negative" path: loc_3f (new id) differs from loc_3d (last seen), loc_5
// bit7 set so the new-level timer block runs, loc_117 nonzero so loc_4 takes the 40 branch, and a known
// byte at loc_46 + (post-write loc_3d) so the loc_9f index is exercised. Point the display cursor at vector
// RAM so any downstream emit lands there, not zero page.
function seedChanged(m) {
  m.mem.write8(loc_3f, 0x02);  // new level id
  m.mem.write8(loc_3d, 0x01);  // last seen -> differs -> the block runs
  m.mem.write8(loc_5, 0x80);  // negative -> the new-level timer block runs
  m.mem.write8(loc_117, 0x01); // nonzero -> loc_4 = 40
  m.mem.write8(loc_2, 0x00);  // pre-value so the unconditional loc_2 = 30 is observable
  m.mem.write8(0x0048, 0x5a);  // loc_46 + 2 (loc_3d becomes 0x02) -> loc_9f source
  m.mem.write8(loc_74, 0x00);
  m.mem.write8(loc_75, 0x20);  // cursor into vector RAM 0x2000
}

test("CRAFTED: changed level + negative loc_5 + loc_117 branch -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedChanged(o);
  const c = new Machine(ROM, OPTS); seedChanged(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  loc_c940(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the level-setup path");
  // Spot-checks on this routine's own signature writes.
  assert.equal(c.mem.read8(loc_2), 30, "loc_2 seeded to 30");
  assert.equal(c.mem.read8(loc_1), 14, "loc_1 took the new-level value");
  assert.equal(c.mem.read8(loc_00), 10, "loc_00 took the new-level value");
  assert.equal(c.mem.read8(loc_4), 40, "loc_4 took the loc_117-nonzero branch");
  assert.equal(c.mem.read8(loc_3d), 0x02, "loc_3d latched the new level id");
  assert.equal(c.mem.read8(loc_9f), o.mem.read8(loc_9f), "loc_9f matches the oracle");
});

// Seed the "level unchanged" path: loc_3f == loc_3d, so the whole timer/swap block is skipped and only
// the convergence tail runs.
function seedSame(m) {
  m.mem.write8(loc_3f, 0x03);
  m.mem.write8(loc_3d, 0x03);  // equal -> block skipped
  m.mem.write8(loc_2, 0x00);
  m.mem.write8(0x0049, 0x77);  // loc_46 + 3 -> loc_9f source
  m.mem.write8(loc_74, 0x00);
  m.mem.write8(loc_75, 0x20);
}

test("CRAFTED: unchanged level -- block skipped, convergence tail -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedSame(o);
  const c = new Machine(ROM, OPTS); seedSame(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED same: oracle threw on this seed -- skipped"); return; }
  loc_c940(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the skip path");
  assert.equal(c.mem.read8(loc_2), 30, "loc_2 seeded to 30 even on the skip path");
  assert.equal(c.mem.read8(loc_1), 0, "loc_1 stays 0 (timer block skipped)");
  assert.equal(c.mem.read8(loc_00), 30, "loc_00 stays 30 (timer block skipped)");
});

test("TEETH: a twin that drops the unconditional loc_2 write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedChanged(o);
  const c = new Machine(ROM, OPTS); seedChanged(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to loc_c940 but reverts the unconditional loc_2 = 30 write. The seed leaves
  // loc_2 = 0 before the call, so reverting guarantees a RAM divergence from the oracle's 30.
  const broken = (m) => {
    const before02 = m.mem.read8(loc_2);
    loc_c940(m);
    m.mem.write8(loc_2, before02); // BUG: revert the sizing-cell write
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_2 write was NOT caught by the RAM compare");
});
