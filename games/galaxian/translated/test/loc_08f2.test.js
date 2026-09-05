// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_08f2 (Galaxian DE-word enqueue, ROM 0x08f2-0x0906):
//   push hl; ld h,0x40; ld a,(0x40a0); ld l,a; bit 7,(hl)
//   jr z,0x090b (slot occupied -> leave queue)
//   ld (hl),d; inc l; ld (hl),e; inc l; ld a,l; cp 0xc0
//   jr nc,0x0908 (head>=0xc0 keep)  else  ld a,0xc0 (clamp)  -> loc_0908
// Contract: write path with a low head clamps A to 0xc0 (101 T, calls [0x0908], slot=D,E); occupied slot
// tail-jumps 0x090b (59 T, queue untouched).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_08f2 } from "../loc_08f2.js";

function mk() {
  const routines = new Map();
  for (const a of [0x0908, 0x090b]) routines.set(a, () => "TAIL");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// write path: head 0x50, slot free (bit7 set) -> writes D,E, head->0x52, clamps A to 0xc0, calls 0x0908
function runWrite() {
  const m = mk();
  m.mem.write8(0x40a0, 0x50);
  m.mem.write8(0x4050, 0x80); // slot free flag
  m.regs.d = 0x12; m.regs.e = 0x34;
  const ret = loc_08f2(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a,
    slot0: m.mem.read8(0x4050), slot1: m.mem.read8(0x4051) };
}

function checkWrite(r) {
  assert.equal(r.cycles, 101, "clamp path T-states (11+7+13+4+12+7+7+4+7+4+4+7+7+7)");
  assert.deepEqual(r.calls, [0x0908], "tail-jumps loc_0908 to commit the head");
  assert.equal(r.ret, "TAIL", "callee result propagates");
  assert.equal(r.slot0, 0x12, "ld (hl),d wrote D into the head slot");
  assert.equal(r.slot1, 0x34, "ld (hl),e wrote E into head+1");
  assert.equal(r.a, 0xc0, "head 0x52 < 0xc0 -> clamped up to 0xc0");
}

test("loc_08f2: enqueues DE, advances+clamps head, tail-jumps 0x0908; 101 T", () => {
  checkWrite(runWrite());
});

test("loc_08f2: occupied slot (bit7 clear) leaves the queue and tail-jumps 0x090b; 59 T", () => {
  const m = mk();
  m.mem.write8(0x40a0, 0xc0);
  m.mem.write8(0x40c0, 0x00); // bit7 clear -> jr z
  m.regs.d = 0x12; m.regs.e = 0x34;
  loc_08f2(m);
  assert.equal(m.cycles, 59, "skip path T-states (11+7+13+4+12+12)");
  assert.deepEqual(m.calls, [0x090b], "occupied slot -> loc_090b, no commit");
  assert.equal(m.mem.read8(0x40c0), 0x00, "queue slot untouched");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_08f2.js
//   find: regs.a = 0xc0;\n  m.step(0x0908, 7); // ld a,0xc0
//   repl: regs.a = 0xd0;\n  m.step(0x0908, 7); // ld a,0xc0
//   expect: FAIL  (clamp floor wrong -> A=0xd0, caught by a == 0xc0)
//   verified-anchor: count == 1  (the sole "regs.a = 0xc0" in loc_08f2.js)
test("loc_08f2: the contract catches a wrong clamp floor", () => {
  const m = mk();
  m.mem.write8(0x40a0, 0x50);
  m.mem.write8(0x4050, 0x80);
  m.regs.d = 0x12; m.regs.e = 0x34;
  // inline mutant: clamp to 0xd0 instead of 0xc0
  const { regs, mem } = m;
  m.push16(regs.hl); m.step(0x08f3, 11);
  regs.h = 0x40; m.step(0x08f5, 7);
  regs.a = mem.read8(0x40a0); m.step(0x08f8, 13);
  regs.l = regs.a; m.step(0x08f9, 4);
  const free = regs.bit(7, mem.read8(regs.hl)); m.step(0x08fb, 12);
  assert.ok(free, "precondition: slot free");
  m.step(0x08fd, 7);
  mem.write8(regs.hl, regs.d); m.step(0x08fe, 7);
  regs.l = regs.inc8(regs.l); m.step(0x08ff, 4);
  mem.write8(regs.hl, regs.e); m.step(0x0900, 7);
  regs.l = regs.inc8(regs.l); m.step(0x0901, 4);
  regs.a = regs.l; m.step(0x0902, 4);
  regs.cp(0xc0); m.step(0x0904, 7);
  m.step(0x0906, 7);
  regs.a = 0xd0; m.step(0x0908, 7); // MUTANT
  const rr = m.call(0x0908);
  assert.throws(() => checkWrite({ cycles: m.cycles, calls: m.calls, ret: rr, a: m.regs.a,
    slot0: m.mem.read8(0x4050), slot1: m.mem.read8(0x4051) }));
});
