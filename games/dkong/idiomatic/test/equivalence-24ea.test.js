// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for update50mMovingObjects (ROM 0x24EA) — the 50m moving-object subsystem tick:
 * board-gate on 50m, service the spawn request (0x2523), advance/edge-cull the object
 * row (0x2591), then refresh each active object's four-byte sprite record from the
 * object array.
 *
 * 0x24EA is dispatched every frame from the per-frame cascade, but attract only plays
 * 25m, and this routine is board-gated to 50m — so every REAL captured dispatch takes
 * the board-gate-CLOSED skip (nothing written). The 50m body is reached only with
 * CRAFTED entries (a real attract base + BOARD poked to 2, object records and
 * spawn/step state poked, identically on both sides).
 *
 * The oracle brackets its callees with push/call and finishes with a terminal return,
 * so it churns the dead STACK_SCRATCH region; the idiomatic routine models no stack
 * (direct calls, a plain JS return). The comparison is therefore RAM − the stack scratch below the entry SP —
 * the memory-equivalence contract — and pc/SP are not compared (the caller consumes no
 * register/flag from this routine; its live-out is memory-only). Every entry's stack is
 * re-seated into the scratch window before the pair runs, so the oracle's transient
 * push lands in the excluded region on both the captured and crafted paths.
 *
 *   0. REACHABILITY + captured — hook 0x24EA in a real attract run; confirm it is
 *      dispatched, and that each captured dispatch matches the oracle AND took the
 *      board-gate-closed arm (no non-stack RAM written).
 *   1. EQUAL (crafted, 50m body) — all-inactive, active field-mapping (distinct X/code/
 *      attr/Y so the copy order is pinned), mixed active/inactive, the whole-byte
 *      activity test (+0 == 0x02, active by byte but not by bit0), and the spawn arm
 *      (request pending + a free slot, which rolls the RNG). Each matches the oracle;
 *      the active cases also assert the sprite records really were refreshed.
 *   2. TEETH — two broken twins, each MUST be caught: swapped X/Y copy order, and a
 *      bit0-only activity test instead of the whole byte.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-24ea.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_24ea as oracle } from "../../translated/loc_24ea.js";
import { update50mMovingObjects } from "../update50mMovingObjects.js";
import { boardBitGate } from "../boardBitGate.js";
import { service50mObjectSpawnRequest } from "../service50mObjectSpawnRequest.js";
import { advance50mObjectRow } from "../advance50mObjectRow.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  OBJ_ARRAY_65A0,
  OBJ_ACTIVE,
  OBJ_X,
  OBJ_Y,
  OBJ_SPRITE_CODE,
  OBJ_SPRITE_ATTR,
  OBJ_SPAWN_TIMER,
  OBJ_SPAWN_REQ,
  M50_OBJ2_STEP_POS,
  M50_OBJ2_STEP_NEG,
  M50_OBJ3_STEP,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x24ea;
const RECORD_COUNT = 6;
const SLOT_STRIDE = 0x10;
const SPRITE_BASE = 0x69b8;   // per-record sprite block inside SPRITE_BUFFER (unnamed in names.js)
const SPRITE_STRIDE = 0x04;
const SPRITE_SENTINEL = 0xee; // preset into each sprite slot; a copy overwrites it, a skip leaves it
const SAFE_SP = 0x6bf8;       // re-seat SP here so all oracle stack churn stays in STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);

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

// All non-stack RAM addresses that changed between two machines (the board-gate-closed
// non-vacuity check: that path must write nothing outside the dead stack).
function changedNonStackAddrs(a, b, liveFloor) {
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

// Run oracle and candidate on byte-identical clones (SP re-seated into the scratch
// window) and return the first non-stack RAM difference, or null.
function ramDiff(entry, candidate) {
  const a = entry.clone(); a.regs.sp = SAFE_SP;
  const aFloor = a.regs.sp;
  const b = entry.clone(); b.regs.sp = SAFE_SP;
  oracle(a);
  candidate(b);
  return firstRamDiff(a, b, aFloor);
}

const runOracleOn = (entry) => { const a = entry.clone(); a.regs.sp = SAFE_SP; oracle(a); return a; };

// A real, self-consistent machine: boot + a stretch of attract so work RAM is realistic.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Craft a 50m dispatch onto a clone of the base: BOARD = 2, the six object records
// zeroed with their sprite slots stamped to a sentinel, then the requested records +
// spawn/step state poked. Field +5 doubles as the mover selector for the advance stage
// and the Y source for the refresh; keep it a plain (non-0x7c) value and step3 = 0 so
// the advance stage leaves the inspected fields alone.
function craft(base, { records = [], spawnTimer = 0, spawnReq = 0, stepPos = 0, stepNeg = 0, step3 = 0 } = {}) {
  const e = base.clone();
  e.mem.write8(BOARD, 2);
  for (let i = 0; i < RECORD_COUNT; i++) {
    const slot = OBJ_ARRAY_65A0 + SLOT_STRIDE * i;
    for (let b = 0; b < SLOT_STRIDE; b++) e.mem.write8(slot + b, 0);
    for (let b = 0; b < SPRITE_STRIDE; b++) e.mem.write8(SPRITE_BASE + SPRITE_STRIDE * i + b, SPRITE_SENTINEL);
  }
  for (const r of records) {
    const slot = OBJ_ARRAY_65A0 + SLOT_STRIDE * r.i;
    e.mem.write8(slot + OBJ_ACTIVE, r.active ?? 0x01);
    e.mem.write8(slot + OBJ_X, r.x ?? 0x50);
    e.mem.write8(slot + OBJ_Y, r.y ?? 0x60);   // +5: mover selector AND Y source
    e.mem.write8(slot + OBJ_SPRITE_CODE, r.code ?? 0x40);
    e.mem.write8(slot + OBJ_SPRITE_ATTR, r.attr ?? 0x02);
  }
  e.mem.write8(OBJ_SPAWN_TIMER, spawnTimer);
  e.mem.write8(OBJ_SPAWN_REQ, spawnReq);
  e.mem.write8(M50_OBJ2_STEP_POS, stepPos);
  e.mem.write8(M50_OBJ2_STEP_NEG, stepNeg);
  e.mem.write8(M50_OBJ3_STEP, step3);
  return e;
}

// -- 0. REACHABILITY + captured -----------------------------------------------

test("REACHABILITY + captured: 0x24EA is dispatched and every real dispatch == oracle (board-gate-closed)", () => {
  let count = 0;
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    count++;
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(count > 0, "0x24EA should be dispatched — the per-frame cascade calls it every pass");

  let closed = 0;
  for (const cap of caps) {
    const diff = ramDiff(cap, update50mMovingObjects);
    assert.equal(diff, null, diff && `captured dispatch: RAM@${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`);
    // attract is 25m, so the oracle must take the board-gate-closed skip: no non-stack write.
    const o = runOracleOn(cap);
    const src = cap.clone(); src.regs.sp = SAFE_SP;
    if (changedNonStackAddrs(src, o, SAFE_SP).length === 0) closed++;
  }
  assert.equal(closed, caps.length, "every captured attract dispatch should take the 50m-gate-closed (no-write) arm");
  console.log(`  REACHABILITY: ${count} natural 0x24EA dispatches in 1200 frames; ${caps.length} verified, all board-gate-closed`);
});

// -- 1. EQUAL (crafted, 50m body) ---------------------------------------------

test("EQUAL (crafted): the 50m body matches the oracle across all arms", () => {
  const base = attractBase();

  // all six records inactive: gate opens, callees run, the refresh copies nothing.
  {
    const entry = craft(base, { records: [] });
    const diff = ramDiff(entry, update50mMovingObjects);
    assert.equal(diff, null, diff && `all-inactive: RAM@${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`);
    const o = runOracleOn(entry);
    for (let i = 0; i < RECORD_COUNT; i++) {
      assert.equal(o.mem.read8(SPRITE_BASE + SPRITE_STRIDE * i), SPRITE_SENTINEL, `all-inactive: sprite slot ${i} was written`);
    }
  }

  // one active record with four DISTINCT fields — pins the X/code/attr/Y copy order.
  {
    const entry = craft(base, { records: [{ i: 2, active: 0x01, x: 0x37, code: 0x4b, attr: 0x05, y: 0x62 }] });
    const diff = ramDiff(entry, update50mMovingObjects);
    assert.equal(diff, null, diff && `field-map: RAM@${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`);
    const o = runOracleOn(entry);
    const s = SPRITE_BASE + SPRITE_STRIDE * 2;
    assert.equal(o.mem.read8(s + 0), 0x37, "field-map: sprite X != object X");
    assert.equal(o.mem.read8(s + 1), 0x4b, "field-map: sprite code != object code");
    assert.equal(o.mem.read8(s + 2), 0x05, "field-map: sprite attr != object attr");
    assert.equal(o.mem.read8(s + 3), 0x62, "field-map: sprite Y != object Y");
    // untouched slots keep the sentinel — proves the cursor pairs record i with slot i.
    assert.equal(o.mem.read8(SPRITE_BASE + SPRITE_STRIDE * 0), SPRITE_SENTINEL, "field-map: wrong sprite slot touched");
  }

  // mixed active/inactive: independent per-record processing + cursor advance.
  {
    const records = [
      { i: 0, active: 0x01, x: 0x40, code: 0x41, attr: 0x01, y: 0x60 },
      { i: 1, active: 0x00 },                                            // inactive -> skip
      { i: 3, active: 0x01, x: 0x90, code: 0x42, attr: 0x03, y: 0x70 },
      { i: 5, active: 0x00 },                                            // inactive -> skip
    ];
    const entry = craft(base, { records });
    const diff = ramDiff(entry, update50mMovingObjects);
    assert.equal(diff, null, diff && `mixed: RAM@${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`);
    const o = runOracleOn(entry);
    assert.equal(o.mem.read8(SPRITE_BASE + SPRITE_STRIDE * 0), 0x40, "mixed: record 0 sprite not refreshed");
    assert.equal(o.mem.read8(SPRITE_BASE + SPRITE_STRIDE * 1), SPRITE_SENTINEL, "mixed: inactive record 1 sprite touched");
    assert.equal(o.mem.read8(SPRITE_BASE + SPRITE_STRIDE * 3), 0x90, "mixed: record 3 sprite not refreshed");
    assert.equal(o.mem.read8(SPRITE_BASE + SPRITE_STRIDE * 5), SPRITE_SENTINEL, "mixed: inactive record 5 sprite touched");
  }

  // whole-byte activity test: +0 == 0x02 is active by byte (though bit0 is clear).
  {
    const entry = craft(base, { records: [{ i: 4, active: 0x02, x: 0x55, code: 0x43, attr: 0x02, y: 0x66 }] });
    const diff = ramDiff(entry, update50mMovingObjects);
    assert.equal(diff, null, diff && `whole-byte: RAM@${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`);
    const o = runOracleOn(entry);
    assert.equal(o.mem.read8(SPRITE_BASE + SPRITE_STRIDE * 4), 0x55, "whole-byte: +0==0x02 record was not treated as active");
  }

  // spawn arm: a request pending with the cooldown drained and free slots — service50mObjectSpawnRequest
  // rolls the RNG and brings a record to life; proves the whole 3-stage pipeline (and
  // the STACK_SCRATCH exclusion, since the oracle pushes for the RNG call) is equivalent.
  {
    const entry = craft(base, { records: [], spawnTimer: 0, spawnReq: 1 });
    const diff = ramDiff(entry, update50mMovingObjects);
    assert.equal(diff, null, diff && `spawn-arm: RAM@${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`);
  }

  console.log("  EQUAL/crafted: all-inactive, field-map, mixed, whole-byte, and spawn arms identical to oracle");
});

// -- 2. TEETH -----------------------------------------------------------------

/** Broken twin (a): swaps the X and Y copy targets in the sprite record. */
function brokenSwapXY(m) {
  const { regs, mem } = m;
  regs.a = 0x02;
  if (!boardBitGate(m)) return;
  service50mObjectSpawnRequest(m);
  advance50mObjectRow(m);
  for (let i = 0; i < RECORD_COUNT; i++) {
    const obj = OBJ_ARRAY_65A0 + SLOT_STRIDE * i;
    const sprite = SPRITE_BASE + SPRITE_STRIDE * i;
    if (mem.read8(obj + OBJ_ACTIVE) === 0) continue;
    mem.write8(sprite + 0, mem.read8(obj + OBJ_Y));         // BUG: object Y into sprite X
    mem.write8(sprite + 1, mem.read8(obj + OBJ_SPRITE_CODE));
    mem.write8(sprite + 2, mem.read8(obj + OBJ_SPRITE_ATTR));
    mem.write8(sprite + 3, mem.read8(obj + OBJ_X));         // BUG: object X into sprite Y
  }
}

/** Broken twin (b): tests only bit0 of the activity byte instead of the whole byte. */
function brokenBit0Active(m) {
  const { regs, mem } = m;
  regs.a = 0x02;
  if (!boardBitGate(m)) return;
  service50mObjectSpawnRequest(m);
  advance50mObjectRow(m);
  for (let i = 0; i < RECORD_COUNT; i++) {
    const obj = OBJ_ARRAY_65A0 + SLOT_STRIDE * i;
    const sprite = SPRITE_BASE + SPRITE_STRIDE * i;
    if ((mem.read8(obj + OBJ_ACTIVE) & 0x01) === 0) continue; // BUG: bit0, not the whole byte
    mem.write8(sprite + 0, mem.read8(obj + OBJ_X));
    mem.write8(sprite + 1, mem.read8(obj + OBJ_SPRITE_CODE));
    mem.write8(sprite + 2, mem.read8(obj + OBJ_SPRITE_ATTR));
    mem.write8(sprite + 3, mem.read8(obj + OBJ_Y));
  }
}

test("TEETH: the swapped-X/Y twin and the bit0-only activity twin are CAUGHT", () => {
  const base = attractBase();

  // (a) swap X/Y — an active record with X != Y makes sprite X (and Y) diverge.
  const swapEntry = craft(base, { records: [{ i: 0, active: 0x01, x: 0x37, code: 0x4b, attr: 0x05, y: 0x62 }] });
  const swapDiff = ramDiff(swapEntry, brokenSwapXY);
  assert.ok(swapDiff, "the swapped-X/Y twin escaped — the gate is worthless");
  assert.equal(swapDiff.addr, SPRITE_BASE, `expected the swap diff at the sprite X byte, got RAM@${hx(swapDiff.addr)}`);

  // (b) bit0-only test — a +0 == 0x02 record: the oracle refreshes it, the twin skips it.
  const byteEntry = craft(base, { records: [{ i: 0, active: 0x02, x: 0x55, code: 0x43, attr: 0x02, y: 0x66 }] });
  const byteDiff = ramDiff(byteEntry, brokenBit0Active);
  assert.ok(byteDiff, "the bit0-only activity twin escaped — the gate is worthless");

  console.log(`  TEETH: swapped-X/Y caught (RAM@${hx(swapDiff.addr)}); bit0-only activity caught (RAM@${hx(byteDiff.addr)})`);
});
