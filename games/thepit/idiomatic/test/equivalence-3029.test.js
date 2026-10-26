// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for publishChamberCreatureSprite (ROM 0x3029, The Pit) — the publish
 * tail of the chamber-creature updater: write four screen-relative sprite bytes into the staging
 * slot at 0x822c (X and Y shifted by the cabinet coordinate bias 0x8051, tile and colour verbatim),
 * then tail-jump into the object-record pass at 0x312d.
 *
 * CONTRACT. The routine's live-out is MEMORY-ONLY (its four sprite bytes plus whatever the object
 * pass it tail-jumps into leaves); it is reached by fall-through, so no caller reads a value
 * register back. The oracle loc_3029 reaches the object pass by `m.call(0x312d)`; the idiomatic
 * rewrite reaches it by a direct call. Both now run the SAME real object pass (0x2fe3/0x3029/0x312d
 * are all decompiled), so the gate compares work RAM over the full run (dumpState) rather than
 * stubbing the tail — the honest dissolved-form contract. The object pass's rare arrival/capture
 * tail can reach the two never-returning transition leaves (0x031a, 0x01f9), so those are stubbed
 * identically on both clones and the once-per-frame frame-tick is modelled so any frame-wait drains.
 * Stack scratch below the entry SP is
 * excluded — the sprite slot (0x822c) and the object records live far below it.
 *
 * EQUAL is proven over every real captured sibling state, and over a crafted sweep of the four
 * source cells crossed with the coordinate bias (including a non-zero bias attract never produces).
 * The teeth twins (dropped bias on the X byte, corrupted verbatim tile byte) are caught at the slot.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-3029.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3029 as oracle } from "../../translated/loc_3029.js";
import { publishChamberCreatureSprite as idiomatic } from "../publishChamberCreatureSprite.js";
import { updateEnemy1 } from "../updateEnemy1.js";
import { loc_2f71 } from "../../translated/loc_2f71.js";
import { makeMachineFactory } from "../../machine.js";
import {
  CHAMBER_CREATURE_X,
  CHAMBER_CREATURE_FRAME,
  CHAMBER_CREATURE_ATTR,
  CHAMBER_CREATURE_FALL_Y,
  CHAMBER_CREATURE_SPRITE,
  SPRITE_COORD_BIAS,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const SIB = 0x2f71; // the reachable sibling we capture real attract states at
const SPR = CHAMBER_CREATURE_SPRITE; // 0x822c, the four-byte staging slot
const EXPIRY_LEAVES = [0x031a, 0x01f9]; // never-returning transition leaves the object pass can reach
const WATCHDOG = 0xb800; // reading it kicks the once-per-frame countdown
const COUNTDOWN = 0x8009; // the per-frame countdown a frame-wait drains to 0
const CHAIN_SCRATCH_LO = 0x83e0;
const CHAIN_SCRATCH_HI = 0x8400;
const CAPTURE_FRAMES = 900;
const CAPTURE_LIMIT = 64;
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

// Clone the entry, stub the never-returning transition leaves identically on both sides, model the
// once-per-frame interrupt tick so any frame-wait terminates, run `fn`, and return the machine.
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

// First differing work-RAM byte over the full run, excluding stack scratch below the entry SP. Null if equal.
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
  return { ram: ramDiff(a, b, entry.regs.sp), slot: [0, 1, 2, 3].map((i) => a.mem.read8(SPR + i)) };
}

// -- 1. EQUAL: every real captured sibling state ------------------------------

test("EQUAL (captured): publishChamberCreatureSprite == oracle on every real sibling state", () => {
  assert.ok(STATES.length > 0, "captured at least one real attract state at the sibling loc_2f71");
  for (const entry of STATES) {
    const r = runPair(entry, idiomatic);
    assert.equal(r.ram, null, r.ram && `RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
  }
  console.log(`  EQUAL/captured: ${STATES.length} real sibling states identical (work RAM, full tail)`);
});

// -- 2. EQUAL: crafted sweep over the source cells x bias ----------------------

test("EQUAL (crafted): identical over source cells x coordinate bias", () => {
  const base = STATES[0];
  assert.ok(base, "have a base state to poke");
  const vals = [0x00, 0x19, 0x38, 0x86, 0xff];
  for (const bias of [0x00, 0x05, 0x40]) {
    for (const x of vals) for (const y of vals) {
      const r = runPair(base, idiomatic, (c) => {
        c.mem.write8(SPRITE_COORD_BIAS, bias);
        c.mem.write8(CHAMBER_CREATURE_X, x);
        c.mem.write8(CHAMBER_CREATURE_FALL_Y, y);
        c.mem.write8(CHAMBER_CREATURE_FRAME, 0x39);
        c.mem.write8(CHAMBER_CREATURE_ATTR, 0x07);
      });
      assert.equal(r.ram, null, r.ram && `bias=${hx(bias)} x=${hx(x)} y=${hx(y)}: RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
    }
  }
  console.log("  EQUAL/crafted: 3 biases x 25 x/y source pairs identical to the oracle");
});

// -- 3. TEETH: broken twins the gate MUST catch -------------------------------

// Drops the coordinate bias on the X byte (writes X verbatim instead of X - bias); the tail is
// run identically so the ONLY difference from the oracle is the corrupted sprite byte.
function brokenBias(m) {
  const { mem8 } = m;
  const bias = mem8[SPRITE_COORD_BIAS];
  mem8[CHAMBER_CREATURE_SPRITE] = mem8[CHAMBER_CREATURE_X]; // BUG: no bias
  mem8[CHAMBER_CREATURE_SPRITE + 1] = mem8[CHAMBER_CREATURE_FRAME];
  mem8[CHAMBER_CREATURE_SPRITE + 2] = mem8[CHAMBER_CREATURE_ATTR];
  mem8[CHAMBER_CREATURE_SPRITE + 3] = mem8[CHAMBER_CREATURE_FALL_Y] + bias;
  return updateEnemy1(m);
}

test("TEETH: a dropped coordinate bias is CAUGHT at the sprite slot", () => {
  const entry = STATES[0];
  const poke = (c) => { c.mem.write8(SPRITE_COORD_BIAS, 0x05); c.mem.write8(CHAMBER_CREATURE_X, 0x30); };
  // Run the oracle and the broken twin (which omits the tail) through the same isolation.
  const a = runIsolated(entry, (c) => { poke(c); oracle(c); });
  const b = runIsolated(entry, (c) => { poke(c); brokenBias(c); });
  const r = ramDiff(a, b, entry.regs.sp);
  assert.notEqual(r, null, "the gate FAILED to catch a dropped bias — it is worthless");
  assert.equal(r.addr, SPR, `teeth caught ${hx(r.addr)} (expected the sprite slot ${hx(SPR)})`);
  console.log(`  TEETH: dropped bias caught at ${hx(r.addr)} (oracle=${r.a} broken=${r.b})`);
});

// Corrupts a verbatim byte (the tile field); the tail is run identically.
function brokenTile(m) {
  const { mem8 } = m;
  const bias = mem8[SPRITE_COORD_BIAS];
  mem8[CHAMBER_CREATURE_SPRITE] = mem8[CHAMBER_CREATURE_X] - bias;
  mem8[CHAMBER_CREATURE_SPRITE + 1] = mem8[CHAMBER_CREATURE_FRAME] ^ 0xff; // BUG
  mem8[CHAMBER_CREATURE_SPRITE + 2] = mem8[CHAMBER_CREATURE_ATTR];
  mem8[CHAMBER_CREATURE_SPRITE + 3] = mem8[CHAMBER_CREATURE_FALL_Y] + bias;
  return updateEnemy1(m);
}

test("TEETH: a corrupted verbatim tile byte is CAUGHT at the sprite slot", () => {
  const entry = STATES[0];
  const poke = (c) => c.mem.write8(CHAMBER_CREATURE_FRAME, 0x39);
  const a = runIsolated(entry, (c) => { poke(c); oracle(c); });
  const b = runIsolated(entry, (c) => { poke(c); brokenTile(c); });
  const r = ramDiff(a, b, entry.regs.sp);
  assert.notEqual(r, null, "the gate FAILED to catch a corrupted tile byte — it is worthless");
  assert.equal(r.addr, SPR + 1, `teeth caught ${hx(r.addr)} (expected the tile byte ${hx(SPR + 1)})`);
  console.log(`  TEETH: corrupted tile caught at ${hx(r.addr)} (oracle=${r.a} broken=${r.b})`);
});
