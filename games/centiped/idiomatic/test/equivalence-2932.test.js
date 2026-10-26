// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedPlayerShotStartCells (ROM 0x2932) -- seeds six start cells from fixed
// constants, three EOR-folded against the 0xF0..0xF2 orientation bytes:
//   0x43 = 0x10^[F2]; 0x63 = 0x80; 0x62 = 0x80; 0x73 = 0x08^[F0]; 0x72 = 0x0C^[F1]; 0x42 = 0x11^[F2].
// All effects are in work RAM (in dumpState); the RAM diff is the full check. Clean omitted-ret leaf.
// Run: node --test games/centiped/idiomatic/test/equivalence-2932.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2932 as oracleRom } from "../../translated/loc_2932.js";
import { seedPlayerShotStartCells } from "../seedPlayerShotStartCells.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_42, loc_43, loc_62, loc_63, loc_72, loc_73, loc_f0, loc_f1, loc_f2 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2932;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// A pristine crafted machine: a real 6502 caller-return seated in dead scratch, the orientation bytes set,
// and the six target cells pre-loaded with a sentinel so a dropped store is visible.
function craft(f0, f1, f2) {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.push16(0x2000);
  m.mem.write8(loc_f0, f0);
  m.mem.write8(loc_f1, f1);
  m.mem.write8(loc_f2, f2);
  for (const a of [loc_42, loc_43, loc_62, loc_63, loc_72, loc_73]) m.mem.write8(a, 0x5a);
  return m;
}

test("CAPTURE: real 0x2932 dispatches -- seedPlayerShotStartCells == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); seedPlayerShotStartCells(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the six start cells are seeded from the constants EOR the orientation bytes", () => {
  for (const [f0, f1, f2] of [[0x00, 0x00, 0x00], [0xff, 0xff, 0xff], [0x01, 0x02, 0x04], [0x80, 0x40, 0x20]]) {
    const o = craft(f0, f1, f2), c = craft(f0, f1, f2);
    oracle(o); seedPlayerShotStartCells(c);
    const label = `f=${f0.toString(16)}/${f1.toString(16)}/${f2.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM (-stack) ${label}`);
    assert.equal(c.mem.read8(loc_43), (0x10 ^ f2) & 0xff, `0x43 ${label}`);
    assert.equal(c.mem.read8(loc_63), 0x80, `0x63 ${label}`);
    assert.equal(c.mem.read8(loc_62), 0x80, `0x62 ${label}`);
    assert.equal(c.mem.read8(loc_73), (0x08 ^ f0) & 0xff, `0x73 ${label}`);
    assert.equal(c.mem.read8(loc_72), (0x0c ^ f1) & 0xff, `0x72 ${label}`);
    assert.equal(c.mem.read8(loc_42), (0x11 ^ f2) & 0xff, `0x42 ${label}`);
  }
});

// A broken twin using the wrong constant for 0x42 (0x12 instead of 0x11) -- differs for every f2.
function seedPlayerShotStartCells_wrongConst(m) {
  const mem = m.mem;
  mem.write8(loc_43, 0x10 ^ mem.read8(loc_f2));
  mem.write8(loc_63, 0x80);
  mem.write8(loc_62, 0x80);
  mem.write8(loc_73, 0x08 ^ mem.read8(loc_f0));
  mem.write8(loc_72, 0x0c ^ mem.read8(loc_f1));
  mem.write8(loc_42, 0x12 ^ mem.read8(loc_f2)); // BUG: should be 0x11
}

test("TEETH: a twin with the wrong 0x42 constant diverges in RAM", () => {
  const o = craft(0x00, 0x00, 0x00), c = craft(0x00, 0x00, 0x00);
  oracle(o); seedPlayerShotStartCells_wrongConst(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the wrong 0x42 constant");
  assert.equal(d.addr, loc_42 & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, seedPlayerShotStartCells, TARGET, craft(0x00, 0x00, 0x00));
  assert.equal(r.placeable, true, `seedPlayerShotStartCells must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
