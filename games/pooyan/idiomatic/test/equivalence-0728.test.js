// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loc_0728 (ROM 0x0728, Pooyan) — the tail of the sprite-attribute copy
 * loop: step the record pointer and continue.
 *
 * A fresh clone per side, the oracle on one and loc_0728 on the other, compared on RAM (dumpState,
 * minus stack scratch below the entry SP) PLUS the declared register live-out IX and DE. pc/SP/B/HL/A are not compared
 * (B/HL are reloaded by the caller each iteration; A is scratch; SP/pc are excluded by definition).
 *
 * loc_0728 and the copy body form one loop across a routine boundary; the taken branch re-enters the
 * body, which is a sibling decompiled this same batch (its module resolves at reconcile). The exit
 * branch (counter drains to 0) is self-contained and needs no sibling behaviour.
 *
 * Jobs:
 *   1. EXIT — counter=1: no copy; IX advances by one, DE is unchanged, RAM is untouched.
 *   2. LOOP — counter=2: one copy iteration runs through the body; RAM (the copied sprite bytes) and
 *      the advanced IX/DE match the oracle.
 *   3. TEETH — a wrong IX (register), a wrong DE (register), and a corrupted copied byte (RAM) are
 *      each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0728.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0728 as oracle } from "../../translated/loc_0728.js";
import { loc_0728 } from "../loc_0728.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SRC = 0x8840; // work-RAM copy source (inc l keeps it in-page)
const DST_IX = 0x9410; // sprite bank 1
const DST_DE = 0x9010; // sprite bank 0
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fee);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the loop's entry registers seated and a source pattern laid down. */
function craft(count) {
  const m = BASE.clone();
  m.regs.hl = SRC;
  m.regs.ix = DST_IX;
  m.regs.de = DST_DE;
  m.regs.b = count & 0xff;
  m.regs.sp = 0x8fee; // the oracle's ret pops inside STACK_SCRATCH
  for (let i = 0; i < 8; i++) m.mem8[SRC + i] = (0xa1 + i * 0x11) & 0xff; // distinct source bytes
  return m;
}

// -- 1. EXIT (counter drains, no copy) ----------------------------------------

test("EXIT: counter=1 — IX advances by one, DE unchanged, RAM untouched", () => {
  const o = craft(1);
  const c = craft(1);
  const b0 = c.dumpState();
  oracle(o);
  loc_0728(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.deepEqual([...c.dumpState()], [...b0], "the exit path writes no memory");
  assert.equal(c.regs.ix & 0xffff, o.regs.ix & 0xffff, "IX live-out mismatch");
  assert.equal(c.regs.ix & 0xffff, (DST_IX + 1) & 0xffff, "IX advanced by one");
  assert.equal(c.regs.de & 0xffff, o.regs.de & 0xffff, "DE live-out mismatch");
  assert.equal(c.regs.de & 0xffff, DST_DE, "DE unchanged on the exit path");
  console.log(`  EXIT: IX ${hx(c.regs.ix)} DE ${hx(c.regs.de)}, no writes`);
});

// -- 2. LOOP (one copy iteration through the body) ----------------------------

test("LOOP: counter=2 — copied bytes + advanced IX/DE match the oracle", () => {
  const o = craft(2);
  const c = craft(2);
  oracle(o);
  loc_0728(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.regs.ix & 0xffff, o.regs.ix & 0xffff, "IX live-out mismatch after a copy iteration");
  assert.equal(c.regs.de & 0xffff, o.regs.de & 0xffff, "DE live-out mismatch after a copy iteration");
  assert.notEqual(o.regs.de & 0xffff, DST_DE, "sanity: a copy iteration must have advanced DE");
  console.log(`  LOOP: IX ${hx(c.regs.ix)} DE ${hx(c.regs.de)}, RAM identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong IX live-out is CAUGHT", () => {
  const o = craft(1);
  const c = craft(1);
  oracle(o);
  loc_0728(c);
  assert.equal(c.regs.ix, o.regs.ix, "sanity: IX matches before corruption");
  c.regs.ix = (o.regs.ix + 1) & 0xffff; // BUG: wrong advanced pointer
  assert.notEqual(c.regs.ix, o.regs.ix, "the IX live-out check must reject a wrong pointer");
  console.log(`  TEETH/IX: wrong IX rejected`);
});

test("TEETH: a wrong DE live-out is CAUGHT", () => {
  const o = craft(2);
  const c = craft(2);
  oracle(o);
  loc_0728(c);
  assert.equal(c.regs.de, o.regs.de, "sanity: DE matches before corruption");
  c.regs.de = (o.regs.de + 1) & 0xffff; // BUG: wrong destination pointer
  assert.notEqual(c.regs.de, o.regs.de, "the DE live-out check must reject a wrong pointer");
  console.log(`  TEETH/DE: wrong DE rejected`);
});

test("TEETH: a corrupted copied byte is CAUGHT by the RAM diff", () => {
  const o = craft(2);
  const c = craft(2);
  oracle(o);
  loc_0728(c);
  c.mem8[DST_IX + 1] = (c.mem8[DST_IX + 1] + 1) & 0xff; // BUG: corrupt a copied sprite byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted copied byte — it is worthless");
  console.log(`  TEETH/RAM: corrupted copy caught at ${hx(d.addr ?? 0)}`);
});
