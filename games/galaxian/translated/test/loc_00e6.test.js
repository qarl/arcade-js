// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_00e6 (ROM 0x00e6-0x0151): a game-state routine (rst-28 dispatch target).
// Fills 0x20 bytes of (0x400b) with 0x10 (rst 0x10) and stores the advanced pointer; dec (0x4008) and
// ret nz until it hits 0; on the zero tick resets 0x4005-0x4007/0x400a, maps dip bytes into
// 0x4000/0x401f/0x400f, looks IN2&3 up through table @0x0152 into 0x40ac, seeds three VRAM cells,
// tail-jumps to loc_08f2. Contracts: early-out (counter>1) 89 T, calls [0x10]; full run 474 T,
// calls [0x10,0x0646,0x0020,0x0595,0x08f2,0x08f2].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_00e6 } from "../loc_00e6.js";

function mk() {
  const rom = new Uint8Array(0x4000);
  rom.set([0x07, 0x10, 0x12, 0x20], 0x0152); // the rst-0x20 lookup table (DATA @0x0152)
  const m = new Machine(rom, new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x43f0;
  m.mem.write8(0x43f0, 0x00); m.mem.write8(0x43f1, 0x20); // caller return = 0x2000
  m.io.in2 = 0x00; // IN2 idle -> index 0 -> table[0]=0x07
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// rst 0x10 (loc_0010) stub: mimic the fill's pointer advance (HL += B, B=0) and pop the pushed frame.
const rst10 = (mm) => { mm.regs.hl = (mm.regs.hl + mm.regs.b) & 0xffff; mm.regs.b = 0; mm.pop16(); };
// rst 0x20 (loc_0020) stub: real table lookup A = (HL + A), then pop the pushed frame.
const rst20 = (mm) => { mm.regs.a = mm.mem.read8((mm.regs.hl + mm.regs.a) & 0xffff); mm.pop16(); };
// plain-call stubs: pop the pushed return address, no other effect.
const retStub = (mm) => { mm.pop16(); };

function stubAll(m) {
  m.routines.set(0x0010, rst10);
  m.routines.set(0x0020, rst20);
  m.routines.set(0x0646, retStub);
  m.routines.set(0x0595, retStub);
  m.routines.set(0x08f2, retStub);
}

test("loc_00e6: counter not elapsed -> fill + ret nz; 89 T", () => {
  const m = mk();
  stubAll(m);
  m.mem.write16(0x400b, 0x4200); // buffer pointer
  m.mem.write8(0x4008, 3);       // counter: 3 -> 2 (nonzero)
  loc_00e6(m);
  assert.equal(m.cycles, 89, "16+7+7+11+16+10+11 + ret-nz-taken 11");
  assert.deepEqual(m.calls, [0x0010], "only the fill ran");
  assert.equal(m.mem.read16(0x400b), 0x4220, "pointer advanced by 0x20");
  assert.equal(m.mem.read8(0x4008), 2, "counter decremented");
  assert.equal(m.pc, 0x2000, "ret nz returned to the caller");
});

function checkFull(m) {
  assert.equal(m.cycles, 474, "full-run T total (callee bodies stubbed to 0)");
  assert.deepEqual(m.calls, [0x0010, 0x0646, 0x0020, 0x0595, 0x08f2, 0x08f2], "call sequence");
  assert.equal(m.mem.read16(0x400b), 0x4820, "pointer advanced by 0x20");
  assert.equal(m.mem.read8(0x4007), 0x01, "0x4007 <- 1");
  assert.equal(m.mem.read8(0x4006), 0x00, "0x4006 <- 0");
  assert.equal(m.mem.read8(0x4005), 0x01, "0x4005 <- 1");
  assert.equal(m.mem.read8(0x400a), 0x00, "0x400a <- 0");
  assert.equal(m.mem.read8(0x4000), 0x02, "(0x4011=0x80)>>6 & 3 = 2");
  assert.equal(m.mem.read8(0x401f), 0x01, "(0x4012=0x04) bit2 -> bit0 = 1");
  assert.equal(m.mem.read8(0x400f), 0x01, "(0x4010=0x20) bit5 -> bit0 = 1");
  assert.equal(m.mem.read8(0x40ac), 0x07, "table[IN2&3=0] = 0x07");
  assert.equal(m.mem.read8(0x5340), 0x01, "VRAM 0x5340 <- 1");
  assert.equal(m.mem.read8(0x5320), 0x25, "VRAM 0x5320 <- 0x25");
  assert.equal(m.mem.read8(0x5300), 0x20, "VRAM 0x5300 <- 0x20");
  assert.equal(m.pc, 0x08f2, "tail-jumped to loc_08f2");
}

test("loc_00e6: counter elapses -> full state setup + tail-jump; 474 T", () => {
  const m = mk();
  stubAll(m);
  m.mem.write16(0x400b, 0x4800);
  m.mem.write8(0x4008, 1);   // 1 -> 0: elapsed
  m.mem.write8(0x4011, 0x80);
  m.mem.write8(0x4012, 0x04);
  m.mem.write8(0x4010, 0x20);
  loc_00e6(m);
  checkFull(m);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_00e6.js
//   find: mem.write8(0x5320, regs.a);
//   repl: (drop it -- 0x5320 stays 0)
//   expect: FAIL (checkFull's 0x5320 == 0x25 assert trips)
test("loc_00e6: the contract catches a dropped VRAM write", () => {
  const m = mk();
  stubAll(m);
  m.mem.write16(0x400b, 0x4800);
  m.mem.write8(0x4008, 1);
  m.mem.write8(0x4011, 0x80);
  m.mem.write8(0x4012, 0x04);
  m.mem.write8(0x4010, 0x20);
  // replay loc_00e6 verbatim but omit the 0x5320 store (its m.step still runs, so T total is unchanged)
  const { regs, mem } = m;
  regs.hl = mem.read16(0x400b); m.step(0x00e9, 16);
  regs.b = 0x20; m.step(0x00eb, 7);
  regs.a = 0x10; m.step(0x00ed, 7);
  m.push16(0x00ee); m.step(0x0010, 11); m.call(0x0010);
  mem.write16(0x400b, regs.hl); m.step(0x00f1, 16);
  regs.hl = 0x4008; m.step(0x00f4, 10);
  regs.decMem8(mem, regs.hl); m.step(0x00f5, 11);
  m.step(0x00f6, 5); // counter elapsed, no ret
  regs.l = regs.dec8(regs.l); m.step(0x00f7, 4);
  mem.write8(regs.hl, 0x01); m.step(0x00f9, 10);
  regs.l = regs.dec8(regs.l); m.step(0x00fa, 4);
  mem.write8(regs.hl, 0x00); m.step(0x00fc, 10);
  regs.l = regs.dec8(regs.l); m.step(0x00fd, 4);
  mem.write8(regs.hl, 0x01); m.step(0x00ff, 10);
  regs.xor(regs.a); m.step(0x0100, 4);
  mem.write8(0x400a, regs.a); m.step(0x0103, 13);
  regs.a = mem.read8(0x4011); m.step(0x0106, 13);
  regs.rlca(); m.step(0x0107, 4);
  regs.rlca(); m.step(0x0108, 4);
  regs.and(0x03); m.step(0x010a, 7);
  mem.write8(0x4000, regs.a); m.step(0x010d, 13);
  regs.a = mem.read8(0x4012); m.step(0x0110, 13);
  regs.and(0x04); m.step(0x0112, 7);
  regs.rrca(); m.step(0x0113, 4);
  regs.rrca(); m.step(0x0114, 4);
  mem.write8(0x401f, regs.a); m.step(0x0117, 13);
  regs.de = 0x051b; m.step(0x011a, 10);
  m.push16(0x011d); m.step(0x0646, 17); m.call(0x0646);
  regs.a = mem.read8(0x4010); m.step(0x0120, 13);
  regs.and(0x20); m.step(0x0122, 7);
  regs.rlca(); m.step(0x0123, 4);
  regs.rlca(); m.step(0x0124, 4);
  regs.rlca(); m.step(0x0125, 4);
  mem.write8(0x400f, regs.a); m.step(0x0128, 13);
  regs.a = mem.read8(0x7000); m.step(0x012b, 13);
  regs.and(0x03); m.step(0x012d, 7);
  regs.hl = 0x0152; m.step(0x0130, 10);
  m.push16(0x0131); m.step(0x0020, 11); m.call(0x0020);
  mem.write8(0x40ac, regs.a); m.step(0x0134, 13);
  m.push16(0x0137); m.step(0x0595, 17); m.call(0x0595);
  regs.a = 0x01; m.step(0x0139, 7);
  mem.write8(0x5340, regs.a); m.step(0x013c, 13);
  regs.a = 0x25; m.step(0x013e, 7);
  m.step(0x0141, 13); // MUTANT: dropped `ld (0x5320),a`
  regs.a = 0x20; m.step(0x0143, 7);
  mem.write8(0x5300, regs.a); m.step(0x0146, 13);
  regs.de = 0x0604; m.step(0x0149, 10);
  m.push16(0x014c); m.step(0x08f2, 17); m.call(0x08f2);
  regs.de = 0x0503; m.step(0x014f, 10);
  m.step(0x08f2, 10); m.call(0x08f2);
  assert.throws(() => checkFull(m));
});
