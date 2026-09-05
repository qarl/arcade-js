// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_16f5 (Galaxian sound-driver tick, ROM 0x16f5-0x1722):
//   xor a; ld (0x41c0),a         ; clear composite reg6 source
//   dec a; ld (0x41c1),a         ; pitch source = 0xFF
//   call 0x1747/17d0/1819/175d/184f/1876/1723   ; seven updaters, in order
//   ld a,(0x41c0); ld (0x6806),a ; latch reg6
//   rrca;          ld (0x6807),a ; latch reg7 = rrca(reg6)
//   ld a,(0x41c1); ld (0x7800),a ; latch pitch
//   ret
// Contract: 232 T (4+13+4+13 + 7*17 + 13+13+4+13+13+13 + 10), call order fixed, one updater seeds
// 0x41c0=0x55 / 0x41c1=0x33 so the latch shows reg6=0x55, reg7=rrca(0x55)=0xAA, pitch=0x33.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_16f5 } from "../loc_16f5.js";

const ORDER = [0x1747, 0x17d0, 0x1819, 0x175d, 0x184f, 0x1876, 0x1723];

function mk() {
  const routines = new Map();
  for (const a of ORDER) routines.set(a, () => {}); // no-op updaters
  routines.set(0x1876, (mm) => { mm.mem.write8(0x41c0, 0x55); mm.mem.write8(0x41c1, 0x33); }); // seeds the latch
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn) {
  const m = mk();
  m.regs.sp = 0x4400; // RAM: the seven pushed return addrs land in work RAM
  const ret = fn(m);
  return {
    cycles: m.cycles, calls: m.calls,
    reg6: m.io.soundReg[6], reg7: m.io.soundReg[7], pitch: m.io.soundPitchVal,
    c0: m.mem.read8(0x41c0), c1: m.mem.read8(0x41c1),
  };
}

function checkSpec(r) {
  assert.equal(r.cycles, 232, "T-state total (setup 34 + 7*17 calls + tail 79)");
  assert.deepEqual(r.calls, ORDER, "the seven updaters run in ROM order");
  assert.equal(r.c1, 0x33, "0x41c1 pitch source (seeded by updater)");
  assert.equal(r.reg6, 0x55, "sound_w reg6 <- 0x41c0");
  assert.equal(r.reg7, 0xaa, "sound_w reg7 <- rrca(0x55) = 0xAA");
  assert.equal(r.pitch, 0x33, "pitch_w <- 0x41c1");
}

test("loc_16f5: clears/seeds the composites, runs 7 updaters in order, latches sound hw; 232 T", () => {
  checkSpec(run(loc_16f5));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_16f5.js
//   find: m.push16(0x1709);\n  m.step(0x175d, 17);\n  m.call(0x175d);
//   repl: m.push16(0x1709);\n  m.step(0x184f, 17);\n  m.call(0x184f);   (updater 0x175d dropped, 0x184f run twice)
//   expect: FAIL  (calls == [...,0x184f,0x184f,0x1876,...] not the ROM order; cycles unchanged)
//   verified-anchor: count == 1  (the sole m.call(0x175d) in loc_16f5.js)
test("loc_16f5: the contract catches a reordered/dropped updater call", () => {
  const m = mk();
  m.regs.sp = 0x4400;
  const { regs, mem } = m;
  regs.xor(regs.a); m.step(0x16f6, 4);
  mem.write8(0x41c0, regs.a); m.step(0x16f9, 13);
  regs.a = regs.dec8(regs.a); m.step(0x16fa, 4);
  mem.write8(0x41c1, regs.a); m.step(0x16fd, 13);
  for (const [ret, tgt] of [[0x1700, 0x1747], [0x1703, 0x17d0], [0x1706, 0x1819],
                            [0x1709, 0x184f], [0x170c, 0x184f], [0x170f, 0x1876], [0x1712, 0x1723]]) {
    m.push16(ret); m.step(tgt, 17); m.call(tgt); // MUTANT: 0x175d replaced by a second 0x184f
  }
  regs.a = mem.read8(0x41c0); m.step(0x1715, 13);
  mem.write8(0x6806, regs.a, 10); m.step(0x1718, 13);
  regs.rrca(); m.step(0x1719, 4);
  mem.write8(0x6807, regs.a, 10); m.step(0x171c, 13);
  regs.a = mem.read8(0x41c1); m.step(0x171f, 13);
  mem.write8(0x7800, regs.a, 10); m.step(0x1722, 13);
  m.ret();
  assert.throws(() => checkSpec({
    cycles: m.cycles, calls: m.calls,
    reg6: m.io.soundReg[6], reg7: m.io.soundReg[7], pitch: m.io.soundPitchVal,
    c0: m.mem.read8(0x41c0), c1: m.mem.read8(0x41c1),
  }));
});
