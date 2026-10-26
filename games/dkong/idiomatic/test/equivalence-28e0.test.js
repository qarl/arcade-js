// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for search75mObjectOverlap (ROM 0x28E0) — the board-3 two-sweep bounding-box collision
 * search. It recovers the per-axis tolerances the dispatcher pushed, then runs the shared
 * collision search findCollidingObject over OBJ_ARRAY_64 (5 records, 0x20 stride) and — only if that
 * first sweep found nothing — over OBJ_ARRAY_65 (10 records, 0x10 stride), recording each
 * sweep's count in OBJ_SEARCH_COUNT before it runs.
 *
 * Its whole observable effect is that memory store plus the search result findCollidingObject leaves in
 * the registers (the result byte in A and the count-minus-index residue in B). The defining
 * behaviour over the single-sweep sibling search100mObjectOverlap is the SHORT-CIRCUIT: a hit on sweep 1
 * takes findCollidingObject's caller-skip return, so sweep 2 never runs and OBJ_SEARCH_COUNT is left at
 * 5, not overwritten with 10.
 *
 * The dissolved arm takes the reference point/tolerances as arguments and RETURNS
 * { overlap, residue, stride, base } — the same four values the oracle leaves in A/B/E/IX. It does
 * no guest-stack ops, so pc/SP are seam artifacts and are not compared; the memory compare excludes
 * the dead STACK_SCRATCH region the oracle's dissolved bracket writes.
 *
 * 0x28e0 is NEVER dispatched during attract (its board-3 arm is reached only through the
 * untranslated 0x286B -> 0x3E88 overlap-search caller), so there are no real captured
 * dispatches — the gate is crafted entries covering every arm, each run identically on both
 * sides:
 *
 *   1. EQUAL (crafted) — sweep-1 hit (short-circuit: sweep 2 must NOT run, count stays 5),
 *      sweep-1-exhaust -> sweep-2 hit at the first record and at record 3 (the
 *      count-minus-index recovery), sweep-1-exhaust -> sweep-2 exhausted, and a stack-passed
 *      tolerance flip that decides sweep 1 (proving the tolerance marshalling is live). Every
 *      case: RAM (minus the stack scratch below the caller frame) and the returned tuple identical to the
 *      oracle, and the sweep-1-hit case additionally asserts sweep 2 stayed untouched.
 *
 *   2. TEETH — three broken twins the same suite MUST catch: one that drops the short-circuit
 *      (runs sweep 2 after a sweep-1 hit — caught at OBJ_SEARCH_COUNT), one that stores the
 *      wrong sweep-2 count (caught at OBJ_SEARCH_COUNT), and one that scans the wrong sweep-2
 *      record count (caught in the count-minus-index register residue).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-28e0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_28e0 as oracle } from "../../translated/loc_28e0.js";
import { findCollidingObject } from "../findCollidingObject.js";
import { search75mObjectOverlap } from "../search75mObjectOverlap.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, OBJ_SEARCH_COUNT, OBJ_ARRAY_64, OBJ_ARRAY_65 } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x28e0;
const SP_TOP = 0x6c00;      // stack top — inside STACK_SCRATCH, so every push is excluded
const RETURN_SITE = 0x2870; // where the dispatcher's caller resumes (the routine's normal return)
const SWEEP1_STRIDE = 0x20; // OBJ_ARRAY_64 record stride
const SWEEP2_STRIDE = 0x10; // OBJ_ARRAY_65 record stride
const SWEEP1_COUNT = 5;     // records the first sweep scans
const SWEEP2_COUNT = 10;    // records the second sweep scans
const IY_BASE = 0x6200;     // reference-point pointer, as the real callers set it (IY+3 = axis-2 ref)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const POPPED_ARG = 2; // ROM opens with `pop hl`: the stacked word at entry SP is consumed, so the caller frame starts above it

// First RAM byte that differs between two machines, skipping the stack scratch below the caller frame
// (the memory-equivalence contract is RAM − the stack scratch below the caller frame). { addr, a, b } | null.
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

// The dissolved arm returns { overlap, residue, stride, base } — the same four values the oracle
// leaves in A (result byte), B (count-minus-index residue), E (winning stride low byte) and IX
// (winning array base). pc/SP and the rest of the register file are NOT compared: the arm does no
// guest-stack ops (no pop, no ret), so those are seam artifacts, and the whole-game SP tests guard
// SP-correctness now.
function tupleDiffs(o, tuple) {
  const out = [];
  if (tuple.overlap !== o.regs.a) out.push(`overlap oracle=${hx(o.regs.a)} cand=${hx(tuple.overlap)}`);
  if (tuple.residue !== o.regs.b) out.push(`residue oracle=${hx(o.regs.b)} cand=${hx(tuple.residue)}`);
  if ((tuple.stride & 0xff) !== (o.regs.e & 0xff)) out.push(`stride oracle=${hx(o.regs.e)} cand=${hx(tuple.stride)}`);
  if (tuple.base !== o.regs.ix) out.push(`base oracle=${hx(o.regs.ix)} cand=${hx(tuple.base)}`);
  return out;
}

/** Run the ORACLE on a fresh clone; it performs its own pop/call/return churn. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

// The search inputs the dispatcher hands the arm: reference pointer/coordinate in IY/C, and the
// tolerance word the dispatcher pushed (recovered off the stack top, where the oracle's `pop hl`
// finds it). Crafted entries carry them directly; real captures derive them from the machine.
function searchArgs(entry) {
  if (entry._args) return entry._args;
  const sp = entry.regs.sp;
  return { iy: entry.regs.iy, c: entry.regs.c, bounds: entry.mem.read8(sp) | (entry.mem.read8((sp + 1) & 0xffff) << 8) };
}

/** Full contract diff: RAM − the stack scratch below the caller frame, plus the returned { overlap, residue, stride, base }. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = entry.clone();
  const tuple = fn(c, searchArgs(entry));
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp + POPPED_ARG);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  diffs.push(...tupleDiffs(o, tuple));
  return diffs;
}

// A real attract machine so the surrounding RAM is realistic; clone() neutralises the frame
// machinery (nextNmi/nextBoundary = Infinity) so the oracle's steps cannot fire an NMI.
function attractBase(frames = 120) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// An 11-byte record row from its meaningful fields (+0 active bit, +3/+5 axis coords,
// +9/+0xA extra spans). Other bytes are noise the search ignores.
function row({ active = true, f3 = 0, f5 = 0, f9 = 0, fA = 0 } = {}) {
  const r = new Array(11).fill(0);
  r[0x00] = active ? 0x01 : 0x00;
  r[0x03] = f3;
  r[0x05] = f5;
  r[0x09] = f9;
  r[0x0a] = fA;
  return r;
}

/** Stamp `records` into an array at `base` with `stride`, padding to `count` inactive rows. */
function stampArray(m, base, stride, count, records) {
  const rows = records.slice(0, count);
  while (rows.length < count) rows.push(row({ active: false }));
  for (let i = 0; i < rows.length; i++) {
    const rbase = (base + i * stride) & 0xffff;
    const rec = rows[i];
    for (let off = 0; off < rec.length; off++) m.mem.write8((rbase + off) & 0xffff, rec[off] & 0xff);
  }
}

/**
 * Stamp a crafted 0x28e0 dispatch onto a clone of the base: the dispatcher's stack (the return
 * site below the pushed tolerance word, which `pop hl` recovers), the reference coordinate and
 * reference pointer the dispatcher leaves in registers, the sweep-1 records at OBJ_ARRAY_64 and
 * the sweep-2 records at OBJ_ARRAY_65. `bounds` is the pushed HL word — low byte = axis-1
 * tolerance, high byte = axis-2 tolerance.
 */
function craft(base, { s1 = [], s2 = [], bounds = 0x0407, cRef, iyRef }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RETURN_SITE); // the routine's normal return target
  m.push16(bounds);      // the tolerances the dispatcher pushed; `pop hl` recovers them
  m.regs.iy = IY_BASE;
  m.regs.c = cRef & 0xff;
  m.mem.write8((IY_BASE + 3) & 0xffff, iyRef & 0xff);
  stampArray(m, OBJ_ARRAY_64, SWEEP1_STRIDE, SWEEP1_COUNT, s1);
  stampArray(m, OBJ_ARRAY_65, SWEEP2_STRIDE, SWEEP2_COUNT, s2);
  // The search inputs the dispatcher hands the idiomatic arm (reference point + tolerance word).
  m._args = { iy: IY_BASE, c: cRef & 0xff, bounds };
  return m;
}

// Classify what the oracle did on this entry: which sweep hit (if any), the result byte, the
// residue B, and the final OBJ_SEARCH_COUNT (5 if sweep 1 short-circuited, else 10).
function classify(entry) {
  const o = entry.clone();
  oracle(o);
  return { a: o.regs.a, b: o.regs.b, count: o.mem.read8(OBJ_SEARCH_COUNT) };
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x28e0 is NOT dispatched during attract (crafted-entry gate is required)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  // The board-3 arm is reached only through the untranslated 0x286B -> 0x3E88 overlap-search
  // caller, so the live NMI/substate paths never fire it — this is WHY the gate is crafted.
  assert.equal(count, 0, `expected 0x28e0 to stay dead in attract; saw ${count} dispatches — add captured cases`);
  console.log("  REACHABILITY: 0 natural 0x28e0 dispatches in 1500 frames (dead in attract) -> crafted-entry gate");
});

// -- 1. EQUAL (crafted, each arm pinned) --------------------------------------

test("EQUAL (crafted): every arm matches the oracle", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80; // realistic reference coordinates
  const HIT = row({ f5: C, f3: Y }); // a record whose box contains the reference point

  const cases = [
    {
      name: "sweep-1 hit at record 0 (short-circuit: count stays 5, sweep 2 untouched)",
      // sweep-1 record 0 is a hit; sweep-2 records are all hits too, but must NEVER be scanned.
      opts: { cRef: C, iyRef: Y, s1: [HIT], s2: [HIT, HIT, HIT] },
      wantA: 1, wantB: SWEEP1_COUNT - 0, wantCount: SWEEP1_COUNT,
    },
    {
      name: "sweep-1 exhaust -> sweep-2 hit at record 0",
      opts: { cRef: C, iyRef: Y, s1: [], s2: [HIT] }, // s1 padded inactive
      wantA: 1, wantB: SWEEP2_COUNT - 0, wantCount: SWEEP2_COUNT,
    },
    {
      name: "sweep-1 exhaust -> sweep-2 hit at record 3 (count-minus-index recovery)",
      opts: { cRef: C, iyRef: Y, s1: [], s2: [
        row({ active: false }),
        row({ f5: 0x00, fA: 0x02 }), // active but axis-1 far -> reject
        row({ active: false }),
        HIT,                          // the hit, index 3
        HIT,                          // would also hit, but the scan stops earlier
      ] },
      wantA: 1, wantB: SWEEP2_COUNT - 3, wantCount: SWEEP2_COUNT,
    },
    {
      name: "both sweeps exhausted (result byte 0)",
      opts: { cRef: C, iyRef: Y, s1: [], s2: [] }, // both padded inactive
      wantA: 0, wantB: 0, wantCount: SWEEP2_COUNT,
    },
  ];

  for (const { name, opts, wantA, wantB, wantCount } of cases) {
    const entry = craft(base, opts);
    const k = classify(entry);
    assert.equal(k.a, wantA, `${name}: expected result byte ${wantA}, oracle left ${k.a}`);
    assert.equal(k.b, wantB, `${name}: expected residue B=${wantB}, oracle left ${k.b}`);
    assert.equal(k.count, wantCount, `${name}: expected OBJ_SEARCH_COUNT=${wantCount}, oracle left ${k.count}`);
    const diffs = contractDiffs(entry, search75mObjectOverlap);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }

  // Non-vacuity for the short-circuit: on the sweep-1-hit entry the oracle leaves the sweep-2
  // array byte-for-byte as crafted (never scanned/written), and the count is 5 not 10.
  const scEntry = craft(base, { cRef: C, iyRef: Y, s1: [HIT], s2: [HIT, HIT, HIT] });
  const scOracle = runOracle(scEntry);
  assert.equal(scOracle.mem.read8(OBJ_SEARCH_COUNT), SWEEP1_COUNT, "short-circuit: count must stay at the sweep-1 value");
  assert.equal(scOracle.mem.read8((OBJ_ARRAY_65 + 0x00) & 0xffff), 0x01, "short-circuit: sweep-2 record 0 must be left as crafted (active)");

  console.log(`  EQUAL/crafted: ${cases.length} arms (sweep-1 hit, sweep-2 hit@0, sweep-2 hit@3, both-exhausted) identical to the oracle`);
});

test("EQUAL (crafted): the stack-passed tolerances flip sweep 1 and both match the oracle", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80;
  // A sweep-1 record 5 past the axis-1 reference: |dx|+1 = 6. Inside a loose axis-1 tolerance
  // (7) -> sweep-1 hit (count stays 5); outside a tight one (2, no extra span) -> sweep-1 miss,
  // then sweep 2 runs over an all-inactive array -> exhausted (count 10). The pushed tolerance
  // word alone decides which, proving the `pop hl` marshalling is live. The two paths differ in
  // OBJ_SEARCH_COUNT (5 vs 10) and the result byte, so both must track the oracle exactly.
  const s1 = [row({ f5: (C + 5) & 0xff, f3: Y })];

  const loose = craft(base, { bounds: 0x0407, cRef: C, iyRef: Y, s1, s2: [] }); // L=7
  const tight = craft(base, { bounds: 0x0402, cRef: C, iyRef: Y, s1, s2: [] }); // L=2

  const kLoose = classify(loose), kTight = classify(tight);
  assert.notEqual(kLoose.count, kTight.count, "the tolerance change did not flip sweep 1 — case is not exercising the marshalling");
  assert.equal(kLoose.count, SWEEP1_COUNT, "loose tolerance should hit on sweep 1 (count stays 5)");
  assert.equal(kTight.count, SWEEP2_COUNT, "tight tolerance should miss sweep 1 and run sweep 2 (count 10)");

  for (const [label, entry] of [["loose tolerance", loose], ["tight tolerance", tight]]) {
    const diffs = contractDiffs(entry, search75mObjectOverlap);
    assert.equal(diffs.length, 0, `${label}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/tolerances: loose=hit(count ${kLoose.count}) tight=miss(count ${kTight.count}) — both identical to the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** Broken twin (a): drops the short-circuit — always runs sweep 2, even after a sweep-1 hit. */
function brokenNoShortCircuit(m, { iy, c, bounds }) {
  const { mem8 } = m;
  const tolLow = bounds & 0xff, tolHigh = bounds >> 8;
  mem8[OBJ_SEARCH_COUNT] = SWEEP1_COUNT;
  let r = findCollidingObject(m, OBJ_ARRAY_64, c, tolLow, iy, tolHigh, SWEEP1_STRIDE, SWEEP1_COUNT); // BUG: hit ignored
  mem8[OBJ_SEARCH_COUNT] = SWEEP2_COUNT;
  r = findCollidingObject(m, OBJ_ARRAY_65, c, tolLow, iy, tolHigh, SWEEP2_STRIDE, SWEEP2_COUNT);
  return { overlap: r.a, residue: r.b, stride: SWEEP2_STRIDE, base: OBJ_ARRAY_65 };
}

/** Broken twin (b): stores the wrong sweep-2 object count (9 instead of 10). */
function brokenWrongCount(m, { iy, c, bounds }) {
  const { mem8 } = m;
  const tolLow = bounds & 0xff, tolHigh = bounds >> 8;
  mem8[OBJ_SEARCH_COUNT] = SWEEP1_COUNT;
  let r = findCollidingObject(m, OBJ_ARRAY_64, c, tolLow, iy, tolHigh, SWEEP1_STRIDE, SWEEP1_COUNT);
  if (r.hit) return { overlap: r.a, residue: r.b, stride: SWEEP1_STRIDE, base: OBJ_ARRAY_64 };
  mem8[OBJ_SEARCH_COUNT] = SWEEP2_COUNT - 1; // BUG: wrong count stored
  r = findCollidingObject(m, OBJ_ARRAY_65, c, tolLow, iy, tolHigh, SWEEP2_STRIDE, SWEEP2_COUNT);
  return { overlap: r.a, residue: r.b, stride: SWEEP2_STRIDE, base: OBJ_ARRAY_65 };
}

/** Broken twin (c): scans the wrong sweep-2 record count (9 instead of 10), corrupting the
 *  count-minus-index residue on a sweep-2 hit. */
function brokenWrongScanCount(m, { iy, c, bounds }) {
  const { mem8 } = m;
  const tolLow = bounds & 0xff, tolHigh = bounds >> 8;
  mem8[OBJ_SEARCH_COUNT] = SWEEP1_COUNT;
  let r = findCollidingObject(m, OBJ_ARRAY_64, c, tolLow, iy, tolHigh, SWEEP1_STRIDE, SWEEP1_COUNT);
  if (r.hit) return { overlap: r.a, residue: r.b, stride: SWEEP1_STRIDE, base: OBJ_ARRAY_64 };
  mem8[OBJ_SEARCH_COUNT] = SWEEP2_COUNT;
  r = findCollidingObject(m, OBJ_ARRAY_65, c, tolLow, iy, tolHigh, SWEEP2_STRIDE, SWEEP2_COUNT - 1); // BUG: one fewer record
  return { overlap: r.a, residue: r.b, stride: SWEEP2_STRIDE, base: OBJ_ARRAY_65 };
}

test("TEETH: the dropped-short-circuit, wrong-count-store, and wrong-scan-count twins are CAUGHT", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80;
  const HIT = row({ f5: C, f3: Y });

  // (a) dropped short-circuit: on a sweep-1-hit entry the oracle leaves OBJ_SEARCH_COUNT=5,
  // but the twin runs sweep 2 and overwrites it with 10 — caught in RAM at OBJ_SEARCH_COUNT.
  const s1HitEntry = craft(base, { cRef: C, iyRef: Y, s1: [HIT], s2: [HIT, HIT, HIT] });
  const scDiffs = contractDiffs(s1HitEntry, brokenNoShortCircuit);
  assert.ok(scDiffs.length > 0, "the dropped-short-circuit twin escaped — the gate is worthless");
  assert.ok(scDiffs.some((d) => d.startsWith(`RAM@${hx(OBJ_SEARCH_COUNT)}`)),
    `expected the count diff at ${hx(OBJ_SEARCH_COUNT)}, got ${scDiffs.join("; ")}`);

  // (b) wrong sweep-2 count store: on a sweep-2 entry the twin stores 9 — caught in RAM.
  const s2HitEntry = craft(base, { cRef: C, iyRef: Y, s1: [], s2: [HIT] });
  const countDiffs = contractDiffs(s2HitEntry, brokenWrongCount);
  assert.ok(countDiffs.length > 0, "the wrong-count-store twin escaped — the gate is worthless");
  assert.ok(countDiffs.some((d) => d.startsWith(`RAM@${hx(OBJ_SEARCH_COUNT)}`)),
    `expected the count diff at ${hx(OBJ_SEARCH_COUNT)}, got ${countDiffs.join("; ")}`);

  // (c) wrong sweep-2 scan count: correct RAM, but the residue register B diverges on a
  // sweep-2 hit at a later record.
  const s2LaterHit = craft(base, { cRef: C, iyRef: Y, s1: [], s2: [
    row({ active: false }), row({ active: false }), row({ active: false }), HIT,
  ] });
  const scanDiffs = contractDiffs(s2LaterHit, brokenWrongScanCount);
  assert.ok(scanDiffs.length > 0, "the wrong-scan-count twin escaped — the register check is worthless");
  assert.ok(scanDiffs.some((d) => d.startsWith("residue ")),
    `expected the residue diff in the returned tuple, got ${scanDiffs.join("; ")}`);

  console.log(`  TEETH: dropped-short-circuit caught (${scDiffs.find((d) => d.startsWith(`RAM@${hx(OBJ_SEARCH_COUNT)}`))}); wrong-count-store caught (${countDiffs.find((d) => d.startsWith(`RAM@${hx(OBJ_SEARCH_COUNT)}`))}); wrong-scan-count caught (${scanDiffs.find((d) => d.startsWith("residue "))})`);
});
