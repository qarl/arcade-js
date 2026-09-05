// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0218 (ROM 0x0218-0x023e): rst-0x28 state handler; a two-phase countdown on the
// 0x4008/0x4009 timer pair. Full-run contract (both phases expire): 205 T, calls [0x0363,0x08f2,0x0010];
// on expiry it advances the state index (0x400a), reloads the timers to (0x4008)=0x20/(0x4009)=0x04, fills
// 0x42b0.. <- 0 (rst 0x10, B=0 => 256 bytes), clears 0x4241; E=(0x4009)+6 is the arg handed to 0x08f2.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0218 } from "../loc_0218.js";

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
const pop = (mm) => { mm.pop16(); };          // plain call/rst stub: balance the pushed return
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];

test("loc_0218: both phases expire -> advance state, reload timers, fill+clear; 205 T", () => {
  let eArg = null, fill = null;
  const m = mk({
    0x0363: pop,
    0x08f2: (mm) => { eArg = mm.regs.e; mm.pop16(); },
    0x0010: (mm) => { fill = { hl: mm.regs.hl, b: mm.regs.b, a: mm.regs.a }; mm.pop16(); },
  });
  m.push16(0x9999);
  wr(m, 0x4008, 0x01);        // phase-1 timer -> 0 on dec
  wr(m, 0x4009, 0x01);        // phase-2 timer -> 0 on dec (value 1 read before the dec)
  wr(m, 0x400a, 0x04);        // state index
  wr(m, 0x4241, 0xaa);
  wr(m, 0x42b0, 0xaa); wr(m, 0x43af, 0xaa);
  loc_0218(m);

  assert.equal(m.cycles, 205, "full-run T total (both ret nz fall through)");
  assert.deepEqual(m.calls, [0x0363, 0x08f2, 0x0010], "setup, 0x08f2, rst-0x10 fill");
  assert.equal(eArg, 0x07, "E = (0x4009)+6 handed to 0x08f2");
  assert.deepEqual(fill, { hl: 0x42b0, b: 0x00, a: 0x00 }, "rst 0x10 args: HL=0x42b0, B=0 (256), A=0");
  assert.equal(rd(m, 0x400a), 0x05, "inc (0x400a) advanced the state index");
  assert.equal(rd(m, 0x4008), 0x20, "ld (0x4008),hl reloaded the low byte");
  assert.equal(rd(m, 0x4009), 0x04, "ld (0x4008),hl reloaded the high byte");
  assert.equal(rd(m, 0x4241), 0x00, "ld (0x4241),a cleared it");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0218: phase-1 timer not yet 0 -> ret nz, no state change", () => {
  const m = mk({ 0x0363: pop });
  m.push16(0x9999);
  wr(m, 0x4008, 0x05);        // dec -> 4, nonzero
  wr(m, 0x400a, 0x04);
  loc_0218(m);
  assert.deepEqual(m.calls, [0x0363], "only the setup call ran before ret nz");
  assert.equal(rd(m, 0x4008), 0x04, "timer decremented, not reloaded");
  assert.equal(rd(m, 0x400a), 0x04, "state index unchanged");
  assert.equal(m.cycles, 49, "call 17 + ld hl 10 + dec(hl) 11 + ret nz taken 11");
  assert.equal(m.pc, 0x9999);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0218.js
//   find: regs.add(regs.d);
//   repl: (drop it -- E gets (0x4009) instead of (0x4009)+6)
//   expect: FAIL (eArg == 1 != 7; caught by the E-arg assert)
test("loc_0218: the contract catches a dropped `add a,d` (wrong 0x08f2 arg)", () => {
  let eArg = null;
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(0x021b); m.step(0x0363, 17); m.call(0x0363);
    regs.hl = 0x4008; m.step(0x021e, 10);
    regs.decMem8(mem, regs.hl); m.step(0x021f, 11);
    m.step(0x0220, 5);
    mem.write8(regs.hl, 0x50); m.step(0x0222, 10);
    regs.l = regs.inc8(regs.l); m.step(0x0223, 4);
    regs.d = 0x06; m.step(0x0225, 7);
    regs.a = mem.read8(regs.hl); m.step(0x0226, 7);
    m.step(0x0227, 4); // MUTANT: dropped `add a,d`
    regs.e = regs.a; m.step(0x0228, 4);
    m.push16(0x022b); m.step(0x08f2, 17); m.call(0x08f2);
    regs.decMem8(mem, regs.hl); m.step(0x022c, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x022d, 5);
    m.ret();
  };
  const m = mk({ 0x0363: pop, 0x08f2: (mm) => { eArg = mm.regs.e; mm.pop16(); } });
  m.push16(0x9999);
  wr(m, 0x4008, 0x01); wr(m, 0x4009, 0x01); wr(m, 0x400a, 0x04);
  mutant(m);
  assert.throws(() => assert.equal(eArg, 0x07));
});
