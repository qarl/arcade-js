// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for mergeActorAttributeByte (ROM 0x36de) — "build an actor attribute byte": index the
 * primary ROM table (ACTOR_ATTR_BASE_TABLE) by 2*DIFFICULTY_DSW + ROUND_COUNTER-clamped-to-0x0e,
 * step the value down past the record's +0x16/+0x13 bit-0 flags and its +0x06 phase gate, bias it
 * up by 3 when STAGE_COUNTDOWN < 4, then OR the merge-table (ACTOR_ATTR_MERGE_TABLE) lookup into the
 * record's +0x08 attribute byte.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM, so every case uses
 * a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The contract is MEMORY ONLY (the +0x08 byte). The register leftovers (A = merged, HL = the merge
 * lookup pointer, B = the pre-bias value) are NOT declared live-out: the sole reach is spawnObjectIntoFreeSlot,
 * which tail-jumps to spawnActorSlotFromTemplate, and spawnActorSlotFromTemplate discards A/B/HL (it does `xor a` before using A and
 * never reads B/HL) while reading C — which mergeActorAttributeByte never touches. pc/SP/cycles are not compared.
 *
 * Inputs (record fields + three globals) are poked identically per side; the two ROM tables are
 * real, so the oracle is the ground truth for every branch. Jobs: 1. EQUAL over a branch-covering
 * sweep; 2. WRITE-SET (the only write is +0x08); 3. TEETH (a wrong +0x08 byte).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-36de.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_36de as oracle } from "../../translated/loc_36de.js";
import { mergeActorAttributeByte } from "../mergeActorAttributeByte.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ROUND_COUNTER, DIFFICULTY_DSW, STAGE_COUNTDOWN } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD = 0x8a80;
const ATTR = RECORD + 0x08; // the attribute byte the routine writes
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft({ round, diff, stage, f16, f13, phase, attr }) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.regs.ix = RECORD;
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(DIFFICULTY_DSW, diff);
  m.mem.write8(STAGE_COUNTDOWN, stage);
  m.mem.write8(RECORD + 0x16, f16);
  m.mem.write8(RECORD + 0x13, f13);
  m.mem.write8(RECORD + 0x06, phase);
  m.mem.write8(ATTR, attr);
  return m;
}

// Branch-covering sweep: no gates / round-clamp / f16 / f16+f13 / phase<9 / stage<4 / all-armed at
// several diffs (varying the ROM table value) / pre-set attr (OR-merge preserves bits).
const CASES = [
  { round: 0x01, diff: 0x00, stage: 0x40, f16: 0x00, f13: 0x00, phase: 0x20, attr: 0x00 },
  { round: 0x07, diff: 0x03, stage: 0x40, f16: 0x00, f13: 0x00, phase: 0x20, attr: 0x00 },
  { round: 0x0f, diff: 0x02, stage: 0x40, f16: 0x00, f13: 0x00, phase: 0x20, attr: 0x00 },
  { round: 0x20, diff: 0x07, stage: 0x40, f16: 0x00, f13: 0x00, phase: 0x20, attr: 0x00 },
  { round: 0x03, diff: 0x01, stage: 0x40, f16: 0x01, f13: 0x00, phase: 0x20, attr: 0x00 },
  { round: 0x03, diff: 0x01, stage: 0x40, f16: 0x03, f13: 0x00, phase: 0x20, attr: 0x00 },
  { round: 0x02, diff: 0x02, stage: 0x40, f16: 0x01, f13: 0x01, phase: 0x20, attr: 0x00 },
  { round: 0x05, diff: 0x04, stage: 0x40, f16: 0x01, f13: 0x01, phase: 0x20, attr: 0x00 },
  { round: 0x04, diff: 0x02, stage: 0x40, f16: 0x00, f13: 0x00, phase: 0x05, attr: 0x00 },
  { round: 0x04, diff: 0x02, stage: 0x40, f16: 0x01, f13: 0x00, phase: 0x00, attr: 0x00 },
  { round: 0x06, diff: 0x03, stage: 0x00, f16: 0x00, f13: 0x00, phase: 0x20, attr: 0x00 },
  { round: 0x06, diff: 0x03, stage: 0x03, f16: 0x01, f13: 0x01, phase: 0x05, attr: 0x00 },
  { round: 0x01, diff: 0x00, stage: 0x02, f16: 0x01, f13: 0x01, phase: 0x02, attr: 0x00 },
  { round: 0x01, diff: 0x05, stage: 0x02, f16: 0x01, f13: 0x01, phase: 0x02, attr: 0x00 },
  { round: 0x0e, diff: 0x07, stage: 0x01, f16: 0x01, f13: 0x01, phase: 0x08, attr: 0x00 },
  { round: 0x02, diff: 0x02, stage: 0x40, f16: 0x00, f13: 0x00, phase: 0x20, attr: 0x81 },
  { round: 0x02, diff: 0x02, stage: 0x03, f16: 0x01, f13: 0x01, phase: 0x05, attr: 0x5a },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: branch sweep — mergeActorAttributeByte == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse);
    const c = craft(cse);
    oracle(o);
    mergeActorAttributeByte(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (${JSON.stringify(cse)}): oracle=${d.a} idiom=${d.b}`);
    // The written attribute byte agrees with the oracle's (OR-merge preserved any pre-set bits).
    assert.equal(c.mem.read8(ATTR), o.mem.read8(ATTR), `+0x08 mismatch (${JSON.stringify(cse)})`);
    assert.equal((o.mem.read8(ATTR) & cse.attr), cse.attr, `OR-merge must preserve pre-set bits (${JSON.stringify(cse)})`);
  }
  console.log(`  EQUAL: ${CASES.length} branch cases identical (RAM −stack), +0x08 matches oracle`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the only RAM write is the +0x08 attribute byte", () => {
  for (const cse of CASES) {
    const before = craft(cse);
    const after = craft(cse);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue;
      assert.equal(addr, ATTR, `unexpected write at ${hx(addr)} (${JSON.stringify(cse)})`);
    }
  }
  console.log(`  WRITE-SET: every change across ${CASES.length} cases is at ${hx(ATTR)} (+0x08)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong +0x08 byte is CAUGHT by the RAM diff", () => {
  const cse = CASES[12]; // all gates armed, stage bias
  const o = craft(cse);
  const c = craft(cse);
  oracle(o);
  mergeActorAttributeByte(c);
  c.mem.write8(ATTR, (o.mem.read8(ATTR) ^ 0xff) & 0xff); // BUG: corrupt the attribute byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong attribute byte — it is worthless");
  assert.equal(d.addr, ATTR, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(ATTR)})`);
  console.log(`  TEETH: wrong +0x08 byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
