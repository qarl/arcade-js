// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for submitPlayerHighScore (ROM 0x4cbf) — the end-of-round
 * step that offers a finishing player's score to the "BEST SCORES TODAY" table and
 * repaints the score readouts. It pre-clears the landed-rank result byte, then
 * delegates to loadPlayerState (make the player's score live), insertHighScore (place
 * it), and renderScoreReadouts (repaint) — all three already decompiled and separately
 * gated, so THIS gate proves the composition: the pre-clear and the correct ordering.
 *
 * The routine writes only memory (the landed-rank byte, the high-score table, the
 * shared player block, and the readout display cells) and reads no register on entry,
 * so it is gated on MEMORY-equivalence — RAM only. pc and SP are EXCLUDED: the oracle
 * tail-returns to its caller (its final delegate rets through to loc_4cbf's own caller),
 * so it leaves pc/SP changed while the stack-free JS does not. The oracle also parks a
 * little dead stack scratch just below the entry stack pointer (its per-delegate return
 * pushes, popped again as it unwinds); that scratch lives in the stack page (0x83xx)
 * while every real write lives far below it (the score block ~0x8028-0x8048 and the
 * readout strip ~0x8283-0x829d top out below 0x8300), so the RAM diff excludes a window
 * at the top of the stack and compares everything else byte-for-byte. The teeth below —
 * caught at 0x8048 and 0x8038 — confirm that window hides no real write.
 *
 * WHY A CRAFTED ENTRY. End-of-round teardown never runs in attract, so 0x4cbf is never
 * dispatched (verified: 0 dispatches over 3000 attract frames). Per the crafted-entry
 * method the gate runs it from a REAL captured attract state (cloned at the first
 * dispatch of the unrelated reached leaf 0x3dae, which gives a valid stack + register
 * file), then pokes its inputs — the selected player, that player's saved score, and the
 * three table records — identically on both sides across the table's placement arms.
 *
 *   0. HARNESS — 0x4cbf is unreached in attract (justifying the craft), a real entry is
 *      captured, and the oracle run is deterministic (oracle vs oracle -> identical RAM).
 *   1. EQUAL (real entry) — submitPlayerHighScore == oracle over RAM on the captured
 *      state's natural values.
 *   2. EQUAL (crafted placement sweep) — player 1/2 x land-rank-1/2/3 / no-placement /
 *      tie, each poked identically both sides, identical RAM; the landed rank matches
 *      the expected placement, and a distinct-value scenario is non-vacuous (the render
 *      actually rewrote the readout cells).
 *   3. TEETH (no pre-clear) — a twin that skips the landed-rank pre-clear is CAUGHT at
 *      the landed-rank byte on a no-placement scenario carrying a stale non-zero rank.
 *   4. TEETH (no repaint) — a twin that skips renderScoreReadouts is CAUGHT (the readout
 *      staging + display cells go stale).
 *   5. TEETH (repaint before insert) — a twin that repaints before inserting is CAUGHT:
 *      the readouts then show the pre-insert table.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4cbf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4cbf as oracle } from "../../translated/loc_4cbf.js";
import { submitPlayerHighScore as idiomatic } from "../submitPlayerHighScore.js";
import { loadPlayerState } from "../loadPlayerState.js";
import { insertHighScore } from "../insertHighScore.js";
import { renderScoreReadouts } from "../renderScoreReadouts.js";
import { loc_3dae as reachedLeaf } from "../../translated/loc_3dae.js";
import { makeMachineFactory } from "../../machine.js";
import { ACTIVE_PLAYER, SCORE_LO, SCORE_HI } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x4cbf;
const CAPTURE_AT = 0x3dae; // a reached attract leaf — gives a real, valid captured state

// The high-score table is three back-to-back 5-byte records [3 initials, 2-byte score].
const TABLE_TOP = 0x8039;
const RANK_STRIDE = 5;
const initAddr = (r) => TABLE_TOP + RANK_STRIDE * (r - 1);
const scoreAddr = (r) => initAddr(r) + 3;
const LANDED_RANK = 0x8048; // rank the score placed at (1/2/3); 0 = no placement

// The readout display strip: three readouts, 9 cells apart, at 0x8283 (its render target).
const LABEL_DEST_BASE = 0x8283;
const DEST_STRIDE = 9;

// The routine's real writes all sit below 0x8300; the stack sits at the top of the
// 0x83xx page. Excluding this window at the top of the stack hides only dead scratch.
const STACK_MARGIN = 64;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/**
 * Hook the reached attract leaf 0x3dae and clone the machine at its first dispatch — a
 * real state with a valid stack and register file. The wrapper snapshots, then runs the
 * leaf so attract proceeds undisturbed.
 */
function captureRealEntry(maxFrames) {
  let entry = null;
  const snap = new Map([[CAPTURE_AT, (mm) => {
    if (entry === null) entry = mm.clone();
    return reachedLeaf(mm);
  }]]);
  makeMachine(snap).runFrames(maxFrames);
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack scratch at the
 * top of the stack page (the oracle's per-delegate return pushes, popped as it unwinds;
 * the stack-free idiomatic JS never writes them). Null when otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_MARGIN, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the oracle on one clone and a candidate on another; return the first real RAM diff. */
function replayDiff(entry, candidate) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  candidate(c);
  return ramDiffOutsideStack(o, c, sp);
}

// A crafted scenario: which player is finishing, that player's saved score, and the
// three table records. loadPlayerState pulls the player's copy of each score field into
// the shared cell that insertHighScore reads as the candidate.
const DEFAULT_INITIALS = { 1: [0x11, 0x12, 0x13], 2: [0x21, 0x22, 0x23], 3: [0x31, 0x32, 0x33] };
const scene = (player, cand, r1, r2, r3, landedSeed = 0) => ({
  player,
  cand,
  scores: { 1: r1, 2: r2, 3: r3 },
  initials: DEFAULT_INITIALS,
  landedSeed,
});

/** Lay a scenario over a clone of the captured entry, identically on any machine. */
function craft(seed, s) {
  const e = seed.clone();
  const { mem } = e;
  mem.write8(ACTIVE_PLAYER, s.player);
  // Player 1's saved copy is one byte past each shared cell; any other player's is two.
  const off = s.player === 1 ? 1 : 2;
  mem.write8(SCORE_LO + off, s.cand & 0xff);
  mem.write8(SCORE_HI + off, (s.cand >> 8) & 0xff);
  for (const r of [1, 2, 3]) {
    const [a, b, c] = s.initials[r];
    mem.write8(initAddr(r), a);
    mem.write8(initAddr(r) + 1, b);
    mem.write8(initAddr(r) + 2, c);
    mem.write16(scoreAddr(r), s.scores[r]);
  }
  mem.write8(LANDED_RANK, s.landedSeed); // the caller pre-clears this; seed it to prove the clear happens
  return e;
}

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: 0x4cbf is unreached in attract, a real entry is captured, and the oracle is deterministic", () => {
  // Justify the crafted entry: end-of-round teardown never runs in attract.
  let dispatches = 0;
  const watch = new Map([[TARGET, (mm) => { dispatches++; return oracle(mm); }]]);
  makeMachine(watch).runFrames(3000);
  assert.equal(dispatches, 0, `expected 0x4cbf unreached in attract, saw ${dispatches} dispatches`);

  const entry = captureRealEntry(240);
  assert.ok(entry, "expected the reached leaf 0x3dae to be dispatched during attract");

  const bad = replayDiff(entry, oracle);
  assert.equal(bad, null, bad && `oracle run not deterministic: diff at ${hx(bad.addr)}`);
  console.log(
    `  HARNESS: 0 attract dispatches; captured a real entry (SP=${hx(entry.regs.sp)}); oracle run deterministic`,
  );
});

// -- 1. EQUAL on the real captured entry as-is -------------------------------

test("EQUAL (real entry): submitPlayerHighScore == oracle over RAM", () => {
  const entry = captureRealEntry(240);
  assert.ok(entry, "need a captured entry");

  const bad = replayDiff(entry, idiomatic);
  assert.equal(bad, null, bad && `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  console.log("  EQUAL/real: identical RAM (outside stack scratch) on the captured state's natural values");
});

// -- 2. EQUAL across a crafted placement sweep -------------------------------

test("EQUAL (crafted sweep): every placement arm is identical, and the landed rank is right", () => {
  const seed = captureRealEntry(240);
  assert.ok(seed, "need a captured entry to craft the sweep from");

  // Descending table 0x5000/0x3000/0x1000; one candidate per relational position, both
  // players exercised (player 1 uses the +1 copy, player 2 the +2 copy).
  const cases = [
    ["p1 land rank1", scene(1, 0x6000, 0x5000, 0x3000, 0x1000), 1],
    ["p2 land rank1", scene(2, 0x7000, 0x5000, 0x3000, 0x1000), 1],
    ["p1 land rank2", scene(1, 0x4000, 0x5000, 0x3000, 0x1000), 2],
    ["p2 land rank3", scene(2, 0x2000, 0x5000, 0x3000, 0x1000), 3],
    ["p1 no-place (below rank3)", scene(1, 0x0500, 0x5000, 0x3000, 0x1000), 0],
    ["p2 tie rank2 (lands rank3)", scene(2, 0x3000, 0x5000, 0x3000, 0x1000), 3],
    ["p1 max candidate", scene(1, 0xffff, 0x5000, 0x3000, 0x1000), 1],
  ];
  for (const [label, s, expectedRank] of cases) {
    const entry = craft(seed, s);
    const bad = replayDiff(entry, idiomatic);
    assert.equal(bad, null, bad && `${label}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

    // Positive check: the score placed at the expected rank (0 = did not make the table).
    const c = entry.clone();
    idiomatic(c);
    assert.equal(c.mem.read8(LANDED_RANK), expectedRank, `${label}: wrong landed rank`);
  }

  // Non-vacuous: a distinct-value scenario really rewrites the readout display cells
  // (the natural captured entry is already settled, so this is proven on a craft).
  const entry = craft(seed, scene(1, 0x6000, 0x5000, 0x3000, 0x1000));
  const o = entry.clone();
  oracle(o);
  let changed = 0;
  for (let k = 0; k < DEST_STRIDE * 3; k++) {
    if (o.mem.read8(LABEL_DEST_BASE + k) !== entry.mem.read8(LABEL_DEST_BASE + k)) changed++;
  }
  assert.ok(changed > 0, "expected the render to rewrite the readout cells (non-vacuous)");
  console.log(`  EQUAL/crafted: ${cases.length} placement arms identical; ${changed} readout cells rewritten (non-vacuous)`);
});

// -- 3. TEETH: a twin that skips the landed-rank pre-clear -------------------

/** Broken twin: skips the pre-clear, so a no-placement leaves the stale landed rank. */
function twinNoPreClear(m) {
  loadPlayerState(m);
  insertHighScore(m);
  renderScoreReadouts(m);
}

test("TEETH (no pre-clear): skipping the landed-rank clear is CAUGHT at the result byte", () => {
  const seed = captureRealEntry(240);
  assert.ok(seed, "need a captured entry to seed the teeth check");
  // No-placement (0x0500 below rank 3) with a stale non-zero landed rank already present:
  // the oracle clears it to 0, the twin leaves it at 3.
  const entry = craft(seed, scene(2, 0x0500, 0x5000, 0x3000, 0x1000, 0x03));

  const bad = replayDiff(entry, twinNoPreClear);
  assert.notEqual(bad, null, "the gate FAILED to catch a twin that skips the pre-clear — it proves nothing");
  assert.equal(bad.addr, LANDED_RANK, `teeth caught the wrong address ${hx(bad.addr)} (expected ${hx(LANDED_RANK)})`);
  console.log(`  TEETH/pre-clear: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

// -- 4. TEETH: a twin that skips the repaint ---------------------------------

/** Broken twin: does the insert but never repaints, so the readout cells go stale. */
function twinNoRepaint(m) {
  const { mem8 } = m;
  mem8[LANDED_RANK] = 0;
  loadPlayerState(m);
  insertHighScore(m);
}

test("TEETH (no repaint): skipping renderScoreReadouts is CAUGHT, and the readouts go stale", () => {
  const seed = captureRealEntry(240);
  assert.ok(seed, "need a captured entry to seed the teeth check");
  const entry = craft(seed, scene(1, 0x6000, 0x5000, 0x3000, 0x1000));

  const bad = replayDiff(entry, twinNoRepaint);
  assert.notEqual(bad, null, "the gate FAILED to catch a twin that skips the repaint — it proves nothing");

  // Confirm the actual effect: the readout display cells are left stale by the twin.
  const o = entry.clone(); oracle(o);
  const c = entry.clone(); twinNoRepaint(c);
  let readoutDiffers = false;
  for (let k = 0; k < DEST_STRIDE * 3; k++) {
    if (o.mem.read8(LABEL_DEST_BASE + k) !== c.mem.read8(LABEL_DEST_BASE + k)) readoutDiffers = true;
  }
  assert.ok(readoutDiffers, "the no-repaint twin should leave the readout cells stale");
  console.log(`  TEETH/no-repaint: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b}); readouts left stale`);
});

// -- 5. TEETH: a twin that repaints before inserting -------------------------

/** Broken twin: repaints before the insert, so the readouts show the pre-insert table. */
function twinRepaintBeforeInsert(m) {
  const { mem8 } = m;
  mem8[LANDED_RANK] = 0;
  loadPlayerState(m);
  renderScoreReadouts(m); // BUG: rendered from the OLD table
  insertHighScore(m);
}

test("TEETH (wrong order): repainting before inserting is CAUGHT", () => {
  const seed = captureRealEntry(240);
  assert.ok(seed, "need a captured entry to seed the teeth check");
  const entry = craft(seed, scene(1, 0x6000, 0x5000, 0x3000, 0x1000));

  const bad = replayDiff(entry, twinRepaintBeforeInsert);
  assert.notEqual(bad, null, "the gate FAILED to catch a twin that repaints before inserting — it proves nothing");
  console.log(`  TEETH/order: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});
