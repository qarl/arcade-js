// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a5c (Galaxian cold-boot VRAM page-fill loop, ROM 0x1A5C-0x1A6A):
//   1a5c  77        ld (hl),a       ; fill one VRAM byte
//   1a5d  2c        inc l
//   1a5e  c2 5c 1a  jp nz,0x1a5c    ; 256-byte page loop
//   1a61  24        inc h
//   1a62  3a 00 78  ld a,(0x7800)   ; watchdog reset read
//   1a65  10 f3     djnz 0x1a5a     ; taken -> loc_1a5a (next page); else fall through
//   1a67  21 00 58  ld hl,0x5800
//   1a6a  af        xor a
// Contract (fall-through, B=1): 256*(7+4+10) + 4 + 13 + 8 + 10 + 4 = 5415 T; fills 0x5000-0x50FF with A;
// reads the watchdog once; ends HL=0x5800, A=0; tail-falls into loc_1a6b. Taken path (B=2) tail-jumps 0x1a5a.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a5c } from "../loc_1a5c.js";

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

// Fall-through pass: enter as loc_1a5a would (HL=0x5000, A=0x10, B=1) so the single page completes and
// djnz is NOT taken.
function runFall(fn, stubs = { 0x1a6b: "tail" }) {
  const m = mk(stubs);
  m.regs.hl = 0x5000;
  m.regs.a = 0x10;
  m.regs.b = 0x01;
  const ret = fn(m);
  let filled = 0;
  for (let i = 0; i < 0x100; i++) if (m.mem.videoRam[i] === 0x10) filled++;
  return {
    cycles: m.cycles, calls: m.calls, ret,
    a: m.regs.a, hl: m.regs.hl, watchdog: m.mem.watchdogReads, filled,
  };
}

function checkFall(res) {
  assert.equal(res.cycles, 5415, "T-state total (256*21 + 4 + 13 + 8 + 10 + 4)");
  assert.deepEqual(res.calls, [0x1a6b], "fall-through tails into the OBJRAM-clear loop 0x1a6b");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(res.filled, 0x100, "fills all 256 bytes of the VRAM page with A (0x10)");
  assert.equal(res.watchdog, 1, "reads (pets) the watchdog once per page");
  assert.equal(res.hl, 0x5800, "ends HL=0x5800 (points at OBJRAM)");
  assert.equal(res.a, 0x00, "xor a -> A=0 (OBJRAM clear value)");
}

test("loc_1a5c: fills a VRAM page, pets watchdog, falls into 0x1a6b; 5415 T", () => {
  checkFall(runFall(loc_1a5c));
});

test("loc_1a5c: with B>1 the djnz tail-jumps back to loc_1a5a for the next page", () => {
  const m = mk({ 0x1a5a: "tail" });
  m.regs.hl = 0x5000;
  m.regs.a = 0x10;
  m.regs.b = 0x02;
  const ret = loc_1a5c(m);
  assert.deepEqual(m.calls, [0x1a5a], "djnz taken -> loc_1a5a");
  assert.equal(ret, "TAIL", "the taken tail-jump's callee result propagates out");
  assert.equal(m.regs.b, 0x01, "B decremented to 1 by the taken djnz");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a5c.js
//   find: m.step(0x1a67, 8); // djnz 0x1a5a (not taken)
//   repl: m.step(0x1a67, 13); // djnz 0x1a5a (not taken)
//   expect: FAIL  (not-taken djnz must charge 8 T, not 13 -- caught by cycles == 5415)
//   verified-anchor: count == 1  (the sole not-taken djnz step in loc_1a5c.js)
test("loc_1a5c: the contract catches a wrong not-taken djnz T-state charge", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a);
      m.step(0x1a5d, 7);
      regs.l = regs.inc8(regs.l);
      m.step(0x1a5e, 4);
      if (regs.fNZ) { m.step(0x1a5c, 10); continue; }
      m.step(0x1a61, 10);
      break;
    }
    regs.h = regs.inc8(regs.h);
    m.step(0x1a62, 4);
    regs.a = mem.read8(0x7800);
    m.step(0x1a65, 13);
    if (m.regs.djnz() !== 0) { m.step(0x1a5a, 13); return m.call(0x1a5a); }
    m.step(0x1a67, 13); // MUTANT: not-taken djnz should be 8 T
    regs.hl = 0x5800;
    m.step(0x1a6a, 10);
    regs.xor(regs.a);
    m.step(0x1a6b, 4);
    return m.call(0x1a6b);
  };
  assert.throws(() => checkFall(runFall(mutant)));
});
