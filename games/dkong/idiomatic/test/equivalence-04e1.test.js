// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for blinkSpritePairOn (ROM 0x04e1) — the colour-cycle blink driver's
 * "blink ON" arm: set bit 7 of BOTH decorative blink-sprite code bytes (0x6901 record #0
 * directly, 0x6905 record #1 via the shared store tail loc_04ac).
 *
 * loc_04e1 reads only 0x6901, 0x6905 and the sweep counter C, and writes only 0x6901 and
 * 0x6905. So the pair of bytes it leaves is a TOTAL function of (byte@0x6901, byte@0x6905,
 * C), and — crucially — the two outputs are INDEPENDENT: 0x6901' = in|0x80 (its own input
 * only), 0x6905' = store(in|0x80, C) (only 0x6905 and C; loc_04ac never touches 0x6901).
 * That lets the two dimensions be swept EXHAUSTIVELY and separately against the frozen
 * oracle, then backed by real whole-machine states:
 *
 *   1. EQUAL (exhaustive, 0x6905 dimension) — over all 65,536 (byte@0x6905, C) combos with
 *      0x6901 held at a sentinel: both output bytes match the oracle. Covers the store
 *      tail's plain-store AND once-per-sweep toggle phases and the bit-7 set on every code
 *      byte. On a REUSED clone, faithful because the routine re-sets every input each call
 *      and its write footprint is exactly {0x6901,0x6905} (proven in step 4) — the same
 *      licence the pure-leaf exemplars use.
 *
 *   2. EQUAL (exhaustive, 0x6901 dimension) — over all 256 byte@0x6901 values with 0x6905/C
 *      held: both output bytes match. Exhausts the record-#0 bit-set.
 *
 *   3. TEETH (exhaustive) — two deliberately-broken twins MUST be caught: (a) a wrong-bit
 *      twin (ORs 0x40 into 0x6905 instead of 0x80), caught by the 0x6905 sweep; (b) a
 *      skip-0x6901 twin (omits the record-#0 write), caught by the 0x6901 sweep.
 *
 *   4. REALISM + PURITY (crafted from real 0x04ac attract captures) — 0x04e1 itself needs
 *      the rivet board (0x6227==4), which attract never reaches, so realistic full-machine
 *      states come from hooking its shared store tail 0x04ac (dispatched every frame in
 *      attract): a genuine populated sprite buffer + staged C. For each: (a) PURITY — the
 *      oracle's write footprint ⊆ {0x6901,0x6905} (licenses the (bytes)->bytes model and
 *      the reused-clone sweeps); (b) REALISM — a FRESH-clone whole-machine RAM diff (minus
 *      STACK_SCRATCH) between oracle and candidate is empty.
 *
 *   5. CRAFTED (toggle arm) — force C onto the store tail's toggle phase ((C&0x47)==0x40)
 *      and 0x6905/0x6901 to bit-7-clear values over a real base, fresh clone per side: the
 *      whole-machine diff is empty AND the oracle genuinely produced 0x6905=((in|0x80)^3)
 *      and 0x6901=(in|0x80), proving both the bit-set and the toggle path are exercised.
 *
 * The oracle's tail is `m.call(0x04ac)`, which resolves through the machine's routine
 * registry — and a machine cloned from a capture carries that capture's 0x04ac override.
 * So every clone the ORACLE runs on has routines[0x04ac] forced back to the frozen oracle
 * loc_04ac, isolating the comparison to loc_04e1's own logic. The candidate calls the
 * idiomatic store tail directly, so it is unaffected. Never the full register file, never
 * cycles.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-04e1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04e1 as oracle } from "../../translated/loc_04e1.js";
import { loc_04ac as oracleTail } from "../../translated/loc_04ac.js";
import { blinkSpritePairOn } from "../blinkSpritePairOn.js";
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

const TARGET = 0x04e1;
const TAIL = 0x04ac;
const SPRITE0_CODE = SPRITE_BUFFER + 1; // 0x6901 — record #0's code byte
const SPRITE1_CODE = SPRITE_BUFFER + 5; // 0x6905 — record #1's code byte

// A valid stack-scratch SP so the oracle tail's terminal `ret` pops mapped bytes (pop
// reads [SP],[SP+1] then SP += 2; 0x6BFE keeps both < 0x6C00). It lives in STACK_SCRATCH,
// which the RAM diff excludes, and is set identically on both sides.
const SAFE_SP = 0x6bfe;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const R256 = Array.from({ length: 256 }, (_, i) => i);

/**
 * Force a machine's tail dispatch (0x04ac) back to the FROZEN oracle. Any clone taken
 * from a capture carries that capture's 0x04ac snapshot override; the oracle loc_04e1's
 * `m.call(0x04ac)` must reach the real oracle loc_04ac, not the capture wrapper.
 */
function installOracleTail(m) {
  m.routines.set(TAIL, oracleTail);
  return m;
}

// -- value-level runners (exhaustive gates) -----------------------------------

/**
 * Run the frozen oracle for one (byte@0x6901, byte@0x6905, C) on a REUSED clone and
 * return the two bytes it leaves at 0x6901/0x6905. Reuse is faithful: every input is
 * re-set each call and the footprint is exactly {0x6901,0x6905} (step 4 PURITY); SP is
 * reset so the tail's `ret` pop stays in mapped RAM.
 */
function runOracleBytes(m, b1, b5, c) {
  const { regs, mem } = m;
  mem.write8(SPRITE0_CODE, b1);
  mem.write8(SPRITE1_CODE, b5);
  regs.c = c;
  regs.sp = SAFE_SP;
  installOracleTail(m);
  oracle(m);
  return { s0: mem.read8(SPRITE0_CODE) & 0xff, s1: mem.read8(SPRITE1_CODE) & 0xff };
}

/** Same, for a candidate (m)-routine. */
function runCandBytes(cand, m, b1, b5, c) {
  const { regs, mem } = m;
  mem.write8(SPRITE0_CODE, b1);
  mem.write8(SPRITE1_CODE, b5);
  regs.c = c;
  regs.sp = SAFE_SP;
  cand(m);
  return { s0: mem.read8(SPRITE0_CODE) & 0xff, s1: mem.read8(SPRITE1_CODE) & 0xff };
}

/** Compare a candidate against the oracle over the b1 x b5 x c grid; first mismatch or null. */
function sweepBytes(cand, b1s, b5s, cs) {
  const m = new Machine(ROM).clone(); // frame machinery neutralised (nextNmi/boundary = Infinity)
  let count = 0;
  for (const b1 of b1s) {
    for (const b5 of b5s) {
      for (const c of cs) {
        const want = runOracleBytes(m, b1, b5, c);
        const got = runCandBytes(cand, m, b1, b5, c);
        count++;
        if (want.s0 !== got.s0 || want.s1 !== got.s1) {
          return { mismatch: { b1, b5, c, want, got }, count };
        }
      }
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
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing routine
 * demands a fresh clone per side) and diff RAM outside the dead stack. The oracle side has
 * its tail forced back to the frozen oracle loc_04ac.
 */
function diffAgainstOracle(entry, candidate) {
  const a = installOracleTail(entry.clone()); // oracle
  const aFloor = a.regs.sp;
  const b = entry.clone(); // candidate (calls the idiomatic tail directly)
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, aFloor);
}

/** Every RAM addr (outside the stack scratch below the entry SP) whose byte the oracle changed on `entry`. */
function oracleWriteFootprint(entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const m = installOracleTail(entry.clone());
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
 * Hook 0x04ac (the shared store tail, dispatched every frame in attract) and clone the
 * machine at up to K real dispatches — a genuine populated sprite buffer + staged C, used
 * as realistic loc_04e1 entries. The wrapper runs the oracle tail so the host proceeds.
 */
function captureTailDispatches(K, maxFrames) {
  const caps = [];
  const overrides = new Map([[TAIL, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracleTail(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. EQUAL (exhaustive, 0x6905 dimension) ----------------------------------

test("EQUAL (exhaustive): blinkSpritePairOn == oracle over all 65,536 (byte@0x6905, C) combos", () => {
  const { mismatch, count } = sweepBytes(blinkSpritePairOn, [0x5a], R256, R256);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at 0x6901=${hb(mismatch.b1)} 0x6905=${hb(mismatch.b5)} c=${hb(mismatch.c)}: ` +
        `oracle=(${hb(mismatch.want.s0)},${hb(mismatch.want.s1)}) cand=(${hb(mismatch.got.s0)},${hb(mismatch.got.s1)})`,
  );
  assert.equal(count, 256 * 256, "must have compared the full 65,536-combo (0x6905,C) grid");
  console.log(`  EQUAL/0x6905: ${count} (byte@0x6905, C) combos identical to the oracle`);
});

// -- 2. EQUAL (exhaustive, 0x6901 dimension) ----------------------------------

test("EQUAL (exhaustive): blinkSpritePairOn == oracle over all 256 byte@0x6901 values", () => {
  const { mismatch, count } = sweepBytes(blinkSpritePairOn, R256, [0xa5], [0x00]);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at 0x6901=${hb(mismatch.b1)}: ` +
        `oracle=(${hb(mismatch.want.s0)},${hb(mismatch.want.s1)}) cand=(${hb(mismatch.got.s0)},${hb(mismatch.got.s1)})`,
  );
  assert.equal(count, 256, "must have compared all 256 byte@0x6901 values");
  console.log(`  EQUAL/0x6901: ${count} byte@0x6901 values identical to the oracle`);
});

// -- 3. TEETH (exhaustive) ----------------------------------------------------

/** Broken twin (a): ORs the WRONG bit (0x40) into record #1's code — caught by 0x6905 sweep. */
function brokenWrongBit(m) {
  const { regs, mem } = m;
  mem.write8(SPRITE0_CODE, mem.read8(SPRITE0_CODE) | 0x80);
  regs.a = mem.read8(SPRITE1_CODE) | 0x40; // BUG: 0x40 should be 0x80
  storeBlinkSpriteCode(m);
}

/** Broken twin (b): OMITS the record-#0 bit-set — caught by 0x6901 sweep. */
function brokenSkip6901(m) {
  const { regs, mem } = m;
  // BUG: dropped `mem.write8(0x6901, ... | 0x80)`
  regs.a = mem.read8(SPRITE1_CODE) | 0x80;
  storeBlinkSpriteCode(m);
}

test("TEETH (exhaustive): the wrong-bit twin (0x6905) is CAUGHT by the 0x6905 sweep", () => {
  const { mismatch, count } = sweepBytes(brokenWrongBit, [0x5a], R256, R256);
  assert.notEqual(mismatch, null, "the 0x6905 sweep FAILED to catch a wrong blink bit — it is worthless");
  console.log(
    `  TEETH/0x6905: caught after ${count} combos at 0x6905=${hb(mismatch.b5)} c=${hb(mismatch.c)} ` +
      `(oracle s1=${hb(mismatch.want.s1)} broken s1=${hb(mismatch.got.s1)})`,
  );
});

test("TEETH (exhaustive): the skip-0x6901 twin is CAUGHT by the 0x6901 sweep", () => {
  const { mismatch, count } = sweepBytes(brokenSkip6901, R256, [0xa5], [0x00]);
  assert.notEqual(mismatch, null, "the 0x6901 sweep FAILED to catch a missing record-#0 write — it is worthless");
  console.log(
    `  TEETH/0x6901: caught after ${count} values at 0x6901=${hb(mismatch.b1)} ` +
      `(oracle s0=${hb(mismatch.want.s0)} broken s0=${hb(mismatch.got.s0)})`,
  );
});

// -- 4. REALISM + PURITY (crafted from real 0x04ac captures) ------------------

test("REALISM + PURITY: real attract-derived states — oracle writes only {0x6901,0x6905}, candidate matches whole-machine", () => {
  const caps = captureTailDispatches(48, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x04ac dispatch during attract to derive a base from");

  for (const cap of caps) {
    // PURITY: the oracle's write footprint on this real state is a subset of {0x6901,0x6905}.
    const footprint = oracleWriteFootprint(cap);
    for (const addr of footprint) {
      assert.ok(
        addr === SPRITE0_CODE || addr === SPRITE1_CODE,
        `oracle wrote RAM at ${hx(addr)} (not 0x6901/0x6905) — the (bytes)->bytes model is not licensed`,
      );
    }

    // REALISM: fresh-clone whole-machine RAM diff (minus dead stack) is empty.
    const ram = diffAgainstOracle(cap, blinkSpritePairOn);
    assert.equal(
      ram,
      null,
      ram && `whole-machine mismatch on real-derived state (c=${hb(cap.regs.c)}) ` +
        `at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`,
    );
  }
  console.log(
    `  REALISM/purity: ${caps.length} real-derived states — footprint subset {0x6901,0x6905}, whole-machine identical`,
  );
});

// -- 5. CRAFTED (toggle arm + bit-set on varied code bytes) -------------------

test("CRAFTED: forced toggle-phase entries match whole-machine AND genuinely set bit 7 + toggle", () => {
  const caps = captureTailDispatches(4, 2000);
  assert.ok(caps.length >= 1, "expected a real dispatch to use as a crafted base");
  const base = caps[0];

  // Toggle phases: bit 6 set, low 3 bits clear ((C & 0x47) == 0x40); don't-care bits varied.
  const CS = [0x40, 0x48, 0x50, 0x60, 0x78, 0xc0, 0xf8];
  // bit-7-CLEAR code bytes, so the set is observable and the toggle's ^0x03 is visible.
  const B5S = [0x00, 0x01, 0x02, 0x03, 0x10, 0x44, 0x7f];
  const B1S = [0x00, 0x0f, 0x40, 0x7f];

  let cases = 0;
  for (const c of CS) {
    assert.equal((c & 0x47) === 0x40, true, `test bug: ${hb(c)} is not a toggle phase`);
    for (const b5 of B5S) {
      for (const b1 of B1S) {
        const entry = base.clone();
        entry.mem.write8(SPRITE0_CODE, b1);
        entry.mem.write8(SPRITE1_CODE, b5);
        entry.regs.c = c;
        entry.regs.sp = SAFE_SP;

        // The oracle must actually set bit 7 of 0x6901 and take the toggle arm at 0x6905.
        const oc = installOracleTail(entry.clone());
        oracle(oc);
        assert.equal(
          oc.mem.read8(SPRITE0_CODE) & 0xff,
          (b1 | 0x80) & 0xff,
          `0x6901 bit-set not applied for b1=${hb(b1)}`,
        );
        assert.equal(
          oc.mem.read8(SPRITE1_CODE) & 0xff,
          ((b5 | 0x80) ^ 0x03) & 0xff,
          `toggle arm not exercised for b5=${hb(b5)} c=${hb(c)}`,
        );

        // And the candidate reproduces the whole machine.
        const ram = diffAgainstOracle(entry, blinkSpritePairOn);
        assert.equal(
          ram,
          null,
          ram && `crafted toggle mismatch (b1=${hb(b1)} b5=${hb(b5)} c=${hb(c)}) at ${hx(ram.addr)}: ` +
            `oracle=${ram.a} cand=${ram.b}`,
        );
        cases++;
      }
    }
  }
  console.log(`  CRAFTED: ${cases} forced toggle-phase entries — bit-7 set, toggle fired, candidate matches`);
});
