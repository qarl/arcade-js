// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for computeCoordListBackDelta (ROM 0x96f4-0x96ff) -- records the incoming cursor index at $29, then
// returns A = $2b minus the byte at (($2c)) + (index - 2). A leaf (no jsr). Live-out is the RAM write at
// $29 plus the A register, so each arm compares RAM (dumpState minus stack scratch below the entry SP) and the module's
// return value against the oracle's exit A (o.regs.a). Y is net-unchanged, so it is not asserted.
// Run: node --test games/tempest/idiomatic/test/equivalence-96f4.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_96f4 } from "../../translated/loc_96f4.js";
import { computeCoordListBackDelta } from "../computeCoordListBackDelta.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x96f4;
const oracle = atEntry(loc_96f4);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// The operand is read through the ($2c) pointer at (index - 2). Seed the pointer into VECTOR RAM
// (0x2000-0x2fff, diffed) so the operand byte is a seedable, comparable cell.
function seed(m, s = {}) {
  const y = s.y ?? 0x05;
  const ptr = s.ptr ?? 0x2500;
  m.regs.y = y;
  m.mem.write8(loc_2b, s.base ?? 0x90);
  m.mem.write8(COORD_LIST_PTR_LO, ptr & 0xff);
  m.mem.write8(COORD_LIST_PTR_HI, (ptr >> 8) & 0xff);
  m.mem.write8((ptr + ((y - 2) & 0xff)) & 0xffff, s.operand ?? 0x30);
  return { y, ptr };
}

test("CAPTURE: real 0x96f4 dispatches -- computeCoordListBackDelta == oracle in RAM (-stack) and in exit A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o);
    const ra = computeCoordListBackDelta(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(ra, o.regs.a, "returned A must equal oracle exit A");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $29 records the index and A = base - operand", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const ra = computeCoordListBackDelta(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.mem.read8(loc_29), 0x05, "$29 records incoming index");
  assert.equal(ra, o.regs.a, "returned A equals oracle exit A");
  assert.equal(ra, 0x60, "0x90 - 0x30 = 0x60");
});

test("CRAFTED (non-default seed): a different index/base/operand still matches the oracle", () => {
  const s = { y: 0x0a, base: 0x40, ptr: 0x2600, operand: 0x77 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const ra = computeCoordListBackDelta(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (non-default seed)");
  assert.equal(ra, o.regs.a, "returned A equals oracle exit A (non-default seed)");
});

test("TEETH (live-out): a twin that indexes at the raw index (not index-2) diverges from oracle A", () => {
  // Distinct byte at index (vs index-2) so the wrong offset yields a different subtraction.
  const s = { y: 0x05, base: 0x90, ptr: 0x2500, operand: 0x30 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  o.mem.write8((s.ptr + s.y) & 0xffff, 0x11); // byte at raw index differs from the index-2 byte
  oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, s);
  c.mem.write8((s.ptr + s.y) & 0xffff, 0x11);
  const wrongTwin = (m, y = m.regs.y) => {
    const { mem8 } = m;
    const base = mem8[loc_2b];
    mem8[loc_29] = y;
    const ptr = mem8[COORD_LIST_PTR_LO] | (mem8[COORD_LIST_PTR_HI] << 8);
    return (base - mem8[(ptr + y) & 0xffff]) & 0xff; // BUG: uses y, not (y-2)
  };
  const ra = wrongTwin(c);
  assert.notEqual(ra, o.regs.a, "the live-out check FAILED to catch the wrong index offset");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, computeCoordListBackDelta, TARGET, m);
  assert.equal(r.placeable, true, `computeCoordListBackDelta must be seam-placeable; got: ${r.error}`);
});
