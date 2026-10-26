// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blankActorSpriteBand (ROM 0x3553, Pooyan) — "blank an actor's sprite band".
 * The oracle clears A, copies IX into HL (push ix / pop hl), loads B := 0x17, and runs the
 * rst-0x10 run-fill helper (fillByteRun) to write 0x17 zero bytes from HL, advancing HL. So it
 * fills the 0x17-byte run [IX, IX+0x17) with zero.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM, so
 * each case runs the oracle on one FRESH clone and blankActorSpriteBand on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the declared register live-out (HL and B).
 *
 * HL — the advanced pointer IX+0x17 — and B = 0 (the fill counter the djnz drains) are genuine
 * live-outs the fill helper leaves; several handlers tail-jump into blankActorSpriteBand, so its exit state
 * propagates. Both are asserted, and the module must SET them on its own clone. A (the fill byte
 * 0) is a fixed input, not read back by any caller, so it is NOT part of the contract. pc/SP are
 * NOT compared (the oracle drives them through the dropped call/stack ABI). The one input, IX, is
 * seated identically on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted) — over several IX bases oracle == blankActorSpriteBand in RAM(−stack) and in HL and B,
 *      with the module SETTING HL and B.
 *   2. WRITE-SET — the oracle's only writes are the 0x17 band cells [IX, IX+0x17), each := 0.
 *   3. TEETH — a twin with a WRONG last filled byte is caught by the RAM diff; a twin returning an
 *      UNDER-ADVANCED HL is rejected by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3553.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3553 as oracle } from "../../translated/loc_3553.js";
import { blankActorSpriteBand } from "../blankActorSpriteBand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BAND_LEN = 0x17;
const DIRT = 0xaa; // a nonzero pre-fill so every zero write is observable
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with IX seated and the band pre-dirtied to DIRT so its clearing is visible. */
function craft(base) {
  const m = BASE.clone();
  m.regs.ix = base & 0xffff;
  m.regs.hl = 0x1234; // sentinels so a bridge that fails to SET the register is caught
  m.regs.b = 0x99;
  for (let i = 0; i < BAND_LEN; i++) m.mem.write8((base + i) & 0xffff, DIRT);
  m.regs.sp = STACK_SCRATCH.hi - 0x10; // dead stack: the oracle's push/pop + rst framing land here
  return m;
}

/** The 0x17 band cells, in order. */
function band(base) {
  const cells = [];
  for (let i = 0; i < BAND_LEN; i++) cells.push((base + i) & 0xffff);
  return cells;
}

// IX bases across work RAM and the sprite/video region; each band stays clear of STACK_SCRATCH.
const BASES = [0x8a80, 0x8b00, 0x8be8, 0x8840, 0x8548];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted IX bases — blankActorSpriteBand == oracle in RAM (−stack) + HL + B", () => {
  for (const base of BASES) {
    const o = craft(base);
    const c = craft(base);
    oracle(o);
    const ret = blankActorSpriteBand(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `base ${hx(base)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `base ${hx(base)}: HL return matches oracle`);
    // SIDE-EFFECT arms: the fill helper must SET HL (advanced pointer) and B (drained to 0).
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `base ${hx(base)}: module must SET HL`);
    assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `base ${hx(base)}: module must SET B`);
    assert.equal(c.regs.hl & 0xffff, (base + BAND_LEN) & 0xffff, `base ${hx(base)}: HL = IX + 0x17`);
    assert.equal(c.regs.b & 0xff, 0x00, `base ${hx(base)}: B drained to 0`);
  }
  console.log(`  EQUAL: ${BASES.length} crafted bases identical (RAM −stack + HL + B)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only writes are the 0x17 band cells := 0", () => {
  const base = BASES[0];
  const cells = band(base);
  const m = craft(base);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's push/pop + rst framing lands in the dead stack
    changed.push({ addr, to: a1[off] });
  }
  const addrs = new Set(changed.map((ch) => ch.addr));
  assert.equal(changed.length, BAND_LEN, `expected ${BAND_LEN} band writes, got ${changed.length}`);
  for (const cell of cells) assert.ok(addrs.has(cell), `expected a write at ${hx(cell)}`);
  for (const ch of changed) assert.equal(ch.to, 0x00, `band cell ${hx(ch.addr)} must be 0, got ${ch.to}`);
  console.log(`  WRITE-SET: ${hx(cells[0])}..${hx(cells[BAND_LEN - 1])} := 0 (${BAND_LEN} cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong last band byte is CAUGHT by the RAM diff", () => {
  const base = BASES[0];
  const last = (base + BAND_LEN - 1) & 0xffff;
  const o = craft(base);
  const c = craft(base);
  oracle(o);
  blankActorSpriteBand(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(last, DIRT); // BUG: last cell must be 0, not DIRT
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong last band byte — it is worthless");
  assert.equal(d.addr, last, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(last)})`);
  console.log(`  TEETH/RAM: wrong last byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an under-advanced HL is REJECTED by the live-out check", () => {
  const base = BASES[0];
  const o = craft(base);
  const c = craft(base);
  oracle(o);
  const ret = blankActorSpriteBand(c);
  assert.equal(ret & 0xffff, o.regs.hl & 0xffff, "sanity: the module's HL matches the oracle");
  // One byte short of the run end is a plausible bug the === check must reject.
  assert.notEqual((base + BAND_LEN - 1) & 0xffff, o.regs.hl & 0xffff, "the check must reject an under-advanced HL");
  console.log(`  TEETH/HL: module HL ${hx(ret)} == oracle; an under-advanced ${hx((base + BAND_LEN - 1) & 0xffff)} is rejected`);
});
