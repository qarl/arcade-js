// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advancePairedDescendingObjectStep (ROM 0x69c6, Pooyan) — "advance a paired (ix/iy) descending
 * object one step". Returns unless the ix record is active (+0) and idle (+2 == 0). Runs the
 * animation sequencer for the ix record, lowers each record's 16-bit position (+6:+5) by its delta
 * (+9) with a borrow into the high byte, then on the ix high byte: 6 bumps the blink-phase gate
 * (0x892b) once while it reads 0; 0 wipes both 0x18-byte records; anything else leaves them
 * descending.
 *
 * Cycle-free memory-equivalence gate: writes work RAM, so a FRESH clone per side, compared on RAM
 * (dumpState minus stack scratch below the entry SP). LIVE-OUT is memory only — a caller sweep reloads ix/iy per pair
 * and consumes no register result — so no register is compared. The sequencer / wipe helpers frame
 * their work on the stack, which is excluded. To keep the sequencer deterministic every scenario
 * seats a non-zero animation hold (+0x0e), so it only decrements that field.
 *
 * Jobs:
 *   1. EQUAL (crafted) — inactive, busy, descend (no borrow / borrow), gate-bump (fresh / already
 *      set), and wipe; oracle == module in RAM (−stack), with independently-derived spot checks.
 *   2. WRITE-SET — the descend-no-borrow path writes exactly {ix+5, ix+0x0e, iy+5}.
 *   3. TEETH — a wrong descended position byte and an incomplete wipe are both caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-69c6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_69c6 as oracle } from "../../translated/loc_69c6.js";
import { advancePairedDescendingObjectStep } from "../advancePairedDescendingObjectStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, BLINK_PHASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD_SIZE = 0x18;
const IX_REC = 0x8b00;
const IY_REC = 0x8b30;
const FILL_IX = 0xa5; // pre-dirty pattern so a wipe is a real, observable change
const FILL_IY = 0x5a;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function pokeRecord(m, base, fields) {
  for (const [off, val] of Object.entries(fields)) m.mem.write8((base + Number(off)) & 0xffff, val);
}

/** Fresh clone: both records pre-dirtied, then the scenario's fields + gate seated, ix/iy pointed. */
function craft(scn) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  for (let i = 0; i < RECORD_SIZE; i++) {
    m.mem.write8(IX_REC + i, FILL_IX);
    m.mem.write8(IY_REC + i, FILL_IY);
  }
  pokeRecord(m, IX_REC, scn.ix);
  if (scn.iy) pokeRecord(m, IY_REC, scn.iy);
  m.mem.write8(BLINK_PHASE, scn.gate ?? 0);
  m.regs.ix = IX_REC;
  m.regs.iy = IY_REC;
  return m;
}

const HOLD = { 0x0e: 0x05 }; // non-zero animation hold -> sequencer just decrements +0x0e

const SCENARIOS = [
  { name: "inactive", ix: { 0: 0x00, ...HOLD } },
  { name: "sub-state busy", ix: { 0: 0x01, 2: 0x03, ...HOLD } },
  { name: "descend, no borrow",
    ix: { 0: 0x01, 2: 0x00, 5: 0x40, 6: 0x03, 9: 0x10, ...HOLD },
    iy: { 5: 0x50, 6: 0x02, 9: 0x20 },
    verify: (m) => { assertByte(m, IX_REC + 5, 0x30); assertByte(m, IX_REC + 6, 0x03); assertByte(m, IY_REC + 5, 0x30); assertByte(m, IX_REC + 0x0e, 0x04); } },
  { name: "descend, borrow",
    ix: { 0: 0x01, 2: 0x00, 5: 0x05, 6: 0x03, 9: 0x10, ...HOLD },
    iy: { 5: 0x05, 6: 0x04, 9: 0x10 },
    verify: (m) => { assertByte(m, IX_REC + 5, 0xf5); assertByte(m, IX_REC + 6, 0x02); assertByte(m, IY_REC + 5, 0xf5); assertByte(m, IY_REC + 6, 0x03); } },
  { name: "descend, diff==0 (no borrow at the boundary)",
    ix: { 0: 0x01, 2: 0x00, 5: 0x10, 6: 0x03, 9: 0x10, ...HOLD },
    iy: { 5: 0x20, 6: 0x02, 9: 0x20 },
    verify: (m) => { assertByte(m, IX_REC + 5, 0x00); assertByte(m, IX_REC + 6, 0x03); assertByte(m, IY_REC + 5, 0x00); assertByte(m, IY_REC + 6, 0x02); } },
  { name: "gate bump (high == 6, gate 0)",
    ix: { 0: 0x01, 2: 0x00, 5: 0x40, 6: 0x06, 9: 0x10, ...HOLD },
    iy: { 5: 0x50, 6: 0x03, 9: 0x20 }, gate: 0x00,
    verify: (m) => { assertByte(m, BLINK_PHASE, 0x01); assertByte(m, IX_REC + 6, 0x06); } },
  { name: "gate already set (high == 6, gate != 0)",
    ix: { 0: 0x01, 2: 0x00, 5: 0x40, 6: 0x06, 9: 0x10, ...HOLD },
    iy: { 5: 0x50, 6: 0x03, 9: 0x20 }, gate: 0x07,
    verify: (m) => { assertByte(m, BLINK_PHASE, 0x07); } },
  { name: "wipe (high borrows to 0)",
    ix: { 0: 0x01, 2: 0x00, 5: 0x05, 6: 0x01, 9: 0x10, ...HOLD },
    iy: { 5: 0x05, 6: 0x02, 9: 0x10 },
    verify: (m) => { for (let i = 0; i < RECORD_SIZE; i++) { assertByte(m, IX_REC + i, 0x00); assertByte(m, IY_REC + i, 0x00); } } },
];

function assertByte(m, addr, val) {
  assert.equal(m.mem.read8(addr), val, `expected ${hx(addr)} == ${hx(val)}, got ${hx(m.mem.read8(addr))}`);
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted scenarios — advancePairedDescendingObjectStep == oracle in RAM (−stack)", () => {
  for (const scn of SCENARIOS) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    advancePairedDescendingObjectStep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    if (scn.verify) scn.verify(c);
  }
  console.log(`  EQUAL: ${SCENARIOS.length} scenarios identical (RAM −stack) + spot checks`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the descend-no-borrow path writes exactly {ix+5, ix+0x0e, iy+5}", () => {
  const scn = SCENARIOS.find((s) => s.name === "descend, no borrow");
  const m = craft(scn);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) changed.push(addr);
  }
  const set = new Set(changed);
  const expected = [IX_REC + 5, IX_REC + 0x0e, IY_REC + 5];
  assert.equal(changed.length, expected.length, `expected ${expected.length} writes, got ${changed.length} (${changed.map(hx)})`);
  for (const cell of expected) assert.ok(set.has(cell), `missing a write at ${hx(cell)}`);
  console.log("  WRITE-SET: ix+5, ix+0x0e (hold), iy+5");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong descended position byte is CAUGHT at ix+5", () => {
  const scn = SCENARIOS.find((s) => s.name === "descend, no borrow");
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advancePairedDescendingObjectStep(c);
  c.mem.write8(IX_REC + 5, (c.mem.read8(IX_REC + 5) ^ 0x01) & 0xff); // BUG: wrong position
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong position byte — it is worthless");
  assert.equal(d.addr, IX_REC + 5, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(pos): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an incomplete record wipe is CAUGHT", () => {
  const scn = SCENARIOS.find((s) => s.name === "wipe (high borrows to 0)");
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advancePairedDescendingObjectStep(c);
  c.mem.write8(IY_REC + 0, 0x01); // BUG: a wiped cell left non-zero
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an incomplete wipe — it is worthless");
  assert.equal(d.addr, IY_REC + 0, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(wipe): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
