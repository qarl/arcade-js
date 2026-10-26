// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceLiveFires (ROM 0x31B1) — the five-record sweep of the 0x6400
 * object array.
 *
 * The routine runs armAlternateFireModeAtHighDifficulty, then five times: advance OBJ_ITER_PTR by one stride, store
 * it back, and call ROM 0x3202 when the record's occupancy flag (+0) is non-zero. The
 * pointer and the sweep index (0x63A2) both live in MEMORY and are re-read every
 * iteration, so a callee that rewrites either one steers the rest of the sweep.
 *
 * CONTRACT COMPARED HERE: work/sprite/video RAM minus the stack scratch below the entry SP, plus the return value. The
 * dissolved advanceLiveFires is SP-neutral — it DIRECT-calls advanceFire and owns no guest-stack
 * bracket — so pc and SP are NOT compared (the earlier arm compared them only because the seam form
 * left a live bracket; that is gone). The oracle still splices through the guest stack, so the two
 * return-address bytes it writes land in the dead STACK_SCRATCH and are excluded. The whole-game SP
 * tests are what now guard SP-correctness; this file does not.
 *
 * ONE-LEVEL-DEEPER DISSOLUTION — why the crafted arms changed shape. advanceLiveFires no longer
 * calls `m.call(0x3202)`; it calls advanceFire directly. A stub installed at 0x3202 is therefore
 * BYPASSED by the candidate, so the old marker/steering stubs (which stood in for the object body)
 * could no longer be compared against it. The crafted equivalence now runs both sides on the REAL
 * object body and proves the call with a delegating counter; the stub survives only where the caller
 * keeps the seam — the TEETH twins, which are written `m.call(0x3202)`.
 *
 * WHAT EACH TEST ACTUALLY COVERS — read this before trusting a green run:
 *
 *   1. CAPTURED (real dispatches). 0x31B1 is dispatched 481 times in a 3000-frame
 *      attract run. Sampling policy: every 20th capture PLUS the first capture at each
 *      distinct entry shape (the five occupancy flags), and the test asserts the sample
 *      covers every shape seen. ATTRACT PRESENTS EXACTLY ONE SHAPE — record 0 occupied,
 *      records 1-4 empty — so the captures prove the real path and nothing about the
 *      other 31 occupancy patterns. Those are the crafted cases below. Both sides run the
 *      real object body (advanceFire on the candidate, frozen loc_3202 on the oracle),
 *      memory-equivalent by advanceFire's own gate.
 *
 *   2. CRAFTED (occupancy, all 32 patterns). On a real attract base, STUB-FREE: both sides
 *      run the real object body, and equivalence proves advanceLiveFires visits the same
 *      records the oracle does. Non-vacuity comes from a DELEGATING counter over the
 *      ORACLE's sweep — a 0x3202 override that records the record base and then delegates to
 *      the frozen loc_3202 — asserting the call landed on exactly the occupied records and
 *      the sweep ran its five iterations. (The retired marker stub gave the same
 *      observability by REPLACING the body; the counter gives it without displacing it.)
 *
 *   3. CRAFTED (callee steering) — RETIRED as a real-candidate arm. It stubbed 0x3202 to
 *      steer OBJ_ITER_PTR / the sweep index mid-pass; the dissolved candidate bypasses the
 *      stub, so that steer can no longer be injected into it. The property — both cells are
 *      re-read from memory each iteration — is still gated by the occupancy arm (the real
 *      advanceFire moves OBJ_ITER_PTR, so a pointer held in a local diverges in RAM) and by
 *      the TEETH "local-index" twin, which keeps the seam call and still routes through the
 *      steering stub. See the note at its old position.
 *
 *   4. LIVE (whole-machine). The candidate is wired at 0x31B1 for a 3000-frame attract
 *      run and every frame's state dump is compared against the all-oracle baseline,
 *      minus the stack scratch below each frame's live SP. THE OVERRIDE RESTORES THE ORACLE'S MEASURED CYCLE COST
 *      (measured per dispatch by running the oracle on a clone): cycle-free code
 *      under-charges, which shifts the vblank NMI and diverges for reasons that have
 *      nothing to do with this routine. Drop the `mm.tick(...)` line below and this run
 *      diverges at frame 870 (measured, on the same rewrite that passes with it).
 *      Attract only; gameplay is NOT covered by any test here.
 *
 *   5. LIVE-OUT. The registers this routine defines and the candidate drops — measured to
 *      be exactly A, F, B, C, H, L — are scrambled after every ORACLE dispatch across the
 *      same 3000-frame attract run. The trace stays byte-identical, so nothing downstream
 *      reads them. Attract only, again: this measures the states attract reaches.
 *
 *   6. TEETH — four deliberately-broken twins the cases above MUST catch:
 *        (a) the pointer kept in a local, written back only once;
 *        (b) the pointer advanced AFTER the record is read (record 0 skipped, a sixth
 *            record visited);
 *        (c) the sweep index kept in a local instead of re-read from memory;
 *        (d) the 0x3202 call skipped.
 *
 * LIVE-OUT, DERIVED — cross-file, and therefore recorded here rather than in the routine. The sole
 * caller — ROM 0x30ED, whose `call 0x31B1` at 0x30F3 is the only one in the translated layer — goes
 * straight on to `call 0x34F3` (publishFireSprites), which loads its own source/destination
 * pointers and record count and re-sets the flags before it reads anything, so A/F/B/H/L are dead
 * within one instruction of the return; C survives that callee, and was followed out through the
 * next two call levels (ROM 0x2E04's prologue and the two rst targets it enters) without being
 * read. Arm 5 is the measurement.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-31b1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_31b1 as oracle } from "../../translated/loc_31b1.js";
import { loc_3202 } from "../../translated/loc_3202.js";
import { advanceLiveFires } from "../advanceLiveFires.js";
import { armAlternateFireModeAtHighDifficulty } from "../armAlternateFireModeAtHighDifficulty.js";
import { OBJ_ARRAY_64, OBJ_ACTIVE, OBJ_ITER_PTR, STACK_SCRATCH } from "../names.js";
import { u8, u16 } from "../../../../core/int.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x31b1;
const OBJECT_CALL = 0x3202; // the per-object state machine, still the frozen oracle
const RET_ADDR = 0x30f6; // the caller site right after `call 0x31b1` in ROM 0x30ED
const SWEEP_INDEX = 0x63a2; // loop counter cell (no names.js name)
const OBJECT_COUNT = 5;
const OBJECT_STRIDE = 32;
const MARKER = 1; // record field the stub bumps so every 0x3202 call is visible in RAM
const ATTRACT_FRAMES = 3000;
const SAMPLE_STRIDE = 20;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const recordAddr = (i) => OBJ_ARRAY_64 + i * OBJECT_STRIDE;

/** First RAM byte that differs, skipping the stack scratch below the entry SP. */
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

function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { m: c, ret };
}

/** The candidate, called as a plain JS function. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  return { m: c, ret };
}

/**
 * RAM − the stack scratch below the entry SP and the return value. The dissolved advanceLiveFires is SP-neutral (it
 * DIRECT-calls advanceFire and owns no guest-stack bracket), so pc and SP are no longer compared —
 * the oracle's live bracket and terminal `ret` are the guest machine's, not the rewrite's, and land
 * in the excluded STACK_SCRATCH. (The whole-game SP tests confirm the conversion is SP-correct.)
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o.m, c.m, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.ret !== c.ret) diffs.push(`return oracle=${String(o.ret)} cand=${String(c.ret)}`);
  return diffs;
}

/** The five occupancy flags — this routine's entry shape. */
const shapeOf = (m) => Array.from({ length: OBJECT_COUNT }, (_, i) => m.mem.read8(recordAddr(i))).join(",");

// A real, self-consistent machine: boot + a stretch of attract so work RAM is realistic.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * A machine carrying `base`'s state, optionally with one ROM address overridden. Built by
 * construction (not clone) because the override map is a constructor option; clone() reruns the
 * constructor, so clones keep the override.
 *
 * ONE-LEVEL-DEEPER DISSOLUTION, load-bearing here: advanceLiveFires now DIRECT-calls advanceFire
 * (ROM 0x3202) rather than `m.call(0x3202)`, so a stub installed at 0x3202 is bypassed by the
 * candidate and can no longer stand in for the object body. The crafted equivalence therefore runs
 * both sides on the REAL body — advanceFire on the candidate, the frozen loc_3202 on the oracle,
 * which are memory-equivalent — and proves the call happened with a DELEGATING counter (below). A
 * stub still stands in only where the caller keeps the seam: the TEETH twins, which are written
 * `m.call(0x3202)` and so still route through it.
 */
function rehost(base, override = null) {
  const e = new Machine(ROM, override ? { overrides: new Map([override]) } : {});
  e.mem.workRam.set(base.mem.workRam);
  e.mem.spriteRam.set(base.mem.spriteRam);
  e.mem.videoRam.set(base.mem.videoRam);
  e.regs.copyFrom(base.regs);
  e.io.loadStateFrom(base.io);
  e.cycles = base.cycles;
  e.pc = base.pc;
  e.pcKnown = base.pcKnown;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  e.maxFrames = Infinity;
  e.maxCycles = Infinity;
  return e;
}

/** A machine that runs the REAL frozen object body but records the record base each call lands on,
 *  so the ORACLE's own sweep proves the crafted occupancy drove the call on the right records. */
const withObjectStub = (base, stub) => rehost(base, [OBJECT_CALL, stub]);
const withObjectCounter = (base, sink) =>
  rehost(base, [OBJECT_CALL, (mm) => { sink.push(mm.mem.read16(OBJ_ITER_PTR)); return loc_3202(mm); }]);

/** Seed a crafted entry: an occupancy pattern, cleared markers, poisoned loop cells. */
function seedEntry(e, pattern) {
  for (let i = 0; i < OBJECT_COUNT; i++) {
    e.mem.write8(recordAddr(i), (pattern >> i) & 1);
    e.mem.write8(recordAddr(i) + MARKER, 0);
  }
  // Poisoned so a candidate that fails to initialise either cell is caught.
  e.mem.write8(SWEEP_INDEX, 0xee);
  e.mem.write16(OBJ_ITER_PTR, 0xdead);
  e.regs.sp = 0x6bfa;
  e.push16(RET_ADDR);
  return e;
}

/** Plain stub: bump the marker in the record it is handed, then return like 0x3202 does. */
function markerStub(mm) {
  const record = mm.mem.read16(OBJ_ITER_PTR);
  mm.mem.write8(record + MARKER, u8(mm.mem.read8(record + MARKER) + 1));
  mm.ret(0);
}

/**
 * Steering stub: on record 0 it also rewrites the two cells the loop re-reads — one extra
 * stride on the pointer and one extra count on the index. Stateless, so it behaves the
 * same on the oracle run and the candidate run.
 */
function steeringStub(mm) {
  const record = mm.mem.read16(OBJ_ITER_PTR);
  mm.mem.write8(record + MARKER, u8(mm.mem.read8(record + MARKER) + 1));
  if (record === OBJ_ARRAY_64) {
    mm.mem.write16(OBJ_ITER_PTR, u16(record + OBJECT_STRIDE));
    mm.mem.write8(SWEEP_INDEX, u8(mm.mem.read8(SWEEP_INDEX) + 1));
  }
  mm.ret(0);
}

// -- 1. CAPTURED --------------------------------------------------------------

test("CAPTURED: sampled real 0x31B1 dispatches match the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(ATTRACT_FRAMES);
  assert.ok(caps.length > 0, "no 0x31B1 dispatch was captured — this case would be vacuous");

  // Sample: every SAMPLE_STRIDE-th capture, plus the first capture at each distinct shape.
  const allShapes = new Set();
  const firstOfShape = new Map();
  caps.forEach((c, i) => {
    const s = shapeOf(c);
    allShapes.add(s);
    if (!firstOfShape.has(s)) firstOfShape.set(s, i);
  });
  const picked = new Set([...firstOfShape.values()]);
  for (let i = 0; i < caps.length; i += SAMPLE_STRIDE) picked.add(i);
  const sample = [...picked].sort((a, b) => a - b);

  const covered = new Set(sample.map((i) => shapeOf(caps[i])));
  assert.deepEqual([...covered].sort(), [...allShapes].sort(), "the sample must cover every entry shape seen");

  for (const i of sample) {
    const diffs = contractDiffs(caps[i], advanceLiveFires);
    assert.equal(diffs.length, 0, `capture ${i} (shape ${shapeOf(caps[i])}): ${diffs.join("; ")}`);
  }
  console.log(
    `  CAPTURED: ${sample.length} of ${caps.length} dispatches in ${ATTRACT_FRAMES} attract frames replayed — identical; ` +
      `${allShapes.size} distinct entry shape(s) seen, all covered: ${[...allShapes].join(" | ")}`,
  );
});

// -- 2. CRAFTED (occupancy) ---------------------------------------------------

test("CRAFTED (occupancy): all 32 occupancy patterns match the oracle", () => {
  const base = attractBase();
  let calls = 0;
  for (let pattern = 0; pattern < 32; pattern++) {
    // Stub-free: both sides run the real object body (advanceFire on the candidate, loc_3202 on the
    // oracle), which the CAPTURED arm and advanceFire's own gate prove memory-equivalent.
    const diffs = contractDiffs(seedEntry(rehost(base), pattern), advanceLiveFires);
    assert.equal(diffs.length, 0, `pattern ${pattern}: ${diffs.join("; ")}`);

    // Non-vacuity, via a delegating counter over the ORACLE's own sweep: the call landed on exactly
    // the occupied records, in order, and the sweep ran the full five iterations.
    const advanced = [];
    const probe = runOracle(seedEntry(withObjectCounter(base, advanced), pattern)).m;
    const expected = [];
    for (let i = 0; i < OBJECT_COUNT; i++) if ((pattern >> i) & 1) expected.push(recordAddr(i));
    assert.deepEqual(advanced, expected, `pattern ${pattern}: the oracle called 0x3202 on the wrong records`);
    assert.equal(probe.mem.read16(OBJ_ITER_PTR), recordAddr(OBJECT_COUNT - 1), "the sweep must end on the last record");
    assert.equal(probe.mem.read8(SWEEP_INDEX), OBJECT_COUNT, "the sweep index must end at the record count");
    calls += expected.length;
  }
  assert.equal(calls, 80, `expected 80 object calls across the 32 patterns, saw ${calls}`);
  console.log(`  CRAFTED/occupancy: 32 patterns — identical; ${calls} object calls exercised (delegating counter)`);
});

// -- 3. CRAFTED (callee steering) — RETIRED as a real-candidate arm ------------
//
// The steering equivalence arm forced a callee to rewrite OBJ_ITER_PTR and SWEEP_INDEX mid-sweep by
// STUBBING 0x3202. The dissolved advanceLiveFires DIRECT-calls advanceFire, so the stub is bypassed
// and this synthetic steer can no longer be injected into the candidate. The property it guarded —
// the loop re-reads both cells from memory each iteration — is still gated two ways: the occupancy
// arm above catches a pointer held in a local (the real advanceFire moves OBJ_ITER_PTR, so the
// "local-pointer" and "post-increment" twins below diverge in RAM), and the TEETH "local-index"
// twin, still written `m.call(0x3202)`, still routes through the steering stub and is caught there.

// -- 4. LIVE (whole-machine attract) ------------------------------------------

test("LIVE: the candidate wired at 0x31B1 reproduces the oracle over a whole attract run", () => {
  const baseline = new Machine(ROM);
  const baseSp = recordFrameSp(baseline);
  const baseFrames = baseline.runFrames(ATTRACT_FRAMES);
  assert.equal(baseline.stoppedBy, null, `baseline run stopped early: ${baseline.stoppedBy}`);

  let fired = 0;
  const live = new Map([[TARGET, (mm) => {
    fired++;
    // Restore the oracle's cycle cost for THIS entry state: cycle-free code under-charges,
    // which shifts the vblank NMI and diverges for reasons unrelated to the rewrite.
    const probe = mm.clone();
    const probeStart = probe.cycles;
    oracle(probe);
    const cost = probe.cycles - probeStart;

    const start = mm.cycles;
    const r = advanceLiveFires(mm);
    mm.tick(cost - (mm.cycles - start));
    return r;
  }]]);
  const cand = new Machine(ROM, { overrides: live });
  const candSp = recordFrameSp(cand);
  const candFrames = cand.runFrames(ATTRACT_FRAMES);
  const floors = frameFloors(baseSp, candSp);
  assert.equal(cand.stoppedBy, null, `candidate run stopped early: ${cand.stoppedBy}`);
  assert.ok(fired > 0, "the override never fired — this case would be vacuous");
  assert.equal(candFrames.length, baseFrames.length, "both runs must reach the frame budget");

  for (let f = 0; f < baseFrames.length; f++) {
    const a = baseFrames[f], b = candFrames[f];
    const dead = deadStackBelow(STACK_SCRATCH, floors[f]);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const addr = baseline.stateOffsetToAddr(i);
      if (dead(addr)) continue;
      assert.fail(`frame ${f}: RAM@${hx(addr)} baseline=${a[i]} live=${b[i]}`);
    }
  }
  // The guest stack must not leak across the seam: the frozen 0x3202 still returns through it.
  assert.equal(cand.regs.sp, baseline.regs.sp, "guest SP drifted over the live run");
  console.log(
    `  LIVE: ${baseFrames.length} attract frames, ${fired} live dispatches — every frame byte-identical ` +
      "(RAM/sprite/video minus stack scratch), guest SP unchanged",
  );
});

// -- 5. LIVE-OUT (the dropped registers really are dead) ----------------------

test("LIVE-OUT: poisoning the registers the oracle leaves changes nothing over a whole attract run", () => {
  const baseline = new Machine(ROM);
  const baseSp = recordFrameSp(baseline);
  const baseFrames = baseline.runFrames(ATTRACT_FRAMES);
  assert.equal(baseline.stoppedBy, null, `baseline run stopped early: ${baseline.stoppedBy}`);

  // The registers that differ between oracle and candidate, measured: A, F, B, C, H, L.
  // (D, E, IX, IY, SP and the shadow set are left identical by both.) Poison exactly
  // those after the ORACLE runs — if any caller downstream read one, the trace moves.
  let fired = 0;
  const poison = new Map([[TARGET, (mm) => {
    fired++;
    const r = oracle(mm);
    mm.regs.a = 0x5a;
    mm.regs.f = 0xa5;
    mm.regs.b = 0x5a;
    mm.regs.c = 0xa5;
    mm.regs.h = 0x5a;
    mm.regs.l = 0xa5;
    return r;
  }]]);
  const poisoned = new Machine(ROM, { overrides: poison });
  const poisonSp = recordFrameSp(poisoned);
  const poisonFrames = poisoned.runFrames(ATTRACT_FRAMES);
  const floors = frameFloors(baseSp, poisonSp);
  assert.equal(poisoned.stoppedBy, null, `poisoned run stopped early: ${poisoned.stoppedBy}`);
  assert.ok(fired > 0, "the poison override never fired — this case would be vacuous");

  for (let f = 0; f < baseFrames.length; f++) {
    const a = baseFrames[f], b = poisonFrames[f];
    const dead = deadStackBelow(STACK_SCRATCH, floors[f]);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const addr = baseline.stateOffsetToAddr(i);
      if (dead(addr)) continue;
      assert.fail(`frame ${f}: RAM@${hx(addr)} baseline=${a[i]} poisoned=${b[i]}`);
    }
  }
  console.log(
    `  LIVE-OUT: A/F/B/C/H/L scrambled after every one of ${fired} oracle dispatches — ` +
      `${baseFrames.length} attract frames still byte-identical, so no caller reads them`,
  );
});

// -- 6. TEETH -----------------------------------------------------------------

/** BUG (a): the pointer is kept in a local and written back only once. */
function brokenLocalPointer(m) {
  const { mem8, mem16 } = m;
  armAlternateFireModeAtHighDifficulty(m);
  mem8[SWEEP_INDEX] = 0;
  let record = OBJ_ARRAY_64 - OBJECT_STRIDE;
  mem16[OBJ_ITER_PTR] = record;
  for (;;) {
    record = u16(record + OBJECT_STRIDE); // BUG: never stored back
    if (mem8[record + OBJ_ACTIVE] !== 0) {
      m.push16(0x31d0);
      m.call(OBJECT_CALL);
    }
    const visited = u8(mem8[SWEEP_INDEX] + 1);
    mem8[SWEEP_INDEX] = visited;
    if (visited === OBJECT_COUNT) return;
  }
}

/** BUG (b): the pointer is advanced AFTER the record is read. */
function brokenPostIncrement(m) {
  const { mem8, mem16 } = m;
  armAlternateFireModeAtHighDifficulty(m);
  mem8[SWEEP_INDEX] = 0;
  mem16[OBJ_ITER_PTR] = OBJ_ARRAY_64 - OBJECT_STRIDE;
  for (;;) {
    const record = mem16[OBJ_ITER_PTR]; // BUG: read before the advance
    if (mem8[record + OBJ_ACTIVE] !== 0) {
      m.push16(0x31d0);
      m.call(OBJECT_CALL);
    }
    mem16[OBJ_ITER_PTR] = u16(record + OBJECT_STRIDE);
    const visited = u8(mem8[SWEEP_INDEX] + 1);
    mem8[SWEEP_INDEX] = visited;
    if (visited === OBJECT_COUNT) return;
  }
}

/** BUG (c): the sweep index is kept in a local instead of re-read from memory. */
function brokenLocalIndex(m) {
  const { mem8, mem16 } = m;
  armAlternateFireModeAtHighDifficulty(m);
  let visited = 0;
  mem8[SWEEP_INDEX] = visited;
  mem16[OBJ_ITER_PTR] = OBJ_ARRAY_64 - OBJECT_STRIDE;
  for (;;) {
    const record = u16(mem16[OBJ_ITER_PTR] + OBJECT_STRIDE);
    mem16[OBJ_ITER_PTR] = record;
    if (mem8[record + OBJ_ACTIVE] !== 0) {
      m.push16(0x31d0);
      m.call(OBJECT_CALL);
    }
    visited = u8(visited + 1); // BUG: not re-read, so a callee cannot steer it
    mem8[SWEEP_INDEX] = visited;
    if (visited === OBJECT_COUNT) return;
  }
}

/** BUG (d): the object call is never made. */
function brokenNoObjectCall(m) {
  const { mem8, mem16 } = m;
  armAlternateFireModeAtHighDifficulty(m);
  mem8[SWEEP_INDEX] = 0;
  mem16[OBJ_ITER_PTR] = OBJ_ARRAY_64 - OBJECT_STRIDE;
  for (;;) {
    const record = u16(mem16[OBJ_ITER_PTR] + OBJECT_STRIDE);
    mem16[OBJ_ITER_PTR] = record;
    // BUG: the occupied arm is gone
    const visited = u8(mem8[SWEEP_INDEX] + 1);
    mem8[SWEEP_INDEX] = visited;
    if (visited === OBJECT_COUNT) return;
  }
}

/** Sweep a twin over the crafted spaces; return the first contract mismatch. */
function sweepForMismatch(base, twin) {
  for (let pattern = 0; pattern < 32; pattern++) {
    const entry = seedEntry(withObjectStub(base, markerStub), pattern);
    const diffs = contractDiffs(entry, twin);
    if (diffs.length) return { where: `occupancy pattern ${pattern}`, diffs };
  }
  const steered = seedEntry(withObjectStub(base, steeringStub), 0x1f);
  const diffs = contractDiffs(steered, twin);
  if (diffs.length) return { where: "steering stub, every record occupied", diffs };
  return null;
}

for (const [label, twin] of [
  ["local-pointer", brokenLocalPointer],
  ["post-increment", brokenPostIncrement],
  ["local-index", brokenLocalIndex],
  ["no-object-call", brokenNoObjectCall],
]) {
  test(`TEETH: the ${label} twin is CAUGHT`, () => {
    const base = attractBase();
    const mm = sweepForMismatch(base, twin);
    assert.notEqual(mm, null, `the crafted sweeps FAILED to catch the ${label} twin — they are worthless`);
    console.log(`  TEETH/${label}: caught at ${mm.where} — ${mm.diffs.join("; ")}`);
  });
}
