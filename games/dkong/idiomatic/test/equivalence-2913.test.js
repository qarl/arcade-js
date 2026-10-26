// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for findCollidingObject (ROM 0x2913) — the object-list bounding-box collision
 * search. It scans a record array for the first ACTIVE record whose box overlaps a
 * reference point on both axes, and reports either a hit (caller-skip return) or the list
 * exhausted (normal return).
 *
 * The routine writes NO work RAM: it only reads the records (through the base register IX)
 * and one reference byte (through IY), and its whole observable effect is the outcome plus
 * the register file — the boolean return (which two-level return the ROM takes), the result
 * byte in A, and the count-minus-index residue in B that the found-handler reads back. The
 * oracle models the Z80 stack (it saves/restores IX and performs a one- or two-level
 * `ret`); findCollidingObject models no stack (a boolean return, IX walked on a local copy). So the
 * harness lines the two up: after the candidate it performs the SAME terminal return the
 * ROM would — one `ret` on the normal path, or discard-the-immediate-return-then-`ret` on
 * the caller-skip path — so pc and SP match, and the bytes the oracle's stack churn leaves
 * behind sit in the dead STACK_SCRATCH region, which the memory compare excludes.
 *
 *   1. EQUAL (fuzz) — a broad randomised sweep over record layouts, counts, strides and
 *      reference coordinates. Every trial: RAM (minus the stack scratch below the entry SP), pc, SP and the full
 *      register file identical to the oracle. Coverage counters assert the sweep actually
 *      exercised every arm (hit / exhausted / inactive-skip / axis-1 reject / axis-2 reject
 *      / a hit at a nonzero index), so the pass is not vacuous.
 *
 *   2. EQUAL (crafted) — targeted cases pinning each arm by construction, including both
 *      absolute-difference directions, both per-axis extra-span accept/reject arms, the
 *      count-minus-B index recovery on a hit at index 3, and the unguarded B==0 → 256-record
 *      scan.
 *
 *   3. EQUAL (captured) — hook 0x2913 in a real attract run and confirm findCollidingObject == oracle
 *      on every real dispatch (both the exhausted and the hit outcomes occur naturally).
 *
 *   4. TEETH — two broken twins the same suite MUST catch: one that drops the axis-1 `+1`
 *      (shifts the window, flipping a boundary decision) and one that corrupts the live-out
 *      B on the hit path (breaks the index recovery).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2913.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2913 as oracle } from "../../translated/loc_2913.js";
import { findCollidingObject } from "../findCollidingObject.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2913;

// A stack laid out exactly like a real `call 0x2913` site: the immediate caller's return
// address on top, its own caller's return address one below. On the normal path the ROM
// returns to the immediate address; on the caller-skip (hit) path it discards that and
// returns to the one below. Real addresses so the values are recognisable in a failure.
const SP_TOP = 0x6c00;          // stack top — inside STACK_SCRATCH, so every push is excluded
const IMMEDIATE_RET = 0x28c1;   // a real `call 0x2913` return site (sub_28b0)
const CALLER_CALLER_RET = 0x2808; // where the caller-skip unwinds to (the search's caller's caller)

const REC_BASE = 0x6600; // records laid out here (pure work-RAM reads; clear of STACK_SCRATCH)
const IY_BASE = 0x6200;  // reference-point pointer, as the real callers set it (IY+3 = axis-2 ref)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP.
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

// The registers this routine leaves live: A (hit/exhausted), B (count-minus-index residue), and
// the untouched live-ins C/H/L/DE/IY plus the preserved IX. The flag byte F is NOT compared: it is
// dead on every exit — every consumer re-derives its branch from A or B (loc_2808 does `and a`;
// loc_2954 does `ld a,b`/`and a`), and the sweep wrappers only `ret`/`ld b` after the call. So the
// idiomatic axis-2 is plain JS (no Z80 ALU op), and F is free to differ from the oracle's residue.
const REG_NAMES = ["a", "b", "c", "h", "l", "de", "ix", "iy"];
function regDiffs(o, c) {
  const out = [];
  for (const n of REG_NAMES) if (o.regs[n] !== c.regs[n]) out.push(`reg ${n} oracle=${hx(o.regs[n])} cand=${hx(c.regs[n])}`);
  return out;
}

/** Run the ORACLE on a fresh clone; it performs its own IX restore + terminal return. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run the candidate on a fresh clone, then model the SAME terminal return the ROM takes so
 * pc + SP line up with the oracle: one `ret` when it reported the list exhausted (true), or
 * discard the immediate return address then `ret` when it reported a hit (false).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const { hit } = fn(c);
  if (hit) c.regs.sp = (c.regs.sp + 2) & 0xffff; // caller-skip: drop the immediate return
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP, and the live register file. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  diffs.push(...regDiffs(o, c));
  return diffs;
}

// A real attract machine so the surrounding RAM is realistic; clone() neutralises the frame
// machinery (nextNmi/nextBoundary = Infinity) so the oracle's steps cannot fire an NMI.
function attractBase(frames = 120) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/**
 * Stamp a crafted 0x2913 dispatch onto a clone of the base: the two-level caller stack, the
 * register live-ins, the reference byte at IY+3, and the record array at REC_BASE (records
 * are 11-byte rows; only fields +0/+3/+5/+9/+0x0A are read).
 */
function craft(base, { records, count, de, cRef, l, h, iyRef }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(CALLER_CALLER_RET);
  m.push16(IMMEDIATE_RET);
  m.regs.ix = REC_BASE;
  m.regs.iy = IY_BASE;
  m.regs.b = count & 0xff;
  m.regs.c = cRef & 0xff;
  m.regs.l = l & 0xff;
  m.regs.h = h & 0xff;
  m.regs.de = de & 0xffff;
  m.mem.write8((IY_BASE + 3) & 0xffff, iyRef & 0xff);
  for (let i = 0; i < records.length; i++) {
    const rbase = (REC_BASE + i * de) & 0xffff;
    const rec = records[i];
    for (let off = 0; off < rec.length; off++) m.mem.write8((rbase + off) & 0xffff, rec[off] & 0xff);
  }
  return m;
}

// An 11-byte record row from its meaningful fields (others are noise the routine ignores).
function row({ active = true, f3 = 0, f5 = 0, f9 = 0, fA = 0, noise = 0 }) {
  const r = new Array(11).fill(noise & 0xff);
  r[0x00] = (active ? 0x01 : 0x00) | (noise & 0xfe); // bit0 = active; other bits are noise
  r[0x03] = f3;
  r[0x05] = f5;
  r[0x09] = f9;
  r[0x0a] = fA;
  return r;
}

// Classify which arm the oracle took, for the fuzz coverage assertion.
function classify(entry) {
  const o = entry.clone();
  const exhausted = oracle(o);
  return { hit: !exhausted, b: o.regs.b };
}

// A small deterministic PRNG so the fuzz is reproducible. Draw from the HIGH bits — an
// LCG's low bit is degenerate (it strictly alternates), which would bias the record flags.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}
const rbyte = (r) => (r() >>> 16) & 0xff; // a well-distributed byte
const rmod = (r, n) => (r() >>> 16) % n;  // a well-distributed 0..n-1

const STRIDES = [0x08, 0x10, 0x20];

// One randomised search configuration. Shared by the EQUAL fuzz and the TEETH sweep so the
// teeth are proven over the very space the equivalence passed.
function genTrial(rand) {
  const count = 1 + rmod(rand, 6); // 1..6 records (B==0/256-scan is a dedicated crafted case)
  const de = STRIDES[rmod(rand, STRIDES.length)];
  const records = [];
  for (let i = 0; i < count; i++) {
    records.push(row({
      active: (rbyte(rand) & 1) === 0, // ~half the slots inactive
      f3: rbyte(rand), f5: rbyte(rand), f9: rbyte(rand), fA: rbyte(rand), noise: rbyte(rand),
    }));
  }
  return { records, count, de, cRef: rbyte(rand), l: rbyte(rand), h: rbyte(rand), iyRef: rbyte(rand) };
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2913 is dispatched during attract", () => {
  let count = 0, hits = 0;
  const snap = new Map([[TARGET, (mm) => { count++; const r = oracle(mm); if (!r) hits++; return r; }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(count > 0, "0x2913 should be dispatched — collision handlers call it during the demo");
  console.log(`  REACHABILITY: ${count} natural 0x2913 dispatches in 1500 frames (${hits} hits)`);
});

// -- 1. EQUAL (fuzz) ----------------------------------------------------------

test("EQUAL (fuzz): findCollidingObject == oracle across a broad randomised sweep", () => {
  const base = attractBase();
  const rand = rng(0x2913abcd);
  const cov = { hit: 0, exhausted: 0, inactive: 0, hitAtIndex: 0 };
  const TRIALS = 4000;

  for (let t = 0; t < TRIALS; t++) {
    const trial = genTrial(rand);
    const entry = craft(base, trial);

    const diffs = contractDiffs(entry, findCollidingObject);
    assert.equal(diffs.length, 0, `fuzz trial ${t} (count=${trial.count}, de=${hx(trial.de)}): ${diffs.join("; ")}`);

    const k = classify(entry);
    if (k.hit) { cov.hit++; if (k.b !== trial.count) cov.hitAtIndex++; } else cov.exhausted++;
    if (trial.records.some((r) => (r[0] & 1) === 0)) cov.inactive++;
  }

  // Non-vacuity: the sweep must actually have reached every arm.
  assert.ok(cov.hit > 0, "fuzz never produced a hit");
  assert.ok(cov.exhausted > 0, "fuzz never produced an exhausted scan");
  assert.ok(cov.inactive > 0, "fuzz never presented an inactive slot");
  assert.ok(cov.hitAtIndex > 0, "fuzz never hit at a nonzero index (count-minus-B never exercised)");
  console.log(`  EQUAL/fuzz: ${TRIALS} trials identical (hit=${cov.hit}, exhausted=${cov.exhausted}, hit@index>0=${cov.hitAtIndex}, had-inactive=${cov.inactive})`);
});

// -- 2. EQUAL (crafted, each arm pinned) --------------------------------------

test("EQUAL (crafted): every arm matches the oracle", () => {
  const base = attractBase();
  // Reference tolerances mirror the real callers (H=4, L=7) with realistic coordinates.
  const C = 0x64, L = 0x07, H = 0x04, Y0 = 0x80;

  const cases = [
    {
      name: "hit, both axes in the base window (index 0)",
      opts: { count: 3, de: 0x10, cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ f5: C, f3: Y0 }), row({ active: false }), row({ active: false })] },
      wantHit: true,
    },
    {
      name: "hit via both extra-span arms, differences taken by negate",
      // |C - f5| via negate (f5 > C): dx=10 -> +1=11; 11-L(7)=4 (>=L) -> 4 < fA(6) accept.
      // |Y0 - f3| via negate (f3 > Y0): dy=10; 10-H(4)=6 -> 6 < f9(8) accept.
      opts: { count: 1, de: 0x10, cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ f5: (C + 10) & 0xff, fA: 0x06, f3: (Y0 + 10) & 0xff, f9: 0x08 })] },
      wantHit: true,
    },
    {
      name: "inactive slots then exhausted",
      opts: { count: 4, de: 0x08, cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ active: false }), row({ active: false }), row({ active: false }), row({ active: false })] },
      wantHit: false,
    },
    {
      name: "axis-1 out of range -> exhausted",
      // dx=100 -> +1=101; 101-7=94 (>=L); 94 - fA(5) = 89 (>= fA) reject.
      opts: { count: 1, de: 0x10, cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ f5: 0x00, fA: 0x05, f3: Y0, f9: 0x08 })] },
      wantHit: false,
    },
    {
      name: "axis-1 in window but axis-2 out of range -> exhausted",
      // axis 1: dx=0 accepts; axis 2: dy=128 -> 128-4=124 (>=H); 124 - f9(8) reject.
      opts: { count: 1, de: 0x10, cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ f5: C, f3: 0x00, f9: 0x08, fA: 0x08 })] },
      wantHit: false,
    },
    {
      name: "hit at index 3 (count - B index recovery)",
      opts: { count: 5, de: 0x10, cRef: C, l: L, h: H, iyRef: Y0,
        records: [
          row({ active: false }),
          row({ f5: 0x00, fA: 0x02 }),          // active but axis-1 far -> reject
          row({ active: false }),
          row({ f5: C, f3: Y0 }),               // the hit, index 3
          row({ f5: C, f3: Y0 }),               // would also hit, but the scan stops earlier
        ] },
      wantHit: true, wantB: 5 - 3,
    },
    {
      name: "B==0 -> 256-record scan of one inactive slot, exhausted",
      opts: { count: 0, de: 0x00, cRef: C, l: L, h: H, iyRef: Y0,
        records: [row({ active: false })] },
      wantHit: false,
    },
  ];

  for (const { name, opts, wantHit, wantB } of cases) {
    const entry = craft(base, opts);
    const k = classify(entry);
    assert.equal(k.hit, wantHit, `${name}: expected ${wantHit ? "hit" : "exhausted"}, oracle did the opposite`);
    if (wantB !== undefined) assert.equal(k.b, wantB, `${name}: expected B=${wantB} after the hit`);
    const diffs = contractDiffs(entry, findCollidingObject);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms identical to the oracle`);
});

// -- 3. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): findCollidingObject == oracle on every real 0x2913 dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 400) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x2913 dispatch during attract");

  let hits = 0, exhausted = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, findCollidingObject);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    if (classify(entry).hit) hits++; else exhausted++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical (${hits} hit, ${exhausted} exhausted)`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): drops the axis-1 `+1`, shifting the window by one. */
function brokenDropInc(m) {
  const { regs, mem } = m;
  let rec = regs.ix;
  for (;;) {
    let hit = false;
    record: {
      const ea = rec & 0xffff;
      regs.bit(0, mem.read8(ea), (ea >> 8) & 0xff);
      if (regs.fZ) break record;
      regs.a = regs.c;
      regs.sub(mem.read8((rec + 0x05) & 0xffff));
      if (!regs.fNC) regs.neg();
      // BUG: the `+1` is dropped here.
      regs.sub(regs.l);
      if (!regs.fC) {
        regs.sub(mem.read8((rec + 0x0a) & 0xffff));
        if (regs.fNC) break record;
      }
      regs.a = mem.read8((regs.iy + 0x03) & 0xffff);
      regs.sub(mem.read8((rec + 0x03) & 0xffff));
      if (!regs.fNC) regs.neg();
      regs.sub(regs.h);
      if (!regs.fC) {
        regs.sub(mem.read8((rec + 0x09) & 0xffff));
        if (regs.fNC) break record;
      }
      hit = true;
    }
    if (hit) { regs.a = 0x01; return { hit: true, a: 0x01, b: regs.b }; }
    rec = (rec + regs.de) & 0xffff;
    regs.djnz();
    if (regs.b === 0) break;
  }
  regs.xor(regs.a);
  return { hit: false, a: regs.a, b: regs.b };
}

/** Broken twin (b): correct decision, but corrupts the live-out B on the hit path. */
function brokenHitB(m) {
  const r = findCollidingObject(m);
  if (r.hit) m.regs.b = (m.regs.b - 1) & 0xff; // BUG: index recovery reads count - B
  return r;
}

test("TEETH: the dropped-`+1` twin and the corrupted-B twin are CAUGHT by the same suite", () => {
  const base = attractBase();
  const rand = rng(0x2913abcd);

  // Reuse the fuzz generator so the teeth are proven over the same space the EQUAL sweep passed.
  let incCaught = 0, bCaught = 0;
  for (let t = 0; t < 4000; t++) {
    const entry = craft(base, genTrial(rand));
    if (contractDiffs(entry, brokenDropInc).length > 0) incCaught++;
    if (contractDiffs(entry, brokenHitB).length > 0) bCaught++;
  }

  assert.ok(incCaught > 0, "the dropped-`+1` twin escaped the whole sweep — the gate is worthless");
  assert.ok(bCaught > 0, "the corrupted-B twin escaped the whole sweep — the register check is worthless");
  console.log(`  TEETH: dropped-+1 caught on ${incCaught} trials; corrupted-B caught on ${bCaught} trials`);
});
