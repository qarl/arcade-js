// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickCounterAndMirrorIfFlipped (ROM 0x0320, Pooyan) — "tick a frame counter, then run the
 * flip-screen mirror pass when armed": decrement the byte HL points at, and if the orientation flag
 * (0x881f) is zero, mirror the 24-entry sprite display list vertically (loc_0378).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so each case runs on a FRESH clone
 * per side. The go-forward contract is RAM (dumpState, minus stack scratch below the entry SP). No register live-out:
 * the tamper caller tail-jumps here and rebuildSpriteDisplayList inlines the same tail then rets, so nothing reads a
 * register back — pc/SP/registers are deliberately NOT compared. HL (the counter pointer) is the one
 * input, bridged as a param; the flag and the counter cell are poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — normal-orientation cases (flag != 0: dec only) and flipped cases (flag == 0: dec +
 *      mirror), over several counter cells/values incl. a 0 -> 0xff wrap: oracle == module in RAM.
 *   2. WRITE-SET — the normal path writes EXACTLY the counter cell (dec by 1); the flipped path also
 *      rewrites the sprite-list region. Documents the footprint.
 *   3. CRAFTED — the flipped path (flag == 0), with the sprite list seeded so the mirror is provable.
 *   4. TEETH — a twin that decrements by the wrong amount MUST be caught at the counter cell; a twin
 *      that mirrors on the normal path (flag != 0) MUST be caught in the sprite-list region.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0320.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0320 as oracle } from "../../translated/loc_0320.js";
import { tickCounterAndMirrorIfFlipped } from "../tickCounterAndMirrorIfFlipped.js";
import { mirrorSpriteListVertically } from "../mirrorSpriteListVertically.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, FLIP_SCREEN_FLAG, SPRITE_DISPLAY_LIST } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const LIST_LEN = 0x18 * 4; // 24 stride-4 entries
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A machine with the counter cell + orientation flag seated, and the sprite list made distinctive. */
function craft(counter, value, flip) {
  const m = new Machine(ROM);
  m.mem.write8(counter & 0xffff, value & 0xff);
  m.mem.write8(FLIP_SCREEN_FLAG, flip & 0xff);
  // Seed the sprite list so a mirror pass is observable (and so an unwanted mirror is catchable).
  for (let i = 0; i < LIST_LEN; i++) m.mem.write8((SPRITE_DISPLAY_LIST + i) & 0xffff, (0x21 + i * 7) & 0xff);
  m.regs.hl = counter & 0xffff;
  m.regs.sp = 0x8fe0; // dead stack: the flipped path's mirror call pushes/pops here
  return m;
}

const CASES = [
  { counter: 0x889c, value: 0x05, flip: 0x01 }, // normal orientation (the real inline counter)
  { counter: 0x889c, value: 0x00, flip: 0x01 }, // 0 -> 0xff wrap, normal
  { counter: 0x8898, value: 0x01, flip: 0x01 }, // the other inline counter
  { counter: 0x889c, value: 0x05, flip: 0x00 }, // flipped: dec + mirror
  { counter: 0x8898, value: 0x00, flip: 0x00 }, // flipped + wrap
  { counter: 0x889c, value: 0x40, flip: 0x7f }, // any non-zero flag counts as "normal"
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dec + (gated) mirror — module == oracle in RAM (−stack)", () => {
  for (const { counter, value, flip } of CASES) {
    const o = craft(counter, value, flip);
    const c = craft(counter, value, flip);
    oracle(o);
    tickCounterAndMirrorIfFlipped(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (counter=${hx(counter)} val=${hx(value)} flip=${hx(flip)})`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: normal path writes only the counter cell; flipped path adds the list", () => {
  // Normal orientation: exactly one write, the decremented counter.
  {
    const counter = 0x889c;
    const before = craft(counter, 0x05, 0x01);
    const after = craft(counter, 0x05, 0x01);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    const changed = [];
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
    }
    assert.equal(changed.length, 1, `normal path: expected exactly 1 write, got ${changed.length}`);
    assert.equal(changed[0].addr, counter, `normal path: the write must be the counter cell`);
    // The counter cell (0x889c) lies inside the seeded sprite-list region (0x8840..0x889f), so craft's
    // list seed is its actual pre-value; the oracle decrements that cell by 1 (mod 256).
    assert.equal(changed[0].to, (changed[0].from - 1) & 0xff, `normal path: the counter cell must decrement by 1`);
  }
  // Flipped orientation: the counter plus the sprite-list region change.
  {
    const counter = 0x889c;
    const before = craft(counter, 0x05, 0x00);
    const after = craft(counter, 0x05, 0x00);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    const addrs = new Set();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) addrs.add(after.stateOffsetToAddr(off));
    }
    assert.ok(addrs.has(counter), "flipped path: counter must be decremented");
    assert.ok(addrs.size > 1, "flipped path: the mirror pass must also rewrite the list");
  }
  console.log(`  WRITE-SET: normal = counter only; flipped = counter + list`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: flipped orientation runs the mirror pass identically", () => {
  const counter = 0x889c;
  const o = craft(counter, 0x22, 0x00);
  const c = craft(counter, 0x22, 0x00);
  oracle(o);
  tickCounterAndMirrorIfFlipped(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  // Sanity: the module really mirrored (the list changed from its seed at entry 0).
  const seed = (0x21 + 0 * 7) & 0xff;
  assert.notEqual(c.mem.read8(SPRITE_DISPLAY_LIST), seed, "sanity: the list's first byte should be mirrored");
  console.log(`  CRAFTED: flipped path mirror identical (list[0] ${hx(seed)} -> ${hx(c.mem.read8(SPRITE_DISPLAY_LIST))})`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong counter decrement is CAUGHT at the counter cell", () => {
  const counter = 0x889c;
  const o = craft(counter, 0x05, 0x01);
  const c = craft(counter, 0x05, 0x01);
  oracle(o);
  tickCounterAndMirrorIfFlipped(c);
  c.mem.write8(counter, 0x03); // BUG: 0x05 must decrement to 0x04, not 0x03
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong counter decrement — it is worthless");
  assert.equal(d.addr, counter, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(counter)})`);
  console.log(`  TEETH(counter): wrong dec caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: ignores the orientation gate and always mirrors. */
function brokenAlwaysMirror(m, counter = m.regs.hl) {
  m.mem8[counter] = (m.mem8[counter] - 1) & 0xff;
  mirrorSpriteListVertically(m); // BUG: must NOT mirror while the flag is non-zero
}

test("TEETH: mirroring on the normal path is CAUGHT in the sprite-list region", () => {
  const counter = 0x889c;
  const o = craft(counter, 0x05, 0x01); // normal orientation -> oracle does NOT mirror
  const c = craft(counter, 0x05, 0x01);
  oracle(o);
  brokenAlwaysMirror(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an unwanted mirror pass — it is worthless");
  assert.ok(d.addr >= SPRITE_DISPLAY_LIST && d.addr < SPRITE_DISPLAY_LIST + LIST_LEN, `teeth caught outside the list at ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(gate): unwanted mirror caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
