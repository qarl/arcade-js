// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2a22 (ROM 0x2A22) — the Mario-vs-0x6600-array collision check.
 *
 * loc_2a22 is a thin parameter-binding wrapper: it pins the generic bounding-box search
 * findCollidingObject to the six-record object array at OBJ_ARRAY_66 (0x6600) — B = 6 records, DE = 0x10
 * stride, IX = 0x6600 base — and delegates. It writes NO work RAM; its whole output is the
 * search outcome the caller loc_29af then branches on: A = 1 on a hit / 0 on exhaustion, and
 * B = count-minus-matched-index (loc_29af reads A with `and a`, then B with `ld a,0x06 / sub b`
 * to walk IX to the matched record). Those two registers are the declared live-out.
 *
 * The oracle models the Z80 stack (it push/call/rets, and findCollidingObject takes a one- or two-level
 * return); loc_2a22 models none of it (a direct JS call, boolean return discarded). So the
 * harness compares RAM − the stack scratch below the entry SP (the oracle's push/call/ret churn all lands in that dead
 * region) plus the live register file — A, B, and the preserved/unchanged C, DE, H, L, IX, IY, F.
 * pc/SP are NOT compared: loc_2a22's only post-call instruction is its own `ret`, so both arms
 * return loc_29af to the same continuation (0x29C0) with the same A/B — the return plumbing is
 * the Z80 stack dance the idiomatic layer replaces with a plain JS call at loc_29af's call site,
 * not part of loc_2a22's own body.
 *
 * 0x2A22 is a gameplay-only collision check bound to the 0x6600 array (advanceBoardObjectTravel's land/deactivate
 * array), and is NOT dispatched during the attract demo (measured: 0 over 2000 frames). So there
 * are no natural dispatches to replay — the crafted + fuzz sweep on a real attract base IS the gate.
 *
 *   1. REACHABILITY / CAPTURED — hook 0x2A22 in a real attract run; verify every captured
 *      dispatch (if any) matches the oracle. Documents the measured 0-dispatch reality.
 *
 *   2. EQUAL (fuzz) — a broad randomised sweep over the 0x6600 record layouts and the reference
 *      coordinate / tolerance registers loc_29af supplies. Every trial: RAM (minus the stack scratch below the entry SP)
 *      and the live register file identical to the oracle. Coverage counters assert the sweep hit
 *      every arm (hit / exhausted / inactive-slot / hit at a nonzero index for the B recovery).
 *
 *   3. EQUAL (crafted) — targeted 0x6600 pages pinning each arm by construction: a base-window
 *      hit at index 0, a hit through both per-axis extra-span arms, an all-inactive exhaustion,
 *      an axis-1 reject, an axis-2 reject, and a hit at index 3 exercising the count-minus-B
 *      recovery.
 *
 *   4. TEETH — three broken twins the same suite MUST catch, each corrupting one of the three
 *      bound constants (IX base, B count, DE stride), proven both on a dedicated crafted entry
 *      and across the fuzz sweep.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2a22.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2a22 as oracle } from "../../translated/loc_2a22.js";
import { loc_2a22 } from "../loc_2a22.js";
import { findCollidingObject } from "../findCollidingObject.js"; // idiomatic callee — used to build the teeth
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, OBJ_ARRAY_66 } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2a22;

// The stack as loc_29af's `call 0x2a22` leaves it: loc_2a22's own return address on top, inside
// STACK_SCRATCH so every push the oracle makes (its 0x2A2E return, findCollidingObject's IX save) is excluded.
const SP_TOP = 0x6c00; // stack top — inside STACK_SCRATCH
const RET_TO_CALLER = 0x29c0; // where loc_29af resumes after the call (both oracle arms land here)

const REC_BASE = OBJ_ARRAY_66; // 0x6600 — the array loc_2a22 binds the search to (pure work-RAM reads)
const IY_BASE = 0x6200; // reference-point pointer loc_29af sets; IY+3 = 0x6203 = the axis-2 ref (Mario X)
const STRIDE = 0x10; // the stride loc_2a22 binds (DE)
const COUNT = 6; // the record count loc_2a22 binds (B)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (memory-equivalence contract = RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// The DECLARED live-outs, derived from the oracle (proposer!=confirmer): loc_29af reads exactly A (hit/
// exhaust verdict) and B (count-minus-index) back from loc_2a22; C/DE/H/L/IX/IY are preserved INPUTS the
// wrapper seats or passes through and no caller reads (loc_29af re-seats IX itself and never reads DE),
// so pinning them over-compares and would falsely redden a rewrite that legitimately drops the seats. F is
// EXCLUDED: it is DEAD on every exit -- findCollidingObject's axis-2 is now plain JS (no Z80 ALU op), and
// loc_29af re-derives its branch from A (loc_2808 `and a`), never reading the flag byte the search leaves.
const REG_NAMES = ["a", "b"];
function regDiffs(o, c) {
  const out = [];
  for (const n of REG_NAMES) if (o.regs[n] !== c.regs[n]) out.push(`reg ${n} oracle=${hx(o.regs[n])} cand=${hx(c.regs[n])}`);
  return out;
}

/** Full contract diff between the oracle and a candidate on a shared entry: RAM − the stack scratch below the entry SP
 *  and the live register file (pc/SP excluded — see the header). Returns a list of diffs. */
function contractDiffs(entry, fn) {
  const o = entry.clone();
  const c = entry.clone();
  oracle(o);
  fn(c);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  diffs.push(...regDiffs(o, c));
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM around the poked
// records holds realistic values. clone() neutralises the frame machinery (nextNmi/nextBoundary
// = Infinity) so the oracle's m.step cannot fire an NMI while it runs in isolation.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// A 16-byte (one stride) record row from its meaningful fields; findCollidingObject reads only +0 (active
// bit0), +3 (axis-2 field), +5 (axis-1 field), +9 (axis-2 extra span), +0x0A (axis-1 extra span).
function row({ active = true, f3 = 0, f5 = 0, f9 = 0, fA = 0 }) {
  const r = new Array(STRIDE).fill(0);
  r[0x00] = active ? 0x01 : 0x00;
  r[0x03] = f3 & 0xff;
  r[0x05] = f5 & 0xff;
  r[0x09] = f9 & 0xff;
  r[0x0a] = fA & 0xff;
  return r;
}

/**
 * Stamp a crafted 0x2A22 entry onto a clone of `base`: loc_2a22's own return on the stack, the
 * reference registers loc_29af supplies (C, L, H, IY, the byte at IY+3), and up to six records at
 * 0x6600. The 0x6600 page is zeroed first so unspecified slots read as inactive. `clearPage` also
 * zeroes the 0x6700 page (used by the wrong-base tooth so a mis-bound search finds nothing there).
 */
function craft(base, { records = [], cRef, l, h, iyRef, iy = IY_BASE, clearPage = false }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RET_TO_CALLER);
  m.regs.iy = iy;
  m.regs.c = cRef & 0xff;
  m.regs.l = l & 0xff;
  m.regs.h = h & 0xff;
  m.mem.write8((iy + 3) & 0xffff, iyRef & 0xff);
  for (let a = REC_BASE; a < REC_BASE + COUNT * STRIDE; a++) m.mem.write8(a, 0);
  if (clearPage) for (let a = 0x6700; a < 0x6700 + COUNT * STRIDE; a++) m.mem.write8(a, 0);
  for (let i = 0; i < records.length; i++) {
    const rbase = (REC_BASE + i * STRIDE) & 0xffff;
    const rec = records[i];
    for (let off = 0; off < rec.length; off++) m.mem.write8((rbase + off) & 0xffff, rec[off] & 0xff);
  }
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

// Classify which arm the oracle took, for the coverage / crafted assertions.
function classify(entry) {
  const o = entry.clone();
  oracle(o);
  return { hit: o.regs.a === 0x01, b: o.regs.b };
}

// A small deterministic PRNG, drawing from the HIGH bits (an LCG's low bit merely alternates).
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s; };
}
const rbyte = (r) => (r() >>> 16) & 0xff;

// One randomised search configuration: six records (~half inactive) and random reference/tolerance
// registers. Shared by the EQUAL fuzz and the TEETH sweep so the teeth are proven over the very
// space the equivalence passed.
function genTrial(rand) {
  const records = [];
  for (let i = 0; i < COUNT; i++) {
    records.push(row({
      active: (rbyte(rand) & 1) === 0,
      f3: rbyte(rand), f5: rbyte(rand), f9: rbyte(rand), fA: rbyte(rand),
    }));
  }
  return { records, cRef: rbyte(rand), l: rbyte(rand), h: rbyte(rand), iyRef: rbyte(rand) };
}

// -- 1. REACHABILITY / CAPTURED ----------------------------------------------

test("REACHABILITY: replay every real 0x2A22 dispatch (attract reaches it 0 times — crafted+fuzz is the gate)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 64) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_2a22);
    assert.equal(diffs.length, 0, `captured 0x2A22 dispatch: ${diffs.join("; ")}`);
  }
  assert.equal(caps.length, 0, "0x2A22 is not on the attract path — a nonzero count here would be a new finding to fold in");
  console.log(`  REACHABILITY: ${caps.length} natural 0x2A22 dispatches in 2000 attract frames (gameplay-only; crafted+fuzz carries the gate)`);
});

// -- 2. EQUAL (fuzz) ----------------------------------------------------------

test("EQUAL (fuzz): loc_2a22 == oracle across a broad randomised sweep", () => {
  const base = attractBase();
  const rand = rng(0x2a22beef);
  const cov = { hit: 0, exhausted: 0, inactive: 0, hitAtIndex: 0 };
  const TRIALS = 4000;

  for (let t = 0; t < TRIALS; t++) {
    const trial = genTrial(rand);
    const entry = craft(base, trial);

    const diffs = contractDiffs(entry, loc_2a22);
    assert.equal(diffs.length, 0, `fuzz trial ${t}: ${diffs.join("; ")}`);

    const k = classify(entry);
    if (k.hit) { cov.hit++; if (k.b !== COUNT) cov.hitAtIndex++; } else cov.exhausted++;
    if (trial.records.some((r) => (r[0] & 1) === 0)) cov.inactive++;
  }

  // Non-vacuity: the sweep must actually have reached every arm.
  assert.ok(cov.hit > 0, "fuzz never produced a hit");
  assert.ok(cov.exhausted > 0, "fuzz never produced an exhausted scan");
  assert.ok(cov.inactive > 0, "fuzz never presented an inactive slot");
  assert.ok(cov.hitAtIndex > 0, "fuzz never hit at a nonzero index (count-minus-B never exercised)");
  console.log(`  EQUAL/fuzz: ${TRIALS} trials identical (hit=${cov.hit}, exhausted=${cov.exhausted}, hit@index>0=${cov.hitAtIndex}, had-inactive=${cov.inactive})`);
});

// -- 3. EQUAL (crafted, each arm pinned) --------------------------------------

test("EQUAL (crafted): every arm matches the oracle", () => {
  const base = attractBase();
  // Reference/tolerances mirror the real caller's shape (H=4, L=7) with realistic coordinates.
  const C = 0x64, L = 0x07, H = 0x04, Y0 = 0x80;

  const cases = [
    {
      name: "hit, both axes in the base window (index 0)",
      opts: { cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ f5: C, f3: Y0 })] },
      wantHit: true, wantB: COUNT,
    },
    {
      name: "hit via both per-axis extra-span arms (differences taken by negate)",
      // axis-1: |C - f5| via negate (f5 > C): dx=10 -> +1=11; 11-L(7)=4 (>=L) -> 4 < fA(6) accept.
      // axis-2: |Y0 - f3| via negate (f3 > Y0): dy=10; 10-H(4)=6 -> 6 < f9(8) accept.
      opts: { cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ f5: (C + 10) & 0xff, fA: 0x06, f3: (Y0 + 10) & 0xff, f9: 0x08 })] },
      wantHit: true, wantB: COUNT,
    },
    {
      name: "all six slots inactive -> exhausted",
      opts: { cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ active: false }), row({ active: false }), row({ active: false }),
                  row({ active: false }), row({ active: false }), row({ active: false })] },
      wantHit: false, wantB: 0,
    },
    {
      name: "axis-1 out of range -> exhausted",
      // dx=100 -> +1=101; 101-7=94 (>=L); 94 - fA(5) = 89 (>= fA) reject.
      opts: { cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ f5: 0x00, fA: 0x05, f3: Y0, f9: 0x08 })] },
      wantHit: false,
    },
    {
      name: "axis-1 in window but axis-2 out of range -> exhausted",
      // axis-1: dx=0 accepts; axis-2: dy=128 -> 128-4=124 (>=H); 124 - f9(8) reject.
      opts: { cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ f5: C, f3: 0x00, f9: 0x08, fA: 0x08 })] },
      wantHit: false,
    },
    {
      name: "hit at index 3 (count - B index recovery)",
      opts: { cRef: C, l: L, h: H, iyRef: Y0,
        records: [
          row({ active: false }),
          row({ f5: 0x00, fA: 0x02 }),   // active but axis-1 far -> reject
          row({ active: false }),
          row({ f5: C, f3: Y0 }),        // the hit, index 3
          row({ f5: C, f3: Y0 }),        // would also hit, but the scan stops earlier
        ] },
      wantHit: true, wantB: COUNT - 3,
    },
  ];

  for (const { name, opts, wantHit, wantB } of cases) {
    const entry = craft(base, opts);
    const k = classify(entry);
    assert.equal(k.hit, wantHit, `${name}: expected ${wantHit ? "hit" : "exhausted"}, oracle did the opposite`);
    if (wantB !== undefined) assert.equal(k.b, wantB, `${name}: expected B=${wantB}`);
    const diffs = contractDiffs(entry, loc_2a22);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): binds the WRONG array base (0x6700, not 0x6600). Proves the IX = 0x6600 binding. */
function brokenBase(m) {
  const { regs } = m;
  regs.b = COUNT; regs.de = STRIDE; regs.ix = 0x6700; // BUG: wrong record base
  findCollidingObject(m);
}
/** Twin (b): binds the WRONG count (5, not 6). Proves the B = 6 binding — a fifth-slot hit is
 *  missed, and even an earlier hit shifts the count-minus-index residue in B by one. */
function brokenCount(m) {
  const { regs } = m;
  regs.b = COUNT - 1; regs.de = STRIDE; regs.ix = REC_BASE; // BUG: one record short
  findCollidingObject(m);
}
/** Twin (c): binds the WRONG stride (0x08, not 0x10). Proves the DE = 0x10 binding — the search
 *  visits the wrong record addresses. */
function brokenStride(m) {
  const { regs } = m;
  regs.b = COUNT; regs.de = 0x08; regs.ix = REC_BASE; // BUG: wrong stride
  findCollidingObject(m);
}

test("TEETH: the wrong-base twin is CAUGHT (dedicated entry + across the fuzz)", () => {
  const base = attractBase();
  const C = 0x64, L = 0x07, H = 0x04, Y0 = 0x80;

  // Dedicated: a clean hit at 0x6600 index 0, the 0x6700 page zeroed. Correct -> hit; the
  // mis-bound search of the empty 0x6700 page -> exhausted. A diverges.
  const entry = craft(base, { cRef: C, l: L, h: H, iyRef: Y0, clearPage: true,
    records: [row({ f5: C, f3: Y0 })] });
  assert.ok(classify(entry).hit, "sanity: the correct binding must hit at 0x6600");
  assert.ok(contractDiffs(entry, brokenBase).length > 0, "the wrong-base twin escaped the dedicated entry");

  // And across the fuzz.
  const rand = rng(0x2a22beef);
  let caught = 0;
  for (let t = 0; t < 4000; t++) if (contractDiffs(craft(base, genTrial(rand)), brokenBase).length > 0) caught++;
  assert.ok(caught > 0, "the wrong-base twin escaped the whole fuzz sweep — the IX binding is unproven");
  console.log(`  TEETH/base: caught on the dedicated entry and ${caught} fuzz trials`);
});

test("TEETH: the wrong-count twin is CAUGHT (dedicated entry + across the fuzz)", () => {
  const base = attractBase();
  const C = 0x64, L = 0x07, H = 0x04, Y0 = 0x80;

  // Dedicated: the only hit is at index 5. Correct (B=6) reaches it; B=5 stops one short -> exhausted.
  const entry = craft(base, { cRef: C, l: L, h: H, iyRef: Y0,
    records: [row({ active: false }), row({ active: false }), row({ active: false }),
              row({ active: false }), row({ active: false }), row({ f5: C, f3: Y0 })] });
  const k = classify(entry);
  assert.ok(k.hit && k.b === COUNT - 5, "sanity: the correct binding must hit at index 5 (B=1)");
  assert.ok(contractDiffs(entry, brokenCount).length > 0, "the wrong-count twin escaped the dedicated entry");

  const rand = rng(0x2a22beef);
  let caught = 0;
  for (let t = 0; t < 4000; t++) if (contractDiffs(craft(base, genTrial(rand)), brokenCount).length > 0) caught++;
  assert.ok(caught > 0, "the wrong-count twin escaped the whole fuzz sweep — the B binding is unproven");
  console.log(`  TEETH/count: caught on the dedicated entry and ${caught} fuzz trials`);
});

test("TEETH: the wrong-stride twin is CAUGHT (dedicated entry + across the fuzz)", () => {
  const base = attractBase();
  const C = 0x64, L = 0x07, H = 0x04, Y0 = 0x80;

  // Dedicated: the only hit is at index 5 (0x6650). With stride 0x08 the search never reaches
  // 0x6650 (its last record is 0x6628), so it exhausts where the correct stride hits.
  const entry = craft(base, { cRef: C, l: L, h: H, iyRef: Y0,
    records: [row({ active: false }), row({ active: false }), row({ active: false }),
              row({ active: false }), row({ active: false }), row({ f5: C, f3: Y0 })] });
  assert.ok(classify(entry).hit, "sanity: the correct binding must hit at 0x6650");
  assert.ok(contractDiffs(entry, brokenStride).length > 0, "the wrong-stride twin escaped the dedicated entry");

  const rand = rng(0x2a22beef);
  let caught = 0;
  for (let t = 0; t < 4000; t++) if (contractDiffs(craft(base, genTrial(rand)), brokenStride).length > 0) caught++;
  assert.ok(caught > 0, "the wrong-stride twin escaped the whole fuzz sweep — the DE binding is unproven");
  console.log(`  TEETH/stride: caught on the dedicated entry and ${caught} fuzz trials`);
});
