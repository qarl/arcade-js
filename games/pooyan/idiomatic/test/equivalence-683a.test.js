// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectToNextStateAndArmAnim (ROM 0x683a) — advance an object to its next state:
 * bump the phase (ix+0x02), zero ix+0x03/ix+0x05, seat ix+0x04 := 0x08 and ix+0x06 := 0x1e,
 * arm the animation from the 0x68ef parameter block via loc_381e (setActorAnimation, writing
 * ix+0x0c := 0xef, ix+0x0d := 0x68, ix+0x0e := 0), then seat ix+0x09 := 0x18.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * WRITES the record, so each case uses a FRESH clone per side: the oracle runs on one clone,
 * advanceObjectToNextStateAndArmAnim on another, compared on the go-forward contract — RAM (dumpState) minus
 * stack scratch below the entry SP. pc/SP/cycles are NOT compared. advanceObjectToNextStateAndArmAnim has NO consumed register live-out.
 * The oracle's `push16 + call 0x381e` writes a return address into STACK_SCRATCH that the
 * idiomatic direct call does not — excluded by contract.
 *
 * The phase field is INCREMENTED, so the record window is pre-dirtied to a sentinel on both
 * sides and swept across sentinels including 0xff, exercising the 8-bit inc wrap. Every case
 * is CRAFTED — the routine takes no other inputs.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — across sentinels advanceObjectToNextStateAndArmAnim == oracle in RAM (-stack).
 *   2. WRITE-SET — the oracle writes exactly nine record cells to their documented values
 *      (the phase = sentinel+1).
 *   3. TEETH — a twin that omits the phase bump is CAUGHT at ix+0x02; a wrong ix+0x09 is
 *      CAUGHT at ix+0x09.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-683a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_683a as oracle } from "../../translated/loc_683a.js";
import { advanceObjectToNextStateAndArmAnim } from "../advanceObjectToNextStateAndArmAnim.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = 0x8a80;
const ANIM_PARAM = 0x68ef; // stored little-endian into ix+0x0c/0x0d

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(sentinel) {
  const m = BASE.clone();
  m.regs.ix = IX;
  for (let off = 0; off <= 0x17; off++) m.mem.write8(IX + off, sentinel & 0xff);
  m.regs.sp = 0x8ffe;
  return m;
}

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted sentinels — advanceObjectToNextStateAndArmAnim == oracle in RAM (−stack)", () => {
  for (const sentinel of [0xaa, 0x00, 0x7f, 0xff]) {
    const o = craft(sentinel);
    const c = craft(sentinel);
    oracle(o);
    advanceObjectToNextStateAndArmAnim(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (sentinel=${hx(sentinel)})`);
  }
  console.log("  EQUAL: 4 crafted sentinels identical (RAM −stack), incl. inc wrap at 0xff");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly nine record cells to their documented values", () => {
  const sentinel = 0xaa;
  const expected = new Map([
    [0x02, (sentinel + 1) & 0xff],
    [0x03, 0x00],
    [0x04, 0x08],
    [0x05, 0x00],
    [0x06, 0x1e],
    [0x09, 0x18],
    [0x0c, ANIM_PARAM & 0xff],
    [0x0d, ANIM_PARAM >> 8],
    [0x0e, 0x00],
  ]);
  const mm = craft(sentinel);
  const b0 = mm.dumpState();
  oracle(mm);
  const a1 = mm.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = mm.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's push16+call return address lands in STACK_SCRATCH, not record state
    changed.push({ addr, to: a1[off] });
  }
  assert.equal(changed.length, expected.size, `expected ${expected.size} written cells, got ${changed.length}`);
  for (const { addr, to } of changed) {
    const rel = addr - IX;
    assert.ok(expected.has(rel), `oracle wrote an unexpected cell at ${hx(addr)} (ix+${hx(rel)})`);
    assert.equal(to, expected.get(rel), `ix+${hx(rel)} must be ${hx(expected.get(rel))}, got ${hx(to)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} record cells written to their documented values`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: does every write EXCEPT the phase bump. */
function brokenNoPhaseBump(m, rec = m.regs.ix) {
  const { mem8 } = m;
  // BUG: forgets `ix+0x02 += 1`
  mem8[rec + 0x03] = 0x00;
  mem8[rec + 0x05] = 0x00;
  mem8[rec + 0x04] = 0x08;
  mem8[rec + 0x06] = 0x1e;
  mem8[rec + 0x0c] = ANIM_PARAM & 0xff;
  mem8[rec + 0x0d] = ANIM_PARAM >> 8;
  mem8[rec + 0x0e] = 0x00;
  mem8[rec + 0x09] = 0x18;
}

test("TEETH: an omitted phase bump is CAUGHT at ix+0x02", () => {
  const o = craft(0xaa);
  const c = craft(0xaa);
  oracle(o);
  brokenNoPhaseBump(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the omitted phase bump");
  assert.equal(d.addr, (IX + 0x02) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/phase: omitted bump caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong ix+0x09 byte is CAUGHT at ix+0x09", () => {
  const o = craft(0xaa);
  const c = craft(0xaa);
  oracle(o);
  advanceObjectToNextStateAndArmAnim(c);
  c.mem.write8(IX + 0x09, 0x00); // BUG: must be seated to 0x18
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ix+0x09 byte");
  assert.equal(d.addr, (IX + 0x09) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/field: wrong ix+0x09 caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
