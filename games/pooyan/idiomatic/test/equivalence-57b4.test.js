// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for adjustSpawnColumn (ROM 0x57b4-0x57c2, Pooyan) — the spawn-column
 * clamp: input column in C, output column in C. Leaves C unchanged when STAGE_COUNTDOWN (0x8901)
 * >= 3, or when WAVE_PROGRESS_COUNTER (0x8d7d) < 0x0c; otherwise adds (progress - 0x0c) into C.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. adjustSpawnColumn is a PURE READ leaf — it
 * writes NO RAM — so the memory contract is trivially satisfied (asserted by WRITE-SET as a
 * positive control) and the LOAD-BEARING contract is the register live-out:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the returned column C.
 *
 * The return is checked against the ORACLE clone's own exit register (o.regs.c) — the value the
 * caller consumes from C — never against the module. pc/SP are not compared (the modelled
 * call/stack ABI the direct-call idiomatic layer replaces with a plain return).
 *
 * Jobs:
 *   1. EQUAL+RETURN (crafted, all three branches) — late-stage bail, below-threshold bail, and
 *      the add path (incl. an 8-bit wrap) leave RAM(−stack) identical and C == the oracle's C.
 *   2. CAPTURED (best-effort) — if a real boot dispatches 0x57b4, replay those states too.
 *   3. WRITE-SET — the oracle writes NOTHING (positive control for the pure-read claim).
 *   4. TEETH — a twin that drops the (progress - 0x0c) shift MUST be caught by the return check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-57b4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_57b4 as oracle } from "../../translated/loc_57b4.js";
import { adjustSpawnColumn } from "../adjustSpawnColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, STAGE_COUNTDOWN, WAVE_PROGRESS_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x57b4;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** stage -> STAGE_COUNTDOWN, progress -> WAVE_PROGRESS_COUNTER, col -> C; SP parked in dead scratch. */
function craft(stage, progress, col) {
  const base = new Machine(ROM);
  base.mem.write8(STAGE_COUNTDOWN, stage & 0xff);
  base.mem.write8(WAVE_PROGRESS_COUNTER, progress & 0xff);
  base.regs.c = col & 0xff;
  base.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  return base;
}

// [stage, progress, col] across all three branches:
//   >=3 bail | <0x0c bail | add path (incl. shift 0, and an 8-bit wrap)
const CASES = [
  [0x03, 0x20, 0x10], // branch 1: stage == 3 -> unchanged
  [0x05, 0x50, 0x40], // branch 1: stage  > 3 -> unchanged
  [0x00, 0x00, 0x22], // branch 2: progress 0 -> unchanged
  [0x01, 0x0b, 0x30], // branch 2: progress 0x0b < 0x0c -> unchanged
  [0x00, 0x0c, 0x10], // branch 3: shift 0 (progress == 0x0c)
  [0x02, 0x20, 0x05], // branch 3: 0x05 + 0x14 = 0x19
  [0x00, 0xff, 0xf0], // branch 3: 0xf0 + 0xf3 = 0x1e3 -> 0xe3 (wrap)
  [0x00, 0x30, 0xff], // branch 3: 0xff + 0x24 = 0x123 -> 0x23 (wrap)
];

// -- 1. EQUAL+RETURN (crafted) ------------------------------------------------

test("EQUAL+RETURN: crafted cases across all branches — RAM(−stack) identical and C == the oracle's C", () => {
  for (const [stage, progress, col] of CASES) {
    const base = craft(stage, progress, col);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    const ret = adjustSpawnColumn(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${hx(stage)},${hx(progress)},${hx(col)}]: RAM diff at ${hx(d.addr ?? 0)}`);
    assert.equal(ret, o.regs.c, `[${hx(stage)},${hx(progress)},${hx(col)}]: C live-out ${hx(ret)} != oracle ${hx(o.regs.c)}`);
    // SIDE EFFECT: the bridge must SET C (the register the frozen caller reads), not just return it.
    assert.equal(c.regs.c, o.regs.c, `[${hx(stage)},${hx(progress)},${hx(col)}]: module did not SET C ${hx(c.regs.c)} != oracle ${hx(o.regs.c)}`);
  }
  console.log(`  EQUAL+RETURN: ${CASES.length} crafted cases identical (RAM −stack) + C matches`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real 0x57b4 dispatches replay identically (if reached in the boot window)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 24) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    new Machine(ROM, { overrides: snap }).runFrames(3000);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = adjustSpawnColumn(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `captured RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
    assert.equal(ret, o.regs.c, `captured C live-out ${hx(ret)} != oracle ${hx(o.regs.c)}`);
    // SIDE EFFECT: the bridge must SET C on the captured state too.
    assert.equal(c.regs.c, o.regs.c, `captured: module did not SET C ${hx(c.regs.c)} != oracle ${hx(o.regs.c)}`);
  }
  console.log(`  CAPTURED: ${caps.length} real 0x57b4 dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET (positive control: pure read) -------------------------------

test("WRITE-SET: the oracle writes NOTHING (adjustSpawnColumn is a pure read leaf)", () => {
  for (const [stage, progress, col] of CASES) {
    const base = craft(stage, progress, col);
    const before = base.clone();
    const after = base.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) {
        const addr = after.stateOffsetToAddr(off);
        assert.ok(inDeadStack(addr), `oracle wrote non-stack addr ${hx(addr)} — not a pure read`);
      }
    }
  }
  console.log("  WRITE-SET: no non-stack RAM write across all cases");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: never applies the (progress - 0x0c) shift — a dropped-add regression. */
function brokenAdjust(m, col = m.regs.c) {
  return col; // BUG: returns the column unshifted even on the add path
}

test("TEETH: a dropped (progress - 0x0c) shift is caught by the return check", () => {
  let caught = false;
  for (const [stage, progress, col] of CASES) {
    const base = craft(stage, progress, col);
    const o = base.clone();
    oracle(o);
    const bad = brokenAdjust(base.clone());
    if (bad !== o.regs.c) { caught = true; break; }
  }
  assert.ok(caught, "the return check FAILED to catch a dropped shift — it is worthless");
  console.log("  TEETH: an unshifted column differs from the oracle's adjusted C");
});
