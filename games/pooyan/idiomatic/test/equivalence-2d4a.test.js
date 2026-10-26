// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for clearWaveHoldTimerToArmNextWave (ROM 0x2d4a) — DISSOLVED caller-skip of hunter dispatch state 3.
 * Clears the wave-hold timer (0x8f36) and returns false. Compared: RAM (dumpState − stack scratch below the entry SP) PLUS
 * the JS boolean. Run: node --test games/pooyan/idiomatic/test/equivalence-2d4a.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loc_2d4a as oracle } from "../../translated/loc_2d4a.js";
import { clearWaveHoldTimerToArmNextWave } from "../clearWaveHoldTimerToArmNextWave.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, WAVE_HOLD_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (n, f) => nodeTest(n, { skip: "skipped: ROM not built" }, f);
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);
const ramDiffMinusStack = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (o) => ma.stateOffsetToAddr(o), inDeadStack);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft() {
  const m = BASE.clone();
  m.regs.sp = 0x8ff8; // in STACK_SCRATCH (oracle's pop af reads dead RAM)
  m.mem.write8(WAVE_HOLD_TIMER, 0x42); // nonzero -> must be cleared
  return m;
}

test("EQUAL: clears wave-hold timer, returns false; oracle == idiomatic (RAM −stack)", () => {
  const o = craft(), c = craft();
  const ro = oracle(o), rc = clearWaveHoldTimerToArmNextWave(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(ro, false, "oracle returns false (caller-skip)");
  assert.equal(rc, ro, "idiomatic boolean must match oracle");
  assert.equal(c.mem.read8(WAVE_HOLD_TIMER), 0, "wave-hold timer cleared");
  console.log("  EQUAL: timer cleared, both false");
});

test("TEETH/RAM: a non-cleared timer is caught by the RAM diff", () => {
  const o = craft(), c = craft();
  oracle(o); clearWaveHoldTimerToArmNextWave(c);
  c.mem.write8(WAVE_HOLD_TIMER, 0x42); // BUG: must be 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate worthless: uncleared timer not caught");
  assert.equal(d.addr, WAVE_HOLD_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: caught at ${hx(d.addr)}`);
});
