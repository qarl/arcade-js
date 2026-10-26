// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for binToPackedBcd (ROM 0x1131) — "binary count B -> packed BCD".
 * A=0, C=0, then B decimal-increments (add a,1; daa); each 99->00 rollover bumps C. On exit
 * A = B mod 100 (packed BCD) and C = B div 100. The djnz loop is exit-tested, so B=0 counts a
 * full 256 passes (A=0x56, C=2), not zero.
 *
 * binToPackedBcd touches NO memory, so the load-bearing contract is the RETURN, not RAM:
 *
 *     { a, hundreds }  ==  oracle's { regs.a, regs.c }
 *
 * The register input is B; both sides read it from regs.b (the module's sanctioned default). We
 * compare on FRESH, UN-BOOTED Machine clones: at power-on the LS259 NMI latch is clear, so the
 * oracle's T-state spend fires no NMI (and stays far under one frame), keeping RAM untouched on
 * both sides — a capture from a booted run would let the cycle-spending oracle drift an NMI the
 * clock-free module never spends. RAM (dumpState minus stack scratch below the entry SP) is asserted null as a guard
 * (neither side writes), and the return is asserted against the ORACLE clone's regs.
 *
 * Jobs:
 *   1. CRAFTED — every B across the wrap boundaries: a == oracle A, hundreds == oracle C, RAM clean.
 *   2. TEETH(a)        — a twin returning a wrong `a` MUST be caught by the return check.
 *   3. TEETH(hundreds) — a twin returning a wrong `hundreds` MUST be caught by the return check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1131.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1131 as oracle } from "../../translated/loc_1131.js";
import { binToPackedBcd } from "../binToPackedBcd.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh, un-booted machine with B seeded — nmiMask is clear, so the oracle fires no NMI. */
function craft(b) {
  const m = new Machine(ROM);
  m.regs.b = b & 0xff;
  return m;
}

// B values across the wrap boundaries: 0 (=256, double wrap), the two single-digit cases, the
// carry into the tens, the exact 99->00 wrap, and the two hundreds carries.
const CASES = [0, 1, 2, 9, 10, 55, 99, 100, 156, 199, 200, 255];

test("CRAFTED: every B — a == oracle A, hundreds == oracle C, RAM untouched", () => {
  for (const b of CASES) {
    const o = craft(b);
    const c = craft(b);
    oracle(o);
    const ret = binToPackedBcd(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `B=${b}: unexpected RAM write at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret.a, o.regs.a, `B=${b}: a ${hx(ret.a)} != oracle A ${hx(o.regs.a)}`);
    assert.equal(ret.hundreds, o.regs.c, `B=${b}: hundreds ${ret.hundreds} != oracle C ${o.regs.c}`);

    // Live-out SIDE EFFECT (the bridge): the module must SET the registers the frozen caller adjustCounterAndPaintBcdHudFields
    // reads out of the seam — A (0x1102 ld e,a) and C (0x1103 ld a,c) — not merely return them. A
    // return-only rewrite that never touches the registers passes the checks above but fails here.
    assert.equal(c.regs.a, o.regs.a, `B=${b}: module must SET A for the translated dispatch (${hx(c.regs.a)} != oracle ${hx(o.regs.a)})`);
    assert.equal(c.regs.c, o.regs.c, `B=${b}: module must SET C (hundreds) for the translated dispatch (${c.regs.c} != oracle ${o.regs.c})`);
  }
  console.log(`  CRAFTED: ${CASES.length} B values matched (packed BCD + hundreds)`);
});

test("CRAFTED: the hundreds carry is actually exercised (positive control)", () => {
  // Guard the teeth: at least one case must leave C != 0, else TEETH(hundreds) proves nothing.
  const anyHundreds = CASES.some((b) => { const o = craft(b); oracle(o); return o.regs.c !== 0; });
  assert.ok(anyHundreds, "no case reached a hundreds carry — the hundreds check is untested");
});

test("TEETH(a): a wrong packed-BCD byte is CAUGHT by the return check", () => {
  let caught = false;
  for (const b of CASES) {
    const o = craft(b);
    oracle(o);
    const wrong = { a: (binToPackedBcd(craft(b)).a ^ 0x01) & 0xff, hundreds: o.regs.c };
    if (wrong.a !== o.regs.a) { caught = true; break; }
  }
  assert.ok(caught, "the return check FAILED to distinguish a wrong packed-BCD byte — it is worthless");
});

test("TEETH(hundreds): a wrong hundreds count is CAUGHT by the return check", () => {
  let caught = false;
  for (const b of CASES) {
    const o = craft(b);
    oracle(o);
    const wrong = { a: o.regs.a, hundreds: binToPackedBcd(craft(b)).hundreds + 1 };
    if (wrong.hundreds !== o.regs.c) { caught = true; break; }
  }
  assert.ok(caught, "the return check FAILED to distinguish a wrong hundreds count — it is worthless");
});
