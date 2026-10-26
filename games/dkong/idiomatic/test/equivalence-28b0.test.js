// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for search50mObjectOverlap (ROM 0x28B0) — run three bounding-box collision sweeps over
 * three object arrays in order, stopping at the first hit.
 *
 * The routine recovers the per-axis tolerances the dispatcher pushed on the stack, then runs
 * three sweeps back to back — OBJ_ARRAY_64 (stride 0x20, 5 records), OBJ_ARRAY_65A0 (stride
 * 0x10, 6 records), OBJ_RECORD_66A0 (stride 0x00, 1 record) — each stamping its record count
 * into OBJ_SEARCH_COUNT before pointing the shared search findCollidingObject at its array. The FIRST
 * sweep that reports a hit takes findCollidingObject's caller-skip return, which abandons the remaining
 * sweeps and hands control back to the dispatch site; if none hit, all three run and the
 * routine returns normally. Its whole observable effect is that memory store (left holding the
 * count of whichever sweep terminated the routine — 5, 6, or 1) plus the search result findCollidingObject
 * leaves in the registers (result byte in A, count-minus-index residue in B).
 *
 * The dissolved arm takes the reference point/tolerances as arguments and RETURNS
 * { overlap, residue, stride, base } — the same four values the oracle leaves in A/B/E/IX. It does
 * no guest-stack ops, so pc/SP are seam artifacts and are not compared; the memory compare excludes
 * the dead STACK_SCRATCH region the oracle's dissolved bracket writes.
 *
 * 0x28B0 is NEVER dispatched during attract (measured 0 over 1500 frames — its collision-handler
 * table arm is reached only through the untranslated dispatcher), so there are no real captured
 * dispatches — the gate is crafted entries covering every arm, each run identically on both sides:
 *
 *   1. EQUAL (crafted) — a hit terminating each of the three sweeps (pinning the per-sweep
 *      OBJ_SEARCH_COUNT and the early-return-on-hit), a full exhaustion, a hit at a later record
 *      within a sweep (the count-minus-index recovery), and two cases with different stack-passed
 *      tolerances that flip the decision (proving the tolerance marshalling is live). Every case:
 *      RAM (minus the stack scratch below the caller frame) and the returned tuple identical to the oracle.
 *
 *   2. TEETH — two broken twins the same suite MUST catch: one that stores the wrong count
 *      (caught in RAM at OBJ_SEARCH_COUNT) and one that drops the early-return-on-hit and runs all
 *      three sweeps unconditionally (caught in RAM and the result registers).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-28b0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_28b0 as oracle } from "../../translated/loc_28b0.js";
import { findCollidingObject } from "../findCollidingObject.js";
import { search50mObjectOverlap } from "../search50mObjectOverlap.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  OBJ_SEARCH_COUNT,
  OBJ_ARRAY_64,
  OBJ_ARRAY_65A0,
  OBJ_RECORD_66A0,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x28b0;
const SP_TOP = 0x6c00;      // stack top — inside STACK_SCRATCH, so every push is excluded
const RETURN_SITE = 0x2870; // where the dispatcher's caller resumes (the routine's normal return)
const IY_BASE = 0x6200;     // reference-point pointer, as the real callers set it (IY+3 = axis-2 ref)

// The three sweeps, in the order the routine runs them: [record base, stride, record count].
const SWEEPS = [
  { base: OBJ_ARRAY_64, stride: 0x20, count: 5 },
  { base: OBJ_ARRAY_65A0, stride: 0x10, count: 6 },
  { base: OBJ_RECORD_66A0, stride: 0x00, count: 1 },
];

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

// Write one sweep's records at `base` (stride `stride`), padding to `count` with inactive rows
// so leftover attract RAM cannot create a stray hit. Stride 0 (sweep 3) writes its single record.
function writeSweep(m, { base, stride, count }, records) {
  const rows = records.slice(0, count);
  while (rows.length < count) rows.push(row({ active: false }));
  for (let i = 0; i < rows.length; i++) {
    const rbase = (base + i * stride) & 0xffff;
    const rec = rows[i];
    for (let off = 0; off < rec.length; off++) m.mem.write8((rbase + off) & 0xffff, rec[off] & 0xff);
  }
}

/**
 * Stamp a crafted 0x28B0 dispatch onto a clone of the base: the dispatcher's stack (the return
 * site below the pushed tolerance word, which `pop hl` recovers), the reference coordinate and
 * reference pointer the dispatcher leaves in registers, and the three object arrays. `bounds` is
 * the pushed HL word — its low byte is the axis-1 tolerance, its high byte the axis-2. `g1/g2/g3`
 * are the records for sweeps 1/2/3 (each padded to its sweep's count with inactive rows).
 */
function craft(base, { g1 = [], g2 = [], g3 = [], bounds = 0x0407, cRef, iyRef }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RETURN_SITE); // the routine's normal return target
  m.push16(bounds);      // the tolerances the dispatcher pushed; `pop hl` recovers them
  m.regs.iy = IY_BASE;
  m.regs.c = cRef & 0xff;
  m.mem.write8((IY_BASE + 3) & 0xffff, iyRef & 0xff);
  writeSweep(m, SWEEPS[0], g1);
  writeSweep(m, SWEEPS[1], g2);
  writeSweep(m, SWEEPS[2], g3);
  // The search inputs the dispatcher hands the idiomatic arm (reference point + tolerance word).
  m._args = { iy: IY_BASE, c: cRef & 0xff, bounds };
  return m;
}

// The search result + terminal count the oracle leaves (result byte in A, residue in B, the
// OBJ_SEARCH_COUNT of whichever sweep terminated the routine).
function classify(entry) {
  const o = entry.clone();
  oracle(o);
  return { hit: o.regs.a === 1, a: o.regs.a, b: o.regs.b, count: o.mem.read8(OBJ_SEARCH_COUNT) };
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x28B0 is NOT dispatched during attract (crafted-entry gate is required)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  // The 0x28B0 collision-handler arm is reached only through the untranslated dispatcher, so the
  // live NMI/substate paths never fire it — this is WHY the gate below is crafted entries.
  assert.equal(count, 0, `expected 0x28B0 to stay dead in attract; saw ${count} dispatches — add captured cases`);
  console.log("  REACHABILITY: 0 natural 0x28B0 dispatches in 1500 frames (dead in attract) -> crafted-entry gate");
});

// -- 1. EQUAL (crafted, each arm pinned) --------------------------------------

test("EQUAL (crafted): a hit terminating each sweep + full exhaustion match the oracle", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80;      // realistic reference coordinates
  const match = { f5: C, f3: Y }; // a record that overlaps the reference on both axes
  const miss = { active: false }; // an inactive slot

  const cases = [
    {
      name: "hit terminates sweep 1 (count 5, residue = 5)",
      opts: { cRef: C, iyRef: Y, g1: [row(match)] }, // g2/g3 padded inactive
      wantHit: true, wantA: 1, wantB: 5, wantCount: 5,
    },
    {
      name: "sweep 1 exhausts, hit terminates sweep 2 (count 6, residue = 6)",
      opts: { cRef: C, iyRef: Y, g1: [row(miss)], g2: [row(match)] },
      wantHit: true, wantA: 1, wantB: 6, wantCount: 6,
    },
    {
      name: "sweeps 1-2 exhaust, hit terminates sweep 3 (count 1, residue = 1)",
      opts: { cRef: C, iyRef: Y, g1: [row(miss)], g2: [row(miss)], g3: [row(match)] },
      wantHit: true, wantA: 1, wantB: 1, wantCount: 1,
    },
    {
      name: "all three sweeps exhaust (result byte 0, count = 1 from sweep 3's write)",
      opts: { cRef: C, iyRef: Y }, // all padded inactive
      wantHit: false, wantA: 0, wantB: 0, wantCount: 1,
    },
    {
      name: "hit at record 2 of sweep 2 (count-minus-index recovery, residue 6-2=4)",
      opts: { cRef: C, iyRef: Y, g2: [
        row({ f5: (C + 40) & 0xff, f3: Y }), // active but axis-1 far -> reject
        row({ f5: (C + 40) & 0xff, f3: Y }), // reject
        row(match),                           // the hit, index 2
        row(match),                           // would also hit, but the scan stops earlier
      ] },
      wantHit: true, wantA: 1, wantB: 6 - 2, wantCount: 6,
    },
  ];

  for (const { name, opts, wantHit, wantA, wantB, wantCount } of cases) {
    const entry = craft(base, opts);
    const k = classify(entry);
    assert.equal(k.hit, wantHit, `${name}: expected ${wantHit ? "hit" : "exhausted"}, oracle did the opposite`);
    assert.equal(k.a, wantA, `${name}: expected result byte A=${wantA}, oracle left ${k.a}`);
    assert.equal(k.b, wantB, `${name}: expected residue B=${wantB}, oracle left ${k.b}`);
    assert.equal(k.count, wantCount, `${name}: expected terminal OBJ_SEARCH_COUNT=${wantCount}, oracle left ${k.count}`);
    const diffs = contractDiffs(entry, search50mObjectOverlap);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (hit@1/2/3, exhausted, later-index) identical to the oracle`);
});

test("EQUAL (crafted): the stack-passed tolerances flip the decision and both match the oracle", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80;
  // A sweep-1 record 5 past the axis-1 reference: |dx|+1 = 6. It is inside a loose axis-1
  // tolerance (7) but outside a tight one (2, with no extra span), so the pushed tolerance word
  // decides the hit. This proves the `pop hl` tolerance marshalling is live, not incidental.
  const g1 = [row({ f5: (C + 5) & 0xff, f3: Y })];

  const loose = craft(base, { bounds: 0x0407, cRef: C, iyRef: Y, g1 }); // L=7
  const tight = craft(base, { bounds: 0x0402, cRef: C, iyRef: Y, g1 }); // L=2

  const kLoose = classify(loose), kTight = classify(tight);
  assert.notEqual(kLoose.hit, kTight.hit, "the tolerance change did not flip the decision — case is not exercising the marshalling");

  for (const [label, entry] of [["loose tolerance", loose], ["tight tolerance", tight]]) {
    const diffs = contractDiffs(entry, search50mObjectOverlap);
    assert.equal(diffs.length, 0, `${label}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/tolerances: loose=${kLoose.hit ? "hit" : "miss"} tight=${kTight.hit ? "hit" : "miss"} — both identical to the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** Broken twin (a): stores the wrong count for sweep 1 (4 instead of 5). */
function brokenCount(m, { iy, c, bounds }) {
  const { mem8 } = m;
  const tolLow = bounds & 0xff, tolHigh = bounds >> 8;
  mem8[OBJ_SEARCH_COUNT] = 0x04; // BUG: wrong count
  let r = findCollidingObject(m, OBJ_ARRAY_64, c, tolLow, iy, tolHigh, 0x20, 0x05);
  if (r.hit) return { overlap: r.a, residue: r.b, stride: 0x20, base: OBJ_ARRAY_64 };
  mem8[OBJ_SEARCH_COUNT] = 0x06;
  r = findCollidingObject(m, OBJ_ARRAY_65A0, c, tolLow, iy, tolHigh, 0x10, 0x06);
  if (r.hit) return { overlap: r.a, residue: r.b, stride: 0x10, base: OBJ_ARRAY_65A0 };
  mem8[OBJ_SEARCH_COUNT] = 0x01;
  r = findCollidingObject(m, OBJ_RECORD_66A0, c, tolLow, iy, tolHigh, 0, 0x01);
  return { overlap: r.a, residue: r.b, stride: 0, base: OBJ_RECORD_66A0 };
}

/** Broken twin (b): drops the early-return-on-hit and runs all three sweeps unconditionally,
 *  so a hit in sweep 1 no longer stops the routine — the later sweeps overwrite the count and
 *  clobber the result. */
function brokenNoSkip(m, { iy, c, bounds }) {
  const { mem8 } = m;
  const tolLow = bounds & 0xff, tolHigh = bounds >> 8;
  mem8[OBJ_SEARCH_COUNT] = 0x05;
  let r = findCollidingObject(m, OBJ_ARRAY_64, c, tolLow, iy, tolHigh, 0x20, 0x05); // BUG: ignores hit
  mem8[OBJ_SEARCH_COUNT] = 0x06;
  r = findCollidingObject(m, OBJ_ARRAY_65A0, c, tolLow, iy, tolHigh, 0x10, 0x06);
  mem8[OBJ_SEARCH_COUNT] = 0x01;
  r = findCollidingObject(m, OBJ_RECORD_66A0, c, tolLow, iy, tolHigh, 0, 0x01);
  return { overlap: r.a, residue: r.b, stride: 0, base: OBJ_RECORD_66A0 };
}

test("TEETH: the wrong-count-store twin and the dropped-early-return twin are CAUGHT", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80;
  // A clean hit in sweep 1 (so sweep 1's count-store is terminal and the early-return matters);
  // sweeps 2 and 3 left inactive so the no-skip twin's continuation demonstrably exhausts them.
  const hitEntry = craft(base, { cRef: C, iyRef: Y, g1: [row({ f5: C, f3: Y })] });

  // Sanity: the oracle really terminates in sweep 1 (count 5, a hit) — the setup this test needs.
  const k = classify(hitEntry);
  assert.equal(k.hit, true, "setup broken: oracle did not hit in sweep 1");
  assert.equal(k.count, 5, `setup broken: oracle terminal count ${k.count} != 5`);

  // (a) wrong count store: caught at OBJ_SEARCH_COUNT (a live cell, not stack scratch).
  const countDiffs = contractDiffs(hitEntry, brokenCount);
  assert.ok(countDiffs.length > 0, "the wrong-count-store twin escaped — the gate is worthless");
  assert.ok(countDiffs.some((d) => d.startsWith(`RAM@${hx(OBJ_SEARCH_COUNT)}`)),
    `expected the count diff at ${hx(OBJ_SEARCH_COUNT)}, got ${countDiffs.join("; ")}`);

  // (b) dropped early-return: the later sweeps run, overwriting the count (5 -> 1) and clobbering
  //     the result byte (hit -> exhausted). Caught in RAM at OBJ_SEARCH_COUNT and in register A.
  const noSkipDiffs = contractDiffs(hitEntry, brokenNoSkip);
  assert.ok(noSkipDiffs.length > 0, "the dropped-early-return twin escaped — the caller-skip is unproven");
  assert.ok(noSkipDiffs.some((d) => d.startsWith(`RAM@${hx(OBJ_SEARCH_COUNT)}`)),
    `expected the count diff at ${hx(OBJ_SEARCH_COUNT)}, got ${noSkipDiffs.join("; ")}`);
  assert.ok(noSkipDiffs.some((d) => d.startsWith("overlap ")),
    `expected the result-byte diff in the returned overlap, got ${noSkipDiffs.join("; ")}`);

  console.log(`  TEETH: wrong-count-store caught (${countDiffs.find((d) => d.startsWith("RAM@"))}); ` +
    `dropped-early-return caught (${noSkipDiffs.find((d) => d.startsWith("RAM@"))}, ${noSkipDiffs.find((d) => d.startsWith("overlap "))})`);
});
