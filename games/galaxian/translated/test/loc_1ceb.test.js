// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1ceb (Galaxian draw loop, ROM 0x1ceb-0x1cf5):
//   exx / ld a,(de) / sub 0x30 / ld (hl),a / inc de / add hl,bc / exx / djnz 0x1ceb / ret
// For B chars: (dest) = (src)-0x30, src++, dest += BC'(0xffe0 = -0x20). Contract with B=2, shadow
// DE'=0x4200 (src), HL'=0x5040 (VRAM dest), BC'=0xffe0: writes 0x05 at 0x5040 then 0x06 at 0x5020
// (dest stepped up one column), B->0, rets; 123 T, no m.call.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1ceb } from "../loc_1ceb.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) routines.set(Number(a), () => k);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// Shadow bank holds the pointers/stride the loop runs on; main bank holds only the B counter + ret slot.
function run(fn) {
  const m = mk();
  m.mem.write8(0x4200, 0x35); m.mem.write8(0x4201, 0x36); // source '5','6'
  m.regs.de = 0x4200; m.regs.hl = 0x5040; m.regs.bc = 0xffe0;
  m.regs.exx(); // move pointers/stride into the shadow bank
  m.regs.b = 0x02;
  m.regs.sp = 0x4400; m.push16(0xbeef); // ret target
  fn(m);
  return { cycles: m.cycles, calls: m.calls, b: m.regs.b, pc: m.pc,
    d5040: m.mem.read8(0x5040), d5020: m.mem.read8(0x5020) };
}

function checkSpec(res) {
  assert.equal(res.cycles, 123, "T-state total (59 taken iter + 54 final iter + 10 ret)");
  assert.deepEqual(res.calls, [], "no transfer -- the loop rets");
  assert.equal(res.d5040, 0x05, "(0x5040) = '5'(0x35) - 0x30");
  assert.equal(res.d5020, 0x06, "(0x5020) = '6'(0x36) - 0x30, one column up (dest += -0x20)");
  assert.equal(res.b, 0x00, "B counted down to 0");
  assert.equal(res.pc, 0xbeef, "ret to caller");
}

test("loc_1ceb: draws B tile codes up a VRAM column and rets; 123 T", () => {
  checkSpec(run(loc_1ceb));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1ceb.js
//   find: regs.sub(0x30);\n    m.step(0x1cef, 7); // sub 0x30 -- '0'.. -> tile code
//   repl: regs.sub(0x20);\n    m.step(0x1cef, 7); // sub 0x30
//   expect: FAIL  ((0x5040)=0x15 not 0x05; caught by the VRAM asserts)
//   verified-anchor: count == 1  (the sole "regs.sub(0x30)" in loc_1ceb.js)
test("loc_1ceb: the contract catches a wrong ASCII bias", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.exx(); m.step(0x1cec, 4);
      regs.a = mem.read8(regs.de); m.step(0x1ced, 7);
      regs.sub(0x20); m.step(0x1cef, 7); // MUTANT: wrong bias
      mem.write8(regs.hl, regs.a); m.step(0x1cf0, 7);
      regs.de = (regs.de + 1) & 0xffff; m.step(0x1cf1, 6);
      regs.addHl(regs.bc); m.step(0x1cf2, 11);
      regs.exx(); m.step(0x1cf3, 4);
      if (regs.djnz() !== 0) { m.step(0x1ceb, 13); continue; }
      m.step(0x1cf5, 8); break;
    }
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
