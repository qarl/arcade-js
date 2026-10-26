// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawMovingObjectSlots -- resets accumulators/seeds, caches the base pointer pair, draws each
// active slot's record, and closes by swapping pointers and drawing the base list. The idiomatic side
// dissolves the jsr chain (df39/b967/c098/b944/c3ba/b56a/c772/b955/df6c/df4c/df4a/df6a/df09) into direct
// calls. Live-out is RAM, so each arm compares dumpState minus stack scratch below the entry SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-b8ba.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b8ba } from "../../translated/loc_b8ba.js";
import { drawMovingObjectSlots } from "../drawMovingObjectSlots.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import {
  DEPTH_LO, DEPTH_HI, PROJ_OFS_X_LO, PROJ_OFS_X_HI, DRAW_CURSOR_LO, DRAW_CURSOR_HI, PLAYER_SHOT_DEPTH, ENEMY_SLOT_FLAGS,
  OBJECT_AXIS1_POS, ENEMY_POS2, SLOT_LOOP_INDEX, PROJ_PT_Y, OBJ_DEPTH, PROJ_PT_X, VG_RECORD_HEADER, DRAW_CURSOR_ALT_LO, DRAW_CURSOR_ALT_HI, loc_9e,
} from "../names.js";
import { emitCoordinateVectorWord } from "../emitCoordinateVectorWord.js";
import { emitVectorWordTag60FromKey } from "../emitVectorWordTag60FromKey.js";
import { emitTaggedVectorWord } from "../emitTaggedVectorWord.js";
import { emitBlankVectorWordTag70 } from "../emitBlankVectorWordTag70.js";
import { emitVectorWordTag70 } from "../emitVectorWordTag70.js";
import { emitRecordBodyC0 } from "../emitRecordBodyC0.js";
import { emitBlankValueRecord } from "../emitBlankValueRecord.js";
import { swapDrawPointers } from "../swapDrawPointers.js";
import { returnConstantTwo } from "../returnConstantTwo.js";
import { selectPointerPair } from "../selectPointerPair.js";
import { projectPointThroughMathbox } from "../projectPointThroughMathbox.js";
import { emitCoordDeltaRecord } from "../emitCoordDeltaRecord.js";
import { emitObjectPositionVector } from "../emitObjectPositionVector.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb8ba;
const oracle = atEntry(loc_b8ba);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb8ba dispatches -- drawMovingObjectSlots == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawMovingObjectSlots(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// No active slots: exercises the reset/seed prologue, the pointer caching, and the close (pointer swap
// plus the base list draw) without entering the per-slot record body (which drives the coprocessor).
function seedEmpty(m) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x28); // cursor into vector RAM
  m.mem.write8(0x0076, 0x00); m.mem.write8(0x0077, 0x2c); // second pointer
  for (let i = 0; i <= 0x0f; i++) m.mem.write8(u16(ENEMY_SLOT_FLAGS + i), 0x00); // no active slots
}

test("CRAFTED: no active slots -- prologue and close match the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedEmpty(o);
  const c = new Machine(ROM, OPTS); seedEmpty(c);
  oracle(o); drawMovingObjectSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after empty frame");
  assert.equal(c.mem.read8(DEPTH_HI), 0xe0, "seed $5f");
  assert.equal(c.mem.read8(DEPTH_LO), 0xff, "seed $5b");
  assert.equal(c.mem.read8(PLAYER_SHOT_DEPTH), 0x00, "cleared $0202");
  assert.equal(c.mem.read8(PROJ_OFS_X_LO), 0x00, "cleared $68");
  assert.equal(c.mem.read8(PROJ_OFS_X_HI), 0x00, "cleared $69");
});

test("TEETH: a twin that skips the seed writes diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedEmpty(o);
  const c = new Machine(ROM, OPTS); seedEmpty(c);
  oracle(o);
  const brokenB8ba = (_m) => { /* BUG: never resets accumulators, never draws, never closes */ };
  brokenB8ba(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing reset/close");
});

// One active slot (x=0): drives the per-slot record body (integrate + emit) that the empty seed skips,
// so the whole dissolve chain (c098/b944/c3ba/b56a/c772/b955->df6c/df4c/df4a/b967->df39) is exercised
// against the oracle. Cursor + second pointer aim at vector RAM so the emitted records land in the diff.
function seedActive(m) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x28); // cursor into vector RAM
  m.mem.write8(DRAW_CURSOR_ALT_LO, 0x00); m.mem.write8(DRAW_CURSOR_ALT_HI, 0x2c); // second pointer
  for (let i = 0; i <= 0x0f; i++) m.mem.write8(u16(ENEMY_SLOT_FLAGS + i), 0x00);
  m.mem.write8(u16(ENEMY_SLOT_FLAGS + 0), 0x01);  // slot 0 active
  m.mem.write8(u16(OBJECT_AXIS1_POS + 0), 0x40);  // its delta bytes (distinct)
  m.mem.write8(u16(ENEMY_POS2 + 0), 0x30);
}

test("CRAFTED: one active slot -- per-slot record body marshalling matches the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedActive(o);
  const c = new Machine(ROM, OPTS); seedActive(c);
  oracle(o); drawMovingObjectSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after one active slot's record is emitted");
});

// A twin whose per-slot body is byte-identical EXCEPT the emitBlankValueRecord shadow-header arg (0xa0 -> 0x00) --
// a marshalling mutation. It MUST diverge, proving the active-slot arm actually verifies the body
// (not a vacuous pass over a skipped body).
function brokenMarshal(m) {
  const { mem8 } = m;
  emitCoordinateVectorWord(m, 0x3f, 0xf2);
  mem8[0x6a] = 0x00; mem8[0x6b] = 0x00; mem8[0x6c] = 0x00; mem8[0x6d] = 0x00;
  mem8[PLAYER_SHOT_DEPTH] = 0x00; mem8[PROJ_OFS_X_LO] = 0x00; mem8[PROJ_OFS_X_HI] = 0x00;
  mem8[DEPTH_HI] = 0xe0; mem8[DEPTH_LO] = 0xff;
  { const [a, x] = selectPointerPair(m); mem8[DRAW_CURSOR_ALT_HI] = a; mem8[DRAW_CURSOR_ALT_LO] = x; }
  mem8[SLOT_LOOP_INDEX] = 0x0f;
  do {
    const x = mem8[SLOT_LOOP_INDEX];
    const active = mem8[u16(ENEMY_SLOT_FLAGS + x)];
    if (active !== 0) {
      mem8[OBJ_DEPTH] = active;
      mem8[PROJ_PT_Y] = mem8[u16(OBJECT_AXIS1_POS + x)];
      mem8[PROJ_PT_X] = mem8[u16(ENEMY_POS2 + x)];
      projectPointThroughMathbox(m);
      mem8[VG_RECORD_HEADER] = 0x00;
      swapDrawPointers(m);
      emitCoordDeltaRecord(m);
      emitBlankValueRecord(m, 0x00);          // BUG: shadow-header arg should be 0xa0
      swapDrawPointers(m);
      emitObjectPositionVector(m, 0x61);
      const [pa, py] = returnConstantTwo(m);
      emitVectorWordTag70(m, pa, py);
      let phase = mem8[SLOT_LOOP_INDEX] & 0x07;
      if (phase === 0x07) phase = 0x00;
      mem8[loc_9e] = phase;
      emitTaggedVectorWord(m, 0x08, phase);
      emitVectorWordTag60FromKey(m, 0x00);
      const [ha, hx] = selectPointerPair(m);
      emitCoordinateVectorWord(m, ha, hx);
    }
    const next = (mem8[SLOT_LOOP_INDEX] - 1) & 0xff;
    mem8[SLOT_LOOP_INDEX] = next;
    if (next & 0x80) break;
  } while (true);
  swapDrawPointers(m);
  emitBlankVectorWordTag70(m, 0x01);
  emitRecordBodyC0(m);
  swapDrawPointers(m);
}

test("TEETH (marshalling): a twin with the wrong emitBlankValueRecord shadow arg diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedActive(o);
  const c = new Machine(ROM, OPTS); seedActive(c);
  oracle(o); brokenMarshal(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong emitBlankValueRecord arg");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedEmpty(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawMovingObjectSlots, TARGET, m);
  assert.equal(r.placeable, true, `drawMovingObjectSlots must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail-caller (moved 0) placeable");
});
