// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for byteToPackedBcd (ROM 0x062a-0x0643, Pooyan) — "convert a
 * binary byte to its packed-BCD decimal form (value mod 100)": BCD-correct the low nibble,
 * add decimal 16 once per high-nibble unit (daa each step), fold the low digit back in.
 * Result A = BCD of (A mod 100).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. byteToPackedBcd is a PURE register
 * transform — it touches NO memory — so RAM(−stack) is trivially identical and the
 * load-bearing contract is the RETURN value:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) == identical  AND  return == oracle's exit A.
 *
 * The single register input is A; both sides read it (the module via its `= m.regs.a`
 * default). The return is checked against the ORACLE clone's exit A, never the module's.
 * pc/SP are not compared (the oracle's only SP move is its terminal `ret`).
 *
 * Jobs:
 *   1. EQUAL+RETURN (crafted, exhaustive) — all 256 input bytes leave RAM(−stack) identical
 *      and byteToPackedBcd's return matches the oracle's A. Covers the jr-z (no high nibble)
 *      branch, the djnz weighting loop, and the mod-100 wrap for inputs >= 0x64.
 *   2. CAPTURED (best-effort) — if a plain attract boot dispatches 0x062a (the HUD counter
 *      renderer reaches it), replay the real captured state too.
 *   3. WRITE-SET — the oracle writes ZERO RAM bytes.
 *   4. TEETH — a twin that returns a WRONG byte MUST be caught by the return check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-062a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_062a as oracle } from "../../translated/loc_062a.js";
import { byteToPackedBcd } from "../byteToPackedBcd.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x062a;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A crafted entry machine: A = the input byte, sp parked in dead scratch for the ret pop. */
function craft(byte) {
  const m = new Machine(ROM);
  m.regs.a = byte & 0xff;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the ret only pops (reads) the word at SP
  return m;
}

// -- 1. EQUAL + RETURN (crafted, exhaustive) ----------------------------------

test("EQUAL+RETURN: all 256 bytes — RAM(−stack) identical and return matches the oracle A", () => {
  for (let byte = 0; byte < 256; byte++) {
    const o = craft(byte);
    const c = craft(byte);
    oracle(o);
    const ret = byteToPackedBcd(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (byte ${hx(byte)}): oracle=${d.a} mine=${d.b}`);
    assert.equal(ret, o.regs.a, `return mismatch for byte ${hx(byte)}: mine ${hx(ret)} != oracle ${hx(o.regs.a)}`);
    // SIDE EFFECT: the bridge must SET A (the register the frozen caller reads), not just return it.
    assert.equal(c.regs.a, o.regs.a, `byte ${hx(byte)}: module did not SET A ${hx(c.regs.a)} != oracle ${hx(o.regs.a)}`);
  }
  console.log("  EQUAL+RETURN: 256 bytes — return == oracle A, no RAM touched");
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  return caps;
}

test("CAPTURED: real 0x062a dispatches in an attract boot replay identically (if reached)", () => {
  const caps = captureDispatches(24, 4000);
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = byteToPackedBcd(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
    assert.equal(ret, o.regs.a, `captured return mismatch: mine ${hx(ret)} != oracle ${hx(o.regs.a)}`);
    // SIDE EFFECT: the bridge must SET A on the captured state too.
    assert.equal(c.regs.a, o.regs.a, `captured: module did not SET A ${hx(c.regs.a)} != oracle ${hx(o.regs.a)}`);
  }
  console.log(`  CAPTURED: ${caps.length} real 0x062a dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes ZERO RAM bytes", () => {
  for (const byte of [0x00, 0x23, 0x99, 0xff]) {
    const before = craft(byte);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      assert.ok(inDeadStack(addr), `byte ${hx(byte)}: oracle wrote a live RAM cell ${hx(addr)}`);
    }
  }
  console.log("  WRITE-SET: no live RAM write (register-only transform)");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: returns the packed-BCD result off by one — must be caught by the return check. */
function brokenByteToPackedBcd(m, value = m.regs.a) {
  return (byteToPackedBcd(m, value) + 1) & 0xff; // BUG: wrong result byte
}

test("TEETH: a wrong return byte is CAUGHT by the return check", () => {
  let caught = false;
  for (let byte = 0; byte < 256; byte++) {
    const o = craft(byte);
    const c = craft(byte);
    oracle(o);
    const wrong = brokenByteToPackedBcd(c);
    if (wrong !== o.regs.a) { caught = true; break; }
  }
  assert.ok(caught, "the return check FAILED to distinguish a wrong result byte — it is worthless");
  console.log("  TEETH: an off-by-one packed-BCD return differs from the oracle's A");
});
