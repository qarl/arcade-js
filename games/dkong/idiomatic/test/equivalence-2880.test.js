// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for search25mObjectOverlap (ROM 0x2880) — run the current board's three bounding-box
 * collision sweeps, stopping at the first overlap.
 *
 * The routine recovers the per-axis tolerances the board dispatcher pushed on the stack, then
 * runs the shared collision search findCollidingObject over three object arrays in turn — OBJ_ARRAY_67
 * (0x6700, 10 records, 0x20 stride), OBJ_ARRAY_64 (0x6400, 5 records, 0x20 stride) and the
 * single OBJ_RECORD_66A0 (0x66A0, stride 0) — stamping each sweep's record count into
 * OBJ_SEARCH_COUNT (0x63B9) first and stopping at the first sweep that hits. Its whole
 * observable effect is that one memory store (its final value = the last executed sweep's
 * count) plus the search result findCollidingObject leaves in the registers (result byte in A, the
 * count-minus-index residue in B).
 *
 * The dissolved arm takes the reference point/tolerances as arguments and RETURNS
 * { overlap, residue, stride, base } — the same four values the oracle leaves in A/B/E/IX. It does
 * no guest-stack ops, so pc/SP are seam artifacts and are not compared; the memory compare excludes
 * the dead STACK_SCRATCH region the oracle's dissolved bracket writes.
 *
 *   1. EQUAL (crafted) — a hit in each of the three sweeps, a hit at a nonzero index (the
 *      count-minus-residue recovery), an all-miss exhausted scan, and a stack-passed tolerance that
 *      flips the decision (proving the tolerance marshalling is live). Every case: RAM (minus
 *      STACK_SCRATCH) and the returned tuple identical to the oracle.
 *
 *   2. EQUAL (captured) — hook 0x2880 in a real 25m attract run and confirm search25mObjectOverlap == oracle
 *      on every real dispatch (both the exhausted and, occasionally, the hit outcome occur).
 *
 *   3. TEETH — three broken twins the same suite MUST catch: one that stores the wrong sweep-1
 *      count (caught in RAM at OBJ_SEARCH_COUNT), one that does NOT stop after a hit and keeps
 *      sweeping (caught in RAM + registers — justifies the early return), and one that scans
 *      the hitting sweep with the wrong record count (caught in the count-minus-B register
 *      residue).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2880.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2880 as oracle } from "../../translated/loc_2880.js";
import { findCollidingObject } from "../findCollidingObject.js";
import { search25mObjectOverlap } from "../search25mObjectOverlap.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, OBJ_SEARCH_COUNT, OBJ_ARRAY_67, OBJ_ARRAY_64, OBJ_RECORD_66A0 } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2880;
const SP_TOP = 0x6c00;        // stack top — inside STACK_SCRATCH, so every push is excluded
const RETURN_SITE = 0x2808;   // where the caller-skip / normal return both unwind to (the search's caller's caller)
const RECORD_STRIDE = 0x20;   // the stride-0x20 arrays' record stride
const IY_BASE = 0x6200;       // reference-point pointer, as the real callers set it (IY+3 = axis-2 ref)

// The three sweeps, in order: [array base, record count].
const SWEEPS = [
  [OBJ_ARRAY_67, 0x0a],
  [OBJ_ARRAY_64, 0x05],
  [OBJ_RECORD_66A0, 0x01],
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

// A record that overlaps the reference point on both axes (dx=dy=0 -> inside any base window).
const hitRow = (cRef, iyRef) => row({ f5: cRef, f3: iyRef });

// Zero every record slot in all three sweep arrays, so only the records we place are active,
// then write the caller-supplied records into each sweep's array.
function stampArrays(m, [recs1, recs2, recs3]) {
  const all = [
    [OBJ_ARRAY_67, RECORD_STRIDE, 10],
    [OBJ_ARRAY_64, RECORD_STRIDE, 5],
    [OBJ_RECORD_66A0, RECORD_STRIDE, 1],
  ];
  for (const [base, stride, count] of all) {
    for (let i = 0; i < count; i++) {
      const rbase = (base + i * stride) & 0xffff;
      for (let off = 0; off < 11; off++) m.mem.write8((rbase + off) & 0xffff, 0x00);
    }
  }
  const provided = [[OBJ_ARRAY_67, recs1], [OBJ_ARRAY_64, recs2], [OBJ_RECORD_66A0, recs3]];
  for (const [base, recs] of provided) {
    for (let i = 0; i < (recs?.length ?? 0); i++) {
      const rbase = (base + i * RECORD_STRIDE) & 0xffff;
      const rec = recs[i];
      for (let off = 0; off < rec.length; off++) m.mem.write8((rbase + off) & 0xffff, rec[off] & 0xff);
    }
  }
}

/**
 * Stamp a crafted 0x2880 dispatch onto a clone of the base: the dispatcher's stack (the return
 * site below the pushed tolerance word, which the `pop hl` recovers), the reference coordinate
 * and reference pointer the dispatcher leaves in registers, and the three sweep arrays. `bounds`
 * is the pushed HL word — its low byte is the axis-1 tolerance, its high byte the axis-2.
 * `sweeps` = [records1, records2, records3], one record list per sweep (empty = all inactive).
 */
function craft(base, { sweeps = [[], [], []], bounds = 0x0407, cRef, iyRef }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RETURN_SITE); // the oracle's normal / caller-skip return target
  m.push16(bounds);      // the tolerances the oracle's `pop hl` recovers
  m.regs.iy = IY_BASE;
  m.regs.c = cRef & 0xff;
  m.mem.write8((IY_BASE + 3) & 0xffff, iyRef & 0xff);
  stampArrays(m, sweeps);
  // The search inputs the dispatcher hands the idiomatic arm (reference point + tolerance word).
  m._args = { iy: IY_BASE, c: cRef & 0xff, bounds };
  return m;
}

// The search result the oracle leaves (result byte in A, count-minus-index residue in B), plus
// the final OBJ_SEARCH_COUNT value the oracle stamps.
function classify(entry) {
  const o = entry.clone();
  oracle(o);
  return { hit: o.regs.a === 1, a: o.regs.a, b: o.regs.b, count: o.mem.read8(OBJ_SEARCH_COUNT) };
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2880 is dispatched during 25m attract", () => {
  let count = 0, hits = 0;
  const snap = new Map([[TARGET, (mm) => { count++; const r = oracle(mm); if (r === false) hits++; return r; }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(count > 0, "0x2880 should be dispatched — the 25m barrel-collision handler runs during the demo");
  console.log(`  REACHABILITY: ${count} natural 0x2880 dispatches in 1500 frames (${hits} hits)`);
});

// -- 1. EQUAL (crafted, each arm pinned) --------------------------------------

test("EQUAL (crafted): a hit in each sweep, the count-minus-B recovery, and the all-miss path", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80; // realistic reference coordinates

  const cases = [
    {
      name: "hit in sweep 1 (0x6700), index 0 -> count 0x0a stamped, B = 10",
      opts: { cRef: C, iyRef: Y, sweeps: [[hitRow(C, Y)], [], []] },
      wantHit: true, wantB: 0x0a, wantCount: 0x0a,
    },
    {
      name: "hit in sweep 1 at index 3 (count-minus-B recovery)",
      opts: { cRef: C, iyRef: Y, sweeps: [[
        row({ active: false }),
        row({ f5: 0x00, fA: 0x02 }),   // active but axis-1 far -> reject
        row({ active: false }),
        hitRow(C, Y),                  // the hit, index 3
        hitRow(C, Y),                  // would also hit, but the scan stops earlier
      ], [], []] },
      wantHit: true, wantB: 0x0a - 3, wantCount: 0x0a,
    },
    {
      name: "miss sweep 1, hit in sweep 2 (0x6400) -> count 0x05 stamped, B = 5",
      opts: { cRef: C, iyRef: Y, sweeps: [[], [hitRow(C, Y)], []] },
      wantHit: true, wantB: 0x05, wantCount: 0x05,
    },
    {
      name: "miss sweeps 1+2, hit in sweep 3 (0x66a0) -> count 0x01 stamped, B = 1",
      opts: { cRef: C, iyRef: Y, sweeps: [[], [], [hitRow(C, Y)]] },
      wantHit: true, wantB: 0x01, wantCount: 0x01,
    },
    {
      name: "all three sweeps miss -> count 0x01 stamped last, result byte 0",
      opts: { cRef: C, iyRef: Y, sweeps: [[], [], []] },
      wantHit: false, wantB: 0x00, wantCount: 0x01,
    },
  ];

  for (const { name, opts, wantHit, wantB, wantCount } of cases) {
    const entry = craft(base, opts);
    const k = classify(entry);
    assert.equal(k.hit, wantHit, `${name}: expected ${wantHit ? "hit" : "miss"}, oracle did the opposite`);
    assert.equal(k.b, wantB, `${name}: expected residue B=${wantB}, oracle left ${k.b}`);
    assert.equal(k.count, wantCount, `${name}: expected final OBJ_SEARCH_COUNT=${wantCount}, oracle stamped ${k.count}`);
    const diffs = contractDiffs(entry, search25mObjectOverlap);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (hit@sweep1/1-idx3/2/3, all-miss) identical to the oracle`);
});

test("EQUAL (crafted): the stack-passed tolerances flip the decision and both match the oracle", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80;
  // A sweep-1 record 5 past the axis-1 reference: |dx|+1 = 6. Inside a loose axis-1 tolerance
  // (7) but outside a tight one (2, with no extra span), so the pushed tolerance word decides
  // the hit. This proves the `pop hl` tolerance marshalling is live, not incidental.
  const sweeps = [[row({ f5: (C + 5) & 0xff, f3: Y })], [], []];

  const loose = craft(base, { bounds: 0x0407, cRef: C, iyRef: Y, sweeps }); // L=7
  const tight = craft(base, { bounds: 0x0402, cRef: C, iyRef: Y, sweeps }); // L=2

  const kLoose = classify(loose), kTight = classify(tight);
  assert.notEqual(kLoose.hit, kTight.hit, "the tolerance change did not flip the decision — case is not exercising the marshalling");

  for (const [label, entry] of [["loose tolerance", loose], ["tight tolerance", tight]]) {
    const diffs = contractDiffs(entry, search25mObjectOverlap);
    assert.equal(diffs.length, 0, `${label}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/tolerances: loose=${kLoose.hit ? "hit" : "miss"} tight=${kTight.hit ? "hit" : "miss"} — both identical to the oracle`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): search25mObjectOverlap == oracle on every real 0x2880 dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 400) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x2880 dispatch during attract");

  let hits = 0, exhausted = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, search25mObjectOverlap);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    if (classify(entry).hit) hits++; else exhausted++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical (${hits} hit, ${exhausted} exhausted)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): stores the wrong sweep-1 count (9 instead of 10). */
function brokenSweep1Count(m, { iy, c, bounds }) {
  const { mem8 } = m;
  const tolLow = bounds & 0xff, tolHigh = bounds >> 8;
  mem8[OBJ_SEARCH_COUNT] = 0x09; // BUG: wrong count stamped for sweep 1
  let r = findCollidingObject(m, OBJ_ARRAY_67, c, tolLow, iy, tolHigh, 0x20, 0x0a);
  if (r.hit) return { overlap: r.a, residue: r.b, stride: 0x20, base: OBJ_ARRAY_67 };
  mem8[OBJ_SEARCH_COUNT] = 0x05;
  r = findCollidingObject(m, OBJ_ARRAY_64, c, tolLow, iy, tolHigh, 0x20, 0x05);
  if (r.hit) return { overlap: r.a, residue: r.b, stride: 0x20, base: OBJ_ARRAY_64 };
  mem8[OBJ_SEARCH_COUNT] = 0x01;
  r = findCollidingObject(m, OBJ_RECORD_66A0, c, tolLow, iy, tolHigh, 0, 0x01);
  return { overlap: r.a, residue: r.b, stride: 0, base: OBJ_RECORD_66A0 };
}

/** Broken twin (b): does NOT stop after a hit — keeps running the later sweeps, which
 *  overwrite OBJ_SEARCH_COUNT and clobber the hit's result. */
function brokenNoEarlyStop(m, { iy, c, bounds }) {
  const { mem8 } = m;
  const tolLow = bounds & 0xff, tolHigh = bounds >> 8;
  mem8[OBJ_SEARCH_COUNT] = 0x0a;
  let r = findCollidingObject(m, OBJ_ARRAY_67, c, tolLow, iy, tolHigh, 0x20, 0x0a); // BUG: no early return
  mem8[OBJ_SEARCH_COUNT] = 0x05;
  r = findCollidingObject(m, OBJ_ARRAY_64, c, tolLow, iy, tolHigh, 0x20, 0x05);
  mem8[OBJ_SEARCH_COUNT] = 0x01;
  r = findCollidingObject(m, OBJ_RECORD_66A0, c, tolLow, iy, tolHigh, 0, 0x01);
  return { overlap: r.a, residue: r.b, stride: 0, base: OBJ_RECORD_66A0 };
}

/** Broken twin (c): scans the hitting sweep with the wrong record count (9 instead of 10),
 *  corrupting the count-minus-index residue. */
function brokenScanCount(m, { iy, c, bounds }) {
  const { mem8 } = m;
  const tolLow = bounds & 0xff, tolHigh = bounds >> 8;
  mem8[OBJ_SEARCH_COUNT] = 0x0a;
  let r = findCollidingObject(m, OBJ_ARRAY_67, c, tolLow, iy, tolHigh, 0x20, 0x09); // BUG: scans 9 records
  if (r.hit) return { overlap: r.a, residue: r.b, stride: 0x20, base: OBJ_ARRAY_67 };
  mem8[OBJ_SEARCH_COUNT] = 0x05;
  r = findCollidingObject(m, OBJ_ARRAY_64, c, tolLow, iy, tolHigh, 0x20, 0x05);
  if (r.hit) return { overlap: r.a, residue: r.b, stride: 0x20, base: OBJ_ARRAY_64 };
  mem8[OBJ_SEARCH_COUNT] = 0x01;
  r = findCollidingObject(m, OBJ_RECORD_66A0, c, tolLow, iy, tolHigh, 0, 0x01);
  return { overlap: r.a, residue: r.b, stride: 0, base: OBJ_RECORD_66A0 };
}

test("TEETH: the wrong-count-store, no-early-stop, and wrong-scan-count twins are CAUGHT", () => {
  const base = attractBase();
  const C = 0x64, Y = 0x80;

  // (a) wrong sweep-1 count store: on a sweep-1 hit the final OBJ_SEARCH_COUNT is 0x0a, so a
  // 0x09 store is caught in RAM at OBJ_SEARCH_COUNT (a live cell, not stack scratch).
  const hit1 = craft(base, { cRef: C, iyRef: Y, sweeps: [[hitRow(C, Y)], [], []] });
  const countDiffs = contractDiffs(hit1, brokenSweep1Count);
  assert.ok(countDiffs.length > 0, "the wrong-count-store twin escaped — the gate is worthless");
  assert.ok(countDiffs.some((d) => d.startsWith(`RAM@${hx(OBJ_SEARCH_COUNT)}`)),
    `expected the count diff at ${hx(OBJ_SEARCH_COUNT)}, got ${countDiffs.join("; ")}`);

  // (b) no early stop after a hit: the later sweeps overwrite OBJ_SEARCH_COUNT (0x0a -> 0x01)
  // and clobber the hit's A/B, so it is caught in RAM and/or registers.
  const stopDiffs = contractDiffs(hit1, brokenNoEarlyStop);
  assert.ok(stopDiffs.length > 0, "the no-early-stop twin escaped — the early return is unproven");

  // (c) wrong scan count on the hitting sweep: correct RAM, but the residue register B diverges.
  // Hit at index 3 so both counts (10 and 9) still reach it and the residue differs (7 vs 6).
  const hit1idx3 = craft(base, {
    cRef: C, iyRef: Y,
    sweeps: [[row({ active: false }), row({ active: false }), row({ active: false }), hitRow(C, Y)], [], []],
  });
  const scanDiffs = contractDiffs(hit1idx3, brokenScanCount);
  assert.ok(scanDiffs.length > 0, "the wrong-scan-count twin escaped — the residue check is worthless");
  assert.ok(scanDiffs.some((d) => d.startsWith("residue ")),
    `expected the residue diff in the returned tuple, got ${scanDiffs.join("; ")}`);

  console.log(`  TEETH: wrong-count-store caught (${countDiffs.find((d) => d.startsWith("RAM@"))}); ` +
    `no-early-stop caught (${stopDiffs[0]}); wrong-scan-count caught (${scanDiffs.find((d) => d.startsWith("residue "))})`);
});
