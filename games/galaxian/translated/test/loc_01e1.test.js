// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_01e1 (ROM 0x01e1-0x0217): rst-0x10 fills 0x1c bytes at pointer (0x400b) with 0x10 and
// advances it by 0x20; counts down (0x4009) (`ret nz` holds until expiry); on expiry bumps (0x400a), resets
// (0x4008)=0x0440, rst-0x10 clears 0x30 bytes at 0x4200, clears flip_x/flip_y + (0x4018), sets (0x4238)=1,
// then tail-jumps to 0x0598 (HL=0x1db1). Contract (expiry path): 256 T, calls [0x0010,0x0010,0x0598].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_01e1 } from "../loc_01e1.js";

const rst10 = (mm) => {
  const r = mm.regs;
  do { mm.mem.write8(r.hl, r.a); r.hl = (r.hl + 1) & 0xffff; r.b = (r.b - 1) & 0xff; } while (r.b !== 0);
  mm.pop16();
};

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.routines.set(0x0010, rst10);
  m.routines.set(0x0598, () => "TAIL"); // jp, no return pushed
  return m;
}

test("loc_01e1: expiry path -- fills, advance pointer, tail-jump 0x0598; 256 T", () => {
  const m = mk();
  m.mem.write16(0x400b, 0x4300); // fill pointer into work RAM
  m.mem.write8(0x4009, 0x01); // counter -> dec to 0 (expiry path)
  m.mem.write8(0x400a, 0x02);
  m.io.flipX = 1; m.io.flipY = 1; // so clearing them is observable
  const ret = loc_01e1(m);
  assert.equal(m.cycles, 256, "expiry path (ret nz not taken)");
  assert.deepEqual(m.calls, [0x0010, 0x0010, 0x0598], "two fills then the tail-jump");
  assert.equal(m.mem.read8(0x4300), 0x10, "first fill byte");
  assert.equal(m.mem.read8(0x431b), 0x10, "first fill end (0x1c bytes)");
  assert.equal(m.mem.read16(0x400b), 0x4320, "pointer advanced by 0x20");
  assert.equal(m.mem.read8(0x400a), 0x03, "(0x400a) bumped 0x02 -> 0x03");
  assert.equal(m.mem.read16(0x4008), 0x0440, "(0x4008) pointer word reset");
  assert.equal(m.mem.read8(0x4200), 0x00, "second fill cleared");
  assert.equal(m.mem.read8(0x422f), 0x00, "second fill end (0x30 bytes)");
  assert.equal(m.io.flipX, 0, "flip_x cleared (io latch)");
  assert.equal(m.io.flipY, 0, "flip_y cleared (io latch)");
  assert.equal(m.mem.read8(0x4018), 0x00);
  assert.equal(m.mem.read8(0x4238), 0x01);
  assert.equal(m.regs.hl, 0x1db1, "HL = arg to 0x0598");
  assert.equal(ret, "TAIL", "tail-jump result propagates");
});

test("loc_01e1: ret nz holds while (0x4009) is still counting", () => {
  const m = mk();
  m.mem.write16(0x400b, 0x4300);
  m.mem.write8(0x4009, 0x03); // dec -> 0x02, nonzero -> ret nz taken
  m.push16(0x9999); // caller return the early ret pops
  loc_01e1(m);
  assert.equal(m.pc, 0x9999, "ret nz returned to caller");
  assert.deepEqual(m.calls, [0x0010], "only the first fill ran");
  assert.equal(m.mem.read8(0x4009), 0x02, "counter decremented, still nonzero");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_01e1.js
//   find: regs.b = 0x1c;
//   repl: regs.b = 0x1b;
//   expect: FAIL (fill count short -> pointer advances by 0x1f, not 0x20)
test("loc_01e1: the contract catches a wrong fill count", () => {
  const m = mk();
  m.mem.write16(0x400b, 0x4300);
  m.mem.write8(0x4009, 0x01);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.hl = mem.read16(0x400b); mm.step(0x01e4, 16);
    regs.b = 0x1b; mm.step(0x01e6, 7); // MUTANT
    regs.a = 0x10; mm.step(0x01e8, 7);
    mm.push16(0x01e9); mm.step(0x0010, 11); mm.call(0x0010);
    regs.de = 0x0004; mm.step(0x01ec, 10);
    regs.addHl(regs.de); mm.step(0x01ed, 11);
    mem.write16(0x400b, regs.hl); mm.step(0x01f0, 16);
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read16(0x400b), 0x4320));
});
