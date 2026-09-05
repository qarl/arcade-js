// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1898 (ROM 0x1898-0x18a5):
//   1898  3a d0 41  ld a,(0x41d0)
//   189b  a7        and a
//   189c  28 08     jr z,0x18a6    ; no request -> normal path
//   189e  af        xor a
//   189f  32 d0 41  ld (0x41d0),a  ; consume request
//   18a2  3e 0f     ld a,0x0f
//   18a4  18 0c     jr 0x18b2      ; slam 0x0f into the latches
// Contract A (no request): 29 T (13+4+12), 0x41d0 unchanged, tail loc_18a6.
// Contract B (request): 60 T; 0x41d0=0, A=0x0f, tail loc_18b2.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1898 } from "../loc_1898.js";

function mk() {
  const routines = new Map();
  routines.set(0x18a6, () => "TAIL_a6");
  routines.set(0x18b2, () => "TAIL_b2");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_1898: no request -> tail loc_18a6; 29 T", () => {
  const m = mk();
  m.mem.write8(0x41d0, 0);
  const ret = loc_1898(m);
  assert.equal(m.cycles, 29, "13 + 4 + 12");
  assert.deepEqual(m.calls, [0x18a6], "tail-jumps into the normal path");
  assert.equal(ret, "TAIL_a6", "callee result propagates");
  assert.equal(m.mem.read8(0x41d0), 0, "0x41d0 untouched");
});

function checkRequest(m, ret) {
  assert.equal(m.cycles, 60, "T-state total, request path");
  assert.deepEqual(m.calls, [0x18b2], "tail-jumps into the broadcast");
  assert.equal(ret, "TAIL_b2", "callee result propagates");
  assert.equal(m.mem.read8(0x41d0), 0, "0x41d0 consumed");
  assert.equal(m.regs.a, 0x0f, "A forced to 0x0f before the tail");
}

test("loc_1898: request pending -> consume + tail loc_18b2; 60 T", () => {
  const m = mk();
  m.mem.write8(0x41d0, 0x01);
  const ret = loc_1898(m);
  checkRequest(m, ret);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1898.js
//   find: regs.a = 0x0f;
//   repl: regs.a = 0x0e;
//   expect: FAIL (forced value wrong, caught by A == 0x0f assert)
test("loc_1898: the contract catches a wrong forced value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x41d0); m.step(0x189b, 13);
    regs.and(regs.a); m.step(0x189c, 4);
    if (regs.fZ) { m.step(0x18a6, 12); return m.call(0x18a6); }
    m.step(0x189e, 7);
    regs.xor(regs.a); m.step(0x189f, 4);
    mem.write8(0x41d0, regs.a); m.step(0x18a2, 13);
    regs.a = 0x0e; m.step(0x18a4, 7); // MUTANT
    m.step(0x18b2, 12); return m.call(0x18b2);
  };
  const m = mk();
  m.mem.write8(0x41d0, 0x01);
  const ret = mutant(m);
  assert.throws(() => checkRequest(m, ret));
});
