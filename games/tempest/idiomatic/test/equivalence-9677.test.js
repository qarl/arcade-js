// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_9677 (ROM 0x9677-0x9682) -- an RTS-trick COMPUTED-JUMP dispatcher: ldx $015e; then
// pha byte($9690+x); pha byte($968f+x); rts -> jumps to (word($968f+x)+1). $015e holds a selector byte
// {2,4,6,8,10,12}; the six targets (word+1) are 0x96c4/0x96b7/0x96ab/0x96e2/0x96db/0x9700 and each RTS
// returns to loc_9677's own caller. The idiomatic form dissolves the push/rts-jump into TABLE[sel>>1](m).
// loc_9677 tail-delegates, so its exit registers are the delegate's -- the contract is RAM-only
// (dumpState minus STACK_SCRATCH); the oracle's stack gymnastics land in STACK_SCRATCH and are excluded.
// Run: node --test games/tempest/idiomatic/test/equivalence-9677.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9677 as oracle } from "../../translated/loc_9677.js";
import { loc_9677 } from "../loc_9677.js";
import { loc_96ab, loc_96b7, loc_96c4 } from "../loc_96ab.js";
import { loc_96e2 } from "../loc_96e2.js";
import { loc_96db } from "../loc_96db.js";
import { loc_9700 } from "../loc_96f4.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9677;
const SEL_15E = 0x015e;
const IDX = [2, 4, 6, 8, 10, 12];
const TABLE = [null, loc_96c4, loc_96b7, loc_96ab, loc_96e2, loc_96db, loc_9700];

const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Point the zero-page list pointer at mapped RAM, fill it with deterministic bytes, and aim $015e at a
// selector. 0x29 is pre-seeded to a sentinel so a handler that stashes the cursor there is observable.
function seed(m, sel, y) {
  m.mem.write8(SEL_15E, sel);
  m.regs.y = y;
  m.mem.write8(0x2b, 0x20);                              // base value
  m.mem.write8(0x2c, 0x00); m.mem.write8(0x2d, 0x04);   // (0x2c) -> list at 0x0400
  m.mem.write8(0x0160, 0x10);                            // absolute base for the add handler
  m.mem.write8(0x29, 0x77);                              // sentinel to reveal cursor writes
  for (let i = 0; i < 0x80; i++) m.mem.write8(u16(0x0400 + i), (i * 3 + 1) & 0xff);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9677 dispatches -- loc_9677 == oracle in RAM (-stack)", () => {
  const sels = new Set();
  for (const cap of CAPS) {
    sels.add(cap.mem.read8(SEL_15E));
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9677(c);
    assert.equal(ramDiff(o, c), null, `RAM equal for captured selector=${cap.mem.read8(SEL_15E)}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked; distinct selectors: [${[...sels].sort((a, b) => a - b).join(",")}]`);
});

test("CRAFTED: each selector 2,4,6,8,10,12 -- loc_9677 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const sel of IDX) {
    const o = new Machine(ROM, OPTS); seed(o, sel, 0x08);
    const c = new Machine(ROM, OPTS); seed(c, sel, 0x08);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a selector the generic seed cannot fully provision
    loc_9677(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching selector ${sel}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/6 selectors provisioned and checked`);
  assert.ok(checked >= 1, "no selector could be provisioned -- seed is inert");
});

test("TEETH: a twin that dispatches the WRONG selector diverges in RAM", () => {
  let caught = false, tried = 0;
  for (const sel of IDX) {
    const o = new Machine(ROM, OPTS); seed(o, sel, 0x08);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const c = new Machine(ROM, OPTS); seed(c, sel, 0x08);
    const realSlot = sel >> 1, wrongSlot = (realSlot % 6) + 1; // a different table slot 1..6
    let brokeThrew = false;
    try { TABLE[wrongSlot](c); } catch { brokeThrew = true; }
    if (brokeThrew) continue;
    tried++;
    if (ramDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no selector pair could be exercised for the teeth arm");
  assert.ok(caught, "the RAM diff FAILED to catch a wrong-selector dispatch on every exercised pair");
});

test("SP-TOOTH: the omitted-ret dispatcher is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m, 0x06, 0x08);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loc_9677, TARGET, m);
  assert.equal(r.placeable, true, `loc_9677 must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dispatcher placeable");
});
