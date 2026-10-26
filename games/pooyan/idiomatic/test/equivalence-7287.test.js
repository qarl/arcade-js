// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armEagleFinishAtGridEdge (ROM 0x7287) — the eagle grid-advance guard. It reads the
 * eagle's advancing grid coordinate at 0x8c94: while that coordinate is below the grid edge 0xd0 it
 * returns it in A (a `ret c`); once it reaches the edge it sets the grid-advance done latch 0x8f3e,
 * runs the phase-reset epilogue (clear 0x8a87 and 0x8f5b, advance 0x8f38, clear 0x8f39), and returns
 * A = 0.
 *
 * Contract: RAM (dumpState minus stack scratch below the entry SP) PLUS the register live-out A. A is load-bearing —
 * the translated caller at 0x724f reads A straight after the call (it derives a grid loop count from
 * it), so the module must SET the register, not merely return the value. pc/SP/cycles are NOT part of
 * the contract (the oracle drives them through the modelled stack; the module does not).
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x7287 in a real run; any dispatch must agree in RAM and A.
 *   2. CRAFTED — both exits: coordinate below the edge (A = coordinate, no writes) and at/above the
 *      edge (latch + epilogue writes, A = 0, phase wrap covered). Pre-dirtied cells prove overwrite.
 *   3. WRITE-SET — at/above the edge the oracle writes exactly the five eagle cells; below, nothing.
 *   4. TEETH — a wrong returned A is caught by the live-out check; a stale done latch (0x8f3e) is
 *      caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7287.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7287 as oracle } from "../../translated/loc_7287.js";
import { armEagleFinishAtGridEdge } from "../armEagleFinishAtGridEdge.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x7287;
const EAGLE_POS = 0x8c94;    // the advancing grid coordinate (enemy/target record slot 0, +4)
const DONE_LATCH = 0x8f3e;   // grid-advance done latch, set at the edge
const AIM = 0x8a87;          // player aim flags, cleared by the epilogue
const LATCHED_X = 0x8f5b;    // latched enemy X, cleared by the epilogue
const PHASE = 0x8f38;        // eagle-wave outer phase, advanced by the epilogue
const SUBCOUNT = 0x8f39;     // records-arrived sub-count, cleared by the epilogue
const NEIGHBOUR = 0x8f3d;    // a nearby cell the routine must NOT touch
const EDGE = 0xd0;
const WRITTEN = [DONE_LATCH, AIM, LATCHED_X, PHASE, SUBCOUNT];
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the coordinate seated and the five eagle cells pre-dirtied. `phase` seeds the
 *  outer-phase cell so its post-increment (including the 0xff wrap) is observable. */
function craft(pos, phase) {
  const m = BASE.clone();
  m.regs.sp = STACK_SCRATCH.hi - 0x10; // the oracle's ret/tail-call only reads the stack (in scratch)
  m.mem.write8(EAGLE_POS, pos);
  m.mem.write8(DONE_LATCH, 0x55);
  m.mem.write8(AIM, 0x99);
  m.mem.write8(LATCHED_X, 0x99);
  m.mem.write8(PHASE, phase);
  m.mem.write8(SUBCOUNT, 0x99);
  m.mem.write8(NEIGHBOUR, 0xaa);
  return m;
}

// pos, phase-seed. pos < 0xd0 -> below-edge (A = pos); pos >= 0xd0 -> at-edge (A = 0, epilogue).
const CASES = [
  { pos: 0x00, phase: 0x40 },
  { pos: 0x59, phase: 0x40 },
  { pos: 0xcf, phase: 0x40 }, // one below the edge
  { pos: 0xd0, phase: 0x40 }, // exactly at the edge -> at-edge path
  { pos: 0xff, phase: 0x40 },
  { pos: 0xe0, phase: 0xff }, // at-edge with a phase wrap 0xff -> 0x00
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

test("CAPTURE: real 0x7287 dispatches — module == oracle in RAM (−stack) + A", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = armEagleFinishAtGridEdge(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.a, "A return matches oracle");
    assert.equal(c.regs.a, o.regs.a, "module SET A for the translated caller");
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: below-edge + at-edge — RAM identical, A identical, module SET A", () => {
  for (const { pos, phase } of CASES) {
    const o = craft(pos, phase);
    const c = craft(pos, phase);
    oracle(o);
    const ret = armEagleFinishAtGridEdge(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `pos ${hx(pos)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.a, `pos ${hx(pos)}: A return matches oracle`);
    assert.equal(c.regs.a, o.regs.a, `pos ${hx(pos)}: module SET A`);

    if (pos < EDGE) {
      assert.equal(ret, pos, `pos ${hx(pos)}: below-edge returns the coordinate`);
      assert.equal(c.mem.read8(DONE_LATCH), 0x55, `pos ${hx(pos)}: below-edge leaves the latch dirt`);
    } else {
      assert.equal(ret, 0x00, `pos ${hx(pos)}: at-edge returns 0`);
      assert.equal(c.mem.read8(DONE_LATCH), 0x01, `pos ${hx(pos)}: at-edge arms the done latch`);
      assert.equal(c.mem.read8(AIM), 0x00, `pos ${hx(pos)}: aim cleared`);
      assert.equal(c.mem.read8(LATCHED_X), 0x00, `pos ${hx(pos)}: latched X cleared`);
      assert.equal(c.mem.read8(PHASE), (phase + 1) & 0xff, `pos ${hx(pos)}: phase advanced (wraps)`);
      assert.equal(c.mem.read8(SUBCOUNT), 0x00, `pos ${hx(pos)}: sub-count cleared`);
    }
    assert.equal(c.mem.read8(NEIGHBOUR), 0xaa, `pos ${hx(pos)}: neighbour untouched`);
  }
  console.log(`  CRAFTED: ${CASES.length} coordinates matched (RAM −stack + A)`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: at-edge writes exactly the five eagle cells; below-edge writes nothing", () => {
  const written = new Set(WRITTEN);

  // at-edge
  {
    const before = craft(0xd0, 0x40);
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
      if (inDeadStack(addr)) continue; // the oracle's tail-call touches only the dead stack
      assert.ok(written.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
    }
    for (const addr of WRITTEN) assert.ok(changed.has(addr), `${hx(addr)} should have changed`);
  }

  // below-edge: no game-state writes
  {
    const before = craft(0x40, 0x40);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) {
        const addr = after.stateOffsetToAddr(off);
        assert.ok(inDeadStack(addr), `below-edge wrote game state at ${hx(addr)}`);
      }
    }
  }
  console.log("  WRITE-SET: at-edge = five eagle cells; below-edge = none");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong returned A is CAUGHT by the live-out check", () => {
  const { pos, phase } = CASES[1]; // below-edge, A = pos
  const o = craft(pos, phase);
  const c = craft(pos, phase);
  oracle(o);
  const ret = armEagleFinishAtGridEdge(c);
  assert.equal(ret, o.regs.a, "sanity: the module's A matches the oracle");
  assert.notEqual((pos + 1) & 0xff, o.regs.a, "the live-out check must reject an off-by-one A");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; an off-by-one ${hx((pos + 1) & 0xff)} is rejected`);
});

test("TEETH: a stale done latch (0x8f3e) is CAUGHT by the RAM diff", () => {
  const o = craft(0xd0, 0x40); // at-edge
  const c = craft(0xd0, 0x40);
  oracle(o);
  armEagleFinishAtGridEdge(c);
  c.mem.write8(DONE_LATCH, 0x55); // BUG: forget to arm the done latch

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a stale done latch — it is worthless");
  assert.equal(d.addr, DONE_LATCH, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: stale latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
