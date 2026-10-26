// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1e94 (ROM 0x1E94) — the unconditional caller-skip.
 *
 * entry_1e94 is a LEAF whose entire effect is control flow: it discards the caller's own
 * return frame and returns one level further up, so the routine that reached it is skipped.
 * It writes NO work RAM and depends on NO input — it always skips. The only memory-equivalence
 * observables are therefore pc + SP (RAM − the stack scratch below the entry SP is trivially unchanged on both sides).
 *
 * The idiomatic loc_1e94 models no stack: it returns the caller-skip boolean (always false),
 * and a real caller consumes it as `if (!loc_1e94(m)) return;`. So this harness plays the
 * caller — it interprets the returned boolean exactly as that idiom would and applies the
 * matching stack effect, then compares against the oracle:
 *   • false (skip)    -> discard the caller's frame and return past it (two pops): the oracle's
 *                        own `pop hl / ret`.
 *   • true  (proceed) -> a plain single return to the caller's continuation (one pop).
 * The oracle always skips, so a correct loc_1e94 must always return false; a twin that returns
 * true is modelled as the proceed path and diverges on pc + SP — that is the polarity tooth.
 *
 *   1. EQUAL (crafted) — over many crafted stacks (varied caller-caller return target and
 *      stack pointer, including 0x0000/0xFFFF/boundary targets), loc_1e94 == oracle on
 *      RAM − the stack scratch below the entry SP, pc, SP. A non-vacuity check confirms the oracle actually skipped
 *      (SP advanced by four, pc became the caller-caller target), so the match is not a
 *      two-no-ops coincidence.
 *
 *   2. TEETH — two broken twins, each MUST be caught:
 *      (a) proceeds instead of skipping (returns true) — caught on pc + SP.
 *      (b) scribbles a work-RAM byte — caught by the RAM − the stack scratch below the entry SP diff.
 *
 *   3. REACHABILITY — hook 0x1E94 across a real attract run; it is currently unreachable
 *      (its caller's 0x1E96 arm is untranslated), so the expected count is 0. Any dispatch
 *      that DOES occur is validated against the oracle, so the arm turns real for free the
 *      day the routine becomes reachable. The count is reported, not asserted > 0.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e94.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e94 as oracle } from "../../translated/loc_1e94.js";
import { loc_1e94 } from "../loc_1e94.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e94;
// Top of the crafted stack: pops walk downward from here, staying inside work RAM (never I/O)
// and inside STACK_SCRATCH so the setup bytes are excluded from the RAM diff.
const SP_TOP = 0x6bfc;
const SCRIBBLE = 0x6300; // an arbitrary work-RAM cell, outside the stack scratch below the entry SP, for the RAM tooth.

const hx = (v) => "0x" + (v & 0xffff).toString(16);

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

/** Run the ORACLE on a fresh clone. It performs its own `pop hl / ret` skip. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  const proceed = fn(c);
  if (proceed) {
    c.ret(); // proceed: normal single return
  } else {
    c.pop16(); // skip: discard the caller's own return frame ...
    c.ret(); // ... and return past it to the caller's caller
  }
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is the control-flow skip. */
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

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic
// values (the routine ignores all of it, but this gives the RAM tooth a realistic backdrop).
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x1E94 dispatch: a stack whose top word is the caller's own return frame
// (discarded by the skip) and whose next word is the caller-caller target the skip returns to.
function craft(base, { callerFrame, callerCaller, spTop = SP_TOP }) {
  const m = base.clone();
  m.regs.sp = spTop;
  m.push16(callerCaller); // lands one word below the top ...
  m.push16(callerFrame); // ... and this becomes the top (discarded) word
  return m;
}

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): loc_1e94 == oracle across varied stacks (RAM − the stack scratch below the entry SP, pc, SP)", () => {
  const base = attractBase();

  const cases = [
    { callerFrame: 0x1980, callerCaller: 0x197d }, // the real 0x197D caller / 0x1980 frame
    { callerFrame: 0x0000, callerCaller: 0x0000 },
    { callerFrame: 0xffff, callerCaller: 0xffff },
    { callerFrame: 0x1234, callerCaller: 0x02cd },
    { callerFrame: 0xabcd, callerCaller: 0x1e96 },
    { callerFrame: 0x00ff, callerCaller: 0xff00 },
    { callerFrame: 0x1980, callerCaller: 0x197d, spTop: 0x6bf6 }, // a different SP window
    { callerFrame: 0x8001, callerCaller: 0x0100, spTop: 0x6bfe },
  ];

  for (const opts of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_1e94);
    assert.equal(diffs.length, 0, `stack ${JSON.stringify(opts)}: ${diffs.join("; ")}`);

    // Non-vacuity: the oracle genuinely skipped — SP advanced by four (two pops) and pc is
    // the caller-caller target, so a green match is a real skip, not two idle no-ops.
    const o = runOracle(entry);
    assert.equal(o.pc, opts.callerCaller, `oracle pc should be the caller-caller target`);
    assert.equal(o.regs.sp, (opts.spTop ?? SP_TOP), `oracle SP should advance by four (two pops)`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} crafted stacks — loc_1e94 == oracle on pc + SP + RAM`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** Broken twin (a): proceeds instead of skipping (wrong caller-skip polarity). */
function brokenProceed(m) {
  return true; // BUG: should be false — always skip
}

/** Broken twin (b): scribbles a work-RAM byte before skipping. */
function brokenScribble(m) {
  const { mem } = m;
  mem.write8(SCRIBBLE, mem.read8(SCRIBBLE) ^ 0xff); // BUG: writes RAM (a leaf writes none)
  return false;
}

test("TEETH: the proceed-instead-of-skip twin and the RAM-scribble twin are CAUGHT", () => {
  const base = attractBase();
  const entry = craft(base, { callerFrame: 0x1980, callerCaller: 0x197d });

  // (a) wrong polarity: the proceed path returns to the caller's own frame (0x1980) instead
  // of past it (0x197D), so pc AND SP diverge from the oracle.
  const proceedDiffs = contractDiffs(entry, brokenProceed);
  assert.ok(proceedDiffs.length > 0, "the proceed-instead-of-skip twin escaped — the gate is worthless");
  assert.ok(
    proceedDiffs.some((d) => d.startsWith("pc")) && proceedDiffs.some((d) => d.startsWith("SP")),
    `expected pc + SP divergence, got: ${proceedDiffs.join("; ")}`,
  );

  // (b) RAM scribble: a byte written outside the stack scratch below the entry SP must be caught by the RAM diff.
  const scribbleDiffs = contractDiffs(entry, brokenScribble);
  assert.ok(scribbleDiffs.length > 0, "the RAM-scribble twin escaped — the RAM check is worthless");
  assert.ok(
    scribbleDiffs[0].startsWith(`RAM@${hx(SCRIBBLE)}`),
    `expected the scribble diff at ${hx(SCRIBBLE)}, got ${scribbleDiffs[0]}`,
  );

  console.log(`  TEETH: proceed twin caught (${proceedDiffs.join("; ")}); scribble twin caught (${scribbleDiffs[0]})`);
});

// -- 3. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x1E94 dispatches in attract are validated (currently 0 — 0x1E96 untranslated)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);

  // Validate any real dispatch that occurred; today there are none (the caller's 0x1E96 arm
  // is untranslated), so this loop is a no-op that becomes real coverage once it lands.
  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_1e94);
    assert.equal(diffs.length, 0, `captured 0x1E94 dispatch: ${diffs.join("; ")}`);
  }
  console.log(`  REACHABILITY: ${caps.length} real 0x1E94 dispatches in 1200 frames (expected 0 — currently unreachable)`);
});
