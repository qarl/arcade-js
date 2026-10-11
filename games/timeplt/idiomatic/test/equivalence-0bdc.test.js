// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0bdc — memory-equivalent to the frozen oracle at ROM 0x0BDC.
 *
 * GATE: crafted-entry, and the craft is a NUDGE ON A REAL STATE rather than a fabricated machine.
 *   0x0BDC is one byte, `ret`, and six words of the command ring's sixteen-word handler table at
 *   0x0BBC hold it: slots 8, 9 and 12-15. No poster in the image puts a command with one of those
 *   low nibbles on the ring, so no shipped tape dispatches it. The craft appends one extra pair behind
 *   each real command-1 post (the poster at 0x0038), into a free cell only, cycling the command
 *   through the six slots, and lets the drain loop select the handler from the table. The real
 *   posts are left alone: rewriting them instead starves the screen of the captions the image's
 *   tamper witnesses read, and the session derails.
 *
 * What it exercises, holes stated:
 *   1. CORPUS — every crafted dispatch of two sessions replayed, oracle against rewrite on clones
 *      of the same machine, whole state dump compared. Counts are measured and asserted, and all
 *      six slots are asserted posted.
 *   2. NEITHER SHIPPED TAPE REACHES IT UNNUDGED, asserted.
 *   3. THE ORACLE WRITES NOTHING — measured on every dispatch: the claim that licenses an empty
 *      rewrite.
 *   4. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and pinned to exactly {sp}: the oracle's
 *      return pops a slot, the rewrite models no stack.
 *   5. TEETH — three twins that write, each asserted caught on EVERY dispatch of both sessions.
 *
 * HOLE, AND IT IS THE CENTRAL ONE: A NO-OP TWIN CANNOT BE CAUGHT HERE, because a no-op is the
 * correct implementation. Arm 3 stands in its place.
 *
 * HOLE: the rewrite does not consume the stack slot the oracle's return pops, so it is never wired
 * into a live run in place of the oracle here; arm 4 pins that.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0bdc.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_0bdc } from "../loc_0bdc.js";
import { loc_0bdc as oracle } from "../../translated/loc_0bdc.js";
import { COMMAND_READ_CURSOR, COMMAND_RING, COMMAND_WRITE_CURSOR } from "../names.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { buildRoutines } from "../../routines.js";

const TARGET = 0x0bdc;
const POSTER = 0x0038;
const NUDGED_FROM = 1;
const SLOTS = [8, 9, 12, 13, 14, 15];

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const TAPES = [
  ["attract", { tape: [] }],
  ["coin-start", {}],
];

/** Crafted dispatches each session produces. Measured; a move here is a finding, not a nuisance. */
const CRAFTED = { attract: 528, "coin-start": 226 };

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

function replaySession(opts, candidate, { nudge = true } = {}) {
  const base = buildRoutines();
  const poster = base.get(POSTER);
  const overrides = new Map();
  const posted = new Set();
  let turn = 0;
  if (nudge) {
    overrides.set(POSTER, (mm) => {
      const command = mm.regs.d;
      const r = poster(mm);
      // Behind each real command-1 post, append one dead-slot pair the way the poster does: only
      // into a free cell (high bit set), then step the write cursor two cells inside the ring.
      const cell = COMMAND_RING + mm.mem8[COMMAND_WRITE_CURSOR];
      if (command === NUDGED_FROM && mm.mem8[cell] & 0x80) {
        const slot = SLOTS[turn++ % SLOTS.length];
        mm.mem8[cell] = slot;
        mm.mem8[COMMAND_RING + ((mm.mem8[COMMAND_WRITE_CURSOR] + 1) & 0x3f)] = 0;
        mm.mem8[COMMAND_WRITE_CURSOR] = (mm.mem8[COMMAND_WRITE_CURSOR] + 2) & 0x3f;
        posted.add(slot);
      }
      return r;
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
  return { dispatches, caught, oracleWrote, entry, posted };
}

let cache = null;
function sessions() {
  if (!cache) cache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_0bdc) }));
  return cache;
}

const entryState = () => sessions()[0].entry;

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("CORPUS: every crafted dispatch of two sessions replays identically", { skip: SKIP }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session never reached the routine`);
    assert.equal(s.dispatches, CRAFTED[s.label], `the ${s.label} crafted dispatch count moved`);
    assert.deepEqual([...s.posted].sort((x, y) => x - y), SLOTS, `${s.label}: not every slot was posted`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} crafted dispatches over slots ${SLOTS.join(",")}, identical on each`);
});

test("UNNUDGED, NEITHER SHIPPED TAPE REACHES IT: the craft is what buys the entry", { skip: SKIP }, () => {
  for (const [label, opts] of TAPES) {
    const r = replaySession(opts, loc_0bdc, { nudge: false });
    assert.equal(r.dispatches, 0, `the ${label} tape now dispatches one of these slots on its own`);
  }
  console.log("  UNNUDGED: both shipped tapes dispatch it 0 times in the entry budget");
});

test("THE ORACLE WRITES NOTHING, and that is what licenses an empty rewrite", { skip: SKIP }, () => {
  let checked = 0;
  for (const s of sessions()) {
    assert.equal(s.oracleWrote, 0, `the oracle changed memory on ${s.oracleWrote} ${s.label} dispatches`);
    checked += s.dispatches;
  }
  assert.ok(checked > 0, "vacuous: nothing was measured");
  console.log(`  ORACLE WRITES NOTHING: ${checked} dispatches, no cell moved on any of them`);
});

test("EXCLUDED, deliberately: the stack pointer and pc, and nothing else", { skip: SKIP }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_0bdc(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(moved, ["sp"], "the excluded set changed shape: only the stack pointer may differ");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle's return pops one slot; the rewrite pops none");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: sp ${hex4(b.regs.sp)} -> ${hex4(a.regs.sp)} and pc — RAM unaffected`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

/** BUG: moves the ring's read cursor, as if the handler consumed a second pair. */
function brokenWritesWorkRam(m) {
  m.mem8[COMMAND_READ_CURSOR] = m.mem8[COMMAND_READ_CURSOR] ^ 2;
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
      assert.equal(r.caught, r.dispatches, `the ${label} twin escaped on ${r.dispatches - r.caught} ${tapeLabel} dispatches`);
    }
    const d = unitDiff(twin, entryState());
    assert.notEqual(d, null, `the ${label} twin is invisible at the captured entry`);
    console.log(`  TEETH/${label}: caught on every dispatch — ${show(d)}`);
  });
}
