// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for launchWolfIntoSlot (ROM 0x7595) — the per-record launch attempt, a DISSOLVED
 * caller-skip that composes the idiomatic siblings fetchByteFromTableIndex, fetchWordFromTableIndex and setActorAnimation.
 *
 * An already-active slot (bit 0 of either of IX's first two bytes) takes the plain `ret c` (normal
 * return, SP += 2) and the module returns true (caller keeps sweeping). A free slot is launched: the
 * IX record is stamped, from wave 2 on the paired IY record too, the shared frame-delay is reseeded,
 * the wave counter is bumped and the IX record armed with its launch animation; launchWolfIntoSlot then FALLS
 * INTO the `pop af; ret` (SP += 4), unwinding the caller, and the module returns false.
 *
 * The oracle runs the TRANSLATED subtree through the routines map; the idiomatic module imports the
 * IDIOMATIC siblings directly. The two must land byte-identical in RAM (dumpState) minus
 * stack scratch below the entry SP. No register is a live-out: the caller (still translated) protects its own loop
 * counter/stride and advances IX/IY itself, so registers are NOT compared. The boolean return IS,
 * and the oracle's SP delta (+2 normal / +4 skip) confirms which path it took.
 *
 * Cases are CRAFTED: a plain boot does not seat this routine's IX/IY record inputs directly.
 *
 * Jobs:
 *   1. EQUAL — occupied, launch-wave-1 (IY skipped) and launch-wave-2 (full IY): oracle == module in
 *      RAM (−stack); boolean matches; oracle SP delta matches the path.
 *   2. WRITE-SET — a wave-2 launch activates both records, reseeds the delay, bumps the wave and the
 *      variant cursor, and sets the IY hold field to wave*4.
 *   3. TEETH — a twin that reports a launch as 'continue' (true) is rejected; a wrong seeded byte is
 *      caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7595.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7595 as oracle } from "../../translated/loc_7595.js";
import { launchWolfIntoSlot } from "../launchWolfIntoSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = 0x8ae0; //     ENEMY_ACTOR_TABLE — the enemy record spawnNextEnemyOnDelay sweeps
const IY = 0x8b70; //     SPRITE_OBJECT_TABLE — the paired state record
const WAVE = 0x892d; //   WAVE_NUMBER — gates the IY branch and the delay index, then bumped
const VIDX = 0x8922; //   WOLF_LAUNCH_VARIANT_INDEX — the variant-table cursor (wave 2 branch)
const DELAY = 0x8929; //  SHARED_FRAME_DELAY_TIMER — reseeded on a launch
const SP0 = 0x8fe0; //    inside STACK_SCRATCH; room for the nested dips + the pop-af/ret

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: IX/IY seated, wave and variant cursor set; occupied controls IX's first byte. */
function craft(occupied, wave) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = IX;
  m.regs.iy = IY;
  m.mem8[IX + 0] = occupied ? 0x01 : 0x00;
  m.mem8[IX + 1] = 0x00;
  m.mem8[WAVE] = wave & 0xff;
  m.mem8[VIDX] = 0x00;
  m.mem8[DELAY] = 0x00;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: occupied — module == oracle in RAM (−stack), returns true, normal ret (SP += 2)", () => {
  const o = craft(true, 0x02);
  const c = craft(true, 0x02);
  const ret = launchWolfIntoSlot(c);
  oracle(o);
  assert.equal(ret, true, "an occupied slot must return true (caller keeps sweeping)");
  assert.equal(o.regs.sp, (SP0 + 2) & 0xffff, "oracle occupied must take the plain ret c (SP += 2)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL occupied: true, SP+=2, RAM identical (no launch)");
});

for (const [label, wave] of [["launch-wave-1 (IY skipped)", 0x01], ["launch-wave-2 (full IY)", 0x02]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack), returns false, skip (SP += 4)`, () => {
    const o = craft(false, wave);
    const c = craft(false, wave);
    const ret = launchWolfIntoSlot(c);
    oracle(o);
    assert.equal(ret, false, "a launch must return false (abort the caller)");
    assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, "oracle launch must fall into the pop-af/ret skip (SP += 4)");
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${label})`);
    console.log(`  EQUAL ${label}: false, SP+=4, RAM identical (composed idiomatic subtree)`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a wave-2 launch activates both records, reseeds the delay, bumps wave + variant cursor", () => {
  const after = craft(false, 0x02);
  oracle(after);
  assert.equal(after.mem8[IX + 0x00], 0x01, "enemy record activated");
  assert.equal(after.mem8[IY + 0x00], 0x01, "paired record activated");
  assert.equal(after.mem8[IX + 0x04], 0x15, "IX field +4 seeded");
  assert.equal(after.mem8[IY + 0x04], 0x14, "IY field +4 seeded");
  assert.notEqual(after.mem8[DELAY], 0x00, "frame delay reseeded from the launch table");
  assert.equal(after.mem8[WAVE], 0x03, "wave bumped 2 -> 3");
  assert.equal(after.mem8[VIDX], 0x01, "variant cursor bumped 0 -> 1");
  assert.equal(after.mem8[IY + 0x11], 0x0c, "IY hold field = wave*4 (3*4)");
  console.log("  WRITE-SET: both records activated + delay + wave/variant bump + hold confirmed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin that reports a launch as 'continue' (true) is rejected by the boolean check", () => {
  function brokenContinue(m) {
    launchWolfIntoSlot(m); // real memory effect
    return true; // BUG: a launch must abort the caller -> false
  }
  const c = craft(false, 0x01);
  assert.throws(
    () => assert.equal(brokenContinue(c), false),
    "the boolean contract must reject a launch reported as 'continue'",
  );
  console.log("  TEETH/boolean: a launch-returns-true twin is caught");
});

test("TEETH: a wrong seeded field byte is CAUGHT by the RAM diff", () => {
  const o = craft(false, 0x02);
  const c = craft(false, 0x02);
  oracle(o);
  launchWolfIntoSlot(c);
  c.mem8[IX + 0x04] = 0x99; // BUG: IX field +4 must be 0x15
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte — it is worthless");
  assert.equal(d.addr, IX + 0x04, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seeded byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
