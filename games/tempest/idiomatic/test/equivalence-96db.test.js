// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resolveCoordListEntryToAbsolute (ROM 0x96db-0x96e1) -- reads (0x2c),y and adds the base $0160. It writes
// NO memory, so the RAM diff is trivially null and cannot by itself verify the transform: the behavioural
// contract is register A, checked in CAPTURE and CRAFTED. Pure leaf (no dispatch), no POKEY reads.
// Run: node --test games/tempest/idiomatic/test/equivalence-96db.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_96db } from "../../translated/loc_96db.js";
import { resolveCoordListEntryToAbsolute } from "../resolveCoordListEntryToAbsolute.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { COORD_LIST_PTR_LO, ENEMY_CLIMB_DELTA_LO_0 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x96db;
const oracle = atEntry(loc_96db);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x96db dispatches -- resolveCoordListEntryToAbsolute == oracle in A and RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); resolveCoordListEntryToAbsolute(c);
    assert.equal(c.regs.a, o.regs.a, "A live-out");
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed a 16-bit list pointer at $2c/$2d, the list byte at (ptr)+y, and the base at $0160.
function seed(m, s) {
  m.mem8[COORD_LIST_PTR_LO] = s.ptr & 0xff;
  m.mem8[(COORD_LIST_PTR_LO + 1) & 0xffff] = (s.ptr >> 8) & 0xff;
  m.mem8[(s.ptr + s.y) & 0xffff] = s.entry;
  m.mem8[ENEMY_CLIMB_DELTA_LO_0] = s.base;
  m.regs.y = s.y;
}

test("CRAFTED: A = (ptr)+y + $0160 == oracle across seeds", () => {
  const cases = [
    { tag: "plain add", ptr: 0x0400, y: 0x05, entry: 0x10, base: 0x20 },
    { tag: "carry wraps to byte", ptr: 0x0420, y: 0x03, entry: 0xf0, base: 0x30 },
    { tag: "both zero", ptr: 0x0440, y: 0x00, entry: 0x00, base: 0x00 },
    { tag: "y large", ptr: 0x0460, y: 0x7f, entry: 0x44, base: 0x11 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); resolveCoordListEntryToAbsolute(c);
    assert.equal(c.regs.a, o.regs.a, `A: ${s.tag}`);
    assert.equal(c.regs.a, (s.entry + s.base) & 0xff, `A value: ${s.tag}`);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a twin that skips the $0160 base add diverges in A", () => {
  // Non-default seed so the mutation bites: base $0160 = 0x20 (nonzero) must change the result.
  const s = { ptr: 0x0400, y: 0x05, entry: 0x10, base: 0x20 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  oracle(o);
  const broken = (m, y = m.regs.y) => { // BUG: returns the list byte without adding $0160
    const ptr = m.mem8[COORD_LIST_PTR_LO] | (m.mem8[(COORD_LIST_PTR_LO + 1) & 0xffff] << 8);
    return (m.regs.a = m.mem8[(ptr + y) & 0xffff]);
  };
  const c = new Machine(ROM, OPTS); seed(c, s);
  broken(c);
  assert.notEqual(c.regs.a, o.regs.a, "the A check FAILED to catch a skipped base add");
});
