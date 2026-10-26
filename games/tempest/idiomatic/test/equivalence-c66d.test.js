// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitSlotMidpointVertex (ROM 0xc66d-0xc6c6) -- averages a slot's two 16-bit coordinate pairs with
// its wrap-around neighbour (round-up, sign-preserving halve) into $61/$62 and $63/$64, appends four bytes to
// the ($74) display list (high bytes masked 0x1f), mirrors them to $6a-$6d, advances the $a9 cursor. Live-out
// is memory only (A/X/Y at RTS are incidental), so each side runs on a clone and the contract is RAM
// (dumpState, minus stack scratch below the entry SP). A leaf: it omits the ROM ret and the seam completes it. No POKEY read.
// Run: node --test games/tempest/idiomatic/test/equivalence-c66d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c66d } from "../../translated/loc_c66d.js";
import { emitSlotMidpointVertex } from "../emitSlotMidpointVertex.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  TABLE_CURSOR, PROJ_Y_LO, PROJ_Y_HI, PROJ_X_LO, PROJ_X_HI, DRAW_CURSOR_OFFSET,
  DRAW_CURSOR_LO, OBJ_DY_HI, OBJ_DY_LO, OBJ_DX_HI, OBJ_DX_LO,
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

const TARGET = 0xc66d;
const oracle = atEntry(loc_c66d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// Seed the four coordinate arrays (16 entries each) plus the display-list pointer, cursor and slot. The
// pointer targets 0x0300 so the appended bytes land in free RAM clear of the zero-page cells under test.
const DLIST = 0x0300;
function seed(m, slot) {
  for (let i = 0; i < 16; i++) {
    m.mem.write8((OBJ_DY_HI + i) & 0xffff, 0x20 + i);       // pair1 high
    m.mem.write8((OBJ_DY_LO + i) & 0xffff, (i * 7) & 0xff); // pair1 low
    m.mem.write8((OBJ_DX_HI + i) & 0xffff, 0x30 + i);       // pair2 high
    m.mem.write8((OBJ_DX_LO + i) & 0xffff, (i * 5) & 0xff); // pair2 low
  }
  m.mem.write8(TABLE_CURSOR, slot);
  m.mem.write8(DRAW_CURSOR_OFFSET, 0x10);
  m.mem.write16(DRAW_CURSOR_LO, DLIST);
}

test("CAPTURE: real 0xc66d dispatches -- emitSlotMidpointVertex == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitSlotMidpointVertex(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: midpoints, display-list append, mirrors and cursor all match the oracle in RAM", () => {
  for (const slot of [0x00, 0x03, 0x08, 0x0f]) {
    const o = new Machine(ROM, OPTS); seed(o, slot);
    const c = new Machine(ROM, OPTS); seed(c, slot);
    oracle(o); emitSlotMidpointVertex(c);
    const label = `slot=0x${slot.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM diverged: ${label}`);
    for (const a of [PROJ_Y_LO, PROJ_Y_HI, PROJ_X_LO, PROJ_X_HI, DRAW_CURSOR_OFFSET])
      assert.equal(c.mem.read8(a), o.mem.read8(a), `cell 0x${a.toString(16)} diverged: ${label}`);
    for (let k = 0; k < 4; k++)
      assert.equal(c.mem.read8(DLIST + 0x10 + k), o.mem.read8(DLIST + 0x10 + k), `dlist[${k}] diverged: ${label}`);
  }
});

test("TEETH: a twin that skips the 0x1f high-byte mask diverges from the oracle", () => {
  const slot = 0x03; // non-default seed: pair highs 0x20+/0x30+ have bits above 0x1f, so the mask bites
  const o = new Machine(ROM, OPTS); seed(o, slot);
  const c = new Machine(ROM, OPTS); seed(c, slot);
  oracle(o);
  const broken = (m) => {
    const mem = m.mem8;
    const next = (mem[TABLE_CURSOR] + 1) & 0x0f;
    const p1 = ((mem[(OBJ_DY_HI + slot) & 0xffff] << 8) | mem[(OBJ_DY_LO + slot) & 0xffff])
             + ((mem[(OBJ_DY_HI + next) & 0xffff] << 8) | mem[(OBJ_DY_LO + next) & 0xffff]) + 1;
    const h1 = ((p1 & 0xffff) >> 1) | (p1 & 0x8000);
    const p2 = ((mem[(OBJ_DX_HI + slot) & 0xffff] << 8) | mem[(OBJ_DX_LO + slot) & 0xffff])
             + ((mem[(OBJ_DX_HI + next) & 0xffff] << 8) | mem[(OBJ_DX_LO + next) & 0xffff]) + 1;
    const h2 = ((p2 & 0xffff) >> 1) | (p2 & 0x8000);
    const ptr = m.mem.read16(DRAW_CURSOR_LO);
    let cur = mem[DRAW_CURSOR_OFFSET];
    mem[(ptr + cur) & 0xffff] = h2 & 0xff; cur = (cur + 1) & 0xff;
    mem[(ptr + cur) & 0xffff] = (h2 >> 8) & 0xff; cur = (cur + 1) & 0xff; // BUG: no & 0x1f
    mem[(ptr + cur) & 0xffff] = h1 & 0xff; cur = (cur + 1) & 0xff;
    mem[(ptr + cur) & 0xffff] = (h1 >> 8) & 0xff; cur = (cur + 1) & 0xff; // BUG: no & 0x1f
    mem[DRAW_CURSOR_OFFSET] = cur;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the unmasked high bytes");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seed(m, 0x03);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, emitSlotMidpointVertex, TARGET, m);
  assert.equal(r.placeable, true, `emitSlotMidpointVertex must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
