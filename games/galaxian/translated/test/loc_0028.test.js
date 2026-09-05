// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0028 (RST 28 vector, ROM 0x0028-0x0032): the STATE-DISPATCH.
//   0028  87        add a,a       ; index*2
//   0029  e1        pop hl        ; HL = inline table base (rst 28 return addr)
//   002a  5f        ld e,a
//   002b  16 00     ld d,0x00     ; DE = index*2
//   002d  19        add hl,de
//   002e  5e        ld e,(hl)     ; target low
//   002f  23        inc hl
//   0030  56        ld d,(hl)     ; target high
//   0031  eb        ex de,hl
//   0032  e9        jp (hl)       ; computed tail-jump to the dispatched target
// Contract (A=2, table at 0x4280, entry[2] = word 0x3000): 64 T, tail-m.call([0x3000]).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0028 } from "../loc_0028.js";

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

function run(fn, target = 0x3000) {
  const m = mk({ [target]: () => "DISPATCHED" });
  m.regs.a = 0x02; // index 2 -> byte offset 4
  m.regs.sp = 0x42f0;
  m.mem.write8(0x42f0, 0x80); m.mem.write8(0x42f1, 0x42); // pushed return = table base 0x4280
  m.mem.write8(0x4284, target & 0xff); m.mem.write8(0x4285, (target >> 8) & 0xff); // entry[2]
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, sp: m.regs.sp, pc: m.pc };
}

function checkSpec(r) {
  assert.equal(r.cycles, 64, "4+10+4+7+11+7+6+7+4+4");
  assert.deepEqual(r.calls, [0x3000], "tail-jumps to the table's target 0x3000");
  assert.equal(r.ret, "DISPATCHED", "the dispatched routine's result propagates out");
  assert.equal(r.sp, 0x42f2, "pop hl consumed the table pointer (SP+2)");
  assert.equal(r.pc, 0x3000, "pc lands on the dispatch target");
}

test("loc_0028: dispatches through the inline jump table (64 T)", () => {
  checkSpec(run(loc_0028));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0028.js
//   find: regs.d = 0x00;
//   repl: regs.d = 0x01;   (wrong high byte of the offset -> indexes the wrong table page)
//   expect: FAIL  (HL = 0x4384 not 0x4284 -> target reads as 0x0000, an unregistered
//                  m.call that throws NotImplemented -- caught by assert.throws either way)
//   verified-anchor: count == 1  (the sole `regs.d = 0x00` in loc_0028.js)
test("loc_0028: the contract catches a corrupted index high byte", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.add(regs.a);
    m.step(0x0029, 4);
    regs.hl = m.pop16();
    m.step(0x002a, 10);
    regs.e = regs.a;
    m.step(0x002b, 4);
    regs.d = 0x01; // MUTANT: DE high byte wrong
    m.step(0x002d, 7);
    regs.addHl(regs.de);
    m.step(0x002e, 11);
    regs.e = mem.read8(regs.hl);
    m.step(0x002f, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0030, 6);
    regs.d = mem.read8(regs.hl);
    m.step(0x0031, 7);
    regs.exDeHl();
    m.step(0x0032, 4);
    const target = regs.hl;
    m.step(target, 4);
    return m.call(target);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
