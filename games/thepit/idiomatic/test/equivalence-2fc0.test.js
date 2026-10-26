// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceChamberCreatureAnimation (ROM 0x2fc0, The Pit) — the chamber
 * creature's sprite-flip phase clock: tick the phase countdown and route the frame to the publish
 * tail (off-beat), the position-step body (on-beat, every fourth frame), or the reload + tile-flip +
 * commit tail (countdown expired).
 *
 * DISSOLVED-FORM CONTRACT. All three continuations (0x3029 publish, 0x2fe3 oscillator, 0x2fd9 commit)
 * are now decompiled, so the oracle's `m.call`s and the idiomatic direct calls run the SAME real
 * tail. The gate runs the full chain on both sides and compares work RAM (dumpState) rather than
 * stubbing the continuations. The object pass a tail reaches can hit the two never-returning
 * transition leaves (0x031a, 0x01f9), stubbed identically on both clones; the once-per-frame tick is
 * modelled and stack scratch below the entry SP excluded. advanceChamberCreatureAnimation is never dispatched
 * at its own address in attract (the sibling monolith loc_2f71 inlines the body), so entries are
 * crafted from real sibling states.
 *
 * EQUAL is proven over every real captured sibling state AND an exhaustive sweep of the phase counter
 * (all 256 entry values) crossed with the flip tiles, reaching all three arms. The teeth twins
 * (wrong reload, mis-routed on-beat frame, dropped flip) are caught at the exact cell.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2fc0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2fc0 as oracle } from "../../translated/loc_2fc0.js";
import { advanceChamberCreatureAnimation as idiomatic } from "../advanceChamberCreatureAnimation.js";
import { oscillateChamberCreature } from "../oscillateChamberCreature.js";
import { publishChamberCreatureSprite } from "../publishChamberCreatureSprite.js";
import { setChamberCreatureFrame } from "../setChamberCreatureFrame.js";
import { loc_2f71 } from "../../translated/loc_2f71.js";
import { makeMachineFactory } from "../../machine.js";
import { CHAMBER_CREATURE_ANIM_PHASE, CHAMBER_CREATURE_FRAME, CHAMBER_CREATURE_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const SIB = 0x2f71;
const PHASE = CHAMBER_CREATURE_ANIM_PHASE; // 0x80e3
const FLIP_TILE = CHAMBER_CREATURE_FRAME; // 0x80dc
const FLIP_TILE_A = 56, FLIP_TILE_B = 57;
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800, COUNTDOWN = 0x8009;
const CHAIN_SCRATCH_LO = 0x83e0, CHAIN_SCRATCH_HI = 0x8400;
const CAPTURE_FRAMES = 900, CAPTURE_LIMIT = 96;
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

test("EQUAL (captured): advanceChamberCreatureAnimation == oracle on every real sibling state", () => {
  assert.ok(STATES.length > 0, "captured at least one real attract state at the sibling loc_2f71");
  for (const entry of STATES) {
    const r = runPair(entry, idiomatic);
    assert.equal(r.ram, null, r.ram && `RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
  }
  console.log(`  EQUAL/captured: ${STATES.length} real sibling states identical (work RAM, full tail)`);
});

// -- 2. EQUAL: exhaustive over the phase counter x the flip tiles --------------

test("EQUAL (exhaustive): identical over all 256 phase values x flip tiles", () => {
  const base = STATES[0];
  assert.ok(base, "have a base state to poke");
  const tiles = [0, 55, 56, 57, 58, 255];
  for (let e3 = 0; e3 < 256; e3++) {
    for (const dc of tiles) {
      const r = runPair(base, idiomatic, (c) => { c.mem.write8(PHASE, e3); c.mem.write8(FLIP_TILE, dc); });
      assert.equal(r.ram, null, r.ram && `e3=${hx(e3)} dc=${hx(dc)}: RAM diverged at ${hx(r.ram.addr)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
    }
  }
  console.log("  EQUAL/exhaustive: 256 x 6 phase/tile inputs identical to the oracle (work RAM, full tail)");
});

// -- 3. TEETH: broken twins the gate MUST catch -------------------------------

// Reloads the phase counter to the WRONG value on the expired frame; real commit tail otherwise.
function brokenReload(m) {
  const { mem8 } = m;
  const phase = (mem8[PHASE] - 1 + 256) % 256;
  mem8[PHASE] = phase;
  if (phase !== 0) return phase % 4 !== 0 ? publishChamberCreatureSprite(m) : oscillateChamberCreature(m);
  mem8[PHASE] = 7; // BUG: reloads to 7 instead of 8
  const tile = mem8[FLIP_TILE];
  return setChamberCreatureFrame(m, tile === FLIP_TILE_A ? FLIP_TILE_B : FLIP_TILE_A);
}
// Mis-routes the on-beat frame to the publish tail (skips the position step).
function brokenRoute(m) {
  const { mem8 } = m;
  const phase = (mem8[PHASE] - 1 + 256) % 256;
  mem8[PHASE] = phase;
  if (phase !== 0) return publishChamberCreatureSprite(m); // BUG: on-beat should oscillate
  mem8[PHASE] = 8;
  const tile = mem8[FLIP_TILE];
  return setChamberCreatureFrame(m, tile === FLIP_TILE_A ? FLIP_TILE_B : FLIP_TILE_A);
}
// Never flips the tile on the expired frame; real commit tail otherwise.
function brokenFlip(m) {
  const { mem8 } = m;
  const phase = (mem8[PHASE] - 1 + 256) % 256;
  mem8[PHASE] = phase;
  if (phase !== 0) return phase % 4 !== 0 ? publishChamberCreatureSprite(m) : oscillateChamberCreature(m);
  mem8[PHASE] = 8;
  return setChamberCreatureFrame(m, mem8[FLIP_TILE]); // BUG: commits current tile, no flip
}

test("TEETH: a wrong reload value is CAUGHT at the phase counter", () => {
  const r = runPair(STATES[0], brokenReload, (c) => c.mem.write8(PHASE, 1)); // -> phase 0, reload frame
  assert.notEqual(r.ram, null, "the gate FAILED to catch a wrong reload value — it is worthless");
  assert.equal(r.ram.addr, PHASE, `teeth caught ${hx(r.ram.addr)} (expected the phase counter ${hx(PHASE)})`);
  console.log(`  TEETH: wrong reload caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a mis-routed on-beat frame is CAUGHT at the position cell", () => {
  const r = runPair(STATES[0], brokenRoute, (c) => c.mem.write8(PHASE, 5)); // -> phase 4, on-beat
  assert.notEqual(r.ram, null, "the gate FAILED to catch a mis-route — it is worthless");
  assert.equal(r.ram.addr, CHAMBER_CREATURE_X, `teeth caught ${hx(r.ram.addr)} (expected the position cell ${hx(CHAMBER_CREATURE_X)})`);
  console.log(`  TEETH: mis-route caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a dropped tile flip is CAUGHT at the flip-tile cell", () => {
  const r = runPair(STATES[0], brokenFlip, (c) => { c.mem.write8(PHASE, 1); c.mem.write8(FLIP_TILE, FLIP_TILE_A); });
  assert.notEqual(r.ram, null, "the gate FAILED to catch a dropped flip — it is worthless");
  assert.equal(r.ram.addr, FLIP_TILE, `teeth caught ${hx(r.ram.addr)} (expected the flip-tile cell ${hx(FLIP_TILE)})`);
  console.log(`  TEETH: dropped flip caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});
