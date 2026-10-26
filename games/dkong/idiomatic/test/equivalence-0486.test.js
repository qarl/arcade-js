// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchColorCyclePaint (ROM 0x0486) — the per-frame colour-cycle
 * repaint router: read the sweep counter (0x6390) as the phase, set the one-row fill stride,
 * then hand off to exactly one paint arm by board and phase (rivet block on BOARD==4; low
 * code 0x10 on phase 0 / bit-6 clear; high code 0xEF on bit-6 set).
 *
 * loc_0486 writes NO RAM of its own — every arm it routes to does. Its declared LIVE-OUT is
 * memory-only (the chain returns up to the loc_197a cascade, which reads no register first), so
 * it is validated on RAM (minus the stack scratch below the entry SP) + pc + SP via capture/clone/replay. NEVER the
 * full register file, NEVER cycles.
 *
 * The idiomatic routine models the Z80 stack as the JS call stack (its arms are direct calls
 * with no push16/ret of their own), so the harness performs ONE m.ret() on the candidate clone
 * to line pc + SP up with the oracle. The oracle's net stack effect down every arm is exactly
 * one return (the tail chain push16s a link, the fill/blink helpers ret it back, and the final
 * arm rets the caller's address — one net pop); its pushed link bytes land in STACK_SCRATCH,
 * excluded by the contract. Every case runs on a FRESH clone (the arms write memory).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0486 in a real attract run and clone at each
 *      true dispatch. Attract is 25m (BOARD==1) and the sweep counter covers the full 0x00..0x7F
 *      range, so the phase==0, bit-6-clear and bit-6-set non-rivet arms are all naturally
 *      exercised. Oracle vs candidate on fresh clones, whole contract.
 *
 *   2. CRAFTED (unreached arm + pinned phases) — reposed on a real capture: BOARD==4 forces the
 *      rivet arm (cold in a 25m attract), verified to genuinely paint the rivet column 0x7623;
 *      and phases 0x00 / 0x20 / 0x40 pin the low, low, and high non-rivet arms deterministically.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught on a sentinel-painted entry:
 *      (a) ignore-phase: always routes to the low-code arm — on a bit-6-set entry the colour
 *          cells diverge (0x10/0x0F/0x0E vs 0xEF/0xEE/0xED).
 *      (b) no-rivet: never routes to the rivet arm — on a BOARD==4 entry the rivet columns
 *          (0x7623/0x7583) stay untouched while the oracle paints them.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0486.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0486 as oracle } from "../../translated/loc_0486.js";
import { dispatchColorCyclePaint } from "../dispatchColorCyclePaint.js";
import { runRivetColorCycleBlink } from "../runRivetColorCycleBlink.js";
import { paintColorColumnWithLowCode } from "../paintColorColumnWithLowCode.js";
import { paintColorColumnAndHoldBlink } from "../paintColorColumnAndHoldBlink.js";
import { Machine } from "../../machine.js";
import { BOARD, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0486;
const CAP_FRAMES = 2000; // attract dispatches 0x0486 ~1197× and sweeps the phase across 0x00..0x7F
const SWEEP_COUNTER = 0x6390;
const RIVET_COLUMN_A_TOP = 0x7623; // a cell the rivet arm paints and the non-rivet arms never touch

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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

/** Run the ORACLE on a fresh clone. It performs its own net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so
 * pc + SP match the oracle's (the idiomatic router replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself — the harness supplies the one return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x0486 in a real attract run and clone the machine at up to K real dispatches. The
 * wrapper snapshots the entry state, then runs the oracle so the host game proceeds undisturbed.
 * Single runFrames() call — frame-by-frame stepping shifts NMI timing and takes a different
 * attract branch (see docs/decompiler-pipeline).
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

// -- crafted-entry builders ---------------------------------------------------

/** Clone `base` and pose the board / sweep-counter RAM — a real state, surgical nudge. */
function pose(base, { board, phase }) {
  const w = base.clone();
  if (board !== undefined) w.mem.write8(BOARD, board & 0xff);
  if (phase !== undefined) w.mem.write8(SWEEP_COUNTER, phase & 0xff);
  return w;
}

/** Sentinel-fill a whole 256-byte page (page = high byte) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// -- broken twins -------------------------------------------------------------

// Both twins reuse the real idiomatic arms, so the ONLY divergence is the injected routing bug.

/** BUG: ignores the phase bit and always paints the LOW colour code (skips the 0xEF arm). */
function teethIgnorePhase(m) {
  const { regs, mem } = m;
  regs.c = mem.read8(SWEEP_COUNTER);
  regs.de = 0x20;
  if (mem.read8(BOARD) === 4) { runRivetColorCycleBlink(m); return; }
  paintColorColumnWithLowCode(m); // BUG: should route to the 0xEF arm when phase's bit 6 is set
}

/** BUG: never routes to the rivet arm — treats BOARD==4 as an ordinary board. */
function teethNoRivet(m) {
  const { regs, mem } = m;
  const phase = mem.read8(SWEEP_COUNTER);
  regs.c = phase;
  regs.de = 0x20;
  // BUG: the `if (BOARD == 4) rivet` check is missing.
  if (phase === 0) { paintColorColumnWithLowCode(m); return; }
  if (phase & 0x40) { regs.a = 0xef; paintColorColumnAndHoldBlink(m); return; }
  paintColorColumnWithLowCode(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): dispatchColorCyclePaint == oracle on every captured 0x0486 entry", () => {
  const caps = captureDispatches(2000, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x0486 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, dispatchColorCyclePaint); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const phases = new Set(caps.map((c) => c.mem.read8(SWEEP_COUNTER) & 0xff));
  const sawBit6Set = [...phases].some((p) => (p & 0x40) !== 0 && p !== 0);
  const sawPhaseZero = phases.has(0);
  assert.ok(sawBit6Set, "attract never reached a bit-6-set phase — the 0xEF arm was not exercised");
  assert.ok(sawPhaseZero, "attract never reached phase 0 — the low-code arm was not exercised");
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical; ${phases.size} distinct phases 0x00..${hb(Math.max(...phases))}`);
});

// -- 2. CRAFTED (unreached rivet arm + pinned phases) -------------------------

test("CRAFTED: the BOARD==4 rivet arm and the pinned phase arms match the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) BOARD==4 rivet arm (cold in a 25m attract). Verify the oracle genuinely paints the rivet
  //     column 0x7623 (a cell the non-rivet arms never touch), then match the whole contract.
  {
    const w = pose(base, { board: 4 });
    paintPage(w, 0x76, 0x11);
    paintPage(w, 0x75, 0x11);
    const oc = w.clone();
    oracle(oc);
    assert.notEqual(oc.mem.read8(RIVET_COLUMN_A_TOP) & 0xff, 0x11, "rivet arm not exercised (0x7623 unchanged)");
    const diffs = contractDiffs(w, dispatchColorCyclePaint);
    assert.equal(diffs.length, 0, `rivet arm: ${diffs.join("; ")}`);
  }

  // (b) Pinned non-rivet phases: 0x00 (phase 0 -> low), 0x20 (bit 6 clear -> low), 0x40 (bit 6
  //     set -> high 0xEF). Board 1 so the rivet check falls through.
  for (const phase of [0x00, 0x20, 0x40]) {
    const w = pose(base, { board: 1, phase });
    paintPage(w, 0x75, 0x22);
    paintPage(w, 0x76, 0x22);
    const diffs = contractDiffs(w, dispatchColorCyclePaint);
    assert.equal(diffs.length, 0, `phase ${hb(phase)}: ${diffs.join("; ")}`);
  }

  console.log("  CRAFTED: rivet arm + phases 0x00/0x20/0x40 — identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the ignore-phase twin and the no-rivet twin are CAUGHT", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) ignore-phase: on a bit-6-set entry the oracle paints the column 0xEF/0xEE/0xED while the
  //     twin paints 0x10/0x0F/0x0E, so the colour cells diverge.
  const ip = pose(base, { board: 1, phase: 0x40 });
  paintPage(ip, 0x75, 0x33);
  paintPage(ip, 0x76, 0x33);
  const dIgnore = contractDiffs(ip, teethIgnorePhase);
  assert.notEqual(dIgnore.length, 0, "the gate FAILED to catch the ignore-phase twin — it is worthless");

  // (b) no-rivet: on a BOARD==4 entry the oracle paints the rivet columns; the twin routes to a
  //     non-rivet arm and leaves 0x7623 at its sentinel value, so memory diverges.
  const nr = pose(base, { board: 4, phase: 0x10 });
  paintPage(nr, 0x75, 0x44);
  paintPage(nr, 0x76, 0x44);
  const dNoRivet = contractDiffs(nr, teethNoRivet);
  assert.notEqual(dNoRivet.length, 0, "the gate FAILED to catch the no-rivet twin — it is worthless");

  console.log(`  TEETH: ignore-phase caught (${dIgnore[0]}); no-rivet caught (${dNoRivet[0]})`);
});
