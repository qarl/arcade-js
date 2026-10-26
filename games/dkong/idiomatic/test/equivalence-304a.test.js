// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for scrollClimbGraphicStep (ROM 0x304a) — one cell-pair of the
 * opening Kong-climb cutscene's up-scroll: copy the video-RAM cells at 0x7600+i and
 * 0x75C0+i one tilemap row up (to −0x20), then decrement the scroll index at 0x638E.
 *
 * Like copyByteDisplaced (its 0x3064 callee) this routine WRITES MEMORY, so it is
 * gated on memory-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never on a
 * returned scalar and never on the full register file. Its declared LIVE-OUT is
 * memory-only: the two copied video-RAM bytes plus the decremented 0x638E. The
 * oracle's residual `dec (hl)` flags and the HL/A/F churn copyByteDisplaced leaves are
 * DEAD — both real callers (loc_0ae8 at 0x0AF0, loc_0b06 at 0x0B38) re-read RAM and
 * derive fresh flags with a `cp` before branching — so the contract deliberately does
 * NOT compare them. Every case runs on a FRESH clone (a reused clone is only safe for
 * a read-only leaf; this routine mutates VRAM + 0x638E).
 *
 *   1. EQUAL (real loop dispatches) — plain attract never reaches 0x304a (0× through
 *      8000 frames): it runs only inside the opening-cutscene cascade. So the real
 *      dispatch states are reproduced the way its caller loc_0b06 drives it —
 *      `do { sub_304a } while (0x638E != 0x0A)` — by seeding 0x638E on a booted
 *      (loc_0fd7) machine with real video RAM and iterating the TRANSLATED oracle,
 *      capturing each true entry (real index, VRAM evolved by prior steps, a
 *      caller-pushed return address on the stack). For each, oracle vs candidate must
 *      leave identical RAM + pc + SP.
 *
 *   2. EQUAL (crafted index sweep) — the scroll index across its whole range and the
 *      byte extremes (0x00 / 0xFF), booted VRAM, a safe (excluded) stack pointer.
 *
 *   3. TEETH (crafted sentinels + real) — three deliberately-broken twins MUST be
 *      caught: (a) drops the `dec 0x638E`, (b) drops the second (0x75C0) copy, (c)
 *      scrolls the wrong direction (DE = +0x20). A relocation/omission is invisible
 *      when the cells already hold equal bytes, so the guaranteed catch is on crafted
 *      entries with distinct sentinel bytes at each source and destination; the twins
 *      are additionally shown caught on the real loop dispatches.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so
 * the harness performs one m.ret() on the candidate clone AFTER the call to line pc +
 * SP up with the oracle (which rets internally). The oracle also pushes/pops two
 * return addresses for its internal sub_3064 calls, but those land in STACK_SCRATCH
 * and are excluded.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-304a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_304a as oracle } from "../../translated/loc_304a.js";
import { loc_0fd7 } from "../../translated/loc_0fd7.js";
import { scrollClimbGraphicStep } from "../scrollClimbGraphicStep.js";
import { copyByteDisplaced } from "../copyByteDisplaced.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const SCROLL_INDEX = 0x638e;
const RET_ADDR = 0x0b3b; // loc_0b06's real return site after `call 0x304A`
const SAFE_SP = 0x6bfe; // inside STACK_SCRATCH → the oracle's `ret` pops excluded bytes
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it never touches pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over RAM − the stack scratch below the entry SP, pc, SP. LIVE-OUT memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * A realistic booted machine, captured at loc_0fd7 (reached in plain attract) — real
 * work + video RAM, the same seed the sibling 0x3064 suite uses.
 */
function captureBooted(maxFrames) {
  let entry = null;
  const snap = new Map([[0x0fd7, (mm) => { if (entry === null) entry = mm.clone(); return loc_0fd7(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot seed real 0x304a dispatches");
  return entry;
}

/** Give an entry a valid caller stack: SP inside scratch, a real return address on top. */
function withCallerStack(e) {
  e.regs.sp = SAFE_SP;
  e.mem.write16(SAFE_SP, RET_ADDR); // the oracle's final `ret` pops this (excluded region)
  return e;
}

/**
 * Reproduce the REAL dispatch SEQUENCE the way loc_0b06 drives it: seed 0x638E high,
 * then iterate the TRANSLATED oracle, capturing each true entry state BEFORE the step
 * runs (index, VRAM evolved by the prior steps, a caller-pushed return address). Stops
 * when 0x638E reaches loc_0b06's terminator 0x0A (or after maxIter) — the real range.
 */
function captureLoopDispatches(booted, startIdx, maxIter) {
  const caps = [];
  const d = booted.clone();
  d.mem.write8(SCROLL_INDEX, startIdx);
  for (let i = 0; i < maxIter; i++) {
    withCallerStack(d);
    caps.push(d.clone()); // the exact state sub_304a is entered with this iteration
    oracle(d); // advance the machine like loc_0b06's `call 0x304A`
    if (d.mem.read8(SCROLL_INDEX) === 0x0a) break;
  }
  return caps;
}

// -- broken twins -------------------------------------------------------------

/** (a) copies both cells but FORGETS the `dec 0x638E`. */
function brokenNoDecrement(m) {
  const { regs, mem } = m;
  regs.bc = mem.read8(SCROLL_INDEX);
  regs.de = 0xffe0;
  regs.hl = 0x7600; copyByteDisplaced(m);
  regs.hl = 0x75c0; copyByteDisplaced(m);
  // BUG: no dec (0x638E)
}

/** (b) copies only the first cell — DROPS the second (0x75C0) copy. */
function brokenSingleCopy(m) {
  const { regs, mem } = m;
  regs.bc = mem.read8(SCROLL_INDEX);
  regs.de = 0xffe0;
  regs.hl = 0x7600; copyByteDisplaced(m);
  // BUG: missing the 0x75c0 copy
  mem.write8(SCROLL_INDEX, (mem.read8(SCROLL_INDEX) - 1) & 0xff);
}

/** (c) scrolls the WRONG direction — DE = +0x20 instead of −0x20. */
function brokenWrongDir(m) {
  const { regs, mem } = m;
  regs.bc = mem.read8(SCROLL_INDEX);
  regs.de = 0x0020; // BUG: should be 0xffe0 (−0x20)
  regs.hl = 0x7600; copyByteDisplaced(m);
  regs.hl = 0x75c0; copyByteDisplaced(m);
  mem.write8(SCROLL_INDEX, (mem.read8(SCROLL_INDEX) - 1) & 0xff);
}

// -- 1. EQUAL (real loop dispatches) ------------------------------------------

test("EQUAL (real loop): scrollClimbGraphicStep == oracle on every captured 0x304a entry", () => {
  const booted = captureBooted(600);
  const caps = captureLoopDispatches(booted, 0x1f, 32); // loc_0b06's 0x1F → 0x0A run-down
  assert.ok(caps.length >= 4, "expected a run of real 0x304a dispatches");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, scrollClimbGraphicStep); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, `index=${hx(cap.mem.read8(SCROLL_INDEX))}: ${diffs.join("; ")}`);
  }
  const first = caps[0].mem.read8(SCROLL_INDEX), last = caps[caps.length - 1].mem.read8(SCROLL_INDEX);
  console.log(`  EQUAL/real-loop: ${caps.length} captured dispatches identical (index ${hx(first)} → ${hx(last)})`);
});

// -- 2. EQUAL (crafted index sweep) -------------------------------------------

test("EQUAL (crafted): scroll index across its range and byte extremes match the oracle", () => {
  const booted = captureBooted(600);
  const seed = booted.clone();

  const craftIdx = (idx) => {
    const e = seed.clone();
    e.mem.write8(SCROLL_INDEX, idx);
    return withCallerStack(e);
  };
  const INDICES = [0x00, 0x01, 0x02, 0x09, 0x0a, 0x0b, 0x0f, 0x1f, 0x20, 0x40, 0x7f, 0x80, 0xa0, 0xdf, 0xe0, 0xfe, 0xff];

  for (const idx of INDICES) {
    const diffs = contractDiffs(craftIdx(idx), scrollClimbGraphicStep);
    assert.equal(diffs.length, 0, `index=${hx(idx)}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${INDICES.length} scroll-index values identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the no-dec / dropped-copy / wrong-direction twins are CAUGHT", () => {
  const booted = captureBooted(600);
  const seed = booted.clone();

  // GUARANTEED catch: distinct sentinel bytes at every source (0xA5) and correct
  // destination (0x5A) for both cell columns, and a known index. Any twin that omits
  // the dec, drops a copy, or writes the wrong destination leaves a sentinel where the
  // oracle wrote — a diff that cannot coincide away.
  const craftSentinel = (idx) => {
    const e = withCallerStack(seed.clone());
    e.mem.write8(SCROLL_INDEX, idx);
    for (const base of [0x7600, 0x75c0]) {
      e.mem.write8((base + idx) & 0xffff, 0xa5); // source
      e.mem.write8((base + idx - 0x20) & 0xffff, 0x5a); // correct destination (one row up)
    }
    return e;
  };
  const sentinels = [craftSentinel(0x1f), craftSentinel(0x80), craftSentinel(0x0b)];
  const twins = [
    ["no-decrement", brokenNoDecrement],
    ["dropped-second-copy", brokenSingleCopy],
    ["wrong-direction", brokenWrongDir],
  ];

  for (const e of sentinels) {
    for (const [label, twin] of twins) {
      assert.ok(
        contractDiffs(e, twin).length > 0,
        `the ${label} twin escaped the sentinel gate — it is worthless`,
      );
    }
    // the correct routine must still be EQUAL on the very same sentinel entry
    assert.equal(contractDiffs(e, scrollClimbGraphicStep).length, 0, "scrollClimbGraphicStep must pass the sentinel entry");
  }

  // Corroboration on real loop dispatches: each twin caught on at least one (a strict
  // subset — invisible only where the real VRAM already holds equal bytes).
  const caps = captureLoopDispatches(booted, 0x1f, 32);
  for (const [label, twin] of twins) {
    const caught = caps.filter((cap) => contractDiffs(cap, twin).length > 0).length;
    assert.ok(caught > 0, `the ${label} twin was not caught on ANY real dispatch — corroboration failed`);
  }

  console.log(
    `  TEETH: all ${twins.length} twins caught on every one of ${sentinels.length} sentinel entries ` +
      `and each on ≥1 of ${caps.length} real dispatches`,
  );
});
