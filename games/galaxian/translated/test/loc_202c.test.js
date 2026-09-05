// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_202c (Galaxian slot dispatch, ROM 0x202c-0x203c):
//   202c  32 a1 40  ld (0x40a1),a     ; store advanced pointer
//   202f  7b        ld a,e
//   2030  21 3d 20  ld hl,0x203d      ; jump-table base
//   2033  09        add hl,bc         ; index
//   2034  5e        ld e,(hl)         ; target low
//   2035  23        inc hl
//   2036  56        ld d,(hl)         ; target high
//   2037  21 0a 20  ld hl,0x200a      ; handler return
//   203a  e5        push hl
//   203b  eb        ex de,hl
//   203c  e9        jp (hl)           ; -> table target
// Contract (A=0x9a, BC=0, table[0x203d]=0x2055): 87 T, 0x40a1<-0x9a, push 0x200a, dispatch to 0x2055.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_202c } from "../loc_202c.js";

function mk(rom, stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(rom, routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function romWithTable() {
  const rom = new Uint8Array(0x4000);
  rom[0x203d] = 0x55; rom[0x203e] = 0x20; // table[0] -> 0x2055
  return rom;
}

function checkSpec(m, ret) {
  assert.equal(m.cycles, 87, "T-state total (13+4+10+11+7+6+7+10+11+4+4)");
  assert.deepEqual(m.calls, [0x2055], "computed dispatch to table target 0x2055");
  assert.equal(ret, "TAIL", "the dispatched handler result propagates");
  assert.equal(m.mem.read8(0x40a1), 0x9a, "advanced slot pointer stored");
  assert.equal(m.regs.hl, 0x2055, "HL = dispatch target after ex de,hl");
  assert.equal(m.regs.de, 0x200a, "DE = the pushed return address");
  assert.equal(m.regs.sp, 0x43fe, "SP dropped by 2 for the pushed return");
  assert.equal(m.mem.read8(0x43fe), 0x0a, "return low byte pushed");
  assert.equal(m.mem.read8(0x43ff), 0x20, "return high byte pushed");
}

test("loc_202c: stores pointer, table-dispatches to 0x2055; 87 T", () => {
  const m = mk(romWithTable(), { 0x2055: "tail" });
  m.regs.sp = 0x4400; // push16 lands in work RAM
  m.regs.a = 0x9a; m.regs.e = 0x11; m.regs.bc = 0x0000;
  checkSpec(m, loc_202c(m));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_202c.js
//   find: regs.hl = 0x200a;
//   repl: regs.hl = 0x200b;
//   expect: FAIL  (wrong return address pushed, caught by DE == 0x200a and mem[0x43fe] == 0x0a)
test("loc_202c: the contract catches a wrong handler return address", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8(0x40a1, regs.a); m.step(0x202f, 13);
    regs.a = regs.e; m.step(0x2030, 4);
    regs.hl = 0x203d; m.step(0x2033, 10);
    regs.addHl(regs.bc); m.step(0x2034, 11);
    regs.e = mem.read8(regs.hl); m.step(0x2035, 7);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x2036, 6);
    regs.d = mem.read8(regs.hl); m.step(0x2037, 7);
    regs.hl = 0x200b; m.step(0x203a, 10); // MUTANT
    m.push16(regs.hl); m.step(0x203b, 11);
    regs.exDeHl(); m.step(0x203c, 4);
    const target = regs.hl; m.step(target, 4);
    return m.call(target);
  };
  const m = mk(romWithTable(), { 0x2055: "tail" });
  m.regs.sp = 0x4400; m.regs.a = 0x9a; m.regs.e = 0x11; m.regs.bc = 0x0000;
  assert.throws(() => checkSpec(m, mutant(m)));
});
