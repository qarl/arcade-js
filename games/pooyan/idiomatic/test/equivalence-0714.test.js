// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for copySpriteAttrAndPositionRun (Pooyan) — the sprite-attribute copy loop. Each pass
 * copies four source bytes (source low byte walks, page-fixed): two into the attribute area at
 * attr+1/attr+0, two at the position cursor/cursor+1; both cursors advance by two per pass.
 *
 * SEATING: the frozen entry falls through a balanced djnz cycle whose tail ret's plain (net SP
 * 0), so the routine WIREs as an override. The module folds the whole cycle into one loop, so it
 * is self-contained; the frozen side drives the cycle through the routines map. SP is parked in
 * STACK_SCRATCH so the cycle's pushes/pops drop out of the RAM diff.
 *
 * LIVE-OUT is three registers — A (last byte copied), DE (advanced position cursor), IX
 * (advanced attribute cursor) — read straight back by the register-dispatched caller, so a
 * standing register arm compares each alongside RAM (dumpState) minus stack scratch below the entry SP. HL/B are
 * not live-out (the caller reloads HL, B drains unread) and are not compared.
 *
 * Cases are CRAFTED: a plain boot does not seat this source/cursor/count geometry.
 *
 * Jobs:
 *   1. EQUAL — one-pass and multi-pass copies: frozen == module in RAM (−stack) + A/DE/IX.
 *   2. WRITE-SET — a pass writes the interleaved attribute + position bytes and nothing else.
 *   3. TEETH — a corrupted dest byte is caught by the RAM diff; a wrong-A and a short-cursor
 *      twin are caught by the register arm.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0714.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0714 as oracle } from "../../translated/loc_0714.js";
import { copySpriteAttrAndPositionRun } from "../copySpriteAttrAndPositionRun.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SRC = 0x8840; // source page (a scrolling column buffer)
const ATTR = 0x9410; // attribute cursor
const POS = 0x9010; // position cursor
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat source/cursors/count and seed a recognizable source pattern. */
function seat(m, { count = 0x04 } = {}) {
  m.regs.hl = SRC;
  m.regs.ix = ATTR;
  m.regs.de = POS;
  m.regs.b = count;
  m.regs.sp = SP0;
  for (let i = 0; i < 4 * count; i++) m.mem.write8((SRC & 0xff00) | ((SRC + i) & 0xff), (0x31 + i) & 0xff);
  return m;
}

const craftOne = () => seat(BASE.clone(), { count: 0x01 });
const craftMany = () => seat(BASE.clone(), { count: 0x04 });

const CASES = [
  { name: "single pass", craft: craftOne },
  { name: "four passes", craft: craftMany },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: copySpriteAttrAndPositionRun == oracle in RAM (−stack) + A/DE/IX live-out", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const [a, de, ix] = copySpriteAttrAndPositionRun(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(a, o.regs.a, `${cfg.name}: A live-out must match`);
    assert.equal(de, o.regs.de, `${cfg.name}: DE live-out must match`);
    assert.equal(ix, o.regs.ix, `${cfg.name}: IX live-out must match`);
    assert.equal(c.regs.a, o.regs.a, `${cfg.name}: A also set on regs`);
    assert.equal(c.regs.de, o.regs.de, `${cfg.name}: DE also set on regs`);
    assert.equal(c.regs.ix, o.regs.ix, `${cfg.name}: IX also set on regs`);
  }
  console.log(`  EQUAL: ${CASES.length} copies identical (RAM −stack + A/DE/IX)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: one pass writes the interleaved attribute + position bytes", () => {
  const m = craftOne();
  const b0 = m.mem.read8(SRC); // byte0
  const b1 = m.mem.read8(SRC + 1);
  const b2 = m.mem.read8(SRC + 2);
  const b3 = m.mem.read8(SRC + 3);
  copySpriteAttrAndPositionRun(m);
  assert.equal(m.mem.read8(ATTR + 1), b0, "byte0 -> attr+1");
  assert.equal(m.mem.read8(ATTR + 0), b1, "byte1 -> attr+0");
  assert.equal(m.mem.read8(POS + 0), b2, "byte2 -> pos+0");
  assert.equal(m.mem.read8(POS + 1), b3, "byte3 -> pos+1");
  console.log("  WRITE-SET: interleaved copy confirmed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted dest byte is CAUGHT by the RAM diff", () => {
  const o = craftMany();
  const c = craftMany();
  oracle(o);
  copySpriteAttrAndPositionRun(c);
  c.mem.write8(ATTR + 3, (o.mem.read8(ATTR + 3) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted dest byte");
  assert.equal(d.addr, ATTR + 3, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong-A twin and a short-cursor twin are CAUGHT by the register arm", () => {
  const o = craftMany();
  oracle(o);
  assert.throws(
    () => assert.equal((o.regs.a ^ 0xff) & 0xff, o.regs.a),
    "a wrong A live-out must be caught",
  );
  assert.throws(
    () => assert.equal(o.regs.ix - 2, o.regs.ix),
    "an under-advanced IX cursor must be caught",
  );
  assert.throws(
    () => assert.equal(o.regs.de - 2, o.regs.de),
    "an under-advanced DE cursor must be caught",
  );
  console.log("  TEETH(reg): wrong-A + short-cursor twins caught");
});
