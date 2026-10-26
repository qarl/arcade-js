// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitDeltaVectorPair -- stores two 16-bit differences through the ($74) pointer at cursor $a9,
// low bytes raw, high bytes masked to 5 bits (the second OR'd 0xa0), advancing $a9 by four. Live-out is
// memory only, so each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). A leaf:
// the module omits the ROM ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-c73c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c73c } from "../../translated/loc_c73c.js";
import { emitDeltaVectorPair } from "../emitDeltaVectorPair.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_OFFSET, PROJ_Y_LO, PROJ_Y_HI, PROJ_X_LO, PROJ_X_HI, PREV_Y_LO, PREV_Y_HI, PREV_X_LO, PREV_X_HI, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc73c;
const oracle = atEntry(loc_c73c);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// base 0x0300, cursor 0x10; ($1234-$0211)=0x1023 -> 23,10 ; ($0200-$0001)=0x01ff -> ff,a1
const seed = (m) => {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x03);
  m.mem.write8(DRAW_CURSOR_OFFSET, 0x10);
  m.mem.write8(PROJ_X_LO, 0x34); m.mem.write8(PROJ_X_HI, 0x12);
  m.mem.write8(PREV_X_LO, 0x11); m.mem.write8(PREV_X_HI, 0x02);
  m.mem.write8(PROJ_Y_LO, 0x00); m.mem.write8(PROJ_Y_HI, 0x02);
  m.mem.write8(PREV_Y_LO, 0x01); m.mem.write8(PREV_Y_HI, 0x00);
};

test("CAPTURE: real 0xc73c dispatches -- emitDeltaVectorPair == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitDeltaVectorPair(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: two 16-bit deltas stored at $0310.. and $a9 advanced by four", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitDeltaVectorPair(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after stores");
  assert.equal(c.mem.read8(0x0310), 0x23, "delta1 lo");
  assert.equal(c.mem.read8(0x0311), 0x10, "delta1 hi (5-bit)");
  assert.equal(c.mem.read8(0x0312), 0xff, "delta2 lo");
  assert.equal(c.mem.read8(0x0313), 0xa1, "delta2 hi (5-bit | 0xa0)");
  assert.equal(c.mem.read8(DRAW_CURSOR_OFFSET), 0x14, "$a9 advanced by four");
});

test("TEETH: a twin that skips the 0xa0 on the second high byte diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const mem = m.mem8;
    let y = mem[DRAW_CURSOR_OFFSET];
    const base = mem[DRAW_CURSOR_LO] | (mem[DRAW_CURSOR_HI] << 8);
    const d1 = ((mem[PROJ_X_LO] | (mem[PROJ_X_HI] << 8)) - (mem[PREV_X_LO] | (mem[PREV_X_HI] << 8))) & 0xffff;
    mem[(base + y) & 0xffff] = d1 & 0xff; y = (y + 1) & 0xff;
    mem[(base + y) & 0xffff] = (d1 >> 8) & 0x1f; y = (y + 1) & 0xff;
    const d2 = ((mem[PROJ_Y_LO] | (mem[PROJ_Y_HI] << 8)) - (mem[PREV_Y_LO] | (mem[PREV_Y_HI] << 8))) & 0xffff;
    mem[(base + y) & 0xffff] = d2 & 0xff; y = (y + 1) & 0xff;
    mem[(base + y) & 0xffff] = (d2 >> 8) & 0x1f; y = (y + 1) & 0xff; // BUG: dropped | 0xa0
    mem[DRAW_CURSOR_OFFSET] = y;
  };
  broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped 0xa0");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, emitDeltaVectorPair, TARGET, m);
  assert.equal(r.placeable, true, `emitDeltaVectorPair must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
