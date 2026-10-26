// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for updateEnemy1 (ROM 0x312d) — the per-frame object-
 * pair mover pass: drive object 1 through the shared move/collision driver, stage its
 * sprite record, then hand off object 2.
 *
 * CONTRACT. The routine's declared live-out is MEMORY-ONLY — object 1's committed record,
 * its four staged sprite bytes, and whatever the mover / delegated tails leave. It is
 * reached by tail-jump (the per-frame backdrop driver loc_2f71 jumps here), so no caller
 * reads a value register back; the gate compares work RAM (dumpState) and excludes the
 * Z80 pc/SP/value-registers the honest-signature rewrite does not preserve.
 *
 * TWO INPUT SOURCES.
 *   - REAL captured attract dispatches. loc_2f71 tail-jumps here every frame, so the pass
 *     runs continuously in the demo — exercising the real object records + the branch the
 *     demo takes for free.
 *   - CRAFTED entries. A real attract state is poked (identically on both sides) on the
 *     intro/phase counter to force each branch: skip-both (counter < 8), object-1-only
 *     (game mode 4, counter 8..9), and object-1 + object-2 (counter >= 10).
 *
 * ONE WRINKLE — object 1's mover (stepEnemyMover) can, on its rare arrival/capture tail, reach
 * the round/state-boundary transition, whose real successor chain converges at two TRUE
 * oracle leaves (0x031a round setup, 0x01f9 reset entry) that never return on hardware
 * (they busy-wait on the vblank NMI, which never fires on a single-routine clone). Both
 * arms reach those same leaves, so the gate stubs them identically on both clones and
 * models the once-per-frame tick their frame-waits drain, so the transition terminates.
 * The RAM diff excludes the stack scratch below the entry SP the oracle's driver calls
 * leave and the stack-free candidate does not — the mover records (0x8068..
 * 0x8123) and the sprite staging buffer (0x8220..0x823f) live far below that window.
 *
 * Checks:
 *   0. HARNESS — capture real 0x312d attract dispatches; the oracle run is deterministic.
 *   1. EQUAL (real dispatches) — updateEnemy1 == oracle over RAM on every capture.
 *   2. EQUAL (crafted skip-both) — counter < 8 runs neither mover, identical to the oracle.
 *   3. EQUAL (crafted object-1-only) — game mode 4 + counter 9 runs only object 1 + stages
 *      its sprite (bias applied), identical to the oracle.
 *   4. EQUAL (crafted object-1 + object-2) — counter >= 10 runs both, identical to the oracle.
 *   5. TEETH (dropped bias) — a twin that stages object 1's 4th sprite byte WITHOUT the
 *      sprite-coordinate bias is CAUGHT at that byte.
 *   6. TEETH (corrupt verbatim byte) — a twin that corrupts a verbatim sprite-record byte
 *      is CAUGHT at that byte.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-312d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_312d as oracle } from "../../translated/loc_312d.js";
import { updateEnemy1 as idiomatic } from "../updateEnemy1.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { PLAY_PHASE_COUNTER, GAME_STATE, ENEMY1_X, SPRITE_COORD_BIAS, SPRITE_STAGING_BASE } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x312d;
const OBJ1_SPRITE_RECORD = SPRITE_STAGING_BASE + 16; // object 1's 4-byte slot (0x8230)

// The two TRUE oracle leaves the arrival/capture transition converges at — each never
// returns on hardware, so the gate stubs both identically on the clones.
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800; // reading it kicks the watchdog once per frame-wait pass
const COUNTDOWN = 0x8009; // the per-frame countdown the chain's frame-waits drain to 0
// Dead stack scratch: the driver calls push just below the entry SP. That window holds no
// mover record or sprite-staging byte; everything at/above the entry SP is compared.
const SHALLOW_SCRATCH_DEPTH = 128;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/** Hook 0x312d in a real attract run and clone the machine at each dispatch (up to
 *  `limit`) — genuine in-play object-pass states. The wrapper runs the oracle so attract
 *  proceeds undisturbed. */
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

/** A base attract machine to craft entries from. */
function baseAttractState(startFrame) {
  const m = makeMachine();
  m.runFrames(startFrame);
  return m.clone();
}

/** Identical no-op stub for the transition's terminal leaves: they would otherwise hang
 *  on a single-routine clone by busy-waiting on the NMI. */
function expiryStub() {}

/** Model the once-per-frame interrupt tick that drives any frame-wait to completion: each
 *  watchdog read decrements the frame countdown, floored at 0. Identical on both clones,
 *  so it can only expose a difference, never create one. */
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

/** Clone `entry`, install the identical leaf stubs + frame-tick, run `fn`, and return the
 *  resulting machine — so any arrival/capture tail terminates the same way on both sides. */
function runIsolated(entry, fn) {
  const c = entry.clone();
  for (const addr of EXPIRY_LEAVES) c.routines.set(addr, expiryStub);
  installFrameTick(c);
  fn(c);
  return c;
}

/** First differing RAM byte between two machines (full dumpState), EXCLUDING the dead
 *  stack scratch (the shallow window just below the entry SP). Null when otherwise identical. */
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

/** RAM diff between the oracle run and `fn`'s run from `entry`, or null when identical. */
function ramDiffVsOracle(entry, fn) {
  const sp = entry.regs.sp;
  const o = runIsolated(entry, oracle);
  const c = runIsolated(entry, fn);
  return ramDiff(o, c, sp);
}

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: real 0x312d attract dispatches are captured and the oracle run is deterministic", () => {
  const caps = captureRealEntries(2500, 40);
  assert.ok(caps.length >= 1, "expected 0x312d to be dispatched during attract");
  // Guard the stack-scratch exclusion never overlaps the mover records / sprite buffer.
  assert.ok(
    caps[0].regs.sp - SHALLOW_SCRATCH_DEPTH > 0x8140,
    `entry SP ${hx(caps[0].regs.sp)} too low for the shallow-scratch window`,
  );

  for (const cap of caps.slice(0, 8)) {
    const a = runIsolated(cap, oracle);
    const b = runIsolated(cap, oracle);
    const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  }
  console.log(
    `  HARNESS: captured ${caps.length} real 0x312d entries (first SP=${hx(caps[0].regs.sp)}); oracle run deterministic`,
  );
});

// -- 1. EQUAL on real captured attract dispatches ----------------------------

test("EQUAL (real dispatches): updateEnemy1 == oracle over RAM on every captured entry", () => {
  const caps = captureRealEntries(2500, 120);
  assert.ok(caps.length >= 1, "need captured 0x312d entries");

  for (const cap of caps) {
    const diff = ramDiffVsOracle(cap, idiomatic);
    assert.equal(diff, null, diff && `real dispatch RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} real attract dispatches — work RAM identical to the oracle`);
});

// -- 2. EQUAL on the crafted skip-both branch --------------------------------

test("EQUAL (skip-both): counter < 8 runs neither mover, identical to the oracle", () => {
  const entry = baseAttractState(300);
  entry.mem.write8(PLAY_PHASE_COUNTER, 5); // below the intro gate -> skip straight to the dispatcher

  const diff = ramDiffVsOracle(entry, idiomatic);
  assert.equal(diff, null, diff && `skip-both RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);
  console.log("  EQUAL/skip: counter < 8 skips both movers, identical to the oracle");
});

// -- 3. EQUAL on the crafted object-1-only branch ----------------------------

test("EQUAL (object-1-only): game mode 4 + counter 9 runs only object 1 and stages its sprite", () => {
  const entry = baseAttractState(300);
  entry.mem.write8(GAME_STATE, 4); // attract demo
  entry.mem.write8(PLAY_PHASE_COUNTER, 9); // in [8,10) -> only object 1 runs
  entry.mem.write8(SPRITE_COORD_BIAS, 16); // a nonzero bias so the 4th-byte shift is observable

  const diff = ramDiffVsOracle(entry, idiomatic);
  assert.equal(diff, null, diff && `object-1-only RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);

  // Positive check: object 1's sprite record was staged with its 4th byte shifted by the bias.
  const c = runIsolated(entry, idiomatic);
  const expected4th = (c.mem.read8(ENEMY1_X + 3) + 16) & 0xff;
  assert.equal(
    c.mem.read8(OBJ1_SPRITE_RECORD + 3),
    expected4th,
    "object 1's 4th sprite byte must be record byte 3 + the sprite-coordinate bias",
  );
  console.log("  EQUAL/object-1-only: only object 1 runs; 4th sprite byte carries the bias, identical to the oracle");
});

// -- 4. EQUAL on the crafted object-1 + object-2 branch ----------------------

test("EQUAL (object-1 + object-2): counter >= 10 runs both movers, identical to the oracle", () => {
  const entry = baseAttractState(300);
  entry.mem.write8(GAME_STATE, 4);
  entry.mem.write8(PLAY_PHASE_COUNTER, 12); // >= 10 -> object 2 also runs (hand-off to updateEnemy2)

  const diff = ramDiffVsOracle(entry, idiomatic);
  assert.equal(diff, null, diff && `both-movers RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);
  console.log("  EQUAL/both: counter >= 10 runs object 1 and hands off object 2, identical to the oracle");
});

// -- 5. TEETH: a dropped sprite-coordinate bias is caught --------------------

/** A crafted entry with a nonzero bias so the 4th-byte shift is meaningful. */
function biasedEntry() {
  const entry = baseAttractState(300);
  entry.mem.write8(PLAY_PHASE_COUNTER, 12); // object 1 runs + stages
  entry.mem.write8(SPRITE_COORD_BIAS, 16);
  return entry;
}

/** Broken twin: run the real routine, then re-stage object 1's 4th sprite byte WITHOUT
 *  the sprite-coordinate bias. */
function twinDroppedBias(m) {
  idiomatic(m);
  m.mem8[OBJ1_SPRITE_RECORD + 3] = m.mem8[ENEMY1_X + 3]; // BUG: bias dropped
}

test("TEETH (dropped bias): a twin that omits the sprite-coordinate bias is CAUGHT at the 4th byte", () => {
  const entry = biasedEntry();

  const diff = ramDiffVsOracle(entry, twinDroppedBias);
  assert.notEqual(diff, null, "the gate FAILED to catch the dropped-bias twin — it proves nothing");
  assert.equal(
    diff.addr,
    OBJ1_SPRITE_RECORD + 3,
    `teeth caught the wrong address ${hx(diff.addr ?? 0)} (expected ${hx(OBJ1_SPRITE_RECORD + 3)})`,
  );
  console.log(`  TEETH/bias: dropped bias caught at ${hx(diff.addr)} (oracle=${diff.a} broken=${diff.b})`);
});

// -- 6. TEETH: a corrupted verbatim sprite-record byte is caught -------------

/** Broken twin: run the real routine, then corrupt a verbatim sprite-record byte. */
function twinCorruptRecordByte(m) {
  idiomatic(m);
  m.mem8[OBJ1_SPRITE_RECORD + 1] = m.mem8[OBJ1_SPRITE_RECORD + 1] ^ 0xff; // BUG: corrupts sprite byte 1
}

test("TEETH (corrupt verbatim byte): a twin that corrupts a sprite-record byte is CAUGHT", () => {
  const entry = biasedEntry();

  const diff = ramDiffVsOracle(entry, twinCorruptRecordByte);
  assert.notEqual(diff, null, "the gate FAILED to catch the corrupted-byte twin — it proves nothing");
  assert.equal(
    diff.addr,
    OBJ1_SPRITE_RECORD + 1,
    `teeth caught the wrong address ${hx(diff.addr ?? 0)} (expected ${hx(OBJ1_SPRITE_RECORD + 1)})`,
  );
  console.log(`  TEETH/verbatim: corrupted sprite byte caught at ${hx(diff.addr)} (oracle=${diff.a} broken=${diff.b})`);
});
