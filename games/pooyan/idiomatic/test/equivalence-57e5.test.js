// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampObjectAndDecCounter (ROM 0x57e5) — fetch A from (BC),
 * decrement the counter at (HL) in place, and stamp (ix+0x13)=0x01 and (ix+0x16)=0xc1.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH
 * clone per side. Two contracts are checked:
 *
 *   - RAM (dumpState, minus stack scratch below the entry SP): the (HL) decrement + the two IX stamps.
 *   - the module's returned live-out { a, counter } vs what the ORACLE leaves in registers:
 *       a       == oracle's accumulator (the byte it loaded from (BC)),
 *       counter == the value the oracle left at (HL) (the dec result), and
 *       (counter === 0) == the oracle's Z flag (proves the flag live-out is represented).
 *   The expected values are ALWAYS derived from the oracle clone, never from the module.
 *
 * SP/pc are NOT compared: the oracle's terminal `m.ret` pops the modelled stack, the ABI
 * the direct-call layer replaces with a JS return.
 *
 * 0x57e5 is register-dispatched and is NOT reached in a plain attract boot (a hooked 4000-
 * frame run dispatches it 0 times), so every case is CRAFTED: a fresh machine with ix/hl/bc
 * set to disjoint work-RAM pointers (0x8800-0x8FFF, clear of STACK_SCRATCH), the counter and
 * source byte poked, and the stamp span pre-dirtied. Both sides read the SAME registers off
 * their clones (the module via its `= m.regs.ix/hl/bc` defaults).
 *
 * Jobs: EQUAL (RAM), RETURN (the { a, counter } live-out incl. the Z flag), WRITE-SET
 * (footprint = (HL) + the two stamps), TEETH (a wrong stamp caught in RAM; a wrong `a`
 * caught by the return check).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-57e5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_57e5 as oracle } from "../../translated/loc_57e5.js";
import { stampObjectAndDecCounter } from "../stampObjectAndDecCounter.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built (games/pooyan/rom/maincpu.bin absent)" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// Disjoint work-RAM pointers: object record, counter, source byte.
const IX = 0x8a80; // stamps land at 0x8a93 and 0x8a96
const HL = 0x8b40; // the decremented counter
const BC = 0x8b00; // the byte fetched into A

/** A crafted case: fresh machine + the register inputs and memory it operates on. */
function craft(counterVal, srcVal, dirty = 0xaa) {
  const m = new Machine(ROM, {});
  m.regs.ix = IX;
  m.regs.hl = HL;
  m.regs.bc = BC;
  m.mem.write8(HL, counterVal);
  m.mem.write8(BC, srcVal);
  m.mem.write8((IX + 0x13) & 0xffff, dirty);
  m.mem.write8((IX + 0x16) & 0xffff, dirty);
  return { base: m, counterVal, srcVal };
}

// Vary the counter so the exit flags land both ways, and the source byte independently.
const CASES = ROM_PRESENT
  ? [
      craft(0x01, 0x42), // dec 1 -> 0  (Z set)
      craft(0x00, 0x7f), // dec 0 -> 0xFF (wrap, NZ)
      craft(0x05, 0x00), // dec 5 -> 4  (NZ)
      craft(0x80, 0xc3), // dec 0x80 -> 0x7F (NZ)
      craft(0x01, 0x42, 0x00), // clean stamp span
    ]
  : [];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted — stampObjectAndDecCounter == oracle in RAM (−stack)", () => {
  assert.ok(CASES.length >= 1, "expected at least one crafted case");
  for (const c of CASES) {
    const a = c.base.clone();
    const b = c.base.clone();
    oracle(a);
    stampObjectAndDecCounter(b);
    const d = ramDiffMinusStack(a, b);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. RETURN (the { a, counter } live-out, incl. the Z flag) -----------------

test("RETURN: module { a, counter } matches the oracle's accumulator, (HL) result, and Z", () => {
  for (const c of CASES) {
    const a = c.base.clone();
    const b = c.base.clone();
    oracle(a); // sets a.regs.a, a.regs flags, and (HL)
    const ret = stampObjectAndDecCounter(b);

    assert.equal(ret.a, a.regs.a, "module.a must equal the oracle's accumulator (byte from (BC))");
    assert.equal(ret.counter, a.mem.read8(HL), "module.counter must equal the oracle's (HL) dec result");
    assert.equal(ret.counter === 0, a.regs.fZ, "module.counter==0 must track the oracle's Z flag");

    // SIDE-EFFECT (the bridge): the module must SET the live-out register/flag on its own
    // clone, not merely return them — a return-value-only check passes a rewrite that never
    // sets the register the register-dispatched caller reads.
    assert.equal(b.regs.a, a.regs.a, "module must SET regs.a for the register-dispatched caller");
    assert.equal(b.regs.fZ, a.regs.fZ, "module must SET the Z flag for the register-dispatched caller");
  }
  console.log(`  RETURN: { a, counter } (+Z) matches the oracle across ${CASES.length} cases`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only work-RAM writes are (HL), (ix+0x13), (ix+0x16)", () => {
  const c = craft(0x05, 0x00, 0x00); // clean stamp span so only real writes show
  const before = c.base.clone();
  const after = c.base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const expected = new Set([HL, IX + 0x13, IX + 0x16]);
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) {
    assert.ok(expected.has(addr), `oracle wrote unexpected work-RAM addr ${hx(addr)}`);
  }
  assert.equal(after.mem.read8(HL), 0x04, "(HL) 0x05 -> 0x04");
  assert.equal(after.mem.read8(IX + 0x13), 0x01, "(ix+0x13) := 0x01");
  assert.equal(after.mem.read8(IX + 0x16), 0xc1, "(ix+0x16) := 0xc1");
  console.log(`  WRITE-SET: ${changed.length} work-RAM byte(s) changed, all in {(HL),(ix+0x13),(ix+0x16)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: stamps the WRONG value (0x00) at (ix+0x16) instead of 0xc1. */
function brokenStamp(m, record = m.regs.ix, counterPtr = m.regs.hl, sourcePtr = m.regs.bc) {
  const ret = stampObjectAndDecCounter(m, record, counterPtr, sourcePtr);
  m.mem.write8((record + 0x16) & 0xffff, 0x00); // BUG: must be 0xc1
  return ret;
}

test("TEETH (RAM): a wrong (ix+0x16) stamp is CAUGHT", () => {
  let caught = null;
  for (const c of CASES) {
    const a = c.base.clone();
    const b = c.base.clone();
    oracle(a);
    brokenStamp(b);
    const d = ramDiffMinusStack(a, b);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong (ix+0x16) stamp — it is worthless");
  assert.equal(caught.addr, IX + 0x16, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  assert.equal(caught.a, 0xc1, "oracle side is the correct 0xc1");
  assert.equal(caught.b, 0x00, "broken side is the wrong 0x00");
  console.log(`  TEETH(RAM): wrong (ix+0x16) caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});

test("TEETH (RETURN): a wrong returned accumulator is CAUGHT by the return check", () => {
  const c = CASES[0];
  const a = c.base.clone();
  const b = c.base.clone();
  oracle(a);
  const ret = stampObjectAndDecCounter(b);
  const brokenA = (ret.a ^ 0xff) & 0xff; // deliberately wrong accumulator
  assert.notEqual(brokenA, a.regs.a, "the wrong accumulator must differ from the oracle's");
  assert.throws(
    () => assert.equal(brokenA, a.regs.a),
    "the return check must reject a wrong accumulator",
  );
  console.log(`  TEETH(RETURN): wrong accumulator ${hx(brokenA)} rejected vs oracle ${hx(a.regs.a)}`);
});
