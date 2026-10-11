// SPDX-License-Identifier: GPL-3.0-only
/**
 * multiplexSpriteSlotsSkipping vs its frozen twin at ROM 0x0F97. This entry reads the scanline counter once per armed
 * slot, and the frozen twin's m.step accounting drifts that read across the eight slots while a
 * cycle-free rewrite reads one value for the whole pass. So the scanline is PINNED on both sides
 * before every comparison, which is the timing-seeded-input control the method prescribes; the last
 * arm proves that pin is load-bearing by showing the two DO part company without it.
 *
 * The rewrite takes the plain-return form: it leaves the stack where it found it and the dispatch
 * seam supplies the `ret` the frozen twin executes itself. So every comparison runs the rewrite
 * THROUGH the seam, as a dispatch reaches it, and the STACK arm pins the plain-return contract the
 * direct callers rely on (they lay nothing down for it) with a control that still pops a word.
 *
 * LIVE-OUT is the sprite bytes alone. The frozen twin leaves A, C and the flags as its last slot set
 * them; the DEAD AT EXIT arm complements all three where the ORACLE hands back, over every tape
 * session, and no cell moves (with the SP exit control heard), so they are EXCLUDED from the register
 * comparison. Every other register is compared, with a control that moves one.
 * HOLE: a reader reached only in a state no session drives is not measured.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0f97.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { TAPE_SESSIONS, assertDeadAtExit } from "./_deadAtExit.js";
import { multiplexSpriteSlotsSkipping } from "../multiplexSpriteSlotsSkipping.js";
import { loc_0f97 as oracle } from "../../translated/loc_0f97.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { withOmittedRet } from "../../machine.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x0f97;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const CAPTURE_CAP = 256;
const SWEEP_SAMPLE = 48;
const SLOT_Y = [0xb411, 0xb413, 0xb415, 0xb437, 0xb439, 0xb43b, 0xb43d, 0xb43f];
const PAIRS = [
  [0xb411, 0xb010], [0xb413, 0xb012], [0xb415, 0xb014], [0xb437, 0xb036],
  [0xb439, 0xb038], [0xb43b, 0xb03a], [0xb43d, 0xb03c], [0xb43f, 0xb03e],
];
const SCANLINE_COUNTER = 0xc000;
/** What the last slot leaves in A, C and the flags: measured dead at the oracle's exit (DEAD AT EXIT). */
const REG_EXCLUDED = ["a", "c", "f"];
const COMPARED = REG_FIELDS.filter((k) => !REG_EXCLUDED.includes(k));
const DEAD_FRAMES = 2500;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d ? `${d.addr == null ? "registers" : hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical";

function pin(m, scanline) {
  m.io.readScanline = () => scanline & 0xff;
}

/** Oracle vs candidate on clones with the scanline pinned identically: whole dump, then registers. */
function unitDiff(candidate, machine, scanline) {
  const seamed = withOmittedRet(candidate, TARGET);
  const a = machine.clone();
  const b = machine.clone();
  pin(a, scanline);
  pin(b, scanline);
  oracle(a);
  try {
    seamed(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  if (ram) return ram;
  for (const k of COMPARED) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  if (a.pc !== b.pc) return { addr: null, a: `pc=${hex4(a.pc)}`, b: `pc=${hex4(b.pc)}` };
  return null;
}

/** Bytes the oracle moves at this pinned scanline — the guard against a vacuous, no-fire sweep. */
function footprint(machine, scanline) {
  const a = machine.clone();
  pin(a, scanline);
  const before = a.dumpState().slice();
  oracle(a);
  const after = a.dumpState();
  let n = 0;
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) n++;
  return n;
}

function sweepCaught(candidate, machine) {
  let caught = 0;
  for (let s = 0; s < 256; s++) if (unitDiff(candidate, machine, s)) caught++;
  return caught;
}

let captured = null;
function capture() {
  if (captured) return captured;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (entries.length < CAPTURE_CAP) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
  assert.ok(entries.length > 0, "vacuous: the tape never dispatched this address");
  captured = entries;
  return captured;
}

/** All eight slots armed with thresholds spread across the byte, so a scanline sweep crosses each
 * slot's carry boundary — the fire/skip decision the captured states do not exercise at every step. */
function craftBoundary() {
  const m = capture()[0].clone();
  for (let i = 0; i < SLOT_Y.length; i++) m.mem.write8(SLOT_Y[i], 0x80 | (i * 0x10));
  return m;
}

/** A mix of armed slots (bit 7 set) and quiet-but-large ones (bit 7 clear, high value). A sweep
 * over this catches every twin: an armed slot fires, a quiet slot only fires under a broken arm
 * check, and a high-threshold armed slot only fires under a broken carry check. */
function craftMixed() {
  const m = capture()[0].clone();
  const ys = [0xf0, 0x81, 0x70, 0xc0, 0x40, 0x90, 0x7f, 0xa0];
  for (let i = 0; i < SLOT_Y.length; i++) m.mem.write8(SLOT_Y[i], ys[i]);
  return m;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
function twin(defect) {
  return (m) => {
    const { regs, mem } = m;
    for (const [yAddr, xAddr] of (defect.pairs ?? PAIRS)) {
      regs.a = mem.read8(yAddr);
      regs.bit(7, regs.a);
      if (!defect.skipArm && regs.fZ) continue;
      regs.c = regs.a;
      regs.a = mem.read8(SCANLINE_COUNTER);
      regs.add(regs.c);
      if (!defect.skipCarry && regs.fNC) continue;
      regs.a = regs.c;
      regs.and(defect.disarm ?? 0x7f);
      mem.write8(yAddr, regs.a);
      regs.a = mem.read8(xAddr);
      regs.add(defect.xStep ?? 0x80);
      mem.write8(xAddr, regs.a);
    }
    return m.ret();
  };
}

const brokenNoOp = (m) => m.ret();
const brokenSkipArm = twin({ skipArm: true });
const brokenSkipCarry = twin({ skipCarry: true });
const brokenKeepBit7 = twin({ disarm: 0xff });
const brokenWrongXStep = twin({ xStep: 0x40 });
const brokenSevenSlots = twin({ pairs: PAIRS.slice(0, 7) });
/** ★ the register control: correct memory, but scribbles a register the routine never touches. */
const brokenMovesSpareRegister = (m) => {
  multiplexSpriteSlotsSkipping(m);
  m.regs.h = (m.regs.h + 1) & 0xff;
};

/** ★ the old shape: executes its own `ret`, popping a word its direct callers no longer lay down. */
const brokenPopsItsOwnReturn = (m) => {
  multiplexSpriteSlotsSkipping(m);
  m.ret();
};

const TWINS = [
  ["no-op", brokenNoOp],
  ["skip-arm-check", brokenSkipArm],
  ["skip-carry-check", brokenSkipCarry],
  ["keep-bit7-on-disarm", brokenKeepBit7],
  ["wrong-x-step", brokenWrongXStep],
  ["seven-slots", brokenSevenSlots],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────
test("REACHED: the tape dispatches this address", { skip }, () => {
  const entries = capture();
  console.log(`  REACHED: ${hex4(TARGET)} captured ${entries.length} times (cap ${CAPTURE_CAP})`);
});

test("PINNED CAPTURES: every real dispatch is identical across a full scanline sweep", { skip }, () => {
  const entries = capture();
  const sample = entries.slice(0, SWEEP_SAMPLE);
  let fired = 0;
  for (const e of sample) {
    for (let s = 0; s < 256; s++) {
      const d = unitDiff(multiplexSpriteSlotsSkipping, e, s);
      assert.equal(d, null, `a pinned dispatch diverged at scanline ${s}: ${show(d)}`);
    }
    if (footprint(e, 200) > 0) fired++;
  }
  // ★ vacuity guard: at least one capture actually writes sprite bytes at a firing scanline, so
  // the sweep above is comparing state changes and not a bank of quiet slots.
  assert.ok(fired > 0, "no sampled capture ever fired, so the equal-ness above is vacuous");
  console.log(`  PINNED CAPTURES: ${sample.length} captures x 256 scanlines identical; ${fired} fire`);
});

test("CRAFTED BOUNDARY: fire/skip agrees across every scanline with thresholds spread", { skip }, () => {
  const m = craftBoundary();
  assert.equal(sweepCaught(multiplexSpriteSlotsSkipping, m), 0, "a scanline crossed a carry boundary and diverged");
  const fp = [];
  for (let s = 0; s < 256; s++) fp.push(footprint(m, s));
  // The sweep must span quiet AND firing scanlines, or it never tests the carry decision at all.
  assert.ok(fp.some((n) => n === 0) && fp.some((n) => n > 0),
    "the crafted sweep never changed which slots fired, so the boundary is untested");
  console.log(`  CRAFTED BOUNDARY: 256 scanlines identical; footprint spans ${Math.min(...fp)}..${Math.max(...fp)} bytes`);
});

test("LIVE-OUT: registers are checked, with a control that moves one", { skip }, () => {
  const m = craftMixed();
  assert.equal(sweepCaught(multiplexSpriteSlotsSkipping, m), 0, "the rewrite moved a register the oracle did not");
  // ★ the standing register check is worth nothing unless it can SEE a stray register.
  assert.ok(sweepCaught(brokenMovesSpareRegister, m) > 0,
    "a twin that scribbles H is not caught, so the register comparison is blind");
  console.log("  LIVE-OUT: register check catches the spare-register control");
});

test("A, C AND F ARE DEAD AT EXIT: complemented where the ORACLE hands back, no cell moves", { skip }, () => {
  // CONTROL: C and the flags complemented on ENTRY reach only that hand-back, so they too stay silent.
  assertDeadAtExit({
    at: TARGET, poison: REG_EXCLUDED, sessions: TAPE_SESSIONS, frames: DEAD_FRAMES, reachEvery: true,
    controls: [{ label: "entry C and flags", poison: ["c", "f"], before: true, expect: "silent" }],
  });
});

for (const [label, fn] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const caught = sweepCaught(fn, craftMixed());
    assert.ok(caught > 0, `every scanline PASSED the ${label} twin`);
    console.log(`  TEETH/${label}: caught on ${caught}/256 scanlines`);
  });
}

test("STACK: a direct call leaves the stack where it found it; the seam places every dispatch", { skip }, () => {
  const entries = capture().slice(0, SWEEP_SAMPLE);
  for (const e of entries) {
    const direct = e.clone();
    pin(direct, 200);
    const sp = direct.regs.sp;
    multiplexSpriteSlotsSkipping(direct);
    assert.equal(direct.regs.sp, sp, "a direct call moved the stack, so its callers cannot call it bare");
    const seated = e.clone();
    pin(seated, 200);
    assert.equal(seamPlaceable(withOmittedRet, multiplexSpriteSlotsSkipping, TARGET, seated).placeable, true,
      "the dispatch seam cannot place the rewrite");
  }
  // ★ control: the old self-returning shape pops a word on a direct call, and this arm must see it.
  const control = entries[0].clone();
  const sp = control.regs.sp;
  brokenPopsItsOwnReturn(control);
  assert.equal((control.regs.sp - sp) & 0xffff, 2, "the self-returning control did not move the stack");
  const unplaced = entries[0].clone();
  const pushesAWord = (m) => { m.push16(0); multiplexSpriteSlotsSkipping(m); };
  assert.equal(seamPlaceable(withOmittedRet, pushesAWord, TARGET, unplaced).placeable, false,
    "the seam placed a rewrite that leaves a stray word on the stack");
  console.log(`  STACK: ${entries.length} direct calls SP-neutral and seam-placeable; both controls caught`);
});

test("UNPINNED: the two DO diverge without the pin, proving it is load-bearing", { skip }, () => {
  const entries = capture();
  let diverged = 0;
  for (const e of entries) {
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    withOmittedRet(multiplexSpriteSlotsSkipping, TARGET)(b);
    if (firstStateDiff(a.dumpState(), b.dumpState()) !== null) { diverged++; continue; }
    for (const k of COMPARED) if (a.regs[k] !== b.regs[k]) { diverged++; break; }
  }
  // If nothing diverges unpinned, the scanline never drifts here and the pin is decoration —
  // which would mean this whole file is testing an environment the routine never meets.
  assert.ok(diverged > 0, "unpinned dispatches all matched, so the pin is not doing anything");
  console.log(`  UNPINNED: ${diverged}/${entries.length} dispatches diverge without the pin`);
});
