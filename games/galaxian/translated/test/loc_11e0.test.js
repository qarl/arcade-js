// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_11e0 (ROM 0x11e0-0x1217): scan 14-entry table at 0x4260 (stride 5) for a free slot
// (bit0 of entry[0] clear), then fill it from the IX object; 0x1218 scales the X delta. Interior arms
// loc_11f0 (fill) and loc_120f (negative delta) inlined. Callee 0x1218 stubbed.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_11e0 } from "../loc_11e0.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
// 0x1218 stub: pop the pushed return address, deliver a known scaled value in A.
const scaler = (val) => (mm) => { mm.pop16(); mm.regs.a = val; };

test("loc_11e0: no free slot (all 14 active) -> bare ret; 634 T; no calls", () => {
  const m = mk({ 0x1218: scaler(0x55) });
  for (let k = 0; k < 14; k++) m.mem.write8(0x4260 + 5 * k, 0x01); // all bit0 set
  m.push16(0x9999);
  loc_11e0(m);
  assert.deepEqual(m.calls, []);
  assert.equal(m.regs.b, 0x00, "scanned all 14 entries");
  assert.equal(m.cycles, 634, "27 setup + 13*43 + 38 + 10 ret");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_11e0: free slot, positive X delta -> fill + call 0x1218; 228 T", () => {
  const m = mk({ 0x1218: scaler(0x55) });
  m.regs.ix = 0x4300;
  m.mem.write8(0x4260, 0x00);   // entry 0 free (bit0 clear)
  m.mem.write8(0x4303, 0x30);   // (ix+3)
  m.mem.write8(0x4304, 0x40);   // (ix+4)
  m.mem.write8(0x4202, 0x50);   // player X, >= (ix+4) -> no borrow
  m.push16(0x9999);
  loc_11e0(m);
  assert.equal(m.mem.read8(0x4260), 0x01, "entry[0] active");
  assert.equal(m.mem.read8(0x4261), 0x30, "entry[1] = (ix+3)");
  assert.equal(m.regs.d, 0xc0, "D = 0xf0 - entry[1]");
  assert.equal(m.mem.read8(0x4263), 0x40, "entry[3] = (ix+4)");
  assert.equal(m.mem.read8(0x4264), 0x55, "entry[4] = scale(delta) from 0x1218");
  assert.deepEqual(m.calls, [0x1218]);
  assert.equal(m.cycles, 228, "27 + 24 (scan+branch) + 177 (fill)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_11e0: free slot, negative X delta -> loc_120f neg/call/neg; 249 T", () => {
  const m = mk({ 0x1218: scaler(0x55) });
  m.regs.ix = 0x4300;
  m.mem.write8(0x4260, 0x00);
  m.mem.write8(0x4303, 0x30);
  m.mem.write8(0x4304, 0x40);
  m.mem.write8(0x4202, 0x30);   // player X < (ix+4) -> borrow -> loc_120f
  m.push16(0x9999);
  loc_11e0(m);
  assert.equal(m.mem.read8(0x4264), 0xab, "entry[4] = -scale(|delta|) = -0x55 = 0xab");
  assert.deepEqual(m.calls, [0x1218]);
  assert.equal(m.cycles, 249, "51 + 136 (fill to sub) + 12 (jr c) + 50 (loc_120f)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_11e0.js
//   find: regs.a = 0xf0;   (loc_11f0)
//   repl: regs.a = 0x00;
//   expect: FAIL -- D = 0x00 - entry[1] = 0xd0 not 0xc0 (caught by the D assert)
test("loc_11e0: contract catches a wrong `ld a,0xf0`", () => {
  const m = mk({ 0x1218: scaler(0x55) });
  m.regs.ix = 0x4300;
  m.mem.write8(0x4260, 0x00);
  m.mem.write8(0x4303, 0x30);
  m.mem.write8(0x4304, 0x40);
  m.mem.write8(0x4202, 0x50);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.de = 0x0005; mm.step(0x11e3, 10);
    regs.hl = 0x4260; mm.step(0x11e6, 10);
    regs.b = 0x0e; mm.step(0x11e8, 7);
    regs.bit(0, mem.read8(regs.hl)); mm.step(0x11ea, 12);
    mm.step(0x11f0, 12); // free at entry 0
    mem.write8(regs.hl, 0x01); mm.step(0x11f2, 10);
    regs.hl = (regs.hl + 1) & 0xffff; mm.step(0x11f3, 6);
    regs.a = mem.read8((regs.ix + 3) & 0xffff); mm.step(0x11f6, 19);
    mem.write8(regs.hl, regs.a); mm.step(0x11f7, 7);
    regs.a = 0x00; mm.step(0x11f9, 7); // MUTANT: 0x00 not 0xf0
    regs.sub(mem.read8(regs.hl)); mm.step(0x11fa, 7);
    regs.d = regs.a; mm.step(0x11fb, 4);
    // (rest irrelevant to the D assert)
  };
  mutant(m);
  assert.throws(() => assert.equal(m.regs.d, 0xc0));
});
