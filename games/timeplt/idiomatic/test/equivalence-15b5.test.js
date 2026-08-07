// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_15b5 — memory-equivalent to the frozen oracle at ROM 0x15B5.
 *
 * GATE: crafted-entry, and the craft is a NUDGE ON A REAL STATE rather than a fabricated machine.
 *   0x15B5 is one byte, `ret`, and it is entry fifteen of the sixteen-entry word table that sits
 *   inline at 0x0F29. Nothing in the image transfers to it — the over-generating scan (decode from
 *   every byte offset, plus every little-endian word) finds exactly one reference, the table slot
 *   at 0x0F47 — so the only way in is that dispatch, on the low nibble of SEQUENCE_SUBSTEP, and
 *   neither shipped tape ever presents the nibble 15. The craft is therefore one byte: force that
 *   nibble at each dispatch of 0x0F1F and let the GAME select the arm. Both tapes then dispatch it
 *   in quantity, with the rest of the machine coherent.
 *
 * What it exercises, holes stated:
 *   1. CORPUS — every crafted dispatch of two sessions replayed, oracle against rewrite on clones
 *      of the same machine, whole state dump compared. Counts are measured and asserted.
 *   2. NEITHER SHIPPED TAPE REACHES IT UNNUDGED, asserted, so the craft is justified by a check
 *      rather than by this header.
 *   3. THE ORACLE WRITES NOTHING — the claim that licenses an empty rewrite, measured directly:
 *      the whole state dump before and after the oracle runs, on every dispatch. This could have
 *      come out the other way and the rewrite would then be wrong.
 *   4. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and pinned to exactly {sp}: the oracle's
 *      return pops a slot, the rewrite models no stack.
 *   5. TEETH — three twins that write, each asserted caught on EVERY dispatch of both sessions.
 *
 * HOLE, AND IT IS THE CENTRAL ONE: A NO-OP TWIN CANNOT BE CAUGHT HERE, because a no-op is the
 * correct implementation. The usual "an empty candidate must fail" arm is unavailable, so what
 * stands in its place is arm 3 — a measurement that the oracle itself changes no memory — plus
 * twins that add work rather than remove it. A reader must not take arm 1 as evidence that this
 * gate would notice a rewrite doing too little; it would not, and there is nothing less to do.
 *
 * HOLE: THE REWRITE DOES NOT CONSUME THE STACK SLOT THE ORACLE'S RETURN POPS, so wiring it into a
 * live run in place of the oracle drifts the stack pointer down two bytes per dispatch. Measured:
 * the third crafted dispatch dies with an unmapped write to ROM at 0x0001. That is the mixed-layer
 * seam and not a property of this routine; arm 4 pins it, so it cannot change unnoticed.
 *
 * HOLE: what the arm is FOR is not established here. Doing nothing is what it does; whether that
 * is a deliberate idle rung or an unreachable slot filler, this gate does not say.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-15b5.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_15b5 } from "../loc_15b5.js";
import { loc_15b5 as oracle } from "../../translated/loc_15b5.js";
import { SEQUENCE_SUBSTEP } from "../names.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { buildRoutines } from "../../routines.js";

const TARGET = 0x15b5;
const DISPATCHER = 0x0f1f;
const ARM_NIBBLE = 0x0f;

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const TAPES = [
  ["attract", { tape: [] }],
  ["coin-start", {}],
];

/** Crafted dispatches each session produces. Measured; a move here is a finding, not a nuisance. */
const CRAFTED = { attract: 611, "coin-start": 899 };

/** Oracle against a candidate on two clones of one live machine: the whole state dump. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

/**
 * Run one session with the arm nibble forced at each dispatch of the routine that reads it, so the
 * game itself selects this arm; compare oracle and candidate at every resulting dispatch.
 */
function replaySession(opts, candidate, { nudge = true } = {}) {
  const base = buildRoutines();
  const dispatcher = base.get(DISPATCHER);
  const overrides = new Map();
  if (nudge) {
    overrides.set(DISPATCHER, (mm) => {
      mm.mem8[SEQUENCE_SUBSTEP] = (mm.mem8[SEQUENCE_SUBSTEP] & 0xf0) | ARM_NIBBLE;
      return dispatcher(mm);
    });
  }
  let dispatches = 0;
  let caught = 0;
  let oracleWrote = 0;
  let entry = null;
  overrides.set(TARGET, (mm) => {
    dispatches++;
    if (entry === null) entry = mm.clone();
    const before = mm.dumpState();
    if (unitDiff(candidate, mm)) caught++;
    const probe = mm.clone();
    oracle(probe);
    if (firstStateDiff(before, probe.dumpState())) oracleWrote++;
    return oracle(mm);
  });
  const m = makeMachine(overrides, opts);
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "session ran short");
  return { dispatches, caught, oracleWrote, entry };
}

let cache = null;
function sessions() {
  if (!cache) cache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_15b5) }));
  return cache;
}

const entryState = () => sessions()[0].entry;

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("CORPUS: every crafted dispatch of two sessions replays identically", { skip: SKIP }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session never reached the routine`);
    assert.equal(s.dispatches, CRAFTED[s.label], `the ${s.label} crafted dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} crafted dispatches over two sessions, identical on each`);
});

test("UNNUDGED, NEITHER SHIPPED TAPE REACHES IT: the craft is what buys the entry", { skip: SKIP }, () => {
  for (const [label, opts] of TAPES) {
    const r = replaySession(opts, loc_15b5, { nudge: false });
    assert.equal(
      r.dispatches,
      0,
      `the ${label} tape now dispatches this arm on its own, so the gate should use it directly`,
    );
  }
  console.log("  UNNUDGED: both shipped tapes dispatch it 0 times in the entry budget");
});

test("THE ORACLE WRITES NOTHING, and that is what licenses an empty rewrite", { skip: SKIP }, () => {
  let checked = 0;
  for (const s of sessions()) {
    assert.equal(
      s.oracleWrote,
      0,
      `the oracle changed memory on ${s.oracleWrote} ${s.label} dispatches, so the rewrite must ` +
        "stop being empty",
    );
    checked += s.dispatches;
  }
  assert.ok(checked > 0, "vacuous: nothing was measured");
  console.log(`  ORACLE WRITES NOTHING: ${checked} dispatches, no cell moved on any of them`);
});

test("EXCLUDED, deliberately: the stack pointer and pc, and nothing else", { skip: SKIP }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_15b5(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(moved, ["sp"], "the excluded set changed shape: only the stack pointer may differ");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle's return pops one slot; the rewrite pops none");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: sp ${hex4(b.regs.sp)} -> ${hex4(a.regs.sp)} and pc — RAM unaffected`);
});

test("THE UNCONSUMED SLOT IS REAL: a live run with the rewrite wired dies", { skip: SKIP }, () => {
  const base = buildRoutines();
  const dispatcher = base.get(DISPATCHER);
  const overrides = new Map([
    [DISPATCHER, (mm) => {
      mm.mem8[SEQUENCE_SUBSTEP] = (mm.mem8[SEQUENCE_SUBSTEP] & 0xf0) | ARM_NIBBLE;
      return dispatcher(mm);
    }],
    [TARGET, (mm) => loc_15b5(mm)],
  ]);
  const m = makeMachine(overrides, { tape: [] });
  let threw = null;
  try {
    m.runFrames(ENTRY_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 90);
  }
  assert.notEqual(
    threw,
    null,
    "the crafted run COMPLETED with the stack-free rewrite wired, so the two-byte drift this " +
      "file records has gone and the hole should be re-derived",
  );
  console.log(`  UNCONSUMED SLOT: the crafted run dies — ${threw}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────
// A no-op twin is unavailable (see the header). These three all ADD work; each must be caught on
// every dispatch of both sessions, which is what says the comparison is looking at real memory.

/** BUG: leaves a byte behind in the work RAM the arm is dispatched from. */
function brokenWritesWorkRam(m) {
  m.mem8[SEQUENCE_SUBSTEP] = m.mem8[SEQUENCE_SUBSTEP] ^ 0x80;
}

/** BUG: touches the sprite band, which the state dump also covers. */
function brokenWritesSpriteRam(m) {
  m.mem8[0xb010] = m.mem8[0xb010] ^ 0xff;
}

/** BUG: paints a character cell, which the state dump also covers. */
function brokenWritesVideoRam(m) {
  m.mem8[0xa400] = m.mem8[0xa400] ^ 0xff;
}

for (const [label, twin] of [
  ["writes-work-ram", brokenWritesWorkRam],
  ["writes-sprite-ram", brokenWritesSpriteRam],
  ["writes-video-ram", brokenWritesVideoRam],
]) {
  test(`TEETH: the ${label} twin is caught on EVERY crafted dispatch`, { skip: SKIP }, () => {
    for (const [tapeLabel, opts] of TAPES) {
      const r = replaySession(opts, twin);
      assert.equal(r.dispatches, CRAFTED[tapeLabel], "the session's dispatch count moved");
      assert.equal(
        r.caught,
        r.dispatches,
        `the ${label} twin escaped on ${r.dispatches - r.caught} ${tapeLabel} dispatches`,
      );
    }
    const d = unitDiff(twin, entryState());
    assert.notEqual(d, null, `the ${label} twin is invisible at the captured entry`);
    console.log(`  TEETH/${label}: caught on every dispatch — ${show(d)}`);
  });
}
