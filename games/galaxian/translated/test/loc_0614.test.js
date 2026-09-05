// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0614 (ROM 0x0614-0x0645): dec (0x4009); ret nz while counting, else reload 0x0a,
// inc (0x400a), seed 0x4200/0x4202, ldir 0x15e3->0x424a (16 bytes), clear 0x4058/0x405a, cue 0x0703 then
// tail cue 0x0200. Contracts: ret-nz path 32 T; zero-cross path 535 T with the block copy.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0614 } from "../loc_0614.js";

function mkRom() {
  const rom = new Uint8Array(0x4000);
  for (let i = 0; i < 0x10; i++) rom[0x15e3 + i] = 0xa0 + i; // known ldir source pattern
  return rom;
}

function mk(deSeen) {
  const routines = new Map();
  routines.set(0x08f2, (mm) => { deSeen.push(mm.regs.de); mm.pop16(); });
  const m = new Machine(mkRom(), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0614: still counting -> ret nz, 32 T", () => {
  const m = mk([]);
  m.mem.write8(0x4009, 2);
  m.push16(0x9999);
  loc_0614(m);
  assert.equal(m.cycles, 32, "10 + 11 + 11(ret taken)");
  assert.deepEqual(m.calls, [], "no cue while counting");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0614: zero-cross -> full setup + block copy + two cues, 535 T", () => {
  const deSeen = [];
  const m = mk(deSeen);
  m.mem.write8(0x4009, 1);
  m.mem.write8(0x400a, 6);
  m.push16(0x9999); // caller return consumed by the tail cue
  loc_0614(m);
  assert.equal(m.cycles, 535, "full path incl. 16-byte ldir (331 T)");
  assert.deepEqual(m.calls, [0x08f2, 0x08f2], "cue 0x0703 then tail cue 0x0200");
  assert.deepEqual(deSeen, [0x0703, 0x0200], "the two cue DE values");
  assert.equal(m.mem.read8(0x4009), 0x0a, "timer reloaded");
  assert.equal(m.mem.read8(0x400a), 7, "state advanced");
  assert.equal(m.mem.read16(0x4200), 0x0001, "(0x4200) <- 0x0001");
  assert.equal(m.mem.read8(0x4202), 0x80, "(0x4202) <- 0x80");
  assert.equal(m.mem.read8(0x4058), 0, "(0x4058) cleared");
  assert.equal(m.mem.read8(0x405a), 0, "(0x405a) cleared");
  assert.equal(m.mem.read8(0x424a), 0xa0, "ldir copied byte 0");
  assert.equal(m.mem.read8(0x4259), 0xaf, "ldir copied byte 15");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0614.js
//   find: mem.write8(0x4202, regs.a);  repl: (drop it)
//   expect: FAIL -- 0x4202 stays 0, not 0x80 (caught by that assert)
test("loc_0614: dropped 0x4202 seed is caught", () => {
  const deSeen = [];
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4009; m.step(0x0617, 10);
    regs.decMem8(mem, regs.hl); m.step(0x0618, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x0619, 5);
    mem.write8(regs.hl, 0x0a); m.step(0x061b, 10);
    regs.l = regs.inc8(regs.l); m.step(0x061c, 4);
    regs.incMem8(mem, regs.hl); m.step(0x061d, 11);
    regs.hl = 0x0001; m.step(0x0620, 10);
    mem.write16(0x4200, regs.hl); m.step(0x0623, 16);
    regs.a = 0x80; m.step(0x0625, 7);
    m.step(0x0628, 13); // MUTANT: dropped (0x4202) <- 0x80
    regs.hl = 0x15e3; m.step(0x062b, 10);
    regs.de = 0x424a; m.step(0x062e, 10);
    regs.bc = 0x0010; m.step(0x0631, 10);
    m.ldirAt(0x0631, 0x0633);
    regs.xor(regs.a); m.step(0x0634, 4);
    mem.write8(0x4058, regs.a); m.step(0x0637, 13);
    mem.write8(0x405a, regs.a); m.step(0x063a, 13);
    regs.de = 0x0703; m.step(0x063d, 10);
    m.push16(0x0640); m.step(0x08f2, 17); m.call(0x08f2);
    regs.de = 0x0200; m.step(0x0643, 10);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = mk(deSeen);
  m.mem.write8(0x4009, 1);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4202), 0x80));
});
