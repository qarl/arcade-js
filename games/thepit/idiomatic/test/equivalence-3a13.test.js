// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceActorMovers (ROM 0x3a13) — the two-sprite actor's
 * late-phase per-frame update: advance the primary object record (and, when its gate is
 * set, the twin record) through the shared move/collision driver, then stage both sprite
 * records.
 *
 * CONTRACT. The declared live-out is MEMORY-ONLY — the advanced record(s) plus the two
 * staged sprite records. The routine is reached by tail-jump and its callees (the move
 * driver, the sprite-staging tail) leave no register a caller reads, so the gate compares
 * work RAM (dumpState) and excludes the Z80 pc/SP/value-registers the honest rewrite does
 * not preserve. It also excludes the dead stack scratch the oracle's driver call
 * parks just below the entry stack pointer — the stack-free idiomatic JS does not write it.
 *
 * TWO INPUT SOURCES.
 *   - REAL captured attract dispatches. The demo runs the actor's PRIMARY record through
 *     here many hundreds of times, so the primary copy-in / drive / copy-back is exercised
 *     on real data. But the second-record gate (0x8078) is 0 for ALL of attract, so the
 *     twin path is never taken by a real capture.
 *   - A CRAFTED entry. A real captured state is poked (identically on both sides) to set
 *     the gate nonzero, which forces the twin record through the driver too — the path
 *     attract does not reach (mirrors the offset poke in the 0x3a4c gate).
 *
 * WRINKLE — the move driver's arrival / capture tails can hand off to the round/state
 * boundary transition, which converges at two TRUE oracle leaves (0x031a, 0x01f9) that
 * never return on hardware (they busy-wait on the vblank NMI, which never fires on a
 * single-routine clone). Both arms reach the same leaves, so the gate stubs them
 * identically on both clones and models the once-per-frame interrupt tick their
 * frame-waits drain, so any such tail terminates the same way on both sides.
 *
 * Checks:
 *   0. HARNESS — capture real 0x3a13 attract dispatches; the oracle run is deterministic.
 *   1. EQUAL (real dispatches) — advanceActorMovers == oracle over RAM on every captured
 *      entry; the primary record really was advanced.
 *   2. EQUAL (crafted twin) — with the gate poked nonzero on both sides, the twin record
 *      is driven too and idiomatic still matches; the twin record really was advanced.
 *   3. TEETH (dropped copy-back) — a twin that drives the primary record but forgets to
 *      write the stepped result back is CAUGHT in the primary record.
 *   4. TEETH (skipped second record) — a twin that ignores the gate and never advances the
 *      twin is INVISIBLE at gate 0 (so the crafted entry is load-bearing) and CAUGHT in the
 *      twin record once the gate is poked nonzero.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-3a13.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3a13 as oracle } from "../../translated/loc_3a13.js";
import { advanceActorMovers as idiomatic } from "../advanceActorMovers.js";
import { stepEnemyMover } from "../stepEnemyMover.js";
import { stageActorSpriteRecords } from "../stageActorSpriteRecords.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { ENEMY3_X, ENEMY3_TWIN_X } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x3a13;
const GATE = 0x8078; // second-record gate: nonzero -> also advance the twin record
const MOVER_SCRATCH = 0x8083; // the driver's shared working block
const RECORD_SIZE = 17;
const PRIMARY_LO = ENEMY3_X; // 0x810a
const PRIMARY_HI = ENEMY3_X + RECORD_SIZE; // 0x811b (exclusive)
const TWIN_LO = ENEMY3_TWIN_X; // 0x811b
const TWIN_HI = ENEMY3_TWIN_X + RECORD_SIZE; // 0x812c (exclusive)
const POKED_GATE = 0xff; // any nonzero value forces the twin path

// The two TRUE oracle leaves the arrival/capture transition converges at — each never
// returns on hardware, so the gate stubs both identically on the clones.
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800; // reading it kicks the watchdog once per frame-wait pass
const COUNTDOWN = 0x8009; // the per-frame countdown the chain's frame-waits drain to 0
// Dead stack scratch: the shallow driver call pushes just below the entry SP. No
// record/scratch/named cell lives in that window (all of interest is at/under 0x812c).
const SHALLOW_SCRATCH_DEPTH = 128;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/** Hook 0x3a13 in a real attract run and clone the machine at each dispatch (up to
 *  `limit`) — genuine in-play actor states. The wrapper runs the oracle so attract
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

/** Identical no-op stub for the transition's terminal leaves: they would otherwise hang
 *  on a single-routine clone by busy-waiting on the NMI. */
function expiryStub() {}

/** Model the once-per-frame interrupt tick that drives the chain's frame-waits to
 *  completion: each watchdog read decrements the frame countdown, floored at 0. Identical
 *  on both clones, so it can only expose a difference, never create one. */
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

/** RAM diff between the oracle run and `fn`'s run from `entry` (optionally with the gate
 *  poked nonzero on both sides first), or null when identical. */
function ramDiffVsOracle(entry, fn, pokeGate) {
  const sp = entry.regs.sp;
  const seed = entry.clone();
  if (pokeGate !== undefined) seed.mem.write8(GATE, pokeGate);
  const o = runIsolated(seed, oracle);
  const c = runIsolated(seed, fn);
  return ramDiff(o, c, sp);
}

/** True if any byte of [lo, hi) changed between the pristine entry and the run machine. */
function regionChanged(entry, run, lo, hi) {
  for (let a = lo; a < hi; a++) {
    if (entry.mem.read8(a) !== run.mem.read8(a)) return true;
  }
  return false;
}

// -- broken twins -------------------------------------------------------------

function copyIn(mem8, recordBase) {
  for (let i = 0; i < RECORD_SIZE; i++) mem8[MOVER_SCRATCH + i] = mem8[recordBase + i];
}
function copyOut(mem8, recordBase) {
  for (let i = 0; i < RECORD_SIZE; i++) mem8[recordBase + i] = mem8[MOVER_SCRATCH + i];
}

/** BUG: drives the primary record through the mover but never writes the stepped result
 *  back — so the primary record keeps its pre-step bytes. */
function twinDroppedCopyBack(m) {
  const { mem8 } = m;
  copyIn(mem8, PRIMARY_LO);
  stepEnemyMover(m);
  // BUG: the copy-back is missing here.
  if (mem8[GATE] !== 0) {
    copyIn(mem8, TWIN_LO);
    stepEnemyMover(m);
    copyOut(mem8, TWIN_LO);
  }
  return stageActorSpriteRecords(m);
}

/** BUG: ignores the second-record gate and never advances the twin record. Identical to
 *  the correct routine whenever the gate is 0 (all of attract). */
function twinSkipsSecondRecord(m) {
  const { mem8 } = m;
  copyIn(mem8, PRIMARY_LO);
  stepEnemyMover(m);
  copyOut(mem8, PRIMARY_LO);
  // BUG: the gated twin advance is dropped.
  return stageActorSpriteRecords(m);
}

// -- captured once ------------------------------------------------------------

const REAL_ENTRIES = ROM_PRESENT ? captureRealEntries(4000, 200) : [];

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: real 0x3a13 attract dispatches are captured and the oracle run is deterministic", () => {
  assert.ok(REAL_ENTRIES.length >= 1, "expected 0x3a13 to be dispatched during attract");
  for (const cap of REAL_ENTRIES.slice(0, 8)) {
    const a = runIsolated(cap, oracle);
    const b = runIsolated(cap, oracle);
    const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  }
  assert.equal(REAL_ENTRIES[0].mem.read8(GATE), 0, "attract is expected to leave the second-record gate 0");
  console.log(
    `  HARNESS: captured ${REAL_ENTRIES.length} real 0x3a13 entries (SP=${hx(REAL_ENTRIES[0].regs.sp)}, gate=0); oracle run deterministic`,
  );
});

// -- 1. EQUAL on real captured attract dispatches (primary record) -----------

test("EQUAL (real dispatches): advanceActorMovers == oracle over RAM on every captured entry", () => {
  assert.ok(REAL_ENTRIES.length >= 1, "need captured 0x3a13 entries");
  for (const cap of REAL_ENTRIES) {
    const diff = ramDiffVsOracle(cap, idiomatic);
    assert.equal(diff, null, diff && `real dispatch RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);
  }
  // Positive check: the driver really advanced the primary record (not a no-op match).
  const run = runIsolated(REAL_ENTRIES[0], idiomatic);
  assert.ok(
    regionChanged(REAL_ENTRIES[0], run, PRIMARY_LO, PRIMARY_HI),
    "expected the primary record to be advanced by the mover",
  );
  console.log(`  EQUAL/real: ${REAL_ENTRIES.length} real attract dispatches — work RAM identical to the oracle`);
});

// -- 2. EQUAL with the gate poked nonzero (drives the twin record too) --------

test("EQUAL (crafted twin): with the second-record gate poked nonzero on both sides, idiomatic == oracle", () => {
  assert.ok(REAL_ENTRIES.length >= 1, "need a captured entry to craft from");
  let checked = 0;
  for (const cap of REAL_ENTRIES.slice(0, 40)) {
    const diff = ramDiffVsOracle(cap, idiomatic, POKED_GATE);
    assert.equal(diff, null, diff && `crafted-twin RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);
    checked++;
  }
  // Positive check: the poked gate really drove the twin record through the mover.
  const seed = REAL_ENTRIES[0].clone();
  seed.mem.write8(GATE, POKED_GATE);
  const run = runIsolated(seed, idiomatic);
  assert.ok(regionChanged(seed, run, TWIN_LO, TWIN_HI), "expected the poked gate to advance the twin record");
  console.log(`  EQUAL/crafted: gate=${hx(POKED_GATE)} on ${checked} captures — idiomatic == oracle; twin record advanced`);
});

// -- 3. TEETH: a dropped primary copy-back is caught -------------------------

test("TEETH (dropped copy-back): a twin that forgets to write the stepped primary back is CAUGHT", () => {
  const diff = ramDiffVsOracle(REAL_ENTRIES[0], twinDroppedCopyBack);
  assert.notEqual(diff, null, "the gate FAILED to catch the dropped copy-back — it proves nothing");
  assert.ok(
    diff.addr >= PRIMARY_LO && diff.addr < PRIMARY_HI,
    `expected the diff in the primary record [${hx(PRIMARY_LO)},${hx(PRIMARY_HI)}), got ${hx(diff.addr ?? 0)}`,
  );
  console.log(`  TEETH/copy-back: dropped write-back caught at ${hx(diff.addr)} (oracle=${diff.a} broken=${diff.b})`);
});

// -- 4. TEETH: a skipped second record hides at gate 0, caught when poked -----

test("TEETH (skipped second record): invisible at gate 0 (crafted entry load-bearing), CAUGHT when poked", () => {
  // With the real gate (0 everywhere in attract), skipping the twin is invisible — this
  // asserts the plain real-capture sweep genuinely cannot see it.
  for (const cap of REAL_ENTRIES.slice(0, 40)) {
    const hidden = ramDiffVsOracle(cap, twinSkipsSecondRecord);
    assert.equal(
      hidden,
      null,
      hidden && `skipped-twin should be invisible at gate 0 but diverged at ${hx(hidden.addr ?? 0)}`,
    );
  }

  // Poke the gate nonzero on both sides and the omission shows: the correct routine drives
  // the twin (leaving the working block holding the twin's driven state and the twin record
  // updated), the twin-skipping bug leaves the working block holding the primary's state and
  // the twin record un-advanced. The first diff by address is in exactly that region — the
  // shared working block through the twin record — the memory the second-record advance owns.
  const diff = ramDiffVsOracle(REAL_ENTRIES[0], twinSkipsSecondRecord, POKED_GATE);
  assert.notEqual(diff, null, "the crafted-gate run FAILED to catch the skipped twin — the crafted entry proves nothing");
  assert.ok(
    diff.addr >= MOVER_SCRATCH && diff.addr < TWIN_HI,
    `expected the diff in the working block or twin record [${hx(MOVER_SCRATCH)},${hx(TWIN_HI)}), got ${hx(diff.addr ?? 0)}`,
  );
  console.log(
    `  TEETH/second-record: hidden at gate 0, caught at gate ${hx(POKED_GATE)} — ${hx(diff.addr)} ` +
      `(oracle=${diff.a} broken=${diff.b})`,
  );
});
