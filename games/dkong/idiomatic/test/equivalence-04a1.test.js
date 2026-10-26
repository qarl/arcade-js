// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for paintColorColumnWithLowCode (ROM 0x04a1) — the colour-cycle blink
 * driver's LOW-CODE arm: preset the fill code to 0x10, then fall through into loc_04a3 to
 * paint the 3-cell descending colour column at 0x75C4 and hold sprite record #1's blink.
 *
 * loc_04a1's ONLY own instruction is `ld a,0x10`; everything observable happens in the tail it
 * falls into (loc_04a3 -> sub_0514 fill + loc_04ac blink store). So it WRITES memory (three
 * colour cells + 0x6905) and reads DE / C live-in from loc_0486; it forces A = 0x10, discarding
 * whatever A arrived. Its declared LIVE-OUT is memory-only — the exit chain reads no register the
 * oracle leaves — so it is validated on RAM (minus the stack scratch below the entry SP) + pc + SP via capture/clone/
 * replay. NEVER the full register file, NEVER cycles.
 *
 * A bare `new Machine(ROM)` runs the exact TRANSLATED routines for every address — machine.js on
 * the default constructor path: "when that is omitted this produces an empty Map with no imports
 * and no async — every such player gets the exact translated behaviour" — so on both sides the deeper
 * callees (0x04a3/0x0514/0x04ac) are the oracle; only the top-level routine differs. The oracle
 * loc_04a1 falls into loc_04a3, whose net stack effect is exactly ONE return (loc_04a3 push16s a
 * link, sub_0514 rets it, then loc_04ac rets the caller — push + two rets = one net pop); the
 * pushed link byte lands in STACK_SCRATCH (excluded). The idiomatic routine models the Z80 stack
 * as the JS call stack, so the harness performs ONE m.ret() on the candidate clone to line pc +
 * SP up with the oracle. Every case runs on a FRESH clone (this routine writes memory).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x04a1 in a real attract run and clone at each
 *      true dispatch (loc_0486's low-code arm on boards 1–3, DE=0x20). Oracle vs candidate on
 *      fresh clones over the whole contract.
 *
 *   2. CRAFTED (unreached arms / pins) — reposed on a real captured base: the once-per-sweep
 *      toggle-phase store ((C & 0x47)==0x40, verified to genuinely XOR 0x03 at 0x6905); a
 *      non-0x20 stride (DE=0x0080) that pins DE is honored end-to-end; and an incoming A=0x99
 *      that pins this arm FORCES 0x10 (the oracle writes 0x10, not 0x99, at 0x75C4).
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught on a sentinel entry:
 *      (a) wrong-code: presets 0xEF instead of 0x10, so the colour cells diverge.
 *      (b) no-preset: skips the `ld a,0x10`, using the incoming A (posed 0x99), so on entry the
 *          fill lays 0x99/0x98/0x97 instead of 0x10/0x0F/0x0E — pins loc_04a1's own instruction.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-04a1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04a1 as oracle } from "../../translated/loc_04a1.js";
import { paintColorColumnWithLowCode } from "../paintColorColumnWithLowCode.js";
import { paintColorColumnAndHoldBlink } from "../paintColorColumnAndHoldBlink.js";
import { Machine } from "../../machine.js";
import { SPRITE_BUFFER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x04a1;
const CAP_FRAMES = 1200; // attract reaches loc_0486 -> low-code arm (0x04a1) well within this window
const SPRITE1_CODE = SPRITE_BUFFER + 5; // 0x6905
const COLOR_COLUMN_TOP = 0x75c4;

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

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. The register
 * file and flags are deliberately NOT compared — live-out is memory-only. Returns a list of
 * human-readable mismatches (empty when equal).
 */
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
 * Hook 0x04a1 in a real attract run and clone the machine at up to K real dispatches. The
 * wrapper snapshots the entry state, then runs the oracle so the host game proceeds undisturbed.
 * Single runFrames() call — frame-by-frame stepping shifts NMI timing (see docs/decompiler-pipeline).
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

/** Clone `base` and pose the live-in registers A / DE / C — a real state, surgical nudge. */
function poseRegs(base, { a, de, c }) {
  const w = base.clone();
  if (a !== undefined) w.regs.a = a & 0xff;
  if (de !== undefined) w.regs.de = de & 0xffff;
  if (c !== undefined) w.regs.c = c & 0xff;
  return w;
}

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x75) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// -- broken twins -------------------------------------------------------------

/** BUG: presets 0xEF instead of 0x10, so the colour column is painted with the wrong code. */
function teethWrongCode(m) {
  m.regs.a = 0xef; // BUG: should be 0x10
  paintColorColumnAndHoldBlink(m);
}

/** BUG: skips the `ld a,0x10` preset entirely, using whatever A arrived (posed 0x99 in the test). */
function teethNoPreset(m) {
  // BUG: missing `m.regs.a = 0x10;`
  paintColorColumnAndHoldBlink(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): paintColorColumnWithLowCode == oracle on every captured 0x04a1 entry", () => {
  const caps = captureDispatches(256, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x04a1 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, paintColorColumnWithLowCode); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = [...new Set(caps.map((c) => `A_in=${hb(c.regs.a)} DE=${hx(c.regs.de)} C=${hb(c.regs.c)}`))];
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical; distinct in-shapes:\n    ` + shapes.join("\n    "));
});

// -- 2. CRAFTED (unreached arms / pins) ---------------------------------------

test("CRAFTED: toggle-phase store, a non-0x20 stride, and a forced-0x10 (A discarded) match the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) Once-per-sweep tile-toggle store phase: (C & 0x47) == 0x40 makes loc_04ac XOR 0x03 into
  //     0x6905. Verify the oracle genuinely takes the toggle path here, then match.
  {
    const w = poseRegs(base, { de: 0x0020, c: 0x40 });
    const before = w.mem.read8(SPRITE1_CODE) & 0xff;
    const oc = w.clone();
    oracle(oc);
    assert.equal(
      oc.mem.read8(SPRITE1_CODE) & 0xff,
      (before ^ 0x03) & 0xff,
      "toggle store arm not exercised for C=0x40 (0x6905 was not XORed 0x03)",
    );
    const diffs = contractDiffs(w, paintColorColumnWithLowCode);
    assert.equal(diffs.length, 0, `toggle-phase store: ${diffs.join("; ")}`);
  }

  // (b) Non-0x20 stride: DE=0x0080 -> the fill lands at 0x75C4/0x7644/0x76C4. Pins DE is honored
  //     end-to-end (a fixed-0x20 fill would write the wrong cells).
  {
    const w = poseRegs(base, { de: 0x0080 });
    paintPage(w, 0x75, 0xbb);
    paintPage(w, 0x76, 0xbb);
    const diffs = contractDiffs(w, paintColorColumnWithLowCode);
    assert.equal(diffs.length, 0, `non-0x20 stride: ${diffs.join("; ")}`);
  }

  // (c) Forced 0x10: pose incoming A=0x99 on a sentinel page. loc_04a1 must DISCARD it and lay
  //     0x10/0x0F/0x0E — verify the oracle writes 0x10 (not 0x99) at 0x75C4, then match.
  {
    const w = poseRegs(base, { a: 0x99, de: 0x0020 });
    paintPage(w, 0x75, 0xcc);
    paintPage(w, 0x76, 0xcc);
    const oc = w.clone();
    oracle(oc);
    assert.equal(
      oc.mem.read8(COLOR_COLUMN_TOP) & 0xff,
      0x10,
      "loc_04a1 did not force A=0x10 (0x75C4 was not 0x10) — the preset is not being applied",
    );
    const diffs = contractDiffs(w, paintColorColumnWithLowCode);
    assert.equal(diffs.length, 0, `forced-0x10 (A discarded): ${diffs.join("; ")}`);
  }

  console.log("  CRAFTED: toggle-phase store, non-0x20 stride, and forced-0x10 — identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-code twin and the no-preset twin are CAUGHT", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) wrong-code: oracle paints 0x10/0x0F/0x0E; the twin paints 0xEF/0xEE/0xED. On a sentinel
  //     page the colour cells diverge from the oracle's.
  const wc = poseRegs(base, { de: 0x0020 });
  paintPage(wc, 0x75, 0xdd);
  paintPage(wc, 0x76, 0xdd);
  const dWrong = contractDiffs(wc, teethWrongCode);
  assert.notEqual(dWrong.length, 0, "the gate FAILED to catch the wrong-code twin — it is worthless");

  // (b) no-preset: pose incoming A=0x99. The oracle forces 0x10 and paints 0x10/0x0F/0x0E, but
  //     the twin (no `ld a,0x10`) uses A=0x99 and paints 0x99/0x98/0x97 — the cells diverge.
  const np = poseRegs(base, { a: 0x99, de: 0x0020 });
  paintPage(np, 0x75, 0xee);
  paintPage(np, 0x76, 0xee);
  const dNoPreset = contractDiffs(np, teethNoPreset);
  assert.notEqual(dNoPreset.length, 0, "the gate FAILED to catch the no-preset twin — it is worthless");

  console.log(`  TEETH: wrong-code caught (${dWrong[0]}); no-preset caught (${dNoPreset[0]})`);
});
