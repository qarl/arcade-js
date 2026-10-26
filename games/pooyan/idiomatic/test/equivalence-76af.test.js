// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blinkTilePairOnCountdown (ROM 0x76af) — "two-phase blink timer": countdown at
 * 0x892a; while non-zero decrement and return; on zero reload 0x16, toggle the phase 0x892b,
 * and by phase parity pick one of two 2-byte tile pairs (0x76e6={0x3f,0x46} / 0x76e8=
 * {0x46,0x3f}) and write it into the video cells 0x8471 and 0x84b1 (=0x8471+0x40).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case
 * uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP/cycles are NOT compared. blinkTilePairOnCountdown has NO register live-out — its caller (updateGameplayFrame)
 * treats it as a plain-ret helper and reads no register result — and takes no register inputs
 * (it loads 0x892a itself). It calls nothing, so the two tile pairs are read straight from ROM.
 *
 * Jobs:
 *   1. EQUAL — the countdown arm and both parity arms agree in RAM (−stack).
 *   2. WRITE-SET — an expiry arm writes only 0x892a, 0x892b, 0x8471, 0x84b1.
 *   3. TEETH — a twin that writes a WRONG byte into the second tile cell MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-76af.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_76af as oracle } from "../../translated/loc_76af.js";
import { blinkTilePairOnCountdown } from "../blinkTilePairOnCountdown.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const BLINK_COUNTDOWN = 0x892a;
const BLINK_PHASE = 0x892b;
const CELL_0 = 0x8471;
const CELL_1 = 0x84b1; // 0x8471 + 0x40

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x9000);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh reset machine with countdown + phase poked identically. */
function craft(countdown, phase) {
  const m = BASE.clone();
  m.mem.write8(BLINK_COUNTDOWN, countdown);
  m.mem.write8(BLINK_PHASE, phase);
  m.regs.sp = 0x9000;
  return m;
}

// countdown arm, then two parity arms. phase is poked PRE-increment: 0 -> 1 (odd), 1 -> 2 (even).
const CASES = [
  { name: "countdown", countdown: 0x05, phase: 0x00 },
  { name: "expiry/phaseOdd", countdown: 0x00, phase: 0x00 },
  { name: "expiry/phaseEven", countdown: 0x00, phase: 0x01 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: countdown + both parity arms — blinkTilePairOnCountdown == oracle in RAM (−stack)", () => {
  for (const { name, countdown, phase } of CASES) {
    const o = craft(countdown, phase);
    const c = craft(countdown, phase);
    oracle(o);
    blinkTilePairOnCountdown(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an expiry arm writes only 0x892a, 0x892b, 0x8471, 0x84b1", () => {
  const allowed = new Set([BLINK_COUNTDOWN, BLINK_PHASE, CELL_0, CELL_1]);
  const before = craft(0x00, 0x00);
  for (const cell of allowed) before.mem.write8(cell, 0xaa);
  before.mem.write8(BLINK_COUNTDOWN, 0x00); // keep the countdown at 0 so the expiry arm runs
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // exclude any stack scratch (the routine itself pushes nothing)
    changed.push(addr);
  }
  for (const addr of changed) {
    assert.ok(allowed.has(addr), `oracle wrote outside the footprint at ${hx(addr)}`);
  }
  // countdown reload (0x16 over 0xAA) and phase inc (0xAA -> 0xAB) always change.
  for (const cell of [BLINK_COUNTDOWN, BLINK_PHASE]) {
    assert.ok(changed.includes(cell), `expected a write at ${hx(cell)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} cells, all within the 4-cell footprint`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong second-cell byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00, 0x00);
  const c = craft(0x00, 0x00);
  oracle(o);
  blinkTilePairOnCountdown(c);
  c.mem.write8(CELL_1, (c.mem.read8(CELL_1) + 1) & 0xff); // BUG: corrupt the second blink cell
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong blink byte — it is worthless");
  assert.equal(d.addr, CELL_1, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(CELL_1)})`);
  console.log(`  TEETH: wrong blink byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
