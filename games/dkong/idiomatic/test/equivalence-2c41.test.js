// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2c41 (ROM 0x2C41) — head of the bonus-event slot-claim cluster.
 *
 * loc_2c41 stirs the once-per-vblank random seed (stirRandomSeed / ROM 0x0057) and reads its low
 * nibble as a 1-in-16 coin flip: a NONZERO nibble routes to the mode-3 entry loc_2c86 (which clears
 * BARREL_CLAIM_MODE up front), a ZERO nibble to the mode-1 entry loc_2c49. Both entries record
 * the mode value into BARREL_CLAIM_MODE and, only when BONUS_EVENT_MARK equals the caller's bonus value,
 * step that mark down by 8 and claim the first free OBJ_ARRAY_64 slot — raising bit 7 to
 * 0x81 on the mode-1 arm (mode byte 1 | top bit) and 0x80 on the mode-3 arm (cleared, then | top bit).
 * The bonus value is a register live-in the callees read at the still-translated cluster boundary; the
 * head just selects the arm and touches no named work RAM itself. Live-out is memory-only.
 *
 * The oracle brackets its `call 0x0057` with ONE push (the return address 0x2c44); the rest of the
 * subtree is tail-jumps and pop-only `ret`s, so that single push is the only stack WRITE. The
 * candidate direct-calls stirRandomSeed (no push), so the compared memory matches the oracle's on
 * every live cell once the dead STACK_SCRATCH [0x6be0,0x6c00) is excluded (the memory-equivalence
 * contract for a dissolved push). Real dispatch SP sits at 0x6bec/0x6bee, so the oracle's push lands
 * inside STACK_SCRATCH; the crafted SAFE_SP=0x6bf8 keeps it there too.
 *
 *   1. EQUAL — loc_2c41 == oracle on RAM − the stack scratch below the entry SP across:
 *        SEED-SWEEP (exhaustive) — all 256 stirred-seed bytes with a pre-dirtied BARREL_CLAIM_MODE and a
 *          fixed mark != bonus, so the gate is closed for every seed; isolates the low-nibble branch
 *          selection and the delegated scratch writes on both arms (mode-1 vs mode-3).
 *        SLOT-SWEEP (crafted) — the gate OPEN (mark == bonus) with the seed nibble forced to 0 and to
 *          nonzero, over every first-free-slot position (records 0..4) and the all-occupied case,
 *          proving the claim tags 0x6382 with 0x81 (mode-1 arm) / 0x80 (mode-3 arm) only on a claim.
 *      Plus a non-vacuity block asserting the stir / branch / stash / step / claim really happened.
 *
 *   2. TEETH — three deliberately-broken twins the same sweep MUST catch:
 *        (a) inverted branch — swaps the two arms; caught at 0x6382 (mode-1 sets 1, mode-3 clears 0).
 *        (b) dropped stir — skips stirRandomSeed; caught at RANDOM (0x6018), which the oracle stirs.
 *        (c) dropped nibble mask — branches on the whole seed; caught at 0x6382 on seed 0x10 (nibble
 *            0 but nonzero, so the mask decides the arm).
 *
 *   3. REALISM (captured dispatches) — hook 0x2C41 in a real attract run, clone at each true
 *      dispatch, and confirm loc_2c41 reproduces the oracle's RAM on every real state the game
 *      produces (all land on the nonzero/mode-3 arm — the zero arm is the rare 1-in-16).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2c41.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c41 as oracle } from "../../translated/loc_2c41.js";
import { loc_2c41 } from "../loc_2c41.js";
import { stirRandomSeed } from "../stirRandomSeed.js"; // ROM 0x0057
import { loc_2c86 } from "../loc_2c86.js"; // ROM 0x2C86
import { loc_2c49 } from "../loc_2c49.js"; // ROM 0x2C49
import { RANDOM, FRAME, SPIN_COUNT, BONUS_EVENT_MARK, OBJ_ARRAY_64, STACK_SCRATCH, BARREL_CLAIM_MODE } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2c41;
const SCRATCH_MODE = 0x638f; // the shared body stashes the (possibly +1'd) mode byte here
const SCRATCH_FLAG = 0x6392; // the shared body raises this to 1 on every entry
const STRIDE = 32; // OBJ_ARRAY_64 record stride
const RECORDS = 5;
const EVENT_STEP = 8;
const DIRTY = 0x55; // a non-zero BARREL_CLAIM_MODE seeded in, to expose the mode-3 arm's up-front clear
// FRAME held NONZERO so the stir genuinely moves RANDOM (RANDOM_in = seed − FRAME, RANDOM_out = seed);
// that is what lets the dropped-stir twin be caught at RANDOM rather than only via the wrong arm.
const FRAME_FIX = 3;
// The oracle's terminal `ret`s pop the stack; point SP at work RAM so those pops read valid bytes and
// its one push (the `call 0x0057` return address) lands inside STACK_SCRATCH — dead scratch either way.
const SAFE_SP = 0x6bf8;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const OCCUPIED = [1, 2, 3, 4, 5]; // all non-zero -> no free slot

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the
 * memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
 */
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

/**
 * A synthetic 0x2C41 entry: a clone of `base` with the two frame counters pinned so the stirred seed
 * resolves to `seedByte`, the bonus register live-in, the event mark, the five OBJ_ARRAY_64 active
 * bytes, and pre-dirtied request/mode/flag scratch, plus a safe stack. The incoming accumulator is
 * NOISE (the head stirs first, so it must be ignored). Frame machinery is neutralised so the oracle's
 * `m.step`/`m.ret` can't fire an NMI or push a frame.
 */
function makeEntry(base, { seedByte, c, mark, records = OCCUPIED, req = DIRTY }) {
  const e = base.clone();
  e.mem.write8(FRAME, FRAME_FIX);
  e.mem.write8(SPIN_COUNT, 0);
  e.mem.write8(RANDOM, (seedByte - FRAME_FIX) & 0xff); // stir -> (RANDOM + FRAME + SPIN) & 0xff == seedByte
  e.regs.a = 0xa5; // noise: the head stirs first, so the incoming accumulator must be ignored
  e.regs.c = c; // the caller's bonus live-in
  e.mem.write8(BONUS_EVENT_MARK, mark);
  for (let i = 0; i < RECORDS; i++) e.mem.write8(OBJ_ARRAY_64 + i * STRIDE, records[i]);
  e.mem.write8(BARREL_CLAIM_MODE, req);
  e.mem.write8(SCRATCH_MODE, 0xee); // noise: the shared body rewrites it
  e.mem.write8(SCRATCH_FLAG, 0xee); // noise: the shared body rewrites it
  e.regs.sp = SAFE_SP;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

/**
 * Run the oracle and the candidate on two FRESH, byte-identical entries and diff the
 * memory-equivalence contract (RAM − the stack scratch below the entry SP). Both read their inputs from the same registers/
 * memory, so both are called with just the machine.
 */
function runPair(base, opts, candidate) {
  const a = makeEntry(base, opts); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(base, opts); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiff(a, b, aFloor);
}

// Seeds that force each arm: low nibble 0 -> mode-1 (loc_2c49), nonzero -> mode-3 (loc_2c86).
const ARM_SEEDS = [0x00, 0x10, 0x01, 0x0f, 0xff];
// Gate-open slot scenarios: every first-free-slot position, plus all-occupied.
const SLOT_CASES = [
  { name: "slot@0", records: [0, 1, 1, 1, 1] },
  { name: "slot@1", records: [1, 0, 1, 1, 1] },
  { name: "slot@2", records: [1, 1, 0, 1, 1] },
  { name: "slot@3", records: [1, 1, 1, 0, 1] },
  { name: "slot@4", records: [1, 1, 1, 1, 0] },
  { name: "no-free", records: OCCUPIED },
];
const SLOT_MARKS = [0x50, 0x08, 0x40]; // includes 0x08, whose −8 step wraps to 0x00

/**
 * Both regimes in one pass: the exhaustive gate-closed SEED-sweep (branch + delegated writes on both
 * arms), then the crafted gate-open SLOT cross-product on both arms. Returns the first mismatch (or
 * null) + the number of comparisons.
 */
function fullSweep(base, candidate) {
  let count = 0;

  // SEED-SWEEP — all 256 stirred seeds, gate closed (mark 0x80 != bonus 0x33), pre-dirtied flag.
  for (let s = 0; s < 256; s++) {
    const ram = runPair(base, { seedByte: s, c: 0x33, mark: 0x80, records: OCCUPIED, req: DIRTY }, candidate);
    count++;
    if (ram) return { mismatch: { where: `seed-sweep seed=${hx(s)}`, ram }, count };
  }

  // SLOT-SWEEP — gate OPEN (mark == bonus): both arms × every first-free position × several marks.
  for (const seedByte of ARM_SEEDS) {
    for (const sc of SLOT_CASES) {
      for (const mark of SLOT_MARKS) {
        const ram = runPair(base, { seedByte, c: mark, mark, records: sc.records, req: 0x7f }, candidate);
        count++;
        if (ram) return { mismatch: { where: `${sc.name} seed=${hx(seedByte)} mark=${hx(mark)}`, ram }, count };
      }
    }
  }

  return { mismatch: null, count };
}

const describe = (mm) =>
  mm && `at ${mm.where}: RAM diverges at 0x${(mm.ram.addr ?? 0).toString(16)} (${mm.ram.a}->${mm.ram.b})`;

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: loc_2c41 == oracle across the seed-sweep and every gate-open slot case", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = fullSweep(base, loc_2c41);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256 + ARM_SEEDS.length * SLOT_CASES.length * SLOT_MARKS.length, "must have compared the full sweep");

  // Non-vacuity: the writes really happened, on both sides.
  // (i) zero-nibble seed, gate closed -> mode-1 arm: 0x6382=1, 0x638F=2, 0x6392=1, mark kept, seed stirred.
  {
    const a = makeEntry(base, { seedByte: 0x00, c: 0x33, mark: 0x80, req: DIRTY });
    const b = makeEntry(base, { seedByte: 0x00, c: 0x33, mark: 0x80, req: DIRTY });
    oracle(a);
    loc_2c41(b);
    for (const mm of [a, b]) {
      assert.equal(mm.mem.read8(RANDOM), 0x00, "seed must be stirred to 0x00");
      assert.equal(mm.mem.read8(BARREL_CLAIM_MODE), 1, "mode-1 arm records mode byte 1 (no claim)");
      assert.equal(mm.mem.read8(SCRATCH_MODE), 2, "mode-1 arm stashes mode byte + 1 = 2");
      assert.equal(mm.mem.read8(SCRATCH_FLAG), 1, "entry flag must be raised");
      assert.equal(mm.mem.read8(BONUS_EVENT_MARK), 0x80, "gate closed -> mark unchanged");
    }
  }
  // (ii) nonzero-nibble seed, gate closed -> mode-3 arm: BARREL_CLAIM_MODE cleared to 0, 0x638F=3.
  {
    const a = makeEntry(base, { seedByte: 0x01, c: 0x33, mark: 0x80, req: DIRTY });
    const b = makeEntry(base, { seedByte: 0x01, c: 0x33, mark: 0x80, req: DIRTY });
    oracle(a);
    loc_2c41(b);
    for (const mm of [a, b]) {
      assert.equal(mm.mem.read8(RANDOM), 0x01, "seed must be stirred to 0x01");
      assert.equal(mm.mem.read8(BARREL_CLAIM_MODE), 0x00, "mode-3 arm clears BARREL_CLAIM_MODE to 0");
      assert.equal(mm.mem.read8(SCRATCH_MODE), 3, "mode-3 arm stashes mode byte 3");
      assert.equal(mm.mem.read8(SCRATCH_FLAG), 1, "entry flag must be raised");
    }
  }
  // (iii) zero-nibble seed, gate open, slot free -> mode-1 claim: 0x6382 = 0x81, mark stepped by 8.
  {
    const a = makeEntry(base, { seedByte: 0x00, c: 0x40, mark: 0x40, records: [1, 0, 1, 1, 1], req: 0x7f });
    const b = makeEntry(base, { seedByte: 0x00, c: 0x40, mark: 0x40, records: [1, 0, 1, 1, 1], req: 0x7f });
    oracle(a);
    loc_2c41(b);
    for (const mm of [a, b]) {
      assert.equal(mm.mem.read8(BARREL_CLAIM_MODE), 0x81, "mode-1 claim -> mode byte 1 | top bit = 0x81");
      assert.equal(mm.mem.read8(BONUS_EVENT_MARK), 0x40 - EVENT_STEP, "mark must step down by 8");
    }
  }
  // (iv) nonzero-nibble seed, gate open, slot free -> mode-3 claim: 0x6382 = 0x80 (cleared then top bit).
  {
    const a = makeEntry(base, { seedByte: 0x01, c: 0x40, mark: 0x40, records: [1, 0, 1, 1, 1], req: 0x7f });
    const b = makeEntry(base, { seedByte: 0x01, c: 0x40, mark: 0x40, records: [1, 0, 1, 1, 1], req: 0x7f });
    oracle(a);
    loc_2c41(b);
    for (const mm of [a, b]) {
      assert.equal(mm.mem.read8(BARREL_CLAIM_MODE), 0x80, "mode-3 claim -> cleared then top bit set = 0x80");
      assert.equal(mm.mem.read8(BONUS_EVENT_MARK), 0x40 - EVENT_STEP, "mark must step down by 8");
    }
  }
  console.log(`  EQUAL: ${count} combos (256 seed-sweep + gate-open slot cross-product) — RAM identical to the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** BUG (a): swaps the two arms — caught at 0x6382 (mode-1 sets 1, mode-3 clears 0). */
function brokenInverted(m) {
  const { regs } = m;
  stirRandomSeed(m);
  if ((regs.a & 0x0f) !== 0) loc_2c49(m); // BUG: arms inverted
  else loc_2c86(m);
}

/** BUG (b): skips the seed stir — caught at RANDOM (0x6018), which the oracle always stirs. */
function brokenNoStir(m) {
  const { regs } = m;
  // BUG: no stirRandomSeed(m) here.
  if ((regs.a & 0x0f) !== 0) loc_2c86(m);
  else loc_2c49(m);
}

/** BUG (c): branches on the whole seed, dropping the low-nibble mask — caught at 0x6382 on seed 0x10. */
function brokenNoMask(m) {
  const { regs } = m;
  stirRandomSeed(m);
  if (regs.a !== 0) loc_2c86(m); // BUG: no `& 0x0f`
  else loc_2c49(m);
}

test("TEETH: the inverted-branch twin is CAUGHT (0x6382 diverges)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenInverted);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an inverted branch — worthless");
  assert.equal(mismatch.ram.addr, BARREL_CLAIM_MODE, "the inverted-branch twin must diverge on 0x6382");
  console.log(`  TEETH/inverted: caught — ${describe(mismatch)}`);
});

test("TEETH: the dropped-stir twin is CAUGHT (RANDOM diverges)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenNoStir);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped stir — worthless");
  assert.equal(mismatch.ram.addr, RANDOM, "the dropped-stir twin must diverge on RANDOM (0x6018)");
  console.log(`  TEETH/no-stir: caught — ${describe(mismatch)}`);
});

test("TEETH: the dropped-nibble-mask twin is CAUGHT (0x6382 diverges)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenNoMask);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped nibble mask — worthless");
  assert.equal(mismatch.ram.addr, BARREL_CLAIM_MODE, "the dropped-mask twin must diverge on 0x6382");
  console.log(`  TEETH/no-mask: caught — ${describe(mismatch)}`);
});

// -- 3. REALISM (captured dispatches) -----------------------------------------

/**
 * Hook 0x2C41 in a real attract run and clone the machine at each real dispatch. The wrapper clones
 * the entry state, then runs the oracle so the host game proceeds undisturbed.
 */
function captureDispatches(K, maxFrames) {
  const real = new Machine(ROM).routines.get(TARGET); // the frozen oracle, from a fresh registry
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return real(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

test("REALISM: real captured 0x2C41 dispatches — loc_2c41 matches oracle RAM", () => {
  const caps = captureDispatches(64, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2C41 dispatch during attract");

  let sawMode3 = 0, sawMode1 = 0, sawGateOpen = 0;
  for (const cap of caps) {
    const a = cap.clone(); // oracle
    const b = cap.clone(); // candidate
    a.nextNmi = Infinity; a.nextBoundary = Infinity;
    b.nextNmi = Infinity; b.nextBoundary = Infinity;
    // Classify the arm the head will take (stirred seed's low nibble) for reporting.
    const seed = (a.mem.read8(RANDOM) + a.mem.read8(FRAME) + a.mem.read8(SPIN_COUNT)) & 0xff;
    if ((seed & 0x0f) !== 0) sawMode3++; else sawMode1++;
    if (a.regs.c === a.mem.read8(BONUS_EVENT_MARK)) sawGateOpen++;
    oracle(a);
    loc_2c41(b);
    const ram = firstRamDiff(a, b, cap.regs.sp);
    assert.equal(
      ram,
      null,
      ram && `RAM diverges on real dispatch at 0x${(ram.addr ?? 0).toString(16)} (${ram.a}->${ram.b})`,
    );
  }
  console.log(`  REALISM: ${caps.length} real 0x2C41 dispatches — RAM == oracle (${sawMode3} mode-3, ${sawMode1} mode-1, ${sawGateOpen} gate-open)`);
});
