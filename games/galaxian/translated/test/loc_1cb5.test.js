// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1cb5 (ROM 0x1cb5-0x1cce): silence the sound hardware via three rst-0x10 block-fills
// (0x6004<-1, 0x6800<-0, 0x7001<-0) then pitch_w (0x7800)<-0xFF; ret. Contract: 122 T, calls [0x10,0x10,0x10],
// A=0xFF, 0x7800=0xFF.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1cb5 } from "../loc_1cb5.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
// rst 0x10 helper stub: pop the pushed return address (loc_0010 rets cleanly).
const rst10 = (mm) => { mm.pop16(); };

function run() {
  const m = mk({ 0x0010: rst10 });
  m.push16(0x9999); // caller return for loc_1cb5's own ret
  loc_1cb5(m);
  return m;
}

test("loc_1cb5: three rst-0x10 sound-latch clears + pitch=0xFF; 122 T", () => {
  const m = run();
  assert.equal(m.cycles, 122, "sum of all instr T-states");
  assert.deepEqual(m.calls, [0x0010, 0x0010, 0x0010], "three rst 0x10 block-fills");
  assert.equal(m.regs.a, 0xff, "dec a after xor a -> 0xFF");
  assert.equal(m.io.soundPitchVal, 0xff, "pitch_w (0x7800) <- 0xFF (io latch, NOT mem.read8 which is the watchdog)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1cb5.js
//   find: regs.a = regs.dec8(regs.a);
//   repl: (drop it -- A stays 0 from `xor a`)
//   expect: FAIL (pitch gets 0x00 instead of 0xFF; caught by the soundPitchVal assert)
test("loc_1cb5: the contract catches a dropped `dec a` (wrong pitch value)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = 0x01; m.step(0x1cb7, 7);
    regs.hl = 0x6004; m.step(0x1cba, 10);
    regs.b = 0x04; m.step(0x1cbc, 7);
    m.push16(0x1cbd); m.step(0x0010, 11); m.call(0x0010);
    regs.xor(regs.a); m.step(0x1cbe, 4);
    regs.b = 0x08; m.step(0x1cc0, 7);
    regs.hl = 0x6800; m.step(0x1cc3, 10);
    m.push16(0x1cc4); m.step(0x0010, 11); m.call(0x0010);
    regs.b = 0x05; m.step(0x1cc6, 7);
    regs.hl = 0x7001; m.step(0x1cc9, 10);
    m.push16(0x1cca); m.step(0x0010, 11); m.call(0x0010);
    m.step(0x1ccb, 4); // MUTANT: dropped `dec a`, A stays 0x00
    mem.write8(0x7800, regs.a, 10); m.step(0x1cce, 13);
    m.ret();
  };
  const m = mk({ 0x0010: rst10 });
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.io.soundPitchVal, 0xff));
});
