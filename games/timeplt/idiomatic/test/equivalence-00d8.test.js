// SPDX-License-Identifier: GPL-3.0-only
/**
 * enterVerticalBlankService — memory-equivalent to the frozen oracle at ROM 0x00D8, in the DISSOLVED
 * form (see _vblankService.js for the contract every gate in this family shares: memory outside the
 * oracle's measured dead stack scratch, every device, SP).
 *
 * The frozen entry is ONE INSTRUCTION, `push af`, falling into the service body at 0x00D9. Control arrives
 * here three ways — the vector's `jp` at 0x0066 and a `call nz` at each of 0x00A2 and 0x49D0, the last two
 * taken only on a tampered image. The stacked pair is the first word of the register save the close at
 * 0x0174 unwinds; it holds no game state, so the rewrite does not stack it and is simply the service. Its
 * idiomatic callers — the vector, and the two boot-time image checks — all call it directly and it
 * returns, so it pops nothing either.
 *
 * What it exercises, holes stated:
 *   1. REACH — dispatched exactly once per vector dispatch on a genuine image under both tapes (so the
 *      two tampered-image arrivals never fire), with the vector's own count as the positive control.
 *   2. FULL — every captured entry of both tapes: memory outside the dead stack window and every device
 *      identical; SP unmoved when called directly, level with the oracle and on its pc when placed
 *      through the game's dispatch seam.
 *   3. ACCUMULATOR — the dropped `push af` lost nothing: on a real entry all 256 accumulator values under
 *      four flag words leave the rewrite's product unchanged, and the oracle's too outside its dead stack
 *      (so the stacked pair was not an input to anything that survives), with a twin that reads the
 *      accumulator into memory as the control that the sweep can see an input.
 *   4. TEETH — three twins, each caught on the corpus.
 *
 * RETIRED, and why: the frozen gate's WHOLE-MACHINE arm wired this entry into the CYCLE-DRIVEN engine. The
 * dissolved form is not a register-faithful override there (see _vblankService.js); the whole-game gates
 * under runIdiomaticGame — byte-for-byte against the cycle-driven oracle, and SP-INERT — are the arbiter.
 * HOLE: pc and cycles are not compared on a direct call, the ordinary memory-equivalence drop.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-00d8.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { captureAt, dissolvedDiff, runOracle, TAPES, hex4 } from "./_vblankService.js";
import { enterVerticalBlankService } from "../enterVerticalBlankService.js";
import { loc_00d8 as oracle } from "../../translated/loc_00d8.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { FRAME_TICK } from "../names.js";

const TARGET = 0x00d8;
const NMI_VECTOR = 0x0066;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const CORPUS_ENTRIES = 120;
const FLAG_WORDS = [0x00, 0xff, 0x01, 0x40];

const corpusOf = (label, opts) => captureAt(TARGET, label, opts, { limit: CORPUS_ENTRIES });
const diff = (cand, e) => dissolvedDiff(oracle, cand, e, { placedAt: TARGET });

const TWINS = [
  ["no-op", () => {}],
  ["double-service", (m) => { enterVerticalBlankService(m); enterVerticalBlankService(m); }],
  ["own-return", (m) => { enterVerticalBlankService(m); m.ret(); }],
];

test("REACH: once per vector dispatch on a genuine image, the vector as the positive control", { skip }, () => {
  for (const [label, opts] of TAPES) {
    const real = buildRoutines();
    const counts = { [TARGET]: 0, [NMI_VECTOR]: 0 };
    const overrides = new Map();
    for (const addr of [TARGET, NMI_VECTOR]) {
      const body = real.get(addr);
      overrides.set(addr, (mm, ...args) => {
        counts[addr]++;
        return body(mm, ...args);
      });
    }
    const m = makeMachine(overrides, opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} reach run stopped early: ${m.stoppedBy}`);
    assert.ok(counts[NMI_VECTOR] > 0, `the ${label} tap counted nothing for the vector either`);
    assert.equal(counts[TARGET], counts[NMI_VECTOR],
      `${label}: ${counts[TARGET]} arrivals against ${counts[NMI_VECTOR]} vector dispatches — a second arrival fired`);
    console.log(`  REACH: ${label} — ${counts[TARGET]} arrivals, all through the vector`);
  }
});

test("FULL: every captured entry, the whole service both ways", { skip }, () => {
  let total = 0;
  for (const [label, opts] of TAPES) {
    const entries = corpusOf(label, opts);
    assert.ok(entries.length > 0, `vacuous: the ${label} tape never reached the entry`);
    for (const e of entries) {
      const d = diff(enterVerticalBlankService, e);
      assert.equal(d, null, `${label}: ${d}`);
    }
    total += entries.length;
  }
  console.log(`  FULL: ${total} entries identical; SP unmoved directly, level with the oracle when placed`);
});

/** The product of a run, outside the given dead-stack window, as one comparable string. */
function productOf(fn, e, low, seat) {
  const m = e.clone();
  fn(m);
  const dump = m.dumpState();
  const keep = [];
  for (let i = 0; i < dump.length; i++) {
    const addr = m.stateOffsetToAddr(i);
    if (addr != null && addr >= low && addr < seat) continue;
    keep.push(dump[i]);
  }
  return Buffer.from(keep).toString("base64");
}

test("ACCUMULATOR: the dropped push lost nothing — no accumulator or flag value reaches the product", { skip }, () => {
  const base = corpusOf("coin-start", {})[0];
  const { low, seat } = runOracle(oracle, base);
  const seen = { rewrite: new Set(), oracle: new Set(), control: new Set() };
  const readsA = (m) => { m.mem8[FRAME_TICK] = m.regs.a; enterVerticalBlankService(m); };
  let n = 0;
  for (const f of FLAG_WORDS) {
    for (let a = 0; a < 256; a++) {
      const e = base.clone();
      e.regs.af = (a << 8) | f;
      assert.equal(diff(enterVerticalBlankService, e), null, `a=${hex4(a)} f=${hex4(f)}`);
      seen.rewrite.add(productOf(enterVerticalBlankService, e, low, seat));
      seen.oracle.add(productOf(oracle, e, low, seat));
      seen.control.add(productOf(readsA, e, low, seat));
      n++;
    }
  }
  assert.equal(seen.rewrite.size, 1, "the rewrite's product depends on the accumulator");
  assert.equal(seen.oracle.size, 1, "the oracle's product outside its dead stack depends on the accumulator, so the push was an input");
  assert.equal(seen.control.size, 256, "a twin that reads the accumulator into memory is not seen by the sweep");
  console.log(`  ACCUMULATOR: ${n} values agree; one product on each side; the reading control yields ${seen.control.size}`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const pool = corpusOf("coin-start", {});
    const caught = pool.filter((e) => diff(twin, e) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught}/${pool.length}`);
    assert.equal(caught, pool.length, `the ${label} twin escaped a captured entry`);
  });
}
