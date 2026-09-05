// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_21fe (ROM 0x21fe-0x2230): clear the index-selected slot, then tail-jr to loc_2231.
// PASS path index A=0: base 0x40a2 (3 bytes) + scratch 0x40ad (1 byte) zeroed.
//   T = 7+7+11+10+10+4+12 + 10+6+10+6+10+4+10+10+12 = 139; calls [0x2231].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_21fe } from "../loc_21fe.js";

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
const tail = () => "TAIL";

function run(fn, stubs = { 0x2231: tail }) {
  const m = mk(stubs);
  for (const a of [0x40a2, 0x40a3, 0x40a4, 0x40ad]) m.mem.write8(a, 0xff); // pre-dirty the slot
  m.regs.a = 0x00; // index 0
  const ret = fn(m);
  return {
    cycles: m.cycles, calls: m.calls, ret,
    base: [0x40a2, 0x40a3, 0x40a4].map((a) => m.mem.read8(a)),
    scratch: m.mem.read8(0x40ad),
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 139, "T-state total for the index-0 clear path");
  assert.deepEqual(res.calls, [0x2231], "tail-jr into loc_2231");
  assert.equal(res.ret, "TAIL", "tail-jump result propagates out");
  assert.deepEqual(res.base, [0, 0, 0], "3 bytes at 0x40a2 zeroed");
  assert.equal(res.scratch, 0, "scratch byte 0x40ad zeroed (via ex de,hl)");
}

test("loc_21fe: index-0 clears 0x40a2..0x40a4 + 0x40ad, tail-jr 0x2231; 139 T", () => {
  checkSpec(run(loc_21fe));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_21fe.js
//   find: regs.exDeHl();\n  m.step(0x2223, 4); // ex de,hl -- HL = the scratch cell
//   repl: m.step(0x2223, 4); // ex de,hl -- HL = the scratch cell  (drop the exchange)
//   expect: FAIL (the scratch cell 0x40ad is never reached -- caught by scratch == 0)
test("loc_21fe: the contract catches a dropped `ex de,hl` (scratch cell left dirty)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.cp(0x03); m.step(0x2200, 7);
    m.step(0x2202, 7); // jr nc not taken (index 0 < 3)
    m.push16(regs.af); m.step(0x2203, 11);
    regs.hl = 0x40a2; m.step(0x2206, 10);
    regs.de = 0x40ad; m.step(0x2209, 10);
    regs.and(regs.a); m.step(0x220a, 4);
    m.step(0x221a, 12); // jr z,0x221a (taken)
    mem.write8(regs.hl, 0x00); m.step(0x221c, 10);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x221d, 6);
    mem.write8(regs.hl, 0x00); m.step(0x221f, 10);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x2220, 6);
    mem.write8(regs.hl, 0x00); m.step(0x2222, 10);
    m.step(0x2223, 4); // MUTANT: dropped ex de,hl -- HL still 0x40a4
    mem.write8(regs.hl, 0x00); m.step(0x2225, 10);
    regs.af = m.pop16(); m.step(0x2226, 10);
    m.step(0x2231, 12);
    return m.call(0x2231);
  };
  const m = mk({ 0x2231: tail });
  for (const a of [0x40a2, 0x40a3, 0x40a4, 0x40ad]) m.mem.write8(a, 0xff);
  m.regs.a = 0x00;
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x40ad), 0));
});
