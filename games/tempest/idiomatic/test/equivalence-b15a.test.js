// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitSegmentedSpanBetweenCursors (ROM 0xb15a-0xb1b3) -- stashes the A/X inputs into $57/$56, then walks a
// cursor $37 from $014d to $014e in steps of two, emitting three vector words per step via emitVectorWordTag70/df4c/
// df39, then two trailer words via drawSlotShapeWithHeader and a tail emitCoordinateVectorWord. The idiomatic side dissolves all five
// jsr/jmp into direct calls. Live-out is memory only (the emit list is a vector-drawer tail), so the arms
// compare RAM (dumpState -stack). Real base states seed the crafted/teeth arms so the emit terminates.
// Run: node --test games/tempest/idiomatic/test/equivalence-b15a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b15a } from "../../translated/loc_b15a.js";
import { emitSegmentedSpanBetweenCursors } from "../emitSegmentedSpanBetweenCursors.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { PROJ_PT_Y, OBJ_DEPTH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb15a;
const oracle = atEntry(loc_b15a);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xb15a dispatches -- emitSegmentedSpanBetweenCursors == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitSegmentedSpanBetweenCursors(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: a chosen A/X input is stashed and marshalled identically to the oracle", () => {
  if (!CAPS.length) { console.log("  CRAFTED: no dispatch captured -- skipped"); return; }
  const o = CAPS[0].clone(), c = CAPS[0].clone();
  o.regs.a = 0x5a; o.regs.x = 0xa5;
  c.regs.a = 0x5a; c.regs.x = 0xa5;
  oracle(o); emitSegmentedSpanBetweenCursors(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the crafted input");
  assert.equal(c.mem.read8(OBJ_DEPTH), 0x5a, "$57 holds the stashed A");
  assert.equal(c.mem.read8(PROJ_PT_Y), 0xa5, "$56 holds the stashed X");
});

test("TEETH: a twin that stashes nothing and emits nothing diverges from the oracle", () => {
  if (!CAPS.length) { console.log("  TEETH: no dispatch captured -- skipped"); return; }
  const o = CAPS[0].clone(), c = CAPS[0].clone();
  o.regs.a = 0x5a; o.regs.x = 0xa5;
  oracle(o);
  const brokenB15a = (_m) => { /* BUG: no stash, no cursor walk, no emit */ };
  brokenB15a(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped work");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, emitSegmentedSpanBetweenCursors, TARGET, m);
  assert.equal(r.placeable, true, `emitSegmentedSpanBetweenCursors must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail-caller (moved 0) placeable");
});
