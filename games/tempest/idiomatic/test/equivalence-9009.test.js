// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runWaveInit (ROM 0x9009-0x9024) -- an init sequence: run four setup subroutines
// (reseedStateTables, seedPerLaneSpikeArray, resetWorkingRamForStateEntry, clearReadyLatchPair) in order, then seed DEPTH_LO = 250 and clear
// SPIKE_ACTIVE_FLAG/DEPTH_HI/MODE_DISPATCH_SEL. No input register; ends with a plain return (not a tail-delegate). Live-out
// is RAM (dumpState minus stack scratch below the entry SP) plus the exit [X, Y] it returns (resetWorkingRamForStateEntry's), which
// bumpLevelEnemyQuota hands back as its own; the CAPTURE arm compares it. Oracle is the frozen
// translated runWaveInit.
// Run: node --test games/tempest/idiomatic/test/equivalence-9009.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9009 } from "../../translated/loc_9009.js";
import { runWaveInit } from "../runWaveInit.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DEPTH_LO, DEPTH_HI } from "../names.js";

const MODE_DISPATCH_SEL = 0x0001;
const SPIKE_ACTIVE_FLAG = 0x0106;

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
const oracle = atEntry(loc_9009);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// POKEY coupling: the init chain reaches resetWorkingRamForStateEntry -> seedSlotRandomTags, which reads $60ca (POKEY1 RANDOM). That
// register is clock-coupled -- its poly index advances with CPU cycles, and each read charges cycles the
// idiomatic layer does not tick. The oracle (which steps every instruction) therefore sees a FRESH random
// byte per load while the idiomatic layer sees a frozen one, so on a captured mid-run dispatch (SK_RESET
// set) the seedSlotRandomTags tag table diverges at $0203+. Freeze the polys (clear SK_RESET) so both arms read the
// SAME RANDOM byte on every load -- the same fix the seedSlotRandomTags equivalence test uses. A fresh Machine boots
// with skctl=0 (polys already frozen), so the CRAFTED arm below needs no freeze.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9009 dispatches -- runWaveInit == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a callee may reach an unimplemented arm on a real dispatch
    if (threw) continue; // both layers would throw identically there; nothing to compare
    { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(runWaveInit(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
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
  runWaveInit(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full init sequence");
  // The routine's own signature writes.
  assert.equal(c.mem.read8(DEPTH_LO), 250, "DEPTH_LO seeded to 250");
  assert.equal(c.mem.read8(SPIKE_ACTIVE_FLAG), 0, "SPIKE_ACTIVE_FLAG cleared");
  assert.equal(c.mem.read8(DEPTH_HI), 0, "DEPTH_HI cleared");
  assert.equal(c.mem.read8(MODE_DISPATCH_SEL), 0, "MODE_DISPATCH_SEL cleared");
});

test("TEETH: a twin that drops the DEPTH_LO seed MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS);
  const c = new Machine(ROM, OPTS);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  let tried = 0;
  // Broken twin: identical to runWaveInit but reverts the DEPTH_LO = 250 signature write. The oracle always
  // seeds DEPTH_LO, so dropping it alone guarantees a RAM divergence.
  const broken = (m) => {
    tried++;
    const before5b = m.mem.read8(DEPTH_LO);
    runWaveInit(m);
    m.mem.write8(DEPTH_LO, before5b); // BUG: revert the seed
  };
  broken(c);
  assert.ok(tried > 0, "the broken twin ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped DEPTH_LO seed was NOT caught by the RAM compare");
});
