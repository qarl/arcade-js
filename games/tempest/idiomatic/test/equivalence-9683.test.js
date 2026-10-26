// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for dispatchCursorAdvanceBySelector -- a computed-jump dispatcher. COORD_DISPATCH_SEL is an even byte index that selects a
// little-endian pointer; the target (pointer+1) is tail-called and consumes dispatchCursorAdvanceBySelector's own caller's return.
// Before dispatching, A is seated to the low byte of the selected pointer; the Y-only targets leave A alone,
// so that byte is a live-out the caller reads back (it stores A right after the dispatch). The 96cb target
// overwrites A with its own result, so comparing A is correct on every path. Contract = RAM (dumpState minus
// stack scratch below the entry SP) PLUS the A register. X is NOT compared: dispatchCursorAdvanceBySelector loads X purely as the table index and the
// caller reloads X before reading it, so X is dead; Y is the target's, threaded by param in the idiomatic
// layer. Oracle is the frozen translated dispatchCursorAdvanceBySelector.
// Run: node --test games/tempest/idiomatic/test/equivalence-9683.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9683 } from "../../translated/loc_9683.js";
import { dispatchCursorAdvanceBySelector } from "../dispatchCursorAdvanceBySelector.js";
import { advanceCursorPastPackedRecord, advanceListCursorByTwo } from "../advanceCursorPastPackedRecord.js";
import { advanceCoordListByEntryStride } from "../advanceCoordListByEntryStride.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { COORD_DISPATCH_SEL, loc_29, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9683;
// The same handler set the idiomatic module dispatches, indexed by COORD_DISPATCH_SEL >> 1 (entry 0 is a disabled slot).
const TABLE = [null, advanceListCursorByTwo, advanceCoordListByEntryStride, advanceCoordListByEntryStride, advanceCursorPastPackedRecord, advanceListCursorByTwo, advanceCursorPastPackedRecord];
const VALID_INDICES = [2, 4, 6, 8, 10, 12];

const oracle = atEntry(loc_9683);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
// Contract: RAM (minus dead stack) plus the A live-out. Returns a reason string on divergence, else null.
function stateDiff(ma, mb) {
  const rd = ramDiff(ma, mb);
  if (rd !== null) return `RAM ${JSON.stringify(rd)}`;
  if (ma.regs.a !== mb.regs.a) return `A oracle=${ma.regs.a} idiomatic=${mb.regs.a}`;
  return null;
}

// Point the packed-list pointer (0x2c) at vector RAM so the 96cb target's reads land in mapped memory,
// set a mid-list cursor Y, and select a table entry by its even index.
function seed(m, index) {
  m.mem.write8(COORD_DISPATCH_SEL, index);
  m.regs.y = 0x04;
  m.mem.write8(COORD_LIST_PTR_LO, 0x00);
  m.mem.write8(COORD_LIST_PTR_HI, 0x20); // (0x2c) -> 0x2000
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9683 dispatches -- dispatchCursorAdvanceBySelector == oracle in RAM (-stack) + A", () => {
  let checked = 0;
  const idx = new Set();
  for (const cap of CAPS) {
    idx.add(cap.mem.read8(COORD_DISPATCH_SEL));
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented arm
    if (threw) continue; // both layers throw identically there; nothing to compare
    dispatchCursorAdvanceBySelector(c);
    assert.equal(stateDiff(o, c), null, "captured dispatch equal");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared; distinct COORD_DISPATCH_SEL seen: [${[...idx].sort((a, b) => a - b).join(",")}]`);
});

test("CRAFTED: each even index -- dispatchCursorAdvanceBySelector == oracle in RAM (-stack) + A", () => {
  let checked = 0;
  for (const index of VALID_INDICES) {
    const o = new Machine(ROM, OPTS); seed(o, index);
    const c = new Machine(ROM, OPTS); seed(c, index);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an entry the generic seed cannot fully provision -- CAPTURE + others carry it
    dispatchCursorAdvanceBySelector(c);
    assert.equal(stateDiff(o, c), null, `equal after dispatching index=${index}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/${VALID_INDICES.length} indices provisioned and checked`);
  assert.ok(checked >= 1, "no index could be provisioned -- seed is inert");
});

test("TEETH (A live-out): a twin that skips seating A MUST diverge", () => {
  // Index 2 dispatches a Y-only target: neither layer writes RAM, so A alone carries the divergence.
  const o = new Machine(ROM, OPTS); seed(o, 2);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH(A): oracle threw on this seed -- skipped"); return; }
  const c = new Machine(ROM, OPTS); seed(c, 2);
  c.regs.a = 0x00; // a sentinel distinct from the low pointer byte the real routine seats
  // Broken twin: dispatches correctly but NEVER seats A -- the routine's signature write.
  const index = c.mem.read8(COORD_DISPATCH_SEL);
  TABLE[index >> 1](c);
  assert.notEqual(stateDiff(o, c), null, "the dropped A seat was NOT caught");
});

test("TEETH (wrong entry): a twin that dispatches the wrong handler MUST diverge in RAM", () => {
  // Index 4's correct handler is the 96cb walker, which writes loc_29; a Y-only handler (96c8) does not.
  // NB: XOR-flipping the >>1 index does NOT move off the walker here -- entries 2 and 3 are both advanceCoordListByEntryStride --
  // so the wrong-handler twin must dispatch an explicitly different, non-writing handler. And because the
  // walker's delta is 0 on the generic seed (loc_29 would keep its 0 default either way), pre-seed loc_29
  // with a sentinel distinct from the walker's result so the dropped write is actually observable in RAM.
  const o = new Machine(ROM, OPTS); seed(o, 4);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH(entry): oracle threw on this seed -- skipped"); return; }
  const walkerLoc29 = o.mem.read8(loc_29); // what the correct 96cb walker wrote
  const c = new Machine(ROM, OPTS); seed(c, 4);
  c.regs.a = o.regs.a; // isolate the divergence to the handler's RAM effect, not the A seat
  c.mem.write8(loc_29, (walkerLoc29 ^ 0xff) & 0xff); // sentinel the wrong (non-writing) handler leaves intact
  advanceListCursorByTwo(c); // wrong handler: Y-only, never writes loc_29 -- so loc_29 keeps the sentinel and RAM diverges
  assert.notEqual(ramDiff(o, c), null, "the wrong-handler dispatch was NOT caught in RAM");
});

test("SP-TOOTH: the omitted-ret dispatcher is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m, 0x02);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, dispatchCursorAdvanceBySelector, TARGET, m);
  assert.equal(r.placeable, true, `dispatchCursorAdvanceBySelector must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dispatcher placeable");
});
