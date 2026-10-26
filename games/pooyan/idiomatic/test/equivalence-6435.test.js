// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for scanObjectBankForActorCollision (ROM 0x6435) — the proximity/collision scan, a
 * DISSOLVED skip that composes the real idiomatic terminator guard verifyTerminatorTableOrCountTamper.
 *
 * scanObjectBankForActorCollision scans up to three object records for the actor at IY. No hit takes the plain
 * `m.ret()` (normal return, SP += 2) and the module returns true. A hit resets the struck
 * record, flags it, restarts its animation, queues effects, bumps HIT_TALLY, then FALLS
 * INTO verifyTerminatorTableOrCountTamper whose `pop af; ret` unwinds the caller (SP += 4); the module returns false.
 *
 * The oracle runs the TRANSLATED subtree (setActorAnimation, queueSoundCommand06, enqueueDisplayCommand, verifyTerminatorTableOrCountTamper)
 * through the routines map; the idiomatic module imports the IDIOMATIC siblings directly. The
 * two must land byte-identical in RAM (dumpState) minus stack scratch below the entry SP. No register is a
 * live-out: the caller (scanActorCollisionsBothSlots) protects its own B/DE via exx and keeps IY, so nothing the
 * scan leaves in registers is read back — registers are NOT compared. The boolean return is,
 * and the oracle's SP delta (+2 normal, +4 skip) confirms which path it took.
 *
 * Cases are CRAFTED: a plain boot does not seat this scan's IY/record inputs directly.
 *
 * Jobs:
 *   1. EQUAL — hit and two no-hit states: oracle == module in RAM (−stack); boolean matches
 *      (true no-hit / false hit); oracle SP delta matches the path.
 *   2. WRITE-SET — on a hit the struck record's reset/flag/anim cells and HIT_TALLY change.
 *   3. TEETH — a twin that reports the hit as 'continue' (true) is rejected; a wrong record
 *      byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6435.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6435 as oracle } from "../../translated/loc_6435.js";
import { scanObjectBankForActorCollision } from "../scanObjectBankForActorCollision.js";
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
const FLIP = 0x881f; // FLIP_SCREEN_FLAG
const P1_RECORD = 0x8c48; // SPAWN_OBJECT_TABLE (player-1 records, stride 0x18)
const P1_COORD = 0x888c; // SPRITE_TARGET_SLOTS_P1 (player-1 coordinate slots, stride 4)
const HIT_TALLY = 0x8f52;
const FLAG_I0 = 0x8d1b; // OBJ_HIT_FLAG_I0 (selected when regI == 0)
const IY = 0x8e00; // controllable actor coordinate record
const SP0 = 0x8ff8; // inside STACK_SCRATCH; deep enough for the effect-call dips
const RECORD_STRIDE = 0x18;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function seat(m) {
  m.regs.iy = IY;
  m.regs.i = 0x00;
  m.regs.sp = SP0;
  m.mem.write8(PLAY, 0x00); // player 1 -> records at P1_RECORD, coords at P1_COORD
  m.mem.write8(FLIP, 0x00); // xBias = -2
  return m;
}

/** slot 0 active and centred on the actor -> a hit. */
function craftHit() {
  const m = seat(BASE.clone());
  m.mem.write8(IY, 0x40); // actor X
  m.mem.write8(IY + 2, 0x48); // actor Y
  m.mem.write8(P1_RECORD, 0x07); // slot 0 active
  m.mem.write8(P1_COORD, 0x42); // obj X + (-2) = 0x40 == actor X
  m.mem.write8(P1_COORD + 2, 0x48); // (obj Y + 8) = 0x50 == (actor Y + 8)
  m.mem.write8(HIT_TALLY, 0x10);
  return m;
}

/** all three slots empty -> no hit. */
function craftNoHitEmpty() {
  const m = seat(BASE.clone());
  m.mem.write8(P1_RECORD, 0x00);
  m.mem.write8(P1_RECORD + RECORD_STRIDE, 0x00);
  m.mem.write8(P1_RECORD + 2 * RECORD_STRIDE, 0x00);
  return m;
}

/** slot 0 active but far in X, others empty -> no hit (exercises the distance test). */
function craftNoHitFar() {
  const m = seat(BASE.clone());
  m.mem.write8(IY, 0x40);
  m.mem.write8(IY + 2, 0x48);
  m.mem.write8(P1_RECORD, 0x07); // active
  m.mem.write8(P1_COORD, 0x00); // obj X + (-2) = 0xfe, far from 0x40
  m.mem.write8(P1_RECORD + RECORD_STRIDE, 0x00);
  m.mem.write8(P1_RECORD + 2 * RECORD_STRIDE, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: hit — module == oracle in RAM (−stack), returns false, oracle skips (SP+=4)", () => {
  const o = craftHit();
  const c = craftHit();
  const ret = scanObjectBankForActorCollision(c);
  oracle(o);

  assert.equal(ret, false, "a hit must return false (abort the caller)");
  assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, "oracle hit must fall into the pop-af/ret skip (SP += 4)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL hit: false, SP+=4, RAM identical (composed idiomatic verifyTerminatorTableOrCountTamper)");
});

for (const [label, craft] of [["empty", craftNoHitEmpty], ["far", craftNoHitFar]]) {
  test(`EQUAL: no-hit (${label}) — module == oracle in RAM (−stack), returns true, normal ret (SP+=2)`, () => {
    const o = craft();
    const c = craft();
    const ret = scanObjectBankForActorCollision(c);
    oracle(o);

    assert.equal(ret, true, "no hit must return true (caller keeps scanning)");
    assert.equal(o.regs.sp, (SP0 + 2) & 0xffff, "oracle no-hit must take the plain ret (SP += 2)");
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL no-hit/${label}: true, SP+=2, RAM identical`);
  });
}

// EQUAL, extra hit paths: player-2, flip, I!=0, and a non-zero slot. Each exercises a branch the
// slot-0/player-1/no-flip/I=0 case above never touches; all compared oracle-vs-module in RAM.
const P2_RECORD = 0x8be8; // PROJECTILE_TABLE (player-2 records)
const P2_COORD = 0x887c; // SPRITE_TARGET_SLOTS (player-2 coordinate slots)
const FLAG_I1 = 0x8d1c; // OBJ_HIT_FLAG_I1 (selected when regI != 0)
const COORD_STRIDE = 0x04;

/** Seat a hit at `slot` for the given player/flip/I, centred exactly on the actor. */
function craftHitAt({ play = 0, flip = 0, iReg = 0, slot = 0 }) {
  const m = seat(BASE.clone());
  m.mem.write8(PLAY, play);
  m.mem.write8(FLIP, flip);
  m.regs.i = iReg;
  const coord = play ? P2_COORD : P1_COORD;
  const record = play ? P2_RECORD : P1_RECORD;
  const xBias = flip ? 0x05 : 0xfe; // +5 flipped, -2 normal
  m.mem.write8(IY, 0x40); // actor X
  m.mem.write8(IY + 2, 0x48); // actor Y
  for (let n = 0; n < 3; n++) m.mem.write8((record + n * RECORD_STRIDE) & 0xffff, 0x00); // all empty
  m.mem.write8((record + slot * RECORD_STRIDE) & 0xffff, 0x07); // target slot active
  m.mem.write8((coord + slot * COORD_STRIDE) & 0xffff, (0x40 - xBias) & 0xff); // obj X + bias == actor X
  m.mem.write8((coord + slot * COORD_STRIDE + 2) & 0xffff, 0x48); // (obj Y + 8) == (actor Y + 8)
  m.mem.write8(HIT_TALLY, 0x10);
  return m;
}

for (const cfg of [
  { name: "player-2", play: 0x01 },
  { name: "flip", flip: 0x01 },
  { name: "I!=0", iReg: 0x01 },
  { name: "slot 1", slot: 1 },
]) {
  test(`EQUAL: hit (${cfg.name}) — module == oracle in RAM (−stack), false, SP+=4`, () => {
    const o = craftHitAt(cfg);
    const c = craftHitAt(cfg);
    const ret = scanObjectBankForActorCollision(c);
    oracle(o);
    assert.equal(ret, false, `${cfg.name}: a hit must return false`);
    assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, `${cfg.name}: oracle hit skips (SP += 4)`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    if (cfg.iReg) {
      assert.equal(o.mem.read8(FLAG_I1), 0x01, "I!=0 raises OBJ_HIT_FLAG_I1");
      assert.equal(o.mem.read8(FLAG_I0), 0x00, "I!=0 leaves OBJ_HIT_FLAG_I0 clear");
    }
    console.log(`  EQUAL hit/${cfg.name}: false, SP+=4, RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hit resets the struck record, raises its flag, sets anim, bumps HIT_TALLY", () => {
  const after = craftHit();
  const tallyBefore = after.mem.read8(HIT_TALLY);
  oracle(after);

  assert.equal(after.mem.read8(P1_RECORD + 0), 0x00, "record byte 0 -> 0");
  assert.equal(after.mem.read8(P1_RECORD + 1), 0x01, "record byte 1 -> 1");
  assert.equal(after.mem.read8(P1_RECORD + 2), 0x02, "record byte 2 -> 2");
  assert.equal(after.mem.read8(P1_RECORD + 0x11), 0x20, "record byte 0x11 -> 0x20");
  assert.equal(after.mem.read8(FLAG_I0), 0x01, "I0 hit flag raised");
  // anim fields (record+0x0c..0x0e) point at ANIM_SEQ_64DF (0x64df), frame index cleared
  assert.equal(after.mem.read8(P1_RECORD + 0x0c), 0xdf, "anim ptr low");
  assert.equal(after.mem.read8(P1_RECORD + 0x0d), 0x64, "anim ptr high");
  assert.equal(after.mem.read8(P1_RECORD + 0x0e), 0x00, "anim frame index cleared");
  assert.equal(after.mem.read8(HIT_TALLY), (tallyBefore + 1) & 0xff, "HIT_TALLY bumped");
  console.log("  WRITE-SET: record reset + flag + anim + tally confirmed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin that reports the hit as 'continue' (true) is rejected by the boolean check", () => {
  function brokenContinue(m) {
    scanObjectBankForActorCollision(m); // real memory effect
    return true; // BUG: a hit must abort the caller -> false
  }
  const c = craftHit();
  assert.throws(
    () => assert.equal(brokenContinue(c), false),
    "the boolean contract must reject a hit reported as 'continue'",
  );
  console.log("  TEETH/boolean: a hit-returns-true twin is caught");
});

test("TEETH: a wrong record-reset byte is caught by the RAM diff", () => {
  const o = craftHit();
  const c = craftHit();
  oracle(o);
  scanObjectBankForActorCollision(c);
  c.mem.write8(P1_RECORD + 1, 0x99); // BUG: record byte 1 must be 0x01

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a wrong record byte — worthless");
  assert.equal(d.addr, P1_RECORD + 1, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
