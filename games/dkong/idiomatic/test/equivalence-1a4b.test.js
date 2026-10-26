// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for armEdgeRivetPickup (ROM 0x1a4b) — the "arm the edge-item pickup"
 * store. arm_1a4b raises EDGE_RIVET_ARMED (0x6291) = 1 unconditionally and returns; it
 * is a LEAF that reads NOTHING, calls nothing, and writes exactly one byte. Because it
 * reads nothing, its output is a constant store — a total function with no live input —
 * so it is gated the strongest way such a routine can be: swept EXHAUSTIVELY over all
 * 256 PRIOR values of the target byte (proving the store is unconditional, independent
 * of what was there), on a real captured attract machine, compared on RAM (minus
 * STACK_SCRATCH) + pc + SP. Every case runs on a FRESH clone (the routine WRITES memory).
 *
 * Live-out is memory-only (0x6291 := 1): the sole exit successor (loc_197a's next call,
 * sub_2a85) overwrites A with `ld a,(0x6215)` before reading it, so the oracle's residual
 * A == 1 is dead ABI and the register file is deliberately NOT compared.
 *
 *   0. REACHABILITY — attract never dispatches 0x1a4b (the player never stands on an
 *      exact screen-edge column MARIO_X 0x4B/0xB3, the only way here). Asserted at 0,
 *      which is exactly why the gate is crafted-entry rather than real-dispatch. The
 *      SAME host run captures a real mid-attract machine at the first sub_1a33 dispatch
 *      (0x1a33, the caller — reached ~1478x on 25m attract) as the realistic base: its
 *      SP already holds loc_197a's real return address, so the `ret` lands correctly.
 *
 *   1. EQUAL (exhaustive) — sweep all 256 prior values of 0x6291, each staged on the
 *      real base, and confirm armEdgeRivetPickup == oracle on RAM − the stack scratch below the entry SP + pc +
 *      SP, and that 0x6291 ends 1 in every case. 256 cases cover the whole (only) input
 *      the routine could conceivably read — it reads none, so all end identically.
 *
 *   2. FOOTPRINT — the oracle writes exactly ONE non-stack byte, 0x6291; nothing else.
 *      This licenses the "touches only 0x6291" claim in the routine header.
 *
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) wrong-VALUE twin (stores 0x00 instead of 0x01) — caught by the RAM diff at
 *          0x6291 (the flag would never arm);
 *      (b) wrong-ADDRESS twin (stores 1 to 0x6290 = RIVETS_LEFT instead of 0x6291) —
 *          caught by the RAM diff (corrupts the rivet count, leaves the flag unarmed);
 *      (c) extra-stack-pop twin (a leaked pop the direct-call routine must NOT do) —
 *          caught by the SP diff on every case.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so the
 * harness performs one m.ret() on the candidate clone AFTER the call to line pc + SP up
 * with the oracle (which rets internally). The oracle only READS the stack (the ret pop),
 * never writes it, so RAM is byte-equal on both sides regardless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1a4b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a4b as oracle } from "../../translated/loc_1a4b.js";
import { loc_1a33 as oracle1a33 } from "../../translated/loc_1a33.js";
import { armEdgeRivetPickup } from "../armEdgeRivetPickup.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, EDGE_RIVET_ARMED } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1a4b;      // arm_1a4b
const CALLER = 0x1a33;      // sub_1a33 (dispatched in attract; base source)
const RIVETS_LEFT = 0x6290; // sits just below EDGE_RIVET_ARMED (0x6291); wrong-addr teeth target
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

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

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over RAM − the stack scratch below the entry SP + pc + SP (live-out is memory-only). */
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

/**
 * One host attract run that (a) counts how often 0x1a4b is dispatched — it never is —
 * and (b) captures a real mid-attract machine at the first sub_1a33 dispatch (0x1a33,
 * the caller) to serve as the realistic base: it carries a valid SP with loc_197a's
 * real return address on top. Both hooks delegate to their oracle so the host run
 * proceeds undisturbed.
 */
function captureBaseAndCount(maxFrames) {
  let base = null;
  let count = 0;
  const overrides = new Map([
    [CALLER, (mm) => { if (base === null) base = mm.clone(); return oracle1a33(mm); }],
    [TARGET, (mm) => { count++; return oracle(mm); }],
  ]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return { base, count };
}

/** A crafted entry: the real captured machine with 0x6291 set to a chosen prior value. */
function craft(base, prior) {
  const c = base.clone();
  c.mem.write8(EDGE_RIVET_ARMED, prior);
  return c;
}

/** Broken twin (a): stores 0x00 instead of 0x01 — the flag would never arm. */
function brokenWrongValue(m) {
  m.mem.write8(EDGE_RIVET_ARMED, 0x00); // BUG: should be 0x01
}

/** Broken twin (b): stores 1 to 0x6290 (RIVETS_LEFT) instead of 0x6291. */
function brokenWrongAddr(m) {
  m.mem.write8(RIVETS_LEFT, 0x01); // BUG: should target EDGE_RIVET_ARMED (0x6291)
}

/** Broken twin (c): correct store, then a leaked stack pop the direct-call routine must not do. */
function brokenExtraPop(m) {
  m.mem.write8(EDGE_RIVET_ARMED, 0x01);
  m.pop16(); // BUG: a stray pop -> candidate SP ends 2 past the oracle's after the harness ret
}

// -- 0. REACHABILITY + base capture -------------------------------------------

let BASE = null;

test("REACHABILITY: attract never dispatches 0x1a4b; a real base machine is captured via 0x1a33", () => {
  const { base, count } = captureBaseAndCount(2500);
  assert.equal(count, 0, `expected 0x1a4b to be unreached in attract, saw ${count} dispatches`);
  assert.ok(base, "expected a real 0x1a33 dispatch during 25m attract to seed the crafted-entry base");
  BASE = base;
  console.log(`  REACHABILITY: 0x1a4b dispatched 0x times in 2500 attract frames; base captured at 0x1a33 (SP=0x${base.regs.sp.toString(16)})`);
});

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): armEdgeRivetPickup == oracle over all 256 prior values of 0x6291", () => {
  assert.ok(BASE, "base machine not captured (reachability test must run first)");
  let count = 0;
  let firstFail = null;
  for (let prior = 0; prior < 256 && !firstFail; prior++) {
    const entry = craft(BASE, prior);
    const diffs = contractDiffs(entry, armEdgeRivetPickup); // FRESH clones inside
    // The store is unconditional: whatever was there, it ends 1.
    if (runOracle(entry).mem.read8(EDGE_RIVET_ARMED) !== 1) {
      firstFail = { prior, diffs: ["oracle did not leave 0x6291 = 1"] };
    } else if (diffs.length) {
      firstFail = { prior, diffs };
    }
    count++;
  }
  assert.equal(
    firstFail,
    null,
    firstFail && `mismatch with prior 0x6291=${hx(firstFail.prior)}: ${firstFail.diffs.join("; ")}`,
  );
  assert.equal(count, 256, "must have swept all 256 prior values");
  console.log(`  EQUAL/exhaustive: ${count} prior values identical to the oracle on RAM−STACK + pc + SP; 0x6291 ends 1 every time`);
});

// -- 2. FOOTPRINT -------------------------------------------------------------

test("FOOTPRINT: the oracle writes exactly one non-stack byte — 0x6291 — and nothing else", () => {
  assert.ok(BASE, "base machine not captured (reachability test must run first)");
  for (const prior of [0x00, 0x42, 0xff]) {
    const entry = craft(BASE, prior);
    const before = entry.dumpState();
    const after = runOracle(entry).dumpState();
    const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
    let touched = null, extra = false;
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      if (before[i] === after[i]) continue;
      const a = entry.stateOffsetToAddr(i);
      if (dead(a)) continue; // the ret's stack pop is not a write anyway
      if (a === EDGE_RIVET_ARMED) touched = a;
      else extra = true;
    }
    assert.equal(extra, false, `oracle wrote a non-stack byte other than 0x6291 for prior ${hx(prior)}`);
    assert.equal(touched, EDGE_RIVET_ARMED, `oracle did not write 0x6291 for prior ${hx(prior)}`);
  }
  console.log("  FOOTPRINT: exactly one non-stack byte written per call — 0x6291 — across every prior value");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-value, wrong-address, and extra-pop twins are all CAUGHT", () => {
  assert.ok(BASE, "base machine not captured (reachability test must run first)");

  // (a) wrong-value: oracle leaves 0x6291 = 1, twin leaves 0 -> caught at 0x6291.
  const valEntry = craft(BASE, 0x00);
  const valDiffs = contractDiffs(valEntry, brokenWrongValue);
  assert.ok(valDiffs.length > 0, "the wrong-value twin escaped — the RAM gate is worthless");
  assert.ok(valDiffs[0].includes("0x6291"), `wrong-value twin should be caught at 0x6291, got: ${valDiffs.join("; ")}`);

  // (b) wrong-address: twin bumps 0x6290 and leaves 0x6291 unarmed -> caught.
  const addrEntry = craft(BASE, 0x00);
  const addrDiffs = contractDiffs(addrEntry, brokenWrongAddr);
  assert.ok(addrDiffs.length > 0, "the wrong-address twin escaped — the RAM gate is worthless");

  // (c) extra-pop: correct store, but SP ends 2 past the oracle's -> caught by the SP diff.
  const popEntry = craft(BASE, 0x00);
  const popDiffs = contractDiffs(popEntry, brokenExtraPop);
  assert.ok(popDiffs.some((d) => d.startsWith("SP")), `the extra-pop twin escaped the SP gate: ${popDiffs.join("; ")}`);

  console.log(
    `  TEETH: wrong-value caught (${valDiffs[0]}); wrong-address caught (${addrDiffs[0]}); ` +
      `extra-pop caught (${popDiffs.find((d) => d.startsWith("SP"))})`,
  );
});
