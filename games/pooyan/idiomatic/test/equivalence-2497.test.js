// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for nudgeLeadActorAndAdvanceOnDelay (ROM 0x2497, Pooyan) — "actor state-2: frame-delay countdown
 * then advance the state and nudge the primary record".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and nudgeLeadActorAndAdvanceOnDelay on the other, compared on RAM (dumpState, minus stack scratch below the entry SP) PLUS the
 * declared register live-out A. pc/SP/cycles are deliberately not compared.
 *
 * INPUTS: IX (the dispatched record; the dispatcher preloads it to the actor table base 0x8a80) and
 * the record's frame-delay field (0x11). On expiry the routine advances the state field (0x02), runs
 * the shape-loader seedFourRecordsAndCopyDisplayTiles (which the machine dispatches idiomatically on the oracle side exactly as
 * the module imports it, so its four tile-field copies match), then steps the primary record's base Y
 * (0x8a84 += 4) and secondary coordinate (0x8a86 -= 6).
 *
 * LIVE-OUT A: the new secondary coordinate left by the final subtract on the expiry path; checked
 * equal to the oracle AND asserted SET on the module's own clone. On the still-counting early return A
 * is untouched (the decrement is memory-only), so both sides leave the seated A.
 *
 * The leaf is not reached in a plain boot, so every case is CRAFTED. The board-clear/tamper flags are
 * left 0 so copyDisplayTilesIntoActorRecords takes its plain copy path (no reset diversion).
 *
 * Jobs:
 *   1. EQUAL — the still-counting early return and the expiry path, oracle == nudgeLeadActorAndAdvanceOnDelay in RAM (−stack)
 *      and A.
 *   2. WRITE-SET — the expiry path writes only within the frame-delay/state/shape-field/primary set.
 *   3. TEETH — a wrong secondary byte (RAM) and a wrong returned A (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2497.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2497 as oracle } from "../../translated/loc_2497.js";
import { nudgeLeadActorAndAdvanceOnDelay } from "../nudgeLeadActorAndAdvanceOnDelay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ACTOR_TABLE = 0x8a80;
const OFF_STATE = 0x02;
const OFF_BASE_Y = 0x04;
const OFF_SECONDARY = 0x06;
const OFF_DELAY = 0x11;
const RECORD_STRIDE = 0x18;
const BOARD_CLEAR_FLAG = 0x89e5;
const TAMPER_STRIKES_TERMINATOR = 0x8df9;
const SEED_A = 0x5a; // an arbitrary seated A to prove the early return leaves it untouched

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with IX=ACTOR_TABLE and the relevant fields/flags seated from `f`. */
function craft(f) {
  const m = BASE.clone();
  m.regs.ix = ACTOR_TABLE;
  m.regs.a = SEED_A;
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; the oracle's call/ret only touch it there
  m.mem8[BOARD_CLEAR_FLAG] = 0x00;
  m.mem8[TAMPER_STRIKES_TERMINATOR] = 0x00;
  m.mem8[ACTOR_TABLE + OFF_DELAY] = f.delay;
  m.mem8[ACTOR_TABLE + OFF_STATE] = f.state ?? 0x02;
  m.mem8[ACTOR_TABLE + OFF_BASE_Y] = f.baseY ?? 0x20;
  m.mem8[ACTOR_TABLE + OFF_SECONDARY] = f.secondary ?? 0x30;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: still-counting and expiry paths — nudgeLeadActorAndAdvanceOnDelay == oracle in RAM (−stack) + A", () => {
  const cases = [
    { name: "still counting (delay 0x05 -> 0x04)", f: { delay: 0x05 } },
    { name: "expiry (delay 0x01 -> 0x00, advance + nudge)", f: { delay: 0x01 } },
  ];
  for (const cse of cases) {
    const o = craft(cse.f);
    oracle(o);
    const c = craft(cse.f);
    nudgeLeadActorAndAdvanceOnDelay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `[${cse.name}] A live-out mismatch`);
  }
  // The still-counting path must leave the seated A untouched (decrement is memory-only).
  const still = craft({ delay: 0x05 });
  nudgeLeadActorAndAdvanceOnDelay(still);
  assert.equal(still.regs.a & 0xff, SEED_A, "the early return must leave A untouched");
  console.log(`  EQUAL: ${cases.length} paths identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the expiry path writes only within its documented footprint", () => {
  const shapeFields = [0, 1, 2, 3].map((i) => ACTOR_TABLE + i * RECORD_STRIDE + 0x0f);
  const footprint = new Set([
    ACTOR_TABLE + OFF_DELAY, ACTOR_TABLE + OFF_STATE, ACTOR_TABLE + OFF_BASE_Y, ACTOR_TABLE + OFF_SECONDARY,
    ...shapeFields,
  ]);

  const before = craft({ delay: 0x01, state: 0x02, baseY: 0x20, secondary: 0x30 });
  const after = craft({ delay: 0x01, state: 0x02, baseY: 0x20, secondary: 0x30 });
  const b = before.dumpState();
  oracle(after);
  const a = after.dumpState();

  const changed = [];
  for (let off = 0; off < b.length; off++) {
    const ad = after.stateOffsetToAddr(off);
    if (b[off] !== a[off] && !inDeadStack(ad)) changed.push(ad);
  }
  for (const ad of changed) assert.ok(footprint.has(ad), `write outside the documented footprint at ${hx(ad)}`);
  assert.equal(after.mem8[ACTOR_TABLE + OFF_DELAY], 0x00, "frame delay drained to 0");
  assert.equal(after.mem8[ACTOR_TABLE + OFF_STATE], 0x03, "state advanced 0x02 -> 0x03");
  assert.equal(after.mem8[ACTOR_TABLE + OFF_BASE_Y], 0x24, "base Y stepped 0x20 -> 0x24 (+4)");
  assert.equal(after.mem8[ACTOR_TABLE + OFF_SECONDARY], 0x2a, "secondary stepped 0x30 -> 0x2a (-6)");
  console.log(`  WRITE-SET: ${changed.length} cells, all within {delay,state,baseY,secondary,4x shape-field}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong secondary byte is CAUGHT by the RAM diff", () => {
  const o = craft({ delay: 0x01, secondary: 0x30 });
  const c = craft({ delay: 0x01, secondary: 0x30 });
  oracle(o);
  nudgeLeadActorAndAdvanceOnDelay(c);
  c.mem8[ACTOR_TABLE + OFF_SECONDARY] = 0x00; // BUG: secondary must be 0x2a

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong secondary byte — it is worthless");
  assert.equal(d.addr, ACTOR_TABLE + OFF_SECONDARY, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong secondary caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned A is CAUGHT by the live-out check", () => {
  const o = craft({ delay: 0x01, secondary: 0x30 });
  const c = craft({ delay: 0x01, secondary: 0x30 });
  oracle(o);
  const ret = nudgeLeadActorAndAdvanceOnDelay(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A return matches the oracle");
  assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, "sanity: the module SET A on its own clone");
  // the pre-subtract secondary (0x30) is a plausible bug the live-out check must reject
  assert.notEqual(0x30, o.regs.a & 0xff, "the A live-out check must reject the un-subtracted secondary");
  console.log(`  TEETH/A: module A ${hx(ret & 0xff)} == oracle; the un-subtracted 0x30 is rejected`);
});
