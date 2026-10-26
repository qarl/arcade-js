// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for spawnClimbersFromSourceSlots -- scans the seven source slots and, for an armed slot whose timer
// underflows and whose RNG roll beats the per-wave gate, copies the spawn fields into the first free
// destination slot and cues the sound via a dissolved jsr $ccbd -> gateSound8f(m, x, y). Live-out is memory
// (the destination slot fields, the reseeded timer, the wave index $a6, and the sound cells ccbd stamps);
// the routine returns the exit [X, Y] the ROM leaves, so each arm compares RAM (dumpState minus STACK_SCRATCH) and
// the CAPTURE arm also the returned pair. POKEY
// polys are frozen so RANDOM ($60ca) is stable across both arms -> the RNG gate is deterministic (0xff).
// Run: node --test games/tempest/idiomatic/test/equivalence-a2a6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a2a6 as oracle } from "../../translated/loc_a2a6.js";
import { spawnClimbersFromSourceSlots } from "../spawnClimbersFromSourceSlots.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { u8, u16 } from "../../../../core/int.js";
import { gateSound8f } from "../gateSound8f.js";
import {
  STACK_SCRATCH, STATUS_FLAGS, SPAWN_TIMER_RELOAD, FLYER_SLOT_TOP, PLAYER_FINE_ANGLE, ENEMY_SLOT_FLAGS, ENEMY_SLOT_DIR, ENEMY_TIMER,
  loc_2b5, ENEMY_SEGMENT, loc_2c8, ENEMY_PHASE, loc_2db, ENEMY_DEPTH, POKEY1_RANDOM, ACTIVE_ENEMY_COUNT, SPAWN_RATE_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa2a6;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xa2a6 dispatches -- spawnClimbersFromSourceSlots == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(spawnClimbersFromSourceSlots(c, ex, ey), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

const SRC = 3; // the one source slot rigged to fire
// One armed slot whose timer underflows + a free destination slot at y=2. Frozen RANDOM (0xff) clears the
// per-wave RNG gate for any table byte.
function seedFire(m) {
  freezePokey(m);
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00); // not negative -> scan runs
  m.mem.write8(STATUS_FLAGS, 0x80); // sound enabled -> ccbd stamps $31/$32
  for (let x = 0; x <= 6; x++) m.mem.write8(u16(ENEMY_DEPTH + x), 0x00); // all slots inert...
  m.mem.write8(u16(ENEMY_DEPTH + SRC), 0x40); // ...except SRC (nonzero, >= 0x30)
  m.mem.write8(u16(ENEMY_SLOT_DIR + SRC), 0x40); // flag bit6 set
  m.mem.write8(u16(ENEMY_TIMER + SRC), 0x00); // timer 0 -> dec underflows -> fire
  m.mem.write8(u16(ENEMY_SLOT_FLAGS + SRC), 0x00); // bit7 clear
  m.mem.write8(ACTIVE_ENEMY_COUNT, 0x00); // wave index
  m.mem.write8(u16(ENEMY_SEGMENT + SRC), 0xaa); // spawn source fields
  m.mem.write8(u16(ENEMY_PHASE + SRC), 0xbb);
  m.mem.write8(SPAWN_TIMER_RELOAD, 0xcc); // timer reseed value
  m.mem.write8(FLYER_SLOT_TOP, 0x04); // free-slot scan starts at y=4
  m.mem.write8(u16(loc_2db + 4), 0x11); // occupied
  m.mem.write8(u16(loc_2db + 3), 0x22); // occupied
  m.mem.write8(u16(loc_2db + 2), 0x00); // FREE -> spawns here
}

test("CRAFTED: one armed slot spawns into the free destination; RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedFire(o);
  const c = new Machine(ROM, OPTS); seedFire(c);
  oracle(o); spawnClimbersFromSourceSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the dissolved spawn + ccbd");
  assert.equal(c.mem.read8(u16(loc_2db + 2)), 0x40, "spawn kind copied to free slot");
  assert.equal(c.mem.read8(u16(loc_2b5 + 2)), 0xaa, "field b copied");
  assert.equal(c.mem.read8(u16(loc_2c8 + 2)), 0xbb, "field c copied");
  assert.equal(c.mem.read8(u16(ENEMY_TIMER + SRC)), 0xcc, "timer reseeded");
  assert.equal(c.mem.read8(ACTIVE_ENEMY_COUNT), 0x01, "wave index advanced");
});

test("TEETH: a twin that never spawns diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedFire(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedFire(c);
  const broken = (_m) => { /* BUG: never scans/spawns */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing spawn");
});

// Marshalling teeth: an otherwise-correct twin that hands ccbd the wrong Y (0 instead of the free-slot
// index) stamps the wrong sound cell -> must diverge, proving the dissolved call threads the live Y.
test("TEETH (marshalling): a twin that passes the wrong Y to ccbd diverges", () => {
  const o = new Machine(ROM, OPTS); seedFire(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedFire(c);
  const wrongY = (m) => {
    const { mem8 } = m;
    if (mem8[PLAYER_FINE_ANGLE] & 0x80) return;
    for (let x = 6; x >= 0; x--) {
      if (mem8[u16(ENEMY_DEPTH + x)] === 0) continue;
      if (mem8[u16(ENEMY_DEPTH + x)] < 0x30) continue;
      if ((mem8[u16(ENEMY_SLOT_DIR + x)] & 0x40) === 0) continue;
      const dec = u8(mem8[u16(ENEMY_TIMER + x)] - 1);
      mem8[u16(ENEMY_TIMER + x)] = dec;
      if ((dec & 0x80) === 0) continue;
      mem8[u16(ENEMY_TIMER + x)] = u8(dec + 1);
      if (mem8[u16(ENEMY_SLOT_FLAGS + x)] & 0x80) continue;
      if (mem8[POKEY1_RANDOM] < mem8[u16(SPAWN_RATE_TABLE + mem8[ACTIVE_ENEMY_COUNT])]) continue;
      let y = mem8[FLYER_SLOT_TOP];
      while (true) {
        if (mem8[u16(loc_2db + y)] === 0) {
          mem8[u16(loc_2db + y)] = mem8[u16(ENEMY_DEPTH + x)];
          mem8[u16(loc_2b5 + y)] = mem8[u16(ENEMY_SEGMENT + x)];
          mem8[u16(loc_2c8 + y)] = mem8[u16(ENEMY_PHASE + x)];
          mem8[u16(ENEMY_TIMER + x)] = mem8[SPAWN_TIMER_RELOAD];
          gateSound8f(m, x, 0); // BUG: stale/wrong Y
          mem8[ACTIVE_ENEMY_COUNT] = u8(mem8[ACTIVE_ENEMY_COUNT] + 1);
          y = 0;
        }
        y = u8(y - 1);
        if (y & 0x80) break;
      }
    }
  };
  wrongY(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong ccbd Y");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, spawnClimbersFromSourceSlots, TARGET, m);
  assert.equal(r.placeable, true, `spawnClimbersFromSourceSlots must be seam-placeable; got: ${r.error}`);
});
