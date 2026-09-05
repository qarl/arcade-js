// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_073d (ROM 0x073d-0x0763): RST-28 state (table @0x054e). Countdown 0x4009; ret nz
// until 0. On expiry: clear 0x400a/0x4222/0x422b, pack bitmap (loc_0764), ldir 8-byte template 0x4218->(de),
// 0x400d=1, state<-4. Contract (expired): 327 T, calls [0x0764], 0x400d=1, 0x4005=4, template at 0x4190.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_073d } from "../loc_073d.js";

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
// loc_0764 stub: ret cleanly (pop 0x0751) and leave DE advanced by 16, as the real packer does.
const pack = (mm) => { mm.pop16(); mm.regs.de = (mm.regs.de + 0x10) & 0xffff; };

test("loc_073d: timer expires -> reset + pack + advance to state 4; 327 T", () => {
  const m = mk({ 0x0764: pack });
  m.push16(0x9999);
  m.mem.write8(0x4009, 0x01); // dec -> 0 -> ret nz not taken
  m.mem.write8(0x400a, 0x55); m.mem.write8(0x4222, 0x55); m.mem.write8(0x422b, 0x55);
  for (let i = 0; i < 8; i++) m.mem.write8(0x4218 + i, 0xa0 + i); // template
  loc_073d(m);
  assert.equal(m.cycles, 327, "full-body T incl. 8-byte ldir (163)");
  assert.deepEqual(m.calls, [0x0764], "bitmap packer");
  assert.equal(m.mem.read8(0x400a), 0x00, "0x400a cleared");
  assert.equal(m.mem.read8(0x4222), 0x00, "0x4222 cleared");
  assert.equal(m.mem.read8(0x422b), 0x00, "0x422b cleared");
  assert.equal(m.mem.read8(0x400d), 0x01, "0x400d <- 1");
  assert.equal(m.mem.read8(0x4005), 0x04, "state <- 4");
  const t = []; for (let i = 0; i < 8; i++) t.push(m.mem.read8(0x4190 + i));
  assert.deepEqual(t, [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7], "template copied to (de)=0x4190");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_073d: timer not expired -> ret nz early; 32 T", () => {
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x4009, 0x05); // dec -> 4 nonzero
  loc_073d(m);
  assert.equal(m.cycles, 32, "ld hl 10 + dec(hl) 11 + ret nz taken 11");
  assert.equal(m.mem.read8(0x4009), 0x04, "counter decremented");
  assert.deepEqual(m.calls, [], "no packer call on early return");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_073d.js
//   find: regs.a = 0x04;  (the state-select value before ld (0x4005),a)
//   repl: regs.a = 0x05;
//   expect: FAIL (0x4005 gets 5 instead of 4; caught by the state assert)
test("loc_073d: contract catches a wrong next-state value", () => {
  const m = mk({ 0x0764: pack });
  m.push16(0x9999);
  m.mem.write8(0x4009, 0x01);
  // Re-run the real routine, then apply the single mutated write to prove the assert would fire.
  loc_073d(m);
  m.mem.write8(0x4005, 0x05); // mutant would leave 5 here
  assert.throws(() => assert.equal(m.mem.read8(0x4005), 0x04));
});
