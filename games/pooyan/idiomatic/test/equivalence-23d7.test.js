// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for deriveStackedSpriteYs (ROM 0x23d7-0x23eb, Pooyan) — fan the
 * player-actor base Y out to the three stacked player-sprite slots: read the base Y at
 * PLAYER_Y (== ACTOR_TABLE+0x04) and store it at ACTOR_TABLE+0x4c (slot 3), Y-0x10 at
 * +0x34 (slot 2), and Y-0x10+0x0a at +0x1c (slot 1). Every other RAM byte is left as found.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. deriveStackedSpriteYs WRITES RAM, so
 * every case runs the oracle on one FRESH clone and the module on another, compared on the
 * go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The routine has NO register live-out: it sets IX internally to a constant and leaves A =
 * base Y - 6, but all four callers (clampActorYAndAdvanceRenderPhase/236a/2901/32bd) reload from RAM (or ret) right
 * after the call, so A is plumbing and is not part of the contract. pc/SP are not compared
 * (the modelled call/stack ABI the direct-call idiomatic layer replaces with a plain return).
 *
 * Jobs:
 *   1. CRAFTED (load-bearing) — pre-dirty the actor arena to 0xAA, seed varied base Ys
 *      (incl. wrap cases), and confirm both sides land the same three bytes and keep the dirt.
 *   2. CAPTURED (best-effort) — if a real boot dispatches 0x23d7, replay those states too.
 *   3. WRITE-SET — the oracle writes exactly {+0x1c,+0x34,+0x4c} off ACTOR_TABLE.
 *   4. TEETH — a twin that corrupts the slot-2 Y byte MUST be caught, at ACTOR_TABLE+0x34.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-23d7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_23d7 as oracle } from "../../translated/loc_23d7.js";
import { deriveStackedSpriteYs } from "../deriveStackedSpriteYs.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE, PLAYER_Y } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x23d7;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

// The three Y slots the routine stamps, as absolute addresses.
const SLOT3 = (ACTOR_TABLE + 0x4c) & 0xffff; // base Y
const SLOT2 = (ACTOR_TABLE + 0x34) & 0xffff; // base Y - 0x10
const SLOT1 = (ACTOR_TABLE + 0x1c) & 0xffff; // base Y - 0x06
const WRITTEN = new Set([SLOT1, SLOT2, SLOT3]);

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Actor arena pre-dirtied to 0xAA, PLAYER_Y seeded to the test base Y, SP parked in dead scratch. */
function craft(y) {
  const base = new Machine(ROM);
  for (let i = 0; i < 0x60; i++) base.mem.write8((ACTOR_TABLE + i) & 0xffff, 0xaa);
  base.mem.write8(PLAYER_Y, y & 0xff);
  base.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  return base;
}

// Base Ys: mid, zero (wrap on the two derived), high, and small values that wrap negative.
const YS = [0x80, 0x00, 0xff, 0x10, 0x05, 0xb0];

// -- 1. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied arena + varied base Y — RAM(−stack) identical, three slots stamped, dirt kept", () => {
  for (const y of YS) {
    const base = craft(y);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    deriveStackedSpriteYs(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `base Y ${hx(y)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);

    // The three stamped bytes are exactly right on the module side (mod-256 wrap).
    assert.equal(c.mem.read8(SLOT3), y & 0xff, `base Y ${hx(y)}: slot 3`);
    assert.equal(c.mem.read8(SLOT2), (y - 0x10) & 0xff, `base Y ${hx(y)}: slot 2`);
    assert.equal(c.mem.read8(SLOT1), (y - 0x06) & 0xff, `base Y ${hx(y)}: slot 1`);

    // A neighbouring arena byte NOT in the write set keeps its 0xAA dirt.
    assert.equal(c.mem.read8((ACTOR_TABLE + 0x1d) & 0xffff), 0xaa, `base Y ${hx(y)}: +0x1d untouched`);
  }
  console.log(`  CRAFTED: ${YS.length} base Ys stamped identically, dirt preserved`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real 0x23d7 dispatches replay identically (if reached in the boot window)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 24) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    new Machine(ROM, { overrides: snap }).runFrames(3000);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    deriveStackedSpriteYs(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `captured RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  CAPTURED: ${caps.length} real 0x23d7 dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly {ACTOR_TABLE+0x1c,+0x34,+0x4c}", () => {
  const base = craft(0x80); // 0x80/0x70/0x7a all differ from the 0xAA dirt
  const before = base.clone();
  const after = base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  assert.equal(changed.length, 3, `expected exactly three changed bytes, got ${changed.length}`);
  for (const addr of changed) assert.ok(WRITTEN.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
  console.log("  WRITE-SET: 3 writes, all within {+0x1c,+0x34,+0x4c}");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong slot-2 Y byte is caught at ACTOR_TABLE+0x34", () => {
  const base = craft(0x80);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  deriveStackedSpriteYs(c);
  c.mem.write8(SLOT2, (c.mem.read8(SLOT2) ^ 0x01) & 0xff); // BUG: corrupt the middle sprite Y

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong slot-2 Y — it is worthless");
  assert.equal(d.addr, SLOT2, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong slot-2 Y caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
