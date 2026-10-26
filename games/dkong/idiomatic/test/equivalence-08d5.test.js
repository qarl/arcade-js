// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for readStartButtonSelector (ROM 0x08D5) — the credit-screen
 * start-button read (and its once-every-8-frames prompt redraw).
 *
 * loc_08d5 dispatches only while a game is CREDITED (game-state 2), which a plain
 * attract run never reaches, so this test DRIVES the machine: it inserts coins on
 * the input tape (IN2 bit7) and captures the routine's real dispatches on the
 * credit screen. It WRITES MEMORY (VRAM, on the 1-in-8 draw frames, via the two
 * draw callees) and its own body ends in a `ret`, so it is gated on memory-
 * equivalence — RAM (−STACK_SCRATCH) + pc + SP + declared live-out A — never the
 * full register file, never cycles. Every case runs on FRESH clones (the routine
 * writes memory and kicks the watchdog; nothing may be reused).
 *
 *   1. EQUAL (real driven dispatches) — insert TWO coins and capture true 0x08D5
 *      entries. Two coins reach BOTH mask arms (CREDITS==1 -> B=0x04; CREDITS>1 ->
 *      B=0x0C) and, because the routine runs every credited frame, both the draw
 *      frames ((FRAME&7)==0, which redraw VRAM) and the 7-in-8 skip frames. For
 *      each capture the ORACLE and readStartButtonSelector run on separate clones
 *      and must agree on RAM + pc + SP + A. (With no start pressed IN2's start bits
 *      are 0, so A is 0 here — the draw-arm VRAM is what this arm chiefly pins.)
 *
 *   2. EQUAL (crafted start-pressed) — the mask B only reaches A when a start
 *      button is actually pressed, which the driven run above never does. So from a
 *      real capture, assert IN2's START1|START2 bits (0x0C) and force a SKIP frame
 *      (so B stays the built mask), for CREDITS==1 and CREDITS==2. The oracle
 *      returns A = 0x0C & 0x04 = 0x04 (1 credit) and 0x0C & 0x0C = 0x0C (2 credits);
 *      readStartButtonSelector must match — proving the mask is built correctly.
 *
 *   3. TEETH — two deliberately-broken twins the gate MUST catch:
 *      (a) wrong-mask: uses B=0x08 for the 1-credit arm (START2 instead of START1).
 *          Invisible on the no-start real captures (A==0 either way), so it is
 *          caught on the crafted start-pressed 1-credit arm, where A = 0x0C & 0x08
 *          = 0x08 ≠ the oracle's 0x04.
 *      (b) skip-draw: never redraws the prompt. Caught by the VRAM the oracle writes
 *          and the twin does not — but ONLY when the redraw is non-idempotent (the
 *          on-screen content actually changes). On a static screen the redraw is a
 *          no-op, so it bites on the real credit-count-change frames (>= 1) and, for
 *          a guaranteed bite, on a crafted draw frame with a freshly-poked credit count.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-08d5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08d5 as oracle } from "../../translated/loc_08d5.js";
import { readStartButtonSelector } from "../readStartButtonSelector.js";
import { drawStringVertical } from "../drawStringVertical.js";
import { drawCreditDisplay } from "../drawCreditDisplay.js";
import { CREDITS, FRAME, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x08d5;
const IN2 = 0x7d00;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region the standard gate excludes. The oracle's push16/m.call/m.ret
 * touch only bytes at or below the entry SP, all inside STACK_SCRATCH on the real
 * NMI stack.
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

/** Run the ORACLE on a fresh clone. Its final `ret` pops the caller-return, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model the routine's own `ret` with one
 * m.ret() so pc + SP line up with the oracle. The idiomatic routine replaces the
 * Z80 stack with the JS call stack, so it never touches pc/SP itself — the harness
 * supplies the caller-return pop.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over RAM − the stack scratch below the entry SP, pc, SP, and live-out A. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=${hx(o.regs.a)} cand=${hx(c.regs.a)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture (driven: insert coins to reach the credit screen) ----------------

/**
 * Insert `coins` coins on the input tape (each a 6-frame IN2-bit7 hold, MAME's coin
 * hold, spaced 40 frames), hook 0x08D5, and clone the machine at up to K real
 * dispatches. The wrapper snapshots the entry state then runs the oracle so the host
 * game proceeds undisturbed. Two coins reach both mask arms and both draw/skip frames.
 */
function captureDriven(K, maxFrames, coins) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.inputTape = [];
  for (let i = 0; i < coins; i++) host.inputTape.push({ port: IN2, bits: 0x80, frame: 150 + i * 40, dur: 6 });
  host.runFrames(maxFrames);
  return caps;
}

/** Classify a captured entry by its arm, for coverage assertions. */
function armOf(cap) {
  return {
    oneCredit: cap.mem.read8(CREDITS) === 0x01,
    draw: (cap.mem.read8(FRAME) & 0x07) === 0,
  };
}

// -- teeth twins --------------------------------------------------------------

/** Broken twin: uses B=0x08 (START2) instead of 0x04 (START1) for the 1-credit mask. */
function teethWrongMask(m) {
  const { regs, mem } = m;
  if (mem.read8(CREDITS) === 0x01) {
    regs.b = 0x08; // BUG: should be 0x04 (START1)
    regs.e = 0x09;
  } else {
    regs.b = 0x0c;
    regs.e = 0x0a;
  }
  if ((mem.read8(FRAME) & 0x07) === 0) {
    regs.a = regs.e;
    drawStringVertical(m);
    drawCreditDisplay(m);
  }
  regs.a = mem.read8(IN2) & regs.b;
}

/** Broken twin: never redraws the prompt (drops the 1-in-8 draw arm entirely). */
function teethSkipDraw(m) {
  const { regs, mem } = m;
  if (mem.read8(CREDITS) === 0x01) {
    regs.b = 0x04;
    regs.e = 0x09;
  } else {
    regs.b = 0x0c;
    regs.e = 0x0a;
  }
  // BUG: the (FRAME & 7) == 0 redraw is missing.
  regs.a = mem.read8(IN2) & regs.b;
}

// -- 1. EQUAL (real driven dispatches) ----------------------------------------

test("EQUAL (real driven): readStartButtonSelector == oracle on every captured 0x08D5 dispatch", () => {
  const caps = captureDriven(400, 1200, 2);
  assert.ok(caps.length >= 1, "expected at least one real 0x08D5 dispatch after inserting coins");

  let oneCredit = 0, multiCredit = 0, draw = 0, skip = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, readStartButtonSelector); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    const a = armOf(cap);
    a.oneCredit ? oneCredit++ : multiCredit++;
    a.draw ? draw++ : skip++;
  }
  assert.ok(oneCredit >= 1, "no CREDITS==1 (B=0x04) dispatch captured");
  assert.ok(multiCredit >= 1, "no CREDITS>1 (B=0x0C) dispatch captured");
  assert.ok(draw >= 1, "no draw-frame ((FRAME&7)==0) dispatch captured — VRAM arm unexercised");
  assert.ok(skip >= 1, "no skip-frame dispatch captured");
  console.log(
    `  EQUAL/real: ${caps.length} dispatches identical (RAM + pc + SP + A) — ` +
      `1-credit=${oneCredit}, >1-credit=${multiCredit}, draw=${draw}, skip=${skip}`,
  );
});

// -- 2. EQUAL (crafted start-pressed) -----------------------------------------

test("EQUAL (crafted): the built mask reaches A when a start button is pressed", () => {
  const caps = captureDriven(1, 1200, 1);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // Real captured RAM, a safe stack pointer, START1|START2 asserted on IN2, and a
  // forced SKIP frame so B stays the built mask (the draw arm's callees would clobber B).
  const craft = (credits) => {
    const e = seed.clone();
    e.regs.sp = 0x6bfe;
    e.io.inputAssert = { [IN2]: 0x0c }; // START1 | START2 pressed
    e.mem.write8(CREDITS, credits);
    e.mem.write8(FRAME, 0x01); // (FRAME & 7) != 0 -> skip the redraw
    return e;
  };

  const cases = [
    { name: "credits=1 -> A=0x04 (START1 only)", e: craft(0x01), wantA: 0x04 },
    { name: "credits=2 -> A=0x0C (START1|START2)", e: craft(0x02), wantA: 0x0c },
  ];
  for (const { name, e, wantA } of cases) {
    const diffs = contractDiffs(e, readStartButtonSelector);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    // Confirm the arm is actually observable (the oracle really returns the mask in A).
    assert.equal(runOracle(e).regs.a, wantA, `${name}: oracle A should be ${hx(wantA)}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} start-pressed arms identical; mask observable in A`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-mask and skip-draw twins are CAUGHT", () => {
  const caps = captureDriven(400, 1200, 2);
  assert.ok(caps.some((c) => armOf(c).draw), "need a draw-frame capture to catch the skip-draw twin");

  // (b) skip-draw: caught on the DRAW frames whose redraw actually changes VRAM
  // (a static-screen redraw is idempotent, so it bites only on the content-change
  // frames — the credit-count transitions). At least one such frame occurs naturally.
  let caughtSkip = 0, drawFrames = 0;
  for (const cap of caps) {
    if (!armOf(cap).draw) continue;
    drawFrames++;
    if (contractDiffs(cap, teethSkipDraw).length > 0) caughtSkip++;
  }
  assert.ok(
    caughtSkip >= 1,
    `the skip-draw twin escaped on all ${drawFrames} draw frames — the gate misses dropped VRAM`,
  );

  // (b, guaranteed) skip-draw on a crafted draw frame with a freshly-poked credit
  // count: the oracle repaints the new digit, the twin leaves the old one -> RAM diff.
  const drawSeed = caps.find((c) => armOf(c).draw) ?? caps[0];
  const crafted = drawSeed.clone();
  crafted.regs.sp = 0x6bfe;
  crafted.mem.write8(CREDITS, 0x99); // a count the on-screen digits do not already show
  crafted.mem.write8(FRAME, 0x00); // (FRAME & 7) == 0 -> force the redraw
  const skipDiffs = contractDiffs(crafted, teethSkipDraw);
  assert.ok(
    skipDiffs.some((d) => d.startsWith("RAM@")),
    `the skip-draw twin did not drop a VRAM write on the crafted differing-count draw frame ` +
      `(diffs: ${skipDiffs.join("; ") || "none"})`,
  );

  // (a) wrong-mask: invisible on no-start captures (A==0 either way); caught on the
  // crafted start-pressed 1-credit arm, where A = 0x0C & 0x08 = 0x08 ≠ oracle 0x04.
  const maskSeed = caps[0].clone();
  maskSeed.regs.sp = 0x6bfe;
  maskSeed.io.inputAssert = { [IN2]: 0x0c };
  maskSeed.mem.write8(CREDITS, 0x01);
  maskSeed.mem.write8(FRAME, 0x01); // skip frame -> B is the built mask
  const maskDiffs = contractDiffs(maskSeed, teethWrongMask);
  assert.ok(
    maskDiffs.some((d) => d.startsWith("A ")),
    `the wrong-mask twin was not caught on the start-pressed arm (diffs: ${maskDiffs.join("; ") || "none"})`,
  );

  console.log(
    `  TEETH: skip-draw caught on ${caughtSkip}/${drawFrames} real draw frames + the crafted ` +
      `differing-count frame (${skipDiffs.join("; ")}); wrong-mask caught on the start-pressed arm ` +
      `(${maskDiffs.join("; ")})`,
  );
});
