// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2089 (ROM 0x2089-0x209b):
//   call 0x20e1; ld c,0x00; call 0x211d; call 0x2131; pop hl; pop bc; ld a,l; add a,c; ld l,a;
//   djnz 0x207d; ret
// Contract: three subcalls, restore the HL/BC loc_207d saved, advance L by the stride C, djnz back to
// loc_207d or ret. B=1 -> ret path (108 T); B=2 -> tail loc_207d (103 T).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2089 } from "../loc_2089.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const tail = () => "TAIL";
const balance = (mm) => { mm.pop16(); }; // subcall that returns: pop its pushed return

// Stack at entry (top->bottom): [HL_saved][BC_saved][caller_return]
function seed(m, bc, hl, ret) {
  m.regs.sp = 0x4400;
  m.push16(ret);
  m.push16(bc); // BC_saved
  m.push16(hl); // HL_saved
}

test("loc_2089 last slot (B=1): subcalls, advance, ret; 108 T", () => {
  const m = mk({ 0x20e1: balance, 0x211d: balance, 0x2131: balance });
  seed(m, 0x0110, 0x4130, 0x9999); // B=1, C=0x10, L=0x30
  loc_2089(m);
  assert.equal(m.cycles, 108, "17+7+17+17+10+10+4+4+4+8+10");
  assert.deepEqual(m.calls, [0x20e1, 0x211d, 0x2131]);
  assert.equal(m.pc, 0x9999, "final ret to caller");
  assert.equal(m.regs.hl, 0x4140, "L advanced by C=0x10");
  assert.equal(m.regs.sp, 0x4400, "stack unwound");
});

test("loc_2089 more slots (B=2): djnz back into loc_207d; 103 T", () => {
  const m = mk({ 0x20e1: balance, 0x211d: balance, 0x2131: balance, 0x207d: tail });
  seed(m, 0x0210, 0x4130, 0x9999); // B=2 -> djnz taken
  const ret = loc_2089(m);
  assert.equal(m.cycles, 103, "17+7+17+17+10+10+4+4+4+13");
  assert.deepEqual(m.calls, [0x20e1, 0x211d, 0x2131, 0x207d]);
  assert.equal(ret, "TAIL");
  assert.equal(m.regs.b, 0x01, "B decremented");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2089.js
//   find: regs.add(regs.c);
//   repl: regs.add(regs.b);
//   expect: FAIL (advance by B not C -> HL = 0x4131 not 0x4140 on the B=1 path)
test("loc_2089: the contract catches advancing by the wrong register", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(0x208c); m.step(0x20e1, 17); m.call(0x20e1);
    regs.c = 0x00; m.step(0x208e, 7);
    m.push16(0x2091); m.step(0x211d, 17); m.call(0x211d);
    m.push16(0x2094); m.step(0x2131, 17); m.call(0x2131);
    regs.hl = m.pop16(); m.step(0x2095, 10);
    regs.bc = m.pop16(); m.step(0x2096, 10);
    regs.a = regs.l; m.step(0x2097, 4);
    regs.add(regs.b); m.step(0x2098, 4); // MUTANT
    regs.l = regs.a; m.step(0x2099, 4);
    if (regs.djnz() !== 0) { m.step(0x207d, 13); return m.call(0x207d); }
    m.step(0x209b, 8); m.ret();
  };
  const m = mk({ 0x20e1: balance, 0x211d: balance, 0x2131: balance });
  seed(m, 0x0110, 0x4130, 0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.regs.hl, 0x4140));
});
