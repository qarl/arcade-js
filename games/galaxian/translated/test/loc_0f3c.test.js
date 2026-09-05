// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0f3c (ROM 0x0f3c-0x0f65): fixed-point homing on target (0x4202). With target=0x80,
// pos (ix+4)=0x40, subpixel (ix+9)=0, DE=0xFF03 so HL=0x4000 - 0xFF03 = 0x40FD -> (ix+4)=0x40, (ix+9)=0xFD.
// Timer (ix+0x10)=1 expires -> (ix+2) advances. Contract: 251 T, no calls, (ix+9)=0xFD, (ix+2) bumped.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0f3c } from "../loc_0f3c.js";

const IX = 0x4100;

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = IX;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function seed(m) {
  m.mem.write8(0x4202, 0x80);    // target coord
  m.mem.write8(IX + 0x03, 0x00); // (ix+3) counter
  m.mem.write8(IX + 0x04, 0x40); // (ix+4) position
  m.mem.write8(IX + 0x09, 0x00); // (ix+9) subpixel
  m.mem.write8(IX + 0x10, 0x01); // (ix+0x10) timer -> expires this tick
  m.mem.write8(IX + 0x02, 0x03); // (ix+2) state
}

test("loc_0f3c: homing integrate + timer expiry, 251 T, no calls", () => {
  const m = mk();
  m.push16(0x9999);
  seed(m);
  loc_0f3c(m);
  assert.equal(m.cycles, 251, "sum of exercised-path T-states");
  assert.deepEqual(m.calls, [], "no subroutine calls");
  assert.equal(m.mem.read8(IX + 0x04), 0x40, "(ix+4) high byte of HL result");
  assert.equal(m.mem.read8(IX + 0x09), 0xfd, "(ix+9) low byte: 0x4000 - 0xFF03 = 0x40FD");
  assert.equal(m.mem.read8(IX + 0x10), 0x00, "timer decremented to 0");
  assert.equal(m.mem.read8(IX + 0x02), 0x04, "state advanced on timer expiry");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0f3c.js
//   find: regs.decMem8(mem, (regs.ix + 0x10) & 0xffff);
//   repl: regs.incMem8(mem, (regs.ix + 0x10) & 0xffff);
//   expect: FAIL — timer goes 1->2 (nonzero) so ret nz fires and (ix+2) never advances (stays 0x03)
test("loc_0f3c: contract catches dec<->inc swap on the state timer", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.incMem8(mem, (regs.ix + 0x03) & 0xffff); m.step(0x0f3f, 23);
    regs.a = mem.read8(0x4202); m.step(0x0f42, 13);
    regs.sub(mem.read8((regs.ix + 0x04) & 0xffff)); m.step(0x0f45, 19);
    regs.neg(); m.step(0x0f47, 8);
    regs.rla(); m.step(0x0f48, 4);
    regs.e = regs.a; m.step(0x0f49, 4);
    regs.sbc(regs.a); m.step(0x0f4a, 4);
    regs.d = regs.a; m.step(0x0f4b, 4);
    regs.e = regs.rl(regs.e); m.step(0x0f4d, 8);
    regs.d = regs.rl(regs.d); m.step(0x0f4f, 8);
    regs.h = mem.read8((regs.ix + 0x04) & 0xffff); m.step(0x0f52, 19);
    regs.l = mem.read8((regs.ix + 0x09) & 0xffff); m.step(0x0f55, 19);
    regs.and(regs.a); m.step(0x0f56, 4);
    regs.sbcHl(regs.de); m.step(0x0f58, 15);
    mem.write8((regs.ix + 0x04) & 0xffff, regs.h); m.step(0x0f5b, 19);
    mem.write8((regs.ix + 0x09) & 0xffff, regs.l); m.step(0x0f5e, 19);
    regs.incMem8(mem, (regs.ix + 0x10) & 0xffff); m.step(0x0f61, 23); // MUTANT: inc not dec
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x0f62, 5);
    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); m.step(0x0f65, 23);
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  seed(m);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(IX + 0x02), 0x04));
});
