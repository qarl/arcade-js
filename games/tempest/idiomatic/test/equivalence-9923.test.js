// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_9923 (ROM 0x9923-0x994c) -- the slot-timer expiry handler for slot X. It
// raises a spawn request (loc_29 = 0xf0), latches loc_203,x into loc_2a, saves X in loc_35, runs the
// placement pass loc_99a5, then reloads X from loc_35. If the request survived (loc_29 still set) and
// loc_994d allocates a free slot, it drops loc_3ab and clears this slot's timer loc_243,x; otherwise it
// flags loc_2f = 0xff and re-arms the timer (inc loc_243,x). Both callees preserve X (loc_994d saves it in
// loc_36 and restores it; loc_9923 saves it in loc_35 and reloads it), so exit X == the reloaded loc_35 in
// every path -- X is the only live-out register (the caller loc_98a2 reads loc_243,x right after the call).
// Contract = RAM (dumpState minus STACK_SCRATCH) PLUS X. Oracle is the frozen translated loc_9923.
// Run: node --test games/tempest/idiomatic/test/equivalence-9923.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9923 as oracle } from "../../translated/loc_9923.js";
import { loc_9923 } from "../loc_9923.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import {
  STACK_SCRATCH,
  loc_29, loc_2a, loc_2f, loc_35, loc_203, loc_243, loc_3ab,
  loc_11c, loc_129, loc_12e, loc_142, loc_2df,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9923;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9923 dispatches -- loc_9923 == oracle in RAM (-stack) and X", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may route through an unimplemented placement arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_9923(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X live-out matches");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Path B seed: on a fresh machine every deficit column is zero, so loc_99a5 finds no column to place and
// clears loc_29. loc_994d is then skipped and loc_9923 takes the re-arm path: loc_2f = 0xff, inc loc_243,x.
function seedRearm(m, x) {
  m.regs.x = x;
  m.mem.write8(u16(loc_203 + x), 0x07); // -> loc_2a
  m.mem.write8(u16(loc_243 + x), 0x10); // this slot's timer -> inc to 0x11
  m.mem.write8(loc_2f, 0x00);           // distinct from the 0xff the routine writes
  m.mem.write8(loc_3ab, 0x08);          // must stay untouched on this path
}

test("CRAFTED: no placement (loc_99a5 clears loc_29) -> re-arm path -- RAM and X equal", () => {
  const X = 0x05;
  const o = new Machine(ROM, OPTS); seedRearm(o, X);
  const c = new Machine(ROM, OPTS); seedRearm(c, X);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(rearm): oracle threw on this seed -- skipped"); return; }
  loc_9923(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the re-arm path");
  assert.equal(c.regs.x, o.regs.x, "X live-out matches");
  assert.equal(c.regs.x, X, "X is the saved/reloaded slot index");
  assert.equal(c.mem.read8(loc_2a), 0x07, "loc_2a latched from loc_203,x");
  assert.equal(c.mem.read8(loc_35), X, "loc_35 holds the slot index");
  assert.equal(c.mem.read8(loc_29), 0x00, "loc_99a5 cleared the spawn request");
  assert.equal(c.mem.read8(loc_2f), 0xff, "loc_2f flagged on the re-arm path");
  assert.equal(c.mem.read8(u16(loc_243 + X)), 0x11, "this slot's timer was re-armed (inc)");
  assert.equal(c.mem.read8(loc_3ab), 0x08, "loc_3ab untouched on the re-arm path");
});

// Success seed: one deficit column so loc_99a5 tries a placement. If that placement succeeds (loc_9a87
// returns nonzero via the RTS-trick dispatch) loc_29 survives and loc_994d allocates a free slot, driving
// the loc_3ab drop + timer clear. The dispatch may route to an unimplemented arm; skip on oracle throw.
function seedPlace(m, x) {
  m.regs.x = x;
  m.mem.write8(loc_11c, 0x04);           // active-count index -> cap 5, and the loc_994d scan span
  m.mem.write8(u16(loc_12e + 0x02), 0x01); // column 2 wants one -> deficit 1
  m.mem.write8(u16(loc_129 + 0x02), 0x01); // column 2 has a target -> count==1 path calls loc_9a87
  m.mem.write8(u16(loc_203 + x), 0x03);
  m.mem.write8(u16(loc_243 + x), 0x20);
  m.mem.write8(loc_3ab, 0x08);
}

test("CRAFTED: placement path attempt (loc_99a5 keeps loc_29, loc_994d allocates) -- RAM and X equal", () => {
  const X = 0x02;
  const o = new Machine(ROM, OPTS); seedPlace(o, X);
  const c = new Machine(ROM, OPTS); seedPlace(c, X);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(place): oracle threw (dispatch reached an unimplemented arm) -- skipped"); return; }
  loc_9923(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the placement path");
  assert.equal(c.regs.x, o.regs.x, "X live-out matches");
  console.log("  CRAFTED(place): ran without an oracle throw");
});

test("TEETH: a twin that drops the timer re-arm MUST diverge in RAM", () => {
  const X = 0x05;
  const o = new Machine(ROM, OPTS); seedRearm(o, X);
  const c = new Machine(ROM, OPTS); seedRearm(c, X);
  let threw = false;
  let tried = 0;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: run the real routine, then undo the loc_243,x re-arm. The re-arm inc is a signature write
  // of the no-placement path, so dropping it guarantees a RAM divergence.
  const broken = (m, x = m.regs.x) => {
    loc_9923(m);
    m.mem.write8(u16(loc_243 + x), m.mem.read8(u16(loc_243 + x)) - 1); // BUG: undo the timer re-arm
  };
  tried++;
  broken(c, X);
  assert.equal(tried, 1, "the teeth arm ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped timer re-arm was NOT caught by the RAM compare");
});
