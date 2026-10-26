// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearTargetActorRecord (ROM 0x221e, Pooyan) — "object-clear helper": HL <- IY,
 * then blank 0x18 bytes at (HL) to 0 via the fill helper (rst 0x10 / fillByteRun), and ret.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine writes work RAM, so
 * every case uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the declared register live-out (HL, B, A).
 *
 * The live-out is derived FROM THE ORACLE's exit state: the fill helper leaves HL = base + 0x18
 * (advanced pointer) and drains B to 0 (its djnz), and `xor a` leaves A = 0 (the cleared fill value);
 * none of AF/BC/HL is restored before the ret, and this is a tail helper reached from per-object
 * steppers, so the safe contract sets and checks all three.
 *
 * Jobs:
 *   1. EQUAL (crafted) — several IY bases: oracle == module in RAM (−stack) and in HL, B, A.
 *   2. WRITE-SET — the oracle's only writes are the 0x18 cells [base, base+0x17], each := 0.
 *   3. CRAFTED (overwrite) — pre-dirty the record to 0xAA identically on both sides; both clear it.
 *   4. TEETH — a twin with a wrong last cleared byte (RAM) and a twin with a wrong returned HL
 *      (live-out) are both caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-221e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_221e as oracle } from "../../translated/loc_221e.js";
import { clearTargetActorRecord } from "../clearTargetActorRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD_LEN = 0x18;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with IY seated at `base` and the record pre-dirtied to `fill`. */
function craft(base, fill) {
  const m = BASE.clone();
  for (let i = 0; i < RECORD_LEN; i++) m.mem.write8((base + i) & 0xffff, fill);
  m.regs.iy = base & 0xffff;
  m.regs.b = 0x99; // a non-zero B so the drained B=0 live-out is a real check
  m.regs.a = 0x55; // a non-zero A so the cleared A=0 live-out is a real check
  m.regs.hl = 0x0000; // a wrong HL so the advanced-pointer live-out is a real check
  m.regs.sp = 0x8ffe; // dead stack: the oracle's push/pop framing touches excluded RAM only
  return m;
}

// Work-RAM record bases, disjoint from the stack window and from each other's footprint.
const BASES = [0x8b70, 0x8c30, 0x8a80, 0x8be8];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted IY bases — clearTargetActorRecord == oracle in RAM (−stack) + HL/B/A", () => {
  for (const base of BASES) {
    const o = craft(base, 0xaa);
    const c = craft(base, 0xaa);
    oracle(o);
    const ret = clearTargetActorRecord(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `base ${hx(base)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `base ${hx(base)}: HL return mismatch`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `base ${hx(base)}: module must SET HL`);
    assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `base ${hx(base)}: B live-out mismatch (expect 0)`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `base ${hx(base)}: A live-out mismatch (expect 0)`);
  }
  console.log(`  EQUAL: ${BASES.length} bases identical (RAM −stack + HL/B/A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only writes are the 0x18 record cells := 0", () => {
  const base = BASES[0];
  const before = craft(base, 0xaa);
  const after = craft(base, 0xaa);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  // Exclude the dead stack: the oracle's push/pop framing (push iy / pop hl, the rst return) writes
  // there while the cycle-free module never touches the stack.
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    changed.push({ addr, to: a1[off] });
  }
  assert.equal(changed.length, RECORD_LEN, `expected exactly ${RECORD_LEN} written cells, got ${changed.length}`);
  const addrs = new Set(changed.map((ch) => ch.addr));
  for (let i = 0; i < RECORD_LEN; i++) assert.ok(addrs.has(base + i), `expected a write at ${hx(base + i)}`);
  for (const ch of changed) assert.equal(ch.to, 0x00, `cell ${hx(ch.addr)} must be 0, got ${ch.to}`);
  console.log(`  WRITE-SET: [${hx(base)}..${hx(base + RECORD_LEN - 1)}] := 0 (${RECORD_LEN} cells)`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: a pre-dirtied record is cleared to 0 identically", () => {
  const base = BASES[1];
  const o = craft(base, 0xaa);
  const c = craft(base, 0xaa);
  oracle(o);
  clearTargetActorRecord(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  for (let i = 0; i < RECORD_LEN; i++) assert.equal(c.mem.read8(base + i), 0x00, `cell not cleared (${hx(base + i)})`);
  console.log(`  CRAFTED: [${hx(base)}..] dirtied to 0xAA -> both clear to 0`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong last cleared byte is CAUGHT by the RAM diff", () => {
  const base = BASES[0];
  const o = craft(base, 0xaa);
  const c = craft(base, 0xaa);
  oracle(o);
  clearTargetActorRecord(c);
  const last = base + RECORD_LEN - 1;
  c.mem.write8(last, 0x01); // BUG: last cell must be 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong last byte — it is worthless");
  assert.equal(d.addr, last, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): wrong last byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned HL is CAUGHT by the live-out check", () => {
  const base = BASES[0];
  const o = craft(base, 0xaa);
  const c = craft(base, 0xaa);
  oracle(o);
  const ret = clearTargetActorRecord(c);
  assert.equal(ret & 0xffff, o.regs.hl & 0xffff, "sanity: module HL matches the oracle");
  const shortHl = (base + RECORD_LEN - 1) & 0xffff; // one cell short of base+0x18
  assert.notEqual(shortHl, o.regs.hl & 0xffff, "the live-out check must reject an under-advanced HL");
  console.log(`  TEETH(HL): module HL ${hx(ret)} == oracle; ${hx(shortHl)} is rejected`);
});
