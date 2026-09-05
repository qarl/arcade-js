// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_125e (ROM 0x125e-0x1291): deactivate the IX entry, scan 3 bands of (ix+7), then
// (with (0x422a)==2) fold the loc_1292 bonus into A/E and tail-jump 0x08f2. Contract for the exhaust+bonus
// path with (ix+7)=0x80: 299 T, calls [0x1292, 0x08f2], (0x422b/c)=0x01/0xf0, (0x422d)=bonus A, E folded.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_125e } from "../loc_125e.js";

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
// loc_1292 rets to 0x128a: pop the pushed return, and hand back a known bonus A.
const stub1292 = (mm) => { mm.pop16(); mm.regs.a = 0x05; };
const tail08f2 = () => "TAIL";

function setup(m) {
  m.regs.ix = 0x4300;
  m.mem.write8(0x4307, 0x80); // (ix+7) -- above 0x50 in every band -> loop exhausts
  m.mem.write8(0x422a, 0x02); // triggers the call z,0x1292
}

test("loc_125e: exhaust+bonus path folds A/E and tail-jumps 0x08f2; 299 T", () => {
  const m = mk({ 0x1292: stub1292, 0x08f2: tail08f2 });
  setup(m);
  const ret = loc_125e(m);
  assert.equal(m.cycles, 299, "sum of the exhaust+bonus-path T-states");
  assert.deepEqual(m.calls, [0x1292, 0x08f2], "call z 0x1292 then tail-jump 0x08f2");
  assert.equal(ret, "TAIL", "the tail-jump's result propagates");
  assert.equal(m.mem.read8(0x4300), 0x00, "(ix+0) cleared -- deactivated");
  assert.equal(m.mem.read8(0x4301), 0x01, "(ix+1) = 1");
  assert.equal(m.mem.read8(0x422b), 0x01, "(0x422b) low = 0x01");
  assert.equal(m.mem.read8(0x422c), 0xf0, "(0x422c) high = 0xf0");
  assert.equal(m.mem.read8(0x422d), 0x05, "(0x422d) = bonus A from loc_1292");
  assert.equal(m.regs.e, 0x0c, "E = bonus(0x05) + band E(0x07)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_125e.js
//   find: m.step(0x08f2, 10);\n  return m.call(0x08f2);   (the final tail-jump)
//   repl: m.step(0x08f3, 10);\n  return m.call(0x08f3);
//   expect: FAIL (wrong tail target; caught by calls == [0x1292, 0x08f2])
test("loc_125e: the contract catches a wrong final tail-jump target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8((regs.ix + 0x00) & 0xffff, 0x00); m.step(0x1262, 19);
    mem.write8((regs.ix + 0x01) & 0xffff, 0x01); m.step(0x1266, 19);
    mem.write8((regs.ix + 0x02) & 0xffff, 0x00); m.step(0x126a, 19);
    regs.de = 0x0304; m.step(0x126d, 10);
    regs.bc = 0x0350; m.step(0x1270, 10);
    regs.a = mem.read8((regs.ix + 0x07) & 0xffff); m.step(0x1273, 19);
    for (;;) {
      regs.cp(regs.c); m.step(0x1274, 4);
      if (regs.fC) { m.step(0x08f2, 10); return m.call(0x08f2); }
      m.step(0x1277, 10);
      regs.e = regs.inc8(regs.e); m.step(0x1278, 4);
      regs.sub(0x10); m.step(0x127a, 7);
      if (regs.djnz() !== 0) { m.step(0x1273, 13); continue; }
      m.step(0x127c, 8);
      break;
    }
    regs.hl = 0xf001; m.step(0x127f, 10);
    mem.write16(0x422b, regs.hl); m.step(0x1282, 16);
    regs.a = mem.read8(0x422a); m.step(0x1285, 13);
    regs.cp(0x02); m.step(0x1287, 7);
    if (regs.fZ) { m.push16(0x128a); m.step(0x1292, 17); m.call(0x1292); } else { m.step(0x128a, 10); }
    mem.write8(0x422d, regs.a); m.step(0x128d, 13);
    regs.add(regs.e); m.step(0x128e, 4);
    regs.e = regs.a; m.step(0x128f, 4);
    m.step(0x08f3, 10); // MUTANT: wrong tail target
    return m.call(0x08f3);
  };
  const m = mk({ 0x1292: stub1292, 0x08f2: tail08f2, 0x08f3: tail08f2 });
  setup(m);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x1292, 0x08f2]));
});
