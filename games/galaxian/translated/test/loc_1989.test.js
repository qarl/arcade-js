// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1989 (Galaxian, ROM 0x1989-0x198d):
//   1989  af        xor a           ; A=0
//   198a  32 02 60  ld (0x6002),a   ; coin_lock latch = 0
//   198d  c9        ret
// Contract: 27 T (4+13+10), A=0, coin_lock cleared to 0 (coinCounter[0] untouched), ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1989 } from "../loc_1989.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn) {
  const m = mk();
  m.regs.sp = 0x4380; m.push16(0xbeef);
  m.io.coinLock = 1; m.io.coinCounter[0] = 1; // pre-set so the clear + the untouched cell are observable
  m.regs.a = 0x55;
  fn(m);
  return { cycles: m.cycles, calls: m.calls, a: m.regs.a, lock: m.io.coinLock,
           cc: m.io.coinCounter[0], pc: m.pc };
}

function checkSpec(r) {
  assert.equal(r.cycles, 27, "T-state total (4+13+10)");
  assert.deepEqual(r.calls, [], "straight-line + ret, no calls");
  assert.equal(r.a, 0, "xor a -> A=0");
  assert.equal(r.lock, 0, "0x6002 write cleared coin_lock to 0");
  assert.equal(r.cc, 1, "coin_count_0 (0x6003) untouched");
  assert.equal(r.pc, 0xbeef, "ret to caller");
}

test("loc_1989: clears the 0x6002 coin_lock latch; 27 T", () => {
  checkSpec(run(loc_1989));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1989.js
//   find: mem.write8(0x6002, regs.a, 10);
//   repl: mem.write8(0x6003, regs.a, 10);   (clears coin_count_0, not coin_lock)
//   expect: FAIL  (coin_lock stays 1 -- caught by lock == 0; A/cycles unchanged)
//   verified-anchor: count == 1  (the sole 0x6002 store in loc_1989.js)
test("loc_1989: the contract catches a wrong latch target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.xor(regs.a); m.step(0x198a, 4);
    mem.write8(0x6003, regs.a, 10); // MUTANT: wrong latch
    m.step(0x198d, 13);
    return m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
