// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for findHammerOverlappingMario (ROM 0x2974) — run the object-list bounding-box search
 * over the two-record pair at 0x6680 against Mario's position, and report the outcome in
 * the register file (A = hit / no-hit, B = the count−index residue).
 *
 * findHammerOverlappingMario writes NO work RAM: it only marshals the search parameters into registers and
 * direct-calls findCollidingObject, which reads the two records (through the base register) and
 * Mario's X/Y (through the reference pointer) and writes nothing. So the whole observable
 * effect is the register file plus control flow.
 *
 * In the ROM this is `call 0x2913 / ret`. The oracle models the Z80 stack: it pushes the
 * inner return address, calls entry_2913 (which saves/restores its base and performs a
 * one- or two-level `ret`), and on the exhausted path performs its own terminal `ret`.
 * On BOTH outcomes the net stack effect toward this routine's caller is identical — a
 * single caller-return pop — because the caller-skip on a hit only elides this routine's
 * own `ret`. findHammerOverlappingMario models no stack (a plain void call). So the harness lines the two
 * up by performing exactly ONE terminal `m.ret()` after the candidate, and the bytes the
 * oracle's push/call/ret churn leaves behind sit in the dead STACK_SCRATCH region, which
 * the memory compare excludes.
 *
 *   1. EQUAL (captured) — hook 0x2974 in a real attract run and confirm findHammerOverlappingMario == oracle
 *      on every real dispatch (RAM − the stack scratch below the entry SP, pc, SP, and the live register file).
 *
 *   2. EQUAL (crafted) — poke the two records at 0x6680/0x6690 and Mario's X/Y identically
 *      on both sides to reach: a hit at record 0, a hit at record 1 (exercising the stride
 *      advance and the count−index residue in B), and an exhausted pair. Each identical to
 *      the oracle.
 *
 *   3. TEETH — two broken twins the same suite MUST catch: one that takes the axis-1
 *      reference from Mario's X instead of Mario's Y (wrong reference byte), and one that
 *      scans only one record instead of both (wrong record count).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2974.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2974 as oracle } from "../../translated/loc_2974.js";
import { findHammerOverlappingMario } from "../findHammerOverlappingMario.js";
import { findCollidingObject } from "../findCollidingObject.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_ACTIVE, MARIO_X, MARIO_Y, OBJ_PAIR_6680 } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2974;
const SP_TOP = 0x6c00;         // stack top — inside STACK_SCRATCH, so every push is excluded
const RET_ADDR = 0x295a;       // the real `call 0x2974` return site (in ROM 0x2954)
const REC0 = OBJ_PAIR_6680;    // record 0 base (0x6680)
const REC1 = (OBJ_PAIR_6680 + 0x10) & 0xffff; // record 1 base (0x6690), stride 0x10

const MX = 0x40; // crafted Mario X (axis-2 reference, read via the reference pointer +3)
const MY = 0x80; // crafted Mario Y (axis-1 reference)

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

// The registers the routine leaves live (A hit flag, B count−index) plus the ones it must
// preserve.
// F is EXCLUDED: the outgoing flag byte is DEAD on every exit -- findCollidingObject's axis-2 is
// now plain JS (no Z80 ALU op), and every consumer re-derives its branch from A or B (loc_2808
// `and a`; loc_2954 `ld a,b`/`and a`); the wrapper only `ret`/`ld b` after the call.
const REG_NAMES = ["a", "b", "c", "h", "l", "de", "ix", "iy"];
function regDiffs(o, c) {
  const out = [];
  for (const n of REG_NAMES) if (o.regs[n] !== c.regs[n]) out.push(`reg ${n} oracle=${hx(o.regs[n])} cand=${hx(c.regs[n])}`);
  return out;
}

/** Run the ORACLE on a fresh clone; it performs its own push/call/ret bracket. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run the candidate on a fresh clone, then model the SINGLE terminal caller-return the ROM
 * performs on both outcomes so pc + SP line up with the oracle. findHammerOverlappingMario models no stack,
 * so it does not touch pc/SP itself.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
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

// A real attract machine so surrounding RAM is realistic; clone() neutralises the frame
// machinery (nextNmi/nextBoundary = Infinity) so the oracle's steps cannot fire an NMI.
function attractBase(frames = 120) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// Write the fields findCollidingObject reads of one record: +0 flag (bit0 = active), +3 axis-2 coord,
// +5 axis-1 coord, +9 axis-2 extra span, +0x0A axis-1 extra span.
function putRecord(m, base, { active, f3 = 0, f5 = 0, f9 = 0, fA = 0 }) {
  m.mem.write8((base + 0x00) & 0xffff, active ? 0x01 : 0x00);
  m.mem.write8((base + 0x03) & 0xffff, f3 & 0xff);
  m.mem.write8((base + 0x05) & 0xffff, f5 & 0xff);
  m.mem.write8((base + 0x09) & 0xffff, f9 & 0xff);
  m.mem.write8((base + 0x0a) & 0xffff, fA & 0xff);
}

// Stamp a crafted 0x2974 dispatch onto a clone of the base: a stack with a plausible caller
// return (so the terminal `ret` has a sane target), Mario's X/Y, and the two records.
function craft(base, { rec0, rec1, mx = MX, my = MY }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RET_ADDR);
  m.mem.write8(MARIO_X, mx & 0xff);
  m.mem.write8(MARIO_Y, my & 0xff);
  putRecord(m, REC0, rec0);
  putRecord(m, REC1, rec1);
  return m;
}

// Classify which outcome the oracle took, for the crafted assertions.
function classify(entry) {
  const o = runOracle(entry);
  return { hit: o.regs.a === 0x01, a: o.regs.a, b: o.regs.b };
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2974 is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(count > 0, "0x2974 should be dispatched — 0x2954 calls it during the demo");
  console.log(`  REACHABILITY: ${count} natural 0x2974 dispatches in 2000 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): findHammerOverlappingMario == oracle on every real 0x2974 dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2974 dispatch during attract");

  let hits = 0, exhausted = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, findHammerOverlappingMario);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    if (classify(entry).hit) hits++; else exhausted++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical (${hits} hit, ${exhausted} exhausted)`);
});

// -- 2. EQUAL (crafted, each outcome pinned) ----------------------------------

test("EQUAL (crafted): the hit and exhausted outcomes match the oracle", () => {
  const base = attractBase();

  const cases = [
    {
      name: "hit at record 0 (B = count)",
      opts: { rec0: { active: true, f3: MX, f5: MY }, rec1: { active: false } },
      wantHit: true, wantB: 0x02,
    },
    {
      name: "hit at record 1 (stride advance, B = count − 1)",
      opts: { rec0: { active: false }, rec1: { active: true, f3: MX, f5: MY } },
      wantHit: true, wantB: 0x01,
    },
    {
      name: "both records inactive -> exhausted",
      opts: { rec0: { active: false }, rec1: { active: false } },
      wantHit: false, wantB: 0x00,
    },
    {
      name: "record 0 active but out of range -> exhausted",
      // axis-2 far off (|MX - f3| = 0x60, beyond H=4 and span f9=0) rejects it.
      opts: { rec0: { active: true, f3: (MX + 0x60) & 0xff, f5: MY, f9: 0x00 }, rec1: { active: false } },
      wantHit: false, wantB: 0x00,
    },
  ];

  for (const { name, opts, wantHit, wantB } of cases) {
    const entry = craft(base, opts);
    const k = classify(entry);
    assert.equal(k.hit, wantHit, `${name}: expected ${wantHit ? "hit" : "exhausted"}, oracle did the opposite`);
    assert.equal(k.b, wantB, `${name}: expected B=${hx(wantB)} after the search, oracle had ${hx(k.b)}`);
    const diffs = contractDiffs(entry, findHammerOverlappingMario);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} outcomes (hit@0, hit@1, exhausted x2) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): takes the axis-1 reference from Mario's X instead of Mario's Y. */
function twinWrongRef(m) {
  const { regs, mem } = m;
  regs.iy = MARIO_ACTIVE;
  regs.a = mem.read8(MARIO_X); // BUG: should be MARIO_Y
  regs.c = regs.a;
  regs.hl = 0x0408;
  regs.b = 0x02;
  regs.de = 0x0010;
  regs.ix = OBJ_PAIR_6680;
  findCollidingObject(m);
}

/** Broken twin (b): scans only one record instead of both. */
function twinShortScan(m) {
  const { regs, mem } = m;
  regs.iy = MARIO_ACTIVE;
  regs.a = mem.read8(MARIO_Y);
  regs.c = regs.a;
  regs.hl = 0x0408;
  regs.b = 0x01; // BUG: should be 0x02 (scan both records)
  regs.de = 0x0010;
  regs.ix = OBJ_PAIR_6680;
  findCollidingObject(m);
}

test("TEETH: the wrong-reference twin and the short-scan twin are CAUGHT", () => {
  const base = attractBase();

  // (a) wrong reference: both records are hits at (MX, MY) with MX != MY. The correct
  // routine (C = Mario Y) hits record 0; the twin (C = Mario X) rejects both -> exhausted.
  const refEntry = craft(base, {
    rec0: { active: true, f3: MX, f5: MY },
    rec1: { active: true, f3: MX, f5: MY },
  });
  assert.equal(classify(refEntry).hit, true, "wrong-ref case should hit for the correct routine");
  const refDiffs = contractDiffs(refEntry, twinWrongRef);
  assert.ok(refDiffs.length > 0, "the wrong-reference twin escaped — the gate is worthless");

  // (b) short scan: only record 1 is a hit. The correct routine (count 2) reaches it; the
  // twin (count 1) stops after the inactive record 0 -> exhausted.
  const scanEntry = craft(base, {
    rec0: { active: false },
    rec1: { active: true, f3: MX, f5: MY },
  });
  assert.equal(classify(scanEntry).hit, true, "short-scan case should hit for the correct routine");
  const scanDiffs = contractDiffs(scanEntry, twinShortScan);
  assert.ok(scanDiffs.length > 0, "the short-scan twin escaped — the gate is worthless");

  console.log(`  TEETH: wrong-reference caught (${refDiffs[0]}); short-scan caught (${scanDiffs[0]})`);
});
