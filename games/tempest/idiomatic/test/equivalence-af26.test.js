// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawCounterPair (ROM 0xaf26-0xaf3e) -- if both $0600 and $0601 are zero it tail-calls
// the shared no-op rts (sharedReturnTail); otherwise it draws a shared header (drawSlotShapeRecord), its count (emitCappedCount),
// and both counter slots (drawCounterSlot x=0 then x=1). Dissolves every m.call. All output is RAM (the draw
// setup + emitted words), so each arm compares the RAM diff (minus the dead stack). Omitted-ret.
// Run: node --test games/tempest/idiomatic/test/equivalence-af26.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_af26 } from "../../translated/loc_af26.js";
import { drawCounterPair } from "../drawCounterPair.js";
import { drawSlotShapeRecord } from "../drawSlotShapeRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SLOT_METRIC, loc_601 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaf26;
const oracle = atEntry(loc_af26);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// The live-draw path runs ab14 (X=0x12) and, per slot, af3f -> ab98 -> ab3b. Each consults ($ac),X for a
// list pointer whose copy loop exits on a bit7-set terminator, and emits through ($74). Seed that chain so
// the oracle's real dispatch reaches those helpers instead of faulting on an unmapped read. (($ac)->0x0200;
// the X=0x12 pair and the X=4 pair both point at the 0x0260 list; 0x0261 is the terminator; ($74)->vec RAM.)
function seat(m, s = {}) {
  m.mem.write8(SLOT_METRIC, s.c600 ?? 0x00);
  m.mem.write8(loc_601, s.c601 ?? 0x00);
  m.mem.write8(0x00ac, 0x00); m.mem.write8(0x00ad, 0x02); // ($ac) -> 0x0200
  m.mem.write8(0x0212, 0x60); m.mem.write8(0x0213, 0x02); // ($ac),0x12 -> 0x0260 (ab14 list)
  m.mem.write8(0x0204, 0x60); m.mem.write8(0x0205, 0x02); // ($ac),0x04 -> 0x0260 (ab98/ab3b list)
  m.mem.write8(0x0261, 0x80);                             // copy-loop terminator (bit7 set)
  m.mem.write8(0x0074, 0x00); m.mem.write8(0x0075, 0x20); // ($74) -> 0x2000 (vector RAM)
}

test("CAPTURE: real 0xaf26 dispatches -- drawCounterPair == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawCounterPair(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: both-zero (no draw) and live (full draw) == oracle (RAM)", () => {
  const cases = [
    { tag: "both zero -> shared rts, no change", c600: 0x00, c601: 0x00 },
    { tag: "$0600 live -> full draw", c600: 0x03, c601: 0x00 },
    { tag: "$0601 live -> full draw", c600: 0x00, c601: 0x05 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); drawCounterPair(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a twin that always draws (ignoring the both-zero gate) diverges on the zero case", () => {
  const s = { c600: 0x00, c601: 0x00 };
  const o = new Machine(ROM, OPTS); seat(o, s); oracle(o);
  const c = new Machine(ROM, OPTS); seat(c, s);
  // BUG: draws the shared header even when both counters are zero (should have been a no-op rts).
  const broken = (m) => { drawSlotShapeRecord(m, 0x12); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the spurious draw");
});

test("SP-TOOTH: the omitted-ret caller is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m, {});
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawCounterPair, TARGET, m);
  assert.equal(r.placeable, true, `drawCounterPair must be seam-placeable; got: ${r.error}`);
});
