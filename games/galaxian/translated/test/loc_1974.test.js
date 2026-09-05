// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1974 (Galaxian, ROM 0x1974-0x197b):
//   1974  0f        rrca            ; x3 => A >>> 3 (circular)
//   1975  0f        rrca
//   1976  0f        rrca
//   1977  32 03 60  ld (0x6003),a   ; coin_count_0 latch, D0 only
//   197a  35        dec (hl)        ; caller's counter cell--
//   197b  c9        ret
// Contract (A=0x08, HL=0x4010, (0x4010)=0x05): 46 T (4+4+4+13+11+10), A=0x01, coinCounter[0]=1,
// (0x4010)=0x04, ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1974 } from "../loc_1974.js";

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
  m.regs.sp = 0x4380; m.push16(0xbeef); // caller return slot in work RAM
  m.regs.a = 0x08; m.regs.hl = 0x4010;
  m.mem.write8(0x4010, 0x05);
  fn(m);
  return { cycles: m.cycles, calls: m.calls, a: m.regs.a, cc: m.io.coinCounter[0],
           cell: m.mem.read8(0x4010), pc: m.pc };
}

function checkSpec(r) {
  assert.equal(r.cycles, 46, "T-state total (4+4+4+13+11+10)");
  assert.deepEqual(r.calls, [], "straight-line + ret, no calls");
  assert.equal(r.a, 0x01, "0x08 rotated right 3x = 0x01");
  assert.equal(r.cc, 1, "0x6003 write set coin_count_0 D0 = 1");
  assert.equal(r.cell, 0x04, "dec (hl): (0x4010) 0x05 -> 0x04");
  assert.equal(r.pc, 0xbeef, "ret to caller");
}

test("loc_1974: A>>>3 to 0x6003 latch, dec (hl); 46 T", () => {
  checkSpec(run(loc_1974));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1974.js
//   find: mem.write8(0x6003, regs.a, 10);
//   repl: mem.write8(0x6002, regs.a, 10);   (wrong latch -- coin_lock, not coin_count_0)
//   expect: FAIL  (coinCounter[0] stays 0 -- caught by cc == 1; cycles/A/cell unchanged)
//   verified-anchor: count == 1  (the sole 0x6003 store in loc_1974.js)
test("loc_1974: the contract catches a wrong latch target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.rrca(); m.step(0x1975, 4);
    regs.rrca(); m.step(0x1976, 4);
    regs.rrca(); m.step(0x1977, 4);
    mem.write8(0x6002, regs.a, 10); // MUTANT: wrong latch
    m.step(0x197a, 13);
    regs.decMem8(mem, regs.hl); m.step(0x197b, 11);
    return m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
