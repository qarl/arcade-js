// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for setActorAnimation (ROM 0x381E) — the ROM's "set animation"
 * primitive: store the sequence pointer DE into the actor record's anim field
 * (ix+0x0C:ix+0x0D) and reset the frame index (ix+0x0E := 0).
 *
 * This is the capture / clone / replay memory-equivalence gate (docs/decompiler-pipeline). The
 * routine WRITES RAM, so every case uses a FRESH clone per side: the oracle runs on
 * one clone, setActorAnimation on another, and they are compared on the go-forward
 * contract — whole RAM (dumpState) minus stack scratch below the entry SP. The routine has no push; its
 * only stack traffic is the terminal `ret` pop, which moves the oracle's SP/pc (a
 * register move, not memory) while the idiomatic routine models neither — so the
 * idiomatic side is separately asserted to leave SP and pc UNCHANGED, and the memory
 * diff excludes STACK_SCRATCH by contract even though this leaf writes none of it.
 *
 * Jobs:
 *   1. EQUAL (real captured dispatches) — 0x381E fires ~200x during a plain attract
 *      run (animation restarts across the demo). Hook it, clone at each true dispatch,
 *      and for each: oracle vs setActorAnimation leave identical RAM (−stack); the
 *      idiomatic side leaves SP and pc unchanged.
 *   2. WRITE-SET (captured) — the oracle's ONLY work-RAM writes are the three bytes
 *      ix+0x0C..ix+0x0E. Documents the exact footprint the gate covers.
 *   3. CRAFTED (controlled pointer) — poke IX and DE IDENTICALLY on both sides of a
 *      real entry (DE=0x1234, D!=E so byte order is observable), confirm both write
 *      ix+0x0C=0x34, ix+0x0D=0x12, ix+0x0E=0x00. Pins the little-endian store + zero.
 *   4. TEETH — an endian-swapped twin (D->0x0C, E->0x0D) MUST be caught on the crafted
 *      D!=E state, at ix+0x0C; plus a captured sweep.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-381e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_381e as oracle } from "../../translated/loc_381e.js";
import { setActorAnimation } from "../setActorAnimation.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x381e;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference outside the stack scratch below the entry SP, or null. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Hook 0x381E in a real attract run and clone the machine at up to K true dispatches. */
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

const CAPS = ROM_PRESENT ? captureDispatches(48, 6000) : [];

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL: real captured dispatches — setActorAnimation == oracle in RAM (−stack); pc & sp untouched", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x381E dispatch in the run window");

  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    setActorAnimation(c);

    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);

    // The idiomatic routine models no stack/ret: SP and pc unchanged from entry.
    const b = cap.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    setActorAnimation(b);
    assert.equal(b.regs.sp, sp0, "setActorAnimation must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "setActorAnimation must leave pc unchanged (no ret modelling)");
  }
  console.log(`  EQUAL: ${CAPS.length} real dispatches identical (RAM −stack), pc & sp untouched`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only work-RAM writes are ix+0x0C..ix+0x0E", () => {
  const cap = CAPS[0];
  const ix = cap.regs.ix & 0xffff;
  const before = cap.clone();
  const after = cap.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  const lo = (ix + 0x0c) & 0xffff, hi = (ix + 0x0e) & 0xffff;
  for (const ch of changed) {
    assert.ok(
      ch.addr >= lo && ch.addr <= hi,
      `oracle wrote outside ix+0x0C..0x0E: ${hx(ch.addr)} (${ch.from}->${ch.to}), ix=${hx(ix)}`,
    );
  }
  assert.ok(changed.length >= 1, "oracle wrote nothing — expected the anim field to change");
  console.log(`  WRITE-SET: ${changed.length} byte(s) changed, all in ${hx(lo)}..${hx(hi)} (ix=${hx(ix)})`);
});

// -- 3. CRAFTED (controlled pointer, observable byte order) -------------------

test("CRAFTED: IX/DE poked identically — both write 0x0C=lo, 0x0D=hi, 0x0E=0", () => {
  const IX = 0x8a80; // a sane pointer into work-RAM actor arena (clear of STACK_SCRATCH)
  const DE = 0x1234; // D=0x12, E=0x34 — byte order is observable
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  for (const m of [o, c]) { m.regs.ix = IX; m.regs.de = DE; }
  // Pre-dirty the target field on both sides so the zeroing of the frame index is real.
  for (const m of [o, c]) { m.mem.write8(IX + 0x0c, 0xaa); m.mem.write8(IX + 0x0d, 0xaa); m.mem.write8(IX + 0x0e, 0xaa); }
  oracle(o);
  setActorAnimation(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);

  assert.equal(c.mem.read8(IX + 0x0c), 0x34, "ix+0x0C must hold DE low byte");
  assert.equal(c.mem.read8(IX + 0x0d), 0x12, "ix+0x0D must hold DE high byte");
  assert.equal(c.mem.read8(IX + 0x0e), 0x00, "ix+0x0E (frame index) must be reset to 0");
  console.log("  CRAFTED: IX=0x8a80 DE=0x1234 -> [0x0C]=0x34 [0x0D]=0x12 [0x0E]=0x00, RAM identical");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: swaps the pointer byte order (D->0x0C, E->0x0D). */
function brokenSetActorAnimation(m, rec = m.regs.ix, animPointer = m.regs.de) {
  const b = rec & 0xffff;
  m.mem.write8((b + 0x0c) & 0xffff, (animPointer >> 8) & 0xff); // BUG: high byte where low belongs
  m.mem.write8((b + 0x0d) & 0xffff, animPointer & 0xff); // BUG: low byte where high belongs
  m.mem.write8((b + 0x0e) & 0xffff, 0x00);
}

test("TEETH: the endian-swapped twin is CAUGHT (crafted D!=E; plus captured sweep)", () => {
  // Deterministic crafted catch: DE=0x1234 makes the swap observable at ix+0x0C.
  const IX = 0x8a80, DE = 0x1234;
  const base = CAPS[0];
  const o = base.clone(), c = base.clone();
  for (const m of [o, c]) { m.regs.ix = IX; m.regs.de = DE; }
  oracle(o);
  brokenSetActorAnimation(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the endian swap on the crafted state");
  assert.equal(d.addr, (IX + 0x0c) & 0xffff, `crafted teeth caught the wrong address ${hx(d.addr ?? 0)}`);

  // Captured sweep: any real dispatch with D!=E must also be caught.
  let caught = null;
  for (const cap of CAPS) {
    const oo = cap.clone(), cc = cap.clone();
    oracle(oo);
    brokenSetActorAnimation(cc);
    const dd = ramDiffMinusStack(oo, cc, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    if (dd) { caught = dd; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch the endian swap — it is worthless");
  console.log(`  TEETH: endian swap caught at ${hx(d.addr)} (crafted) and ${hx(caught.addr)} (captured)`);
});
