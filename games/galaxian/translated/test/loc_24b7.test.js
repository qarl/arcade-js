// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_24b7 (ROM 0x24b7-0x2568): HUD sub-dispatch on A. A==2 arm (loc_24c8): paint message
// 0x06, then split (0x40ac) into low nibble -> 0x5138 and high nibble -> 0x5158 (right-justified). With
// (0x40ac)=0x35: 0x5138<-0x05, 0x5158<-0x03. Contract: 191 T, calls [0x22f1], ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_24b7 } from "../loc_24b7.js";

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
const rst = (mm) => { mm.pop16(); };

test("loc_24b7: A==2 splits (0x40ac)=0x35 into VRAM nibble cells; 191 T", () => {
  const m = mk({ 0x22f1: rst });
  m.push16(0x9999);
  m.mem.write8(0x40ac, 0x35);
  m.regs.a = 0x02;
  loc_24b7(m);
  assert.equal(m.cycles, 191, "dispatch + message paint + two nibble writes");
  assert.deepEqual(m.calls, [0x22f1], "paints message 0x06 via loc_22f1");
  assert.equal(m.mem.read8(0x5138), 0x05, "low nibble -> 0x5138");
  assert.equal(m.mem.read8(0x5158), 0x03, "high nibble (>>4) -> 0x5158");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_24b7: A==2 with (0x40ac)==0xff returns immediately (ret z)", () => {
  const m = mk({ 0x22f1: rst });
  m.push16(0x9999);
  m.mem.write8(0x40ac, 0xff);
  m.regs.a = 0x02;
  loc_24b7(m);
  assert.deepEqual(m.calls, [], "0xff sentinel: nothing painted");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_24b7.js
//   find: regs.and(0x0f);   (the A==2 low-nibble mask, before the 0x5138 store)
//   repl: regs.and(0xf0);
//   expect: FAIL (0x5138 gets 0x30 not 0x05; caught by the read8(0x5138)==0x05 assert)
test("loc_24b7: the contract catches a wrong low-nibble mask", () => {
  const m = mk({ 0x22f1: rst });
  m.push16(0x9999);
  m.mem.write8(0x40ac, 0x35);
  m.regs.a = 0x02;
  const { regs, mem } = m;
  regs.and(regs.a); m.step(0x24b8, 4);
  m.step(0x24ba, 7);
  regs.a = regs.dec8(regs.a); m.step(0x24bb, 4);
  m.step(0x24bd, 7);
  regs.a = regs.dec8(regs.a); m.step(0x24be, 4);
  m.step(0x24c8, 12);
  regs.a = mem.read8(0x40ac); m.step(0x24cb, 13);
  regs.cp(0xff); m.step(0x24cd, 7);
  m.step(0x24ce, 5);
  regs.a = 0x06; m.step(0x24d0, 7);
  m.push16(0x24d3); m.step(0x22f1, 17); m.call(0x22f1);
  regs.a = mem.read8(0x40ac); m.step(0x24d6, 13);
  regs.and(0xf0); m.step(0x24d8, 7); // MUTANT
  mem.write8(0x5138, regs.a); m.step(0x24db, 13);
  assert.throws(() => assert.equal(m.mem.read8(0x5138), 0x05));
});
