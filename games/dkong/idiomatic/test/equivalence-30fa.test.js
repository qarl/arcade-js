// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for gateFireUpdateByDifficulty (ROM 0x30FA) — the selector that picks one of the four
 * frame gates at ROM 0x3110-0x313B by DIFFICULTY and passes its proceed/skip decision up.
 *
 * gateFireUpdateByDifficulty reads exactly one byte of its own (DIFFICULTY, 0x6380), clamps it to the six
 * entries of its ROM table, and runs the gate that entry names; the gate reads FRAME
 * (0x601A) and answers proceed or skip. Nothing on that path writes RAM, so the live-out is
 * the returned decision plus "no memory moved outside the dead stack scratch". Both sides
 * run the WHOLE chain — the oracle through the ROM table and the frozen gates, the candidate
 * through its JS table and the idiomatic gates — so a wrong table entry, a wrong clamp, or a
 * wrong gate is caught end to end. No callee is stubbed anywhere in this file.
 *
 * NOT RECURSIVE. The brief for this routine warned it calls itself; it does not. The ROM
 * table at 0x3104-0x310F is 0x3110/0x3110/0x311b/0x3126/0x3126/0x3131 (verified in the ROM
 * image by the MAPPING test below, which fingerprints the gate reached at every difficulty),
 * and all four gates are leaves. There is therefore no recursion to exercise; what the
 * dispatch actually needs exercised is EVERY difficulty byte — the whole table, both
 * duplicated slots, and the clamp — which the MAPPING and EXHAUSTIVE arms do at all 256
 * values, and the CRAFTED arm does on real captured entry states.
 *
 *   1. REACHABILITY + REAL CAPTURES + CRAFTED (realism) — 0x30fa IS on a live path
 *      (handler_1977 → 0x30ed → here): a 2000-frame attract run dispatches it 1197 times,
 *      the first at frame ~585. The live arm compares the candidate against the oracle at
 *      every one of those dispatches. A SECOND, shorter run (900 frames) then captures the
 *      first 24 real entry states, and each is re-run with DIFFICULTY poked identically on
 *      both sides over all six table slots and past the clamp — real states with a surgical
 *      nudge, since attract only ever presents difficulty 1 and would otherwise cover just
 *      one gate. That is 240 replays. Each compares RAM − the stack scratch below the entry SP and the returned
 *      decision on fresh clones.
 *
 *   2. EXHAUSTIVE — all 65536 (DIFFICULTY, FRAME) byte pairs against the oracle. The two
 *      bytes are the routine's entire input, so this is a proof rather than a sample.
 *
 *   3. MAPPING — the difficulty→gate table, re-derived from the oracle instead of trusted.
 *      Each gate has a distinct 256-frame decision fingerprint (1/2, 5/8, 3/4, 7/8 duty), so
 *      running the oracle over every frame value at a fixed difficulty identifies WHICH gate
 *      the ROM table sent it to. Done for all 256 difficulty bytes, and asserted against
 *      0/1→0x3110, 2→0x311b, 3/4→0x3126, ≥5→0x3131. The fingerprints are first asserted
 *      pairwise distinct, so the identification cannot be vacuous.
 *
 *   4. CALLER-SKIP SHAPE (live-out) — the returned boolean IS the oracle's two-level stack
 *      splice: the oracle consumes one stack word when it returns true and TWO when it
 *      returns false (measured here, both arms). That is the fact the idiomatic boolean
 *      stands for, and the fact the translated↔idiomatic seam needs now that 0x30fa IS
 *      wired live: names.js registers 0x30fa -> gateFireUpdateByDifficulty, so the seam
 *      does dispatch this routine, and machine.js's SEAM_CALLER_SKIP LISTS 0x30fa (its
 *      `MEASURED false:+4` entry is this arm's number).
 *
 *   5. TEETH — three broken twins, each caught by the exhaustive sweep, each a real way to
 *      get this dispatcher wrong: a clamp one short, a table without the ROM's duplicated
 *      slots, and a wrap instead of a clamp. The third is invisible to attract (it only
 *      differs at difficulty ≥6) — that is the point of sweeping all 256.
 *
 * WHAT THE TWO SIDES DO DIFFERENTLY, stated because it is the whole content of this equivalence:
 * the oracle reaches its gate INDIRECTLY, through the shared inline-table dispatcher at ROM 0x0028
 * — it lays its six-entry table in ROM right behind itself and lets that dispatcher index it. The
 * dispatcher's index arithmetic wraps at a byte, which cannot matter here because the clamp keeps
 * the index at 5 or below, so the whole of it reduces to the direct table of gate functions the
 * candidate uses. The EXHAUSTIVE and MAPPING arms are what turn "cannot matter" into a measurement.
 *
 * Isolated runs use clone() (frame machinery neutralised: nextNmi/nextBoundary = Infinity)
 * so an m.step inside the oracle cannot trip a live NMI whose handler would write RAM and
 * masquerade as an oracle side effect, and park SP inside STACK_SCRATCH so the oracle's
 * table push and its ret/skip pops stay in dead RAM and never reach I/O space.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-30fa.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_30fa as oracle } from "../../translated/loc_30fa.js";
import { loc_3110 as oracleGate3110 } from "../../translated/loc_3110.js";
import { loc_311b as oracleGate311b } from "../../translated/loc_311b.js";
import { loc_3126 as oracleGate3126 } from "../../translated/loc_3126.js";
import { loc_3131 as oracleGate3131 } from "../../translated/loc_3131.js";
import { gateFireUpdateByDifficulty } from "../gateFireUpdateByDifficulty.js";
import { Machine } from "../../machine.js";
import { DIFFICULTY, FRAME, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x30fa;
// Park SP inside STACK_SCRATCH so the oracle's table push and its ret/skip pops land in dead
// RAM and never reach I/O space — far enough inside that a four-word swing stays in range.
const SAFE_SP = STACK_SCRATCH.lo + 16;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const hx16 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

/** The four frozen gates, by the ROM address of each, for the mapping fingerprints. */
const ORACLE_GATES = [
  [0x3110, oracleGate3110],
  [0x311b, oracleGate311b],
  [0x3126, oracleGate3126],
  [0x3131, oracleGate3131],
];

/** The mapping this routine claims, as asserted against the oracle by the MAPPING test. */
const EXPECTED_GATE = (difficulty) =>
  difficulty <= 1 ? 0x3110 : difficulty === 2 ? 0x311b : difficulty <= 4 ? 0x3126 : 0x3131;

/**
 * First differing RAM byte between two dumps, EXCLUDING the dead stack scratch region (the
 * memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns { addr, a, b } or null.
 */
function firstRamDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

/** A machine ready to run the routine in isolation: frame machinery off, SP in dead scratch. */
function prepare(m, difficulty, frameVal) {
  m.mem.write8(DIFFICULTY, difficulty & 0xff);
  m.mem.write8(FRAME, frameVal & 0xff);
  m.regs.sp = SAFE_SP;
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

/** A fresh entry state cloned off `base` with both input bytes set. */
const makeEntry = (base, difficulty, frameVal) => prepare(base.clone(), difficulty, frameVal);

/**
 * Sweep every (difficulty, frame) byte pair, running the oracle and `candidate` on two
 * machines that are byte-identical apart from the stack scratch each has already dirtied.
 * Returns the first pair where the candidate's decision disagrees, or null, plus the count.
 * Used by the exhaustive arm and by the teeth twins, none of which write RAM, so the
 * returned decision is the discriminant.
 */
function fullSweep(base, candidate) {
  const a = prepare(base.clone(), 0, 0); // oracle side
  const b = prepare(base.clone(), 0, 0); // candidate side
  let count = 0;
  for (let d = 0; d < 256; d++) {
    for (let f = 0; f < 256; f++) {
      prepare(a, d, f);
      prepare(b, d, f);
      const want = oracle(a);
      const got = candidate(b);
      count++;
      if (got !== want) return { mismatch: { d, f, want, got }, count };
    }
  }
  return { mismatch: null, count };
}

/**
 * The 256-frame decision fingerprint of `fn` at difficulty `d`: one character per frame value.
 * Applied to a bare gate it is that gate's duty-cycle signature; applied to the dispatcher it
 * is the signature of whichever gate the dispatcher reached, which is how the mapping test
 * identifies the gate without stubbing anything.
 */
function fingerprint(base, fn, d = 0) {
  const m = prepare(base.clone(), d, 0);
  let bits = "";
  for (let f = 0; f < 256; f++) {
    prepare(m, d, f);
    bits += fn(m) ? "1" : "0";
  }
  return bits;
}

// -- 1. REACHABILITY + REAL CAPTURES + CRAFTED --------------------------------

test("REACHABILITY + CAPTURED DISPATCH: gateFireUpdateByDifficulty matches the oracle on every live dispatch (2000 attract frames)", () => {
  let count = 0;
  let mismatches = 0;
  let proceed = 0;
  let skip = 0;
  let firstBad = null;
  const difficulties = new Map();
  // Override 0x30fa on a live attract machine. On each real dispatch read the live inputs,
  // take the candidate's decision (a pure read — it writes nothing and moves no stack), then
  // run the oracle to drive the machine faithfully and return ITS decision, so the host run
  // stays exact and keeps minting further dispatches.
  const overrides = new Map([[TARGET, (mm) => {
    count++;
    const d = mm.mem.read8(DIFFICULTY) & 0xff;
    difficulties.set(d, (difficulties.get(d) ?? 0) + 1);
    const got = gateFireUpdateByDifficulty(mm);
    const want = oracle(mm);
    if (got !== want) {
      mismatches++;
      if (firstBad === null) firstBad = { d, f: mm.mem.read8(FRAME) & 0xff, got, want };
    }
    if (want) proceed++; else skip++;
    return want;
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2000);

  assert.ok(count > 0, "0x30fa is dispatched live (handler_1977 → 0x30ed → here) and MUST be seen during attract — none means the live chain regressed");
  assert.equal(
    mismatches,
    0,
    firstBad && `gateFireUpdateByDifficulty disagreed with the oracle at a live DIFFICULTY=${hx(firstBad.d)} FRAME=${hx(firstBad.f)} (oracle=${firstBad.want} gateFireUpdateByDifficulty=${firstBad.got})`,
  );
  assert.ok(proceed > 0 && skip > 0, `both decisions must occur across live dispatches (got ${proceed} proceed, ${skip} skip)`);
  // Attract plays level 1 at difficulty 1 throughout, so this arm alone exercises ONE table
  // slot (the 1/2 gate). Stated as an assertion rather than a footnote so the coverage hole
  // is a measured fact, and so a future attract that DID vary difficulty would say so here.
  const seen = [...difficulties.keys()].sort((a, b) => a - b);
  assert.deepEqual(
    seen,
    [1],
    `attract was expected to present difficulty 1 only (it covers just the 0x3110 gate); saw ${seen.join(",")}`,
  );
  console.log(`  REACHABILITY: ${count} live 0x30fa dispatches over 2000 attract frames (${proceed} proceed, ${skip} skip), difficulty ${seen.join(",")} only, 0 mismatches`);
});

test("CRAFTED on REAL captures: RAM(−stack) + decision match at every difficulty, on real entry states", () => {
  // Capture real entry states, then poke DIFFICULTY identically on both sides to reach the
  // three gates and the clamp that attract never presents.
  const caps = [];
  const K = 24;
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  // The first natural dispatch is at frame ~585 (the chain only runs once attract reaches
  // that segment), so a short run captures nothing — 900 frames is well past it.
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(900);
  capturing = false;
  assert.ok(caps.length > 0, "expected at least one real 0x30fa dispatch to capture");

  // Every table slot (0..5), the clamp just past it, and two far-out values.
  const CRAFTED = [0, 1, 2, 3, 4, 5, 6, 7, 0x80, 0xff];
  let compared = 0;
  const decisions = { proceed: 0, skip: 0 };
  for (const cap of caps) {
    for (const d of CRAFTED) {
      const a = prepare(cap.clone(), d, cap.mem.read8(FRAME)); // oracle
      const aFloor = a.regs.sp;
      const b = prepare(cap.clone(), d, cap.mem.read8(FRAME)); // candidate
      const want = oracle(a);
      const got = gateFireUpdateByDifficulty(b);
      assert.equal(got, want, `decision diverged at DIFFICULTY=${hx(d)} FRAME=${hx(cap.mem.read8(FRAME))}: oracle=${want} gateFireUpdateByDifficulty=${got}`);
      const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), aFloor);
      assert.equal(
        ramDiff,
        null,
        ramDiff && `RAM diverged at ${hx16(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b} (DIFFICULTY=${hx(d)})`,
      );
      if (want) decisions.proceed++; else decisions.skip++;
      compared++;
    }
  }
  assert.ok(decisions.proceed > 0 && decisions.skip > 0, "crafted entries must hit both decisions");
  console.log(`  CRAFTED: ${caps.length} real entry states × ${CRAFTED.length} difficulties = ${compared} replays — RAM(−stack) + decision identical (${decisions.proceed} proceed, ${decisions.skip} skip)`);
});

test("PURITY: neither side writes RAM outside the dead stack scratch, at every table slot", () => {
  const base = new Machine(ROM).clone();
  let checked = 0;
  for (let d = 0; d < 8; d++) {
    for (let f = 0; f < 8; f++) {
      const a = makeEntry(base, d, f);
      const before = a.dumpState();
      const entrySp = a.regs.sp;
      oracle(a);
      const oracleWrote = firstRamDiffExStack(before, a.dumpState(), (o) => a.stateOffsetToAddr(o), entrySp);
      assert.equal(
        oracleWrote,
        null,
        oracleWrote && `oracle wrote RAM at ${hx16(oracleWrote.addr)} (${oracleWrote.a}->${oracleWrote.b}) at DIFFICULTY=${hx(d)} FRAME=${hx(f)}`,
      );

      const b = makeEntry(base, d, f);
      const beforeB = b.dumpState();
      gateFireUpdateByDifficulty(b);
      const candWrote = firstRamDiffExStack(beforeB, b.dumpState(), (o) => b.stateOffsetToAddr(o), entrySp);
      assert.equal(candWrote, null, candWrote && `gateFireUpdateByDifficulty wrote RAM at ${hx16(candWrote.addr)}`);
      checked++;
    }
  }
  console.log(`  PURITY: ${checked} entries — neither side touches RAM outside the stack scratch below the entry SP (this is what licenses the memory-only contract)`);
});

// -- 2. EXHAUSTIVE ------------------------------------------------------------

test("EXHAUSTIVE: gateFireUpdateByDifficulty == oracle over all 65536 (DIFFICULTY, FRAME) byte pairs", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = fullSweep(base, gateFireUpdateByDifficulty);
  assert.equal(
    mismatch,
    null,
    mismatch && `decision diverged at DIFFICULTY=${hx(mismatch.d)} FRAME=${hx(mismatch.f)}: oracle=${mismatch.want} gateFireUpdateByDifficulty=${mismatch.got}`,
  );
  assert.equal(count, 65536, "must have compared every difficulty × frame byte pair");
  console.log(`  EXHAUSTIVE: ${count} (difficulty, frame) pairs identical to the oracle`);
});

// -- 3. MAPPING (the difficulty→gate table, re-derived from the oracle) --------

test("MAPPING: the oracle's gate at every one of the 256 difficulty bytes is the one gateFireUpdateByDifficulty's table names", () => {
  const base = new Machine(ROM).clone();

  // The fingerprints must be pairwise distinct or the identification below proves nothing.
  const prints = new Map();
  for (const [addr, gate] of ORACLE_GATES) prints.set(addr, fingerprint(base, gate, 0));
  const distinct = new Set(prints.values());
  assert.equal(distinct.size, ORACLE_GATES.length, "the four gate fingerprints must be pairwise distinct for the identification to mean anything");
  const duty = (bits) => [...bits].filter((c) => c === "1").length;
  for (const [addr, bits] of prints) {
    assert.ok(duty(bits) > 0 && duty(bits) < 256, `gate ${hx16(addr)} must have a genuine duty cycle, got ${duty(bits)}/256`);
  }

  const byPrint = new Map([...prints].map(([addr, bits]) => [bits, addr]));
  const observed = new Map(); // difficulty -> gate address the ORACLE reached
  for (let d = 0; d < 256; d++) {
    const bits = fingerprint(base, oracle, d);
    const gate = byPrint.get(bits);
    assert.ok(gate !== undefined, `at DIFFICULTY=${hx(d)} the oracle's decision pattern matches NONE of the four known gates`);
    observed.set(d, gate);
    assert.equal(
      gate,
      EXPECTED_GATE(d),
      `at DIFFICULTY=${hx(d)} the oracle dispatched ${hx16(gate)} but gateFireUpdateByDifficulty's table names ${hx16(EXPECTED_GATE(d))}`,
    );
    // And the candidate must reach the same gate, not merely agree on the decisions.
    assert.equal(fingerprint(base, gateFireUpdateByDifficulty, d), bits, `gateFireUpdateByDifficulty's gate at DIFFICULTY=${hx(d)} differs from the oracle's ${hx16(gate)}`);
  }

  // Report the derived mapping as ranges, and assert every gate was actually reached.
  const reached = new Set(observed.values());
  assert.equal(reached.size, 4, `all four gates must be reached across the difficulty range, saw ${reached.size}`);
  const ranges = [];
  for (let d = 0; d < 256; d++) {
    const g = observed.get(d);
    const last = ranges[ranges.length - 1];
    if (last && last.gate === g) last.hi = d;
    else ranges.push({ gate: g, lo: d, hi: d });
  }
  console.log(`  MAPPING (derived from the oracle, all 256 difficulty bytes): ${ranges.map((r) => `${r.lo}${r.lo === r.hi ? "" : "-" + r.hi}→${hx16(r.gate)}`).join("  ")}`);
});

// -- 4. CALLER-SKIP SHAPE (the live-out the boolean stands for) ----------------

test("CALLER-SKIP SHAPE: the oracle consumes one stack word on true and TWO on false; gateFireUpdateByDifficulty moves no stack", () => {
  const base = new Machine(ROM).clone();
  const deltas = { true: new Set(), false: new Set() };
  let cases = 0;
  for (let d = 0; d < 8; d++) {
    for (let f = 0; f < 8; f++) {
      const a = makeEntry(base, d, f);
      const r = oracle(a);
      deltas[r ? "true" : "false"].add(((a.regs.sp - SAFE_SP) << 16) >> 16);

      const b = makeEntry(base, d, f);
      const rb = gateFireUpdateByDifficulty(b);
      assert.equal(rb, r, `decision diverged at DIFFICULTY=${hx(d)} FRAME=${hx(f)}`);
      assert.equal(b.regs.sp, SAFE_SP, "gateFireUpdateByDifficulty must not touch the guest stack — the boolean replaces it");
      cases++;
    }
  }
  assert.deepEqual([...deltas.true], [2], "the oracle's proceed path must consume exactly one stack word");
  assert.deepEqual([...deltas.false], [4], "the oracle's skip path must consume TWO stack words (the caller-skip discard)");
  console.log(`  CALLER-SKIP SHAPE: ${cases} entries — oracle SP delta +2 on true, +4 on false; gateFireUpdateByDifficulty leaves SP at ${hx16(SAFE_SP)}`);
  console.log("    → 0x30fa IS in ROUTINES and IS in machine.js's SEAM_CALLER_SKIP, which is what that `false` arm's two-word debt at the seam requires.");
});

// -- 5. TEETH -----------------------------------------------------------------

const GATES = [oracleGate3110, oracleGate3110, oracleGate311b, oracleGate3126, oracleGate3126, oracleGate3131];

/** Broken twin (a): clamp one short — everything at or above 5 gets the 3/4 gate. */
function brokenClampShort(m) {
  return GATES[Math.min(m.mem.read8(DIFFICULTY), 4)](m); // BUG: clamps to 4, not 5
}

/** Broken twin (b): the ROM's duplicated slots dropped — one gate per difficulty step. */
function brokenNoDuplicates(m) {
  const table = [oracleGate3110, oracleGate311b, oracleGate3126, oracleGate3131, oracleGate3131, oracleGate3131];
  return table[Math.min(m.mem.read8(DIFFICULTY), 5)](m); // BUG: shifts every slot from 1 up
}

/** Broken twin (c): wrap instead of clamp — only differs at difficulty ≥ 6, which attract
 *  NEVER presents, so nothing but the full sweep can see it. */
function brokenWrapNotClamp(m) {
  return GATES[m.mem.read8(DIFFICULTY) % 6](m); // BUG: wraps out-of-range difficulty to slot 0
}

test("TEETH: a clamp one short is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenClampShort);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a short clamp — worthless");
  assert.ok(mismatch.d >= 5, `the short clamp can only differ at difficulty ≥ 5, caught at ${mismatch.d}`);
  console.log(`  TEETH/clamp: caught at DIFFICULTY=${hx(mismatch.d)} FRAME=${hx(mismatch.f)} (oracle=${mismatch.want} broken=${mismatch.got})`);
});

test("TEETH: a table without the ROM's duplicated slots is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenNoDuplicates);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a shifted table — worthless");
  assert.equal(mismatch.d, 1, "the shift first bites at difficulty 1, the ROM's first duplicated slot");
  console.log(`  TEETH/table: caught at DIFFICULTY=${hx(mismatch.d)} FRAME=${hx(mismatch.f)} (oracle=${mismatch.want} broken=${mismatch.got})`);
});

test("TEETH: a wrap in place of the clamp is CAUGHT (and is invisible to attract)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenWrapNotClamp);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrapped index — worthless");
  assert.ok(mismatch.d >= 6, `a wrap can only differ past the table, caught at ${mismatch.d}`);
  console.log(`  TEETH/wrap: caught at DIFFICULTY=${hx(mismatch.d)} FRAME=${hx(mismatch.f)} (oracle=${mismatch.want} broken=${mismatch.got}) — attract only ever presents difficulty 1, so ONLY the exhaustive sweep sees this`);
});
