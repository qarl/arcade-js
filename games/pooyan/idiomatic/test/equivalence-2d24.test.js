// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for climbHunterStepAndRetireAtTop (ROM 0x2d24) — DISSOLVED caller-skip of hunter dispatch state 2.
 * The oracle carries the boolean protocol (true on the `ret c` climbing path, false on the reached-top
 * `pop af; ret` path); the idiomatic module reproduces the boolean while dropping the stack plumbing.
 * Compared per case: RAM (dumpState − stack scratch below the entry SP) PLUS the JS boolean return.
 *
 * Jobs: NORMAL (high < 0x19 -> true), SKIP (high >= 0x19 -> false, state advanced + position cleared),
 * CARRY (low+step carry stays below top -> true), TEETH/RAM, TEETH/BOOL.
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2d24.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loc_2d24 as oracle } from "../../translated/loc_2d24.js";
import { climbHunterStepAndRetireAtTop } from "../climbHunterStepAndRetireAtTop.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (n, f) => nodeTest(n, { skip: "skipped: ROM not built" }, f);
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);
const ramDiffMinusStack = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (o) => ma.stateOffsetToAddr(o), inDeadStack);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const REC = 0x8a80;
const HOLD = 0x0e, P_LO = 0x05, P_HI = 0x06, P_STEP = 0x09, STATE = 0x02, SCRIPT = 0x16;

function craft({ lo = 0, step = 0, hi = 0, state = 0x02 } = {}) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ff8; // in STACK_SCRATCH
  m.mem.write8(REC + HOLD, 0x05); // frame-hold nonzero -> advanceObjectAnimationFrame decrements & returns
  m.mem.write8(REC + P_LO, lo);
  m.mem.write8(REC + P_STEP, step);
  m.mem.write8(REC + P_HI, hi);
  m.mem.write8(REC + STATE, state);
  return m;
}

test("NORMAL: high byte below 0x19 -> climbing, oracle == idiomatic (RAM −stack), both true", () => {
  const o = craft({ hi: 0x05 }), c = craft({ hi: 0x05 });
  const ro = oracle(o), rc = climbHunterStepAndRetireAtTop(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(ro, true, "climbing path -> true");
  assert.equal(rc, ro, "idiomatic boolean must match oracle");
  console.log("  NORMAL: climbing identical, both true");
});

test("SKIP: high byte at 0x19 -> false, state advanced + position/script cleared", () => {
  const o = craft({ hi: 0x19, state: 0x02 }), c = craft({ hi: 0x19, state: 0x02 });
  const ro = oracle(o), rc = climbHunterStepAndRetireAtTop(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(ro, false, "reached-top path -> false");
  assert.equal(rc, ro, "idiomatic boolean must match oracle");
  assert.equal(c.mem.read8(REC + STATE), 0x03, "state advanced 0x02 -> 0x03");
  assert.equal(c.mem.read8(REC + P_LO), 0, "position low cleared");
  assert.equal(c.mem.read8(REC + P_HI), 0, "position high cleared");
  assert.equal(c.mem.read8(REC + SCRIPT), 0, "script field cleared");
  console.log("  SKIP: reached-top identical, both false, state advanced");
});

test("CARRY: low+step carries into high byte but stays below 0x19 -> still true", () => {
  const o = craft({ lo: 0xff, step: 0x02, hi: 0x05 }), c = craft({ lo: 0xff, step: 0x02, hi: 0x05 });
  const ro = oracle(o), rc = climbHunterStepAndRetireAtTop(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(ro, true, "high 0x06 still below top -> true");
  assert.equal(rc, ro, "idiomatic boolean must match oracle");
  assert.equal(c.mem.read8(REC + P_HI), 0x06, "carry bumps high to 0x06");
  assert.equal(c.mem.read8(REC + P_LO), 0x01, "low wraps to 0x01");
  console.log("  CARRY: 16-bit carry handled, both true");
});

test("TEETH/RAM: a wrong written position byte is caught by the RAM diff", () => {
  const o = craft({ hi: 0x05 }), c = craft({ hi: 0x05 });
  oracle(o); climbHunterStepAndRetireAtTop(c);
  c.mem.write8(REC + P_LO, 0xee); // BUG
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate worthless: wrong position byte not caught");
  assert.equal(d.addr, REC + P_LO, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: caught at ${hx(d.addr)}`);
});

test("TEETH/BOOL: a flipped return is caught by the boolean check", () => {
  const o = craft({ hi: 0x19 }), c = craft({ hi: 0x19 });
  const ro = oracle(o), rc = climbHunterStepAndRetireAtTop(c);
  assert.equal(rc, ro, "sanity: boolean matches oracle");
  assert.notEqual(!rc, ro, "the boolean check rejects a flipped return");
  console.log(`  TEETH/BOOL: correct=${rc}, flipped ${!rc} rejected`);
});
