// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_200c — memory-equivalent to the frozen oracle at ROM 0x200C.
 *
 * GATE: unit-capture at the real dispatch judged by a MASKED RAM diff, plus an exhaustive live-out
 *   sweep. Four bytes: `add hl,de`, `rst 0x18`, `ld a,b`, `ret`. 0x0018 is already decompiled as
 *   offsetAddress, so that restart is dissolved into a direct call here, which is this caller's
 *   own unit of work.
 *
 * WHY THE DIFF IS MASKED. The frozen original brackets its restart with a push, so it writes two
 *   bytes of stack below the entry stack pointer and the rewrite does not. Those two bytes are
 *   dead — the matching pop restores the stack pointer before anything reads them — but the diff
 *   helper reports only the FIRST differing byte and so can never say "differs only inside the
 *   window". This file therefore walks the WHOLE dump itself and asserts that the excluded window
 *   is the only thing in it that moved.
 *
 * THE RAM ARM IS OTHERWISE VACUOUS, AND THAT IS MEASURED. Outside that stack window the routine
 *   writes nothing at all, so a no-op twin passes the masked RAM diff. The VACUITY test asserts
 *   exactly that, and the LIVE-OUT comparison is what actually gates this file.
 *
 * What it exercises, holes stated:
 *   1. MASKED EQUAL at the real dispatch — every differing address collected, and the set asserted
 *      to be exactly the two dead stack bytes.
 *   2. LIVE-OUT at the real dispatch — the walked address and the byte handed back.
 *   3. EXHAUSTIVE over the two byte-wide live-ins — the narrow step and the count each swept
 *      0..255 at the captured wide step, 512 cases, live-out compared on every one.
 *   4. CRAFTED WRAP — wide-step and narrow-step pairs chosen to carry past sixteen bits and past
 *      eight, which the captured entry does not do; the frozen original is the reference on each.
 *   5. TEETH — five twins: no-op, drops the wide step, drops the narrow step, hands back the wrong
 *      byte, and one that reads the narrow step as a SIGNED displacement so a high byte walks the
 *      address backward. NOT A USABLE TWIN, for anyone reaching for it: "lets the address widen
 *      past sixteen bits" cannot be written, because the register model truncates on assignment,
 *      so such a twin is byte-identical to the correct routine rather than a bug to be caught.
 *
 * HOLE: one backdrop. Every arm runs off the single captured entry with only the live-in registers
 * moved, and the wide step is swept at just the crafted pairs rather than exhaustively — 2^32
 * combinations is not a test. Nothing here establishes what the walked address is for; its caller
 * discards it and tests only the byte.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-200c.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_200c } from "../loc_200c.js";
import { loc_200c as oracle } from "../../translated/loc_200c.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";

const TARGET = 0x200c;

/** The frozen original's push is two bytes below the entry stack pointer, and it is dead. */
const DEAD_STACK_BYTES = 2;

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    makeMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) gate(loc_200c);
  return entry;
}

/** Every differing address between two dumps, not just the first. */
function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] !== db[i]) out.push(a.stateOffsetToAddr(i));
  }
  return out;
}

/** The window the frozen original's push writes and the rewrite leaves alone. */
function deadWindow(state) {
  const sp = state.regs.sp;
  const out = new Set();
  for (let i = 1; i <= DEAD_STACK_BYTES; i++) out.add(u16(sp - i));
  return out;
}

/** The two things the routine hands back. */
const liveOut = (m) => ({ address: m.regs.hl, byte: m.regs.a });

/** Run both arms from the entry with the given live-ins, and report both live-outs. */
function run(candidate, live = {}) {
  const a = entryState().clone();
  const b = entryState().clone();
  for (const s of [a, b]) {
    if (live.hl !== undefined) s.regs.hl = live.hl;
    if (live.de !== undefined) s.regs.de = live.de;
    if (live.a !== undefined) s.regs.a = live.a;
    if (live.b !== undefined) s.regs.b = live.b;
  }
  oracle(a);
  candidate(b);
  return { oracle: liveOut(a), candidate: liveOut(b), a, b };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("MASKED EQUAL at the real dispatch: only the dead stack bytes moved", { skip: SKIP }, () => {
  gate(loc_200c);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const window = deadWindow(entryState());
  const { a, b } = run(loc_200c);
  const outside = allDiffs(a, b).filter((addr) => !window.has(addr));
  assert.deepEqual(outside, [], `RAM diverged outside the dead stack window at ${outside.map(hex4)}`);
  console.log(`  MASKED EQUAL: nothing outside the ${DEAD_STACK_BYTES}-byte window below ${hex4(entryState().regs.sp)}`);
});

test("LIVE-OUT at the real dispatch: the walked address and the byte match", { skip: SKIP }, () => {
  const { oracle: o, candidate: c } = run(loc_200c);
  assert.deepEqual(c, o, "the two live-outs must match exactly");
  console.log(`  LIVE-OUT: address ${hex4(o.address)}, byte ${o.byte}`);
});

test("VACUITY, MEASURED: the masked RAM diff cannot see a no-op; the live-out can", { skip: SKIP }, () => {
  const window = deadWindow(entryState());
  const { a, b, oracle: o, candidate: c } = run(() => {});
  const outside = allDiffs(a, b).filter((addr) => !window.has(addr));
  assert.deepEqual(outside, [], "if RAM now catches a no-op here, this header's vacuity claim is stale");
  assert.notDeepEqual(c, o, "the live-out comparison must catch what the RAM diff cannot");
  console.log("  VACUITY: RAM blind to a no-op, live-out catches it — as stated");
});

test("EXHAUSTIVE over the two byte-wide live-ins: 512 cases match", { skip: SKIP }, () => {
  let cases = 0;
  for (let v = 0; v < 256; v++) {
    const byNarrow = run(loc_200c, { a: v });
    assert.deepEqual(byNarrow.candidate, byNarrow.oracle, `narrow step ${v} diverged`);
    const byCount = run(loc_200c, { b: v });
    assert.deepEqual(byCount.candidate, byCount.oracle, `count ${v} diverged`);
    cases += 2;
  }
  assert.equal(cases, 512, "must have swept both live-ins over their whole range");
  console.log(`  EXHAUSTIVE: ${cases} cases identical`);
});

test("CRAFTED WRAP: pairs that carry past sixteen bits and past eight", { skip: SKIP }, () => {
  const crafted = [
    { hl: 0xffff, de: 0x0001, a: 0x00 },
    { hl: 0xffff, de: 0x0000, a: 0xff },
    { hl: 0xff00, de: 0x00ff, a: 0x01 },
    { hl: 0x0000, de: 0xffff, a: 0xff },
    { hl: 0x8000, de: 0x8000, a: 0x80 },
  ];
  let carried = 0;
  for (const live of crafted) {
    const { oracle: o, candidate: c } = run(loc_200c, live);
    assert.deepEqual(c, o, `crafted ${JSON.stringify(live)} diverged`);
    // Non-vacuous only if the pair really does carry: the untruncated sum must exceed the
    // sixteen-bit range, and the observed address must be the truncation of it.
    const untruncated = live.hl + live.de + live.a;
    if (untruncated > 0xffff) {
      carried++;
      assert.equal(o.address, u16(untruncated), "the reference must be the truncated sum");
    }
  }
  assert.ok(carried > 0, "vacuous: not one crafted pair actually carried past sixteen bits");
  console.log(`  CRAFTED WRAP: ${crafted.length} pairs identical, ${carried} of them carrying`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

/** BUG: skips the wide step. */
function brokenNoWideStep(m) {
  const { regs } = m;
  regs.hl = u16(regs.hl + regs.a);
  regs.a = regs.b;
}

/** BUG: skips the narrow step. */
function brokenNoNarrowStep(m) {
  const { regs } = m;
  regs.hl = u16(regs.hl + regs.de);
  regs.a = regs.b;
}

/** BUG: hands back the byte the narrow step left rather than the count. */
function brokenWrongByte(m) {
  const { regs } = m;
  regs.hl = u16(regs.hl + regs.de);
  regs.hl = u16(regs.hl + regs.a);
  regs.a = regs.hl & 0xff;
}

/** BUG: reads the narrow step as a signed displacement, so a high byte walks BACKWARD. */
function brokenSignedNarrowStep(m) {
  const { regs } = m;
  const step = regs.a < 0x80 ? regs.a : regs.a - 256;
  regs.hl = u16(regs.hl + regs.de + step);
  regs.a = regs.b;
}

for (const [label, twin, live] of [
  ["no-op", () => {}, {}],
  ["drops-the-wide-step", brokenNoWideStep, { de: 0x0123 }],
  ["drops-the-narrow-step", brokenNoNarrowStep, { a: 0x7f }],
  ["hands-back-the-wrong-byte", brokenWrongByte, {}],
  ["reads-the-narrow-step-as-signed", brokenSignedNarrowStep, { a: 0xf0 }],
]) {
  test(`TEETH: the ${label} twin is CAUGHT by the live-out`, { skip: SKIP }, () => {
    const { oracle: o, candidate: c } = run(twin, live);
    assert.notDeepEqual(c, o, `the gate PASSED the ${label} twin — it has no teeth`);
    console.log(
      `  TEETH/${label}: caught — oracle(${hex4(o.address)}, ${o.byte}) vs ` +
        `candidate(${hex4(c.address)}, ${c.byte})`,
    );
  });
}
