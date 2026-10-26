// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runWaveLaunchPhaseFrame (ROM 0x72a0, Pooyan) — bonus phase 1 body: run the shared
 * per-frame update then the wave-launch driver, and return.
 *
 * The module calls the per-frame update through its frozen sibling and the wave driver through its
 * idiomatic sibling; the oracle drives both translated siblings through the routines map. runWaveLaunchPhaseFrame
 * is a void sequencer — no register survives, so the register file is not compared; equivalence is
 * RAM (dumpState) minus stack scratch below the entry SP. SP is parked in STACK_SCRATCH so each sub-pass's nested
 * pushes drop out of the diff.
 *
 * A plain boot seats both passes to observable branches: the update runs its main path (marks
 * 0x8931) and the wave driver seeds the next wave (marks WAVE_INDEX at 0x8f3d), and the two
 * footprints are disjoint (verified: neither pass writes the other's marker).
 *
 * Jobs:
 *   1. EQUAL — module == oracle in RAM (−stack) from a plain booted state (both passes act).
 *   2. WRITE-SET — both pass markers are set after the run (update: 0x8931; wave: 0x8f3d).
 *   3. TEETH — a wrong-byte RAM twin is caught by the diff; a sequencer missing either pass
 *      diverges at that pass's own marker.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-72a0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_72a0 as oracle } from "../../translated/loc_72a0.js";
import { runWaveLaunchPhaseFrame } from "../runWaveLaunchPhaseFrame.js";
import { loc_20d4 } from "../../translated/loc_20d4.js";
import { driveEagleWavePerFrame } from "../driveEagleWavePerFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const UPDATE_MARK = 0x8931; // written by the per-frame update's main path; the wave driver never touches it
const WAVE_MARK = 0x8f3d; //   WAVE_INDEX, bumped by the wave driver's seed branch; the update never touches it
const SP0 = 0x8ff0; //         inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: runWaveLaunchPhaseFrame == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  runWaveLaunchPhaseFrame(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: RAM identical");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: both pass markers set after the run", () => {
  const c = craft();
  runWaveLaunchPhaseFrame(c);
  assert.notEqual(c.mem.read8(UPDATE_MARK), 0x00, "per-frame update must mark 0x8931");
  assert.notEqual(c.mem.read8(WAVE_MARK), 0x00, "wave driver must bump WAVE_INDEX");
  console.log("  WRITE-SET: update + wave markers set");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  runWaveLaunchPhaseFrame(c);
  c.mem.write8(WAVE_MARK, (o.mem.read8(WAVE_MARK) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, WAVE_MARK, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a sequencer missing either pass diverges at that pass's marker", () => {
  const DROPS = [
    { name: "drop update", keep: (m) => driveEagleWavePerFrame(m), addr: UPDATE_MARK },
    { name: "drop wave driver", keep: (m) => loc_20d4(m), addr: WAVE_MARK },
  ];
  for (const { name, keep, addr } of DROPS) {
    const o = craft();
    const twin = craft();
    oracle(o);
    keep(twin); // a broken sequencer that omits exactly one pass
    const d = ramDiffMinusStack(o, twin);
    assert.notEqual(d, null, `${name}: the gate FAILED to catch a missing pass — worthless`);
    // The dropped pass writes several cells; the first RAM diff can land on any of them, so pin the
    // divergence to the dropped pass's OWN marker (oracle set it, the twin left it) rather than
    // requiring it be the lowest-addressed diff.
    assert.notEqual(twin.mem.read8(addr), o.mem.read8(addr),
      `${name}: the dropped pass's marker ${hx(addr)} must diverge from the oracle`);
    console.log(`  TEETH ${name}: marker ${hx(addr)} diverges (first diff at ${hx(d.addr)})`);
  }
});
