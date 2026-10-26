// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for redrawPlayerUpIndicator (ROM 0x0315) — every 16th frame,
 * blink the on-screen "player up" indicator column, three tilemap cells tall,
 * stepping one screen row back (−32 columns) between cells.
 *
 * sub_0315 is CALLED EVERY main-loop pass by mainLoop_02bd (`call 0x0315` at 0x02c7,
 * return 0x02ca). The `and 0x0f / ret nz` frame gate means most dispatches early-out;
 * of those that pass, the `rst 0x08` guard skips the body during attract, and the
 * brief ATTRACT-clear boot/start windows reach the paint body. So real captured
 * dispatches already span ALL THREE arms (frame-skip, guard-skip, body). Crafted
 * entries then pin BOTH FRAME blink phases (bit 4), BOTH player selectors, and the
 * one- vs two-player split deterministically.
 *
 * Validated by MEMORY-equivalence against the FROZEN oracle over RAM (minus the dead
 * STACK_SCRATCH region) + pc + SP — never the full register file, never cycles — on a
 * FRESH clone per case. The body's three writes land in VIDEO RAM (the two indicator
 * columns 0x7740 / 0x74e0), which dumpState() includes, so a wrong cell, value, or
 * row step surfaces as a divergent byte.
 *
 * The oracle brackets each path with the Z80 stack: `ret nz` (frame skip), the
 * `rst 0x08` two-level guard skip, `ret z` (one-player early-out), and the terminal
 * `ret` each net exactly ONE caller-return pop; the `call 0x0347` pushes it takes are
 * READS into STACK_SCRATCH (excluded by the memory-equivalence contract). The
 * idiomatic routine models no stack (plain JS returns + direct callee calls), so
 * runCandidate performs ONE m.ret() after it to line pc + SP up with the oracle.
 *
 *   1. EQUAL (captured) — hook 0x0315 in a real boot/attract run, clone at each
 *      dispatch (bucketed by arm), and confirm redrawPlayerUpIndicator == oracle over
 *      RAM − the stack scratch below the entry SP, pc, SP. Both guard arms and the body occur naturally.
 *
 *   2. EQUAL (crafted) — poke FRAME / ATTRACT / CURRENT_PLAYER / TWO_PLAYER_GAME
 *      identically on both sides to reach: frame-skip early-out, guard-skip (both
 *      players), bit-4-clear paint (P1 and P2, plus a 0xFF selector to pin the
 *      glyph = selector+1 wrap and the nonzero->P2 column map), bit-4-set blank
 *      (one-player, stops after blanking), and bit-4-set two-player (blank current +
 *      paint the OTHER player, both current-player orientations). Exact final cell
 *      values are asserted so the crafted arms are non-vacuous and correct.
 *
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) wrong row step (+32 instead of −32) — the stacked cells land at the wrong
 *          addresses on any paint.
 *      (b) wrong glyph (writes the raw selector, dropping the +1) — the base cell's
 *          player-number tile is wrong.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0315.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0315 as oracle } from "../../translated/loc_0315.js";
import { redrawPlayerUpIndicator } from "../redrawPlayerUpIndicator.js";
import { gameActiveGuard } from "../gameActiveGuard.js";
import { selectPlayerIndicatorColumnBase as loc_0347 } from "../selectPlayerIndicatorColumnBase.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  FRAME,
  ATTRACT,
  CURRENT_PLAYER,
  TWO_PLAYER_GAME,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0315;
const RET_ADDR = 0x02ca;    // the main-loop site right after `call 0x0315` (mainLoop_02bd 0x02c7)
const P1_COL = 0x7740;      // player-1 indicator column base (loc_0347 selector 0)
const P2_COL = 0x74e0;      // player-2 indicator column base (loc_0347 selector != 0)
const ROW_BACK = 0xffe0;    // −32: one tilemap row back between the three cells

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// All non-stack RAM addresses that changed between two machines (for the no-write
// non-vacuity check on the frame-skip / guard-skip paths).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`/`ret nz`/`ret z`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret()
 * so pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with
 * the JS call stack, so it does not touch pc/SP itself). 0x0315 nets exactly one
 * caller-return pop on EVERY path, so a single ret aligns them all.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
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

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. The body arms are crafted by poking the four gate cells.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x0315 dispatch onto a clone of the base: a stack with the real
// caller return (so the terminal `ret` lands at 0x02ca), then the four cells the
// routine reads — FRAME (frame gate + blink phase), ATTRACT (guard), CURRENT_PLAYER
// (which column / glyph), TWO_PLAYER_GAME (whether to paint the second column).
function craft(base, { frame, attract = 0x01, player = 0, twoPlayer = 0 }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(FRAME, frame);
  m.mem.write8(ATTRACT, attract);
  m.mem.write8(CURRENT_PLAYER, player);
  m.mem.write8(TWO_PLAYER_GAME, twoPlayer);
  return m;
}

// The three cell addresses of a column, base then two rows back.
const cells = (base) => [base, (base + ROW_BACK) & 0xffff, (base + 2 * ROW_BACK) & 0xffff];

// Sentinel written into target cells so the routine's writes are observable even
// where attract already left the same glyphs there (the paint is idempotent).
const SENTINEL = 0xee;
const clearCells = (m, ...bases) => bases.forEach((b) => cells(b).forEach((a) => m.mem.write8(a, SENTINEL)));

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x0315 is dispatched during boot/attract, across all three arms", () => {
  let retnz = 0, skip = 0, body = 0;
  const snap = new Map([[TARGET, (mm) => {
    const f = mm.mem.read8(FRAME), a = mm.mem.read8(ATTRACT);
    if ((f & 0x0f) !== 0) retnz++;
    else if ((a & 0x01) !== 0) skip++;
    else body++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(retnz > 0, "0x0315 frame-skip arm never seen");
  assert.ok(skip > 0, "0x0315 guard-skip arm never seen");
  assert.ok(body > 0, "0x0315 paint-body arm never seen");
  console.log(`  REACHABILITY: frame-skip=${retnz}, guard-skip=${skip}, body=${body} in 1200 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): redrawPlayerUpIndicator == oracle on every real dispatch", () => {
  const CAP = { retnz: 30, skip: 30, body: 20 };
  const caps = { retnz: [], skip: [], body: [] };
  const snap = new Map([[TARGET, (mm) => {
    const f = mm.mem.read8(FRAME), a = mm.mem.read8(ATTRACT);
    const arm = (f & 0x0f) !== 0 ? "retnz" : (a & 0x01) !== 0 ? "skip" : "body";
    if (caps[arm].length < CAP[arm]) caps[arm].push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);

  const all = [...caps.retnz, ...caps.skip, ...caps.body];
  assert.ok(all.length >= 1, "expected at least one real 0x0315 dispatch during boot/attract");
  assert.ok(caps.body.length >= 1, "expected at least one real body dispatch (ATTRACT-clear window)");

  for (const entry of all) {
    const diffs = contractDiffs(entry, redrawPlayerUpIndicator);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/captured: ${all.length} real dispatches identical to the oracle ` +
    `(${caps.retnz.length} frame-skip, ${caps.skip.length} guard-skip, ${caps.body.length} body)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): frame-skip / guard-skip / both blink phases / both players all match", () => {
  const base = attractBase();

  // 2a. Frame gate: a non-multiple-of-16 frame returns at once, no writes.
  for (const frame of [0x01, 0x03, 0x0f, 0x1f]) {
    const entry = craft(base, { frame, attract: 0x00, player: 0, twoPlayer: 1 });
    assert.equal(contractDiffs(entry, redrawPlayerUpIndicator).length, 0, `frame-skip ${hx(frame)}`);
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], `frame-skip ${hx(frame)} wrote RAM`);
  }

  // 2b. Guard skip: multiple-of-16 frame but ATTRACT set -> body skipped, no writes.
  for (const player of [0, 1]) {
    const entry = craft(base, { frame: 0x00, attract: 0x01, player, twoPlayer: 1 });
    assert.equal(contractDiffs(entry, redrawPlayerUpIndicator).length, 0, `guard-skip P${player + 1}`);
    assert.deepEqual(changedAddrs(entry, runOracle(entry), entry.regs.sp), [], `guard-skip P${player + 1} wrote RAM`);
  }

  // 2c. bit-4 CLEAR (paint current player's glyphs). Expected cells: glyph=player+1,
  //     then 0x25, 0x20 one row back each.
  const clearCases = [
    { name: "P1 bit4-clear", frame: 0x00, player: 0, col: P1_COL, glyph: 0x01 },
    { name: "P2 bit4-clear", frame: 0x20, player: 1, col: P2_COL, glyph: 0x02 },
    // 0xFF selector: nonzero -> P2 column, and glyph = (0xFF+1)&0xff = 0x00 (pins the wrap).
    { name: "0xFF selector",  frame: 0x40, player: 0xff, col: P2_COL, glyph: 0x00 },
  ];
  for (const { name, frame, player, col, glyph } of clearCases) {
    const entry = craft(base, { frame, attract: 0x00, player, twoPlayer: 0 });
    clearCells(entry, col); // make the idempotent paint observable
    assert.equal(contractDiffs(entry, redrawPlayerUpIndicator).length, 0, name);
    const o = runOracle(entry);
    const [c0, c1, c2] = cells(col);
    assert.equal(o.mem.read8(c0), glyph, `${name}: base glyph`);
    assert.equal(o.mem.read8(c1), 0x25, `${name}: row-1 tile`);
    assert.equal(o.mem.read8(c2), 0x20, `${name}: row-2 tile`);
    assert.ok(changedAddrs(entry, o, entry.regs.sp).length > 0, `${name}: vacuous`);
  }

  // 2d. bit-4 SET, one-player: blank the current player's three cells, then stop.
  {
    const entry = craft(base, { frame: 0x10, attract: 0x00, player: 0, twoPlayer: 0 });
    clearCells(entry, P1_COL, P2_COL);
    assert.equal(contractDiffs(entry, redrawPlayerUpIndicator).length, 0, "bit4-set 1P");
    const o = runOracle(entry);
    for (const a of cells(P1_COL)) assert.equal(o.mem.read8(a), 0x10, "bit4-set 1P: blank cell");
    // one-player never touches the other column at all — it stays the sentinel.
    for (const a of cells(P2_COL)) assert.equal(o.mem.read8(a), SENTINEL, "bit4-set 1P unexpectedly painted P2");
  }

  // 2e. bit-4 SET, two-player: blank the CURRENT player's column, then paint the OTHER
  //     player's glyphs. Test both current-player orientations.
  const setTwoP = [
    { name: "bit4-set 2P (P1 current)", frame: 0x10, player: 0, blankCol: P1_COL, paintCol: P2_COL, glyph: 0x02 },
    { name: "bit4-set 2P (P2 current)", frame: 0x30, player: 1, blankCol: P2_COL, paintCol: P1_COL, glyph: 0x01 },
  ];
  for (const { name, frame, player, blankCol, paintCol, glyph } of setTwoP) {
    const entry = craft(base, { frame, attract: 0x00, player, twoPlayer: 1 });
    clearCells(entry, blankCol, paintCol);
    assert.equal(contractDiffs(entry, redrawPlayerUpIndicator).length, 0, name);
    const o = runOracle(entry);
    for (const a of cells(blankCol)) assert.equal(o.mem.read8(a), 0x10, `${name}: current column blanked`);
    const [p0, p1, p2] = cells(paintCol);
    assert.equal(o.mem.read8(p0), glyph, `${name}: other-player glyph`);
    assert.equal(o.mem.read8(p1), 0x25, `${name}: other-player row-1 tile`);
    assert.equal(o.mem.read8(p2), 0x20, `${name}: other-player row-2 tile`);
  }

  console.log("  EQUAL/crafted: frame-skip x4, guard-skip x2, bit4-clear x3 (incl 0xFF wrap), " +
    "bit4-set 1P, bit4-set 2P x2 — all identical, cells pinned");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): steps +32 instead of −32 between the three cells. */
function brokenRowStep(m) {
  const { mem } = m;
  const frame = mem.read8(FRAME);
  if ((frame & 0x0f) !== 0) return;
  if (!gameActiveGuard(m)) return;
  const STEP = 0x0020; // BUG: +32
  let selector = mem.read8(CURRENT_PLAYER);
  let colBase = loc_0347(selector);
  if ((frame & 0x10) !== 0) {
    let a = colBase;
    mem.write8(a, 0x10); a = (a + STEP) & 0xffff;
    mem.write8(a, 0x10); a = (a + STEP) & 0xffff;
    mem.write8(a, 0x10);
    if (mem.read8(TWO_PLAYER_GAME) === 0) return;
    selector = mem.read8(CURRENT_PLAYER) ^ 0x01;
    colBase = loc_0347(selector);
  }
  let a = colBase;
  mem.write8(a, (selector + 1) & 0xff); a = (a + STEP) & 0xffff;
  mem.write8(a, 0x25); a = (a + STEP) & 0xffff;
  mem.write8(a, 0x20);
}

/** Broken twin (b): writes the raw selector as the glyph, dropping the +1. */
function brokenGlyph(m) {
  const { mem } = m;
  const frame = mem.read8(FRAME);
  if ((frame & 0x0f) !== 0) return;
  if (!gameActiveGuard(m)) return;
  let selector = mem.read8(CURRENT_PLAYER);
  let colBase = loc_0347(selector);
  if ((frame & 0x10) !== 0) {
    let a = colBase;
    mem.write8(a, 0x10); a = (a + ROW_BACK) & 0xffff;
    mem.write8(a, 0x10); a = (a + ROW_BACK) & 0xffff;
    mem.write8(a, 0x10);
    if (mem.read8(TWO_PLAYER_GAME) === 0) return;
    selector = mem.read8(CURRENT_PLAYER) ^ 0x01;
    colBase = loc_0347(selector);
  }
  let a = colBase;
  mem.write8(a, selector & 0xff); a = (a + ROW_BACK) & 0xffff; // BUG: no +1
  mem.write8(a, 0x25); a = (a + ROW_BACK) & 0xffff;
  mem.write8(a, 0x20);
}

test("TEETH: the wrong-row-step twin and the wrong-glyph twin are CAUGHT", () => {
  const base = attractBase();

  // (a) wrong row step: any paint case — a bit4-clear P1 paint.
  const step = craft(base, { frame: 0x00, attract: 0x00, player: 0, twoPlayer: 0 });
  const stepDiffs = contractDiffs(step, brokenRowStep);
  assert.ok(stepDiffs.length > 0, "the wrong-row-step twin escaped — the gate is worthless");

  // (b) wrong glyph: bit4-clear P1 paint — correct glyph 0x01 vs twin 0x00 at P1_COL.
  const glyph = craft(base, { frame: 0x00, attract: 0x00, player: 0, twoPlayer: 0 });
  const glyphDiffs = contractDiffs(glyph, brokenGlyph);
  assert.ok(glyphDiffs.length > 0, "the wrong-glyph twin escaped — the gate is worthless");
  assert.ok(glyphDiffs[0].startsWith(`RAM@${hx(P1_COL)}`), `expected the glyph diff at ${hx(P1_COL)}, got ${glyphDiffs[0]}`);

  console.log(`  TEETH: wrong-row-step caught (${stepDiffs[0]}); wrong-glyph caught (${glyphDiffs[0]})`);
});
