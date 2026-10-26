// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for insertObjectFromSlotDepth (ROM 0xa3ca-0xa3d3) -- rings the fixed sound cue (jsr $ccc1), copies the
// y-indexed byte $02df,y into scratch $29, then falls through into insertTimedObjectOfType (stash A -> $2c, insert an object
// into the 8-slot table). The idiomatic side dissolves jsr $ccc1 and the fall-through into direct
// gateSound1f(...)/insertTimedObjectOfType(...) calls. Live-out is memory only (A/X/Y at exit are incidental -- the ROM's
// ccc1 chain restores X/Y, and the tail routine consumes A), so each arm compares RAM (dumpState minus
// stack scratch below the entry SP). Run: node --test games/tempest/idiomatic/test/equivalence-a3ca.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a3ca } from "../../translated/loc_a3ca.js";
import { insertObjectFromSlotDepth } from "../insertObjectFromSlotDepth.js";
import { gateSound1f } from "../gateSound1f.js";
import { insertTimedObjectOfType } from "../insertTimedObjectOfType.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { STATUS_FLAGS, loc_29, COORD_LIST_PTR_LO, ENEMY_DEPTH, loc_31, loc_32 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa3ca;
const oracle = atEntry(loc_a3ca);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa3ca dispatches -- insertObjectFromSlotDepth == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); insertObjectFromSlotDepth(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed a distinct source byte at $02df,y and known A/X so the copy-into-$29 and the object insert are
// observable; on a fresh machine the 8-slot table ($030a..) is empty so slot 7 is reused with no eviction.
const Y = 0x03, XREG = 0x12, AREG = 0x5c, SRC = 0xa7;
function seed(m) {
  m.regs.a = AREG; m.regs.x = XREG; m.regs.y = Y;
  m.mem.write8(STATUS_FLAGS, 0x80);            // open the ccc1->ccc3 sound gate so the X/Y stamp actually runs
  m.mem.write8(loc_31, 0xaa);           // pre-dirty the $31/$32 stamp cells so the marshalling is observable
  m.mem.write8(loc_32, 0xbb);
  m.mem.write8(u16(ENEMY_DEPTH + Y), SRC);  // y-indexed source byte
}

test("CRAFTED: $29 <- $02df,y and A -> $2c; RAM equal after the insert", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); insertObjectFromSlotDepth(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after ring/copy/insert");
  assert.equal(c.mem.read8(loc_29), SRC, "$29 took the y-indexed source byte");
  assert.equal(c.mem.read8(COORD_LIST_PTR_LO), AREG, "$2c took the incoming A");
  assert.equal(c.mem.read8(loc_31), XREG, "$31 = X (ccc1 marshalling, gate open)");
  assert.equal(c.mem.read8(loc_32), Y, "$32 = Y (ccc1 marshalling, gate open)");
});

// Marshalling teeth: a twin that swaps X/Y into the dissolved ccc1 call must diverge -- proves the caller's
// X/Y are threaded through in the right order (only visible with the sound gate open, as seed() sets it).
function loc_a3caSwapped(m, a = m.regs.a, x = m.regs.x, y = m.regs.y) {
  gateSound1f(m, y, x); // BUG: X and Y swapped into ccc1
  m.mem8[loc_29] = m.mem8[u16(ENEMY_DEPTH + y)];
  return insertTimedObjectOfType(m, a, x, y);
}

test("TEETH (marshalling): swapped X/Y into ccc1 diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c);
  loc_a3caSwapped(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch swapped X/Y into ccc1");
});

// A faithful twin minus the single defect (the $02df,y -> $29 copy): proves the omission alone is caught.
function loc_a3caPartial(m, a = m.regs.a, x = m.regs.x, y = m.regs.y) {
  gateSound1f(m, x, y);
  // BUG: skip mem8[loc_29] = mem8[ENEMY_DEPTH + y]
  return insertTimedObjectOfType(m, a, x, y);
}

test("TEETH: a twin that skips the $02df,y -> $29 copy diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c);
  loc_a3caPartial(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped $29 copy");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, insertObjectFromSlotDepth, TARGET, m);
  assert.equal(r.placeable, true, `insertObjectFromSlotDepth must be seam-placeable; got: ${r.error}`);
});
