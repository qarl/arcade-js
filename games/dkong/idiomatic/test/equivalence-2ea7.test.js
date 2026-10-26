// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2ea7 (ROM 0x2EA7) — the per-object scan's inactive-slot arm /
 * spawn-request consumer.
 *
 * loc_2ea7 is dispatched by obj_2e12 for an INACTIVE object slot. It tests the one-shot
 * spawn request (SPAWN_REQUEST bit0):
 *   • bit0 CLEAR — no spawn pending: the slot stays inactive and the scan just advances
 *     (falls into advanceToNextObject: object cursor +16, sprite cursor +4, step 4).
 *   • bit0 SET   — a spawn IS pending: clear the request, seed the slot's fields (Y := 80,
 *     state := 1, X := stirred-seed low nibble − 8, animation pointer +0x0e/+0x0f := 0x39AA,
 *     active := 1), then advance the scan.
 * The oracle brackets its stirRandomSeed (0x0057) call with push16/ret and tail-jumps to
 * advanceToNextObject (0x2E78); the idiomatic routine dissolves both into direct calls to
 * the already-idiomatic callees.
 *
 * CONTRACT (memory-equivalence): RAM − the stack scratch below the entry SP (the oracle's push16 return-bracket
 * writes two dead stack bytes the direct-call candidate never writes — excluded), SP
 * (unchanged: the oracle's push/ret balance, the candidate touches no stack), and the
 * routine's declared REGISTER live-out — the two advanced cursors (ix, iy), the
 * remaining-object count (b) the loop feeds to its djnz, and the leftover step (de). The
 * seed the oracle leaves in the accumulator and its residual pointer register are DEAD (the
 * loop reloads them for the next object before any test), and its landing pc is dead too
 * (the loop drives control flow through its own counter), so none of those is compared.
 *
 * The effect factorises: the arm is selected by SPAWN_REQUEST bit0 alone, the spawned X is
 * a function of the stirred seed alone, and the write ADDRESSES depend only on the object
 * cursor. So:
 *   1. EQUAL (request sweep) — sweep the spawn-request byte over all 256 values at a real
 *      slot; only bit0 may switch the arm. Both arms exercised, all request values.
 *   2. EQUAL (seed sweep) — with a spawn pending, sweep the seed byte over all 256 values
 *      across several frame/spin combinations; pins the spawned X (nibble + bias) and the
 *      RANDOM write, covering the 8-bit sum wrap.
 *   3. EQUAL (slot grid) — spawn at each of the ten real object slots (cursor = 0x6500+16k)
 *      to pin the record-relative write addresses.
 *   4. EQUAL (independence) — hold the arm/seed/cursor fixed and vary the ignored registers
 *      and an unrelated RAM byte: the output is unchanged.
 *   5. REALISM (captured) — attract never reaches update75mActorObjects's loop; steer the game's own
 *      board/enable gates into the full 10-object pass with all slots inactive and one spawn
 *      pending, hook 0x2ea7, capture the 10 real dispatches (slot 0 spawns, slots 1-9
 *      advance once the request is consumed), and replay oracle vs candidate on each.
 *   6. TEETH — six deliberately-broken twins (wrong spawn Y, dropped request-clear, wrong X
 *      bias, missing activate, inverted arm, dropped nibble mask); the SAME sweeps must
 *      catch every one, or the gate proves nothing.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2ea7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ea7 as oracle } from "../../translated/loc_2ea7.js";
import { spawnObjectIntoInactiveSlot as loc_2ea7 } from "../spawnObjectIntoInactiveSlot.js";
import { stirRandomSeed } from "../stirRandomSeed.js";           // ROM 0x0057 (for the twins)
import { advanceToNextObject } from "../advanceToNextObject.js"; // ROM 0x2E78 (for the twins)
import { loc_2e04 } from "../../translated/loc_2e04.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  SPAWN_REQUEST,
  OBJ_ACTIVE,
  OBJ_X,
  OBJ_Y,
  OBJ_STATE,
  OBJ_ARRAY_65,
  RANDOM,
  FRAME,
  SPIN_COUNT,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2ea7;
const OBJ_BASE = OBJ_ARRAY_65; // 0x6500 — object-record scan base (the object cursor / IX)
const SPR_BASE = 0x6980;       // paired sprite-record scan base (the sprite cursor / IY)
const LOOP_COUNT = 0x0a;       // remaining-object count the loop holds while this arm runs
const JUNK_DE = 0x1234;        // nonzero incoming step; the advance tail overwrites it to 4
const SP_TOP = 0x6c00;         // stack top: the oracle's push16 return-bracket lands in STACK_SCRATCH

// The record fields the spawn body writes, and the animation-pointer offset (no names.js name).
const OBJ_ANIM_PTR = 0x0e;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hx16 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// First RAM byte that differs, skipping the stack scratch below the entry SP (the memory-equivalence
// contract is RAM − the stack scratch below the entry SP: the oracle's push16 return-bracket writes there). null | {addr,a,b}.
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

// The register live-out contract (what update75mActorObjects consumes after this arm) + de (conservative).
function regLiveOutDiff(o, c) {
  if (o.regs.ix !== c.regs.ix) return `ix oracle=${hx16(o.regs.ix)} cand=${hx16(c.regs.ix)}`;
  if (o.regs.iy !== c.regs.iy) return `iy oracle=${hx16(o.regs.iy)} cand=${hx16(c.regs.iy)}`;
  if (o.regs.b !== c.regs.b) return `b oracle=${hx(o.regs.b)} cand=${hx(c.regs.b)}`;
  if (o.regs.de !== c.regs.de) return `de oracle=${hx16(o.regs.de)} cand=${hx16(c.regs.de)}`;
  return null;
}

// Full contract: RAM − the stack scratch below the entry SP + SP (unchanged) + register live-out. null | string.
function contractDiff(o, c, liveFloor) {
  const ram = firstRamDiff(o, c, liveFloor);
  if (ram) return `RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`;
  if (o.regs.sp !== c.regs.sp) return `SP oracle=${hx16(o.regs.sp)} cand=${hx16(c.regs.sp)}`;
  return regLiveOutDiff(o, c);
}

// Set the compared registers on a clone (frame machinery already neutralised by clone();
// re-asserted so the oracle's internal stepping can never fire an NMI/frame).
function setInput(m, ix) {
  m.regs.ix = ix;
  m.regs.iy = SPR_BASE;
  m.regs.b = LOOP_COUNT;
  m.regs.de = JUNK_DE;
  m.regs.sp = SP_TOP;
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
}

// Seed the three PRNG bytes stirRandomSeed reads (so the spawned X is deterministic).
function setSeed(m, rnd, frame, spin) {
  m.mem.write8(RANDOM, rnd);
  m.mem.write8(FRAME, frame);
  m.mem.write8(SPIN_COUNT, spin);
}

// Prepare one fresh entry (identical on both sides): cursor + registers set, request + seed poked.
function prep(base, ix, request, rnd, frame, spin) {
  const m = base.clone();
  setInput(m, ix);
  setSeed(m, rnd, frame, spin);
  m.mem.write8(SPAWN_REQUEST, request);
  return m;
}

// The three EQUAL sweeps, run in sequence; returns the first mismatch (or null) and the
// combos compared. Reused by the EQUAL proof and every TEETH twin. The request sweep uses a
// seed whose HIGH nibble is nonzero (0xA5) so a dropped-nibble-mask twin diverges here too.
function fullSweep(base, candidate) {
  let count = 0;

  // 1. request byte over all 256 values (only bit0 may switch the arm), a fixed seed.
  for (let req = 0; req < 256; req++) {
    const om = prep(base, OBJ_BASE, req, 0xa5, 0x00, 0x00);
    const omFloor = om.regs.sp;
    const cm = prep(base, OBJ_BASE, req, 0xa5, 0x00, 0x00);
    oracle(om);
    candidate(cm);
    count++;
    const d = contractDiff(om, cm, omFloor);
    if (d) return { mismatch: `request=${hx(req)}: ${d}`, count };
  }

  // 2. seed byte over all 256 values with a spawn pending, across frame/spin combos.
  for (const [frame, spin] of [[0x00, 0x00], [0x37, 0x91], [0xff, 0xff]]) {
    for (let rnd = 0; rnd < 256; rnd++) {
      const om = prep(base, OBJ_BASE, 0x01, rnd, frame, spin);
      const omFloor = om.regs.sp;
      const cm = prep(base, OBJ_BASE, 0x01, rnd, frame, spin);
      oracle(om);
      candidate(cm);
      count++;
      const d = contractDiff(om, cm, omFloor);
      if (d) return { mismatch: `seed rnd=${hx(rnd)} frame=${hx(frame)} spin=${hx(spin)}: ${d}`, count };
    }
  }

  // 3. spawn at each of the ten real object slots (pins the record-relative write addresses).
  for (let k = 0; k < 10; k++) {
    const ix = (OBJ_BASE + 16 * k) & 0xffff;
    const om = prep(base, ix, 0x01, 0x3c, 0x00, 0x00);
    const omFloor = om.regs.sp;
    const cm = prep(base, ix, 0x01, 0x3c, 0x00, 0x00);
    oracle(om);
    candidate(cm);
    count++;
    const d = contractDiff(om, cm, omFloor);
    if (d) return { mismatch: `slot k=${k} (ix=${hx16(ix)}): ${d}`, count };
  }

  return { mismatch: null, count };
}

const SWEEP_COUNT = 256 + 3 * 256 + 10; // request + seed(3 combos) + grid

// -- 1..3. EQUAL (request + seed + slot grid) ---------------------------------

test("EQUAL: loc_2ea7 == oracle over the request sweep, seed sweep, and slot grid", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = fullSweep(base, loc_2ea7);
  assert.equal(mismatch, null, mismatch || "");
  assert.equal(count, SWEEP_COUNT, "must have run the full request + seed + grid sweep");

  // Non-vacuity: the oracle really DOES spawn (activate + clear the request) on a set bit0,
  // and really does NOTHING but advance on a clear bit0 — so a green sweep is agreement on
  // real work, not two no-ops.
  const spawn = prep(base, OBJ_BASE, 0x01, 0x3c, 0x00, 0x00);
  oracle(spawn);
  assert.equal(spawn.mem.read8(OBJ_BASE + OBJ_ACTIVE), 1, "oracle must activate the slot on a spawn");
  assert.equal(spawn.mem.read8(SPAWN_REQUEST), 0, "oracle must consume (clear) the spawn request");
  assert.equal(spawn.mem.read8(OBJ_BASE + OBJ_Y), 80, "oracle must seed Y=80");
  assert.equal(spawn.regs.ix, (OBJ_BASE + 16) & 0xffff, "oracle must advance the object cursor by 16");

  const noSpawn = prep(base, OBJ_BASE, 0x00, 0x3c, 0x00, 0x00);
  const before = noSpawn.mem.read8(OBJ_BASE + OBJ_ACTIVE);
  oracle(noSpawn);
  assert.equal(noSpawn.mem.read8(OBJ_BASE + OBJ_ACTIVE), before, "no-spawn arm must not activate the slot");
  assert.equal(noSpawn.regs.ix, (OBJ_BASE + 16) & 0xffff, "no-spawn arm must still advance the cursor");

  console.log(`  EQUAL: ${count} (request, seed, slot) combos — RAM − the stack scratch below the entry SP + SP + live-out identical to the oracle`);
});

// -- 4. EQUAL (input independence) --------------------------------------------

test("EQUAL (independence): output depends only on the request/seed/cursor, not scratch regs or RAM", () => {
  const base = new Machine(ROM).clone();
  let count = 0;
  for (const de of [0x0000, 0x0004, 0x1234, 0xffff]) {
    for (const b of [0x01, 0x0a, 0xff]) {
      const om = prep(base, OBJ_BASE, 0x01, 0x9c, 0x00, 0x00);
      const omFloor = om.regs.sp;
      const cm = prep(base, OBJ_BASE, 0x01, 0x9c, 0x00, 0x00);
      for (const m of [om, cm]) {
        m.regs.de = de; m.regs.b = b;
        m.regs.c = 0x33; m.regs.h = 0x44; m.regs.l = 0x55;
        m.mem.write8(0x6100, 0xa5); // a work-RAM byte the routine must not read or write
      }
      oracle(om);
      loc_2ea7(cm);
      const d = contractDiff(om, cm, omFloor);
      assert.equal(d, null, d ? `de=${hx16(de)} b=${hx(b)}: ${d}` : "");
      // And the spawn produced the expected record regardless of the ignored inputs.
      assert.equal(cm.mem.read8(OBJ_BASE + OBJ_ACTIVE), 1, "slot must be activated regardless of de/b");
      assert.equal(cm.mem.read8(OBJ_BASE + OBJ_Y), 80, "spawn Y regardless of de/b");
      assert.equal(cm.mem.read8(OBJ_BASE + OBJ_X), (0x9c & 0x0f) - 8 & 0xff, "spawn X = seed nibble − 8");
      assert.equal(cm.regs.ix, (OBJ_BASE + 16) & 0xffff, "object cursor must advance by 16");
      assert.equal(cm.regs.b, b, "remaining-object count must be preserved");
      count++;
    }
  }
  console.log(`  EQUAL/independence: ${count} (de,b,scratch,RAM) variations — output unchanged`);
});

// -- 5. REALISM (real captured dispatches) ------------------------------------

// Steer update75mActorObjects's full 10-object loop with every slot INACTIVE and one spawn pending, then
// hook 0x2ea7 to capture the real in-game dispatch states (attract never reaches the loop).
// Slot 0 consumes the request and spawns; slots 1-9 see it cleared and just advance.
function captureRealDispatches() {
  const host = new Machine(ROM);
  host.runFrames(700); // realistic work RAM (0x2ea7 does not dispatch in attract)
  const m = host.clone();
  m.regs.sp = SP_TOP;
  m.push16(0x4d17);          // sentinel caller-return for update75mActorObjects
  m.mem.write8(0x6227, 3);   // board = 3   -> rst 0x30 (A=0x04) passes
  m.mem.write8(0x6200, 1);   // enable bit0 -> rst 0x10 passes -> full 10-object loop
  m.mem.write8(SPAWN_REQUEST, 0x03); // a spawn pending (as sub_2fcb stores)
  for (let k = 0; k < 10; k++) {
    m.mem.write8((OBJ_BASE + 16 * k) & 0xffff, 0x00); // inactive (bit0 clear) -> the loc_2ea7 arm
  }
  const caps = [];
  const hook = (mm) => {
    caps.push(mm.clone());
    return oracle(mm);
  };
  m.overrides.set(TARGET, hook);
  m.routines.set(TARGET, hook);
  loc_2e04(m);
  return caps;
}

test("REALISM: real captured 0x2ea7 dispatches — loc_2ea7 matches the oracle over both arms", () => {
  const caps = captureRealDispatches();
  assert.equal(caps.length, 10, "the steered full-loop update75mActorObjects should dispatch 0x2ea7 once per inactive slot (10)");

  let sawSpawn = 0, sawAdvance = 0;
  caps.forEach((cap, i) => {
    assert.equal(cap.regs.ix, (OBJ_BASE + 16 * i) & 0xffff, `dispatch ${i}: unexpected object cursor`);
    const o = cap.clone();
    const c = cap.clone();
    o.nextNmi = Infinity; o.nextBoundary = Infinity;
    c.nextNmi = Infinity; c.nextBoundary = Infinity;
    if ((cap.mem.read8(SPAWN_REQUEST) & 0x01) !== 0) sawSpawn++; else sawAdvance++;
    oracle(o);
    loc_2ea7(c);
    const d = contractDiff(o, c, cap.regs.sp);
    assert.equal(d, null, d ? `real dispatch ${i} (ix=${hx16(cap.regs.ix)}): ${d}` : "");
  });
  assert.equal(sawSpawn, 1, "exactly the first inactive slot should consume the pending spawn");
  assert.equal(sawAdvance, 9, "the remaining nine slots should see the request already consumed");
  console.log(`  REALISM: ${caps.length} real 0x2ea7 dispatches (${sawSpawn} spawn, ${sawAdvance} advance) — RAM − the stack scratch below the entry SP + SP + live-out == oracle`);
});

// -- 6. TEETH -----------------------------------------------------------------

/** (a) seeds the wrong spawn Y (81 instead of 80). */
function brokenWrongY(m) {
  const { regs, mem } = m;
  if ((mem.read8(SPAWN_REQUEST) & 0x01) === 0) { advanceToNextObject(m); return; }
  mem.write8(SPAWN_REQUEST, 0);
  mem.write8(regs.ix + OBJ_Y, 81); // BUG: should be 80
  mem.write8(regs.ix + OBJ_STATE, 1);
  stirRandomSeed(m);
  mem.write8(regs.ix + OBJ_X, (regs.a & 0x0f) - 8);
  mem.write8(regs.ix + OBJ_ACTIVE, 1);
  mem.write8(regs.ix + OBJ_ANIM_PTR, 0xaa);
  mem.write8(regs.ix + OBJ_ANIM_PTR + 1, 0x39);
  advanceToNextObject(m);
}
/** (b) never clears the spawn request. */
function brokenNoClear(m) {
  const { regs, mem } = m;
  if ((mem.read8(SPAWN_REQUEST) & 0x01) === 0) { advanceToNextObject(m); return; }
  // BUG: dropped `mem.write8(SPAWN_REQUEST, 0)`
  mem.write8(regs.ix + OBJ_Y, 80);
  mem.write8(regs.ix + OBJ_STATE, 1);
  stirRandomSeed(m);
  mem.write8(regs.ix + OBJ_X, (regs.a & 0x0f) - 8);
  mem.write8(regs.ix + OBJ_ACTIVE, 1);
  mem.write8(regs.ix + OBJ_ANIM_PTR, 0xaa);
  mem.write8(regs.ix + OBJ_ANIM_PTR + 1, 0x39);
  advanceToNextObject(m);
}
/** (c) biases the spawned X by the wrong amount (−9 instead of −8). */
function brokenWrongXBias(m) {
  const { regs, mem } = m;
  if ((mem.read8(SPAWN_REQUEST) & 0x01) === 0) { advanceToNextObject(m); return; }
  mem.write8(SPAWN_REQUEST, 0);
  mem.write8(regs.ix + OBJ_Y, 80);
  mem.write8(regs.ix + OBJ_STATE, 1);
  stirRandomSeed(m);
  mem.write8(regs.ix + OBJ_X, (regs.a & 0x0f) - 9); // BUG: should be − 8
  mem.write8(regs.ix + OBJ_ACTIVE, 1);
  mem.write8(regs.ix + OBJ_ANIM_PTR, 0xaa);
  mem.write8(regs.ix + OBJ_ANIM_PTR + 1, 0x39);
  advanceToNextObject(m);
}
/** (d) never activates the slot. */
function brokenNoActivate(m) {
  const { regs, mem } = m;
  if ((mem.read8(SPAWN_REQUEST) & 0x01) === 0) { advanceToNextObject(m); return; }
  mem.write8(SPAWN_REQUEST, 0);
  mem.write8(regs.ix + OBJ_Y, 80);
  mem.write8(regs.ix + OBJ_STATE, 1);
  stirRandomSeed(m);
  mem.write8(regs.ix + OBJ_X, (regs.a & 0x0f) - 8);
  // BUG: dropped `mem.write8(regs.ix + OBJ_ACTIVE, 1)`
  mem.write8(regs.ix + OBJ_ANIM_PTR, 0xaa);
  mem.write8(regs.ix + OBJ_ANIM_PTR + 1, 0x39);
  advanceToNextObject(m);
}
/** (e) inverts the arm: spawns when bit0 is CLEAR, advances when SET. */
function brokenInvertedArm(m) {
  const { regs, mem } = m;
  if ((mem.read8(SPAWN_REQUEST) & 0x01) !== 0) { advanceToNextObject(m); return; } // BUG: inverted
  mem.write8(SPAWN_REQUEST, 0);
  mem.write8(regs.ix + OBJ_Y, 80);
  mem.write8(regs.ix + OBJ_STATE, 1);
  stirRandomSeed(m);
  mem.write8(regs.ix + OBJ_X, (regs.a & 0x0f) - 8);
  mem.write8(regs.ix + OBJ_ACTIVE, 1);
  mem.write8(regs.ix + OBJ_ANIM_PTR, 0xaa);
  mem.write8(regs.ix + OBJ_ANIM_PTR + 1, 0x39);
  advanceToNextObject(m);
}
/** (f) drops the low-nibble mask on the spawned X (uses the whole seed byte). */
function brokenNoNibbleMask(m) {
  const { regs, mem } = m;
  if ((mem.read8(SPAWN_REQUEST) & 0x01) === 0) { advanceToNextObject(m); return; }
  mem.write8(SPAWN_REQUEST, 0);
  mem.write8(regs.ix + OBJ_Y, 80);
  mem.write8(regs.ix + OBJ_STATE, 1);
  stirRandomSeed(m);
  mem.write8(regs.ix + OBJ_X, regs.a - 8); // BUG: dropped `& 0x0f`
  mem.write8(regs.ix + OBJ_ACTIVE, 1);
  mem.write8(regs.ix + OBJ_ANIM_PTR, 0xaa);
  mem.write8(regs.ix + OBJ_ANIM_PTR + 1, 0x39);
  advanceToNextObject(m);
}

test("TEETH: the same sweeps CATCH every broken twin", () => {
  const base = new Machine(ROM).clone();
  const twins = [
    ["wrong spawn Y", brokenWrongY, `RAM@${hx(OBJ_BASE + OBJ_Y)}`],
    ["dropped request-clear", brokenNoClear, `RAM@${hx(SPAWN_REQUEST)}`],
    ["wrong X bias", brokenWrongXBias, `RAM@${hx(OBJ_BASE + OBJ_X)}`],
    ["missing activate", brokenNoActivate, `RAM@${hx(OBJ_BASE + OBJ_ACTIVE)}`],
    ["inverted arm", brokenInvertedArm, "RAM"],
    ["dropped nibble mask", brokenNoNibbleMask, `RAM@${hx(OBJ_BASE + OBJ_X)}`],
  ];
  for (const [name, twin, surface] of twins) {
    const { mismatch } = fullSweep(base, twin);
    assert.notEqual(mismatch, null, `the sweep FAILED to catch "${name}" — the gate is worthless`);
    assert.ok(
      mismatch.includes(surface),
      `"${name}" should be caught on ${surface}, got: ${mismatch}`,
    );
    console.log(`  TEETH/${name}: caught — ${mismatch}`);
  }
});
