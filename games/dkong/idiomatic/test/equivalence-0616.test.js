// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for drawCreditDisplay (ROM 0x0616) — the "CREDIT nn" line: draw the
 * "CREDIT" label (string 5, via drawStringVertical/0x05E9) then render the credit count
 * (CREDITS 0x6001, packed BCD) as two digits at VRAM 0x74BF (via expandBcdDigits/0x0583,
 * reached by a TAIL JUMP so its `ret` returns to this routine's caller).
 *
 * This routine WRITES MEMORY (VRAM glyph + digit cells) and ends in a tail-call, so it is
 * gated on memory-equivalence — RAM (−STACK_SCRATCH) + pc + SP + declared live-out
 * (A/B/HL/IX/DE, the tail-callee's live-out) — never the full register file, never cycles.
 * Every case runs on a FRESH clone (this routine writes memory; only a read-only leaf may
 * reuse one).
 *
 * That register set is STRICTLY STRONGER than the routine's real live-out, deliberately and
 * at no cost: of the five, only B is genuinely consumed downstream (loc_08d5's `and b` reads
 * the B=0 the digit loop leaves). A/HL/IX/DE are dead ABI residue, reproduced and compared
 * anyway because the tail-call contract makes them free. Flags are dropped as dead. The
 * memory output is the "CREDIT" glyph cells 0x74FF..0x759F plus the two digit cells
 * 0x74BF (high) and 0x749F (low, one row up).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0616 in a real attract run and clone the
 *      machine at each true dispatch (it reaches here through the task queue). For each,
 *      run the ORACLE on one clone and drawCreditDisplay on another and confirm identical
 *      RAM + pc + SP + live-out. In attract the count is 0, so the digits render "00" and
 *      the "CREDIT" label lands in cells 0x74FF..0x759F.
 *
 *   2. EQUAL (crafted arms) — the digit VALUES attract never varies off 0, seeded from a
 *      real capture with surgical pokes to CREDITS: 0x12 (nibbles differ, so the high/low
 *      order is observable), 0x90 (the BCD cap), 0x99 (both nibbles set). Each compared
 *      identically on both sides.
 *
 *   3. TEETH (real + crafted) — two deliberately-broken twins the gate MUST catch:
 *      (a) wrong-SOURCE: renders CREDITS+1 (0x6002) instead of CREDITS as the count — a
 *          plausible off-by-one in the source literal. Caught on every real dispatch (the
 *          HL live-out exits 0x6001 not 0x6000) and, on a crafted arm where 0x6001≠0x6002,
 *          by the actual digit cells (the wrong number is painted).
 *      (b) wrong-STRING: draws string 4 ("HIGH SCORE") instead of 5 ("CREDIT"), so the
 *          "CREDIT" glyph cells never get written — caught on every real dispatch by the
 *          tilemap.
 *
 * The idiomatic routine models the tail-jump's `ret` as a JS return (no stack modelling),
 * so the harness performs one m.ret() on the candidate clone AFTER the call to line pc + SP
 * up with the oracle (which rets internally). The oracle's internal call/push/pop all sit
 * inside STACK_SCRATCH (SP ≤ 0x6BFE), excluded by the standard gate.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0616.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0616 as oracle } from "../../translated/loc_0616.js";
import { drawCreditDisplay } from "../drawCreditDisplay.js";
import { drawStringVertical } from "../drawStringVertical.js";
import { expandBcdDigits } from "../expandBcdDigits.js";
import { CREDITS } from "../names.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0616;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead
 * stack region excluded by the standard gate. The oracle's internal call/push16/pop and
 * final `ret` touch only bytes at or below SP=0x6BFE, all inside STACK_SCRATCH.
 */
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

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP, and
 * declared live-out A/B/HL/IX/DE. Returns human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=${hx(o.regs.a)} cand=${hx(c.regs.a)}`);
  if (o.regs.b !== c.regs.b) diffs.push(`B oracle=${hx(o.regs.b)} cand=${hx(c.regs.b)}`);
  if (o.regs.hl !== c.regs.hl) diffs.push(`HL oracle=0x${o.regs.hl.toString(16)} cand=0x${c.regs.hl.toString(16)}`);
  if (o.regs.ix !== c.regs.ix) diffs.push(`IX oracle=0x${o.regs.ix.toString(16)} cand=0x${c.regs.ix.toString(16)}`);
  if (o.regs.de !== c.regs.de) diffs.push(`DE oracle=0x${o.regs.de.toString(16)} cand=0x${c.regs.de.toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x0616 in a real attract run and clone the machine at up to K real dispatches. The
 * wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. drawCreditDisplay is dispatched via the main-loop task queue (entry_0611).
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

// -- teeth twins --------------------------------------------------------------

/** Broken twin: renders CREDITS+1 (0x6002) instead of CREDITS as the credit count. */
function teethWrongSource(m) {
  const { regs } = m;
  regs.a = 0x05;
  drawStringVertical(m);
  regs.hl = (CREDITS + 1) & 0xffff; // BUG: wrong source byte
  regs.de = 0xffe0;
  regs.ix = 0x74bf;
  regs.b = 0x01;
  expandBcdDigits(m);
}

/** Broken twin: draws string 4 ("HIGH SCORE") instead of string 5 ("CREDIT"). */
function teethWrongString(m) {
  const { regs } = m;
  regs.a = 0x04; // BUG: wrong string index
  drawStringVertical(m);
  regs.hl = CREDITS;
  regs.de = 0xffe0;
  regs.ix = 0x74bf;
  regs.b = 0x01;
  expandBcdDigits(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): drawCreditDisplay == oracle on every captured 0x0616 entry", () => {
  const caps = captureDispatches(32, 12000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0616 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, drawCreditDisplay); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical (RAM + pc + SP + A/B/HL/IX/DE)`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): nonzero credit-count values match the oracle", () => {
  const caps = captureDispatches(1, 12000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // Each craft: real captured RAM, a safe stack pointer (so the oracle's internal call and
  // final `ret` pop harmless STACK_SCRATCH bytes identically on both sides), and a poked
  // credit count so the digit values are actually exercised.
  const craft = (val) => {
    const e = seed.clone();
    e.regs.sp = 0x6bfe;
    e.mem.write8(CREDITS, val);
    return e;
  };

  const cases = [
    { name: "credits=0x12 (nibbles differ)", e: craft(0x12) },
    { name: "credits=0x90 (BCD cap)", e: craft(0x90) },
    { name: "credits=0x99 (both nibbles set)", e: craft(0x99) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, drawCreditDisplay);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} nonzero credit values identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-source and wrong-string twins are CAUGHT", () => {
  const caps = captureDispatches(16, 12000);
  assert.ok(caps.length >= 1, "need real captures to catch the broken twins");

  let caughtSrc = 0, caughtStr = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, teethWrongSource).length > 0) caughtSrc++;
    if (contractDiffs(cap, teethWrongString).length > 0) caughtStr++;
  }
  assert.ok(caughtSrc >= 1, "the wrong-source twin escaped detection on every real dispatch — the gate is worthless");
  assert.ok(caughtStr >= 1, "the wrong-string twin escaped detection on every real dispatch — the gate is worthless");

  // And on a crafted arm where 0x6001 ≠ 0x6002, the wrong-source twin paints the WRONG
  // number — a guaranteed memory (digit-cell) divergence, not just a register one.
  const seed = caps[0].clone();
  seed.regs.sp = 0x6bfe;
  seed.mem.write8(CREDITS, 0x12); //     the real count
  seed.mem.write8((CREDITS + 1) & 0xffff, 0x34); // the byte the buggy twin would render
  const craftedDiffs = contractDiffs(seed, teethWrongSource);
  assert.ok(
    craftedDiffs.some((d) => d.startsWith("RAM@")),
    "the wrong-source twin did not paint a wrong digit on the crafted differing-byte arm",
  );

  console.log(
    `  TEETH: wrong-source caught on ${caughtSrc}/${caps.length}, wrong-string on ${caughtStr}/${caps.length} ` +
      `real dispatches; crafted differing-byte arm caught by the digit cells (${craftedDiffs.join("; ")})`,
  );
});
