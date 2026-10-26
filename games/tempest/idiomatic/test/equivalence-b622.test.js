// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitAnimatedPhaseSlot -- a caller that reads slot x's table index and a four-phase animation
// offset, then dissolves its jmp into the already-idiomatic seatShapeParamsAndEmit (direct call, value + index passed
// explicitly). The callee chain shapes vector work cells; live-out is memory only, so each side runs on a
// clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). X flows in via the register bridge.
// Run: node --test games/tempest/idiomatic/test/equivalence-b622.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b622 } from "../../translated/loc_b622.js";
import { emitAnimatedPhaseSlot } from "../emitAnimatedPhaseSlot.js";
import { seatShapeParamsAndEmit } from "../seatShapeParamsAndEmit.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { ENEMY_SEGMENT, FRAME_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb622;
const oracle = atEntry(loc_b622);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xb622 dispatches -- emitAnimatedPhaseSlot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitAnimatedPhaseSlot(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

const seedVectorRam = (m) => { for (let a = 0x2000; a < 0x2100; a++) m.mem.write8(a, (a * 7) & 0xff); };
const seed = (m, x, phase, idx) => {
  seedVectorRam(m);
  m.regs.x = x;
  m.mem.write8(u16(ENEMY_SEGMENT + x), idx);
  m.mem.write8(FRAME_COUNTER, phase);
};

test("CRAFTED: seeded dispatch is RAM-equivalent through the dissolved callee", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x03, 0x25, 0x11);
  const c = new Machine(ROM, OPTS); seed(c, 0x03, 0x25, 0x11);
  oracle(o); emitAnimatedPhaseSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after dissolved call");
});

test("TEETH (non-default seed): a twin that omits the +0x12 offset diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x05, 0x2b, 0x1f);
  const c = new Machine(ROM, OPTS); seed(c, 0x05, 0x2b, 0x1f);
  oracle(o);
  const mem8 = c.mem8;
  const y = mem8[u16(ENEMY_SEGMENT + c.regs.x)];
  const a = ((mem8[FRAME_COUNTER] & 0x03) << 1) & 0xff; // BUG: drops the +0x12
  seatShapeParamsAndEmit(c, a, y);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing offset");
});
