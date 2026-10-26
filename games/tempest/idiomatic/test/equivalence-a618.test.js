// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepEnemyFleetAndSpawn (ROM 0xa618-0xa65a) -- the per-frame enemy-slot walk. Copies the spawn
// countdown $010e into the "active" flag $010d, walks the 16 slots high-to-low: a live slot ($0283,x != 0)
// integrates (a6a9) + steps (a721) and marks $010d = 0xff; a free slot spawns (a65b) when $010e != 0. On
// even $03 frames it ticks the countdown; if nothing was live/spawned it raises $00 = 0x12.
//   REGISTER THREAD (the point of this dissolve): a721 leaves its axis-2 stepped whole in Y. That register
// persists in the ROM, and a later free-slot spawn consumes it -- a65b -> ccc1 -> ccc3 -> ccc7 stamps the
// live Y into $32 (X into $31). The idiomatic side captures a721's RETURN (not m.regs.y after the call) and
// threads it to a65b. So the thread's observable live-out is the memory cell $32; the TEETH arm proves that
// threading the WRONG register (the stale entry Y) diverges there.
//   POKEY coupling: a65b reads $60ca/$60da (RANDOM). The oracle's m.step charges cycles the idiomatic does
// not, so the arms only agree when the POKEY poly is frozen (clear SK_RESET -> _advance early-returns ->
// RANDOM constant). Freezing the clones makes CAPTURE deterministic; a fresh machine already has skctl 0.
//   Sound gate: ccc3 only stamps when $05 bit7 is set. CRAFTED/TEETH open it ($05 = 0x80) or the $32 stamp
// (and thus the register teeth) would be toothless.
//   Live-out is RAM plus the exit [X, Y] it returns (0, the threaded Y; the frame loop carries it to the sound
// loader's stash), so each arm compares the RAM diff (dumpState minus STACK_SCRATCH) and the CAPTURE arm the pair. An omitted-ret rewrite.
// Run: node --test games/tempest/idiomatic/test/equivalence-a618.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a618 as oracle } from "../../translated/loc_a618.js";
import { stepEnemyFleetAndSpawn } from "../stepEnemyFleetAndSpawn.js";
import { advanceEnemyFreeFlight } from "../advanceEnemyFreeFlight.js";
import { decayEnemyFreeFlightVelocity } from "../decayEnemyFreeFlightVelocity.js";
import { spawnEnemyInSlot } from "../spawnEnemyInSlot.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { u8, u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, GAME_MODE, FRAME_COUNTER, STATUS_FLAGS, loc_32, SLOT_LOOP_INDEX, SPAWN_FOUND_FLAG, SPAWN_BUDGET_TIMER, ENEMY_SLOT_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa618;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Clearing SK_RESET (0x03) makes _advance early-return, so RANDOM ($60ca/$60da) no longer moves with the
// cycle count -> both arms read the same random bytes.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 6000) : [];

test("CAPTURE: real 0xa618 dispatches -- stepEnemyFleetAndSpawn == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); { const ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry Y goes in as the argument; the routine takes no entry X
      assert.deepEqual(stepEnemyFleetAndSpawn(c, ey), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// One live slot at LIVE (x=5) and free slots everywhere else, with a nonzero countdown so every free slot
// spawns. Walking 0x0f..0x00, the last spawn (x=0) runs AFTER the live slot, so it consumes the register
// a721 left at slot 5 -> $32. Entry Y is a distinctive sentinel so a wrong (stale) thread is observable.
const LIVE = 5;
const ENTRY_Y = 0xee;
function seedCrafted(m, { frame = 0x00 } = {}) {
  freezePokey(m);
  m.regs.y = ENTRY_Y;
  m.regs.x = 0x00;
  m.mem.write8(STATUS_FLAGS, 0x80);   // open the sound gate so ccc7 stamps $31/$32
  m.mem.write8(FRAME_COUNTER, frame);  // $03 frame parity
  m.mem.write8(SPAWN_BUDGET_TIMER, 0x08); // spawn countdown nonzero -> free slots spawn (also seeds $010d)
  for (let x = 0; x < 16; x++) m.mem.write8(u16(ENEMY_SLOT_FLAGS + x), 0x00); // all free...
  m.mem.write8(u16(ENEMY_SLOT_FLAGS + LIVE), 0x40); // ...except one live slot
  // give the live slot some velocity so a721's stepped whole (the threaded register) is nonzero
  for (const b of [0x02c3, 0x0323, 0x02e3, 0x0343, 0x0303, 0x0363]) m.mem.write8(u16(b + LIVE), 0x11);
}

test("CRAFTED: live slot integrates+steps, free slots spawn; RAM == oracle and $010d marked active", () => {
  const o = new Machine(ROM, OPTS); seedCrafted(o);
  const c = new Machine(ROM, OPTS); seedCrafted(c);
  oracle(o); stepEnemyFleetAndSpawn(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the slot walk");
  assert.equal(c.mem.read8(SPAWN_FOUND_FLAG), 0xff, "live slot marked the frame active");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), 0xff, "slot counter fell through to 0xff");
  assert.equal(c.mem.read8(loc_32), o.mem.read8(loc_32), "threaded register stamped identically into $32");
});

// All 16 slots free, so no live slot's a721 overwrites the entry Y: with a spawn budget every spawn stamps the entry
// Y into $32, and without one the routine exits with it untouched. The other arms all have a live slot.
test("CRAFTED all-free: entry Y reaches $32 and the exit, with and without a spawn budget (m.regs poisoned)", () => {
  for (const budget of [0x08, 0x00]) {
    const seed = (m) => {
      freezePokey(m);
      m.mem.write8(STATUS_FLAGS, 0x80);
      m.mem.write8(SPAWN_BUDGET_TIMER, budget);
      for (let x = 0; x < 16; x++) m.mem.write8(u16(ENEMY_SLOT_FLAGS + x), 0x00);
      m.regs.x = 0x00; m.regs.y = 0x33;
    };
    const o = new Machine(ROM, OPTS); seed(o);
    const c = new Machine(ROM, OPTS); seed(c); c.regs.x = 0x5a; c.regs.y = 0xa5;
    oracle(o);
    assert.deepEqual([o.regs.x, o.regs.y], [0x00, 0x33], `budget ${budget}: positive control -- the oracle exits with the entry Y`);
    if (budget) assert.equal(o.mem.read8(loc_32), 0x33, "positive control -- a spawn stamped the entry Y into $32");
    assert.deepEqual(stepEnemyFleetAndSpawn(c, 0x33), [o.regs.x, o.regs.y], `budget ${budget}: returned exit [X, Y]`);
    assert.equal(c.mem.read8(loc_32), o.mem.read8(loc_32), `budget ${budget}: $32`);
    assert.equal(ramDiff(o, c), null, `budget ${budget}: RAM equal`);
  }
});

test("TEETH (register thread): threading the STALE entry Y instead of a721's return diverges in $32", () => {
  const o = new Machine(ROM, OPTS); seedCrafted(o);
  const c = new Machine(ROM, OPTS); seedCrafted(c);
  oracle(o);
  const correctY = o.mem.read8(loc_32);
  assert.notEqual(correctY, ENTRY_Y, "precondition: a721's return differs from the entry Y (thread is observable)");
  // BUG: discards a721's return, so every spawn consumes the stale entry Y.
  const brokenA618 = (m, y = m.regs.y) => {
    const { mem8 } = m;
    mem8[SPAWN_FOUND_FLAG] = mem8[SPAWN_BUDGET_TIMER];
    for (let x = 0x0f; x >= 0; x--) {
      if (mem8[u16(ENEMY_SLOT_FLAGS + x)] !== 0) {
        advanceEnemyFreeFlight(m, x); decayEnemyFreeFlightVelocity(m, x); // return discarded -> y never updated
        mem8[SPAWN_FOUND_FLAG] = 0xff;
      } else if (mem8[SPAWN_BUDGET_TIMER] !== 0) {
        spawnEnemyInSlot(m, x, y);
      }
    }
    mem8[SLOT_LOOP_INDEX] = 0xff;
    if ((mem8[FRAME_COUNTER] & 0x01) === 0 && mem8[SPAWN_BUDGET_TIMER] !== 0) mem8[SPAWN_BUDGET_TIMER] = u8(mem8[SPAWN_BUDGET_TIMER] - 1);
    if (mem8[SPAWN_FOUND_FLAG] === 0) mem8[GAME_MODE] = 0x12;
  };
  brokenA618(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong threaded register");
  assert.equal(c.mem.read8(loc_32), ENTRY_Y, "broken twin stamped the stale entry Y into $32");
  assert.notEqual(o.mem.read8(loc_32), c.mem.read8(loc_32), "oracle vs broken diverge in $32");
});

test("TEETH (countdown gate): a twin that ticks $010e on an ODD $03 frame diverges", () => {
  const o = new Machine(ROM, OPTS); seedCrafted(o, { frame: 0x01 }); // odd -> oracle must NOT tick
  const c = new Machine(ROM, OPTS); seedCrafted(c, { frame: 0x01 });
  oracle(o);
  // BUG: always decrements the countdown, ignoring the even/odd frame gate.
  const brokenA618 = (m, y = m.regs.y) => {
    const { mem8 } = m;
    mem8[SPAWN_FOUND_FLAG] = mem8[SPAWN_BUDGET_TIMER];
    for (let x = 0x0f; x >= 0; x--) {
      if (mem8[u16(ENEMY_SLOT_FLAGS + x)] !== 0) {
        advanceEnemyFreeFlight(m, x); y = decayEnemyFreeFlightVelocity(m, x);
        mem8[SPAWN_FOUND_FLAG] = 0xff;
      } else if (mem8[SPAWN_BUDGET_TIMER] !== 0) {
        spawnEnemyInSlot(m, x, y);
      }
    }
    mem8[SLOT_LOOP_INDEX] = 0xff;
    if (mem8[SPAWN_BUDGET_TIMER] !== 0) mem8[SPAWN_BUDGET_TIMER] = u8(mem8[SPAWN_BUDGET_TIMER] - 1); // BUG: no frame gate
    if (mem8[SPAWN_FOUND_FLAG] === 0) mem8[GAME_MODE] = 0x12;
  };
  brokenA618(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the ungated countdown tick");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, stepEnemyFleetAndSpawn, TARGET, m);
  assert.equal(r.placeable, true, `stepEnemyFleetAndSpawn must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
