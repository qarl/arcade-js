// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_062a (ROM 0x062A–0x0669) — task entry 10, one step of the on-screen
 * bonus readout.
 *
 * FOUR ARMS, AND ATTRACT REACHES TWO OF THEM. A 9000-frame attract run dispatches 0x062A 39
 * times: 35 on the tick arm (BONUS_DISPLAY non-zero) and 4 on the re-seed arm, always with
 * payload 1. It never reaches the payload-0 payout arm and never reaches the latch-set
 * do-nothing arm. So this gate is captures PLUS crafted entries, and each test says which it
 * is. A crafted entry is a real attract machine (boot + 600 frames, with the task dispatcher's
 * return address pushed) with the bytes that select the arm nudged — identically on both sides.
 *
 * EVERY ONE OF THOSE COUNTS IS ASSERTED, NOT JUST PRINTED, and that is deliberate: a capture
 * hook that silently stops catching dispatches (the classic form: a stub that does not survive
 * clone()) leaves an EMPTY corpus, and an empty corpus satisfies both a "the unreachable arms
 * stay unreached" check and a replay loop with nothing in it. This gate used to go fully green
 * in that state — it skipped its replay block and reported a pass. It now fails instead.
 *
 * THE CONTRACT IS RAM − the stack scratch below the entry SP plus the return value; pc and SP are NOT compared. The
 * oracle pushes IX once per column of the tile-block copy and its payout arm nests further
 * pushes and rets, all of which land in the dead STACK_SCRATCH region; the idiomatic rewrite
 * models no stack at all. Live-out is memory-only (see the routine's header), so the residual
 * registers and flags are dead and are not compared either — but the RETURN VALUE is, because
 * a RAM diff cannot see it.
 *
 *   1. REACHABILITY — report the natural dispatches and which arms they take, over 2500 and
 *      9000 frames; assert both runs caught something and that the 9000-frame run's per-arm
 *      tally is the 35 / 4 quoted above; and FAIL if attract ever starts reaching the two
 *      crafted arms (which would mean captures should replace the crafted entries).
 *   2. EQUAL (real captured dispatches) — replay EVERY real 0x062A entry the 2500-frame run
 *      produces, inline, all 15 of them: at this size sampling buys nothing, so there is no
 *      sampling policy to state and no sampled/total gap to reason about. The corpus is asserted
 *      non-empty and asserted to be exactly the 15 captures expected, so a hook that stops
 *      catching fails here rather than silently replaying nothing.
 *   3. EQUAL (exhaustive, re-seed arm) — sweep all 128 EVEN values of BONUS_START through the
 *      re-seed. THE ODD HALF IS EXCLUDED, and not because it passes: the ROM's divide loop
 *      steps by ten modulo 256 with no iteration guard, so an odd seed never reaches zero and
 *      BOTH sides spin forever. Sweeping it would hang the gate, not fail it. (No reachable
 *      input is odd — BONUS_START's only writer stores min((10*LEVEL + 40) mod 256, 80), which
 *      is even for every LEVEL. That is a code derivation, stated in the routine's header, not
 *      something this gate measures.)
 *   4. EQUAL (exhaustive, tick arm) — sweep all 255 non-zero BONUS_DISPLAY values.
 *   5. EQUAL (crafted, payout arm) — payload 0, swept over all 256 BONUS_DISPLAY values on a
 *      crafted base (ATTRACT cleared and a score set, so the add-to-score task's body really
 *      runs), with a non-vacuity check that the score moved.
 *   6. EQUAL (crafted, latch-set arm) — BONUS_DISPLAY 0 with the bottomed-out latch set: both
 *      sides must leave RAM exactly as they found it, and the same entry with the latch CLEAR
 *      must write, so the arm is not vacuously quiet.
 *   7. EQUAL (live-wire, whole attract) — 4000 frames of attract with the rewrite wired at
 *      0x062A, compared frame by frame against the all-oracle baseline over RAM −
 *      STACK_SCRATCH. THE ORACLE'S MEASURED CYCLE COST IS CHARGED BACK inside the override:
 *      the rewrite is cycle-free, and delete that one line and this test forks at 0x6019 (the
 *      cycle-derived spin counter) around frame 521 — a shifted vblank NMI, not a behaviour
 *      difference. Reproduce it that way rather than trusting the sentence.
 *   8. TEETH — three deliberately-broken twins of the real routine, each caught by the check
 *      named beside it:
 *        (a) dropped nibble swap (stores the raw quotient) — caught by the re-seed sweep; the
 *            twin's stored BONUS_DISPLAY byte is asserted to differ, because the first
 *            diverging byte in the dump is the render tail's music latch, which sits lower.
 *        (b) dropped latch guard (re-seeds even when the readout has bottomed out) — caught on
 *            the crafted latch-set entry.
 *        (c) tile block copied with the column stride lost — caught by the re-seed sweep, in
 *            video RAM.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-062a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_062a as oracle } from "../../translated/loc_062a.js";
import { loc_062a } from "../loc_062a.js";
import { awardRemainingBonusToScore } from "../awardRemainingBonusToScore.js";
import { stepBonusDisplayDown } from "../stepBonusDisplayDown.js";
import { renderBonusDisplay } from "../renderBonusDisplay.js";
import { Machine } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  STACK_SCRATCH,
  ATTRACT,
  CURRENT_PLAYER,
  P1_SCORE,
  HIGH_SCORE,
  BONUS_START,
  BONUS_DISPLAY,
  BONUS_DISPLAY_ZEROED,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x062a;
const CAPTURE_FRAMES = 2500;
const REACH_FRAMES = 9000;
// What the two attract runs must catch. Pinned rather than merely printed: these counts are the
// only thing standing between a capture hook that has stopped firing and a green gate.
const EXPECTED_CAPTURES = 15; // real dispatches in CAPTURE_FRAMES
const EXPECTED_REACH = { total: 39, tick: 35, reseed: 4 }; // ...and in REACH_FRAMES, by arm
const LIVE_FRAMES = 4000;
const BLOCK_FIRST_CELL = 0x7465; // first video-RAM cell of the tile block the re-seed lays down
const RET_ADDR = 0x02bd; // what the task dispatcher pushes before jumping to a handler

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Same diff over two raw frame dumps from a live run. */
function firstFrameDiff(da, db, toAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = toAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Which arm an entry state takes — the routine's four top-level branches. */
function armOf(mm) {
  if ((mm.regs.a & 0xff) === 0) return "payout";
  if (mm.mem.read8(BONUS_DISPLAY) !== 0) return "tick";
  if (mm.mem.read8(BONUS_DISPLAY_ZEROED) !== 0) return "latched";
  return "reseed";
}

const shapeOf = (mm) => `${armOf(mm)}/payload=${hb(mm.regs.a)}`;

// -- capture ------------------------------------------------------------------

/** Hook 0x062A in a real attract run and clone the machine at each real dispatch. */
function captureDispatches(maxFrames = CAPTURE_FRAMES) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

// A real, self-consistent machine (boot + a stretch of attract) so work RAM holds realistic
// values — the base every crafted entry is nudged from. The task dispatcher pushes mainLoop's
// address before jumping to a handler, and every arm of the oracle rets through exactly one
// such bracket, so the base carries one; it lands in STACK_SCRATCH and is excluded from the diff.
function attractBase(frames = 600) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  const c = m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
  c.regs.sp = STACK_SCRATCH.hi;
  c.push16(RET_ADDR);
  return c;
}

/** One entry: a clone of `base` with the frame machinery neutralised and `poke` applied. */
function makeEntry(base, poke) {
  const e = base.clone();
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  poke(e);
  return e;
}

/**
 * Run the oracle and a candidate on two FRESH, byte-identical entries; diff RAM − the stack scratch below the entry SP
 * AND the return value. A fresh entry per side because the routine writes memory.
 */
function runPair(base, poke, candidate) {
  const a = makeEntry(base, poke); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(base, poke); // candidate
  const ra = oracle(a);
  const rb = candidate(b);
  return { ram: firstRamDiff(a, b, aFloor), ret: ra === rb ? null : { a: ra, b: rb }, a, b };
}

/** Sweep `values` through `poke`; return the first mismatch (or null) and the count compared. */
function sweep(base, values, poke, candidate) {
  for (const v of values) {
    const { ram, ret } = runPair(base, (e) => poke(e, v), candidate);
    if (ram || ret) return { mismatch: { v, ram, ret }, count: values.indexOf(v) + 1 };
  }
  return { mismatch: null, count: values.length };
}

const describe = (mm) =>
  mm && (mm.ram
    ? `at ${hb(mm.v)}: RAM diverges at ${hx(mm.ram.addr ?? 0)} (${mm.ram.a}->${mm.ram.b})`
    : `at ${hb(mm.v)}: return value diverges (${mm.ret.a} vs ${mm.ret.b})`);

// The four arms as pokes on a real base. Each sets EVERY byte the arm's selection depends on,
// so no arm leaks into another through whatever the base happened to hold.
const pokeReseed = (e, seed) => {
  e.regs.a = 0x01;
  e.mem.write8(BONUS_DISPLAY, 0x00);
  e.mem.write8(BONUS_DISPLAY_ZEROED, 0x00);
  e.mem.write8(BONUS_START, seed & 0xff);
};
const pokeTick = (e, display) => {
  e.regs.a = 0x01;
  e.mem.write8(BONUS_DISPLAY, display & 0xff);
};
const pokePayout = (e, display) => {
  e.regs.a = 0x00;
  e.mem.write8(BONUS_DISPLAY, display & 0xff);
};
const pokeLatched = (e) => {
  e.regs.a = 0x01;
  e.mem.write8(BONUS_DISPLAY, 0x00);
  e.mem.write8(BONUS_DISPLAY_ZEROED, 0x01);
};

/** The 18 video-RAM cells the re-seed's tile block covers: six columns of three, stride 0x20. */
function blockCells() {
  const out = [];
  for (let column = 0; column < 6; column++) {
    for (let i = 0; i < 3; i++) out.push(BLOCK_FIRST_CELL + column * 0x20 + i);
  }
  return out;
}
const blankBlock = (e) => { for (const c of blockCells()) e.mem.write8(c, 0x00); };

const EVEN_SEEDS = Array.from({ length: 128 }, (_, i) => i * 2);
const NONZERO_BYTES = Array.from({ length: 255 }, (_, i) => i + 1);
const ALL_BYTES = Array.from({ length: 256 }, (_, i) => i);

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: which 0x062A arms attract actually dispatches", () => {
  const tally = (frames) => {
    const arms = new Map();
    for (const c of captureDispatches(frames)) arms.set(armOf(c), (arms.get(armOf(c)) ?? 0) + 1);
    const total = [...arms.values()].reduce((a, b) => a + b, 0);
    const summary = [...arms.entries()].sort().map(([k, v]) => `${k}x${v}`).join(", ");
    console.log(`  REACHABILITY: ${total} natural 0x062A dispatches in ${frames} frames — ${summary || "none"}`);
    // THE GUARD THAT MAKES THE REST OF THIS TEST MEAN ANYTHING. Everything below is a claim about
    // what attract does NOT reach, and an empty tally satisfies every such claim vacuously.
    assert.ok(total > 0, `the hook caught NOTHING in ${frames} frames — the capture is broken, not the game`);
    return { arms, total };
  };
  tally(CAPTURE_FRAMES);
  // The longer run is what backs the routine header's claim that the other two arms are not
  // reachable by attract at all, rather than merely rare.
  const { arms: long, total } = tally(REACH_FRAMES);
  assert.ok(!long.has("payout") && !long.has("latched"),
    "the crafted-entry tests below exist because attract reaches neither arm — if it now does, replace them with captures");
  // Pin the two arms attract DOES reach, so the header's 39 / 35 / 4 cannot go stale and a
  // half-firing hook cannot pass the non-zero guard above on one arm's worth of dispatches.
  assert.deepEqual(
    { total, tick: long.get("tick") ?? 0, reseed: long.get("reseed") ?? 0 }, EXPECTED_REACH,
    `attract's 0x062A dispatch tally over ${REACH_FRAMES} frames moved`);
  console.log(`  NOT reached in ${REACH_FRAMES} frames: payout (payload 0) and latched — both covered by crafted entries below.`);
});

// -- 2. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_062a == oracle on EVERY real 0x062A entry", () => {
  const caps = captureDispatches();
  // A missing corpus is a broken instrument, never a pass: replaying nothing must FAIL here, not
  // skip. The exact count goes with it — a hook that catches one dispatch out of fifteen would
  // clear a bare non-empty check while replaying almost nothing.
  assert.ok(caps.length > 0, `no natural 0x062A dispatch in ${CAPTURE_FRAMES} frames — the capture is broken`);
  assert.equal(caps.length, EXPECTED_CAPTURES,
    `expected ${EXPECTED_CAPTURES} real 0x062A dispatches in ${CAPTURE_FRAMES} frames, caught ${caps.length}`);

  const allShapes = new Set(caps.map(shapeOf));
  for (let i = 0; i < caps.length; i++) {
    const cap = caps[i];
    const { ram, ret } = runPair(cap, () => {}, loc_062a);
    assert.equal(ram, null, ram && `capture #${i} (${shapeOf(cap)}): RAM diverges at ${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`);
    assert.equal(ret, null, ret && `capture #${i}: return value diverges (${ret.a} vs ${ret.b})`);
  }
  console.log(`  EQUAL/real: replayed all ${caps.length} of ${caps.length} captures inline (no sampling), covering all ${allShapes.size} entry shapes (${[...allShapes].sort().join(", ")})`);
});

// -- 3. EQUAL (exhaustive, re-seed arm) ---------------------------------------

test("EQUAL (exhaustive): re-seed arm == oracle over all 128 EVEN BONUS_START values", () => {
  const base = attractBase();
  const { mismatch, count } = sweep(base, EVEN_SEEDS, pokeReseed, loc_062a);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 128, "must have compared all 128 even seeds");

  // Non-vacuity: seed 50 (level 1) must store 0x50, and — starting from a blanked block, since
  // attract has usually already painted it — must lay all 18 tile cells back down.
  const { a, b } = runPair(base, (e) => { pokeReseed(e, 50); blankBlock(e); }, loc_062a);
  assert.equal(a.mem.read8(BONUS_DISPLAY), 0x50, "seed 50 must divide to 5 and store it in the high nibble");
  const painted = blockCells().filter((c) => a.mem.read8(c) !== 0).length;
  assert.ok(painted >= 12, `non-vacuity: the tile block must reach video RAM, only ${painted}/18 cells written`);
  for (const c of blockCells()) {
    assert.equal(b.mem.read8(c), a.mem.read8(c), `tile cell ${hx(c)} differs from the oracle`);
  }
  console.log(`  EQUAL/reseed: ${count} even seeds — RAM + return identical to the oracle (odd seeds excluded: both sides never terminate)`);
});

// -- 4. EQUAL (exhaustive, tick arm) ------------------------------------------

test("EQUAL (exhaustive): tick arm == oracle over all 255 non-zero BONUS_DISPLAY values", () => {
  const base = attractBase();
  const { mismatch, count } = sweep(base, NONZERO_BYTES, pokeTick, loc_062a);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 255, "must have compared every non-zero display byte");
  console.log(`  EQUAL/tick: ${count} display bytes — RAM + return identical to the oracle`);
});

// -- 5. EQUAL (crafted, payout arm) -------------------------------------------

/** A crafted payout base: attract off and a real score, so the add-to-score task's body runs. */
function payoutBase() {
  const m = attractBase().clone();
  m.mem.write8(ATTRACT, 0x00);
  m.mem.write8(CURRENT_PLAYER, 0x00);
  m.mem.write8(P1_SCORE + 0, 0x00);
  m.mem.write8(P1_SCORE + 1, 0x00);
  m.mem.write8(P1_SCORE + 2, 0x10); // 100000, packed BCD [lo, mid, hi]
  m.mem.write8(HIGH_SCORE + 0, 0x00);
  m.mem.write8(HIGH_SCORE + 1, 0x00);
  m.mem.write8(HIGH_SCORE + 2, 0x00);
  return m;
}

test("EQUAL (crafted): payout arm == oracle over all 256 BONUS_DISPLAY values", () => {
  const base = payoutBase();
  const { mismatch, count } = sweep(base, ALL_BYTES, pokePayout, loc_062a);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256, "must have compared the full 256-byte input space");

  // Non-vacuity: byte 0x11 pays out +100 then +1000, so the score's middle byte moves by 0x11.
  const before = base.mem.read8(P1_SCORE + 1);
  const { a, b } = runPair(base, (e) => pokePayout(e, 0x11), loc_062a);
  assert.equal(a.mem.read8(P1_SCORE + 1), u8(before + 0x11), "oracle must have paid out +1100");
  assert.notEqual(a.mem.read8(P1_SCORE + 1), before, "non-vacuity: the payout must move the score");
  assert.equal(b.mem.read8(P1_SCORE + 1), a.mem.read8(P1_SCORE + 1), "candidate must match the oracle's score");
  console.log(`  EQUAL/payout (crafted, attract never reaches this arm): ${count} display bytes — RAM + return identical`);
});

// -- 6. EQUAL (crafted, latch-set arm) ----------------------------------------

test("EQUAL (crafted): latch-set arm writes nothing, on both sides", () => {
  const base = attractBase();
  const { ram, ret, a } = runPair(base, pokeLatched, loc_062a);
  assert.equal(ram, null, ram && `RAM diverges at ${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`);
  assert.equal(ret, null, ret && `return value diverges (${ret.a} vs ${ret.b})`);

  // The arm's whole content is that it does nothing: the oracle must leave RAM as it found it.
  const untouched = makeEntry(base, pokeLatched);
  assert.equal(firstRamDiff(untouched, a, untouched.regs.sp), null, "the latch-set arm must write no RAM at all");

  // ...and the SAME entry with the latch clear must write, so the check above is not vacuous.
  const { a: reseeded } = runPair(base, (e) => pokeLatched(e) || e.mem.write8(BONUS_DISPLAY_ZEROED, 0x00), loc_062a);
  assert.notEqual(firstRamDiff(untouched, reseeded, untouched.regs.sp), null,
    "non-vacuity: with the latch clear the same entry must re-seed and write");
  console.log("  EQUAL/latched (crafted, attract never reaches this arm): both sides inert; latch-clear twin does write");
});

// -- 7. EQUAL (live-wire, whole attract) --------------------------------------

test("EQUAL (live): the rewrite wired at 0x062A reproduces the all-oracle attract trace", () => {
  const stock = new Machine(ROM);
  const stockSp = recordFrameSp(stock);
  const baseline = stock.runFrames(LIVE_FRAMES);

  let dispatches = 0;
  const wired = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      dispatches++;
      // THE CYCLE RESTORATION. The rewrite charges no T-states; the oracle does, and the ROM's
      // spin counter at 0x6019 is a pure function of them. Measure the oracle's cost on a
      // throwaway clone and charge it back, or the vblank NMI shifts and the trace forks.
      const probe = mm.clone();
      const before = probe.cycles;
      oracle(probe);
      const r = loc_062a(mm);
      mm.tick(probe.cycles - before);
      return r;
    }]]),
  });
  const wiredSp = recordFrameSp(wired);
  const trace = wired.runFrames(LIVE_FRAMES);
  const floors = frameFloors(stockSp, wiredSp);

  assert.equal(wired.stoppedBy, null, `wired run stopped early: ${wired.stoppedBy}`);
  assert.equal(trace.length, baseline.length, "both runs must capture the same number of frames");
  assert.ok(dispatches > 0, "the wired run must actually have dispatched 0x062A");

  for (let i = 0; i < baseline.length; i++) {
    const d = firstFrameDiff(baseline[i], trace[i], (off) => wired.stateOffsetToAddr(off), floors[i]);
    assert.equal(d, null, d && `frame ${i}: RAM diverges at ${hx(d.addr ?? 0)} (${d.a}->${d.b})`);
  }
  console.log(`  EQUAL/live: ${LIVE_FRAMES} frames identical to the all-oracle baseline over RAM − the stack scratch below each frame's live SP (${dispatches} dispatches wired)`);
});

// -- 8. TEETH -----------------------------------------------------------------

/**
 * A faithful re-implementation of loc_062a with one switchable bug, so each twin is the real
 * routine minus exactly one correct behaviour (and reuses the real, gated callees).
 */
function brokenLoc062a(m, bug) {
  const { regs, mem8 } = m;
  if ((regs.a & 0xff) === 0) { awardRemainingBonusToScore(m); return; }
  const display = mem8[BONUS_DISPLAY];
  if (display !== 0) { regs.a = display; stepBonusDisplayDown(m); return; }
  if (bug !== "no-latch-guard" && mem8[BONUS_DISPLAY_ZEROED] !== 0) return; // BUG(no-latch-guard)

  let remainder = mem8[BONUS_START];
  let quotient = 0;
  do {
    quotient = u8(quotient + 1);
    remainder = u8(remainder - 10);
  } while (remainder !== 0);

  // BUG(no-nibble-swap): stores the raw quotient instead of rotating it into the high nibble.
  mem8[BONUS_DISPLAY] = bug === "no-nibble-swap" ? quotient : (quotient << 4) | (quotient >> 4);

  let source = 0x384a;
  let cell = BLOCK_FIRST_CELL;
  for (let column = 0; column < 6; column++) {
    for (let i = 0; i < 3; i++) mem8[cell + i] = mem8[source + i];
    source += 3;
    // BUG(no-column-stride): advances by the three bytes just copied, losing the column step.
    cell += bug === "no-column-stride" ? 3 : 0x20;
  }

  regs.a = mem8[BONUS_DISPLAY];
  renderBonusDisplay(m);
}

const twin = (bug) => (m) => brokenLoc062a(m, bug);

test("TEETH: dropped nibble swap, dropped latch guard, and lost column stride are CAUGHT", () => {
  const base = attractBase();

  const noSwap = sweep(base, EVEN_SEEDS, pokeReseed, twin("no-nibble-swap")).mismatch;
  assert.notEqual(noSwap, null, "the re-seed sweep FAILED to catch a dropped nibble swap — worthless");
  // The FIRST diverging byte is whichever the dump scan reaches first (the render tail's
  // background-music latch sits below BONUS_DISPLAY), so pin the twin's actual defect directly.
  const swapPair = runPair(base, (e) => pokeReseed(e, noSwap.v), twin("no-nibble-swap"));
  assert.notEqual(swapPair.a.mem.read8(BONUS_DISPLAY), swapPair.b.mem.read8(BONUS_DISPLAY),
    `the dropped-swap twin must store a different BONUS_DISPLAY byte at seed ${hb(noSwap.v)}`);

  const noStride = sweep(base, EVEN_SEEDS, pokeReseed, twin("no-column-stride")).mismatch;
  assert.notEqual(noStride, null, "the re-seed sweep FAILED to catch a lost column stride — worthless");
  assert.ok(noStride.ram.addr >= 0x7400, `the lost-stride twin must diverge in video RAM, got ${hx(noStride.ram.addr ?? 0)}`);

  const guard = runPair(base, pokeLatched, twin("no-latch-guard"));
  assert.notEqual(guard.ram, null, "the latch-set entry FAILED to catch a dropped latch guard — worthless");

  console.log(`  TEETH: dropped-swap caught (${describe(noSwap)}); lost-stride caught (${describe(noStride)}); ` +
    `dropped-latch-guard caught (RAM diverges at ${hx(guard.ram.addr ?? 0)}: ${guard.ram.a}->${guard.ram.b})`);
});
