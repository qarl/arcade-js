// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for oscillateChamberCreature (ROM 0x2fe3, The Pit) — the position-step
 * body of the chamber-creature updater, run on the frames the creature actually moves: bounce X
 * within [0x19,0x38) (reverse velocity at each wall, hold it mid-band), accelerate the fall-Y each
 * frame until it reaches the floor at 0x86, where it clamps, draws a fresh random step (via 0x4b1a)
 * and advances colour with the priority bit held clear. It then falls through into the publish tail
 * and the object-record pass.
 *
 * CONTRACT. MEMORY-ONLY live-out (the creature's position/velocity/step/colour cells, the published
 * sprite slot, and whatever the object pass leaves); reached by fall-through, so no value register is
 * read back. The oracle loc_2fe3 reaches the publish tail by `m.call(0x3029)` and the object pass by
 * `m.call(0x312d)`; the idiomatic rewrite reaches both by direct calls. Both run the SAME real tail
 * (all three are decompiled), so the gate compares work RAM over the full run (dumpState) — the
 * honest dissolved-form contract — stubbing only the two never-returning transition leaves the
 * object pass can reach (0x031a, 0x01f9) and modelling the once-per-frame tick so any frame-wait
 * drains. Stack scratch below the entry SP is excluded.
 *
 * EQUAL is proven over every real captured sibling state and a crafted sweep of X x velocity x
 * fall-Y x fall-step that reaches all three bounce arms and both the on-screen and floor-reset
 * paths. The teeth twins (a dropped wall reversal, a dropped floor clamp) are caught at the exact cell.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2fe3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2fe3 as oracle } from "../../translated/loc_2fe3.js";
import { oscillateChamberCreature as idiomatic } from "../oscillateChamberCreature.js";
import { publishChamberCreatureSprite } from "../publishChamberCreatureSprite.js";
import { advanceRandom } from "../advanceRandom.js";
import { loc_2f71 } from "../../translated/loc_2f71.js";
import { makeMachineFactory } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  CHAMBER_CREATURE_X,
  CHAMBER_CREATURE_X_VELOCITY,
  CHAMBER_CREATURE_FALL_Y,
  CHAMBER_CREATURE_FALL_STEP,
  CHAMBER_CREATURE_ATTR,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const SIB = 0x2f71;
const CX = CHAMBER_CREATURE_X, VX = CHAMBER_CREATURE_X_VELOCITY;
const FY = CHAMBER_CREATURE_FALL_Y, FS = CHAMBER_CREATURE_FALL_STEP, ATTR = CHAMBER_CREATURE_ATTR;
const RIGHT_WALL = 56, LEFT_WALL = 25, STEP_LEFT = 255, STEP_RIGHT = 1, FLOOR_Y = 134;
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800, COUNTDOWN = 0x8009;
const CHAIN_SCRATCH_LO = 0x83e0, CHAIN_SCRATCH_HI = 0x8400;
const CAPTURE_FRAMES = 900, CAPTURE_LIMIT = 64;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

function captureSiblingStates() {
  const states = [];
  const overrides = new Map([[SIB, (mm) => {
    if (states.length < CAPTURE_LIMIT) states.push(mm.clone());
    return loc_2f71(mm);
  }]]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return states;
}
const STATES = ROM_PRESENT ? captureSiblingStates() : [];

function runIsolated(entry, fn) {
  const c = entry.clone();
  for (const a of EXPIRY_LEAVES) c.routines.set(a, () => {});
  const mem = c.mem;
  const orig = mem.read8.bind(mem);
  mem.read8 = (addr) => {
    if (addr === WATCHDOG) { const v = orig(COUNTDOWN); if (v !== 0) mem.write8(COUNTDOWN, v - 1); }
    return orig(addr);
  };
  fn(c);
  return c;
}
function ramDiff(a, b, entrySP) {
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] !== db[i]) {
      const addr = a.stateOffsetToAddr(i);
      if (deadStackBelow({ lo: CHAIN_SCRATCH_LO, hi: CHAIN_SCRATCH_HI }, entrySP)(addr)) continue;
      return { addr, a: da[i], b: db[i] };
    }
  }
  return null;
}
function runPair(entry, candidate, poke) {
  const a = runIsolated(entry, (c) => { poke?.(c); oracle(c); });
  const b = runIsolated(entry, (c) => { poke?.(c); candidate(c); });
  return { ram: ramDiff(a, b, entry.regs.sp) };
}

// -- 1. EQUAL: every real captured sibling state ------------------------------

test("EQUAL (captured): oscillateChamberCreature == oracle on every real sibling state", () => {
  assert.ok(STATES.length > 0, "captured at least one real attract state at the sibling loc_2f71");
  for (const entry of STATES) {
    const r = runPair(entry, idiomatic);
    assert.equal(r.ram, null, r.ram && `RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
  }
  console.log(`  EQUAL/captured: ${STATES.length} real sibling states identical (work RAM, full tail)`);
});

// -- 2. EQUAL: crafted sweep reaching every bounce arm + the floor reset -------

test("EQUAL (crafted): identical over X x velocity x fall-Y x fall-step", () => {
  const base = STATES[0];
  assert.ok(base, "have a base state to poke");
  const xs = [0x00, 0x18, 0x19, 0x30, 0x37, 0x38, 0x50, 0xff]; // straddle both walls
  const vs = [0x01, 0xff]; // moving right / left
  const ys = [0x00, 0x80, 0x86, 0x90]; // below / at / past the floor
  const steps = [0x00, 0x03, 0xff];
  for (const x of xs) for (const v of vs) for (const y of ys) for (const s of steps) {
    const r = runPair(base, idiomatic, (c) => {
      c.mem.write8(CX, x); c.mem.write8(VX, v); c.mem.write8(FY, y); c.mem.write8(FS, s);
    });
    assert.equal(r.ram, null, r.ram && `x=${hx(x)} v=${hx(v)} y=${hx(y)} s=${hx(s)}: RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
  }
  console.log("  EQUAL/crafted: 8 X x 2 velocity x 4 fall-Y x 3 step inputs identical to the oracle");
});

// -- 3. TEETH: broken twins the gate MUST catch -------------------------------

// A faithful body EXCEPT it omits the right-wall reversal; the tail is run identically.
function brokenWall(m) {
  const { mem8 } = m;
  const velocity = mem8[VX];
  const newX = u8(mem8[CX] + velocity);
  mem8[CX] = newX;
  // BUG: no `if (newX >= RIGHT_WALL) mem8[VX] = STEP_LEFT;`
  if (newX < LEFT_WALL) mem8[VX] = STEP_RIGHT;
  const fallStep = mem8[FS] + 1;
  mem8[FS] = fallStep;
  const newY = u8(mem8[FY] + fallStep);
  mem8[FY] = newY;
  if (newY >= FLOOR_Y) {
    mem8[FY] = FLOOR_Y;
    mem8[FS] = (advanceRandom(m) | 0xf8) - 1;
    mem8[ATTR] = (mem8[ATTR] + 1) & 0xf7;
  }
  return publishChamberCreatureSprite(m);
}

// A faithful body EXCEPT it omits the floor clamp; the tail is run identically.
function brokenClamp(m) {
  const { mem8 } = m;
  const velocity = mem8[VX];
  const newX = u8(mem8[CX] + velocity);
  mem8[CX] = newX;
  if (newX >= RIGHT_WALL) mem8[VX] = STEP_LEFT;
  else if (newX < LEFT_WALL) mem8[VX] = STEP_RIGHT;
  const fallStep = mem8[FS] + 1;
  mem8[FS] = fallStep;
  const newY = u8(mem8[FY] + fallStep);
  mem8[FY] = newY;
  if (newY >= FLOOR_Y) {
    // BUG: no `mem8[FY] = FLOOR_Y;` clamp
    mem8[FS] = (advanceRandom(m) | 0xf8) - 1;
    mem8[ATTR] = (mem8[ATTR] + 1) & 0xf7;
  }
  return publishChamberCreatureSprite(m);
}

test("TEETH: a dropped wall reversal is CAUGHT at the velocity cell", () => {
  const poke = (c) => { c.mem.write8(CX, 0x37); c.mem.write8(VX, 0x01); c.mem.write8(FY, 0x00); c.mem.write8(FS, 0x00); };
  const r = runPair(STATES[0], brokenWall, poke); // newX = 0x38 >= RIGHT_WALL -> oracle sets velocity 0xff
  assert.notEqual(r.ram, null, "the gate FAILED to catch a dropped wall reversal — it is worthless");
  assert.equal(r.ram.addr, VX, `teeth caught ${hx(r.ram.addr)} (expected the velocity cell ${hx(VX)})`);
  console.log(`  TEETH: dropped wall reversal caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a dropped floor clamp is CAUGHT at the fall-Y cell", () => {
  const poke = (c) => { c.mem.write8(CX, 0x2c); c.mem.write8(VX, 0x01); c.mem.write8(FY, 0x85); c.mem.write8(FS, 0x04); };
  const r = runPair(STATES[0], brokenClamp, poke); // newY = 0x89 >= FLOOR_Y -> oracle clamps to 0x86
  assert.notEqual(r.ram, null, "the gate FAILED to catch a dropped floor clamp — it is worthless");
  assert.equal(r.ram.addr, FY, `teeth caught ${hx(r.ram.addr)} (expected the fall-Y cell ${hx(FY)})`);
  console.log(`  TEETH: dropped floor clamp caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});
