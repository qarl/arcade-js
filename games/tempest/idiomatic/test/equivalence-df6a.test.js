// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitBlankVectorWordTag70 (ROM 0xdf6a) -- zero the data byte, then tail into emitVectorWordTag70 (the
// $70-header emitter): write {0x00, A|0x70} at the ($74/$75) cursor and advance it by 2. A is a register
// input (unchanged here, consumed by df6c). Live-out is memory only for this display-builder family (the
// landed advanceDisplayCursor tail returns nothing; the ROM's incidental A=cursor-low is not reproduced, and df6a's
// callers are pure tail-callers reading no register after), so the contract is RAM (dumpState, minus
// stack scratch below the entry SP). Plain tail-caller -- no SP tooth. No POKEY read -> deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-df6a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df6a } from "../../translated/loc_df6a.js";
import { emitBlankVectorWordTag70 } from "../emitBlankVectorWordTag70.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf6a;
const oracle = atEntry(loc_df6a);
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

test("CAPTURE: real 0xdf6a dispatches -- emitBlankVectorWordTag70 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitBlankVectorWordTag70(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: emits {0x00, A|0x70} at the cursor and advances it by 2 == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "ptr=0x2000, A=0x05", a: 0x05, lo: 0x00, hi: 0x20 },
    { tag: "low carry: $74=0xff", a: 0x0f, lo: 0xff, hi: 0x20 },
    { tag: "top of vec RAM: ptr=0x2ffe", a: 0x8f, lo: 0xfe, hi: 0x2f },
  ];
  for (const t of cases) {
    const s = { a: t.a, mem: { [DRAW_CURSOR_LO]: t.lo, [DRAW_CURSOR_HI]: t.hi } };
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); emitBlankVectorWordTag70(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${t.tag}`);
  }
  // Explicit content/advance check on the clean case.
  const m = new Machine(ROM, OPTS);
  seed(m, { a: 0x05, mem: { [DRAW_CURSOR_LO]: 0x00, [DRAW_CURSOR_HI]: 0x20 } });
  emitBlankVectorWordTag70(m);
  assert.equal(m.mem.read8(0x2000), 0x00, "byte 0 = 0x00");
  assert.equal(m.mem.read8(0x2001), 0x75, "byte 1 = A|0x70");
  assert.equal(m.mem.read8(DRAW_CURSOR_LO) | (m.mem.read8(DRAW_CURSOR_HI) << 8), 0x2002, "cursor += 2");
});

test("TEETH: twins that skip the header byte or the cursor advance diverge from the oracle", () => {
  const s = { a: 0x05, mem: { [DRAW_CURSOR_LO]: 0x00, [DRAW_CURSOR_HI]: 0x20 } };
  // Twin A: writes the 0x00 byte but never the A|0x70 header second byte.
  {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o);
    const broken = (mm) => { const ptr = mm.mem16[DRAW_CURSOR_LO]; mm.mem8[ptr] = 0x00; mm.mem8[DRAW_CURSOR_LO] = (ptr + 2) & 0xff; };
    broken(c);
    assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the missing header byte");
  }
  // Twin B: writes both bytes but leaves the cursor unadvanced.
  {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o);
    const broken = (mm) => { const ptr = mm.mem16[DRAW_CURSOR_LO]; mm.mem8[ptr] = 0x00; mm.mem8[(ptr + 1) & 0xffff] = (mm.regs.a | 0x70) & 0xff; };
    broken(c);
    assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the un-advanced cursor");
  }
});
