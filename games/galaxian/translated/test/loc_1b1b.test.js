// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b1b (clear NMI, pet the dog, spin-then-reboot, ROM 0x1B1B-0x1B2C):
//   1b1b  af        xor a
//   1b1c  32 01 70  ld (0x7001),a   ; irq_enable D0=0 (NMI off)
//   1b1f  3a 00 78  ld a,(0x7800)   ; watchdog reset_r
//   1b22  3a 00 60  ld a,(0x6000)   ; IN0
//   1b25  e6 40     and 0x40
//   1b27  c2 1b 1b  jp nz,0x1b1b    ; spin while IN0 bit 6 set
//   1b2a  c3 00 00  jp 0x0000       ; -> reset vector
// Contract (idle IN0, bit 6 clear -> single pass): 70 T (4+13+13+13+7+10+10), irq_enable cleared,
// watchdog petted, then tail-jumps into the reset vector 0x0000 (via m.call, result propagates).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b1b } from "../loc_1b1b.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "RESET" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, stubs = { 0x0000: "tail" }, preIrq = 1) {
  const m = mk(stubs);
  m.io.irqEnable = preIrq;          // pre-set so the 0x7001 latch write's effect is observable
  m.io.in0 = 0x00;                  // IN0 bit 6 clear -> single pass, no spin
  const dog0 = m.mem.watchdogReads;
  const ret = fn(m);
  return {
    cycles: m.cycles,
    calls: m.calls,
    ret,
    irq: m.io.irqEnable,
    dogPetted: m.mem.watchdogReads - dog0,
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 70, "T-state total (4+13+13+13+7+10+10)");
  assert.deepEqual(res.calls, [0x0000], "tail-jumps into the reset vector 0x0000");
  assert.equal(res.ret, "RESET", "the reset vector callee result propagates out");
  assert.equal(res.irq, 0, "ld (0x7001),a wrote A(=0) -> irq_enable cleared (NMI off)");
  assert.equal(res.dogPetted, 1, "ld a,(0x7800) petted the watchdog once");
}

test("loc_1b1b: clears irq_enable, pets the dog, reboots via 0x0000; 70 T (idle IN0)", () => {
  checkSpec(run(loc_1b1b));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b1b.js
//   find: m.step(0x0000, 10);\n  return m.call(0x0000);
//   repl: m.step(0x0001, 10);\n  return m.call(0x0001);
//   expect: FAIL  (jumps to 0x0001 -- caught by calls == [0x0000])
//   verified-anchor: count == 1  (the sole "return m.call(0x0000)" in loc_1b1b.js)
test("loc_1b1b: the contract catches a wrong reboot target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.xor(regs.a);
      m.step(0x1b1c, 4);
      mem.write8(0x7001, regs.a, 10);
      m.step(0x1b1f, 13);
      regs.a = mem.read8(0x7800);
      m.step(0x1b22, 13);
      regs.a = mem.read8(0x6000);
      m.step(0x1b25, 13);
      regs.and(0x40);
      m.step(0x1b27, 7);
      if (regs.fNZ) { m.step(0x1b1b, 10); continue; }
      m.step(0x1b2a, 10);
      break;
    }
    m.step(0x0001, 10); // MUTANT: wrong reboot target
    return m.call(0x0001);
  };
  assert.throws(() => checkSpec(run(mutant, { 0x0001: "tail" })));
});
