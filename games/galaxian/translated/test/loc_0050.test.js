// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0050 (Galaxian divide-helper shift/loop-tail, ROM 0x0050-0x0057):
//   0050  3f     ccf         ; carry = complemented borrow (quotient bit)
//   0051  cb 11  rl c        ; shift the quotient bit into C
//   0053  cb 1a  rr d        ; shift the divisor down
//   0055  10 f5  djnz 0x004c ; taken -> loc_004c (next iteration); else fall through
//   0057  c9     ret
// Contracts: B>1 djnz-taken tail-calls loc_004c (33 T from entry, C=(C<<1)|1); B=1 rets (38 T, no call).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0050 } from "../loc_0050.js";

function mk(stubs = {}) {
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

// B>1: one shift step, then djnz taken -> loc_004c. Entry C=0, D=0, carry clear.
function runCall(fn, stubs = { 0x004c: "tail" }) {
  const m = mk(stubs);
  m.regs.b = 0x02; m.regs.c = 0x00; m.regs.d = 0x00; m.regs.f = 0x00; // carry clear
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, c: m.regs.c, d: m.regs.d, b: m.regs.b };
}

function checkCall(res) {
  assert.equal(res.cycles, 33, "T-state total (ccf 4 + rl c 8 + rr d 8 + djnz-taken 13)");
  assert.deepEqual(res.calls, [0x004c], "djnz taken -> re-enters loc_004c");
  assert.equal(res.ret, "TAIL", "the taken tail-jump's callee result propagates out");
  assert.equal(res.c, 0x01, "rl c: 0 with carry-in 1 (ccf'd from 0) -> C=1");
  assert.equal(res.d, 0x00, "rr d: 0 with carry-in 0 -> D=0");
  assert.equal(res.b, 0x01, "B decremented 2 -> 1 by the taken djnz");
}

test("loc_0050: shifts a quotient bit then djnz-tails into loc_004c; 33 T", () => {
  checkCall(runCall(loc_0050));
});

test("loc_0050: B=1 completes the last iteration and rets; 38 T, no call", () => {
  const m = mk();
  m.regs.sp = 0x4300; m.push16(0xbeef);
  m.regs.b = 0x01; m.regs.c = 0x00; m.regs.d = 0x00; m.regs.f = 0x00;
  loc_0050(m);
  assert.equal(m.cycles, 38, "ccf 4 + rl c 8 + rr d 8 + djnz-not-taken 8 + ret 10");
  assert.deepEqual(m.calls, [], "B=1: djnz not taken, no transfer");
  assert.equal(m.regs.c, 0x01, "C=(C<<1)|1 = 1");
  assert.equal(m.regs.b, 0x00, "B decremented 1 -> 0");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0050.js
//   find: m.step(0x004c, 13); // djnz 0x004c (taken) ...\n    return m.call(0x004c);
//   repl: m.step(0x004d, 13); ...  return m.call(0x004d);
//   expect: FAIL  (djnz re-enters the wrong routine -- caught by calls == [0x004c])
//   verified-anchor: count == 1  (the sole "return m.call(0x004c)" in loc_0050.js)
test("loc_0050: the contract catches a wrong djnz target", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.ccf(); m.step(0x0051, 4);
    regs.c = regs.rl(regs.c); m.step(0x0053, 8);
    regs.d = regs.rr(regs.d); m.step(0x0055, 8);
    if (m.regs.djnz() !== 0) { m.step(0x004d, 13); return m.call(0x004d); } // MUTANT: wrong target
    m.step(0x0057, 8);
    m.ret();
  };
  assert.throws(() => checkCall(runCall(mutant, { 0x004d: "tail" })));
});
