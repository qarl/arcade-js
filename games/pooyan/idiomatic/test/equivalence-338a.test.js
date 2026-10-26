// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchActiveEnemyActorState (ROM 0x338a, Pooyan) — the low-state per-record dispatcher.
 * It gates on the record's active bit (bit0 of (ix+0)|(ix+1)) and an in-range state ((ix+2)&0x1f
 * below 0x11), then runs the handler for that state via a switch over the seventeen
 * states; the selected handler returns straight to dispatchActiveEnemyActorState's caller.
 *
 * SEATING: net 0 per record — the module is a plain switch (no push, no ret) that seats the record
 * base in IX for the handlers' still-frozen callees; the oracle drives the frozen rst-0x28
 * trampoline into the same handlers, so both walk identical downstream code. Compared on RAM (dumpState) minus stack scratch below the entry SP; the
 * register file is not compared (void dispatch).
 *
 * Cases are CRAFTED: one enemy-actor record is poked active with a chosen state byte. States
 * 0x02-0x06 run cleanly from a boot clone (states 0x00/0x01 target unregistered handlers; state
 * 0x11+ is out of range by design).
 *
 * Jobs:
 *   1. EQUAL — states 0x02-0x06: oracle == module in RAM (−stack).
 *   2. OBSERVABLE — the states do not all produce the same RAM (the dispatch really varies by
 *      index, so the equal result is not vacuous).
 *   3. TEETH — (a) an inactive record (bit0 clear) must NOT dispatch: a no-gate twin that
 *      dispatches anyway is caught; (b) an ignore-index twin (always state 0x02) is caught on
 *      other states; (c) a wrong seeded byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-338a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_338a as oracle } from "../../translated/loc_338a.js";
import { dispatchActiveEnemyActorState } from "../dispatchActiveEnemyActorState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { ENEMY_ACTOR_TABLE, STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE; // craft into record slot 0
const SP0 = 0x8ff0;
const EQUAL_STATES = [0x02, 0x03, 0x04, 0x05, 0x06];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft(state, active = 0x01) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.push16(0xabcd); // a return for the handler's ret (dead-stack)
  m.regs.ix = REC;
  m.mem.write8(REC + 0, active); // bit0 -> active gate
  m.mem.write8(REC + 1, 0x00);
  m.mem.write8(REC + 2, state); // dispatch index
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatchActiveEnemyActorState == oracle in RAM (−stack) for each dispatch state", () => {
  for (const s of EQUAL_STATES) {
    const o = craft(s);
    const c = craft(s);
    oracle(o);
    dispatchActiveEnemyActorState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `state ${hx(s)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${EQUAL_STATES.length} dispatch states identical (RAM −stack)`);
});

// -- 2. OBSERVABLE ------------------------------------------------------------

test("OBSERVABLE: the dispatch varies by index (equal is not vacuous)", () => {
  const a = craft(0x02);
  const b = craft(0x03);
  oracle(a);
  oracle(b);
  assert.notEqual(
    firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off), inDeadStack),
    null,
    "states 0x02 and 0x03 must dispatch to different handlers (else the equal check proves nothing)",
  );
  console.log("  OBSERVABLE: state 0x02 and state 0x03 dispatch differently");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: an inactive record (bit0 clear) must NOT dispatch", () => {
  // Oracle bails (no dispatch); a twin that ignores the gate dispatches and writes -> caught.
  function noGateTwin(m) {
    const rec = m.regs.ix;
    m.regs.a = m.mem8[rec + 2] & 0x1f;
    m.push16(0x339b);
    return m.call(0x0028);
  }
  const o = craft(0x03, 0x00); // inactive
  const t = craft(0x03, 0x00);
  oracle(o);
  noGateTwin(t);
  assert.notEqual(ramDiffMinusStack(o, t), null, "the gate FAILED to catch a dispatch on an inactive record");
  console.log("  TEETH(gate): inactive-record dispatch caught");
});

test("TEETH: an ignore-index twin (always state 0x02) is CAUGHT on other states", () => {
  function idxTwin(m) {
    const rec = m.regs.ix;
    if (((m.mem8[rec + 0] | m.mem8[rec + 1]) & 0x01) === 0) return;
    m.regs.a = 0x02; // WRONG: ignores the record's state
    m.push16(0x339b);
    return m.call(0x0028);
  }
  for (const s of [0x03, 0x05, 0x06]) {
    const o = craft(s);
    const t = craft(s);
    oracle(o);
    idxTwin(t);
    assert.notEqual(ramDiffMinusStack(o, t), null, `state ${hx(s)}: the gate FAILED to catch a wrong dispatch index`);
  }
  console.log("  TEETH(index): ignore-index twin caught on states 0x03/0x05/0x06");
});

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x03);
  const c = craft(0x03);
  oracle(o);
  dispatchActiveEnemyActorState(c);
  const d0 = firstStateDiff(o.dumpState(), BASE.dumpState(), (off) => o.stateOffsetToAddr(off), inDeadStack);
  const target = d0 ? d0.addr : REC + 2;
  c.mem.write8(target, (o.mem.read8(target) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, target, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});
