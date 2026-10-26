// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifyRomChecksum (ROM 0x3fe9, Pooyan) — the state-10 dispatch
 * handler / ROM-integrity guard: sum 16 ROM bytes descending from 0x7780 into a byte, then
 * inspect its shape. A healthy image (bit0 clear, bit5 set, bit7 set) returns untouched; any
 * deviation increments a tamper counter at 0x8a39.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The only RAM effect is the conditional
 * tamper-counter increment, so the oracle runs on one FRESH clone and the module on another,
 * compared on:  RAM (dumpState, minus stack scratch below the entry SP).  No register live-out — this is a
 * dispatch handler that rets to the dispatcher; memory is the whole contract.
 *
 * The intact ROM image sums to 0xA0 (bit0=0, bit5=1, bit7=1) = HEALTHY, so on the real ROM the
 * guard writes nothing. To exercise the tamper path we build a machine over a CORRUPTED ROM
 * copy — one byte in the checksum block bumped by 1 so the sum's bit0 flips — which forces the
 * increment. ROM lives outside dumpState, so only the 0x8a39 write shows in the diff.
 *
 * Jobs:
 *   1. HEALTHY (intact ROM) — oracle and module both leave the counter untouched.
 *   2. TAMPER (corrupted ROM) — oracle and module both increment 0x8a39 identically.
 *   3. WRITE-SET — on the tamper path the oracle's ONLY RAM write is 0x8a39.
 *   4. TEETH — on the tamper path, a twin that skips the increment MUST be caught at 0x8a39;
 *      on the healthy path, a twin that increments anyway MUST be caught at 0x8a39.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3fe9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3fe9 as oracle } from "../../translated/loc_3fe9.js";
import { verifyRomChecksum } from "../verifyRomChecksum.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const CHK_TOP = 0x7780; //   top of the 16-byte checksum block (summed descending)
const TAMPER = 0x8a39; //    the tamper counter this guard bumps
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A machine over the intact ROM, tamper counter seeded so an increment is observable. */
function craftHealthy(seed = 0x00) {
  const m = new Machine(ROM);
  m.mem.write8(TAMPER, seed);
  m.regs.sp = 0x8fe0; // dead scratch: the oracle's ret only pops (reads) the word at SP
  return m;
}

/** A machine over a CORRUPTED ROM (one checksum byte +1 -> sum bit0 flips -> tamper path). */
function craftTampered(seed = 0x00) {
  const bad = ROM.slice();
  bad[CHK_TOP] = (bad[CHK_TOP] + 1) & 0xff; // +1 mod 256 flips the running sum's bit0
  const m = new Machine(bad);
  m.mem.write8(TAMPER, seed);
  m.regs.sp = 0x8fe0;
  return m;
}

// -- 1. HEALTHY (intact ROM) --------------------------------------------------

test("HEALTHY: intact ROM — both leave the tamper counter untouched, RAM identical", () => {
  const base = craftHealthy(0x00);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  verifyRomChecksum(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  assert.equal(o.mem.read8(TAMPER), 0x00, "healthy path must NOT touch the tamper counter");
  assert.equal(c.mem.read8(TAMPER), 0x00, "module healthy path must NOT touch the tamper counter");
  console.log("  HEALTHY: intact ROM sums healthy; counter untouched by both");
});

// -- 2. TAMPER (corrupted ROM) ------------------------------------------------

test("TAMPER: corrupted ROM — both increment 0x8a39 identically", () => {
  for (const seed of [0x00, 0x05, 0xff]) {
    const base = craftTampered(seed);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    verifyRomChecksum(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed ${hx(seed)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
    assert.equal(o.mem.read8(TAMPER), (seed + 1) & 0xff, `oracle should bump the counter (seed ${hx(seed)})`);
    assert.equal(c.mem.read8(TAMPER), (seed + 1) & 0xff, `module should bump the counter (seed ${hx(seed)})`);
  }
  console.log("  TAMPER: corrupted ROM increments 0x8a39; oracle and module agree");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: on the tamper path the oracle's only RAM write is 0x8a39", () => {
  const base = craftTampered(0x00);
  const before = base.clone();
  const after = base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, 1, `expected exactly one changed byte, got ${changed.length}`);
  assert.equal(changed[0].addr, TAMPER, `write landed at ${hx(changed[0].addr)} (expected the tamper counter)`);
  console.log(`  WRITE-SET: 1 write, ${hx(TAMPER)} := 0x01`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: on the tamper path a skipped increment is caught at 0x8a39", () => {
  const base = craftTampered(0x00);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  // A twin that FAILS to bump the counter: leave the module's clone as-found (no run).
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped tamper increment — it is worthless");
  assert.equal(d.addr, TAMPER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: skipped increment caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: on the healthy path a spurious increment is caught at 0x8a39", () => {
  const base = craftHealthy(0x00);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  verifyRomChecksum(c);
  c.mem.write8(TAMPER, 0x01); // BUG: bumped the counter on a healthy image

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a spurious increment — it is worthless");
  assert.equal(d.addr, TAMPER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: spurious increment caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
