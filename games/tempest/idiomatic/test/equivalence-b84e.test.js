// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for dispatchDrawSetup (ROM 0xb84e-0xb856) -- an RTS-trick COMPUTED-JUMP dispatcher: the caller passes
// Y as a byte offset (0,2,4,6) into the 2-byte jump table at $b857; the target (word+1) is one of
// 0xb85f/0xb875/0xb888/0xb896 and its RTS returns to dispatchDrawSetup's own caller. The idiomatic form dissolves the
// push/pull16/rts-jump into TABLE[y>>1](m). Live-out is RAM: the dispatched targets are themselves idiomatic
// seams that carry NO register live-out (they drop A/X/Y), so the contract is RAM (dumpState, minus
// stack scratch below the entry SP); the oracle's stack gymnastics land below the entry SP and are excluded.
// Run: node --test games/tempest/idiomatic/test/equivalence-b84e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b84e } from "../../translated/loc_b84e.js";
import { dispatchDrawSetup } from "../dispatchDrawSetup.js";
import { seedTripleArrays } from "../seedTripleArrays.js";
import { rotateTripleArray } from "../rotateTripleArray.js";
import { resetVectorTailCursor } from "../resetVectorTailCursor.js";
import { emitVectorTailRecord } from "../emitVectorTailRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { COLOR_CYCLE_0, COLOR_RAM_9, VECRAM_TAIL_CURSOR_LO, VECRAM_TAIL_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb84e;
const oracle = atEntry(loc_b84e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Dirty the cells the four table targets read/write so distinct entries produce distinct RAM.
function seed(m) {
  for (let i = 0; i < 3; i++) {
    m.mem.write8((COLOR_CYCLE_0 + i) & 0xffff, 0xa0 + i);
    m.mem.write8((COLOR_RAM_9 + i) & 0xffff, 0xb0 + i);
  }
  m.mem.write8(VECRAM_TAIL_CURSOR_LO, 0x33);
  m.mem.write8(VECRAM_TAIL_CURSOR_HI, 0x05);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb84e dispatches -- dispatchDrawSetup == oracle in RAM (-stack)", () => {
  const ys = new Set();
  for (const cap of CAPS) {
    ys.add(cap.regs.y);
    const o = cap.clone(), c = cap.clone();
    oracle(o); dispatchDrawSetup(c);
    assert.equal(ramDiff(o, c), null, `RAM equal for captured Y=${cap.regs.y}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked; distinct Y seen: [${[...ys].sort((a, b) => a - b).join(",")}]`);
});

test("CRAFTED: each table entry Y=0,2,4,6 -- dispatchDrawSetup == oracle in RAM (-stack)", () => {
  for (const y of [0, 2, 4, 6]) {
    const o = new Machine(ROM, OPTS); seed(o); o.regs.y = y;
    const c = new Machine(ROM, OPTS); seed(c); c.regs.y = y;
    oracle(o); dispatchDrawSetup(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching entry Y=${y}`);
  }
});

test("TEETH: a twin that dispatches the WRONG entry (y>>1)^1 diverges in RAM", () => {
  const y = 0; // real entry 0 (b85f) vs twin entry 1 (b875): distinct writes on the seeded state
  const o = new Machine(ROM, OPTS); seed(o); o.regs.y = y;
  const c = new Machine(ROM, OPTS); seed(c); c.regs.y = y;
  oracle(o);
  // BUG: dispatch the flipped table entry (b85f <-> b875) instead of the one Y selects.
  const broken = (m, yy = m.regs.y) => [seedTripleArrays, rotateTripleArray, resetVectorTailCursor, emitVectorTailRecord][(yy >> 1) ^ 1](m);
  broken(c, y);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the wrong-entry dispatch");
});

test("SP-TOOTH: the omitted-ret dispatcher (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.y = 0; // dispatch a pure-RAM leaf entry (b85f) so the seam sees a net-0 stack move
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, dispatchDrawSetup, TARGET, m);
  assert.equal(r.placeable, true, `dispatchDrawSetup must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dispatcher (moved 0) placeable");
});
