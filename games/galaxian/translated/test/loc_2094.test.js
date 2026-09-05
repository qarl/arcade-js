// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2094 (Galaxian, ROM 0x2094-0x209b): pop hl, pop bc, L += C, djnz 0x207d, ret.
// Two contracts: djnz taken (B>1 -> tail into loc_207d, 45 T) and djnz not-taken (B==1 -> ret, 50 T).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2094 } from "../loc_2094.js";

function mk(stubs = { 0x207d: "tail" }) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
// Seed the two stack slots loc_207d pushed: HL then BC, at SP=0x4380.
function seed(m, hl, b, c) {
  m.regs.sp = 0x4380;
  m.mem.workRam[0x380] = hl & 0xff;
  m.mem.workRam[0x381] = (hl >> 8) & 0xff;
  m.mem.workRam[0x382] = c & 0xff;
  m.mem.workRam[0x383] = b & 0xff;
}

test("loc_2094: djnz taken -> L+=C, tail into loc_207d; 45 T", () => {
  const m = mk();
  seed(m, 0x5000, 0x02, 0x10); // HL=0x5000 (L=0), B=2, C=0x10
  const ret = loc_2094(m);
  assert.equal(m.cycles, 45, "taken T-total (10+10+4+4+4+13)");
  assert.deepEqual(m.calls, [0x207d], "djnz tails into loc_207d head");
  assert.equal(m.regs.hl, 0x5010, "L advanced by stride C (0x00+0x10)");
  assert.equal(m.regs.b, 0x01, "B decremented by djnz");
  assert.equal(ret, "TAIL", "loc_207d result propagates");
});

test("loc_2094: djnz not-taken (B==1) -> ret; 50 T", () => {
  const m = mk();
  seed(m, 0x5000, 0x01, 0x10);
  loc_2094(m);
  assert.equal(m.cycles, 50, "not-taken T-total (10+10+4+4+4+8+10)");
  assert.deepEqual(m.calls, [], "no tail-jump; plain ret");
  assert.equal(m.regs.b, 0x00, "B hit zero");
  assert.equal(m.regs.hl, 0x5010, "L still advanced before the djnz");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2094.js
//   find: regs.add(regs.c);
//   repl: regs.add(0x00);
//   expect: FAIL  (drops the stride; HL ends 0x5000 not 0x5010 -- caught by the HL assertion)
//   verified-anchor: count == 1  (the sole "regs.add(regs.c)" in loc_2094.js)
test("loc_2094: the contract catches a dropped stride add", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = m.pop16(); m.step(0x2095, 10);
    regs.bc = m.pop16(); m.step(0x2096, 10);
    regs.a = regs.l; m.step(0x2097, 4);
    regs.add(0x00); m.step(0x2098, 4); // MUTANT: stride dropped
    regs.l = regs.a; m.step(0x2099, 4);
    if (regs.djnz() !== 0) { m.step(0x207d, 13); return m.call(0x207d); }
    m.step(0x209b, 8);
    return m.ret(10);
  };
  const m = mk();
  seed(m, 0x5000, 0x02, 0x10);
  mutant(m);
  assert.throws(() => assert.equal(m.regs.hl, 0x5010));
});
