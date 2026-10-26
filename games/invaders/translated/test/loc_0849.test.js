// SPDX-License-Identifier: GPL-3.0-only
// Equivalence test for loc_0849 (ROM 0x0849-0x0853): two calls around `out 0x06`, then `jmp 0x081f`,
// taken by returning into loc_081f's loop. Pins the port write, the calls, T-states, and push returns.
// Run: node --test games/invaders/translated/test/loc_0849.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { Regs } from "../../../../core/cpu/8080.js";
import { loc_0849 } from "../loc_0849.js";

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

test("loc_0849: out 0x06 <- A, calls 1775+1804, steps to 0x081f without calling it; 54 T", () => {
  const m = makeMachine();
  m.regs.sp = 0x2400;
  m.regs.a = 0x3c;

  loc_0849(m);

  assert.deepEqual(m.io.outs, [[0x06, 0x3c]], "out 0x06 writes A");
  assert.equal(m.tstates, 17 + 10 + 17 + 10, "T total");
  assert.deepEqual(m.calls, [0x1775, 0x1804], "two calls; the jmp to 081f is its caller's loop, not a call");
  assert.deepEqual(m.pcSeq, [0x1775, 0x084e, 0x1804, 0x081f], "step boundaries");
  assert.equal(m.mem.read16(0x23fe), 0x084c, "call 0x1775 return addr");
  assert.equal(m.mem.read16(0x23fc), 0x0851, "call 0x1804 return addr");
});

test("loc_0849 MUTATION: out mis-charged 7T (not 10T) is caught", () => {
  const m = makeMachine();
  m.regs.sp = 0x2400;
  const realStep = m.step.bind(m);
  m.step = (n, c) => realStep(n, n === 0x084e ? 7 : c);
  loc_0849(m);
  assert.notEqual(m.tstates, 54, "golden T-state total catches the mutant");
});
