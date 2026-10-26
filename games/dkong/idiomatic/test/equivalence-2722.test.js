// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2722 (ROM 0x2722) — the board-object service pass:
 * advance the six objects, spawn on the cadence, then publish their positions to
 * the sprite shadow buffer.
 *
 * loc_2722 orchestrates two already-idiomatic callees and then does its own work:
 *   1. advanceBoardObjectTravel (ROM 0x2797)        — advance every active object one pixel.
 *   2. spawnBoardObject (ROM 0x27DA) — spawn on the cadence, else tick the timer.
 *   3. PUBLISH — copy each of the six objects' X (record byte +3) and Y (record byte
 *      +5) into its own 4-byte sprite record, six records from SPRITE_BUFFER + 88.
 * The two callees carry their own exhaustive gates; this test proves loc_2722's own
 * job — that it runs all three in the right ORDER (publish reads the positions advance
 * and spawn just produced) and mirrors the right fields to the right sprite records.
 *
 * The oracle brackets each callee call with a `push16` and returns with a terminal
 * `ret`. The idiomatic routine direct-calls both and models no stack, so the two
 * stale return-address bytes the oracle leaves on the stack differ between the sides;
 * they live in STACK_SCRATCH [0x6be0,0x6c00) and are excluded by the memory-equivalence
 * contract (firstRamDiff). Live-out is memory-only, so pc/SP are not compared.
 *
 * The board-object cascade is never reached in 25m attract — 0x2722 dispatches 0 times
 * across 2000 attract frames — so validation is CRAFTED over a real attract base: poke
 * the six object records and the spawn timer identically on both sides to drive every
 * arm (rising/landing, falling/deactivate, inactive, off-beat tick, spawn-into-free-slot,
 * all-slots-busy), diff the whole RAM dump minus the stack scratch below the entry SP, and check the published
 * sprite records against the post-motion object records (non-vacuity).
 *
 *   1. EQUAL (crafted) — three full-array scenarios (mixed motion + off-beat tick;
 *      spawn into a free slot; all slots busy) match the oracle over RAM − the stack scratch below the entry SP,
 *      and each object's published sprite X/Y equals its record's post-service X/Y.
 *   2. TEETH — five broken twins the crafted scenarios MUST catch: wrong publish stride,
 *      swapped X/Y source fields, a short (5-object) count, publishing BEFORE advancing,
 *      and a dropped spawn call.
 *   3. REACHABILITY — a real attract run confirming 0x2722 is not naturally dispatched
 *      (documenting why we rely on crafted entries) and validating any dispatch that does.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2722.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2722 as oracle } from "../../translated/loc_2722.js";
import { serviceBoardObjects as loc_2722 } from "../serviceBoardObjects.js";
import { advanceBoardObjectTravel } from "../advanceBoardObjectTravel.js";
import { spawnBoardObject } from "../spawnBoardObject.js";
import { Machine } from "../../machine.js";
import {
  OBJ_ARRAY_66,
  OBJ_ACTIVE,
  OBJ_X,
  OBJ_Y,
  OBJ_STATE,
  SPRITE_BUFFER,
  SPAWN_TIMER,
  STACK_SCRATCH,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2722;
// The oracle's callee brackets and terminal `ret` touch the stack; point SP just below
// the live stack so every push/pop stays inside STACK_SCRATCH and never hits I/O.
const SAFE_SP = 0x6bf8;

const OBJ_STRIDE = 16;               // stride between object records in OBJ_ARRAY_66
const SPRITE_STRIDE = 4;             // stride between sprite records in SPRITE_BUFFER
const PUBLISH_BASE = SPRITE_BUFFER + 88; // the six objects' sprite records (record 22 on)
const SPRITE_Y_OFF = 3;              // Y byte offset within a 4-byte sprite record

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const objBase = (i) => OBJ_ARRAY_66 + i * OBJ_STRIDE;
const spriteBase = (i) => PUBLISH_BASE + i * SPRITE_STRIDE;

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// A real, self-consistent machine: boot + a stretch of attract so RAM holds realistic
// values. The board-object service is never reached here; entries are crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

const R = (active, x, y, state) => ({ active, x, y, state });

/**
 * A crafted entry: a clone of `base` with the six object records and the spawn timer
 * set, a safe stack, and the frame machinery neutralised so the oracle's `m.step`
 * cannot fire an NMI or push a frame while running in isolation.
 */
function craft(base, { timer, records }) {
  const e = base.clone();
  e.mem.write8(SPAWN_TIMER, timer);
  for (let i = 0; i < 6; i++) {
    const b = objBase(i), r = records[i];
    e.mem.write8(b + OBJ_ACTIVE, r.active);
    e.mem.write8(b + OBJ_X, r.x);
    e.mem.write8(b + OBJ_Y, r.y);
    e.mem.write8(b + OBJ_STATE, r.state);
  }
  e.regs.sp = SAFE_SP;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

/** Run the ORACLE on a fresh clone of a crafted entry. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run the oracle and a candidate on two FRESH, byte-identical clones of `entry` and
 * diff the RAM dump minus the stack scratch below the entry SP. A fresh clone per side because the routine
 * WRITES memory.
 */
function diffPair(entry, candidate) {
  const a = entry.clone(); oracle(a);
  const b = entry.clone(); candidate(b);
  return firstRamDiff(a, b, entry.regs.sp);
}

// Rising objects (OBJ_STATE bit3 set) drift Y down and land at 96, snapping X to 119
// with state 4; falling objects drift Y up and deactivate at 248 (from advanceBoardObjectTravel).
const SCENARIOS = {
  // Mixed motion, off-beat timer: no spawn, the timer just ticks 5 -> 4.
  MIXED: {
    timer: 0x05,
    records: [
      R(0x00, 0x11, 0x22, 0x00), // inactive -> animate skips; X/Y published unchanged
      R(0x01, 0x31, 100, 0x08),  // rising mid -> Y 99
      R(0x01, 0x71, 97, 0x08),   // rising -> lands at Y 96, X snaps to 119, state -> 4
      R(0x01, 0x33, 80, 0x00),   // falling mid -> Y 81
      R(0x01, 0x34, 247, 0x00),  // falling -> deactivates at Y 248
      R(0x01, 0x35, 144, 0x08),  // rising mid -> Y 143
    ],
  },
  // On-beat with slot 0 free: spawn claims it (X 0x37, Y 0xf8, state 0x08), overwriting
  // the 0xAA noise, so a publish-before-spawn twin would mirror the stale noise instead.
  SPAWN: {
    timer: 0x00,
    records: [
      R(0x00, 0xaa, 0xaa, 0xaa), // free -> animate skips, then spawn claims this slot
      R(0x01, 0x41, 100, 0x08),  // rising mid
      R(0x01, 0x42, 200, 0x00),  // falling mid
      R(0x01, 0x43, 97, 0x08),   // rising -> lands
      R(0x01, 0x44, 247, 0x00),  // falling -> deactivates
      R(0x01, 0x45, 50, 0x08),   // rising mid
    ],
  },
  // On-beat but every slot busy: no spawn, the timer stays 0; all six advance.
  ALL_BUSY: {
    timer: 0x00,
    records: [
      R(0x01, 0x51, 100, 0x08),
      R(0x01, 0x52, 100, 0x00),
      R(0x01, 0x53, 120, 0x08),
      R(0x01, 0x54, 140, 0x00),
      R(0x01, 0x55, 160, 0x08),
      R(0x01, 0x56, 180, 0x00),
    ],
  },
};

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): loc_2722 == oracle across the mixed/spawn/all-busy scenarios", () => {
  const base = attractBase();

  for (const [name, scen] of Object.entries(SCENARIOS)) {
    const entry = craft(base, scen);
    const ram = diffPair(entry, loc_2722);
    assert.equal(ram, null, ram && `${name}: RAM diverges at ${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`);

    // Non-vacuity: after the oracle, every object's published sprite X/Y equals its
    // record's post-service X/Y — proof the publish walk actually ran, in order.
    const after = runOracle(entry);
    for (let i = 0; i < 6; i++) {
      assert.equal(
        after.mem.read8(spriteBase(i)),
        after.mem.read8(objBase(i) + OBJ_X),
        `${name}: obj ${i} X not published to ${hx(spriteBase(i))}`,
      );
      assert.equal(
        after.mem.read8(spriteBase(i) + SPRITE_Y_OFF),
        after.mem.read8(objBase(i) + OBJ_Y),
        `${name}: obj ${i} Y not published to ${hx(spriteBase(i) + SPRITE_Y_OFF)}`,
      );
    }
  }

  // Landmark checks that ADVANCE and SPAWN ran BEFORE the publish (not stale positions):
  const mixed = runOracle(craft(base, SCENARIOS.MIXED));
  assert.equal(mixed.mem.read8(spriteBase(2)), 119, "MIXED: landed object's X (119) not published");
  assert.equal(mixed.mem.read8(spriteBase(2) + SPRITE_Y_OFF), 96, "MIXED: landed object's Y (96) not published");
  assert.equal(mixed.mem.read8(spriteBase(4) + SPRITE_Y_OFF), 248, "MIXED: deactivated object's Y (248) not published");
  assert.equal(mixed.mem.read8(spriteBase(1) + SPRITE_Y_OFF), 99, "MIXED: rising object's post-move Y (99) not published");
  assert.equal(mixed.mem.read8(SPAWN_TIMER), 0x04, "MIXED: off-beat spawn should tick the timer 5 -> 4");

  const spawned = runOracle(craft(base, SCENARIOS.SPAWN));
  assert.equal(spawned.mem.read8(objBase(0) + OBJ_ACTIVE), 0x01, "SPAWN: free slot not claimed");
  assert.equal(spawned.mem.read8(spriteBase(0)), 0x37, "SPAWN: spawned object's seeded X (0x37) not published");
  assert.equal(spawned.mem.read8(spriteBase(0) + SPRITE_Y_OFF), 0xf8, "SPAWN: spawned object's seeded Y (0xf8) not published");

  const busy = runOracle(craft(base, SCENARIOS.ALL_BUSY));
  assert.equal(busy.mem.read8(SPAWN_TIMER), 0x00, "ALL_BUSY: no free slot must leave the timer at 0");

  console.log("  EQUAL/crafted: mixed/spawn/all-busy scenarios identical to the oracle (publish verified against post-service records)");
});

// -- 2. TEETH -----------------------------------------------------------------
//
// Every twin runs the REAL idiomatic callees and breaks only loc_2722's own
// orchestration or publish, so a catch proves this routine's logic, not a callee's.

/** BUG (a): writes Y at sprite byte +1 instead of +3 — wrong publish stride. */
function brokenPublishStride(m) {
  const { mem } = m;
  advanceBoardObjectTravel(m); spawnBoardObject(m);
  let src = OBJ_ARRAY_66, dst = PUBLISH_BASE;
  for (let i = 0; i < 6; i++) {
    mem.write8(dst, mem.read8(src + OBJ_X));
    mem.write8(dst + 1, mem.read8(src + OBJ_Y)); // BUG: should be dst + 3
    dst += SPRITE_STRIDE; src += OBJ_STRIDE;
  }
}

/** BUG (b): swaps the source fields — publishes Y as X and X as Y. */
function brokenSwapFields(m) {
  const { mem } = m;
  advanceBoardObjectTravel(m); spawnBoardObject(m);
  let src = OBJ_ARRAY_66, dst = PUBLISH_BASE;
  for (let i = 0; i < 6; i++) {
    mem.write8(dst, mem.read8(src + OBJ_Y));             // BUG: X <- Y
    mem.write8(dst + SPRITE_Y_OFF, mem.read8(src + OBJ_X)); // BUG: Y <- X
    dst += SPRITE_STRIDE; src += OBJ_STRIDE;
  }
}

/** BUG (c): publishes only five objects, leaving the sixth's sprite record stale. */
function brokenShortCount(m) {
  const { mem } = m;
  advanceBoardObjectTravel(m); spawnBoardObject(m);
  let src = OBJ_ARRAY_66, dst = PUBLISH_BASE;
  for (let i = 0; i < 5; i++) { // BUG: should be 6
    mem.write8(dst, mem.read8(src + OBJ_X));
    mem.write8(dst + SPRITE_Y_OFF, mem.read8(src + OBJ_Y));
    dst += SPRITE_STRIDE; src += OBJ_STRIDE;
  }
}

/** BUG (d): publishes BEFORE advancing/spawning — mirrors stale positions. */
function brokenPublishFirst(m) {
  const { mem } = m;
  let src = OBJ_ARRAY_66, dst = PUBLISH_BASE;
  for (let i = 0; i < 6; i++) {
    mem.write8(dst, mem.read8(src + OBJ_X));
    mem.write8(dst + SPRITE_Y_OFF, mem.read8(src + OBJ_Y));
    dst += SPRITE_STRIDE; src += OBJ_STRIDE;
  }
  advanceBoardObjectTravel(m); spawnBoardObject(m); // BUG: motion after the publish
}

/** BUG (e): drops the spawn call — the timer is never ticked/reloaded. */
function brokenNoSpawn(m) {
  const { mem } = m;
  advanceBoardObjectTravel(m); // BUG: spawnBoardObject(m) dropped
  let src = OBJ_ARRAY_66, dst = PUBLISH_BASE;
  for (let i = 0; i < 6; i++) {
    mem.write8(dst, mem.read8(src + OBJ_X));
    mem.write8(dst + SPRITE_Y_OFF, mem.read8(src + OBJ_Y));
    dst += SPRITE_STRIDE; src += OBJ_STRIDE;
  }
}

test("TEETH: all five broken twins are CAUGHT by the crafted scenarios", () => {
  const base = attractBase();
  const mixed = () => craft(base, SCENARIOS.MIXED);
  const spawn = () => craft(base, SCENARIOS.SPAWN);

  const a = diffPair(mixed(), brokenPublishStride);
  assert.notEqual(a, null, "the wrong-publish-stride twin escaped — the gate is worthless");
  assert.ok(a.addr >= PUBLISH_BASE && a.addr < PUBLISH_BASE + 6 * SPRITE_STRIDE,
    `wrong-stride diff expected in the sprite records, got ${hx(a.addr ?? 0)}`);

  const b = diffPair(mixed(), brokenSwapFields);
  assert.notEqual(b, null, "the swapped-source-fields twin escaped — the gate is worthless");

  const c = diffPair(mixed(), brokenShortCount);
  assert.notEqual(c, null, "the short-count twin escaped — the gate is worthless");
  assert.ok(c.addr >= spriteBase(5) && c.addr < spriteBase(5) + SPRITE_STRIDE,
    `short-count diff expected in the sixth sprite record, got ${hx(c.addr ?? 0)}`);

  const d = diffPair(spawn(), brokenPublishFirst);
  assert.notEqual(d, null, "the publish-before-advance twin escaped — the gate is worthless");

  const e = diffPair(mixed(), brokenNoSpawn);
  assert.notEqual(e, null, "the dropped-spawn twin escaped — the gate is worthless");
  assert.equal(e.addr, SPAWN_TIMER, `dropped-spawn diff expected at SPAWN_TIMER ${hx(SPAWN_TIMER)}, got ${hx(e.addr ?? 0)}`);

  console.log(`  TEETH: stride caught @${hx(a.addr)}; swap caught @${hx(b.addr)}; short-count caught @${hx(c.addr)}; publish-first caught @${hx(d.addr)}; dropped-spawn caught @${hx(e.addr)}`);
});

// -- 3. REACHABILITY (real attract) -------------------------------------------

test("REACHABILITY: 0x2722 in a real attract run — validate any natural dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  for (const cap of caps) {
    cap.regs.sp = SAFE_SP;
    const ram = diffPair(cap, loc_2722);
    assert.equal(ram, null, ram && `real dispatch diverges at ${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`);
  }
  // 0 is expected — the board-object cascade is board-gated and never exercised in 25m
  // attract; the crafted scenarios carry the proof. Any dispatch that DOES occur is validated.
  console.log(`  REACHABILITY: ${caps.length} natural 0x2722 dispatches in 2000 attract frames (proof carried by crafted)`);
});
