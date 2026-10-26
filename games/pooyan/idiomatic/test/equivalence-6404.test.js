// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for scanActorCollisionsBothSlots (ROM 0x6404) — the two-pass actor collision
 * driver, the CALLER that composes the real idiomatic scan scanObjectBankForActorCollision (which itself composes
 * the idiomatic terminator guard verifyTerminatorTableOrCountTamper).
 *
 * In the frozen layer a hit inside scanObjectBankForActorCollision falls into verifyTerminatorTableOrCountTamper, whose `pop af; ret`
 * discards scanActorCollisionsBothSlots's own return and unwinds to scanActorCollisionsBothSlots's caller — skipping the rest of
 * the two-pass loop. The idiomatic driver reproduces that with `if (!scanObjectBankForActorCollision(...)) return;`:
 * a false (hit) return aborts the loop. This gate seats BOTH a skip-taken state (pass 1
 * hits, pass 2 must NOT run) and a skip-not-taken state (both passes miss, loop completes),
 * plus the early-out guard, and compares oracle vs module in RAM (dumpState) minus
 * stack scratch below the entry SP. scanActorCollisionsBothSlots returns void; registers are loop bookkeeping and are NOT compared.
 *
 * The oracle drives the whole TRANSLATED subtree through the routines map; the module drives
 * the IDIOMATIC subtree by direct import. Byte-identical RAM (−stack) is the contract.
 *
 * Cases are CRAFTED: a plain boot does not seat these actor/record inputs directly.
 *
 * Jobs:
 *   1. EQUAL — hit-abort, no-hit-complete, guard-skip: oracle == module in RAM (−stack).
 *   2. ABORT — on the hit state the oracle leaves pass 2's record untouched (proving the
 *      skip aborted the loop), and the module matches.
 *   3. TEETH — a pass-2 side effect (as a no-abort bug would leave) is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6404.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6404 as oracle } from "../../translated/loc_6404.js";
import { scanActorCollisionsBothSlots } from "../scanActorCollisionsBothSlots.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PLAY = 0x8f50; // PLAY_MODE_LATCH
const ROUND = 0x8907; // ROUND_COUNTER
const FLIP = 0x881f; // FLIP_SCREEN_FLAG
const ACTOR = 0x8848; // SPRITE_ACTOR_RECORD_SLOTS (pass 1 IY; pass 2 IY = +4)
const SLOT0 = 0x8c48; // player-1 record slot 0 (pass 1 hits here)
const SLOT1 = 0x8c60; // player-1 record slot 1 (pass 2 would hit here if the loop ran on)
const COORD0 = 0x888c; // coordinate slot 0
const COORD1 = 0x8890; // coordinate slot 1
const SLOT2 = 0x8c78;
const SP0 = 0x8ff8; // inside STACK_SCRATCH; room for the pushed frame + effect-call dips
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function base() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(PLAY, 0x00); // player 1
  m.mem.write8(FLIP, 0x00); // xBias = -2
  return m;
}

/** Pass 1 hits slot 0; slot 1 is set up so a runaway pass 2 WOULD hit it (it must not). */
function craftHitAbort() {
  const m = base();
  m.mem.write8(ROUND, 0x00); // bit0 clear -> loop runs
  m.mem.write8(ACTOR + 0, 0x40); // pass 1 actor X
  m.mem.write8(ACTOR + 2, 0x48); // pass 1 actor Y
  m.mem.write8(ACTOR + 4, 0x40); // pass 2 actor X (IY += 4)
  m.mem.write8(ACTOR + 6, 0x48); // pass 2 actor Y
  m.mem.write8(SLOT0, 0x07); // slot 0 active -> pass 1 hit
  m.mem.write8(COORD0, 0x42); // obj X + (-2) = 0x40
  m.mem.write8(COORD0 + 2, 0x48); // obj Y + 8 = 0x50
  m.mem.write8(SLOT1, 0x07); // slot 1 active (pass-2 bait)
  m.mem.write8(COORD1, 0x42);
  m.mem.write8(COORD1 + 2, 0x48);
  return m;
}

/** All records empty -> both passes miss -> the loop completes. */
function craftNoHit() {
  const m = base();
  m.mem.write8(ROUND, 0x00);
  m.mem.write8(SLOT0, 0x00);
  m.mem.write8(SLOT1, 0x00);
  m.mem.write8(SLOT2, 0x00);
  return m;
}

/** PLAY clear + ROUND bit0 set -> the driver does nothing. */
function craftGuardSkip() {
  const m = base();
  m.mem.write8(ROUND, 0x01);
  m.mem.write8(SLOT0, 0x07); // active, but the guard returns before any scan
  m.mem.write8(COORD0, 0x42);
  m.mem.write8(COORD0 + 2, 0x48);
  m.mem.write8(ACTOR + 0, 0x40);
  m.mem.write8(ACTOR + 2, 0x48);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [
  ["hit-abort", craftHitAbort],
  ["no-hit-complete", craftNoHit],
  ["guard-skip", craftGuardSkip],
]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    scanActorCollisionsBothSlots(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${label})`);
    console.log(`  EQUAL ${label}: RAM identical (composed idiomatic scanObjectBankForActorCollision/verifyTerminatorTableOrCountTamper)`);
  });
}

// -- 2. ABORT -----------------------------------------------------------------

test("ABORT: a pass-1 hit unwinds the loop — pass 2's record is left untouched", () => {
  const o = craftHitAbort();
  const c = craftHitAbort();
  oracle(o);
  scanActorCollisionsBothSlots(c);

  assert.equal(o.mem.read8(SLOT0), 0x00, "pass 1 reset slot 0 (the hit)");
  assert.equal(o.mem.read8(SLOT1), 0x07, "oracle: slot 1 untouched -> the loop aborted before pass 2");
  assert.equal(c.mem.read8(SLOT1), 0x07, "module: slot 1 untouched -> early-return aborted the loop");
  console.log("  ABORT: slot 0 reset, slot 1 preserved (skip unwound the two-pass loop)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a pass-2 side effect (a no-abort bug) is caught by the RAM diff", () => {
  const o = craftHitAbort();
  const c = craftHitAbort();
  oracle(o);
  scanActorCollisionsBothSlots(c);
  // Simulate a driver that failed to abort and let pass 2 reset slot 1:
  c.mem.write8(SLOT1, 0x00);

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a stray pass-2 write — worthless");
  assert.equal(d.addr, SLOT1, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(SLOT1)})`);
  console.log(`  TEETH/RAM: stray pass-2 write caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
