// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for precheckCollisionBounds (ROM 0x5f53) — "bias an actor's X and
 * test whether its Y+margin clears the bottom": pick the X bias from the flip-screen flag
 * (+6 upright, -2 flipped), form E = (ix+0) + bias, then A = (ix+2) + 8 and answer
 * C = (A < 0xe0).
 *
 * The routine WRITES NO RAM, so its go-forward contract is the values it leaves in registers:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) — trivially, since neither writes — AND the
 *     [e, a, carry] tuple the bridge returns, PLUS the E/A/C SIDE EFFECT it sets on m.regs
 *     (both compared to the ORACLE clone's regs.e, regs.a, regs.fC — the frozen translated
 *     callers read those registers/flag straight out, so a return-only rewrite must be caught).
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x5f53; any real dispatch agrees in RAM + tuple. This
 *      gameplay leaf is not reached in a short attract, so CRAFTED is load-bearing.
 *   2. CRAFTED — both bias branches and the 0xe0 carry boundary; tuple matches the oracle.
 *   3. WRITE-SET — the oracle writes NO RAM at all (positive control for "memory-only").
 *   4. TEETH — a wrong carry, and a wrong bias, are each CAUGHT by the tuple contract.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5f53.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5f53 as oracle } from "../../translated/loc_5f53.js";
import { precheckCollisionBounds } from "../precheckCollisionBounds.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, FLIP_SCREEN_FLAG, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x5f53;
const REC = ACTOR_TABLE; // 0x8a80: a sane record base inside work RAM for the IX pointer
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Seed the flip flag and the record's +0x00 / +0x02 fields; pre-dirty the record. */
function craft(flip, x0, y2) {
  const m = new Machine(ROM);
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, 0xaa);
  m.mem.write8(FLIP_SCREEN_FLAG, flip);
  m.mem.write8((REC + 0x00) & 0xffff, x0);
  m.mem.write8((REC + 0x02) & 0xffff, y2);
  m.regs.ix = REC;
  return m;
}

// flip picks the bias; y2 walks the 0xe0 carry boundary (a = y2+8, carry when a < 0xe0).
const CASES = [
  { flip: 0x01, x0: 0x40, y2: 0x10 }, // upright bias +6; a=0x18 < 0xe0 -> carry
  { flip: 0x00, x0: 0x40, y2: 0x10 }, // flipped bias -2; a=0x18 < 0xe0 -> carry
  { flip: 0x01, x0: 0xfe, y2: 0xd7 }, // a=0xdf < 0xe0 -> carry; E wraps (0xfe+6)
  { flip: 0x01, x0: 0x00, y2: 0xd8 }, // a=0xe0, NOT < 0xe0 -> no carry (boundary)
  { flip: 0x00, x0: 0x02, y2: 0xff }, // a=(0xff+8)&0xff=0x07 < 0xe0 -> carry; flipped E
  { flip: 0x80, x0: 0x7f, y2: 0xf0 }, // flip nonzero -> upright; a=0xf8 >= 0xe0 -> no carry
];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(32, 4000) : [];

test("CAPTURE: real 0x5f53 dispatches — precheckCollisionBounds == oracle in RAM (−stack) + tuple", () => {
  if (CAPS.length === 0) {
    console.log("  CAPTURE: no real 0x5f53 dispatch in the window — CRAFTED is load-bearing");
    return;
  }
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const [re, ra, rcarry] = precheckCollisionBounds(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(re, o.regs.e, `E: module ${hx(re)} != oracle ${hx(o.regs.e)}`);
    assert.equal(ra, o.regs.a, `A: module ${hx(ra)} != oracle ${hx(o.regs.a)}`);
    assert.equal(rcarry, o.regs.fC, "carry must equal the oracle's C");
    // SIDE EFFECT: the bridge must SET E/A/C on m.regs for the frozen translated callers,
    // which read them straight out of the registers (a return-only rewrite would pass above).
    assert.equal(c.regs.e, o.regs.e, "module must SET E for the translated caller's sub e");
    assert.equal(c.regs.a, o.regs.a, "module must SET A for the translated caller's ld d,a");
    assert.equal(c.regs.fC, o.regs.fC, "module must SET carry for the translated caller's jr nc");
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: both bias branches + carry boundary — RAM identical + tuple matches the oracle", () => {
  for (const cs of CASES) {
    const o = craft(cs.flip, cs.x0, cs.y2);
    const c = craft(cs.flip, cs.x0, cs.y2);
    oracle(o);
    const [re, ra, rcarry] = precheckCollisionBounds(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `case ${JSON.stringify(cs)}: RAM diff at ${hx(d.addr ?? 0)}`);
    assert.equal(re, o.regs.e, `case ${JSON.stringify(cs)}: E ${hx(re)} != oracle ${hx(o.regs.e)}`);
    assert.equal(ra, o.regs.a, `case ${JSON.stringify(cs)}: A ${hx(ra)} != oracle ${hx(o.regs.a)}`);
    assert.equal(rcarry, o.regs.fC, `case ${JSON.stringify(cs)}: carry ${rcarry} != oracle ${o.regs.fC}`);
    // SIDE EFFECT: the bridge must SET E/A/C on the module clone, as the oracle leaves them.
    assert.equal(c.regs.e, o.regs.e, `case ${JSON.stringify(cs)}: module must SET E`);
    assert.equal(c.regs.a, o.regs.a, `case ${JSON.stringify(cs)}: module must SET A`);
    assert.equal(c.regs.fC, o.regs.fC, `case ${JSON.stringify(cs)}: module must SET carry`);
  }
  console.log(`  CRAFTED: ${CASES.length} cases agree in RAM + { e, a, carry }`);
});

// -- 3. WRITE-SET (positive control: memory-only) -----------------------------

test("WRITE-SET: the oracle writes NO RAM", () => {
  for (const cs of CASES) {
    const before = craft(cs.flip, cs.x0, cs.y2);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      assert.fail(`case ${JSON.stringify(cs)}: oracle wrote ${hx(after.stateOffsetToAddr(off))}`);
    }
  }
  console.log("  WRITE-SET: no RAM write on any case");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong carry is CAUGHT by the tuple contract", () => {
  let caught = false;
  for (const cs of CASES) {
    const o = craft(cs.flip, cs.x0, cs.y2);
    oracle(o);
    const [, , rcarry] = precheckCollisionBounds(craft(cs.flip, cs.x0, cs.y2));
    const brokenCarry = !rcarry; // BUG: inverted below-bottom result
    if (brokenCarry !== o.regs.fC) { caught = true; break; }
  }
  assert.ok(caught, "the carry check FAILED to catch an inverted carry — it is worthless");
  console.log("  TEETH: an inverted carry differs from the oracle's C");
});

test("TEETH: a wrong bias is CAUGHT at E", () => {
  // A twin that reads the flip flag backwards computes the wrong bias, so E diverges wherever
  // the two biases differ mod 256.
  let caught = false;
  for (const cs of CASES) {
    const o = craft(cs.flip, cs.x0, cs.y2);
    oracle(o);
    const m = craft(cs.flip, cs.x0, cs.y2);
    const wrongBias = m.mem.read8(FLIP_SCREEN_FLAG) !== 0 ? 0xfe : 0x06; // BUG: branch swapped
    const brokenE = (m.mem.read8((REC + 0x00) & 0xffff) + wrongBias) & 0xff;
    if (brokenE !== o.regs.e) { caught = true; break; }
  }
  assert.ok(caught, "the E check FAILED to catch a swapped bias — it is worthless");
  console.log("  TEETH: a swapped bias differs from the oracle's E");
});
