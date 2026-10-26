// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitFixedVectorWord (ROM 0xab0d-0xab13) -- emits a vector word {0x20,0x80} at the cursor
// origin ($74/$75), then steps the cursor past it. A pure tail-caller that dissolves the jmp into a direct
// emitVectorWord call. All live-out is RAM (the two emitted bytes + the advanced cursor); the oracle also leaves
// A = the new cursor-low byte (a df5f-family live-out the idiomatic tail does not reproduce), and ab0d
// reads no register after, so each arm compares RAM (dumpState minus stack scratch below the entry SP) only, not A.
// Run: node --test games/tempest/idiomatic/test/equivalence-ab0d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ab0d } from "../../translated/loc_ab0d.js";
import { emitFixedVectorWord } from "../emitFixedVectorWord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xab0d;
const oracle = atEntry(loc_ab0d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// Seat the cursor at a VECTOR RAM origin (0x2000-0x2fff, diffed) so the emitted word and the stepped
// cursor land in a seedable, comparable region.
function seed(m, s = {}) {
  const ptr = s.ptr ?? 0x2500;
  m.mem.write8(DRAW_CURSOR_LO, ptr & 0xff);
  m.mem.write8(DRAW_CURSOR_HI, (ptr >> 8) & 0xff);
  return ptr;
}

test("CAPTURE: real 0xab0d dispatches -- emitFixedVectorWord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitFixedVectorWord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: emits {0x20,0x80} at the cursor and advances it by 2", () => {
  const ptr = 0x2500;
  const o = new Machine(ROM, OPTS); seed(o, { ptr });
  const c = new Machine(ROM, OPTS); seed(c, { ptr });
  oracle(o); emitFixedVectorWord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.mem.read8(ptr), 0x20, "low byte emitted");
  assert.equal(c.mem.read8(ptr + 1), 0x80, "high byte emitted");
  assert.equal(c.mem.read8(DRAW_CURSOR_LO), (ptr + 2) & 0xff, "cursor advanced by 2");
});

test("CRAFTED (non-default seed): a cursor that carries into $75 still matches the oracle", () => {
  const ptr = 0x25ff; // stepping by 2 overflows the low byte -> carry into $75
  const o = new Machine(ROM, OPTS); seed(o, { ptr });
  const c = new Machine(ROM, OPTS); seed(c, { ptr });
  oracle(o); emitFixedVectorWord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal across the high-byte carry");
});

test("TEETH: a twin that swaps the emitted byte pair diverges from the oracle", () => {
  const ptr = 0x2500;
  const o = new Machine(ROM, OPTS); seed(o, { ptr });
  const c = new Machine(ROM, OPTS); seed(c, { ptr });
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    const p = mem8[DRAW_CURSOR_LO] | (mem8[DRAW_CURSOR_HI] << 8);
    mem8[p] = 0x80; mem8[(p + 1) & 0xffff] = 0x20; // BUG: swapped low/high bytes
    mem8[DRAW_CURSOR_LO] = (mem8[DRAW_CURSOR_LO] + 2) & 0xff;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the swapped emit");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitFixedVectorWord, TARGET, m);
  assert.equal(r.placeable, true, `emitFixedVectorWord must be seam-placeable; got: ${r.error}`);
});
