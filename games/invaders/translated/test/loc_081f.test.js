// SPDX-License-Identifier: GPL-3.0-only
// Equivalence test for loc_081f (ROM 0x081f-0x0848): the frame-loop body. 0x2082==0 delegates to
// loc_09ef; nonzero runs the full call chain (B=0x04) and falls through into loc_0849.
// Run: node --test games/invaders/translated/test/loc_081f.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { Regs } from "../../../../core/cpu/8080.js";
import { loc_081f } from "../loc_081f.js";

function makeMachine() {
  const regs = new Regs();
  const ram = new Uint8Array(0x10000);
  const mem = {
    read8: (a) => ram[a & 0xffff],
    write8: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    read16: (a) => ram[a & 0xffff] | (ram[(a + 1) & 0xffff] << 8),
    write16: (a, v) => { ram[a & 0xffff] = v & 0xff; ram[(a + 1) & 0xffff] = (v >> 8) & 0xff; },
  };
  return {
    regs, mem, ram, calls: [], tstates: 0, pc: 0, pcSeq: [],
    io: { outs: [], ins: {}, portIn(p) { return this.ins[p] & 0xff || 0; }, portOut(p, v) { this.outs.push([p, v & 0xff]); } },
    step(nextAddr, cycles) { this.pc = nextAddr; this.tstates += cycles; this.pcSeq.push(nextAddr); },
    push16(v) { regs.sp = (regs.sp - 2) & 0xffff; mem.write8(regs.sp, v & 0xff); mem.write8((regs.sp + 1) & 0xffff, (v >> 8) & 0xff); },
    pop16() { const lo = mem.read8(regs.sp); const hi = mem.read8((regs.sp + 1) & 0xffff); regs.sp = (regs.sp + 2) & 0xffff; return lo | (hi << 8); },
    ret(cycles = 10) { this.step(this.pop16(), cycles); },
    call(addr) { this.calls.push(addr); return undefined; }, // record-only dispatch
  };
}

test("loc_081f 0x2082==0: delegates to loc_09ef; 95 T", () => {
  const m = makeMachine();
  m.regs.sp = 0x2400;
  m.mem.write8(0x2082, 0x00);

  loc_081f(m);

  assert.equal(m.regs.a, 0x00, "lda 0x2082 -> 0, ana a keeps 0");
  assert.equal(m.tstates, 17 * 4 + 13 + 4 + 10, "T to the jz-taken delegate");
  assert.deepEqual(m.calls, [0x1618, 0x190a, 0x15f3, 0x0988, 0x09ef], "four calls then delegate 09ef");
  assert.deepEqual(m.pcSeq, [0x1618, 0x190a, 0x15f3, 0x0988, 0x082e, 0x082f, 0x09ef], "step boundaries");
});

test("loc_081f 0x2082!=0: full chain (B=0x04), falls through to loc_0849, then loops back to 0x081f; 214 T a pass", () => {
  const m = makeMachine();
  m.regs.sp = 0x2400;
  m.mem.write8(0x2082, 0x01);
  const record = m.call.bind(m);
  let aAtTail;
  m.call = (addr) => { if (addr === 0x0849) { aAtTail = m.regs.a; m.mem.write8(0x2082, 0x00); } return record(addr); }; // end the loop next pass

  loc_081f(m);

  assert.equal(aAtTail, 0x01, "ana a leaves A=0x01 on the full pass");
  assert.equal(m.regs.b, 0x04, "mvi b,0x04 on the not-taken arm");
  assert.equal(m.tstates, 17 * 10 + 13 + 4 + 10 + 10 + 7 + (17 * 4 + 13 + 4 + 10), "full pass, then the delegating pass");
  assert.deepEqual(
    m.calls,
    [0x1618, 0x190a, 0x15f3, 0x0988, 0x170e, 0x0935, 0x08d8, 0x172c, 0x0a59, 0x18fa, 0x0849, 0x1618, 0x190a, 0x15f3, 0x0988, 0x09ef],
    "ten calls, 0849, then the loop's next pass delegates 09ef",
  );
});

test("loc_081f 0x0a59 sets Z: jz 0x0849 skips 0x18fa, then the loop's next pass delegates 09ef", () => {
  const m = makeMachine();
  m.regs.sp = 0x2400;
  m.regs.b = 0x55;
  m.mem.write8(0x2082, 0x01);
  const record = m.call.bind(m);
  m.call = (addr) => {
    if (addr === 0x0a59) m.regs.and(0x00);
    if (addr === 0x0849) m.mem.write8(0x2082, 0x00);
    return record(addr);
  };

  loc_081f(m);

  assert.equal(m.regs.b, 0x55, "the taken jz leaves B untouched");
  assert.deepEqual(
    m.calls,
    [0x1618, 0x190a, 0x15f3, 0x0988, 0x170e, 0x0935, 0x08d8, 0x172c, 0x0a59, 0x0849, 0x1618, 0x190a, 0x15f3, 0x0988, 0x09ef],
    "nine calls, 0849 without 18fa, then the next pass delegates 09ef",
  );
  assert.equal(m.tstates, 17 * 9 + 13 + 4 + 10 + 10 + (17 * 4 + 13 + 4 + 10), "taken-jz pass, then the delegating pass");
});

test("loc_081f MUTATION: lda mis-charged 7T (not 13T) is caught", () => {
  const m = makeMachine();
  m.regs.sp = 0x2400;
  m.mem.write8(0x2082, 0x00);
  const realStep = m.step.bind(m);
  m.step = (n, c) => realStep(n, n === 0x082e ? 7 : c);
  loc_081f(m);
  assert.notEqual(m.tstates, 95, "golden T-state total catches the mutant");
});
