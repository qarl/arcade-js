// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearColumnLimitAndArmTurnAnimation (ROM 0x423a) — interior-entry arm: clear the
 * turn-column limit (0x8d4b := 0), then tail-call loc_381e (setActorAnimation) to point the
 * record at the 0x4212 animation script (ix+0x0c := 0x12, ix+0x0d := 0x42, ix+0x0e := 0).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * WRITES a flag + the record, so each case uses a FRESH clone per side: the oracle runs on
 * one clone, clearColumnLimitAndArmTurnAnimation on another, compared on the go-forward contract — RAM (dumpState) minus
 * stack scratch below the entry SP. pc/SP/cycles are NOT compared. clearColumnLimitAndArmTurnAnimation has NO consumed register live-out.
 * The oracle tail-jumps into loc_381e whose terminal ret only pops (reads) the stack.
 *
 * The routine takes no inputs (it writes fixed values), so every case is CRAFTED: IX seated
 * at a work-RAM actor slot with the record window and the flag pre-dirtied to a sentinel
 * identically on both sides, so the fixed writes — including the zero writes — are observable.
 *
 * Jobs:
 *   1. EQUAL (crafted) — across sentinels clearColumnLimitAndArmTurnAnimation == oracle in RAM (-stack).
 *   2. WRITE-SET — the oracle writes exactly four cells: the flag and the three anim bytes.
 *   3. TEETH — a nonzero turn-column-limit twin is CAUGHT at 0x8d4b; a wrong anim high byte
 *      is CAUGHT at ix+0x0d.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-423a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_423a as oracle } from "../../translated/loc_423a.js";
import { clearColumnLimitAndArmTurnAnimation } from "../clearColumnLimitAndArmTurnAnimation.js";
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
const TURN_COLUMN_LIMIT = 0x8d4b;
const ANIM_SCRIPT = 0x4212; // stored little-endian into ix+0x0c/0x0d

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
  m.mem.write8(TURN_COLUMN_LIMIT, sentinel & 0xff);
  m.regs.sp = 0x8ffe;
  return m;
}

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted sentinels — clearColumnLimitAndArmTurnAnimation == oracle in RAM (−stack)", () => {
  for (const sentinel of [0xaa, 0x00, 0xff]) {
    const o = craft(sentinel);
    const c = craft(sentinel);
    oracle(o);
    clearColumnLimitAndArmTurnAnimation(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (sentinel=${hx(sentinel)})`);
  }
  console.log("  EQUAL: 3 crafted sentinels identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly the flag and the three anim bytes", () => {
  const expected = new Map([
    [TURN_COLUMN_LIMIT, 0x00],
    [(IX + 0x0c) & 0xffff, ANIM_SCRIPT & 0xff],
    [(IX + 0x0d) & 0xffff, ANIM_SCRIPT >> 8],
    [(IX + 0x0e) & 0xffff, 0x00],
  ]);
  const mm = craft(0xaa);
  const b0 = mm.dumpState();
  oracle(mm);
  const a1 = mm.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: mm.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, expected.size, `expected ${expected.size} written cells, got ${changed.length}`);
  for (const { addr, to } of changed) {
    assert.ok(expected.has(addr), `oracle wrote an unexpected cell at ${hx(addr)}`);
    assert.equal(to, expected.get(addr), `${hx(addr)} must be ${hx(expected.get(addr))}, got ${hx(to)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} cells (flag + 3 anim bytes) at documented values`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: leaves the turn-column limit nonzero. */
function brokenTurnLimit(m, rec = m.regs.ix) {
  const { mem8 } = m;
  mem8[TURN_COLUMN_LIMIT] = 0x01; // BUG: must be cleared to 0
  mem8[rec + 0x0c] = ANIM_SCRIPT & 0xff;
  mem8[rec + 0x0d] = ANIM_SCRIPT >> 8;
  mem8[rec + 0x0e] = 0x00;
}

test("TEETH: a nonzero turn-column limit is CAUGHT at 0x8d4b", () => {
  const o = craft(0xaa);
  const c = craft(0xaa);
  oracle(o);
  brokenTurnLimit(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the nonzero turn-column limit");
  assert.equal(d.addr, TURN_COLUMN_LIMIT, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/flag: nonzero limit caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong anim high byte is CAUGHT at ix+0x0d", () => {
  const o = craft(0xaa);
  const c = craft(0xaa);
  oracle(o);
  clearColumnLimitAndArmTurnAnimation(c);
  c.mem.write8(IX + 0x0d, 0x00); // BUG: must hold the anim-script high byte 0x42
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong anim byte");
  assert.equal(d.addr, (IX + 0x0d) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/anim: wrong anim high byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
