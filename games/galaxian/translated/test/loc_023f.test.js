// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_023f (ROM 0x023f-0x0266): rst-0x28 state handler. Four subsystem calls
// (0x0363,0x0bbe,0x0cc3,0x0367) then a two-phase countdown on the 0x4008/0x4009 timer pair. Full-run
// contract (both phases expire): 222 T, calls [0x0363,0x0bbe,0x0cc3,0x0367,0x0341]; phase 1 reloads
// (0x4008)=0xd2 and bumps 0x4241 (the ex-de-hl pair preserves the 0x4009 ptr across that inc), phase 2
// reloads (0x4009)=0xd2, advances the state index (0x400a), and clears 0x4058.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_023f } from "../loc_023f.js";

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
const pop = (mm) => { mm.pop16(); };
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];

test("loc_023f: both phases expire -> bump 0x4241, advance state, clear 0x4058; 222 T", () => {
  const m = mk({ 0x0363: pop, 0x0bbe: pop, 0x0cc3: pop, 0x0367: pop, 0x0341: pop });
  m.push16(0x9999);
  wr(m, 0x4008, 0x01);   // phase-1 timer -> 0 on dec
  wr(m, 0x4009, 0x01);   // phase-2 timer -> 0 on dec
  wr(m, 0x4241, 0x10);
  wr(m, 0x400a, 0x05);   // state index
  wr(m, 0x4058, 0xff);
  loc_023f(m);

  assert.equal(m.cycles, 222, "full-run T total (both ret nz fall through)");
  assert.deepEqual(m.calls, [0x0363, 0x0bbe, 0x0cc3, 0x0367, 0x0341], "4 subsystems then 0x0341");
  assert.equal(rd(m, 0x4008), 0xd2, "phase-1 reload (0x4008)=0xd2");
  assert.equal(rd(m, 0x4009), 0xd2, "phase-2 reload (0x4009)=0xd2");
  assert.equal(rd(m, 0x4241), 0x11, "inc (0x4241) via the ex-de-hl-preserved ptr");
  assert.equal(rd(m, 0x400a), 0x06, "inc (0x400a) advanced the state index");
  assert.equal(rd(m, 0x4058), 0x00, "ld (0x4058),a cleared it");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_023f: phase-1 timer not yet 0 -> ret nz after the 4 calls", () => {
  const m = mk({ 0x0363: pop, 0x0bbe: pop, 0x0cc3: pop, 0x0367: pop });
  m.push16(0x9999);
  wr(m, 0x4008, 0x03);   // dec -> 2, nonzero
  wr(m, 0x400a, 0x05);
  loc_023f(m);
  assert.deepEqual(m.calls, [0x0363, 0x0bbe, 0x0cc3, 0x0367], "no 0x0341 -- ret nz before the phase-1 body");
  assert.equal(rd(m, 0x4008), 0x02, "timer decremented, not reloaded");
  assert.equal(rd(m, 0x400a), 0x05, "state index unchanged");
  assert.equal(m.cycles, 100, "4*call 68 + ld hl 10 + dec(hl) 11 + ret nz taken 11");
  assert.equal(m.pc, 0x9999);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_023f.js
//   find: regs.exDeHl();\n  m.step(0x025c, 4); // HL=0x4009 again
//   repl: m.step(0x025c, 4); (drop the second ex de,hl -- HL stays 0x4241)
//   expect: FAIL (dec targets 0x4241 not 0x4009 -> ret nz taken, state index never advances; 0x400a stays 0x05)
test("loc_023f: the contract catches a dropped second `ex de,hl` (dec hits the wrong cell)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(0x0242); m.step(0x0363, 17); m.call(0x0363);
    m.push16(0x0245); m.step(0x0bbe, 17); m.call(0x0bbe);
    m.push16(0x0248); m.step(0x0cc3, 17); m.call(0x0cc3);
    m.push16(0x024b); m.step(0x0367, 17); m.call(0x0367);
    regs.hl = 0x4008; m.step(0x024e, 10);
    regs.decMem8(mem, regs.hl); m.step(0x024f, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x0250, 5);
    mem.write8(regs.hl, 0xd2); m.step(0x0252, 10);
    regs.l = regs.inc8(regs.l); m.step(0x0253, 4);
    m.push16(0x0256); m.step(0x0341, 17); m.call(0x0341);
    regs.exDeHl(); m.step(0x0257, 4);
    regs.hl = 0x4241; m.step(0x025a, 10);
    regs.incMem8(mem, regs.hl); m.step(0x025b, 11);
    m.step(0x025c, 4); // MUTANT: dropped the second `ex de,hl` -- HL stays 0x4241
    regs.decMem8(mem, regs.hl); m.step(0x025d, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x025e, 5);
    mem.write8(regs.hl, 0xd2); m.step(0x0260, 10);
    regs.l = regs.inc8(regs.l); m.step(0x0261, 4);
    regs.incMem8(mem, regs.hl); m.step(0x0262, 11);
    regs.xor(regs.a); m.step(0x0263, 4);
    mem.write8(0x4058, regs.a); m.step(0x0266, 13);
    m.ret();
  };
  const m = mk({ 0x0363: pop, 0x0bbe: pop, 0x0cc3: pop, 0x0367: pop, 0x0341: pop });
  m.push16(0x9999);
  wr(m, 0x4008, 0x01); wr(m, 0x4009, 0x01); wr(m, 0x4241, 0x10); wr(m, 0x400a, 0x05); wr(m, 0x4058, 0xff);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x400a), 0x06));
});
