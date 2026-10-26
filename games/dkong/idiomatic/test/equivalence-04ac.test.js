// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for storeBlinkSpriteCode (ROM 0x04ac) — the blink driver's shared
 * store tail: commit sprite record #1's code byte 0x6905, with a phase-gated low-2-bit
 * tile toggle.
 *
 * loc_04ac reads ONLY two register bytes — A (the code to store) and C (the colour-cycle
 * counter) — and writes ONLY one RAM byte, 0x6905. So the byte it leaves at 0x6905 is a
 * PURE TOTAL FUNCTION of (A, C), and it is validated the strongest way that allows —
 * EXHAUSTIVELY against the frozen oracle — plus real dispatches and crafted arms:
 *
 *   1. EQUAL (exhaustive) — storeBlinkSpriteCode's 0x6905 == oracle's over all 65,536
 *      (A, C) combos. Because the routine reads no memory and its one write (0x6905) is
 *      never read back, a single reused clone is sufficient and faithful (the oracle's
 *      result depends only on the A/C set each iteration; SP is reset so its `ret` pop
 *      stays in mapped RAM) — the same licence the pure-leaf exemplar uses, backed by
 *      the PURITY check in step 3 which proves the write footprint is exactly {0x6905}.
 *
 *   2. TEETH (exhaustive) — a deliberately-broken twin (drops the low-3-bits-clear half
 *      of the phase gate, toggling whenever bit 6 is set) MUST be caught by the sweep.
 *
 *   3. REALISM + PURITY (captured dispatches) — hook 0x04ac in a real attract run and
 *      clone the machine at each true dispatch (attract exercises BOTH the plain-store
 *      arm and, ~32×, the toggle arm). For each: (a) PURITY — the oracle on a fresh
 *      clone writes NO RAM outside 0x6905 (licensing the (A,C)->0x6905 model), and
 *      (b) REALISM — a fresh-clone whole-machine RAM diff (minus the stack scratch below the entry SP) between
 *      oracle and candidate is empty.
 *
 *   4. CRAFTED (toggle arm) — force C onto the toggle phase over a real captured base
 *      and a curated A set, fresh clone per side: the whole-machine diff is empty AND
 *      the oracle genuinely produced A ^ 0x03, proving the toggle path is exercised.
 *
 * Never the full register file, never cycles.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-04ac.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04ac as oracle } from "../../translated/loc_04ac.js";
import { storeBlinkSpriteCode } from "../storeBlinkSpriteCode.js";
import { Machine } from "../../machine.js";
import { SPRITE_BUFFER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x04ac;
const SPRITE1_CODE = SPRITE_BUFFER + 5; // 0x6905 — record #1's code byte

// A valid stack-scratch SP so the oracle's terminal `ret` pops mapped bytes (pop reads
// [SP],[SP+1] then SP += 2; 0x6BFE keeps both < 0x6C00). It lives in STACK_SCRATCH, which
// the RAM diff excludes, and is set identically on both sides.
const SAFE_SP = 0x6bfe;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- value-level runners (exhaustive gate) ------------------------------------

/**
 * Run the frozen oracle for one (a,c) on a REUSED clone and return the byte it left at
 * 0x6905. Reuse is faithful here: the oracle reads no memory and never reads 0x6905
 * back, so its result depends only on the A/C set this call; SP is reset each call so
 * the `ret` pop never drifts out of RAM. (Step 3's PURITY check proves the {0x6905}
 * footprint that licenses this.)
 */
function runOracleStored(m, a, c) {
  const { regs, mem } = m;
  regs.a = a;
  regs.c = c;
  regs.sp = SAFE_SP;
  oracle(m);
  return mem.read8(SPRITE1_CODE) & 0xff;
}

/** Same, for the candidate (m)-routine. */
function runCandStored(m, a, c) {
  const { regs, mem } = m;
  regs.a = a;
  regs.c = c;
  regs.sp = SAFE_SP;
  storeBlinkSpriteCode(m);
  return mem.read8(SPRITE1_CODE) & 0xff;
}

/** Compare a candidate runner against the oracle over the full 256x256 (a,c) grid. */
function sweep(candRunner) {
  const m = new Machine(ROM).clone(); // frame machinery neutralised (nextNmi/boundary = Infinity)
  let count = 0;
  for (let a = 0; a < 256; a++) {
    for (let c = 0; c < 256; c++) {
      const want = runOracleStored(m, a, c);
      const got = candRunner(m, a, c);
      count++;
      if (got !== want) return { mismatch: { a, c, want, got }, count };
    }
  }
  return { mismatch: null, count };
}

// -- whole-machine plumbing (realism / crafted gates) -------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
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
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing
 * routine demands a fresh clone per side) and diff RAM outside the dead stack.
 */
function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/** Every RAM addr (outside the stack scratch below the entry SP) whose byte the oracle changed on `entry`. */
function oracleWriteFootprint(entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const m = entry.clone();
  const before = m.dumpState();
  oracle(m);
  const after = m.dumpState();
  const addrs = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const addr = m.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    addrs.push(addr);
  }
  return addrs;
}

/**
 * Hook 0x04ac in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): storeBlinkSpriteCode's 0x6905 == oracle over all 65,536 (a,c) combos", () => {
  const { mismatch, count } = sweep(runCandStored);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at a=${hb(mismatch.a)} c=${hb(mismatch.c)}: oracle=${hb(mismatch.want)} cand=${hb(mismatch.got)}`,
  );
  assert.equal(count, 256 * 256, "must have compared the full 65,536-combo grid");
  console.log(`  EQUAL/exhaustive: ${count} (a,c) combos — 0x6905 identical to the oracle`);
});

// -- 2. TEETH (exhaustive) ----------------------------------------------------

/**
 * Broken twin: drops the low-3-bits-clear half of the phase gate, toggling the code's
 * low bits whenever bit 6 of the counter is set. It agrees with the oracle on every
 * plain-store input and on the true toggle phase, so only a real sweep catches it —
 * it bites on any C with bit 6 set but a non-zero low nibble (e.g. C == 0x41).
 */
function brokenStore(m) {
  const { regs, mem } = m;
  const code = regs.a;
  const counter = regs.c;
  const advanceTile = (counter & 0x40) !== 0; // BUG: dropped the `&& (counter & 7) === 0`
  mem.write8(SPRITE1_CODE, advanceTile ? code ^ 0x03 : code);
}
function runBrokenStored(m, a, c) {
  const { regs, mem } = m;
  regs.a = a;
  regs.c = c;
  regs.sp = SAFE_SP;
  brokenStore(m);
  return mem.read8(SPRITE1_CODE) & 0xff;
}

test("TEETH (exhaustive): the dropped-phase-gate twin is CAUGHT by the sweep", () => {
  const { mismatch, count } = sweep(runBrokenStored);
  assert.notEqual(mismatch, null, "the exhaustive sweep FAILED to catch a broken phase gate — it is worthless");
  console.log(
    `  TEETH/exhaustive: caught after ${count} combos at a=${hb(mismatch.a)} c=${hb(mismatch.c)} ` +
      `(oracle=${hb(mismatch.want)} broken=${hb(mismatch.got)})`,
  );
});

// -- 3. REALISM + PURITY (captured dispatches) --------------------------------

test("REALISM + PURITY: real captured attract dispatches — oracle writes only 0x6905, candidate matches whole-machine", () => {
  const caps = captureDispatches(4000, 3000); // capture every dispatch so the sparse toggle arm is included
  assert.ok(caps.length >= 1, "expected at least one real 0x04ac dispatch during attract");

  let toggleArmSeen = 0;
  for (const cap of caps) {
    // PURITY: the oracle's write footprint on this real state is a subset of {0x6905}.
    const footprint = oracleWriteFootprint(cap);
    for (const addr of footprint) {
      assert.equal(
        addr,
        SPRITE1_CODE,
        `oracle wrote RAM at ${hx(addr)} (not 0x6905) — the pure (A,C)->0x6905 model is not licensed`,
      );
    }

    // Track whether this real state exercised the toggle arm (0x6905 <- A ^ 0x03).
    if ((cap.regs.c & 0x47) === 0x40) toggleArmSeen++;

    // REALISM: fresh-clone whole-machine RAM diff (minus dead stack) is empty.
    const ram = diffAgainstOracle(cap, storeBlinkSpriteCode);
    assert.equal(
      ram,
      null,
      ram && `whole-machine mismatch on real dispatch (a=${hb(cap.regs.a)} c=${hb(cap.regs.c)}) ` +
        `at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`,
    );
  }
  assert.ok(
    toggleArmSeen >= 1,
    "expected the sparse toggle arm ((C & 0x47) == 0x40) to occur among the real dispatches",
  );
  console.log(
    `  REALISM/purity: ${caps.length} real dispatches — footprint == {0x6905}, whole-machine identical ` +
      `(${toggleArmSeen} on the toggle arm)`,
  );
});

// -- 4. CRAFTED (toggle arm) --------------------------------------------------

test("CRAFTED: forced toggle-phase entries match whole-machine AND genuinely produce A ^ 0x03", () => {
  const caps = captureDispatches(4, 3000);
  assert.ok(caps.length >= 1, "expected a real dispatch to use as a crafted base");
  const base = caps[0];

  // Toggle phases: bit 6 set, low 3 bits clear ((C & 0x47) == 0x40); the don't-care bits
  // (3,4,5,7) are varied to confirm they are ignored. A samples cover low-bit patterns.
  const CS = [0x40, 0x48, 0x50, 0x60, 0x78, 0xc0, 0xf8];
  const AS = [0x00, 0x01, 0x02, 0x03, 0x10, 0x88, 0xef, 0xff];

  let cases = 0;
  for (const c of CS) {
    assert.equal((c & 0x47) === 0x40, true, `test bug: ${hb(c)} is not a toggle phase`);
    for (const a of AS) {
      const entry = base.clone();
      entry.regs.a = a;
      entry.regs.c = c;
      entry.regs.sp = SAFE_SP;

      // The oracle must actually take the toggle arm here: 0x6905 <- A ^ 0x03.
      const oc = entry.clone();
      oracle(oc);
      assert.equal(
        oc.mem.read8(SPRITE1_CODE) & 0xff,
        (a ^ 0x03) & 0xff,
        `toggle arm not exercised for a=${hb(a)} c=${hb(c)}`,
      );

      // And the candidate reproduces the whole machine.
      const ram = diffAgainstOracle(entry, storeBlinkSpriteCode);
      assert.equal(
        ram,
        null,
        ram && `crafted toggle mismatch (a=${hb(a)} c=${hb(c)}) at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`,
      );
      cases++;
    }
  }
  console.log(`  CRAFTED: ${cases} forced toggle-phase entries — candidate matches and the toggle arm fired`);
});
