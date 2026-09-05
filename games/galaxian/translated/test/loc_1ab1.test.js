// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1ab1 (work-RAM march-test READ-BACK loop, ROM 0x1ab1-0x1ac9):
//   1ab1  add a,0x2f / cp (hl) / jr nz,0x1afb   ; regenerate pattern, compare, mismatch->fail
//   1ab6  inc l / jp nz,0x1ab1                  ; loop the page
//   1aba  inc a / inc h / djnz 0x1ab1           ; bump seed, next page, 4 pages
//   1abe  ld a,(0x7800) / dec c / jp nz,0x1a9a  ; pet dog, next seed, retest
//   1ac5  ld sp,0x4400 / ld c,0x20              ; RAM good -> stack in RAM, seed VRAM test; -> loc_1aca
//
// PASS path (single byte, single page, C=1): H=0x40,L=0xFF,B=1,A=0,C=1, (0x40FF) pre-set to 0x2f (match).
//   T = (7+7+7) + (4+10) + (4+4+8) + 13 + 4 + 10 + 10 + 7 = 95 T; fall-through -> m.call(0x1aca).
// FAIL path: same regs but (0x40FF)=0 (mismatch) -> jr nz taken -> m.call(0x1afb); T = 7+7+12 = 26.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1ab1 } from "../loc_1ab1.js";

function mk(stubAddrs = []) {
  const routines = new Map();
  for (const a of stubAddrs) routines.set(Number(a), () => "STUB");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function runPass(fn, stubAddrs = [0x1aca]) {
  const m = mk(stubAddrs);
  m.mem.write8(0x40ff, 0x2f); // read-back matches the regenerated pattern A=0x2f
  m.regs.h = 0x40; m.regs.l = 0xff; m.regs.b = 0x01; m.regs.a = 0x00; m.regs.c = 0x01;
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, sp: m.regs.sp, c: m.regs.c, wd: m.mem.watchdogReads };
}

function checkSpec(res) {
  assert.equal(res.cycles, 95, "T-state total for the single-byte pass path");
  assert.deepEqual(res.calls, [0x1aca], "clean pass falls through into the VRAM setup loc_1aca");
  assert.equal(res.sp, 0x4400, "ld sp,0x4400 -- stack repointed into verified work RAM");
  assert.equal(res.c, 0x20, "ld c,0x20 -- seed counter for the VRAM test");
  assert.equal(res.wd, 1, "ld a,(0x7800) pet the watchdog exactly once");
}

test("loc_1ab1: work-RAM verify passes, repoints SP, falls through to loc_1aca; 88 T", () => {
  checkSpec(runPass(loc_1ab1));
});

test("loc_1ab1: a read-back mismatch tail-jumps to the fail path loc_1afb", () => {
  const m = mk([0x1afb]);
  // (0x40FF) left at its 0x00 power-on value; regenerated pattern is 0x2f -> mismatch.
  m.regs.h = 0x40; m.regs.l = 0xff; m.regs.b = 0x01; m.regs.a = 0x00; m.regs.c = 0x01;
  loc_1ab1(m);
  assert.equal(m.cycles, 26, "add(7)+cp(7)+jr nz taken(12)");
  assert.deepEqual(m.calls, [0x1afb], "mismatch delegates to the RAM-test fail path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1ab1.js
//   find: m.step(0x1aca, 7); // ld c,0x20 -- seed counter for the VIDEORAM test\n\n  // fall-through into loc_1aca (the VIDEORAM test setup) -- separate routine, delegate\n  return m.call(0x1aca);
//   repl: m.step(0x1acb, 7); // ld c,0x20 -- seed counter for the VIDEORAM test\n\n  // fall-through into loc_1aca (the VIDEORAM test setup) -- separate routine, delegate\n  return m.call(0x1acb);
//   expect: FAIL  (wrong fall-through target -> caught by calls == [0x1aca])
//   verified-anchor: count == 1  (the sole "return m.call(0x1aca)" in loc_1ab1.js)
test("loc_1ab1: the contract catches a wrong fall-through target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.add(0x2f); m.step(0x1ab3, 7);
      regs.cp(mem.read8(regs.hl)); m.step(0x1ab4, 7);
      if (regs.fNZ) { m.step(0x1afb, 12); return m.call(0x1afb); }
      m.step(0x1ab6, 7);
      regs.l = regs.inc8(regs.l); m.step(0x1ab7, 4);
      if (regs.fNZ) { m.step(0x1ab1, 10); continue; }
      m.step(0x1aba, 10);
      regs.a = regs.inc8(regs.a); m.step(0x1abb, 4);
      regs.h = regs.inc8(regs.h); m.step(0x1abc, 4);
      if (regs.djnz() !== 0) { m.step(0x1ab1, 13); continue; }
      m.step(0x1abe, 8);
      break;
    }
    regs.a = mem.read8(0x7800); m.step(0x1ac1, 13);
    regs.c = regs.dec8(regs.c); m.step(0x1ac2, 4);
    if (regs.fNZ) { m.step(0x1a9a, 10); return m.call(0x1a9a); }
    m.step(0x1ac5, 10);
    regs.sp = 0x4400; m.step(0x1ac8, 10);
    regs.c = 0x20; m.step(0x1acb, 7);
    return m.call(0x1acb); // MUTANT: wrong fall-through target
  };
  assert.throws(() => checkSpec(runPass(mutant, [0x1acb])));
});
