// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for drawCreditLineInAttract (ROM 0x0611) — the attract-gated
 * "CREDIT nn" repaint (task-table entry 8).
 *
 * entry_0611 is a one-bit enable guard in front of drawCreditDisplay (0x0616): it reads
 * ATTRACT (0x6007) and, on the low bit CLEAR (a credited game is in progress), returns
 * without touching anything; on the bit SET (attract) it falls through into drawCreditDisplay
 * to repaint the credit line. Attract keeps the bit set, so the game naturally dispatches it
 * only on the PAINT path; the credited-game skip path is reached with a crafted entry.
 *
 * The contract is MEMORY-ONLY (RAM − the stack scratch below the entry SP). This is a task-table entry: the
 * dispatcher discards its registers/flags, so nothing is live-out but memory. And the two
 * paths do not net the same stack motion — the skip path returns (pops the caller address)
 * while the paint path falls through a nested call that never nets a pop — so there is no
 * single terminal `ret` that lines pc/SP up on both arms (unlike equivalence-0350). Since
 * the idiomatic routine drops the oracle's fall-through call bracket, the oracle's transient
 * stack writes are excluded via STACK_SCRATCH, exactly the dissolved-call case.
 *
 * Because attract paints "00" over "00", a broken twin that paints when it should not would
 * be invisible against a base that already shows the same digits. So every crafted entry
 * pre-stamps a SENTINEL tile into the two credit-digit cells (0x74BF high, 0x749F low): a
 * real paint overwrites it (observable), and a skip leaves it (so an unwanted paint diverges).
 *
 *   1. REACHABILITY — hook 0x0611 in a real attract run and confirm the game dispatches it
 *      (the credit line is repainted through the task queue during attract).
 *
 *   2. EQUAL (captured) — clone the machine at each real dispatch and confirm
 *      drawCreditLineInAttract reproduces the oracle's RAM over every real state.
 *
 *   3. EQUAL (crafted) — pin BOTH arms identically on both sides: the credited-game skip
 *      (writes nothing) and the attract paint over several credit counts (00 / 12 / 99, and
 *      an ATTRACT byte with high bits set to prove only bit 0 matters). Non-vacuity is
 *      asserted: the paint arms change the digit cells, the skip arm changes nothing.
 *
 *   4. TEETH — two broken twins the SAME suite (captured + crafted) MUST catch:
 *        (a) inverted guard — paints during a game and skips in attract; caught on every
 *            paint case (the sentinel survives where the oracle painted).
 *        (b) unconditional paint — drops the guard; caught on the skip case (it paints over
 *            the sentinel where the oracle left it).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0611.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0611 as oracle } from "../../translated/loc_0611.js";
import { drawCreditLineInAttract } from "../drawCreditLineInAttract.js";
import { drawCreditDisplay } from "../drawCreditDisplay.js"; // ROM 0x0616 — used only by the teeth twins
import { ATTRACT, CREDITS, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0611;
const RET_ADDR = 0x02cd;   // a sane caller-return so the oracle's skip-path `ret` pops something valid
const DIGIT_HI = 0x74bf;   // credit-count high digit cell (drawCreditDisplay's cursor)
const DIGIT_LO = 0x749f;   // low digit, one tilemap row up (−0x20)
const SENTINEL = 0x2f;     // a non-digit tile pre-stamped into both digit cells so any paint is observable

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// All non-stack RAM addresses that changed between two machines (for the non-vacuity checks).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

// A real, self-consistent machine: boot + a stretch of attract so work + video RAM hold
// realistic values. clone() neutralises the frame machinery (nextNmi/nextBoundary = Infinity).
function attractBase(frames = 200) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// Stamp a crafted 0x0611 dispatch onto a clone of the base: a stack with a plausible caller
// return (so the skip-path `ret` has a valid target and the paint-path call churns inside
// STACK_SCRATCH), the ATTRACT enable byte, the credit count, and the digit-cell sentinels.
function craft(base, { attract, credits }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(ATTRACT, attract);
  m.mem.write8(CREDITS, credits);
  m.mem.write8(DIGIT_HI, SENTINEL);
  m.mem.write8(DIGIT_LO, SENTINEL);
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

// The crafted arms — both the credited-game skip and the attract paint over several counts.
function craftedCases(base) {
  return [
    { name: "credited game — skip (nothing painted)", entry: craft(base, { attract: 0x00, credits: 0x99 }), paint: false },
    { name: "attract — paint, credits 00", entry: craft(base, { attract: 0x01, credits: 0x00 }), paint: true },
    { name: "attract — paint, credits 12", entry: craft(base, { attract: 0x01, credits: 0x12 }), paint: true },
    { name: "attract — paint, credits 99", entry: craft(base, { attract: 0x01, credits: 0x99 }), paint: true },
    { name: "attract — paint, ATTRACT high bits set (only bit 0 gates)", entry: craft(base, { attract: 0x03, credits: 0x07 }), paint: true },
  ];
}

// Run the ORACLE on one clone and `fn` on another; diff RAM − the stack scratch below the entry SP. Fresh clones
// per side because the paint path writes memory.
function oracleVsCandidate(entry, fn) {
  const o = entry.clone(); oracle(o);
  const c = entry.clone(); fn(c);
  return firstRamDiff(o, c, entry.regs.sp);
}

// Hook 0x0611 in a real attract run and clone the machine at up to K real dispatches.
function captureDispatches(K = 64, maxFrames = 1500) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

// The full suite as labeled entries — real captured dispatches + crafted arms. Both the EQUAL
// gate and the TEETH twins run against this same set (so a caught twin proves the gate).
function suiteEntries() {
  const labeled = [];
  captureDispatches().forEach((entry, i) => labeled.push({ name: `captured #${i}`, entry }));
  craftedCases(attractBase()).forEach(({ name, entry }) => labeled.push({ name, entry }));
  return labeled;
}

// First entry in the suite where `fn` diverges from the oracle. { name, diff } | null.
function firstMismatch(fn, labeled) {
  for (const { name, entry } of labeled) {
    const diff = oracleVsCandidate(entry, fn);
    if (diff) return { name, diff };
  }
  return null;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x0611 is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(count >= 1, "0x0611 should be dispatched — the credit line is repainted through the task queue in attract");
  console.log(`  REACHABILITY: ${count} natural 0x0611 dispatches in 1500 frames`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): drawCreditLineInAttract == oracle on every real dispatch", () => {
  const caps = captureDispatches();
  assert.ok(caps.length >= 1, "expected at least one real 0x0611 dispatch during attract");
  for (const entry of caps) {
    const diff = oracleVsCandidate(entry, drawCreditLineInAttract);
    assert.equal(diff, null, diff && `captured dispatch RAM diverges at ${hx(diff.addr)} (oracle=${diff.a} cand=${diff.b})`);
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatch(es) identical to the oracle`);
});

// -- 3. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): the skip and paint arms all match the oracle (and are non-vacuous)", () => {
  const cases = craftedCases(attractBase());
  for (const { name, entry, paint } of cases) {
    const diff = oracleVsCandidate(entry, drawCreditLineInAttract);
    assert.equal(diff, null, diff && `${name}: RAM diverges at ${hx(diff.addr)} (oracle=${diff.a} cand=${diff.b})`);

    // Non-vacuity: prove the crafted case actually exercises the arm it claims to.
    const after = entry.clone(); oracle(after);
    const changed = changedAddrs(entry, after, entry.regs.sp);
    if (paint) {
      assert.ok(changed.includes(DIGIT_HI), `${name}: paint arm did not overwrite the credit digit cell — the case is vacuous`);
    } else {
      assert.deepEqual(changed, [], `${name}: skip arm wrote non-stack RAM`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (skip + paint over 4 credit states) identical and non-vacuous`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): inverts the enable guard — paints during a credited game, skips in attract. */
function brokenInvertedGuard(m) {
  const { mem } = m;
  if ((mem.read8(ATTRACT) & 0x01) !== 0) return; // BUG: should be === 0
  drawCreditDisplay(m);
}

/** Broken twin (b): drops the guard entirely — always paints. */
function brokenAlwaysPaint(m) {
  drawCreditDisplay(m); // BUG: no ATTRACT gate
}

test("TEETH: the inverted-guard and unconditional-paint twins are CAUGHT by the same suite", () => {
  const labeled = suiteEntries();

  const inv = firstMismatch(brokenInvertedGuard, labeled);
  assert.notEqual(inv, null, "the inverted-guard twin escaped — the gate is worthless");

  const always = firstMismatch(brokenAlwaysPaint, labeled);
  assert.notEqual(always, null, "the unconditional-paint twin escaped — the gate is worthless");

  console.log(
    `  TEETH: inverted-guard caught at "${inv.name}" (${hx(inv.diff.addr)}: ${inv.diff.a}->${inv.diff.b}); ` +
      `unconditional-paint caught at "${always.name}" (${hx(always.diff.addr)}: ${always.diff.a}->${always.diff.b})`,
  );
});
