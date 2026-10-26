// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blitStackedTwoTileAnimFrameOnHoldTimer (ROM 0x6b13) — a frame-gated two-tile blitter. The hold
 * countdown 0x8f06 gates the work: while non-zero it decrements and returns. On expiry it reloads
 * 0x8f06 to 0x0c, advances the phase 0x8f07, and picks a four-byte source pattern by the phase's low
 * bit (0x2744 even, 0x2748 odd). That pattern is stamped as a 2x2 block at 0x84b4 and again at the
 * advanced pointer minus 0x60 (0x8474), i.e. two rows higher.
 *
 * CYCLE-FREE / memory-equivalence gate. The oracle drives its two 2x2 blits through the still-frozen
 * 0x3325 (dispatched via the registry on a plain Machine) and trampolines the return through the
 * stack; the module calls the idiomatic 2x2 blitter directly. The contract is RAM only (dumpState
 * minus stack scratch below the entry SP): no register is a live-out — the two caller sites reload their own registers
 * after the call.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x6b13 in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the hold branch (0x8f06 decrement, no blit) and the work branch for both phases,
 *      including the 0xff phase wrap; the eight video cells are pre-dirtied to prove overwrite.
 *   3. WRITE-SET — the work branch writes only the two counters and the eight video cells.
 *   4. TEETH — a wrong byte in the last video cell MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6b13.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6b13 as oracle } from "../../translated/loc_6b13.js";
import { blitStackedTwoTileAnimFrameOnHoldTimer } from "../blitStackedTwoTileAnimFrameOnHoldTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x6b13;
const HOLD = 0x8f06;    // hold countdown
const PHASE = 0x8f07;   // phase counter (bit0 selects the source block)
// The eight video cells: first 2x2 block anchored at 0x84b4, second at 0x8474 (advanced ptr − 0x60).
const CELLS = [0x84b4, 0x84b5, 0x84d5, 0x84d4, 0x8474, 0x8475, 0x8495, 0x8494];
const NEIGHBOUR = 0x8f09; // a nearby work-RAM cell the routine must NOT touch
const RELOAD = 0x0c;
const WRITTEN = new Set([HOLD, PHASE, ...CELLS]);
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the two counters seated, the eight video cells pre-dirtied, SP in scratch. */
function craft(hold, phase) {
  const m = BASE.clone();
  m.regs.sp = STACK_SCRATCH.hi - 0x10; // the oracle push/pop/call trampoline lands in scratch
  m.mem.write8(HOLD, hold);
  m.mem.write8(PHASE, phase);
  for (const c of CELLS) m.mem.write8(c, 0xaa);
  m.mem.write8(NEIGHBOUR, 0x5a);
  return m;
}

// hold, phase-seed. hold != 0 -> hold branch (no blit); hold == 0 -> work branch.
const CASES = [
  { name: "hold=5", hold: 0x05, phase: 0x00 },
  { name: "hold=1", hold: 0x01, phase: 0x00 },
  { name: "work,phase->odd", hold: 0x00, phase: 0x00 }, // 0x8f07 0->1, odd -> 0x2748
  { name: "work,phase->even", hold: 0x00, phase: 0x01 }, // 0x8f07 1->2, even -> 0x2744
  { name: "work,phase-wrap", hold: 0x00, phase: 0xff }, // 0x8f07 0xff->0, even -> 0x2744
];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 6000) : [];

test("CAPTURE: real 0x6b13 dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    blitStackedTwoTileAnimFrameOnHoldTimer(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: hold + work branches (both phases, wrap) — RAM identical", () => {
  for (const { name, hold, phase } of CASES) {
    const o = craft(hold, phase);
    const c = craft(hold, phase);
    oracle(o);
    blitStackedTwoTileAnimFrameOnHoldTimer(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    if (hold !== 0) {
      assert.equal(c.mem.read8(HOLD), (hold - 1) & 0xff, `${name}: hold decremented`);
      for (const cell of CELLS) assert.equal(c.mem.read8(cell), 0xaa, `${name}: no blit on the hold branch`);
    } else {
      assert.equal(c.mem.read8(HOLD), RELOAD, `${name}: hold reloaded`);
      assert.equal(c.mem.read8(PHASE), (phase + 1) & 0xff, `${name}: phase advanced (wraps)`);
    }
    assert.equal(c.mem.read8(NEIGHBOUR), 0x5a, `${name}: neighbour untouched`);
  }
  console.log(`  CRAFTED: ${CASES.length} scenarios blitted identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the work branch writes only the two counters and eight video cells", () => {
  for (const phase of [0x00, 0x01]) {
    const before = craft(0x00, phase);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    const changed = new Set();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
    }
    changed.delete(null);
    for (const addr of changed) {
      if (inDeadStack(addr)) continue;
      assert.ok(WRITTEN.has(addr), `phase ${hx(phase)}: oracle wrote unexpected addr ${hx(addr)}`);
    }
    assert.ok(changed.has(HOLD), `phase ${hx(phase)}: hold should change`);
    assert.ok(changed.has(PHASE), `phase ${hx(phase)}: phase should change`);
  }
  console.log("  WRITE-SET: work branch = two counters + eight video cells");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong last video cell is CAUGHT by the RAM diff", () => {
  const lastCell = CELLS[CELLS.length - 1];
  const o = craft(0x00, 0x00);
  const c = craft(0x00, 0x00);
  oracle(o);
  blitStackedTwoTileAnimFrameOnHoldTimer(c);
  c.mem.write8(lastCell, (c.mem.read8(lastCell) ^ 0xff) & 0xff); // BUG: corrupt the last painted tile

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong video byte — it is worthless");
  assert.equal(d.addr, lastCell, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong video byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
