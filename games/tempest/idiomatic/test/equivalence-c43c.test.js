// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loadSlotCoordBlock (ROM 0xc43c) -- gathers one column of four parallel $03xx tables (indexed
// by $37) into the working block $61..$64. Pure table-copy leaf: live-out is RAM only, so every arm checks
// the RAM diff minus dead stack. No POKEY/clock coupling, so the CRAFTED arms are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-c43c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c43c } from "../../translated/loc_c43c.js";
import { loadSlotCoordBlock } from "../loadSlotCoordBlock.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SLOT_LOOP_INDEX, OBJ_DY_HI, OBJ_DY_LO, OBJ_DX_HI, OBJ_DX_LO, PROJ_Y_LO, PROJ_Y_HI, PROJ_X_LO, PROJ_X_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : null; };
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc43c;
const oracle = atEntry(loc_c43c);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seed $37 with the column index and plant four distinct values in the four parallel source tables.
function seed(m, s = {}) {
  const x = s.x ?? 0x07;
  m.mem8[SLOT_LOOP_INDEX] = x;
  m.mem8[(OBJ_DY_LO + x) & 0xffff] = s.v61 ?? 0x11;
  m.mem8[(OBJ_DY_HI + x) & 0xffff] = s.v62 ?? 0x22;
  m.mem8[(OBJ_DX_LO + x) & 0xffff] = s.v63 ?? 0x33;
  m.mem8[(OBJ_DX_HI + x) & 0xffff] = s.v64 ?? 0x44;
  m.mem8[PROJ_Y_LO] = 0xee; m.mem8[PROJ_Y_HI] = 0xee; m.mem8[PROJ_X_LO] = 0xee; m.mem8[PROJ_X_HI] = 0xee;
}

test("CAPTURE: real 0xc43c dispatches -- loadSlotCoordBlock == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loadSlotCoordBlock(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the four-column gather == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "index 0x07, distinct values", x: 0x07, v61: 0x11, v62: 0x22, v63: 0x33, v64: 0x44 },
    { tag: "index 0x00", x: 0x00, v61: 0xa1, v62: 0xb2, v63: 0xc3, v64: 0xd4 },
    { tag: "index 0x0f, high column", x: 0x0f, v61: 0x01, v62: 0x02, v63: 0x03, v64: 0x04 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); loadSlotCoordBlock(c);
    assert.equal(ramDiff(o, c), null, s.tag);
    assert.equal(c.mem8[PROJ_Y_LO], s.v61, `${s.tag}: $61`);
    assert.equal(c.mem8[PROJ_X_HI], s.v64, `${s.tag}: $64`);
  }
});

test("TEETH: a rewrite that skips the $64 copy diverges from the oracle", () => {
  const s = { x: 0x07, v61: 0x11, v62: 0x22, v63: 0x33, v64: 0x44 }; // non-default $64 so the skip bites
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  const broken = (m) => { // BUG: never gathers the fourth column into $64 (leaves the 0xee garbage)
    const x = m.mem8[SLOT_LOOP_INDEX];
    m.mem8[PROJ_Y_LO] = m.mem8[(OBJ_DY_LO + x) & 0xffff];
    m.mem8[PROJ_Y_HI] = m.mem8[(OBJ_DY_HI + x) & 0xffff];
    m.mem8[PROJ_X_LO] = m.mem8[(OBJ_DX_LO + x) & 0xffff];
  };
  oracle(o); broken(c);
  assert.notEqual(o.mem8[PROJ_X_HI], 0xee, "precondition: oracle overwrote the $64 garbage");
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $64 copy");
});

test("SP-TOOTH: the pure leaf omits its ROM ret (SP unmoved) and is seam-placeable", () => {
  const mk = () => {
    const m = new Machine(ROM, OPTS);
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam's ret
    seed(m);
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, loadSlotCoordBlock, TARGET, mk());
  assert.equal(ok.placeable, true, `loadSlotCoordBlock must be seam-placeable; got: ${ok.error}`);
  // A mutant that pushes without popping moves SP net-nonzero -> the seam MUST refuse it.
  const spMutant = (m) => { m.push16(0x0000); };
  assert.equal(seamPlaceable(withOmittedRet, spMutant, TARGET, mk()).placeable, false, "SP tooth failed to refuse an unbalanced mutant");
  console.log("  SP-TOOTH: pure leaf placeable; unbalanced mutant refused");
});
