// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0f8d — the image-checksum tamper trap, against its frozen twin at the same address.
 *
 * ★ THE REWRITE RAISES WHERE THE ORIGINAL UNWINDS. The frozen trap drops four return words off the
 *   stack (unwinding its caller chain), runs the sprite fixup pass on the fourth word's low byte and
 *   returns through a fifth -- STACK UNWIND pins that off the frozen side. The idiomatic layer lays no
 *   return words: every routine is a direct call and the frame interrupt fires as one, so there is no
 *   chain on the stack to unwind and no faithful transcription of the unwind. The rewrite raises
 *   NotImplemented at the landing instead, and the contract is re-expressed around that: across every
 *   crafted entry it raises NotImplemented naming loc_0f8d and writes NOTHING first (LANDING), while the
 *   frozen side really does return and move state (RAW), so the two are compared at the transfer and
 *   the trap's own effects are not compared. Callers are held to the same transfer by their own gates
 *   (the verdict 0x5303 and the parking step 0x07AD stop the oracle on entry here).
 *
 * ★ THE TRAP IS DEAD ON A GENUINE IMAGE, by construction and by measurement. Its only way in is the
 *   verdict at 0x5303, which springs it when the fold handed on is not 0x67, and the fold's only caller
 *   (the credit line, jp 0x43E8 with HL = 0x086B, B = 0x14) sums fixed program bytes: GENUINE FOLD
 *   recomputes that sum from the image as 0x67. UNREACHED runs both tapes with a live control, and a
 *   wrong total handed to the verdict is the positive control that does reach it. MAME agrees: a
 *   PC-gated tap over 600 s driven and 600 s of attract logged A = B = 0x67 at every sampled fetch of
 *   0x5306 (the tap samples the first six per run) and fetched 0x0F8D zero times.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0f8d.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { loc_0f8d as candidate } from "../loc_0f8d.js";
import { loc_0f8d as oracle } from "../../translated/loc_0f8d.js";
import { multiplexSpriteSlotsSkipping as fixupPass } from "../multiplexSpriteSlotsSkipping.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";

const TARGET = 0x0f8d;
const FALL_THROUGH = 0x0f97;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SEAT = 0xa380;
// Six words seated below the seat; the trap drops four, the pass rets on the fifth, the sixth only
// feeds the over-popping twin. The fourth's low byte carries a set carry into the pass.
const WORDS = [0x1111, 0x2222, 0x3333, 0x4d4d, 0x5678, 0x9abc];
const DROPPED = 4;
const SP_LIFT = 2 * (DROPPED + 1); // four words dropped, one more the pass rets on
const RET_WORD = WORDS[DROPPED];
const SLOT_Y = [0xb411, 0xb413, 0xb415, 0xb437, 0xb439, 0xb43b, 0xb43d, 0xb43f];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? (d.reg ?? (d.addr == null ? "reg" : hex4(d.addr))) : "identical");

let base = null;
function baseState() {
  if (!base) {
    const m = makeMachine();
    const frames = m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the base run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, "the base run ran short");
    base = m;
  }
  return base;
}

/** A real machine with a seated stack and seeded scratch registers, then the scenario applied. */
function craft(mutate) {
  const m = baseState().clone();
  m.regs.sp = SEAT;
  for (let i = 0; i < WORDS.length; i++) {
    m.mem.write8((SEAT + i * 2) & 0xffff, WORDS[i] & 0xff);
    m.mem.write8((SEAT + i * 2 + 1) & 0xffff, (WORDS[i] >> 8) & 0xff);
  }
  m.regs.b = 0x99;
  m.regs.c = 0x88;
  m.regs.d = 0x77;
  m.regs.e = 0x66;
  m.regs.f = 0x00;
  mutate(m);
  return m;
}

const SCENARIOS = {
  quiet: (m) => { for (const y of SLOT_Y) m.mem.write8(y, 0x10); },
  armed: (m) => { for (const y of SLOT_Y) m.mem.write8(y, 0xf0); },
  mixed: (m) => { const ys = [0xf0, 0x81, 0x70, 0xc0, 0x40, 0x90, 0x7f, 0xa0]; SLOT_Y.forEach((y, i) => m.mem.write8(y, ys[i])); },
};

function pin(m, scanline) { m.io.readScanline = () => scanline & 0xff; }

/** The landing contract on one crafted entry: the candidate raises NotImplemented naming loc_0f8d, and
 * the machine it leaves is the machine it was handed (RAM, every register, sp and pc). null = held. */
function landingDiff(cand, machine, scanline) {
  const before = machine.clone();
  const b = machine.clone();
  pin(before, scanline);
  pin(b, scanline);
  let err = null;
  try { cand(b); } catch (e) { err = e; }
  if (!(err instanceof NotImplemented)) return { reg: "raise", a: "NotImplemented", b: err ? String(err.message ?? err).slice(0, 40) : "returned" };
  if (!err.message.startsWith("not implemented: loc_0f8d:")) return { reg: "raise", a: "loc_0f8d", b: err.message.slice(0, 40) };
  const ram = firstStateDiff(before.dumpState(), b.dumpState(), (off) => before.stateOffsetToAddr(off));
  if (ram) return ram;
  for (const k of ["af", "bc", "de", "hl", "ix", "iy", "sp"]) if (before.regs[k] !== b.regs[k]) return { reg: k, a: before.regs[k], b: b.regs[k] };
  if (before.pc !== b.pc) return { reg: "pc", a: before.pc, b: b.pc };
  return null;
}

function sweep(cand) {
  let caught = 0;
  for (const mutate of Object.values(SCENARIOS)) {
    for (let s = 0; s < 256; s += 8) if (landingDiff(cand, craft(mutate), s)) caught++;
  }
  return caught;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
const brokenNoOp = () => {};
// The old transcription's shape: unwind and run the pass. It returns instead of raising.
const brokenUnwinds = (m) => { for (let i = 0; i < DROPPED; i++) m.regs.af = m.pop16(); m.regs.bc = 0x02f2; return fixupPass(m); };
// Raises, but with a plain error rather than the untranscribable-landing fault.
const brokenPlainError = () => { throw new Error("loc_0f8d: a refusal of the wrong kind"); };
// Raises the right fault, but only after popping a word: the landing must write and move nothing.
const brokenPopsFirst = (m) => { m.pop16(); return candidate(m); };
// Raises the right fault, but only after the fixup pass has run. Caught where the pass writes a
// sprite byte; on a crafted state where no slot fires it is indistinguishable from the rewrite.
const brokenFixupFirst = (m) => { fixupPass(m); return candidate(m); };

const TWINS = [
  ["no-op", brokenNoOp, 96],
  ["unwinds", brokenUnwinds, 96],
  ["plain-error", brokenPlainError, 96],
  ["pops-first", brokenPopsFirst, 96],
  ["fixup-first", brokenFixupFirst, 60],
];

const GENUINE_BLOCK = 0x086b;
const GENUINE_LENGTH = 0x14;
const GENUINE_TOTAL = 0x67;
const VERDICT = 0x5303;
const foldOf = (rom) => { let t = 0; for (let i = 0; i < GENUINE_LENGTH; i++) t = (t + rom[GENUINE_BLOCK + i]) & 0xff; return t; };

// ── the gate ────────────────────────────────────────────────────────────────────────────
test("GENUINE FOLD: the one block the verdict judges sums to 0x67 on the image", { skip }, () => {
  const rom = baseState().rom;
  assert.equal(foldOf(rom), GENUINE_TOTAL, "the genuine image does not fold to 0x67, so the trap is live");
  // Control: one byte of the block moved moves the fold.
  const was = rom[GENUINE_BLOCK];
  rom[GENUINE_BLOCK] = was ^ 0xff;
  try { assert.notEqual(foldOf(rom), GENUINE_TOTAL, "the fold ignores the block's bytes"); } finally { rom[GENUINE_BLOCK] = was; }
  console.log(`  GENUINE FOLD: ${hex4(GENUINE_BLOCK)}+${GENUINE_LENGTH} sums to ${hex4(GENUINE_TOTAL)}; a moved byte does not`);
});

test("UNREACHED: no tape springs the trap, with a live control and a wrong-total positive control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [FALL_THROUGH]: 0 };
    const realPass = TRANSLATED.get(FALL_THROUGH);
    const m = makeMachine(new Map([
      [TARGET, (mm) => { seen[TARGET]++; return oracle(mm); }],
      [FALL_THROUGH, (mm) => { seen[FALL_THROUGH]++; return realPass(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // The zero is evidence only because the SAME run counted the pass the trap falls into.
    assert.ok(seen[FALL_THROUGH] > 0, `the ${label} run counted nothing at the pass either, so the zero is meaningless`);
    assert.equal(seen[TARGET], 0, `${label} sprang the trap — a genuine image should never fail the check`);
    console.log(`  UNREACHED: ${label} — trap ${seen[TARGET]}, control pass ${seen[FALL_THROUGH]}`);
  }
  // Positive control: the same undriven run with the verdict handed a wrong total does reach the trap.
  let sprung = 0;
  const verdict = TRANSLATED.get(VERDICT);
  const m = makeMachine(new Map([
    [VERDICT, (mm) => { mm.regs.b = GENUINE_TOTAL ^ 0xff; return verdict(mm); }],
    [TARGET, () => { sprung++; throw new Error("sprung"); }],
  ]), { tape: [] });
  try { m.runFrames(ENTRY_FRAMES); } catch { /* the probe stops the run */ }
  assert.ok(sprung > 0, "a wrong total never reached the trap, so the zero above says nothing");
  console.log(`  UNREACHED: a wrong total at the verdict springs it (${sprung})`);
});

test("LANDING: across every crafted entry the rewrite raises naming loc_0f8d and moves nothing", { skip }, () => {
  assert.equal(sweep(candidate), 0, "the rewrite wrote, moved a register, or raised the wrong fault");
  console.log(`  LANDING: 3 scenarios x 32 scanlines -- NotImplemented at entry, machine untouched`);
});

test("RAW: the frozen trap really returns and moves state, so it is compared at the transfer", { skip }, () => {
  const prints = [];
  let returned = 0;
  for (let s = 0; s < 256; s++) {
    const a = craft(SCENARIOS.mixed);
    pin(a, s);
    const before = a.dumpState().slice();
    oracle(a); // returns -- it does not refuse
    returned++;
    prints.push(a.dumpState().filter((v, i) => v !== before[i]).length);
  }
  assert.equal(returned, 256, "the frozen trap refused somewhere");
  assert.ok(prints.some((n) => n > 0), "the frozen trap never moved a byte, so the raise hides nothing");
  console.log(`  RAW: the frozen trap returns on every scanline; its footprint spans ${Math.min(...prints)}..${Math.max(...prints)} bytes`);
});

test("STACK UNWIND: four words dropped, the pass rets on the fifth (frozen side, pinned)", { skip }, () => {
  // Read off the FROZEN side and pinned, so this file's account of the unwind cannot drift.
  const m = craft(SCENARIOS.quiet);
  pin(m, 100);
  oracle(m);
  assert.equal((m.regs.sp - SEAT) & 0xffff, SP_LIFT, "the trap did not lift sp past four words plus the pass ret");
  assert.equal(m.pc, RET_WORD, "the pass did not ret on the fifth stack word");
  assert.equal(m.regs.b, 0x02, "b did not carry the trap's residue through the pass");
  console.log(`  UNWIND: sp lifted ${SP_LIFT}, pc=${hex4(m.pc)}, b=${hex4(m.regs.b)}`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const caught = sweep(twin);
    assert.ok(caught > 0, `every crafted state PASSED the ${label} twin`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught}/${3 * 32} crafted states`);
  });
}
