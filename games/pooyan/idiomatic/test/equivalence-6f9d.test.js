// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for scaleTargetCountAndAdvanceIntroPhase4 (ROM 0x6f9d) — "level-intro phase 4": latch the
 * target-group count into the HUD cell (0x8634), replace the count (0x8f47) with 5x itself, zero
 * the three HUD cells one row up each, inc the intro phase (0x8f51), reprime the intro delay
 * (0x8f48)=0x80, then run a 0x44-byte anti-tamper compare of 0x6ac5.. against its data copy at
 * 0x6fed.. — on a full match call 0x0f44 (sound) and rst 0x38 with 0x0627 (display cmd); on a
 * mismatch wipe work RAM forward from 0x8800 via a leftover-BC ldir.
 *
 * Cycle-free memory-equivalence gate (docs/decompiler-pipeline): a FRESH clone per side, compared
 * on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared. scaleTargetCountAndAdvanceIntroPhase4 is a
 * tail-dispatched intro-phase handler (dispatchLevelIntroPhase's rst-0x28 table) and leaves no register a caller
 * consumes — the contract is RAM only. The oracle's `push16 + call/rst` on the match path writes a
 * return address into STACK_SCRATCH the idiomatic direct calls do not — excluded by contract.
 *
 * The tamper MISMATCH path is UNREACHABLE in this harness: 0x6ac5.. and 0x6fed.. are ROM and equal
 * in a clean image (asserted below as a positive control), and write8 throws on a ROM poke, so the
 * compare can never be forced to differ. Every case therefore exercises the MATCH path. (The
 * module still reproduces the mismatch wipe faithfully for fidelity; see notes.)
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over target-group counts (incl. the 0 djnz-wrap and 0xff) scaleTargetCountAndAdvanceIntroPhase4
 *      == oracle in RAM (-stack).
 *   2. POSITIVE CONTROL — the two ROM blocks are byte-equal (why the match path is the live path).
 *   3. WRITE-SET — the match path latches the count, writes 5x, zeroes the three cells up, bumps
 *      the phase, and reprimes the delay to 0x80.
 *   4. TEETH — a twin with a wrong 5x scaled count is CAUGHT at 0x8f47; a wrong reprimed delay is
 *      CAUGHT at 0x8f48.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6f9d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6f9d as oracle } from "../../translated/loc_6f9d.js";
import { scaleTargetCountAndAdvanceIntroPhase4 } from "../scaleTargetCountAndAdvanceIntroPhase4.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TARGET_GROUP_COUNT, HUD_INTRO_DIGITS_BASE, INTRO_PHASE_INDEX, INTRO_DELAY_CKSUM_WORD } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

// New-name addresses (pending merge into names.js); tests are exempt from the address/gate rules.
const TAMPER_ORIG = 0x6ac5; // ROM original bytes
const TAMPER_COPY = 0x6fed; // ROM data copy
const COMPARE_LEN = 0x44; //  bytes compared
const ROW_STRIDE = 0x20; //   one tilemap row
const DELAY_RESEED = 0x80; // reprimed intro delay
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the target-group count seated; sp lands pushes in STACK_SCRATCH. */
function craft(count) {
  const m = BASE.clone();
  m.mem.write8(TARGET_GROUP_COUNT, count & 0xff);
  m.regs.sp = 0x8ffe;
  return m;
}

// 5,6,7,8 are the observed group counts; 0 exercises the 8-bit djnz wrap-to-256, 0xff the scale wrap.
const CASES = [0x05, 0x06, 0x07, 0x08, 0x00, 0xff, 0x33];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted counts — scaleTargetCountAndAdvanceIntroPhase4 == oracle in RAM (−stack)", () => {
  for (const count of CASES) {
    const o = craft(count);
    const c = craft(count);
    oracle(o);
    scaleTargetCountAndAdvanceIntroPhase4(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (count=${hx(count)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted counts identical (RAM −stack), incl. 0-wrap + 5x scale wrap`);
});

// -- 2. POSITIVE CONTROL ------------------------------------------------------

test("POSITIVE CONTROL: the two ROM tamper blocks are byte-equal (so the MATCH path is the live path)", () => {
  const m = BASE.clone();
  let equal = true;
  for (let k = 0; k < COMPARE_LEN; k++) {
    if (m.mem.read8(TAMPER_ORIG + k) !== m.mem.read8(TAMPER_COPY + k)) { equal = false; break; }
  }
  assert.ok(equal, "clean-image invariant: 0x6ac5.. equals 0x6fed.. for 0x44 bytes");
  console.log(`  POSITIVE CONTROL: ${COMPARE_LEN} ROM bytes equal — mismatch/wipe path unreachable here`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: latch count, write 5x, zero the three cells up, bump phase, reprime delay", () => {
  const count = 0x06;
  const m = craft(count);
  m.mem.write8(INTRO_PHASE_INDEX, 0x02); // known phase so +1 is visible
  m.mem.write8(HUD_INTRO_DIGITS_BASE, 0xaa); // pre-dirty so the latch is a visible change
  for (let i = 1; i <= 3; i++) m.mem.write8((HUD_INTRO_DIGITS_BASE - i * ROW_STRIDE) & 0xffff, 0xaa);

  oracle(m);

  assert.equal(m.mem.read8(HUD_INTRO_DIGITS_BASE), count, "HUD cell := the target-group count");
  assert.equal(m.mem.read8(TARGET_GROUP_COUNT), (5 * count) & 0xff, "count := 5x itself (0x1e)");
  for (let i = 1; i <= 3; i++) {
    assert.equal(m.mem.read8((HUD_INTRO_DIGITS_BASE - i * ROW_STRIDE) & 0xffff), 0x00, `HUD cell -${i} row := 0`);
  }
  assert.equal(m.mem.read8(INTRO_PHASE_INDEX), 0x03, "intro phase bumped 2 -> 3");
  assert.equal(m.mem.read8(INTRO_DELAY_CKSUM_WORD), DELAY_RESEED, "intro delay reprimed := 0x80");
  console.log("  WRITE-SET: HUD:=count, count:=5x, 3 cells up:=0, phase+1, delay:=0x80");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong 5x scaled count is CAUGHT at 0x8f47", () => {
  const count = 0x06;
  const o = craft(count);
  const c = craft(count);
  oracle(o);
  scaleTargetCountAndAdvanceIntroPhase4(c);
  c.mem.write8(TARGET_GROUP_COUNT, ((5 * count) & 0xff) - 1); // BUG: off-by-one on the scale
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong scaled count — it is worthless");
  assert.equal(d.addr, TARGET_GROUP_COUNT, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(scale): wrong 5x caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong reprimed delay is CAUGHT at 0x8f48", () => {
  const count = 0x06;
  const o = craft(count);
  const c = craft(count);
  oracle(o);
  scaleTargetCountAndAdvanceIntroPhase4(c);
  c.mem.write8(INTRO_DELAY_CKSUM_WORD, 0x40); // BUG: must be reprimed to 0x80
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong reprimed delay");
  assert.equal(d.addr, INTRO_DELAY_CKSUM_WORD, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(delay): wrong reprime caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
