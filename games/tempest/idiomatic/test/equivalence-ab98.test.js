// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawShapeListAtPosition (ROM 0xab98) -- seats X->$35, A->$2a, 0->$2b, then tail-runs the shared
// record builder expandShapeListToVectors. The oracle m.calls frozen ab3b; the idiomatic dissolves it into a direct
// idiomatic call. All output is RAM (the seated cells + ab3b's emits), so each arm compares RAM (dumpState
// minus stack scratch below the entry SP). X and A are live-ins via the register bridge. The copy loop inside ab3b is bounded
// by a bit7-set terminator byte planted in the seeded pointer chain.
// Run: node --test games/tempest/idiomatic/test/equivalence-ab98.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ab98 } from "../../translated/loc_ab98.js";
import { drawShapeListAtPosition } from "../drawShapeListAtPosition.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_2b, SAVED_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xab98;
const oracle = atEntry(loc_ab98);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// X=0x20 -> $35=0x20 steers ab3b's ($ac),$35 lookup to $3b -> 0x0260; the byte at 0x0261 has bit7 set so the
// copy loop exits after one pass. The ($74) build cursor points into vector RAM 0x2000 (diffed).
function seat(m, x = 0x20, a = 0x11) {
  m.regs.x = x; m.regs.a = a;
  m.mem.write8(0x00ac, 0x00); m.mem.write8(0x00ad, 0x02);   // ($ac) -> 0x0200
  m.mem.write8(0x0200 + x, 0x60); m.mem.write8(0x0201 + x, 0x02); // ($ac),$35 -> 0x0260
  m.mem.write8(0x0261, 0x80);                                // copy-loop terminator (bit7 set)
  m.mem.write8(0x0074, 0x00); m.mem.write8(0x0075, 0x20);   // ($74) -> 0x2000 (vector RAM)
}

test("CAPTURE: real 0xab98 dispatches -- drawShapeListAtPosition == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawShapeListAtPosition(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seat X/A/0 then build the record -- drawShapeListAtPosition == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o); drawShapeListAtPosition(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after seat + ab3b");
  assert.equal(c.mem.read8(SAVED_INDEX), 0x20, "$35 = X");
});

test("TEETH: a twin that leaves $2b uncleared diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seat(o); oracle(o);
  const c = new Machine(ROM, OPTS); seat(c); drawShapeListAtPosition(c);
  c.mem.write8(loc_2b, (c.mem.read8(loc_2b) ^ 0x40) & 0xff); // BUG: as if $2b took a different value
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a wrong $2b");
});

test("TEETH (marshalling): a twin with X and A swapped diverges from the oracle", () => {
  // Seed BOTH chains (X=0x20 and X=0x11 as $35) so the swapped twin also terminates, then diverges on $35.
  const seatBoth = (m) => {
    seat(m, 0x20, 0x11);
    m.mem.write8(0x0200 + 0x11, 0x60); m.mem.write8(0x0201 + 0x11, 0x02); // also terminate the swapped $35=0x11 chain
  };
  const o = new Machine(ROM, OPTS); seatBoth(o); oracle(o);
  const c = new Machine(ROM, OPTS); seatBoth(c);
  const swapped = (m, x = m.regs.x, a = m.regs.a) => drawShapeListAtPosition(m, a, x); // BUG: X/A args swapped
  swapped(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch swapped X/A");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seat(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawShapeListAtPosition, TARGET, m);
  assert.equal(r.placeable, true, `drawShapeListAtPosition must be seam-placeable; got: ${r.error}`);
});
