// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1ad0 (VIDEORAM march-test WRITE loop, ROM 0x1ad0-0x1ae3):
//   1ad0  add a,0x2f / ld (hl),a / inc l / jp nz,0x1ad0   ; write A+0x2F per byte, loop the page
//   1ad7  inc a / inc h / djnz 0x1ad0                      ; bump seed, next page, 4 pages
//   1adb  ld a,(0x7800)                                    ; pet the watchdog
//   1ade  ld hl,0x5000 / ld b,0x04 / ld a,c               ; re-seed for verify; fall through -> loc_1ae4
// Contract exercised with a SHORT deterministic path: H=0x50, L=0xFD, B=1, A=0, C=0x55.
//   inner loop runs 3 times (l: FD->FE->FF->00), then one page (B=1), then pet-dog + re-seed tail.
//   T = 3*(7+7+4+10) + (4+4+8) + 13 + (10+7+4) = 84 + 16 + 13 + 21 = 134 T; fall-through -> m.call(0x1ae4).
//   pattern stored: (0x50FD)=0x2f, (0x50FE)=0x5e, (0x50FF)=0x8d.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1ad0 } from "../loc_1ad0.js";

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

function run(fn, stubAddrs = [0x1ae4]) {
  const m = mk(stubAddrs);
  m.regs.h = 0x50; m.regs.l = 0xfd; m.regs.b = 0x01; m.regs.a = 0x00; m.regs.c = 0x55;
  const ret = fn(m);
  return {
    cycles: m.cycles,
    calls: m.calls,
    ret,
    b: m.regs.b,
    hl: m.regs.hl,
    a: m.regs.a,
    wd: m.mem.watchdogReads,
    m50fd: m.mem.read8(0x50fd),
    m50fe: m.mem.read8(0x50fe),
    m50ff: m.mem.read8(0x50ff),
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 134, "T-state total 3*(7+7+4+10)+(4+4+8)+13+(10+7+4)");
  assert.deepEqual(res.calls, [0x1ae4], "falls through into the VRAM verify loop loc_1ae4");
  assert.equal(res.hl, 0x5000, "re-seeded HL=0x5000 for the verify pass");
  assert.equal(res.b, 0x04, "re-seeded B=0x04");
  assert.equal(res.a, 0x55, "ld a,c re-loaded the seed C=0x55");
  assert.equal(res.wd, 1, "ld a,(0x7800) pet the watchdog exactly once");
  assert.equal(res.m50fd, 0x2f, "(0x50FD) = A+0x2F on iter 1");
  assert.equal(res.m50fe, 0x5e, "(0x50FE) = pattern on iter 2");
  assert.equal(res.m50ff, 0x8d, "(0x50FF) = pattern on iter 3");
}

test("loc_1ad0: VRAM write loop fills the walking pattern, pets dog, falls through to loc_1ae4; 134 T", () => {
  checkSpec(run(loc_1ad0));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1ad0.js
//   find: mem.write8(regs.hl, regs.a); // ld (hl),a -- VIDEORAM (0x50xx), plain RAM write
//   repl: mem.write8(regs.hl, regs.a & 0x7f); // ld (hl),a -- VIDEORAM (0x50xx), plain RAM write
//   expect: FAIL  (masked store -> (0x50FF)=0x0d not 0x8d; caught by the memory asserts)
//   verified-anchor: count == 1  (the sole "mem.write8(regs.hl, regs.a)" in loc_1ad0.js)
test("loc_1ad0: the contract catches a wrong stored value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.add(0x2f); m.step(0x1ad2, 7);
      mem.write8(regs.hl, regs.a & 0x7f); // MUTANT: masked store
      m.step(0x1ad3, 7);
      regs.l = regs.inc8(regs.l); m.step(0x1ad4, 4);
      if (regs.fNZ) { m.step(0x1ad0, 10); continue; }
      m.step(0x1ad7, 10);
      regs.a = regs.inc8(regs.a); m.step(0x1ad8, 4);
      regs.h = regs.inc8(regs.h); m.step(0x1ad9, 4);
      if (regs.djnz() !== 0) { m.step(0x1ad0, 13); continue; }
      m.step(0x1adb, 8);
      break;
    }
    regs.a = mem.read8(0x7800); m.step(0x1ade, 13);
    regs.hl = 0x5000; m.step(0x1ae1, 10);
    regs.b = 0x04; m.step(0x1ae3, 7);
    regs.a = regs.c; m.step(0x1ae4, 4);
    return m.call(0x1ae4);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
