// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seatIntroLaunchScriptAndAdvancePhase (ROM 0x6db8, Pooyan) — level-intro phase 0.
 *
 * SEATING: BALANCED (plain ret / tail-call) -> WIRE. Void handler: no register survives, LIVE-OUT is
 * memory only, comparison is RAM (dumpState) minus stack scratch below the entry SP. SP parked in STACK_SCRATCH so the
 * sound-run / word-lookup pushes drop out.
 *
 * Crafted paths: bit2 of ROUND_COUNTER clear -> ret after seating the script word (index 0, and the
 * clamp-to-7 arm), and bit2 set with the intact ROM image -> the 0x60-byte tamper compare passes and
 * rets. The tamper-mismatch arm tails to advanceAttractToBoardBuildIfImageIntact and cannot be crafted without patching the image.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6db8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6db8 as oracle } from "../../translated/loc_6db8.js";
import { seatIntroLaunchScriptAndAdvancePhase } from "../seatIntroLaunchScriptAndAdvancePhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ROUND_COUNTER, LAUNCH_SCRIPT_PTR, INTRO_DELAY_CKSUM_WORD, INTRO_PHASE_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, round) {
  m.regs.sp = SP0;
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(INTRO_PHASE_INDEX, 0x00);
  m.mem.write8(INTRO_DELAY_CKSUM_WORD, 0x00);
  return m;
}

const CASES = {
  "index 0, bit2 clear -> ret": (m) => seat(m, 0x00),
  "index clamp to 7, bit2 clear -> ret": (m) => seat(m, 0x20),
  "bit2 set, intact tamper compare -> ret": (m) => seat(m, 0x04),
};

test("EQUAL: seatIntroLaunchScriptAndAdvancePhase == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    seatIntroLaunchScriptAndAdvancePhase(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

test("WRITE-SET: seats table[0] script word, delay 0x40, advances the phase", () => {
  const m = CASES["index 0, bit2 clear -> ret"](BASE.clone());
  const word = m.mem.read8(0x70f3) | (m.mem.read8(0x70f4) << 8); // table[0]
  oracle(m);
  assert.equal(m.mem.read8(LAUNCH_SCRIPT_PTR) | (m.mem.read8(LAUNCH_SCRIPT_PTR + 1) << 8), word, "LAUNCH_SCRIPT_PTR := table[0]");
  assert.equal(m.mem.read8(INTRO_DELAY_CKSUM_WORD), 0x40, "delay primed to 0x40");
  assert.equal(m.mem.read8(INTRO_PHASE_INDEX), 0x01, "phase advanced 0 -> 1");
  console.log("  WRITE-SET: script word seated; delay 0x40; phase +1");
});

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["index 0, bit2 clear -> ret"](BASE.clone());
  const c = CASES["index 0, bit2 clear -> ret"](BASE.clone());
  oracle(o);
  seatIntroLaunchScriptAndAdvancePhase(c);
  c.mem.write8(INTRO_PHASE_INDEX, (o.mem.read8(INTRO_PHASE_INDEX) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, INTRO_PHASE_INDEX, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips priming the delay diverges", () => {
  const o = CASES["index 0, bit2 clear -> ret"](BASE.clone());
  const c = CASES["index 0, bit2 clear -> ret"](BASE.clone());
  oracle(o); // writes INTRO_DELAY_CKSUM_WORD = 0x40 (and more)
  // twin: do nothing -> the seeded 0x00 survives
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped prime must be caught by the RAM diff");
  console.log(`  TEETH(prime): caught at ${hx(d.addr ?? 0)}`);
});
