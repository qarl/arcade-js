// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for storeActorAnimationPointer (ROM 0x5c75) — the found/spawn
 * helper: store DE into the actor record at (iy+0x0c:0x0d) (E low, D high) and clear the
 * step byte at (iy+0x0e).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH
 * clone per side: the oracle runs on one clone, storeActorAnimationPointer on another, and
 * they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) — the memory-only footprint.
 *
 * SP/pc are deliberately NOT compared: the oracle's terminal `m.ret` pops the modelled
 * stack (moving SP and pc), the stack ABI the direct-call layer replaces with a JS return.
 * storeActorAnimationPointer has no register/flag live-out, so there is nothing else to
 * assert beyond RAM.
 *
 * Register inputs are the SAME on both sides: each captured/crafted base already carries the
 * iy (record) and de (pointer) it was built with, and both the oracle and the module read
 * those same registers off their clones (the module via its `= m.regs.iy/de` defaults).
 *
 * Jobs:
 *   1. EQUAL — real captured dispatches (0x5c75 fires ~4x in the attract demo game) PLUS
 *      crafted states: oracle vs module leave identical RAM (− stack scratch below the entry SP).
 *   2. WRITE-SET — on a crafted case the oracle's ONLY work-RAM writes are the three bytes
 *      (iy+0x0c), (iy+0x0d), (iy+0x0e); documents the exact footprint.
 *   3. CRAFTED — pre-dirty (iy+0x0c..0x0e) to 0xAA identically on both sides and confirm
 *      both write DE and zero (iy+0x0e); proves the store/clear, not agreement on zero RAM.
 *   4. TEETH — a twin that leaves (iy+0x0e) = 0xFF instead of 0 MUST be caught, at that addr.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5c75.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5c75 as oracle } from "../../translated/loc_5c75.js";
import { storeActorAnimationPointer } from "../storeActorAnimationPointer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built (games/pooyan/rom/maincpu.bin absent)" }, fn);

const TARGET = 0x5c75;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract (whole dump minus stack scratch below the entry SP). */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Hook 0x5c75 in a real attract run and clone the machine at up to K true dispatches. */
function captureDispatches(K, maxFrames) {
  if (!ROM_PRESENT) return [];
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

/** A crafted base: a fresh machine with iy=record, de=pointer, and the target span pre-dirtied. */
function craft(record, pointer, dirty = 0xaa) {
  const m = new Machine(ROM, {});
  m.regs.iy = record;
  m.regs.de = pointer;
  for (let i = 0x0c; i <= 0x0e; i++) m.mem.write8((record + i) & 0xffff, dirty);
  return m;
}

const CAPS = ROM_PRESENT ? captureDispatches(8, 4000) : [];
// Crafted bases exercise varied record pointers into work RAM (0x8800-0x8FFF) and pointer
// values (a ROM script ptr, zero, an arbitrary word). iy chosen so all three writes land in
// work RAM and clear of STACK_SCRATCH (0x8fc0-0x8fff).
const CRAFTED = ROM_PRESENT
  ? [craft(0x8a80, 0x634f), craft(0x8b40, 0x0000), craft(0x8c00, 0xabcd), craft(0x8a80, 0x5cb1, 0x00)]
  : [];
const CASES = [...CAPS, ...CRAFTED];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: captured + crafted — storeActorAnimationPointer == oracle in RAM (−stack)", () => {
  assert.ok(CASES.length >= 1, "expected at least one case");
  for (const base of CASES) {
    const a = base.clone();
    const b = base.clone();
    oracle(a);
    storeActorAnimationPointer(b);
    const d = ramDiffMinusStack(a, b);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CAPS.length} captured + ${CRAFTED.length} crafted identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only work-RAM writes are (iy+0x0c), (iy+0x0d), (iy+0x0e)", () => {
  const record = 0x8a80;
  const base = craft(record, 0x634f, 0x00); // clean span so only the routine's writes show
  const before = base.clone();
  const after = base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const expected = new Set([record + 0x0c, record + 0x0d, record + 0x0e]);
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) {
    assert.ok(expected.has(addr), `oracle wrote unexpected work-RAM addr ${hx(addr)}`);
  }
  // DE=0x634f: E=0x4f -> (iy+0x0c), D=0x63 -> (iy+0x0d), 0 -> (iy+0x0e).
  assert.equal(after.mem.read8(record + 0x0c), 0x4f, "(iy+0x0c) <- E");
  assert.equal(after.mem.read8(record + 0x0d), 0x63, "(iy+0x0d) <- D");
  assert.equal(after.mem.read8(record + 0x0e), 0x00, "(iy+0x0e) cleared");
  console.log(`  WRITE-SET: ${changed.length} work-RAM byte(s) changed, all in (iy+0x0c..0x0e)`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: pre-dirtied (iy+0x0c..0x0e)=0xAA -> DE stored, (iy+0x0e) zeroed, RAM identical", () => {
  const record = 0x8b40;
  const base = craft(record, 0xabcd, 0xaa);
  const a = base.clone();
  const b = base.clone();
  oracle(a);
  storeActorAnimationPointer(b);

  const d = ramDiffMinusStack(a, b);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  // Both genuinely stored + cleared (not merely agreed on dirt).
  assert.equal(b.mem.read8(record + 0x0c), 0xcd, "(iy+0x0c) <- E(0xcd)");
  assert.equal(b.mem.read8(record + 0x0d), 0xab, "(iy+0x0d) <- D(0xab)");
  assert.equal(b.mem.read8(record + 0x0e), 0x00, "(iy+0x0e) cleared from 0xAA");
  console.log("  CRAFTED: 0xAA span -> DE stored + step byte zeroed, RAM identical");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: leaves (iy+0x0e) = 0xFF instead of clearing it to 0. */
function brokenStore(m, record = m.regs.iy, pointer = m.regs.de) {
  storeActorAnimationPointer(m, record, pointer);
  m.mem.write8((record + 0x0e) & 0xffff, 0xff); // BUG: the step byte must be 0
}

test("TEETH: a wrong (iy+0x0e) value is CAUGHT on every case", () => {
  let caught = null;
  for (const base of CASES) {
    const a = base.clone();
    const b = base.clone();
    oracle(a);
    brokenStore(b);
    const d = ramDiffMinusStack(a, b);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong (iy+0x0e) store — it is worthless");
  // The caught address is the +0x0e of whichever case tripped first.
  console.log(`  TEETH: wrong step byte caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
  assert.equal(caught.b, 0xff, "the caught divergence is the broken 0xFF step byte");
});
