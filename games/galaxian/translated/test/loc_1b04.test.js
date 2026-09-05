// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b04 (shared RAM-test result reporter, ROM 0x1b04-0x1b09):
//   1b04  32 f3 51  ld (0x51f3),a  ; store result code into VRAM cell (galaxian_videoram_w)
//   1b07  11 2d 1b  ld de,0x1b2d   ; -> control table for loc_1b0a
//   (falls through into loc_1b0a)
// Contract: 2 instr, 23 T (13+10), (0x51f3)=A, DE=0x1b2d, fall-through m.call [0x1b0a].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b04 } from "../loc_1b04.js";

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

function checkSpec(res) {
  assert.equal(res.cycles, 23, "T-state total (13+10)");
  assert.deepEqual(res.calls, [0x1b0a], "falls through into loc_1b0a");
  assert.equal(res.ret, "TAIL", "the fall-through into 0x1b0a propagates its result out");
  assert.equal(res.vram, 0x42, "ld (0x51f3),a wrote A(=0x42) into the VRAM result cell");
  assert.equal(res.de, 0x1b2d, "ld de,0x1b2d -> DE points at the control table");
}

function run(fn, stubs = { 0x1b0a: "tail" }) {
  const m = mk(stubs);
  m.regs.a = 0x42; // arbitrary result code to observe the store
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, vram: m.mem.read8(0x51f3), de: m.regs.de };
}

test("loc_1b04: stores result to 0x51f3, points DE at the table, falls into 0x1b0a; 23 T", () => {
  checkSpec(run(loc_1b04));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b04.js
//   find: mem.write8(0x51f3, regs.a);
//   repl: mem.write8(0x51f0, regs.a);
//   expect: FAIL  (writes the wrong VRAM cell -- caught by (0x51f3) == A)
//   verified-anchor: count == 1  (the sole "mem.write8(0x51f3" in loc_1b04.js)
test("loc_1b04: the contract catches a wrong store address", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8(0x51f0, regs.a); // MUTANT: wrong VRAM cell
    m.step(0x1b07, 13);
    regs.de = 0x1b2d;
    m.step(0x1b0a, 10);
    return m.call(0x1b0a);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
