// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitJumpModeSlot (ROM 0xb60f-0xb61b) -- picks a jump-mode byte from the 0xb61e table by
// ($028a,x & 3), pairs it with the slot's target ($02b9,x), and tail-calls the shared emitter 0xbcfd. The
// idiomatic side dissolves the tail jmp into a direct seatShapeParamsAndEmit(m, modeByte, target) call. Live-out is
// memory only, so each arm compares RAM (dumpState minus stack scratch below the entry SP). seatShapeParamsAndEmit seats $0055/$0056/$0058
// then runs the emit chain. Run: node --test games/tempest/idiomatic/test/equivalence-b60f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b60f } from "../../translated/loc_b60f.js";
import { emitJumpModeSlot } from "../emitJumpModeSlot.js";
import { seatShapeParamsAndEmit } from "../seatShapeParamsAndEmit.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { ENEMY_SLOT_DIR, ENEMY_SEGMENT, JUMP_MODE_SHAPE, SEG_MID_X, SEG_MID_Y, DRAW_STYLE, PROJ_PT_Y, PROJ_PT_X } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb60f;
const oracle = atEntry(loc_b60f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xb60f dispatches -- emitJumpModeSlot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitJumpModeSlot(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Slot 3, mode 2 ($028a,3 & 3), target 7 ($02b9,3). seatShapeParamsAndEmit stashes the mode byte in $0055 and copies
// the two indexed table entries ($0435+7, $0445+7) into $0056/$0058 before the emit chain -- so seeding
// those two cells makes the target (y) marshalling observable.
function seed(m) {
  m.regs.x = 0x03;
  m.mem.write8(ENEMY_SLOT_DIR + 3, 0x02); // mode = 2
  m.mem.write8(ENEMY_SEGMENT + 3, 0x07); // target = 7
  m.mem.write8(SEG_MID_X + 7, 0xab);
  m.mem.write8(SEG_MID_Y + 7, 0xcd);
  m.mem.write8(SEG_MID_X + 8, 0x11); // distinct neighbour (for the wrong-y teeth)
  m.mem.write8(SEG_MID_Y + 8, 0x22);
}

test("CRAFTED: mode/target marshalled into seatShapeParamsAndEmit -- RAM equal to the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitJumpModeSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the emit");
  assert.equal(c.mem.read8(DRAW_STYLE), m0(c), "mode byte stashed");
  assert.equal(c.mem.read8(PROJ_PT_Y), 0xab, "target indexed the $0435 table");
  assert.equal(c.mem.read8(PROJ_PT_X), 0xcd, "target indexed the $0445 table");
});
function m0(m) { return m.mem.read8((JUMP_MODE_SHAPE + 2) & 0xffff); }

test("TEETH: a twin that skips the emit entirely diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (_m) => { /* BUG: never emits -- $0055/$0056/$0058 and the vector list untouched */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped emit");
});

test("TEETH (marshalling): a twin that passes the wrong target y diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const wrongY = (m, x = m.regs.x) => {
    const { mem8 } = m;
    const mode = mem8[(ENEMY_SLOT_DIR + x) & 0xffff] & 0x03;
    // BUG: target off by one -> reads the neighbour table entries into $0056/$0058
    return seatShapeParamsAndEmit(m, mem8[(JUMP_MODE_SHAPE + mode) & 0xffff], (mem8[(ENEMY_SEGMENT + x) & 0xffff] + 1) & 0xff);
  };
  wrongY(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong target y");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitJumpModeSlot, TARGET, m);
  assert.equal(r.placeable, true, `emitJumpModeSlot must be seam-placeable; got: ${r.error}`);
});
