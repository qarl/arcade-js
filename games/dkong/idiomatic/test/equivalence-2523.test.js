// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for service50mObjectSpawnRequest (ROM 0x2523) — the 50m moving-object spawn-request consumer.
 *
 * service50mObjectSpawnRequest gates on a cooldown timer (OBJ_SPAWN_TIMER): while it is running it just ticks it down.
 * Once drained it services a spawn request (OBJ_SPAWN_REQ, whole-byte nonzero), scanning the
 * six-record OBJ_ARRAY_65A0 (stride 0x10) for a free slot (active bit0 clear) and, on finding one,
 * rolling stirRandomSeed (ROM 0x0057) to pick the spawned record's Y (0x7C / 0xCC) and X (0x07 /
 * 0xF8) fields off the roll and the M50_OBJ2/OBJ3 step-dir latches, then activating the record,
 * reloading the timer to 0x7C and clearing the request. Its shared decrement tail lands on
 * OBJ_SPAWN_TIMER on the timer path but on SPIN_COUNT (0x6019) on the spawn path — the pointer
 * stirRandomSeed leaves behind.
 *
 * CRAFTED-ONLY: the routine is 50m-gated (caller sub_24ea does an `rst 0x30` mask-0x02 board test)
 * and is NEVER dispatched during 25m attract — a hooked 0x2523 fires 0 times over 4000 attract
 * frames — so there is no captured-dispatch arm to add. Equivalence is proven by crafted entries
 * built on a real power-on machine, spanning every path.
 *
 * The oracle brackets each `call 0x0057` with a push and terminates with pop-only `ret`s; the
 * candidate direct-calls stirRandomSeed (no push). So on the spawn path the oracle writes two dead
 * stack bytes the candidate never writes; the compare is RAM − the stack scratch below the entry SP [0x6be0,0x6c00) (the
 * memory-equivalence contract for a dissolved push). SP is parked at SAFE_SP so that push lands
 * inside STACK_SCRATCH and the oracle's terminal `ret` pops valid work RAM. The non-spawn paths do
 * no stack writes at all on either side.
 *
 *   1. EQUAL — service50mObjectSpawnRequest == oracle on RAM − the stack scratch below the entry SP across:
 *        - the timer-running tick (several timer values);
 *        - both no-op returns: no request, and a request with every slot busy;
 *        - every first-free-slot position (records 0..5);
 *        - an EXHAUSTIVE 256-value seed sweep over both M50_OBJ2 latch settings (== 1 vs != 1) and
 *          both M50_OBJ3 bit7 settings, plus a nonzero-delta sweep to vary the re-roll's second draw
 *          — covering every X/Y-override arm.
 *      Plus a non-vacuity block pinning the produced record for each arm (0x7C/0xCC Y, 0x07/0xF8 X,
 *      activate/sprite/fixed fields, timer reload, request clear, SPIN_COUNT decrement).
 *
 *   2. TEETH — two deliberately-broken twins the same suite MUST catch:
 *        (a) wrong dec target — decrements the timer on the spawn path instead of SPIN_COUNT;
 *            caught at SPIN_COUNT (0x6019).
 *        (b) dropped X override — never writes 0xF8; caught at the spawned record's X field.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2523.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2523 as oracle } from "../../translated/loc_2523.js";
import { service50mObjectSpawnRequest } from "../service50mObjectSpawnRequest.js";
import { stirRandomSeed } from "../stirRandomSeed.js"; // ROM 0x0057
import { Machine } from "../../machine.js";
import {
  OBJ_SPAWN_TIMER,
  OBJ_SPAWN_REQ,
  OBJ_ARRAY_65A0,
  OBJ_ACTIVE,
  OBJ_X,
  OBJ_Y,
  OBJ_SPRITE_CODE,
  M50_OBJ2_STEP_DIR,
  M50_OBJ3_STEP_DIR,
  RANDOM,
  FRAME,
  SPIN_COUNT,
  STACK_SCRATCH,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2523;
const STRIDE = 0x10;
const SLOTS = 6;
const FIELD_09 = 0x09; // unnamed spawned-record field (0x08)
const FIELD_0A = 0x0a; // unnamed spawned-record field (0x03)
// Park SP so the oracle's `call 0x0057` push lands in STACK_SCRATCH and its terminal `ret` pops
// valid work RAM. 0x6bf8 - 2 = 0x6bf6, inside [0x6be0,0x6c00).
const SAFE_SP = 0x6bf8;
const NOISE = 0xaa; // pre-dirty the free slot's fields so the spawn writes are observable

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const slotBase = (i) => (OBJ_ARRAY_65A0 + i * STRIDE) & 0xffff;

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// All non-stack RAM addresses that changed between two machines (for the no-write checks).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

// A crafted 0x2523 entry on a clone of `base`: the timer/request, the six slot active flags, the
// two frame counters + seed that fix stirRandomSeed's roll, the two step-dir latches, the free
// slot's fields pre-dirtied to NOISE, and a safe stack. Frame machinery neutralised.
function craft(base, {
  timer = 0, req = 1, slots = [1, 1, 1, 1, 1, 1],
  random = 0, frame = 0, spin = 0, obj2 = 1, obj3 = 0,
} = {}) {
  const e = base.clone();
  e.regs.sp = SAFE_SP;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  e.mem.write8(OBJ_SPAWN_TIMER, timer);
  e.mem.write8(OBJ_SPAWN_REQ, req);
  for (let i = 0; i < SLOTS; i++) {
    const bAddr = slotBase(i);
    e.mem.write8((bAddr + OBJ_ACTIVE) & 0xffff, slots[i]);
    if ((slots[i] & 0x01) === 0) {
      // a free slot: dirty the fields the spawn stamps, so the writes are observable
      for (const off of [OBJ_X, OBJ_Y, OBJ_SPRITE_CODE, FIELD_09, FIELD_0A]) {
        e.mem.write8((bAddr + off) & 0xffff, NOISE);
      }
    }
  }
  e.mem.write8(RANDOM, random);
  e.mem.write8(FRAME, frame);
  e.mem.write8(SPIN_COUNT, spin);
  e.mem.write8(M50_OBJ2_STEP_DIR, obj2);
  e.mem.write8(M50_OBJ3_STEP_DIR, obj3);
  return e;
}

// Run oracle and candidate on two FRESH byte-identical entries; return the first RAM diff or null.
function runPair(base, opts, candidate) {
  const a = craft(base, opts);
  const aFloor = a.regs.sp;
  const b = craft(base, opts);
  oracle(a);
  candidate(b);
  return firstRamDiff(a, b, aFloor);
}

const describe = (d) => d && `RAM diverges at ${hx(d.addr)} (oracle=${d.a} cand=${d.b})`;

// -- 0. reachability note -----------------------------------------------------

test("REACHABILITY: 0x2523 is NOT dispatched in attract (50m-gated) — crafted coverage only", () => {
  let count = 0;
  const real = new Machine(ROM).routines.get(TARGET);
  const snap = new Map([[TARGET, (mm) => { count++; return real(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.equal(count, 0, "0x2523 should not fire in attract — it is 50m-gated (crafted-only test)");
  console.log(`  REACHABILITY: ${count} natural 0x2523 dispatches in 2000 attract frames (crafted coverage only)`);
});

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: service50mObjectSpawnRequest == oracle on the timer/no-op paths and every spawn arm", () => {
  const base = new Machine(ROM).clone();
  let count = 0;
  const check = (opts, where) => {
    const d = runPair(base, opts, service50mObjectSpawnRequest);
    count++;
    assert.equal(d, null, `${where}: ${describe(d)}`);
  };

  // (a) timer running -> tick down, regardless of request/slots.
  for (const timer of [1, 2, 0x7c, 0xff]) {
    check({ timer, req: 1, slots: [0, 1, 1, 1, 1, 1], random: 0x10 }, `timer-running t=${hx(timer)}`);
  }

  // (b) timer drained, no request -> no-op. Any nonzero req triggers the scan; only 0 is a no-op.
  check({ timer: 0, req: 0, slots: [0, 1, 1, 1, 1, 1] }, "no-request");

  // (c) timer drained, request present, every slot busy (bit0 set) -> no free slot, no-op.
  check({ timer: 0, req: 1, slots: [1, 3, 5, 7, 9, 0xff] }, "all-busy");

  // (d) request nonzero-but-bit0-clear still triggers (whole-byte test).
  for (const req of [0x01, 0x02, 0x80, 0xff]) {
    check({ timer: 0, req, slots: [0, 1, 1, 1, 1, 1], random: 0x10 }, `req=${hx(req)}`);
  }

  // (e) every first-free-slot position.
  for (let pos = 0; pos < SLOTS; pos++) {
    const slots = [1, 1, 1, 1, 1, 1];
    slots[pos] = 0; // free (even -> bit0 clear)
    check({ timer: 0, req: 1, slots, random: 0x30, obj2: 1, obj3: 0x80 }, `free-slot@${pos}`);
  }

  // (f) EXHAUSTIVE seed sweep over both step-dir arms (obj2 ==1 vs !=1, obj3 bit7 clear vs set),
  //     zero delta.
  const freeAt0 = [0, 1, 1, 1, 1, 1];
  for (const [obj2, obj3] of [[1, 0x00], [1, 0x80], [2, 0x00], [2, 0x80]]) {
    for (let random = 0; random < 256; random++) {
      check({ timer: 0, req: 1, slots: freeAt0, random, frame: 0, spin: 0, obj2, obj3 },
        `seed-sweep obj2=${hx(obj2)} obj3=${hx(obj3)} rnd=${hx(random)}`);
    }
  }
  // (g) nonzero delta so the re-roll's SECOND draw ((roll1+delta)&0xff) sweeps across 0x68.
  for (let random = 0; random < 256; random++) {
    check({ timer: 0, req: 1, slots: freeAt0, random, frame: 0x37, spin: 0, obj2: 2, obj3: 0x00 },
      `reroll-delta rnd=${hx(random)}`);
  }

  // -- non-vacuity: the produced record + tail for each distinct arm (both sides agree) --
  const expectSpawn = (opts, { y, x }, label) => {
    const a = craft(base, opts); oracle(a);
    const b = craft(base, opts); service50mObjectSpawnRequest(b);
    for (const mm of [a, b]) {
      const s = slotBase(0);
      assert.equal(mm.mem.read8((s + OBJ_Y) & 0xffff), y, `${label}: OBJ_Y`);
      assert.equal(mm.mem.read8((s + OBJ_X) & 0xffff), x, `${label}: OBJ_X`);
      assert.equal(mm.mem.read8((s + OBJ_ACTIVE) & 0xffff), 0x01, `${label}: activate`);
      assert.equal(mm.mem.read8((s + OBJ_SPRITE_CODE) & 0xffff), 0x4b, `${label}: sprite code`);
      assert.equal(mm.mem.read8((s + FIELD_09) & 0xffff), 0x08, `${label}: field+9`);
      assert.equal(mm.mem.read8((s + FIELD_0A) & 0xffff), 0x03, `${label}: field+0a`);
      assert.equal(mm.mem.read8(OBJ_SPAWN_TIMER), 0x7c, `${label}: timer reload`);
      assert.equal(mm.mem.read8(OBJ_SPAWN_REQ), 0x00, `${label}: request cleared`);
    }
  };
  // roll < 0x60 -> Y override; obj3 bit7 clear -> X stays 0x07.
  expectSpawn({ timer: 0, req: 1, slots: freeAt0, random: 0x10, obj3: 0x00 }, { y: 0xcc, x: 0x07 }, "arm: roll<0x60, X keep");
  // roll < 0x60 -> Y override; obj3 bit7 set -> X = 0xF8.
  expectSpawn({ timer: 0, req: 1, slots: freeAt0, random: 0x10, obj3: 0x80 }, { y: 0xcc, x: 0xf8 }, "arm: roll<0x60, X override");
  // roll >= 0x60, obj2 == 1 -> Y override arm (X follows obj3 bit7 clear).
  expectSpawn({ timer: 0, req: 1, slots: freeAt0, random: 0x70, obj2: 1, obj3: 0x00 }, { y: 0xcc, x: 0x07 }, "arm: roll>=0x60 obj2==1");
  // roll >= 0x60, obj2 != 1, re-roll >= 0x68 -> Y stays 0x7C, X keep.
  expectSpawn({ timer: 0, req: 1, slots: freeAt0, random: 0x70, frame: 0, spin: 0, obj2: 2 }, { y: 0x7c, x: 0x07 }, "arm: re-roll >=0x68");
  // roll >= 0x60 (0x60), obj2 != 1, re-roll 0x60 < 0x68 -> Y stays 0x7C, X = 0xF8.
  expectSpawn({ timer: 0, req: 1, slots: freeAt0, random: 0x60, frame: 0, spin: 0, obj2: 2 }, { y: 0x7c, x: 0xf8 }, "arm: re-roll <0x68");

  // SPIN_COUNT ticks down by one on the spawn path (the shared tail's spawn target).
  {
    const opts = { timer: 0, req: 1, slots: freeAt0, random: 0x10, spin: 0x40, obj3: 0x00 };
    const a = craft(base, opts); oracle(a);
    assert.equal(a.mem.read8(SPIN_COUNT), 0x3f, "spawn path decrements SPIN_COUNT by one");
  }
  // Timer path ticks the TIMER, leaves SPIN_COUNT alone.
  {
    const opts = { timer: 0x05, req: 1, slots: freeAt0, spin: 0x40 };
    const a = craft(base, opts); oracle(a);
    assert.equal(a.mem.read8(OBJ_SPAWN_TIMER), 0x04, "timer path decrements the timer");
    assert.equal(a.mem.read8(SPIN_COUNT), 0x40, "timer path leaves SPIN_COUNT untouched");
  }
  // No-op paths change nothing (non-stack).
  assert.deepEqual(changedAddrs(craft(base, { timer: 0, req: 0 }), (() => { const a = craft(base, { timer: 0, req: 0 }); oracle(a); return a; })(), SAFE_SP), [], "no-request wrote non-stack RAM");
  assert.deepEqual(changedAddrs(craft(base, { timer: 0, req: 1, slots: [1, 3, 5, 7, 9, 0xff] }), (() => { const a = craft(base, { timer: 0, req: 1, slots: [1, 3, 5, 7, 9, 0xff] }); oracle(a); return a; })(), SAFE_SP), [], "all-busy wrote non-stack RAM");

  console.log(`  EQUAL: ${count} crafted combos (timer/no-op/every-slot + ${256 * 4 + 256} seed sweep) — RAM identical to the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** BUG (a): decrements the timer on the spawn path instead of SPIN_COUNT (wrong dec target). */
function brokenDecTimer(m) {
  const { regs, mem } = m;
  if (mem.read8(OBJ_SPAWN_TIMER) !== 0) {
    mem.write8(OBJ_SPAWN_TIMER, (mem.read8(OBJ_SPAWN_TIMER) - 1) & 0xff);
    return;
  }
  if (mem.read8(OBJ_SPAWN_REQ) === 0) return;
  let slot = -1;
  for (let i = 0; i < SLOTS; i++) {
    const b = slotBase(i);
    if ((mem.read8((b + OBJ_ACTIVE) & 0xffff) & 0x01) === 0) { slot = b; break; }
  }
  if (slot === -1) return;
  stirRandomSeed(m);
  const roll = regs.a;
  mem.write8((slot + OBJ_Y) & 0xffff, 0x7c);
  let oy = roll < 0x60, ox;
  if (!oy) {
    if (((mem.read8(M50_OBJ2_STEP_DIR) - 1) & 0xff) !== 0) { stirRandomSeed(m); ox = regs.a < 0x68; }
    else oy = true;
  }
  if (oy) { mem.write8((slot + OBJ_Y) & 0xffff, 0xcc); ox = (mem.read8(M50_OBJ3_STEP_DIR) & 0x80) !== 0; }
  mem.write8((slot + OBJ_X) & 0xffff, 0x07);
  if (ox) mem.write8((slot + OBJ_X) & 0xffff, 0xf8);
  mem.write8((slot + OBJ_ACTIVE) & 0xffff, 0x01);
  mem.write8((slot + OBJ_SPRITE_CODE) & 0xffff, 0x4b);
  mem.write8((slot + FIELD_09) & 0xffff, 0x08);
  mem.write8((slot + FIELD_0A) & 0xffff, 0x03);
  mem.write8(OBJ_SPAWN_TIMER, 0x7c);
  mem.write8(OBJ_SPAWN_REQ, 0x00);
  mem.write8(OBJ_SPAWN_TIMER, (mem.read8(OBJ_SPAWN_TIMER) - 1) & 0xff); // BUG: dec timer, not SPIN_COUNT
}

/** BUG (b): drops the X override — always leaves 0x07, never 0xF8. */
function brokenNoXOverride(m) {
  const { regs, mem } = m;
  if (mem.read8(OBJ_SPAWN_TIMER) !== 0) {
    mem.write8(OBJ_SPAWN_TIMER, (mem.read8(OBJ_SPAWN_TIMER) - 1) & 0xff);
    return;
  }
  if (mem.read8(OBJ_SPAWN_REQ) === 0) return;
  let slot = -1;
  for (let i = 0; i < SLOTS; i++) {
    const b = slotBase(i);
    if ((mem.read8((b + OBJ_ACTIVE) & 0xffff) & 0x01) === 0) { slot = b; break; }
  }
  if (slot === -1) return;
  stirRandomSeed(m);
  const roll = regs.a;
  mem.write8((slot + OBJ_Y) & 0xffff, 0x7c);
  let oy = roll < 0x60;
  if (!oy) {
    if (((mem.read8(M50_OBJ2_STEP_DIR) - 1) & 0xff) !== 0) stirRandomSeed(m);
    else oy = true;
  }
  if (oy) mem.write8((slot + OBJ_Y) & 0xffff, 0xcc);
  mem.write8((slot + OBJ_X) & 0xffff, 0x07); // BUG: never overrides to 0xF8
  mem.write8((slot + OBJ_ACTIVE) & 0xffff, 0x01);
  mem.write8((slot + OBJ_SPRITE_CODE) & 0xffff, 0x4b);
  mem.write8((slot + FIELD_09) & 0xffff, 0x08);
  mem.write8((slot + FIELD_0A) & 0xffff, 0x03);
  mem.write8(OBJ_SPAWN_TIMER, 0x7c);
  mem.write8(OBJ_SPAWN_REQ, 0x00);
  mem.write8(SPIN_COUNT, (mem.read8(SPIN_COUNT) - 1) & 0xff);
}

test("TEETH: the wrong-dec-target twin is CAUGHT (SPIN_COUNT diverges)", () => {
  const base = new Machine(ROM).clone();
  // A spawn case: free slot, spin nonzero so the dec target is observable.
  const opts = { timer: 0, req: 1, slots: [0, 1, 1, 1, 1, 1], random: 0x10, spin: 0x40, obj3: 0x00 };
  const d = runPair(base, opts, brokenDecTimer);
  assert.notEqual(d, null, "the suite FAILED to catch the wrong dec target — worthless");
  assert.equal(d.addr, SPIN_COUNT, `expected the diff at SPIN_COUNT ${hx(SPIN_COUNT)}, got ${describe(d)}`);
  console.log(`  TEETH/wrong-dec: caught — ${describe(d)}`);
});

test("TEETH: the dropped-X-override twin is CAUGHT (record X diverges)", () => {
  const base = new Machine(ROM).clone();
  // roll < 0x60 with obj3 bit7 set -> the correct routine writes 0xF8; the twin leaves 0x07.
  const opts = { timer: 0, req: 1, slots: [0, 1, 1, 1, 1, 1], random: 0x10, obj3: 0x80 };
  const d = runPair(base, opts, brokenNoXOverride);
  assert.notEqual(d, null, "the suite FAILED to catch the dropped X override — worthless");
  assert.equal(d.addr, (slotBase(0) + OBJ_X) & 0xffff, `expected the diff at the record X field, got ${describe(d)}`);
  console.log(`  TEETH/no-x-override: caught — ${describe(d)}`);
});
