// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawTubeShapeOutline -- reduces an input byte into two scratch fields, emits a framing
// record, then walks two delta tables emitting 16 vector segments; dissolves m.calls to c2e8/df6a/
// df4c/df75 into direct idiomatic calls. Output is RAM (scratch cells + the ($74) vector list), so each
// arm compares the RAM diff (minus dead stack). A pure tail-caller (jmp df6a): A at RTS is incidental
// and not compared. CRAFTED keeps the c2e8 input < 0x62 so the POKEY-random branch is not taken.
// Run: node --test games/tempest/idiomatic/test/equivalence-c4e1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c4e1 } from "../../translated/loc_c4e1.js";
import { drawTubeShapeOutline } from "../drawTubeShapeOutline.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { PROJ_PT_Y, DRAW_CURSOR_LO, DRAW_CURSOR_HI, TUBE_SHAPE_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc4e1;
const oracle = atEntry(loc_c4e1);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// Seed a valid display-list pointer into vector RAM plus the shape selector byte.
function seat(m, s = {}) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00);
  m.mem.write8(DRAW_CURSOR_HI, 0x24);
  m.mem.write8(TUBE_SHAPE_INDEX, s.shape ?? 0x03);
  m.regs.a = s.a ?? 0x30;
}

test("CAPTURE: real 0xc4e1 dispatches -- drawTubeShapeOutline == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawTubeShapeOutline(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: reduce + framing + 16-segment walk == oracle (RAM)", () => {
  for (const s of [{ a: 0x30, shape: 0x03 }, { a: 0x11, shape: 0x00 }, { a: 0x4f, shape: 0x07 }]) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); drawTubeShapeOutline(c);
    assert.equal(ramDiff(o, c), null, `a=${s.a} shape=${s.shape}`);
  }
});

test("TEETH: a twin that corrupts the running delta field diverges from the oracle", () => {
  const s = { a: 0x30, shape: 0x03 };
  const o = new Machine(ROM, OPTS); seat(o, s);
  const c = new Machine(ROM, OPTS); seat(c, s);
  oracle(o);
  const broken = (mm) => { drawTubeShapeOutline(mm, s.a); mm.mem8[PROJ_PT_Y] ^= 0xff; }; // BUG: perturbs $56 after the walk
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the corrupted delta field");
});

test("SP-TOOTH: the omitted-ret tail rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m, {});
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawTubeShapeOutline, TARGET, m);
  assert.equal(r.placeable, true, `drawTubeShapeOutline must be seam-placeable; got: ${r.error}`);
});
