// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for selectClimberSpawnLane -- picks a POKEY-random start lane, walks four candidate lists skipping
// empty lanes, and on a hit builds the $2c/$2d list pointer + $2b tag, returning A=$29 (or 0 on underflow).
// Live-out is memory plus A; each side runs on a clone and the RAM contract is dumpState minus stack scratch below the entry SP.
// A leaf: the module omits the ROM ret and the seam completes it, so arms compare RAM (-stack).
// The routine reads POKEY RANDOM ($60ca): both arms are fresh machines at cycle 0, so the RNG read matches
// across arms and ramDiff stays valid, but the random-derived lane is not asserted -- only non-poke facts are.
// Run: node --test games/tempest/idiomatic/test/equivalence-9abb.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9abb } from "../../translated/loc_9abb.js";
import { selectClimberSpawnLane } from "../selectClimberSpawnLane.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { POKEY1_RANDOM, loc_2b, loc_39, CANDIDATE_LANE_0, OBJECT_ANIM_TIMER, COORD_LIST_PTR_LO, LIST_PTR_TABLE_HI, COORD_LIST_PTR_HI, loc_29 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9abb;
const oracle = atEntry(loc_9abb);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seed every candidate lane non-empty so the walk qualifies on the first pass regardless of the random start.
function seedHit(m) {
  m.regs.x = 0x2a;
  for (let i = 0; i < 4; i++) m.mem.write8((CANDIDATE_LANE_0 + i) & 0xffff, i); // index table (values 0..3)
  for (let i = 0; i < 8; i++) m.mem.write8((OBJECT_ANIM_TIMER + i) & 0xffff, 0x11); // all lanes non-empty
  m.mem.write8(loc_29, 0x7e);
}

test("CAPTURE: real 0x9abb dispatches -- selectClimberSpawnLane == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); selectClimberSpawnLane(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED (qualifying walk): selectClimberSpawnLane == oracle in RAM; tail sets $2b/$2d, returns A=$29", () => {
  const o = new Machine(ROM, OPTS); seedHit(o);
  const c = new Machine(ROM, OPTS); seedHit(c);
  oracle(o); selectClimberSpawnLane(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after seed");
  assert.equal(c.regs.a, o.regs.a, "A live-out equal (oracle sets regs.a, returns undefined)");
  assert.equal(c.regs.a, 0x7e, "on a hit A = $29");
  assert.equal(c.mem.read8(loc_2b), 0x02, "$2b tag = 2 (non-poke, deterministic)");
  assert.equal(c.mem.read8(COORD_LIST_PTR_HI), c.mem.read8((LIST_PTR_TABLE_HI + 2) & 0xffff), "$2d = list-hi table[2]");
  assert.equal(c.mem.read8(loc_39), 0x2a, "$39 = stashed X");
});

test("TEETH: a twin that skips the tail $2b tag store diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedHit(o);
  const c = new Machine(ROM, OPTS); seedHit(c);
  oracle(o);
  const broken = (m) => {
    const mem = m.mem8;
    let y = mem[POKEY1_RANDOM] & 0x03;
    mem[loc_2b] = 0x04;
    mem[loc_39] = m.regs.x;
    let idx;
    while (true) {
      const tag = (mem[loc_2b] - 1) & 0xff;
      mem[loc_2b] = tag;
      if (tag & 0x80) return;
      y = (y - 1) & 0xff;
      if (y & 0x80) y = 0x03;
      idx = mem[(CANDIDATE_LANE_0 + y) & 0xffff];
      if (idx === 0x03) idx = 0x05;
      if (mem[(OBJECT_ANIM_TIMER + idx) & 0xffff] !== 0) break;
    }
    const a = mem[(CANDIDATE_LANE_0 + y) & 0xffff] | 0x40;
    y = 0x02;
    mem[COORD_LIST_PTR_LO] = a;
    // BUG: never writes the tail $2b tag (leaves the loop's decremented value)
    mem[COORD_LIST_PTR_HI] = mem[(LIST_PTR_TABLE_HI + y) & 0xffff];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped $2b store");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedHit(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, selectClimberSpawnLane, TARGET, m);
  assert.equal(r.placeable, true, `selectClimberSpawnLane must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
