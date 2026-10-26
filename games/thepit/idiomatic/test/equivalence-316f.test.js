// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for updateEnemy2 (ROM 0x316f) — the object-2 half of the two-object
 * mover pass: stage object 2's record into the shared mover scratch, step the mover on it,
 * copy it back, stage object 2's sprite (three bytes verbatim + a coordinate-biased fourth),
 * then tail into the shared per-frame actor update.
 *
 * CONTRACT. The routine's declared live-out is MEMORY-ONLY — object 2's record, the mover's
 * writes, and the four staged sprite bytes. It is reached by tail-jump and continues by
 * tail-jump, so no caller reads a value register back; the gate compares work RAM (dumpState)
 * and excludes the Z80 pc/SP/value-registers the honest-signature rewrite does not preserve.
 *
 * THE TAIL RUNS FOR REAL ON BOTH SIDES. updateEnemy2's last act was a stale m.call into the
 * shared actor update 0x3748; that call has now been DISSOLVED to a direct call to the decompiled
 * advanceTwoSpriteActor. So the tail runs on both arms — the oracle m.call's the frozen registry copy,
 * the idiomatic arm calls the imported idiomatic function — and the two are memory-equivalent
 * (equivalence-3748), so the tail's work cancels in the diff, leaving updateEnemy2's own work
 * compared. The mover (stepEnemyMover) likewise runs for real on both sides. On the rare arrival/
 * capture path the tail chains into the round-boundary transition, which resets the stack and
 * converges at two never-returning leaves (0x031a, 0x01f9); those are stubbed identically on both
 * clones, and a once-per-frame interrupt tick drains any frame-wait.
 *
 * DEAD STACK SCRATCH — the oracle marshals its calls through the Z80 stack (and the round-boundary
 * chain resets SP to 0x83ff and pushes down) while the stack-free idiomatic JS does not. Those
 * bytes are classic dead stack scratch, so the RAM diff excludes a
 * shallow window just below the entry stack pointer, and compares everything else byte-for-byte.
 *
 * THE BIAS IS ZERO IN ATTRACT, so the coordinate-bias arm of the fourth sprite byte is exercised
 * by a crafted entry that pokes a nonzero SPRITE_COORD_BIAS identically on both sides.
 *
 * Checks:
 *   0. HARNESS — capture real 0x316f attract dispatches; the oracle run is deterministic.
 *   1. EQUAL (real dispatches) — updateEnemy2 == oracle over RAM on every captured entry, with a
 *      positive check that the staged sprite is object 2's record bytes (+ zero bias).
 *   2. EQUAL (crafted nonzero bias) — with SPRITE_COORD_BIAS poked nonzero the fourth sprite
 *      byte still matches the oracle, and equals record[3] + bias.
 *   3. TEETH (corrupted sprite byte) — a twin that flips a staged sprite byte is CAUGHT.
 *   4. TEETH (dropped coordinate bias) — from the nonzero-bias entry, a twin that stages the
 *      fourth byte without the bias is CAUGHT at that byte.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-316f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_316f as oracle } from "../../translated/loc_316f.js";
import { updateEnemy2 as idiomatic } from "../updateEnemy2.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { ENEMY2_X, SPRITE_COORD_BIAS, SPRITE_STAGING_BASE } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x316f;
const OBJ2_SPRITE_RECORD = SPRITE_STAGING_BASE + 20; // object 2's slot in the sprite staging buffer

// The actor-update tail (advanceTwoSpriteActor, ROM 0x3748) is now DISSOLVED to a direct call, so it
// runs for real on BOTH sides (the idiomatic routine calls it directly; the oracle m.call's it
// through the registry). It is memory-equivalent either way (equivalence-3748), so its work cancels
// in the diff — leaving updateEnemy2's own work compared. On the rare arrival/capture path the
// tail reaches the round-boundary transition's never-returning leaves, so those are stubbed
// identically on both clones, and a once-per-frame tick drains any frame-wait.
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800; // reading it kicks the watchdog / drives the frame countdown
const COUNTDOWN = 0x8009; // the per-frame countdown the chain's frame-waits drain to 0
// Dead stack scratch: the oracle's Z80 tail pushes return/save bytes the stack-free idiomatic JS does
// not; the window below the entry SP holds no mover record or sprite-staging byte.
const SHALLOW_SCRATCH_DEPTH = 128;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/** Hook 0x316f in a real attract run and clone the machine at each dispatch (up to `limit`) —
 *  genuine in-play object-2 mover states. The wrapper runs the oracle so attract proceeds. */
function captureRealEntries(maxFrames, limit) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < limit) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return caps;
}

/** Identical no-op stub for the transition's terminal leaves: they never return on hardware and
 *  would otherwise hang a single-routine clone by busy-waiting on the NMI. */
function expiryStub() {}

/** Model the once-per-frame interrupt tick that drives any frame-wait to completion: each watchdog
 *  read decrements the frame countdown, floored at 0. Identical on both clones, so it can only
 *  expose a difference, never create one. */
function installFrameTick(m) {
  const mem = m.mem;
  const origRead8 = mem.read8.bind(mem);
  mem.read8 = (addr) => {
    if (addr === WATCHDOG) {
      const c = origRead8(COUNTDOWN);
      if (c !== 0) mem.write8(COUNTDOWN, c - 1);
    }
    return origRead8(addr);
  };
}

/** Clone `entry`, install the identical leaf stubs + frame-tick, run `fn`, and return the resulting
 *  machine — so the dissolved actor-update tail terminates the same way on both sides. */
function runIsolated(entry, fn) {
  const c = entry.clone();
  for (const addr of EXPIRY_LEAVES) c.routines.set(addr, expiryStub);
  installFrameTick(c);
  fn(c);
  return c;
}

/** First differing RAM byte between two machines (full dumpState), EXCLUDING the dead stack scratch
 *  (the shallow window just below the entry SP). Null if identical. */
function ramDiff(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - SHALLOW_SCRATCH_DEPTH, hi: entrySP }, entrySP)(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** RAM diff between the oracle run and `fn`'s run from `entry` (tail run for real on both), or null. */
function ramDiffVsOracle(entry, fn) {
  const sp = entry.regs.sp;
  const o = runIsolated(entry, oracle);
  const c = runIsolated(entry, fn);
  return ramDiff(o, c, sp);
}

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: real 0x316f attract dispatches are captured and the oracle run is deterministic", () => {
  const caps = captureRealEntries(4000, 40);
  assert.ok(caps.length >= 1, "expected 0x316f (object 2) to be dispatched during attract");

  for (const cap of caps.slice(0, 8)) {
    const a = runIsolated(cap, oracle);
    const b = runIsolated(cap, oracle);
    const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  }
  console.log(
    `  HARNESS: captured ${caps.length} real 0x316f entries (first SP=${hx(caps[0].regs.sp)}); oracle run deterministic`,
  );
});

// -- 1. EQUAL on real captured attract dispatches ----------------------------

test("EQUAL (real dispatches): updateEnemy2 == oracle over RAM on every captured entry", () => {
  const caps = captureRealEntries(4000, 200);
  assert.ok(caps.length >= 1, "need captured 0x316f entries");

  for (const cap of caps) {
    const diff = ramDiffVsOracle(cap, idiomatic);
    assert.equal(diff, null, diff && `real dispatch RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);
  }

  // Positive check on the last capture: the staged sprite is object 2's record bytes verbatim,
  // and the fourth byte is record[3] + bias (bias is 0 in attract).
  const cap = caps[caps.length - 1];
  const c = runIsolated(cap, idiomatic);
  const bias = c.mem.read8(SPRITE_COORD_BIAS);
  for (let i = 0; i < 3; i++) {
    assert.equal(
      c.mem.read8(OBJ2_SPRITE_RECORD + i),
      c.mem.read8(ENEMY2_X + i),
      `staged sprite byte ${i} must equal object-2 record byte ${i}`,
    );
  }
  assert.equal(
    c.mem.read8(OBJ2_SPRITE_RECORD + 3),
    (c.mem.read8(ENEMY2_X + 3) + bias) & 0xff,
    "staged sprite byte 3 must equal record[3] + bias",
  );
  console.log(`  EQUAL/real: ${caps.length} real attract dispatches — work RAM identical to the oracle`);
});

// -- 2. EQUAL with a crafted nonzero coordinate bias -------------------------

test("EQUAL (nonzero bias): the coordinate-biased fourth sprite byte matches the oracle", () => {
  const caps = captureRealEntries(4000, 5);
  assert.ok(caps.length >= 1, "need a captured 0x316f entry to craft the bias case from");

  const BIAS = 5;
  const entry = caps[0].clone();
  entry.mem.write8(SPRITE_COORD_BIAS, BIAS); // upright play uses 0; force the bias arm

  const diff = ramDiffVsOracle(entry, idiomatic);
  assert.equal(diff, null, diff && `nonzero-bias RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);

  const c = runIsolated(entry, idiomatic);
  assert.equal(
    c.mem.read8(OBJ2_SPRITE_RECORD + 3),
    (c.mem.read8(ENEMY2_X + 3) + BIAS) & 0xff,
    "the fourth sprite byte must carry the nonzero bias",
  );
  console.log(`  EQUAL/bias: fourth sprite byte = record[3] + ${BIAS}, identical to the oracle`);
});

// -- 3. TEETH: a corrupted staged sprite byte is caught ----------------------

/** Broken twin: run the real routine, then flip the first staged sprite byte. */
function twinCorruptSprite(m) {
  idiomatic(m);
  m.mem8[OBJ2_SPRITE_RECORD] = m.mem8[OBJ2_SPRITE_RECORD] ^ 0xff;
}

test("TEETH (corrupted sprite byte): a flipped staged sprite byte is CAUGHT", () => {
  const caps = captureRealEntries(4000, 5);
  assert.ok(caps.length >= 1, "need a captured 0x316f entry to seed the teeth check");
  const entry = caps[0];

  const diff = ramDiffVsOracle(entry, twinCorruptSprite);
  assert.notEqual(diff, null, "the gate FAILED to catch the corrupted sprite byte — it proves nothing");
  assert.equal(
    diff.addr,
    OBJ2_SPRITE_RECORD,
    `teeth caught the wrong address ${hx(diff.addr ?? 0)} (expected ${hx(OBJ2_SPRITE_RECORD)})`,
  );
  console.log(`  TEETH/sprite: corrupted sprite byte caught at ${hx(diff.addr)} (oracle=${diff.a} broken=${diff.b})`);
});

// -- 4. TEETH: a dropped coordinate bias is caught ---------------------------

/** Broken twin: run the real routine, then restage the fourth sprite byte WITHOUT the bias. */
function twinDropBias(m) {
  idiomatic(m);
  m.mem8[OBJ2_SPRITE_RECORD + 3] = m.mem8[ENEMY2_X + 3]; // BUG: coordinate bias dropped
}

test("TEETH (dropped bias): with a nonzero bias, an unbiased fourth byte is CAUGHT", () => {
  const caps = captureRealEntries(4000, 5);
  assert.ok(caps.length >= 1, "need a captured 0x316f entry to seed the teeth check");

  const entry = caps[0].clone();
  entry.mem.write8(SPRITE_COORD_BIAS, 5); // make the bias observable

  const diff = ramDiffVsOracle(entry, twinDropBias);
  assert.notEqual(diff, null, "the gate FAILED to catch the dropped-bias twin — it proves nothing");
  assert.equal(
    diff.addr,
    OBJ2_SPRITE_RECORD + 3,
    `teeth caught the wrong address ${hx(diff.addr ?? 0)} (expected ${hx(OBJ2_SPRITE_RECORD + 3)})`,
  );
  console.log(`  TEETH/bias: dropped-bias fourth byte caught at ${hx(diff.addr)} (oracle=${diff.a} broken=${diff.b})`);
});
