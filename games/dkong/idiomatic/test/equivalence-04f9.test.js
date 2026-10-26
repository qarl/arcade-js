// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for blinkSpritePairOff (ROM 0x04f9) — the blink driver's "blink OFF"
 * arm: force bit 7 clear on the two decorative-sprite code bytes 0x6901 and 0x6905,
 * committing 0x6901 directly and 0x6905 through the shared store tail (0x04ac).
 *
 * loc_04f9 reads only two RAM bytes (0x6901, 0x6905) and one register (C, the
 * colour-cycle counter, consumed inside the store tail), and writes only those two
 * bytes. So the pair it leaves at {0x6901, 0x6905} is a PURE TOTAL FUNCTION of
 * (v1 = mem[0x6901], v5 = mem[0x6905], C). It is validated the strongest way that
 * allows — EXHAUSTIVELY against the frozen oracle — plus crafted whole-machine entries,
 * because loc_04f9 is NOT reached in attract (0 dispatches / 6000 frames: it is the OFF
 * phase, taken on the 100m rivet board and specific colour paths). Never the full
 * register file, never cycles.
 *
 *   1. EQUAL (exhaustive) — blinkSpritePairOff's (0x6901, 0x6905) == oracle's over the
 *      full 256x256 (v1, v5) grid for BOTH store arms: a non-toggle C (0x00) and a
 *      toggle-phase C (0x40, (C & 0x47) == 0x40). 131,072 combos. A single reused clone
 *      is faithful: the oracle reads only 0x6901/0x6905 (RE-set every call) and never
 *      reads its own writes back, so nothing accumulates; SP is reset each call so the
 *      tail's `ret` pop stays in mapped RAM. The {0x6901, 0x6905} write footprint that
 *      licenses this is PROVEN on real states in step 4.
 *
 *   2. EQUAL (C breadth) — because "only (C & 0x47) matters" must be proven, not
 *      assumed: sweep ALL 256 C bytes over a curated (v1, v5) edge set, each vs the
 *      oracle. Confirms C bits 3,4,5,7 are don't-cares and no C beyond the toggle phase
 *      changes the stored byte.
 *
 *   3. TEETH (exhaustive) — a deliberately-broken twin (drops the `& 0x7f` mask on
 *      record 1, passing v5 straight to the store) MUST be caught by the (v1, v5) sweep.
 *
 *   4. CRAFTED + PURITY (real attract bases) — loc_04f9 is unreached in attract, so hook
 *      the store tail 0x04ac (which IS reached ~1500x/attract) to capture real, in-
 *      distribution machine states, then craft loc_04f9 entries on them: set
 *      (0x6901, 0x6905, C) over a matrix covering bit-7 set/clear and both arms, fresh
 *      clone per side. For each: (a) PURITY — the oracle's write footprint is a subset
 *      of {0x6901, 0x6905}; (b) the oracle genuinely clears bit 7 of 0x6901 and, on the
 *      toggle phase, produces (v5 & 0x7f) ^ 0x03 at 0x6905 (arms exercised); and (c) a
 *      fresh-clone whole-machine RAM diff (minus the stack scratch below the entry SP) between oracle and
 *      candidate is empty.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-04f9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04f9 as oracle } from "../../translated/loc_04f9.js";
import { loc_04ac as oracle04ac } from "../../translated/loc_04ac.js";
import { blinkSpritePairOff } from "../blinkSpritePairOff.js";
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

// The store tail 0x04ac IS reached in attract; loc_04f9 (the OFF arm feeding it) is not.
// So we capture realistic bases at 0x04ac and craft loc_04f9 entries on them.
const CAPTURE_TARGET = 0x04ac;
const SPRITE0_CODE = SPRITE_BUFFER + 1; // 0x6901 — record #0's code byte
const SPRITE1_CODE = SPRITE_BUFFER + 5; // 0x6905 — record #1's code byte

// A valid stack-scratch SP so the oracle's terminal `ret` (in the 0x04ac tail) pops
// mapped bytes. It lives in STACK_SCRATCH, which the RAM diff excludes, and is set
// identically on both sides.
const SAFE_SP = 0x6bfe;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- value-level runners (exhaustive gate) ------------------------------------

/**
 * Run the frozen oracle for one (v1, v5, c) on a REUSED clone and return the pair it
 * leaves at (0x6901, 0x6905). Reuse is faithful: the oracle reads only these two bytes
 * (RE-set here every call) and never reads its own writes back, so its result depends
 * only on the inputs set this call; SP is reset so the tail's `ret` pop never drifts out
 * of RAM. (Step 4's PURITY check proves the {0x6901, 0x6905} footprint that licenses it.)
 */
function runOracleOut(m, v1, v5, c) {
  const { regs, mem } = m;
  mem.write8(SPRITE0_CODE, v1);
  mem.write8(SPRITE1_CODE, v5);
  regs.c = c;
  regs.sp = SAFE_SP;
  oracle(m);
  return { b1: mem.read8(SPRITE0_CODE) & 0xff, b5: mem.read8(SPRITE1_CODE) & 0xff };
}

/** Same, for a candidate (m)-routine. */
function runCandOut(cand, m, v1, v5, c) {
  const { regs, mem } = m;
  mem.write8(SPRITE0_CODE, v1);
  mem.write8(SPRITE1_CODE, v5);
  regs.c = c;
  regs.sp = SAFE_SP;
  cand(m);
  return { b1: mem.read8(SPRITE0_CODE) & 0xff, b5: mem.read8(SPRITE1_CODE) & 0xff };
}

/** Compare a candidate against the oracle over the full 256x256 (v1, v5) grid for each c. */
function sweepGrid(cand, cs) {
  const m = new Machine(ROM).clone(); // frame machinery neutralised (nextNmi/boundary = Infinity)
  let count = 0;
  for (const c of cs) {
    for (let v1 = 0; v1 < 256; v1++) {
      for (let v5 = 0; v5 < 256; v5++) {
        const want = runOracleOut(m, v1, v5, c);
        const got = runCandOut(cand, m, v1, v5, c);
        count++;
        if (got.b1 !== want.b1 || got.b5 !== want.b5) {
          return { mismatch: { v1, v5, c, want, got }, count };
        }
      }
    }
  }
  return { mismatch: null, count };
}

// -- whole-machine plumbing (crafted gate) ------------------------------------

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
 * Hook 0x04ac in a real attract run and clone the machine at up to K real dispatches —
 * realistic bases whose sprite buffer and colour-cycle counter are genuine in-play
 * states. The wrapper clones the entry state, then runs the oracle so the host game
 * proceeds undisturbed to a clean stop.
 */
function captureBases(K, maxFrames) {
  const caps = [];
  // Snapshot each real dispatch, then run the store tail's oracle DIRECTLY (not via the
  // now-overridden registry) so the host game proceeds undisturbed and self-recursion
  // is avoided.
  const overrides = new Map([[CAPTURE_TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle04ac(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): blinkSpritePairOff's (0x6901,0x6905) == oracle over 131,072 (v1,v5,arm) combos", () => {
  const { mismatch, count } = sweepGrid(blinkSpritePairOff, [0x00, 0x40]); // non-toggle + toggle arm
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at v1=${hb(mismatch.v1)} v5=${hb(mismatch.v5)} c=${hb(mismatch.c)}: ` +
        `oracle=(${hb(mismatch.want.b1)},${hb(mismatch.want.b5)}) ` +
        `cand=(${hb(mismatch.got.b1)},${hb(mismatch.got.b5)})`,
  );
  assert.equal(count, 256 * 256 * 2, "must have compared the full 131,072-combo grid");
  console.log(`  EQUAL/exhaustive: ${count} (v1,v5,arm) combos — (0x6901,0x6905) identical to the oracle`);
});

// -- 2. EQUAL (C breadth) -----------------------------------------------------

test("EQUAL (C breadth): all 256 C bytes match the oracle on curated (v1,v5) edges", () => {
  const V1S = [0x00, 0x01, 0x7f, 0x80, 0xef, 0xff];
  const V5S = [0x00, 0x01, 0x02, 0x03, 0x7c, 0x7f, 0x80, 0x83, 0xff];

  const m = new Machine(ROM).clone();
  let count = 0;
  let mismatch = null;
  for (let c = 0; c < 256 && !mismatch; c++) {
    for (const v1 of V1S) {
      for (const v5 of V5S) {
        const want = runOracleOut(m, v1, v5, c);
        const got = runCandOut(blinkSpritePairOff, m, v1, v5, c);
        count++;
        if (got.b1 !== want.b1 || got.b5 !== want.b5) {
          mismatch = { v1, v5, c, want, got };
          break;
        }
      }
      if (mismatch) break;
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at v1=${hb(mismatch.v1)} v5=${hb(mismatch.v5)} c=${hb(mismatch.c)}: ` +
        `oracle=(${hb(mismatch.want.b1)},${hb(mismatch.want.b5)}) ` +
        `cand=(${hb(mismatch.got.b1)},${hb(mismatch.got.b5)})`,
  );
  console.log(`  EQUAL/C-breadth: ${count} combos over all 256 C values identical to the oracle`);
});

// -- 3. TEETH (exhaustive) ----------------------------------------------------

/**
 * Broken twin: drops the `& 0x7f` mask on record 1, handing v5 straight to the store.
 * It agrees with the oracle on every v5 with bit 7 already clear, so only a real sweep
 * catches it — it bites the moment v5 has bit 7 set (e.g. v5 == 0x80).
 */
function brokenBlinkOff(m) {
  const { regs, mem } = m;
  mem.write8(SPRITE0_CODE, mem.read8(SPRITE0_CODE) & 0x7f);
  regs.a = mem.read8(SPRITE1_CODE); // BUG: dropped the `& 0x7f` on record 1
  // Real store tail, so the twin exercises the identical downstream code — isolating
  // THIS routine's dropped-mask bug rather than any store difference.
  storeBlinkSpriteCode(m);
}

test("TEETH (exhaustive): the dropped-mask twin is CAUGHT by the (v1,v5) sweep", () => {
  const { mismatch, count } = sweepGrid(brokenBlinkOff, [0x00, 0x40]);
  assert.notEqual(mismatch, null, "the exhaustive sweep FAILED to catch a dropped record-1 mask — it is worthless");
  console.log(
    `  TEETH/exhaustive: caught after ${count} combos at v1=${hb(mismatch.v1)} v5=${hb(mismatch.v5)} ` +
      `c=${hb(mismatch.c)} (oracle b5=${hb(mismatch.want.b5)} broken b5=${hb(mismatch.got.b5)})`,
  );
});

// -- 4. CRAFTED + PURITY (real attract bases) ---------------------------------

test("CRAFTED + PURITY: crafted loc_04f9 entries on real attract states — footprint ⊆ {0x6901,0x6905}, arms exercised, whole-machine identical", () => {
  const bases = captureBases(8, 3000);
  assert.ok(bases.length >= 1, "expected at least one real 0x04ac dispatch to use as a realistic base");

  const V1S = [0x00, 0x7f, 0x80, 0xff];
  const V5S = [0x00, 0x03, 0x7f, 0x80, 0x83, 0xff];
  const CS = [0x00, 0x21, 0x40, 0x48, 0xc0]; // non-toggle + several toggle-phase counters

  let cases = 0;
  let sawBit7Cleared = 0;
  let sawToggle = 0;
  for (const base of bases) {
    for (const c of CS) {
      for (const v1 of V1S) {
        for (const v5 of V5S) {
          const entry = base.clone();
          entry.mem.write8(SPRITE0_CODE, v1);
          entry.mem.write8(SPRITE1_CODE, v5);
          entry.regs.c = c;
          entry.regs.sp = SAFE_SP;

          // (a) PURITY: the oracle's write footprint on this real state ⊆ {0x6901, 0x6905}.
          for (const addr of oracleWriteFootprint(entry)) {
            assert.ok(
              addr === SPRITE0_CODE || addr === SPRITE1_CODE,
              `oracle wrote RAM at ${hx(addr)} (outside {0x6901,0x6905}) — pure model not licensed`,
            );
          }

          // (b) ARMS EXERCISED: bit 7 of 0x6901 is cleared; on the toggle phase 0x6905
          // becomes (v5 & 0x7f) ^ 0x03, else v5 & 0x7f.
          const oc = entry.clone();
          oracle(oc);
          assert.equal(oc.mem.read8(SPRITE0_CODE) & 0x80, 0, `blink bit not cleared on 0x6901 (v1=${hb(v1)})`);
          if (v1 & 0x80) sawBit7Cleared++;
          const toggle = (c & 0x47) === 0x40;
          const expect5 = (toggle ? ((v5 & 0x7f) ^ 0x03) : (v5 & 0x7f)) & 0xff;
          assert.equal(
            oc.mem.read8(SPRITE1_CODE) & 0xff,
            expect5,
            `0x6905 wrong (v5=${hb(v5)} c=${hb(c)}): want ${hb(expect5)}`,
          );
          if (toggle) sawToggle++;

          // (c) REALISM: fresh-clone whole-machine RAM diff (minus dead stack) is empty.
          const ram = diffAgainstOracle(entry, blinkSpritePairOff);
          assert.equal(
            ram,
            null,
            ram && `whole-machine mismatch (v1=${hb(v1)} v5=${hb(v5)} c=${hb(c)}) at ${hx(ram.addr)}: ` +
              `oracle=${ram.a} cand=${ram.b}`,
          );
          cases++;
        }
      }
    }
  }
  assert.ok(sawBit7Cleared >= 1, "expected at least one v1 with bit 7 set to be cleared (arm exercised)");
  assert.ok(sawToggle >= 1, "expected the store tail's toggle arm ((C & 0x47) == 0x40) to be exercised");
  console.log(
    `  CRAFTED/purity: ${cases} crafted entries on ${bases.length} real attract bases — ` +
      `footprint ⊆ {0x6901,0x6905}, whole-machine identical (${sawToggle} on the toggle arm)`,
  );
});
