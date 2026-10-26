// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for spawnClimberInFreeSlot -- scans the active-slot table for a free entry, seeds its parallel arrays,
// bumps the active count and a per-lane counter, and returns 0x10 (or 0 when none free). Live-out is memory
// plus A (0x10/0 the caller reads back); each side runs on a clone and the RAM contract is dumpState minus
// stack scratch below the entry SP. A leaf: the module omits the ROM ret and the seam completes it, so arms compare RAM (-stack).
// The CRAFTED seeds keep $2a != 0x0f so the POKEY-random branch is never taken (deterministic).
// Run: node --test games/tempest/idiomatic/test/equivalence-994d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_994d } from "../../translated/loc_994d.js";
import { spawnClimberInFreeSlot } from "../spawnClimberInFreeSlot.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  SAVED_INDEX2, ENEMY_SLOT_TOP, ENEMY_DEPTH, loc_29, loc_2a, loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI,
  ENEMY_SEGMENT, ENEMY_PHASE, ENEMY_TIMER, ENEMY_SLOT_DIR, ENEMY_SCRIPT_CURSOR, ENEMY_TOTAL_COUNT, ENEMY_SLOT_FLAGS, LANE_ENEMY_COUNT_0,
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

const TARGET = 0x994d;
const oracle = atEntry(loc_994d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// A free slot at index 1 (indices 3,2 occupied; 1 free). $2a=0x05 avoids the POKEY-random branch.
function seedFree(m) {
  m.regs.y = 5; m.regs.x = 7;
  m.mem.write8(ENEMY_SLOT_TOP, 0x03);
  m.mem.write8((ENEMY_DEPTH + 3) & 0xffff, 0x81);
  m.mem.write8((ENEMY_DEPTH + 2) & 0xffff, 0x82);
  m.mem.write8((ENEMY_DEPTH + 1) & 0xffff, 0x00);
  m.mem.write8(loc_29, 0xaa);
  m.mem.write8(loc_2a, 0x05);
  m.mem.write8(loc_2b, 0x0b);
  m.mem.write8(COORD_LIST_PTR_LO, 0xcc);
  m.mem.write8(COORD_LIST_PTR_HI, 0xdd);
  m.mem.write8(ENEMY_TOTAL_COUNT, 0x20);
  m.mem.write8((ENEMY_TIMER + 1) & 0xffff, 0x55); // sentinel the zero-store must clear
  m.mem.write8((LANE_ENEMY_COUNT_0 + 3) & 0xffff, 0x40); // lane = 0x0b & 7 = 3
}

// No free slot: indices 2..0 all occupied, count=2.
function seedFull(m) {
  m.regs.y = 9; m.regs.x = 4;
  m.mem.write8(ENEMY_SLOT_TOP, 0x02);
  for (let i = 0; i <= 2; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x90 + i);
  m.mem.write8(ENEMY_TOTAL_COUNT, 0x20);
}

test("CAPTURE: real 0x994d dispatches -- spawnClimberInFreeSlot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); spawnClimberInFreeSlot(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED (free slot): spawnClimberInFreeSlot == oracle in RAM; slot 1 arrays seeded, count + lane bumped", () => {
  const o = new Machine(ROM, OPTS); seedFree(o);
  const c = new Machine(ROM, OPTS); seedFree(c);
  oracle(o); const rc = spawnClimberInFreeSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after seed");
  assert.equal(c.regs.a, o.regs.a, "A live-out equal (oracle sets regs.a; module returns it)");
  assert.equal(rc, 0x10, "found -> A=0x10");
  assert.equal(c.mem.read8((ENEMY_DEPTH + 1) & 0xffff), 0xaa, "$02df[1] = $29");
  assert.equal(c.mem.read8((ENEMY_SEGMENT + 1) & 0xffff), 0x05, "$02b9[1] = $2a");
  assert.equal(c.mem.read8((ENEMY_PHASE + 1) & 0xffff), 0x06, "$02cc[1] = ($2a+1)&0x0f");
  assert.equal(c.mem.read8((ENEMY_TIMER + 1) & 0xffff), 0x00, "$02a6[1] cleared");
  assert.equal(c.mem.read8((ENEMY_SLOT_DIR + 1) & 0xffff), 0xcc, "$028a[1] = $2c");
  assert.equal(c.mem.read8((ENEMY_SCRIPT_CURSOR + 1) & 0xffff), 0xdd, "$0291[1] = $2d");
  assert.equal(c.mem.read8((ENEMY_SLOT_FLAGS + 1) & 0xffff), 0x0b, "$0283[1] = $2b");
  assert.equal(c.mem.read8(ENEMY_TOTAL_COUNT), 0x21, "count incremented");
  assert.equal(c.mem.read8((LANE_ENEMY_COUNT_0 + 3) & 0xffff), 0x41, "lane counter incremented");
  assert.equal(c.mem.read8(SAVED_INDEX2), 0x07, "$36 = X on success");
});

test("CRAFTED (no free slot): spawnClimberInFreeSlot == oracle in RAM; returns A=0, count untouched", () => {
  const o = new Machine(ROM, OPTS); seedFull(o);
  const c = new Machine(ROM, OPTS); seedFull(c);
  oracle(o); const rc = spawnClimberInFreeSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out equal (oracle sets regs.a; module returns it)");
  assert.equal(rc, 0x00, "none free -> A=0");
  assert.equal(c.mem.read8(ENEMY_TOTAL_COUNT), 0x20, "count untouched");
  assert.equal(c.mem.read8(SAVED_INDEX2), 0x09, "$36 = Y on failure");
});

test("TEETH: a twin that skips the active-count increment diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedFree(o);
  const c = new Machine(ROM, OPTS); seedFree(c);
  oracle(o);
  const broken = (m) => {
    const mem = m.mem8;
    let y = m.regs.y;
    mem[SAVED_INDEX2] = y;
    y = mem[ENEMY_SLOT_TOP];
    while (mem[(ENEMY_DEPTH + y) & 0xffff] !== 0) { y = (y - 1) & 0xff; if (y & 0x80) return; }
    mem[(ENEMY_DEPTH + y) & 0xffff] = mem[loc_29];
    const a = mem[loc_2a];
    mem[(ENEMY_SEGMENT + y) & 0xffff] = a;
    mem[(ENEMY_PHASE + y) & 0xffff] = (a + 1) & 0x0f;
    mem[(ENEMY_TIMER + y) & 0xffff] = 0x00;
    mem[(ENEMY_SLOT_DIR + y) & 0xffff] = mem[COORD_LIST_PTR_LO];
    mem[(ENEMY_SCRIPT_CURSOR + y) & 0xffff] = mem[COORD_LIST_PTR_HI];
    // BUG: never increments the active count at $0108
    mem[(ENEMY_SLOT_FLAGS + y) & 0xffff] = mem[loc_2b];
    const lane = mem[loc_2b] & 0x07;
    mem[SAVED_INDEX2] = m.regs.x;
    mem[(LANE_ENEMY_COUNT_0 + lane) & 0xffff] = mem[(LANE_ENEMY_COUNT_0 + lane) & 0xffff] + 1;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped count increment");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedFree(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, spawnClimberInFreeSlot, TARGET, m);
  assert.equal(r.placeable, true, `spawnClimberInFreeSlot must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
