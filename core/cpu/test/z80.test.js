// SPDX-License-Identifier: GPL-3.0-only
/**
 * Generic Z80 CPU-core tests.
 *
 * These test core/cpu/z80.js directly -- the Regs class and its ALU/flag/shift
 * primitives -- with no DK ROM boot or translated routine as the subject. A few
 * construct a Machine only to obtain a mapped AddressSpace for a memory-touching
 * primitive (incMem8/decMem8, cpi/cpir); the subject under test is still the CPU
 * helper. Moved verbatim from games/dkong/test/boot.test.js.
 * Run: node --test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Regs, F_C, F_H, F_N, F_PV, F_S, F_Z } from "../z80.js";
import { Machine } from "../../../games/dkong/machine.js";

// The ROM image is copyright and not committed, so it is absent on a fresh
// public clone. Guard the load: a couple of tests build a Machine only to get a
// mapped AddressSpace; skip just those when the ROM is missing (the pure Regs
// tests below need no ROM and always run) rather than crashing at import time.
const ROM_PATH = new URL("../../../games/dkong/rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const romTest = ROM_PRESENT
  ? test
  : (name, fn) => test(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

test("dec8 wraps 0x00 -> 0xFF and sets NZ (the 256-iteration loop)", () => {
  // Boot's inner clear loop enters with C=0 and relies on this to run 256
  // times. If dec8 clamped instead of wrapping, boot would clear 16 bytes.
  const r = new Regs();
  const res = r.dec8(0x00);
  assert.equal(res, 0xff);
  assert.ok(r.fNZ, "0x00 - 1 must not set Z");
  assert.equal(r.dec8(0x01), 0x00);
  assert.ok(r.fZ);
});

test("inc/dec do not disturb carry", () => {
  const r = new Regs();
  r.f |= F_C;
  r.inc8(0x7f);
  assert.ok(r.fC, "INC must leave carry alone");
  r.dec8(0x01);
  assert.ok(r.fC, "DEC must leave carry alone");
});

romTest("incMem8/decMem8 do the RMW AND set flags -- the (ix+d) flag-drop the helper exists for", () => {
  // The shared primitive for `inc (ix+d)` / `dec (ix+d)`. The whole reason it is
  // a method: the open-coded `mem.write8(a, (v-1)&0xff)` gives the right VALUE
  // but drops S/Z/H/PV, and sub_32d6 does `dec (ix+0x1c)` then `jp nz` on the Z.
  const m = new Machine(ROM);
  const { regs, mem } = m;

  // dec (ix+0x1c) to ZERO must set Z (so a following `jp nz` would NOT jump):
  regs.ix = 0x6900;
  mem.write8(0x691c, 0x01);
  const r0 = regs.decMem8(mem, (regs.ix + 0x1c) & 0xffff);
  assert.equal(r0, 0x00, "returns the decremented value");
  assert.equal(mem.read8(0x691c), 0x00, "memory written back");
  assert.ok(regs.fZ, "dec to 0 sets Z -- the flag a bare mask would drop (sub_32d6 jp nz reads it)");

  // dec to NON-zero must clear Z (a following `jp nz` WOULD jump):
  mem.write8(0x691c, 0x03);
  regs.decMem8(mem, 0x691c);
  assert.equal(mem.read8(0x691c), 0x02, "decremented");
  assert.ok(regs.fNZ, "dec to non-zero leaves NZ");

  // carry is preserved by the RMW (Z80 inc/dec never touch C):
  regs.f |= F_C;
  mem.write8(0x691c, 0x05);
  regs.decMem8(mem, 0x691c);
  assert.ok(regs.fC, "decMem8 preserves carry");

  // inc (hl) wrap 0xFF -> 0x00 sets Z, and the same method serves (hl):
  regs.hl = 0x6a00;
  mem.write8(0x6a00, 0xff);
  const r1 = regs.incMem8(mem, regs.hl);
  assert.equal(r1, 0x00, "0xFF + 1 wraps to 0x00");
  assert.equal(mem.read8(0x6a00), 0x00, "written back");
  assert.ok(regs.fZ, "inc wrap to 0 sets Z");
  // MUTATION this stands in for: open-coding the RMW as `(v±1)&0xff` -- the
  // memory would still be right, but fZ/fNZ would carry a stale value and every
  // `jp nz`/`jp z` reading a dec/inc (ix+d) result would mis-branch.
});

test("add wraps at 8 bits and sets carry", () => {
  const r = new Regs();
  r.a = 0xff;
  r.add(0x01);
  assert.equal(r.a, 0x00);
  assert.ok(r.fC);
  assert.ok(r.fZ);
});

test("daa corrects BCD after add (the score uses it)", () => {
  const r = new Regs();
  r.a = 0x09;
  r.add(0x01); // 0x0A, not valid BCD
  r.daa();
  assert.equal(r.a, 0x10, "9 + 1 in BCD is 0x10");

  r.a = 0x99;
  r.add(0x01);
  r.daa();
  assert.equal(r.a, 0x00, "99 + 1 in BCD wraps to 00");
  assert.ok(r.fC, "...with carry out");
});

test("cp sets flags without changing A", () => {
  const r = new Regs();
  r.a = 0x64;
  r.cp(0x64);
  assert.equal(r.a, 0x64);
  assert.ok(r.fZ);
  assert.ok(r.fNC);
  r.cp(0x65);
  assert.ok(r.fC, "0x64 < 0x65 must set carry");
});

test("16-bit register pairs alias their halves", () => {
  const r = new Regs();
  r.hl = 0x1234;
  assert.equal(r.h, 0x12);
  assert.equal(r.l, 0x34);
  r.l = 0xff;
  assert.equal(r.hl, 0x12ff);
});

test("bit n,r sets Z/H, preserves carry, and does not change the operand", () => {
  // The NMI's `bit 6,a` and sub_0315's `bit 4,b` were open-coded as
  // `(reg & mask) !== 0`, which silently skipped every flag effect. Harmless
  // only until an instruction lands between the test and its flag consumer.
  const r = new Regs();
  r.f = F_C;
  assert.equal(r.bit(6, 0x40), true);
  assert.ok(r.fNZ, "bit set -> Z clear");
  assert.ok(r.fC, "carry preserved");
  assert.equal(r.bit(4, 0x00), false);
  assert.ok(r.fZ, "bit clear -> Z set");
  assert.ok(r.fC, "carry still preserved");
});

test("neg is 0 - A with Z80 flags, including the 0x80 overflow case", () => {
  // Ships ahead of its caller (ROM 0x0DD1, not yet translated), so nothing
  // else exercises it. An unexercised helper in a commit whose own thesis is
  // "latent bug behind a passing test" deserves the test now, not later.
  const r = new Regs();
  for (const [a, want] of [[0x00, 0x00], [0x01, 0xff], [0x80, 0x80], [0xff, 0x01]]) {
    r.a = a;
    r.neg();
    assert.equal(r.a, want, `neg(0x${a.toString(16)})`);
    assert.equal(r.fC, a !== 0, "carry is set iff A was non-zero");
    assert.equal(r.fZ, a === 0, "zero iff A was zero");
  }
  // PV is the signed-overflow case and 0x80 is the only value that has it:
  // -(-128) is not representable in 8 bits.
  r.a = 0x80; r.neg();
  assert.ok(r.fPE, "neg(0x80) must set PV");
  r.a = 0x01; r.neg();
  assert.ok(!r.fPE, "neg(0x01) must not");
});

test("rl r sets the full flag set; H and N are CLEARED, not left stale", () => {
  // The whole reason `rl` exists as a separate method from `rla`. A review
  // verified these exhaustively by hand, and NOTHING IN THE SUITE PINNED
  // THEM -- setting H in the implementation left all 47 tests green, which
  // is the same unguarded-helper shape as the missing cycle assertions.
  //
  // Z80 RL r: S,Z from the result; H=0; PV=parity; N=0; C=bit 7 of the input.
  const r = new Regs();

  // Pre-load F with everything set, so a stale-flag bug is visible rather
  // than masked by a conveniently-zero starting state.
  r.f = 0xff;
  const out = r.rl(0x01); // carry-in was 1 (F=0xff), so 0x01 -> 0x03
  assert.equal(out, 0x03);
  assert.ok(!(r.f & F_H), "H must be cleared");
  assert.ok(!(r.f & F_N), "N must be cleared");
  assert.ok(!r.fC, "bit 7 of 0x01 is 0, so carry out is 0");

  r.f = 0;
  assert.equal(r.rl(0x80), 0x00, "0x80 with no carry-in rotates to 0");
  assert.ok(r.fC, "bit 7 of 0x80 is 1");
  assert.ok(r.fZ, "result is zero");
  assert.ok(r.fPE, "0x00 has even parity");

  r.f = 0;
  assert.equal(r.rl(0x40), 0x80);
  assert.ok(!r.fC);
  assert.ok(r.fM, "0x80 is negative");

  // And the contrast that motivates the split: `rla` PRESERVES S/Z/PV.
  r.f = F_Z | F_S | F_PV;
  r.a = 0x01;
  r.rla();
  assert.ok(r.fZ && r.fM && r.fPE, "rla must preserve S, Z and PV");
});

test("daa matches MAME 0.288 exhaustively -- including the N=1 branch, which has never executed", () => {
  // WHY EXHAUSTIVE, AND WHY NOW. `daa` at ROM 0x06B1 follows `sub 0x01`, so it
  // runs with N=1. Every daa the translation has ever executed came after an
  // `add` or `adc` (N=0) -- state0.js:779 and ROM 0x0530 -- so cpu.js's N=1
  // branch and its H recompute are IMPLEMENTED AND UNRUN. That is the
  // `ld (ix+d),n` shape one level down: the instruction is decoded correctly
  // and the SEMANTICS are the exposure. Pinned before 0x062A is wired, not
  // after, because afterwards a red would have two candidate causes.
  //
  // The expected values are a port of MAME 0.288 z80.cpp:309 `daa()` plus the
  // flag accessors at z80.h:191-200 -- NOT from cpu.js: a test must not
  // draw its expected value from the code under test. Same build that
  // produces our golden, so this is the spec the gate measures against.
  //
  // MAME's H for daa is `h_val = A ^ a`, i.e. bit 4 of (input XOR result) --
  // a different formulation from cpu.js's nibble tests. Their agreement over
  // all 2048 cases is the real content here; one of them being readable is not
  // evidence the other is right.
  //
  // Mutation-tested when written, so a clean run means something: N=1 subtract
  // flipped to add -> 924 mismatches; H term dropped from the N=1 recompute ->
  // 192; carry made non-sticky -> 616.
  const mameDaa = (A, n, h, c) => {
    let a = A;
    if (n) {
      if (h || (A & 0xf) > 9) a = (a - 6) & 0xff;
      if (c || A > 0x99) a = (a - 0x60) & 0xff;
    } else {
      if (h || (A & 0xf) > 9) a = (a + 6) & 0xff;
      if (c || A > 0x99) a = (a + 0x60) & 0xff;
    }
    let pv = a;
    pv ^= pv >> 4;
    pv ^= (pv << 2) & 0xff;
    pv ^= pv >> 1;
    return {
      a,
      S: (a & 0x80) !== 0,
      Z: a === 0,
      H: ((A ^ a) & 0x10) !== 0, // z80.h:184 -- bit 4, others don't care
      PV: (~pv & 0x04) !== 0,
      N: !!n, // z80.cpp:324 "keep N"
      C: !!(c || A > 0x99), // sticky: OR of incoming carry
    };
  };

  let n1 = 0;
  for (let A = 0; A < 256; A++) {
    for (let fb = 0; fb < 8; fb++) {
      const n = fb & 1, h = (fb >> 1) & 1, c = (fb >> 2) & 1;
      if (n) n1++;
      const r = new Regs();
      r.a = A;
      r.f = (n ? F_N : 0) | (h ? F_H : 0) | (c ? F_C : 0);
      r.daa();
      const want = mameDaa(A, n, h, c);
      const got = {
        a: r.a, S: !!(r.f & F_S), Z: !!(r.f & F_Z), H: !!(r.f & F_H),
        PV: !!(r.f & F_PV), N: !!(r.f & F_N), C: !!(r.f & F_C),
      };
      assert.deepEqual(
        got, want,
        `daa A=0x${A.toString(16)} N=${n} H=${h} C=${c}`,
      );
    }
  }
  assert.equal(n1, 1024, "half the cases must exercise the N=1 branch");
});

test("CB shifts rlc/sla/sra/srl/rr match MAME 0.288 exhaustively, all 256 x carry", () => {
  // sub_239c executes `sla a` (CB 0x27); none of these four existed in cpu.js
  // (only rlca/rrca/rla/rra/rl did), so this pins them before that routine is
  // translated -- the daa discipline applied to a whole instruction group.
  //
  // Expected values are a port of MAME 0.288 z80.cpp (sla:467, sra:483,
  // srl:515, rr:451) plus the flag accessors at z80.h:191-200, NOT from cpu.js.
  // All four share MAME's shape: S/Z/PV/F3/F5 from the result, H=N=0,
  // C from the bit shifted out; rr and sra also read state (carry / sign).
  //
  // The pairs that are one bit apart and easy to swap are the point of an
  // EXHAUSTIVE sweep: sra preserves bit 7 where srl clears it (differ only on
  // negative inputs), and rr feeds the old carry into bit 7 where srl feeds 0.
  const yx = (r) => r & 0x28; // F3 | F5, taken from the result (yx_val = res)
  const par = (r) => { let p = r ^ (r >> 4); p ^= p >> 2; p ^= p >> 1; return p & 1 ? 0 : F_PV; };
  const flags = (r, c) => (r & 0x80 ? F_S : 0) | (r === 0 ? F_Z : 0) | par(r) | yx(r) | (c ? F_C : 0);

  const ops = {
    rlc: (v) => { const r = ((v << 1) | (v >> 7)) & 0xff; return { r, f: flags(r, v & 0x80) }; },
    sla: (v) => { const r = (v << 1) & 0xff; return { r, f: flags(r, v & 0x80) }; },
    sra: (v) => { const r = ((v >> 1) | (v & 0x80)) & 0xff; return { r, f: flags(r, v & 1) }; },
    srl: (v) => { const r = (v >> 1) & 0xff; return { r, f: flags(r, v & 1) }; },
    rr: (v, cin) => { const r = ((v >> 1) | (cin ? 0x80 : 0)) & 0xff; return { r, f: flags(r, v & 1) }; },
  };

  for (const [name, want] of Object.entries(ops)) {
    for (let v = 0; v < 256; v++) {
      for (const cin of [0, 1]) {
        const regs = new Regs();
        regs.f = cin ? F_C : 0;
        const got = regs[name](v);
        const exp = want(v, cin);
        assert.equal(got, exp.r, `${name}(0x${v.toString(16)}) cin=${cin} value`);
        // H and N must be CLEARED, not left stale -- assert positively
        assert.equal(regs.f & F_H, 0, `${name} clears H`);
        assert.equal(regs.f & F_N, 0, `${name} clears N`);
        assert.equal(regs.f, exp.f, `${name}(0x${v.toString(16)}) cin=${cin} flags`);
      }
    }
  }
});

test("bit n,r and bit n,(ix+d) differ ONLY in the F3/F5 source -- both pinned vs MAME", () => {
  // THE REGRESSION TRAP: the fix for the indexed form changes a
  // helper every `bit n,r` site already calls. Pin the REGISTER form FIRST so
  // a compensating error -- indexed right, register wrong -- cannot read clean
  // across a probe spanning both. Two pinned cases, expected values from MAME
  // 0.288 source (z80.cpp:531 `bit`, :555 `bit_xy`), never from cpu.js.
  //
  //   bit n,r        yx_val = value        (the operand)
  //   bit n,(ix+d)   yx_val = m_ea >> 8    (the effective-address high byte)
  //
  // Everything else is identical: Z/PV = !bit, H = 1, N = 0, C preserved,
  // S = bit 7 only when testing bit 7. F3/F5 are observable only via `push af`,
  // which entry_2913 never does -- pinned anyway, because the next indexed
  // `bit` that DOES push af inherits this silently (lead).
  const expect = (n, value, yxFrom, cIn) => {
    const set = (value & (1 << n)) !== 0;
    return (
      (cIn ? F_C : 0) |
      F_H |
      (set ? 0 : F_Z | F_PV) |
      (n === 7 && set ? F_S : 0) |
      (yxFrom & 0x28) /* F3 | F5 */
    );
  };

  for (let value = 0; value < 256; value++) {
    for (let n = 0; n < 8; n++) {
      for (const cIn of [0, 1]) {
        // register form: F3/F5 from the value
        let r = new Regs();
        r.f = cIn ? F_C : 0;
        const gotR = r.bit(n, value);
        assert.equal(gotR, (value & (1 << n)) !== 0, `bit ${n},r=0x${value.toString(16)} result`);
        assert.equal(r.f, expect(n, value, value, cIn), `bit ${n},r=0x${value.toString(16)} cin=${cIn} flags`);
        assert.equal(r.f & F_H, F_H, "bit sets H");
        assert.equal(r.f & F_N, 0, "bit clears N");

        // indexed form: F3/F5 from an address high byte UNRELATED to the value,
        // chosen so a helper that ignored yxFrom would visibly disagree.
        const addrHi = value ^ 0x28; // flips exactly F3|F5 (0x28) vs the value
        r = new Regs();
        r.f = cIn ? F_C : 0;
        const gotX = r.bit(n, value, addrHi);
        assert.equal(gotX, (value & (1 << n)) !== 0, `bit ${n},(ix+d) result`);
        assert.equal(r.f, expect(n, value, addrHi, cIn), `bit ${n},(ix+d) v=0x${value.toString(16)} cin=${cIn} flags`);
      }
    }
  }
});

test("adc/sbc carry-in path matches MAME 0.288 exhaustively -- the branch that has never run", () => {
  // code2 flagged that cpu.js's add(v, carryIn)/sub(v, carryIn) has only ever
  // been called with carryIn = 0: every adc/sbc executed so far happened to
  // have carry clear. sub_239c changes that -- it runs `adc a,(ix+0x10)` at
  // 0x23A8 and `sbc a,(ix+0x12)` at 0x23B8, so translating it executes the
  // carry-in branch for the first time. Pinned here BEFORE it lands, the daa
  // and CB-shift discipline applied to the arithmetic carry path.
  //
  // Expected values are ported from MAME 0.288 z80.cpp adc_a(:246) and
  // sbc_a(:281), NOT from cpu.js. The full input space is swept:
  // 256 A x 256 operand x carry-in, both ops -- 393,216 cases, because the
  // carry-in changes H (nibble boundary) and C (byte boundary) at inputs a
  // sparse test would miss.
  const yx = (r) => r & 0x28;
  const par = (r) => { let p = r ^ (r >> 4); p ^= p >> 2; p ^= p >> 1; return p & 1 ? 0 : F_PV; };

  const mameAdc = (A, v, c) => {
    const res = A + v + c;
    const r = res & 0xff;
    return (r & 0x80 ? F_S : 0) | (r === 0 ? F_Z : 0) | yx(r) |
      (res & 0x100 ? F_C : 0) |
      (((A & 0x0f) + (v & 0x0f) + c) & 0x10 ? F_H : 0) |
      (~(A ^ v) & (A ^ r) & 0x80 ? F_PV : 0); // signed overflow
  };
  const mameSbc = (A, v, c) => {
    const res = A - v - c;
    const r = res & 0xff;
    return (r & 0x80 ? F_S : 0) | (r === 0 ? F_Z : 0) | yx(r) | F_N |
      (res & 0x100 ? F_C : 0) |
      (((A & 0x0f) - (v & 0x0f) - c) & 0x10 ? F_H : 0) |
      ((A ^ v) & (A ^ r) & 0x80 ? F_PV : 0); // signed overflow
  };

  let sawC1 = 0;
  for (let A = 0; A < 256; A++) {
    for (let v = 0; v < 256; v++) {
      for (const c of [0, 1]) {
        if (c) sawC1++;
        // adc
        let regs = new Regs();
        regs.a = A;
        regs.f = c ? F_C : 0;
        regs.adc(v);
        assert.equal(regs.a, (A + v + c) & 0xff, `adc a=${A} v=${v} c=${c} result`);
        assert.equal(regs.f, mameAdc(A, v, c), `adc a=${A} v=${v} c=${c} flags`);
        // sbc
        regs = new Regs();
        regs.a = A;
        regs.f = c ? F_C : 0;
        regs.sbc(v);
        assert.equal(regs.a, (A - v - c) & 0xff, `sbc a=${A} v=${v} c=${c} result`);
        assert.equal(regs.f, mameSbc(A, v, c), `sbc a=${A} v=${v} c=${c} flags`);
      }
    }
  }
  assert.equal(sawC1, 65536, "half the cases must exercise carry-in = 1");
});

test("res n,r and set n,r modify one bit and LEAVE ALL FLAGS UNCHANGED -- vs MAME", () => {
  // entry_3009 runs `res 2,d` at 0x3043, and cpu.js had neither res nor set
  // (only bit). These are CB 0x80-0xBF / 0xC0-0xFF and MAME (z80.cpp:567/575)
  // implements them as value & ~(1<<n) / value | (1<<n) with NO m_f access.
  //
  // THE FLAG-PRESERVATION IS THE LOAD-BEARING PROPERTY, not the bit math. At
  // 0x3043 the `res 2,d` is followed by `dec d` whose flags the exit test
  // reads -- a res that touched a flag would corrupt that test while leaving D
  // correct, the compensating-error shape a memory diff cannot see. So the
  // whole flag word is asserted UNCHANGED across every possible starting flag
  // state, not just "no crash". The value is checked against MAME's formula,
  // never against cpu.js.
  const F_ALL = F_S | F_Z | F_H | F_PV | F_N | F_C | 0x28; // every documented + F3/F5 bit
  for (let value = 0; value < 256; value++) {
    for (let n = 0; n < 8; n++) {
      // sweep a spread of incoming flag words, including all-set and all-clear
      for (const fIn of [0x00, 0xff, F_ALL, F_C, F_Z | F_S, F_H | F_N, 0x28]) {
        let r = new Regs();
        r.f = fIn;
        const gotRes = r.res(n, value);
        assert.equal(gotRes, value & ~(1 << n) & 0xff, `res ${n},0x${value.toString(16)} value`);
        assert.equal(r.f, fIn, `res ${n} must not touch flags (in=0x${fIn.toString(16)})`);

        r = new Regs();
        r.f = fIn;
        const gotSet = r.set(n, value);
        assert.equal(gotSet, (value | (1 << n)) & 0xff, `set ${n},0x${value.toString(16)} value`);
        assert.equal(r.f, fIn, `set ${n} must not touch flags (in=0x${fIn.toString(16)})`);
      }
    }
  }
});

test("adc hl,rr sets S/Z/PV that add hl,rr preserves -- pinned vs MAME 0.288 adc_hl", () => {
  // ADC HL,rr (ED 4A/5A/6A/7A). The distinction that matters: `add hl,rr`
  // PRESERVES S/Z/PV; `adc hl,rr` SETS them. sub_342c relies on the Z.
  const r = new Regs();

  // The sub_342c idiom: xor a (clears C, A=0), ld bc,0, adc hl,bc -> zero-test HL.
  r.hl = 0x0000; r.f = 0; // carry clear
  r.adcHl(0x0000);
  assert.equal(r.hl, 0x0000, "0 + 0 + 0 = 0");
  assert.ok(r.fZ, "Z SET on a zero 16-bit result -- the branch sub_342c reads");
  assert.ok(!r.fC, "no carry out");

  r.hl = 0x3a8c; r.f = 0;
  r.adcHl(0x0000);
  assert.equal(r.hl, 0x3a8c, "non-zero HL unchanged by +0");
  assert.ok(r.fNZ, "Z CLEAR on a non-zero result");

  // carry-IN participates (this is ADC, not ADD)
  r.hl = 0x0000; r.f = F_C;
  r.adcHl(0x0000);
  assert.equal(r.hl, 0x0001, "carry-in is added");
  assert.ok(r.fNZ, "and the result is no longer zero");

  // sign, and carry OUT of bit 15
  r.hl = 0x7fff; r.f = 0;
  r.adcHl(0x0001);
  assert.equal(r.hl, 0x8000);
  assert.ok(r.fM, "S set from bit 15 (fM is the sign getter)");
  assert.ok(r.fPE, "PV set -- 0x7FFF + 1 overflows a signed 16-bit (fPE = parity/overflow set)");

  r.hl = 0xffff; r.f = 0;
  r.adcHl(0x0001);
  assert.equal(r.hl, 0x0000, "wraps to 0");
  assert.ok(r.fC, "carry OUT of bit 15");
  assert.ok(r.fZ, "and Z set on the zero result");

  // H is the carry out of bit 11
  r.hl = 0x0fff; r.f = 0;
  r.adcHl(0x0001);
  assert.equal(r.hl, 0x1000);
  assert.ok(r.f & F_H, "H set by the carry out of bit 11");

  // N is always cleared by ADC
  assert.ok(!(r.f & F_N), "N cleared");
});

test("sbcHl is NOT a sign-flipped adcHl -- it SETS N and uses a different overflow term", () => {
  // Pinned to mame0288 z80.lst:394: n=1 and the (dd^HL)&(HL^res) overflow term
  // both confirmed against the source.
  const r = new Regs();

  r.hl = 0x0000; r.f = 0; r.sbcHl(0x0000);
  assert.equal(r.hl, 0x0000);
  assert.ok(r.f & F_Z, "0-0 = 0 sets Z");
  assert.ok(r.f & F_N, "SBC SETS N -- the single most likely thing copied wrong from adcHl");
  assert.ok(!(r.f & F_C), "no borrow");

  r.hl = 0x0000; r.f = 0; r.sbcHl(0x0001);
  assert.equal(r.hl, 0xffff, "0-1 wraps");
  assert.ok(r.f & F_C, "borrow out");
  assert.ok(r.f & F_S, "S set from bit 15");

  r.hl = 0x0002; r.f = F_C; r.sbcHl(0x0001);
  assert.equal(r.hl, 0x0000, "carry-in participates: 2-1-1 = 0");
  assert.ok(r.f & F_Z);

  r.hl = 0x8000; r.f = 0; r.sbcHl(0x0001);
  assert.equal(r.hl, 0x7fff);
  assert.ok(r.f & F_PV, "PV on signed overflow (different-sign operands)");

  r.hl = 0x7fff; r.f = 0; r.sbcHl(0x0001);
  assert.ok(!(r.f & F_PV), "no PV when operands share a sign");
  // MUTATION-PATCH  file: src/cpu.js
  //   find: ((hl ^ v) & (hl ^ res) & 0x8000 ? F_PV : 0) |\n      F_N |
  //   repl: ((hl ^ v) & (hl ^ res) & 0x8000 ? F_PV : 0) |
  //   expect: FAIL  (drops N -- caught by "SBC SETS N")
  //   verified-anchor: count == 1 in src/cpu.js
  //
  // NB this is the anchor the mutation was VERIFIED with, not a prose
  // description of the edit. My first version of this block quoted
  // `F_N |\n      (r < 0 ? F_C : 0) |` -- a shorter form I re-derived while
  // writing it up rather than the one I injected. That form matches THREE
  // sites, so a runner applying it would have mutated three places. Same class
  // qa hit in its own draft: a mutation spec must carry the verified anchor,
  // because prose re-derives to a different anchor and the count silently
  // changes.
});

romTest("cpi PRESERVES carry, takes S/Z raw and F3/F5 from an H-ADJUSTED result", () => {
  // Verified against z80.lst:457: the literal "// keep C", S/Z from the
  // unadjusted result, and `if (h()) res -= 1` BEFORE yx_val. NOTE: 0x4000 is
  // UNMAPPED here and throws -- these cases run in work RAM (0x6A00).
  const m = new Machine(ROM);
  const r = m.regs, mem = m.mem;

  mem.write8(0x6a00, 0x42);
  r.hl = 0x6a00; r.bc = 0x0002; r.a = 0x42; r.f = F_C;
  r.cpi(mem);
  assert.ok(r.f & F_C, "cpi KEEPS carry (z80.lst:467) -- a compare must not eat the caller's C");
  assert.ok(r.f & F_Z, "match sets Z");
  assert.ok(r.f & F_N, "N set");
  assert.equal(r.hl, 0x6a01, "HL advanced");
  assert.equal(r.bc, 0x0001, "BC decremented");
  assert.ok(r.f & F_PV, "PV set while BC != 0");

  r.hl = 0x6a00; r.bc = 0x0001; r.a = 0x00; r.f = 0; r.cpi(mem);
  assert.ok(!(r.f & F_PV), "PV clears exactly when BC hits 0");

  // cpir stops ON MATCH, not at BC exhaustion
  mem.write8(0x6a00, 0x11); mem.write8(0x6a01, 0x22); mem.write8(0x6a02, 0x33);
  r.hl = 0x6a00; r.bc = 0x0010; r.a = 0x33; r.f = 0;
  assert.equal(r.cpir(mem), 3, "cpir returns 3, stopping on the match");
  assert.equal(r.bc, 0x000d, "BC left past the match");
  assert.equal(r.hl, 0x6a03, "HL left past the match");

  // and stops at BC exhaustion when there is NO match
  r.hl = 0x6a00; r.bc = 0x0003; r.a = 0xff; r.f = 0;
  assert.equal(r.cpir(mem), 3, "exhausts BC");
  assert.equal(r.bc, 0, "BC drained");
  assert.ok(!(r.f & F_PV), "PV clear at exhaustion");
});

test("addIy writes IY and shares addIx's verified add16 path (destination is the hazard)", () => {
  const r = new Regs();
  r.iy = 0x1000; r.ix = 0x9999; r.f = 0; r.addIy(0x0234);
  assert.equal(r.iy, 0x1234, "addIy writes IY");
  assert.equal(r.ix, 0x9999, "and leaves IX untouched -- the copy hazard");

  r.iy = 0xffff; r.f = F_S | F_Z | F_PV | F_N; r.addIy(0x0001);
  assert.equal(r.iy, 0x0000);
  assert.ok(r.f & F_C, "carry-out on wrap");
  assert.ok((r.f & F_S) && (r.f & F_Z) && (r.f & F_PV), "PRESERVES S,Z,PV (add16 'keep szv')");
  assert.ok(!(r.f & F_N), "clears N");

  r.iy = 0x2000; r.f = 0; r.addIy(r.iy);
  assert.equal(r.iy, 0x4000, "add iy,iy doubles");
  // MUTATION-PATCH  file: src/cpu.js
  //   find: this.iy = this.add16(this.iy, v);
  //   repl: this.ix = this.add16(this.iy, v);
  //   expect: FAIL  (destination swap -- 4 assertions)
});
