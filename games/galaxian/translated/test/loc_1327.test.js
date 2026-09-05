// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1327 (ROM 0x1327-0x1343): (0x4201)-gated sound ticker. Contract (full expiry path):
// countdown (0x4205) reloads, enqueues sound, (0x4206) hits 0 -> clears (0x4201) and sound_w reg3; 151 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1327 } from "../loc_1327.js";

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
// loc_08f2 stub: pop the pushed return (clean ret, HL preserved as the real routine does).
const clean = (mm) => { mm.pop16(); };

function run() {
  const m = mk({ 0x08f2: clean });
  m.mem.write8(0x4201, 0x01); // enabled (bit0)
  m.mem.write8(0x4205, 0x01); // countdown -> 0 (reload branch)
  m.mem.write8(0x4206, 0x01); // step counter -> 0 (final branch)
  m.io.soundReg[3] = 0xff;    // pre-set so the clear is observable
  m.push16(0x9999);
  loc_1327(m);
  return m;
}

test("loc_1327: full expiry clears (0x4201) and (0x6803); 151 T", () => {
  const m = run();
  assert.equal(m.cycles, 151, "sum of all instr T-states (full expiry path)");
  assert.deepEqual(m.calls, [0x08f2], "one sound-enqueue call");
  assert.equal(m.mem.read8(0x4201), 0x00, "(0x4201) disabled");
  assert.equal(m.mem.read8(0x4205), 0x0a, "(0x4205) reloaded to 0x0a");
  assert.equal(m.mem.read8(0x4206), 0x00, "(0x4206) decremented to 0");
  assert.equal(m.io.soundReg[3], 0x00, "sound_w reg3 (0x6803) <- 0 (io latch, NOT mem.read8)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_1327: disabled ((0x4201) bit0 clear) -> ret; 28 T", () => {
  const m = mk({ 0x08f2: clean });
  m.mem.write8(0x4201, 0x00);
  m.push16(0x9999);
  loc_1327(m);
  assert.equal(m.cycles, 28, "ld a(13)+rrca(4)+ret nc taken(11)");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.deepEqual(m.calls, [], "no enqueue");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1327.js
//   find: mem.write8(0x6803, regs.a, 10);  at 0x1340
//   repl: drop it
//   expect: FAIL -- soundReg[3] stays 0xFF, the contract catches it.
test("loc_1327: contract catches a dropped (0x6803) clear", () => {
  const m = mk({ 0x08f2: clean });
  m.mem.write8(0x4201, 0x01);
  m.mem.write8(0x4205, 0x01);
  m.mem.write8(0x4206, 0x01);
  m.io.soundReg[3] = 0xff;
  m.push16(0x9999);
  const { regs, mem } = m;
  regs.a = mem.read8(0x4201); m.step(0x132a, 13);
  regs.rrca(); m.step(0x132b, 4);
  m.step(0x132c, 5);
  regs.hl = 0x4205; m.step(0x132f, 10);
  regs.decMem8(mem, regs.hl); m.step(0x1330, 11);
  m.step(0x1331, 5);
  mem.write8(regs.hl, 0x0a); m.step(0x1333, 10);
  regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1334, 6);
  regs.d = 0x02; m.step(0x1336, 7);
  regs.e = mem.read8(regs.hl); m.step(0x1337, 7);
  m.push16(0x133a); m.step(0x08f2, 17); m.call(0x08f2);
  regs.decMem8(mem, regs.hl); m.step(0x133b, 11);
  m.step(0x133c, 5);
  regs.xor(regs.a); m.step(0x133d, 4);
  mem.write8(0x4201, regs.a); m.step(0x1340, 13); // MUTANT: dropped ld (0x6803),a
  m.ret();
  assert.throws(() => assert.equal(m.io.soundReg[3], 0x00));
});
