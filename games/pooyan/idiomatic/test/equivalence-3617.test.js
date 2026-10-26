// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for enterPreSpawnGateIfBelowLimit (ROM 0x3617, Pooyan) — the pre-spawn guard. When B is below
 * 0x20 it tails to the frozen pre-spawn gate (0x365d); otherwise it bails, leaving A = B.
 *
 * SEATING: TAIL-CALL / BALANCED. enterPreSpawnGateIfBelowLimit is reached by tail-jump from the target-tile resolver, so
 * both the bail (a plain ret) and the tail run in that caller's frame — the omitted-ret seam seats
 * both (net move 0 on the bail, +2 through the frozen gate on the tail). The gate (0x365d) is NOT
 * lifted this batch, so the module keeps m.call(0x365d); the oracle drives the same frozen gate, so
 * both walk identical downstream code.
 *
 * LIVE-OUT: A. On the bail path the oracle leaves A = B (ld a,b then ret nc), so the module sets it
 * through the return; the test compares A as well as RAM (dumpState) minus stack scratch below the entry SP.
 *
 * Cases are CRAFTED: B and the gate's scan bit (ix+0x0b) are poked. B>=0x20 bails; B<0x20 with the
 * scan bit clear tails through the gate into its scan-window seat (writes RAM).
 *
 * Jobs:
 *   1. EQUAL — bail (B=0x25) and tail (B=0x10): oracle == module in RAM (−stack) AND in A.
 *   2. OBSERVABLE — the tail path writes RAM (the equal result is not vacuous).
 *   3. TEETH — (a) an A-drop twin (bails without setting A) is caught by the A compare; (b) an
 *      always-tail twin (ignores the B>=0x20 guard) diverges on the bail input; (c) a wrong seeded
 *      byte on the tail path is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3617.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3617 as oracle } from "../../translated/loc_3617.js";
import { enterPreSpawnGateIfBelowLimit } from "../enterPreSpawnGateIfBelowLimit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { ENEMY_ACTOR_TABLE, STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE; // IX record used by the gate's scan
const SP0 = 0x8ff0;
const ENTRY_A = 0x99; // a distinctive entry A so a dropped A live-out shows

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft(b, scanBit) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.push16(0xabcd); // a return for the frozen gate's ret (dead-stack)
  m.regs.a = ENTRY_A;
  m.regs.b = b;
  m.regs.ix = REC;
  if (scanBit !== undefined) m.mem.write8(REC + 0x0b, scanBit);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, b, scanBit] of [["bail (B=0x25)", 0x25, undefined], ["tail (B=0x10)", 0x10, 0x00]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack) and in A`, () => {
    const o = craft(b, scanBit);
    const c = craft(b, scanBit);
    oracle(o);
    enterPreSpawnGateIfBelowLimit(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a, o.regs.a, `${label}: A live-out diverged: oracle=${hx(o.regs.a)} module=${hx(c.regs.a)}`);
    console.log(`  EQUAL ${label}: RAM identical, A=${hx(o.regs.a)}`);
  });
}

// -- 2. OBSERVABLE ------------------------------------------------------------

test("OBSERVABLE: the tail path writes RAM (equal is not vacuous)", () => {
  const o = craft(0x10, 0x00);
  oracle(o);
  assert.notEqual(ramDiffMinusStack(o, craft(0x10, 0x00)), null, "the tail must write RAM (else EQUAL proves nothing)");
  console.log("  OBSERVABLE: tail path writes RAM");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: an A-drop twin (bails without setting A) is CAUGHT by the A compare", () => {
  function aDropTwin(m, b = m.regs.b) {
    if (b >= 0x20) return; // WRONG: leaves A as the entry value
    return m.call(0x365d);
  }
  const o = craft(0x25, undefined);
  const t = craft(0x25, undefined);
  oracle(o);
  aDropTwin(t);
  assert.notEqual(t.regs.a, o.regs.a, "the A compare FAILED to catch a dropped live-out");
  console.log(`  TEETH(A): dropped live-out caught (oracle A=${hx(o.regs.a)}, twin A=${hx(t.regs.a)})`);
});

test("TEETH: an always-tail twin (ignores the B>=0x20 guard) diverges on the bail input", () => {
  function alwaysTail(m) {
    return m.call(0x365d); // WRONG: never bails
  }
  const o = craft(0x25, 0x00); // oracle bails, RAM unchanged
  const t = craft(0x25, 0x00);
  oracle(o);
  alwaysTail(t);
  assert.notEqual(ramDiffMinusStack(o, t), null, "the gate FAILED to catch a skipped guard");
  console.log("  TEETH(guard): always-tail twin caught on the bail input");
});

test("TEETH: a wrong seeded byte on the tail path is CAUGHT by the RAM diff", () => {
  const o = craft(0x10, 0x00);
  const c = craft(0x10, 0x00);
  oracle(o);
  enterPreSpawnGateIfBelowLimit(c);
  const d0 = firstStateDiff(o.dumpState(), BASE.dumpState(), (off) => o.stateOffsetToAddr(off), inDeadStack);
  const target = d0 ? d0.addr : REC;
  c.mem.write8(target, (o.mem.read8(target) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, target, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});
