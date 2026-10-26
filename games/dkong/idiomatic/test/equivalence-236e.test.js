// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for findOppositeLadderEnd (ROM 0x236E) — find a key in the type-0 object
 * table and return its paired slot.
 *
 * sub_236e scans OBJ_PARAM_TABLE0 (0x6300) for the first byte equal to the search key,
 * then, from the discriminator, hands back the OTHER of two slots (at match+0x15 and
 * match+0x2A) tagged by which slot the discriminator matched. If neither slot matches
 * it rescans past the entry; if the key never appears it MISSES and double-unwinds. It
 * writes NO work RAM — its whole result is registers plus a boolean skip signal — so
 * the contract is:
 *   - RAM identical minus the stack scratch below the entry SP (the oracle's loop-internal push/pop of the
 *     match address and count is dead scratch the idiomatic routine dissolves into
 *     locals; the miss path only READS the stack). Genuine dissolved pushes -> the one
 *     exclusion this gate needs.
 *   - the boolean return (found vs miss), which the idiomatic callers turn back into the
 *     double unwind via `if (!findOppositeLadderEnd(m)) return;`.
 *   - on a FOUND return, the register live-outs the three callers actually consume:
 *     A (the tag — sub_216d/entry_333d/armMarioClimbAtLadderEnd all read it), B (the returned slot byte
 *     — sub_216d, entry_333d), C (the residual scan count — armMarioClimbAtLadderEnd `cp c`), D (the
 *     discriminator, passed through — sub_216d `cp d`), and E (the key echo — sub_216d
 *     `cp e`). HL (the post-match address) is left in a register by the oracle but no
 *     caller reads it, so it is NOT a live-out and is not compared.
 *
 * The register shape is the ROM's own ABI, not a lift artefact: all three call sites (0x1B13 in
 * armMarioClimbAtLadderEnd, 0x216D in startBarrelDescentAtLadder, 0x3359 in driveFireLadderClimb)
 * now have readable twins that import and DIRECT-CALL this routine, and they still marshal into
 * the register convention. So the gate stays register-shaped. (An earlier version of this header
 * said the three callers were still the frozen lift; that has not been true since those twins
 * landed.)
 *
 *   1. REACHABILITY — 0x236E dispatches during boot/attract (it is object-lookup code
 *      driven from the climb/collision path, which the 25m demo exercises).
 *
 *   2. EQUAL (captured) — hook 0x236E in a real attract run, clone at each dispatch, and
 *      confirm findOppositeLadderEnd == oracle on the full contract over every real state. Real runs
 *      span BOTH the found and the miss arms.
 *
 *   3. EQUAL (crafted) — plant a controlled table in a real attract base to hit the
 *      specific edges: found tag 1 (discriminator == near slot -> return far), found
 *      tag 0 (discriminator == far slot -> return near), a multi-entry RESCAN (first
 *      entry's slots miss, a later entry's slot hits), a plain not-found MISS, and a
 *      found-then-rescan-then-MISS. Each asserts the oracle's own arm non-vacuously.
 *
 *   4. TEETH — three broken twins, each of which the SAME contract MUST catch:
 *        (a) wrong slot — returns the discriminator-matched slot instead of the paired
 *            OTHER slot; caught on a found case by the B register.
 *        (b) miss-as-hit — returns found (true) where the oracle misses; caught by the
 *            boolean return.
 *        (c) no rescan — gives up after the first entry whose slots miss instead of
 *            scanning on; caught on the rescan case by the boolean return.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-236e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_236e as oracle } from "../../translated/loc_236e.js";
import { findOppositeLadderEnd } from "../findOppositeLadderEnd.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, OBJ_PARAM_TABLE0 } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x236e;
const NEAR = 0x15; // near paired-slot offset past the matched byte
const FAR = 0x2a;  // far paired-slot offset past the matched byte

// Crafted-entry constants: a stack pointer inside STACK_SCRATCH so the oracle's dead
// pushes land in the excluded region, a plausible caller return (pc is never compared),
// and distinct key/discriminator/filler so cleared cells can never alias a real match.
const SAFE_SP = 0x6bf8;
const RET_ADDR = 0x1b16; // armMarioClimbAtLadderEnd's return site; only needs to be a sane target
const KEY = 0x42;
const DISC = 0x99;
const FILLER = 0x00; // != KEY and != DISC, so a cleared slot never fakes a hit

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs, skipping the stack scratch below the entry SP (the
// memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

/**
 * Run the oracle and a candidate on two fresh, byte-identical clones (frame machinery
 * neutralised so a stray NMI cannot masquerade as a side effect) and return the full
 * contract diffs: RAM − the stack scratch below the entry SP, the boolean return, and — only when the oracle
 * FOUND — the register live-outs the callers consume (A,B,C,D,E). HL is dead, not
 * compared.
 */
function contractDiffs(entry, candidate) {
  const a = entry.clone(); a.nextNmi = Infinity; a.nextBoundary = Infinity;
  const b = entry.clone(); b.nextNmi = Infinity; b.nextBoundary = Infinity;
  const ro = oracle(a);
  // The oracle returns a bare boolean; the candidate returns { hit, ... } — compare on .hit.
  const rc = candidate(b).hit;
  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (ro !== rc) diffs.push(`return oracle=${ro} cand=${rc}`);
  if (ro === true) {
    for (const k of ["a", "b", "c", "d", "e"]) {
      if (a.regs[k] !== b.regs[k]) diffs.push(`${k.toUpperCase()} oracle=${hx(a.regs[k])} cand=${hx(b.regs[k])}`);
    }
  }
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. clone() neutralises the frame machinery (nextNmi/nextBoundary = Inf).
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/**
 * Plant a controlled object table onto a clone of `base` and set the register live-ins.
 * `entries` are { off, near, far }: the key at 0x6300+off, its near slot (+0x15) and far
 * slot (+0x2A). The scan window is cleared to FILLER first so the search matches ONLY the
 * planted keys, in order. A safe stack + return address make the oracle's ret well-defined.
 */
function craft(base, { count, disc = DISC, entries }) {
  const m = base.clone();
  m.regs.sp = SAFE_SP;
  m.push16(RET_ADDR);
  for (let i = 0; i < 0x60; i++) m.mem.write8((OBJ_PARAM_TABLE0 + i) & 0xffff, FILLER);
  for (const e of entries) {
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off) & 0xffff, KEY);
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off + NEAR) & 0xffff, e.near);
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off + FAR) & 0xffff, e.far);
  }
  m.regs.a = KEY;
  m.regs.bc = count;
  m.regs.d = disc;
  return m;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x236E is dispatched during boot/attract", () => {
  let count = 0;
  const orig = new Machine(ROM).routines.get(TARGET);
  const snap = new Map([[TARGET, (mm) => { count++; return orig(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(count > 0, "0x236E should dispatch — object lookup runs during the attract demo");
  console.log(`  REACHABILITY: ${count} natural 0x236E dispatches in 1500 frames`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): findOppositeLadderEnd == oracle on every real dispatch (found + miss)", () => {
  const orig = new Machine(ROM).routines.get(TARGET);
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 250) caps.push(mm.clone());
    return orig(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x236E dispatch during attract");

  let sawFound = 0, sawMiss = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, findOppositeLadderEnd);
    assert.equal(diffs.length, 0, `captured dispatch (A=${hx(cap.regs.a)} BC=${hx(cap.regs.bc)} D=${hx(cap.regs.d)}): ${diffs.join("; ")}`);
    // Classify the oracle's arm for reporting / coverage evidence.
    const probe = cap.clone(); probe.nextNmi = Infinity; probe.nextBoundary = Infinity;
    if (oracle(probe)) sawFound++; else sawMiss++;
  }
  assert.ok(sawFound > 0 && sawMiss > 0, `real dispatches should span both arms (found=${sawFound}, miss=${sawMiss})`);
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (${sawFound} found, ${sawMiss} miss)`);
});

// -- 3. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): both found tags, the rescan, and both miss shapes match the oracle", () => {
  const base = attractBase();

  const cases = [
    // found tag 1: discriminator == the near slot -> return the FAR slot, tag 1.
    { name: "found tag 1 (near hit -> far)", opts: { count: 0x15, entries: [{ off: 2, near: DISC, far: 0x77 }] },
      found: true, wantA: 1, wantB: 0x77 },
    // found tag 0: discriminator == the far slot (near misses) -> return the NEAR slot, tag 0.
    { name: "found tag 0 (far hit -> near)", opts: { count: 0x15, entries: [{ off: 2, near: 0x55, far: DISC }] },
      found: true, wantA: 0, wantB: 0x55 },
    // rescan: first entry's slots both miss; a later entry's near slot hits.
    { name: "rescan to a later entry", opts: { count: 0x15, entries: [{ off: 2, near: 0x11, far: 0x22 }, { off: 5, near: DISC, far: 0x88 }] },
      found: true, wantA: 1, wantB: 0x88 },
    // plain miss: the key never appears in the scanned window.
    { name: "miss (key absent)", opts: { count: 0x15, entries: [] }, found: false },
    // found-then-miss: an entry matches but its slots miss, and no later key exists.
    { name: "miss (found but slots miss, no rescan target)", opts: { count: 0x15, entries: [{ off: 2, near: 0x11, far: 0x22 }] }, found: false },
  ];

  for (const { name, opts, found, wantA, wantB } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, findOppositeLadderEnd);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuity: confirm the oracle really took the arm this case is meant to cover.
    const probe = entry.clone(); probe.nextNmi = Infinity; probe.nextBoundary = Infinity;
    const ro = oracle(probe);
    assert.equal(ro, found, `${name}: oracle took the wrong arm (found=${ro})`);
    if (found) {
      assert.equal(probe.regs.a, wantA, `${name}: wrong tag`);
      assert.equal(probe.regs.b, wantB, `${name}: wrong returned slot`);
      assert.equal(probe.regs.e, KEY, `${name}: key echo not in E`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (tag 1, tag 0, rescan, miss, found-then-miss) identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): returns the discriminator-MATCHED slot instead of the paired other. */
function brokenWrongSlot(m) {
  const { regs, mem } = m;
  const key = regs.a, disc = regs.d;
  let count = regs.bc, addr = OBJ_PARAM_TABLE0;
  for (;;) {
    let found = false;
    do {
      const hit = mem.read8(addr) === key;
      addr = (addr + 1) & 0xffff;
      count = (count - 1) & 0xffff;
      if (hit) { found = true; break; }
    } while (count !== 0);
    if (!found) return { hit: false };
    const match = (addr - 1) & 0xffff;
    const nearAddr = (match + NEAR) & 0xffff, farAddr = (match + FAR) & 0xffff;
    if (disc === mem.read8(nearAddr)) {
      regs.a = 1; regs.b = mem.read8(nearAddr); regs.c = count & 0xff; regs.e = key; return { hit: true }; // BUG: near, not far
    }
    if (disc === mem.read8(farAddr)) {
      regs.a = 0; regs.b = mem.read8(farAddr); regs.c = count & 0xff; regs.e = key; return { hit: true };  // BUG: far, not near
    }
  }
}

/** Broken twin (b): signals FOUND on a miss instead of the unwind. */
function brokenMissAsHit(m) {
  const { regs, mem } = m;
  const key = regs.a, disc = regs.d;
  let count = regs.bc, addr = OBJ_PARAM_TABLE0;
  for (;;) {
    let found = false;
    do {
      const hit = mem.read8(addr) === key;
      addr = (addr + 1) & 0xffff;
      count = (count - 1) & 0xffff;
      if (hit) { found = true; break; }
    } while (count !== 0);
    if (!found) return { hit: true }; // BUG: should be false
    const match = (addr - 1) & 0xffff;
    const nearAddr = (match + NEAR) & 0xffff, farAddr = (match + FAR) & 0xffff;
    if (disc === mem.read8(nearAddr)) { regs.a = 1; regs.b = mem.read8(farAddr); regs.c = count & 0xff; regs.e = key; return { hit: true }; }
    if (disc === mem.read8(farAddr)) { regs.a = 0; regs.b = mem.read8(nearAddr); regs.c = count & 0xff; regs.e = key; return { hit: true }; }
  }
}

/** Broken twin (c): gives up after the first matched entry whose slots miss (no rescan). */
function brokenNoRescan(m) {
  const { regs, mem } = m;
  const key = regs.a, disc = regs.d;
  let count = regs.bc, addr = OBJ_PARAM_TABLE0;
  let found = false;
  do {
    const hit = mem.read8(addr) === key;
    addr = (addr + 1) & 0xffff;
    count = (count - 1) & 0xffff;
    if (hit) { found = true; break; }
  } while (count !== 0);
  if (!found) return { hit: false };
  const match = (addr - 1) & 0xffff;
  const nearAddr = (match + NEAR) & 0xffff, farAddr = (match + FAR) & 0xffff;
  if (disc === mem.read8(nearAddr)) { regs.a = 1; regs.b = mem.read8(farAddr); regs.c = count & 0xff; regs.e = key; return { hit: true }; }
  if (disc === mem.read8(farAddr)) { regs.a = 0; regs.b = mem.read8(nearAddr); regs.c = count & 0xff; regs.e = key; return { hit: true }; }
  return { hit: false }; // BUG: should rescan
}

test("TEETH: wrong-slot, miss-as-hit, and no-rescan twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) wrong slot — a found (tag 1) case: correct B=0x77 (far), twin B=DISC (near).
  const foundEntry = craft(base, { count: 0x15, entries: [{ off: 2, near: DISC, far: 0x77 }] });
  const slotDiffs = contractDiffs(foundEntry, brokenWrongSlot);
  assert.ok(slotDiffs.length > 0, "the wrong-slot twin escaped — the register check is worthless");
  assert.ok(slotDiffs.some((d) => d.startsWith("B ")), `expected a B-register diff, got: ${slotDiffs.join("; ")}`);

  // (b) miss-as-hit — a plain miss case: oracle false, twin true.
  const missEntry = craft(base, { count: 0x15, entries: [] });
  const missDiffs = contractDiffs(missEntry, brokenMissAsHit);
  assert.ok(missDiffs.length > 0, "the miss-as-hit twin escaped — the return check is worthless");
  assert.ok(missDiffs.some((d) => d.startsWith("return")), `expected a return diff, got: ${missDiffs.join("; ")}`);

  // (c) no rescan — the rescan case: oracle finds the later entry (true), twin gives up (false).
  const rescanEntry = craft(base, { count: 0x15, entries: [{ off: 2, near: 0x11, far: 0x22 }, { off: 5, near: DISC, far: 0x88 }] });
  const rescanDiffs = contractDiffs(rescanEntry, brokenNoRescan);
  assert.ok(rescanDiffs.length > 0, "the no-rescan twin escaped — the rescan is unverified");
  assert.ok(rescanDiffs.some((d) => d.startsWith("return")), `expected a return diff, got: ${rescanDiffs.join("; ")}`);

  console.log(`  TEETH: wrong-slot caught (${slotDiffs.join("; ")}); miss-as-hit caught (${missDiffs.join("; ")}); no-rescan caught (${rescanDiffs.join("; ")})`);
});
