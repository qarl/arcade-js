// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for pulseCoinCounter1Latch (ROM 0x5a9c, Pooyan) — coin-counter 1 pulse generator:
 * strobe the LS259 coin-counter latch (bit 3 @ 0xa183) from the pulse count (0x8824) and phase
 * timer (0x8825). No pulses -> ret; fresh pulse -> seed phase 0x30 + raise latch; counting ->
 * dec phase, drop latch at phase 0x18, retire one pulse at phase 0.
 *
 * CYCLE-FREE / memory-equivalence gate. pc/SP are NOT compared. The contract has TWO parts:
 *   (a) RAM (dumpState, minus stack scratch below the entry SP) — the pulse count + phase cells live in work RAM.
 *   (b) The LS259 latch (m.io.latch) — the routine's real output is a WRITE-ONLY hardware latch
 *       bit that dumpState does NOT capture, so it is compared directly against the oracle clone.
 * There is no register live-out (a coin-counter side-effect routine; no caller reads A/flags).
 *
 * Jobs:
 *   1. EQUAL (crafted, every path) — RAM(−stack) AND the latch match the oracle across the
 *      no-pulse, fresh-pulse, mid-count, drop-point, and retire paths.
 *   2. WRITE-SET — the oracle's RAM writes land only in {count, phase}.
 *   3. TEETH — a wrong phase byte is caught by the RAM diff; a wrong latch bit is caught by the
 *      latch compare (the RAM diff alone is BLIND to the latch, which is why (b) exists).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5a9c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5a9c as oracle } from "../../translated/loc_5a9c.js";
import { pulseCoinCounter1Latch } from "../pulseCoinCounter1Latch.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PULSE_COUNT = 0x8824;
const PULSE_PHASE = 0x8825;
const LATCH_BIT = 3; // coin-counter 1 = LS259 bit 3 (0xa183)
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** First differing LS259 latch bit (dumpState does not include the latch), or null. */
function latchDiff(o, c) {
  for (let b = 0; b < 8; b++) {
    if (o.io.latch[b] !== c.io.latch[b]) return { bit: b, o: o.io.latch[b], c: c.io.latch[b] };
  }
  return null;
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone: pulse count + phase seeded, latch bit 3 set to a known state, SP in dead scratch. */
function craft(count, phase, preLatch) {
  const m = BASE.clone();
  m.mem.write8(PULSE_COUNT, count & 0xff);
  m.mem.write8(PULSE_PHASE, phase & 0xff);
  m.io.latch[LATCH_BIT] = preLatch & 1;
  m.regs.sp = 0x8ffe;
  return m;
}

// [count, phase, preLatch, label] — every path:
const CASES = [
  [0x00, 0x05, 1, "no-pulse -> ret (latch held)"],
  [0x03, 0x00, 0, "fresh pulse -> seed phase 0x30 + raise latch"],
  [0x03, 0x01, 1, "phase 1 -> phase 0 -> retire one pulse (latch held)"],
  [0x03, 0x19, 1, "phase 0x19 -> phase 0x18 = drop point -> lower latch"],
  [0x03, 0x20, 1, "phase 0x20 -> phase 0x1f (no drop, latch held)"],
];

// -- 1. EQUAL (crafted, every path) -------------------------------------------

test("EQUAL: crafted paths — RAM(−stack) AND the coin-counter latch match the oracle", () => {
  for (const [count, phase, preLatch, label] of CASES) {
    const o = craft(count, phase, preLatch);
    const c = craft(count, phase, preLatch);
    oracle(o);
    pulseCoinCounter1Latch(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} [${label}]: oracle=${d.a} mine=${d.b}`);
    const ld = latchDiff(o, c);
    assert.equal(ld, null, ld && `latch bit ${ld?.bit} mismatch [${label}]: oracle=${ld?.o} mine=${ld?.c}`);
  }
  console.log(`  EQUAL: ${CASES.length} paths identical (RAM −stack + LS259 latch)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's RAM writes land only in {count, phase}", () => {
  const before = craft(0x03, 0x19, 1); // drop-point path also touches the phase cell
  const after = craft(0x03, 0x19, 1);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  for (const addr of changed) {
    assert.ok(addr === PULSE_COUNT || addr === PULSE_PHASE, `unexpected RAM write at ${hx(addr)}`);
  }
  assert.ok(changed.includes(PULSE_PHASE), "phase cell should have changed");
  console.log(`  WRITE-SET: ${changed.length} RAM write(s), all within {count, phase}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong phase byte is caught by the RAM diff", () => {
  const o = craft(0x03, 0x20, 1);
  const c = craft(0x03, 0x20, 1);
  oracle(o);
  pulseCoinCounter1Latch(c);
  c.mem.write8(PULSE_PHASE, (c.mem.read8(PULSE_PHASE) ^ 0x01) & 0xff); // BUG: wrong phase
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase byte — it is worthless");
  assert.equal(d.addr, PULSE_PHASE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong phase caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong latch bit is caught by the latch compare (RAM diff is blind to it)", () => {
  const o = craft(0x03, 0x19, 1); // drop-point path: oracle lowers the latch to 0
  const c = craft(0x03, 0x19, 1);
  oracle(o);
  pulseCoinCounter1Latch(c);
  // Sanity: with the correct rewrite the latch already matches and the RAM diff is clean.
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: RAM identical on the drop-point path");
  assert.equal(latchDiff(o, c), null, "sanity: latch identical before the teeth mutation");
  c.io.latch[LATCH_BIT] ^= 1; // BUG: leave the latch raised instead of dropping it
  assert.equal(ramDiffMinusStack(o, c), null, "the RAM diff must stay blind to the latch");
  const ld = latchDiff(o, c);
  assert.notEqual(ld, null, "the latch compare FAILED to catch a wrong latch bit — it is worthless");
  assert.equal(ld.bit, LATCH_BIT, `teeth caught the wrong latch bit ${ld?.bit}`);
  console.log(`  TEETH/LATCH: wrong latch bit caught at bit ${ld.bit} (oracle=${ld.o} broken=${ld.c})`);
});
