// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for begin50mKongRecaptureInterlude (ROM 0x16a3) — sequence step 0 of dispatchBoardClearedInterlude's
 * rst-0x28 board-advance table (@0x1637), keyed on the 0x6388 step selector.
 *
 * begin50mKongRecaptureInterlude WRITES memory (everything spawnInterludeHeart seeds, then the ten-record
 * SPRITE_OBJ_BLOCK it stamps + re-anchors, then the 0x6388 step it increments) and it is
 * UNREACHED in attract (0 dispatches over 4000 frames — it is a board-cleared interlude
 * step), so it is validated by crafted-entry capture/clone/replay on a FRESH clone per
 * side, never the full register file, never cycles. The routine's ONLY data-dependent
 * input is record 2's entry X (0x6910), which sets the re-anchoring shift; sweeping it
 * over all 256 values is exhaustive over that surface. The contract compared is RAM
 * (minus the stack scratch below the entry SP); live-out is memory-only (the rst-0x28 return path in dispatchBoardClearedInterlude
 * reads none of the residual regs).
 *
 *   1. EQUAL (exhaustive over 0x6910) — from a real attract RAM base, sweep the stored
 *      0x6910 byte over all 256 values (each drives a distinct shift = oldX - 0x3b into
 *      the X column of all ten records). For each, oracle vs candidate on two fresh
 *      clones, identical RAM (ex-stack).
 *
 *   2. EQUAL (0x6388 breadth) — hold a shift-producing 0x6910 and sweep the 0x6388 step
 *      selector over all 256 values, confirming the `inc (0x6388)` (incl. the 0xFF->0x00
 *      wrap) matches the oracle for every value.
 *
 *   3. ARMS (coverage is not vacuous) — on the oracle, confirm the routine's distinctive
 *      effects: the sprite-object block is actually stamped (differs from before); record
 *      2's X is re-anchored to its entry value (the 0x3b + (oldX - 0x3b) == oldX
 *      invariant, over several oldX); every one of the ten X bytes is shifted by
 *      oldX - 0x3b; 0x6388 is incremented; and spawnInterludeHeart's spawn write landed
 *      (SND_PRIORITY 0x608A == 0x07). This is what the sweep and teeth bite on.
 *
 *   4. TEETH (exhaustive) — a twin that reads 0x6910 AFTER the block copy (so it measures
 *      the template byte 0x3b, giving shift 0 always, instead of the OLD X) MUST be caught
 *      by the 0x6910 sweep. This guards the read-before-copy ordering the direct-call
 *      rewrite has to preserve.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-16a3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16a3 as oracle } from "../../translated/loc_16a3.js";
import { begin50mKongRecaptureInterlude as candidate } from "../begin50mKongRecaptureInterlude.js";
import { spawnInterludeHeart } from "../spawnInterludeHeart.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK, SND_PRIORITY } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const RECORD2_X = SPRITE_OBJ_BLOCK + 0x08; // 0x6910 — record 2's +0 (X) byte
const SEQ_STEP = 0x6388; // this dispatcher's rst-0x28 step selector
const TEMPLATE_ANCHOR_X = 0x3b; // ROM 0x385c template's record-2 X
const OBJ_BLOCK_BYTES = 0x28; // ten 4-byte sprite records

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Craft an entry from a real base: fresh clone, SP parked in STACK_SCRATCH (so the
 * oracle's nested callee push/pop and terminal `ret` land in the skipped region), and
 * the input bytes poked. Returns a machine ready to run one side on.
 */
function craftEntry(base, record2X, stepByte) {
  const w = base.clone();
  w.regs.sp = 0x6bfe; // inside STACK_SCRATCH [0x6be0,0x6c00)
  if (record2X !== undefined) w.mem.write8(RECORD2_X, record2X & 0xff);
  if (stepByte !== undefined) w.mem.write8(SEQ_STEP, stepByte & 0xff);
  return w;
}

/** Run oracle and candidate on two fresh clones of `entry`; return first RAM diff. */
function diffAgainstOracle(entry, cand) {
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  cand(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/** A real attract RAM base: booted machine, work RAM populated, no overrides so the
 *  oracle's m.call(0x1708)/(0x004e)/(0x0038) resolve to the frozen translated callees. */
function attractBase() {
  const host = new Machine(ROM);
  host.runFrames(600);
  return host.clone();
}

test("EQUAL (exhaustive): all 256 record-2 X values match the oracle (RAM ex-stack)", () => {
  const base = attractBase();
  let count = 0;
  for (let x = 0; x < 256; x++) {
    const ram = diffAgainstOracle(craftEntry(base, x), candidate);
    count++;
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} for 0x6910=${hx(x)}: oracle=${ram.a} cand=${ram.b}`);
  }
  assert.equal(count, 256, "must have swept all 256 record-2 X values");
  console.log(`  EQUAL/exhaustive: ${count} record-2 X values identical to the oracle (RAM ex-stack)`);
});

test("EQUAL (step breadth): all 256 step-selector values match the oracle (incl. wrap)", () => {
  const base = attractBase();
  let count = 0;
  for (let s = 0; s < 256; s++) {
    // 0x6910 = 0x00 -> a non-trivial shift (0x00 - 0x3b), so the stamp path is exercised
    // while the 0x6388 inc is swept across every value including 0xFF -> 0x00.
    const ram = diffAgainstOracle(craftEntry(base, 0x00, s), candidate);
    count++;
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} for 0x6388=${hx(s)}: oracle=${ram.a} cand=${ram.b}`);
  }
  assert.equal(count, 256, "must have swept all 256 step-selector values");
  console.log(`  EQUAL/step-breadth: ${count} step-selector values identical to the oracle`);
});

test("ARMS: stamp + re-anchor + step-advance + spawn all fire with distinctive effects", () => {
  const base = attractBase();
  const eq = (u, v) => u.length === v.length && u.every((val, i) => val === v[i]);
  const readBlock = (m) => Array.from({ length: OBJ_BLOCK_BYTES }, (_, i) => m.mem.read8((SPRITE_OBJ_BLOCK + i) & 0xffff));

  for (const oldX of [0x00, 0x3b, 0x50, 0x84, 0xff]) {
    const before = craftEntry(base, oldX, 0x02);
    const blockBefore = readBlock(before);
    const stepBefore = before.mem.read8(SEQ_STEP);
    const after = before.clone();
    oracle(after);

    // The figure was stamped (the block changed) — unless the template already matched.
    const blockAfter = readBlock(after);
    assert.ok(!eq(blockAfter, blockBefore), `stamp arm must overwrite SPRITE_OBJ_BLOCK (oldX=${hx(oldX)})`);

    // Re-anchor invariant: record 2's X returns to its entry value.
    assert.equal(after.mem.read8(RECORD2_X), oldX, `record 2 X must re-anchor to its entry X (oldX=${hx(oldX)})`);

    // Every one of the ten X bytes was shifted by (oldX - 0x3b): X[k] == ROM_template[k]
    // + shift (8-bit), checked against the ACTUAL ROM template X bytes (offset 4k of 0x385c),
    // not a recovered value — so this genuinely proves the whole column moved uniformly.
    const shift = (oldX - TEMPLATE_ANCHOR_X) & 0xff;
    for (let k = 0; k < 10; k++) {
      const templateXk = ROM[(0x385c + 4 * k) & 0xffff];
      const xk = after.mem.read8((SPRITE_OBJ_BLOCK + 4 * k) & 0xffff);
      assert.equal(xk, (templateXk + shift) & 0xff, `X column record ${k} must be ROM template X + shift (oldX=${hx(oldX)})`);
    }

    // The 0x6388 step advanced by exactly one.
    assert.equal(after.mem.read8(SEQ_STEP), (stepBefore + 1) & 0xff, `0x6388 must advance by 1 (oldX=${hx(oldX)})`);

    // spawnInterludeHeart spawn ran: it re-writes SND_PRIORITY to 0x07 after silencing sound.
    assert.equal(after.mem.read8(SND_PRIORITY), 0x07, `spawnInterludeHeart spawn must set SND_PRIORITY=0x07 (oldX=${hx(oldX)})`);
  }
  console.log("  ARMS: stamp, re-anchor invariant, uniform X-column shift, step-advance, and spawn all exercised");
});

/**
 * Broken twin: reads record 2's X AFTER the block copy overwrites it (so it measures the
 * template byte 0x3b, giving shift 0 always) instead of BEFORE. Otherwise identical to the
 * real routine — same idiomatic callees. Differs from the oracle whenever entry X != 0x3b.
 */
function brokenReadAfterCopy(m) {
  const { regs, mem } = m;
  spawnInterludeHeart(m);
  regs.hl = 0x385c;
  loadSpriteObjectBlock(m); // copy FIRST
  const shift = (mem.read8(RECORD2_X) - TEMPLATE_ANCHOR_X) & 0xff; // BUG: read AFTER copy -> always 0
  regs.hl = SPRITE_OBJ_BLOCK;
  regs.c = shift;
  addToSpriteObjectColumn(m);
  mem.write8(SEQ_STEP, (mem.read8(SEQ_STEP) + 1) & 0xff);
}

test("TEETH (exhaustive): the read-after-copy twin is CAUGHT by the sweep", () => {
  const base = attractBase();
  let caughtAt = null;
  for (let x = 0; x < 256; x++) {
    const ram = diffAgainstOracle(craftEntry(base, x), brokenReadAfterCopy);
    if (ram) { caughtAt = { x, ram }; break; }
  }
  assert.notEqual(caughtAt, null, "the sweep FAILED to catch the read-after-copy ordering bug — it is worthless");
  console.log(
    `  TEETH/exhaustive: caught at 0x6910=${hx(caughtAt.x)} — RAM diff at ${hx(caughtAt.ram.addr)} ` +
      `(oracle=${caughtAt.ram.a} broken=${caughtAt.ram.b})`,
  );
});
