// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitVectorWordTag60FromKey (ROM 0xdf4a) -- read the $73 data byte into Y, then tail into emitTaggedVectorWord
// (the $60-header emitter): write {$73, A|0x60} at the ($74/$75) cursor and advance it by 2. A is a
// register input (unchanged by this routine, consumed by df4c). Live-out is memory only for this
// display-builder family (the landed advanceDisplayCursor tail returns nothing; the ROM's incidental A=cursor-low is
// not reproduced, and df4a's callers are pure tail-callers reading no register after), so the contract is
// RAM (dumpState, minus stack scratch below the entry SP). Plain tail-caller -- no SP tooth. No POKEY read -> deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-df4a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df4a } from "../../translated/loc_df4a.js";
import { emitVectorWordTag60FromKey } from "../emitVectorWordTag60FromKey.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { VG_RECORD_HEADER, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf4a;
const oracle = atEntry(loc_df4a);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function seed(m, s) {
  if (s.a !== undefined) m.regs.a = s.a;
  for (const [a, v] of Object.entries(s.mem || {})) m.mem.write8(Number(a), v);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdf4a dispatches -- emitVectorWordTag60FromKey == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitVectorWordTag60FromKey(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: emits {$73, A|0x60} at the cursor and advances it by 2 == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "ptr=0x2000, A=0x05, $73=0x1a", a: 0x05, d: 0x1a, lo: 0x00, hi: 0x20 },
    { tag: "low carry: $74=0xff", a: 0x1f, d: 0x00, lo: 0xff, hi: 0x20 },
    { tag: "top of vec RAM: ptr=0x2ffe", a: 0x00, d: 0x7f, lo: 0xfe, hi: 0x2f },
  ];
  for (const t of cases) {
    const s = { a: t.a, mem: { [VG_RECORD_HEADER]: t.d, [DRAW_CURSOR_LO]: t.lo, [DRAW_CURSOR_HI]: t.hi } };
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); emitVectorWordTag60FromKey(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${t.tag}`);
  }
  // Explicit content/advance check on the clean case.
  const m = new Machine(ROM, OPTS);
  seed(m, { a: 0x05, mem: { [VG_RECORD_HEADER]: 0x1a, [DRAW_CURSOR_LO]: 0x00, [DRAW_CURSOR_HI]: 0x20 } });
  emitVectorWordTag60FromKey(m);
  assert.equal(m.mem.read8(0x2000), 0x1a, "byte 0 = $73 data");
  assert.equal(m.mem.read8(0x2001), 0x65, "byte 1 = A|0x60");
  assert.equal(m.mem.read8(DRAW_CURSOR_LO) | (m.mem.read8(DRAW_CURSOR_HI) << 8), 0x2002, "cursor += 2");
});

test("TEETH: twins that skip the header byte or the cursor advance diverge from the oracle", () => {
  const s = { a: 0x05, mem: { [VG_RECORD_HEADER]: 0x1a, [DRAW_CURSOR_LO]: 0x00, [DRAW_CURSOR_HI]: 0x20 } };
  // Twin A: writes the data byte but never the A|0x60 header second byte.
  {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o);
    const broken = (mm) => { const ptr = mm.mem16[DRAW_CURSOR_LO]; mm.mem8[ptr] = mm.mem8[VG_RECORD_HEADER]; mm.mem8[DRAW_CURSOR_LO] = (ptr + 2) & 0xff; };
    broken(c);
    assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the missing header byte");
  }
  // Twin B: writes both bytes but leaves the cursor unadvanced.
  {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o);
    const broken = (mm) => { const ptr = mm.mem16[DRAW_CURSOR_LO]; mm.mem8[ptr] = mm.mem8[VG_RECORD_HEADER]; mm.mem8[(ptr + 1) & 0xffff] = (mm.regs.a | 0x60) & 0xff; };
    broken(c);
    assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the un-advanced cursor");
  }
});
