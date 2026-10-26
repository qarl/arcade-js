// SPDX-License-Identifier: GPL-3.0-only
/**
 * fetchWideTableWord — memory-equivalent to the frozen oracle at ROM 0x018C.
 *
 * GATE: unit-capture on the real dispatch, but the comparison is RAM **plus a declared
 *   live-out**, because RAM ALONE IS VACUOUS FOR THIS ROUTINE. It writes nothing at all; the
 *   whole effect is the value it leaves in a register pair. `unitEquivalence` therefore reports
 *   `ram: null` for a bare `() => {}` exactly as readily as for the real thing, and a test
 *   asserting only that would be green and worthless. The BLIND arm makes that an assertion.
 *
 * LIVE-OUT, derived from the CALLERS rather than from the instruction sequence. Seven routines
 *   call this one. Every one of them consumes the fetched word: five exchange it into the
 *   address pair and read a text record through it, one stores its two halves into an actor
 *   record, and one jumps to it as a handler address. So DE is live everywhere.
 *   Nothing else is. The table cursor HL is overwritten before it is read at all seven sites —
 *   five exchange it away and then reload both halves from the record, one loads a fresh
 *   constant, one loads the return address it is about to push. The accumulator is reloaded at
 *   every site before any read (from a record, from a work-RAM cell, or from B). No site tests
 *   the flags this routine leaves; the two sites that transfer control without setting flags
 *   first — the shared character loop and the computed handler — each begin with a compare that
 *   sets them afresh. EXCLUDED is {a, f, h, l, sp}, pinned by name so it cannot silently widen,
 *   and `pc` diverges too: the oracle ends by popping a return address into the program counter
 *   and the rewrite, being ordinary JavaScript, does not.
 *
 *   Reading callers is not proof on its own, so MEASUREMENT finishes the job — see LIVE-OUT
 *   (MEASURED) below, which wires the rewrite into a full driven run and shows that everything
 *   dropped reaches nothing the display reads.
 *
 * THE STACK IS NOT MODELLED. The idiomatic layer lets the host language own the call stack, so
 *   this routine does not consume the return address its callers push. Substituted one-for-one
 *   into the still-translated engine it therefore leaks two bytes per dispatch and the engine
 *   dies on a stale return address. That is the known mixed-migration leak, not a defect here,
 *   and it resolves when the callers stop pushing. EXPECTED DIVERGENCE (STACK) pins the
 *   measurement so the claim is checked rather than asserted.
 *
 * THE CYCLE MODEL IS NOT MODELLED EITHER, AND HERE THAT HAS AN EDGE. The oracle spends time
 *   between its two byte reads; the rewrite reads a word with no time between them. Everywhere
 *   the game actually points a table that is invisible, because the bytes are in ROM. Point the
 *   table into the port block and it is not: the raster register moves under the second read.
 *   EXPECTED DIVERGENCE (RASTER) measures that, and it is why the page sweep excludes those
 *   pages rather than pretending they pass.
 *
 * `r.equal` is unused and stays false by design — it folds in the register diff that
 *   memory-equivalence deliberately drops.
 *
 * What it exercises, holes stated:
 *   1. BLIND — the RAM half is proven vacuous, so it cannot be mistaken for the gate.
 *   2. EQUAL at the real dispatch — RAM identical AND the live-out identical.
 *   3. EXCLUDED — nothing outside {a, f, l, sp} moves at the captured entry, plus pc; the
 *      fetched word does not. The cursor's high byte is idle at THIS entry, so a crafted carry
 *      entry covers it separately rather than leaving `h` in EXCLUDED unexercised.
 *   4. EXHAUSTIVE (REAL TABLES) — both tables the game really passes, swept over every index.
 *   5. EXHAUSTIVE (ADDRESS ARITHMETIC) — every low byte of the base against every index, which
 *      is the whole cross-product of the two carries the address sum can produce.
 *   6. PAGES — the base walked across every page, so the arithmetic cannot depend on where the
 *      table sits. The sixteen pages whose fetch lands in the port block are excluded BY COUNT.
 *   7. CORPUS — every base-and-index pair the running game presents over a driven tape.
 *      Its two blind spots are asserted, not assumed: no real dispatch carries out of the
 *      doubling and none carries out of the low byte, so arms 4-6 are load-bearing.
 *   8. EXPECTED DIVERGENCE (STACK) — the leak, measured and recorded.
 *   9. EXPECTED DIVERGENCE (RASTER) — the port-block edge, measured and recorded.
 *  10. LIVE-OUT (MEASURED) — the dropped cursor, accumulator and flags reach nothing.
 *  11. TEETH — six broken twins with exact catch counts on every space. Two of them are
 *      invisible to the entire real corpus, and that blindness is asserted rather than implied.
 *
 * HOLE: the corpus is one tape. It reaches live play, but not every screen the game can draw.
 * HOLE: the memory the tables sit in is whatever the captured entry holds; the sweeps vary the
 * base and the index, never the bytes underneath them.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-018c.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { fetchWideTableWord } from "../fetchWideTableWord.js";
import { loc_018c as oracle } from "../../translated/loc_018c.js";
import { deadStackBelow, firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { recordFrameFloors } from "./_frameFloor.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x018c;
const LIVE_OUT = ["d", "e"];
const EXCLUDED = ["a", "f", "h", "l", "sp"];
const MOVED_AT_ENTRY = ["a", "f", "l", "sp"];

// The two tables the game really passes, measured off the corpus arm below.
const HANDLER_TABLE = 0x0bbc;
const RECORD_TABLE = 0x0c50;
const INDEX_SPACE = 256;
const ENTRY_WIDTH = 2;

const CORPUS_FRAMES = 1800;
const CORPUS_DISPATCHES = 600;
const WORK_RAM_TOP = 0xafff;

// The port block. A read here is a live hardware read, not memory.
const PORT_LOW = 0xc000;
const PORT_HIGH = 0xcfff;

// The raster arm walks the machine's clock across this many ticks at one port-block base.
const RASTER_PHASES = 512;
const RASTER_DIVERGING = 117;

const OPTS = romsPresent() ? {} : { skip: "ROM images are gitignored; assemble them to run" };

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const u16 = (v) => v & 0xffff;
const inPort = (addr) => addr >= PORT_LOW && addr <= PORT_HIGH;

/** Where a (base, index) pair fetches from — the one thing the rewrite computes. */
const fetchAddr = (base, index) => u16(base + ENTRY_WIDTH * index);
const fetchTouchesPort = (base, index) => {
  const at = fetchAddr(base, index);
  return inPort(at) || inPort(u16(at + 1));
};

/**
 * The routine wrapped in the translated engine's calling convention, for the driven-run arms
 * only. Nothing in the shipped layer looks like this: the wrapper exists so an experiment can
 * run INSIDE an engine whose callers still push a return address, and the difference between
 * running with it and without it is precisely what those arms measure.
 */
const substitutable = (fn) => (m) => {
  fn(m);
  return m.ret();
};

let entry = null;

/** unitEquivalence with the pristine entry harvested off the candidate arm's own clone. */
function rawGate(candidate) {
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
  if (entry === null) rawGate(fetchWideTableWord);
  return entry;
}

/** Oracle vs candidate from the real entry, with the base and index forced. */
function liveOutDiff(candidate, base, index) {
  const a = entryState().clone();
  const b = entryState().clone();
  a.regs.hl = base;
  a.regs.a = index;
  b.regs.hl = base;
  b.regs.a = index;
  oracle(a);
  candidate(b);
  for (const k of LIVE_OUT) {
    if (a.regs[k] !== b.regs[k]) return { reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** The whole comparison the real arm passes: the RAM half AND the live-out half. */
function gate(candidate) {
  const r = rawGate(candidate);
  const at = entryState().regs;
  return { ram: r.ram, live: liveOutDiff(candidate, at.hl, at.a) };
}

const show = (d) =>
  d ? `${d.reg ?? hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical";

/**
 * Replay a list of (base, index) pairs through both sides on two long-lived machines. Cloning
 * per pair costs a tenth of a millisecond, which 65536 pairs cannot afford; reusing two machines
 * is only sound if neither side writes memory, so the caller is handed the RAM diff to check.
 * The stack pointer is re-seated every iteration because the ORACLE pops one on the way out and
 * would otherwise walk it clean off the stack over the course of a sweep.
 */
function replay(candidate, pairs) {
  const a = entryState().clone();
  const b = entryState().clone();
  const sp = entryState().regs.sp;
  const pristine = entryState().dumpState();
  let caught = 0;
  let first = null;
  let n = 0;
  for (const { base, index } of pairs) {
    a.regs.sp = sp;
    a.regs.hl = base;
    a.regs.a = index;
    b.regs.sp = sp;
    b.regs.hl = base;
    b.regs.a = index;
    oracle(a);
    candidate(b);
    n++;
    if (a.regs.d !== b.regs.d || a.regs.e !== b.regs.e) {
      caught++;
      if (first === null) first = { base, index, oracleWord: a.regs.de, candidateWord: b.regs.de };
    }
  }
  const addrOf = (o) => a.stateOffsetToAddr(o);
  return {
    caught,
    n,
    first,
    wroteA: firstStateDiff(pristine, a.dumpState(), addrOf),
    wroteB: firstStateDiff(pristine, b.dumpState(), addrOf),
  };
}

// ── the three swept spaces ──────────────────────────────────────────────────────────────

/** Both real tables against every index — the crafted arm closest to what the game does. */
function realTablePairs() {
  const out = [];
  for (const base of [HANDLER_TABLE, RECORD_TABLE]) {
    for (let index = 0; index < INDEX_SPACE; index++) out.push({ base, index });
  }
  return out;
}

/**
 * Every low byte of the base against every index, at a fixed ROM page. This is the full
 * cross-product of the two carries the address sum can produce: out of the doubling (index at
 * or above 128) and out of the low byte of the sum. Both fetch addresses stay in ROM.
 */
const SWEEP_PAGE = 0x0c00;
function arithmeticPairs() {
  const out = [];
  for (let low = 0; low < 256; low++) {
    for (let index = 0; index < INDEX_SPACE; index++) out.push({ base: SWEEP_PAGE | low, index });
  }
  return out;
}

/**
 * The base walked across every page with both carries forced, so the high byte is incremented
 * twice and wraps at the top of the address space. Pages whose fetch lands in the port block
 * are split off, not silently dropped: they are a live hardware read and the raster arm below
 * measures what they do.
 */
const PAGE_LOW_BYTE = 0xff;
const PAGE_INDEX = 0xff;
function pagePairs() {
  const compared = [];
  const excluded = [];
  for (let page = 0; page < 256; page++) {
    const pair = { base: (page << 8) | PAGE_LOW_BYTE, index: PAGE_INDEX };
    (fetchTouchesPort(pair.base, pair.index) ? excluded : compared).push(pair);
  }
  return { compared, excluded };
}
const PAGES_COMPARED = 240;
const PAGES_EXCLUDED = 16;

/** Every (base, index) the running game presents to this routine over the driven tape. */
let corpusCache = null;
function corpus() {
  if (corpusCache === null) {
    const pairs = [];
    const m = makeMachine(
      new Map([[TARGET, (mm) => { pairs.push({ base: mm.regs.hl, index: mm.regs.a }); return oracle(mm); }]]),
    );
    m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the corpus run stopped early: ${m.stoppedBy}`);
    corpusCache = pairs;
  }
  return corpusCache;
}

const carriesOutOfDoubling = (p) => p.index >= 128;
const carriesOutOfLowByte = (p) => ((ENTRY_WIDTH * p.index) & 0xff) + (p.base & 0xff) > 255;

/**
 * Wire a candidate into a driven run and diff every frame against the all-oracle baseline.
 * Divergence in the stack window below the SP of that frame's sample is the dead scratch the contract excludes; anything else
 * has ESCAPED. A run that stops early reports how far it got instead.
 */
function drivenRun(candidate) {
  let lowestSp = 0xffff;
  const base = makeMachine(
    new Map([[TARGET, (m) => {
      if (m.regs.sp < lowestSp) lowestSp = m.regs.sp;
      return oracle(m);
    }]]),
  );
  const floors = recordFrameFloors(base);
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  assert.equal(base.stoppedBy, null, `the baseline itself stopped early: ${base.stoppedBy}`);

  let calls = 0;
  const opt = makeMachine(new Map([[TARGET, (m) => { calls++; return candidate(m); }]]));
  const optFrames = opt.runFrames(CORPUS_FRAMES);

  const escaped = new Set();
  const scratch = new Set();
  const compared = Math.min(baseFrames.length, optFrames.length);
  for (let f = 0; f < compared; f++) {
    const a = baseFrames[f];
    const b = optFrames[f];
    const dead = deadStackBelow({ lo: lowestSp, hi: WORK_RAM_TOP + 1 }, floors[f]); // live from the sample's SP up
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const addr = base.stateOffsetToAddr(i);
      if (dead(addr)) scratch.add(addr);
      else escaped.add(addr);
    }
  }
  return {
    escaped: [...escaped].sort((x, y) => x - y),
    scratch: [...scratch].sort((x, y) => x - y),
    stopped: opt.stoppedBy ? String(opt.stoppedBy) : null,
    reached: optFrames.length,
    compared,
    calls,
    lowestSp,
  };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("BLIND: the RAM half of the comparison cannot fail — a no-op passes it", OPTS, () => {
  const r = rawGate(() => {});
  assert.equal(
    r.ram,
    null,
    "the RAM diff CAUGHT a no-op, so this routine writes memory after all and every " +
      "live-out claim in this file must be re-derived from scratch",
  );
  console.log("  BLIND: RAM is vacuous here — the live-out half below is the whole gate");
});

test("EQUAL at the real dispatch: fetchWideTableWord == oracle on RAM and the live-out", OPTS, () => {
  const r = gate(fetchWideTableWord);
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  assert.equal(r.live, null, `the live-out diverged — ${show(r.live)}`);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");

  // Flavour three, pinned: a fetch that happened to land on the word already held would make
  // the no-op twin invisible right here. It does not.
  const at = entryState().regs;
  const before = at.de;
  const after = entryState().clone();
  fetchWideTableWord(after);
  assert.notEqual(after.regs.de, before, "the captured entry is degenerate: the fetch changes nothing");
  console.log(
    `  EQUAL: entry base ${hex4(at.hl)} index ${at.a}; ${hex4(before)} -> ${hex4(after.regs.de)}`,
  );
});

test("EXCLUDED, deliberately: the accumulator, the flags, the cursor and the stack pointer", OPTS, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  fetchWideTableWord(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(
    moved.filter((k) => !MOVED_AT_ENTRY.includes(k)),
    [],
    "a register outside the set this entry may move diverged — MOVED_AT_ENTRY is the captured " +
      "entry's subset of EXCLUDED, the cursor's high byte being idle here",
  );
  assert.ok(
    moved.every((k) => EXCLUDED.includes(k)),
    "a register outside the declared excluded set moved",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops a return address and the rewrite does not");
  assert.equal(a.regs.de, b.regs.de, "the one live-out");
  console.log(`  EXCLUDED: ${moved.join(", ")} and pc — the fetched word matches`);
});

test("EXCLUDED at a crafted carry entry: the cursor's high byte moves there too", OPTS, () => {
  // The captured entry leaves the high byte alone, so on its own it never exercises `h` in the
  // excluded set. Force both carries and the oracle increments it twice.
  const base = 0xffff;
  const index = 0xff;
  const a = entryState().clone();
  const b = entryState().clone();
  for (const m of [a, b]) {
    m.regs.hl = base;
    m.regs.a = index;
  }
  oracle(a);
  fetchWideTableWord(b);

  assert.ok(fetchAddr(base, index) < base, "the crafted base does not wrap the address space");
  assert.equal(a.regs.hl, u16(fetchAddr(base, index) + ENTRY_WIDTH), "the cursor did not land past the entry");
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.ok(moved.includes("h"), "the crafted entry did not move the cursor's high byte after all");
  assert.ok(
    moved.every((k) => EXCLUDED.includes(k)),
    "a register outside the declared excluded set moved at the crafted entry",
  );
  assert.equal(a.regs.de, b.regs.de, "the live-out must survive both carries and the wrap");
  console.log(`  EXCLUDED (carry): ${moved.join(", ")} — fetched word ${hex4(a.regs.de)} on both sides`);
});

test("EXHAUSTIVE (REAL TABLES): both real tables, every index", OPTS, () => {
  const r = replay(fetchWideTableWord, realTablePairs());
  assert.equal(r.n, 2 * INDEX_SPACE, "the real-table sweep did not cover what it claims");
  assert.equal(r.caught, 0, `diverged on ${r.caught} pair(s), first ${JSON.stringify(r.first)}`);
  assert.equal(r.wroteA, null, `the oracle wrote memory during the sweep — ${show(r.wroteA)}`);
  assert.equal(r.wroteB, null, `the rewrite wrote memory during the sweep — ${show(r.wroteB)}`);
  console.log(`  EXHAUSTIVE (REAL TABLES): ${r.n} pairs identical, no memory written by either side`);
});

test("EXHAUSTIVE (ADDRESS ARITHMETIC): every base low byte against every index", OPTS, () => {
  const pairs = arithmeticPairs();
  const doubling = pairs.filter(carriesOutOfDoubling).length;
  const lowByte = pairs.filter(carriesOutOfLowByte).length;
  assert.ok(doubling > 0 && lowByte > 0, "vacuous: the sweep reaches neither carry");
  assert.ok(
    pairs.some((p) => carriesOutOfDoubling(p) && carriesOutOfLowByte(p)),
    "vacuous: the sweep never takes both carries at once",
  );

  const r = replay(fetchWideTableWord, pairs);
  assert.equal(r.n, 256 * INDEX_SPACE, "the arithmetic sweep did not cover what it claims");
  assert.equal(r.caught, 0, `diverged on ${r.caught} pair(s), first ${JSON.stringify(r.first)}`);
  assert.equal(r.wroteA, null, `the oracle wrote memory during the sweep — ${show(r.wroteA)}`);
  assert.equal(r.wroteB, null, `the rewrite wrote memory during the sweep — ${show(r.wroteB)}`);
  console.log(
    `  EXHAUSTIVE (ADDRESS ARITHMETIC): ${r.n} pairs identical; ${doubling} carry out of the ` +
      `doubling, ${lowByte} out of the low byte`,
  );
});

test("PAGES: the base walked across every page, the port block split off by count", OPTS, () => {
  const { compared, excluded } = pagePairs();
  assert.equal(compared.length, PAGES_COMPARED, "the compared page set changed size");
  assert.equal(excluded.length, PAGES_EXCLUDED, "the excluded page set changed size");

  const r = replay(fetchWideTableWord, compared);
  assert.equal(r.caught, 0, `diverged on ${r.caught} page(s), first ${JSON.stringify(r.first)}`);
  assert.equal(r.wroteA, null, `the oracle wrote memory during the sweep — ${show(r.wroteA)}`);
  assert.equal(r.wroteB, null, `the rewrite wrote memory during the sweep — ${show(r.wroteB)}`);
  console.log(
    `  PAGES: ${r.n} pages identical with both carries forced; ${excluded.length} excluded as ` +
      "live hardware reads",
  );
});

test("CORPUS: every pair the running game presents is fetched identically", OPTS, () => {
  const pairs = corpus();
  assert.equal(pairs.length, CORPUS_DISPATCHES, "the corpus changed size — re-derive the counts below");
  const bases = new Set(pairs.map((p) => p.base));
  assert.deepEqual(
    [...bases].sort((x, y) => x - y),
    [HANDLER_TABLE, RECORD_TABLE],
    "the game passed a table this file does not know about",
  );

  const r = replay(fetchWideTableWord, pairs);
  assert.equal(r.caught, 0, `diverged on ${r.caught} real pair(s), first ${JSON.stringify(r.first)}`);

  // The two blind spots, asserted rather than assumed. Both carry arms are unreachable in real
  // play, which is exactly why the crafted sweeps above are load-bearing rather than decorative.
  assert.equal(pairs.filter(carriesOutOfDoubling).length, 0, "a real dispatch now carries out of the doubling");
  assert.equal(pairs.filter(carriesOutOfLowByte).length, 0, "a real dispatch now carries out of the low byte");
  console.log(
    `  CORPUS: ${pairs.length} real dispatches over ${CORPUS_FRAMES} frames, ` +
      `${new Set(pairs.map((p) => `${p.base}:${p.index}`)).size} distinct pairs, ` +
      `indices ${Math.min(...pairs.map((p) => p.index))}..${Math.max(...pairs.map((p) => p.index))}; ` +
      "neither carry occurs",
  );
});

// ── what dropping the stack and the clock does and does not cost ────────────────────────

test("EXPECTED DIVERGENCE (STACK): substituted as-is, the engine leaks stack and gives up", OPTS, () => {
  const r = drivenRun(fetchWideTableWord);
  assert.notEqual(
    r.stopped,
    null,
    "the driven run COMPLETED with the bare rewrite wired in. That is good news, not a " +
      "failure: the callers no longer push a return address, so the leak recorded here is " +
      "gone and this arm has outlived its purpose. Delete it.",
  );
  assert.match(
    r.stopped,
    /no routine registered/,
    "the run still stops early but for a different reason than the stale return address " +
      "this arm exists to record — re-derive before trusting the note",
  );
  assert.ok(r.reached < CORPUS_FRAMES, "a run that stopped early cannot have reached every frame");
  console.log(
    `  EXPECTED DIVERGENCE (STACK): reached frame ${r.reached} of ${CORPUS_FRAMES} after ` +
      `${r.calls} dispatches, leaking two bytes each — ${r.stopped}`,
  );
});

test("EXPECTED DIVERGENCE (RASTER): a table base in the port block is not memory", OPTS, () => {
  // One excluded page, walked across the machine's clock. The oracle spends time between its
  // two byte reads and the rewrite spends none, so wherever the raster register ticks over in
  // that gap the two disagree. This is the dropped cycle model, recorded rather than repaired.
  const { excluded } = pagePairs();
  const { base, index } = excluded[0];
  assert.ok(fetchTouchesPort(base, index), "the chosen page does not reach the port block");

  const clock = entryState().cycles;
  let diverging = 0;
  for (let phase = 0; phase < RASTER_PHASES; phase++) {
    const a = entryState().clone();
    const b = entryState().clone();
    for (const m of [a, b]) {
      m.cycles = clock + phase;
      m.regs.hl = base;
      m.regs.a = index;
    }
    oracle(a);
    fetchWideTableWord(b);
    if (a.regs.de !== b.regs.de) diverging++;
  }
  assert.equal(
    diverging,
    RASTER_DIVERGING,
    "the port-block edge moved — either the raster read changed or the rewrite's timing did",
  );
  console.log(
    `  EXPECTED DIVERGENCE (RASTER): base ${hex4(base)} fetches ${hex4(fetchAddr(base, index))}; ` +
      `${diverging} of ${RASTER_PHASES} clock phases differ`,
  );
});

test("LIVE-OUT (MEASURED): supply the return and nothing the display reads diverges", OPTS, () => {
  const r = drivenRun(substitutable(fetchWideTableWord));
  assert.equal(r.stopped, null, `the driven run stopped early even with the return supplied: ${r.stopped}`);
  assert.equal(r.compared, CORPUS_FRAMES, "the run did not reach the frames it was asked for");
  assert.equal(r.reached, CORPUS_FRAMES, "a truncated run finds nothing and must not read as a pass");
  assert.ok(r.calls > 0, "vacuous: the rewrite was never dispatched");
  assert.deepEqual(
    r.escaped.map(hex4),
    [],
    "a divergence reached memory outside the dead stack scratch — the dropped cursor, accumulator " +
      "or flags are live somewhere after all, and the excluded set is wrong",
  );
  console.log(
    `  LIVE-OUT (MEASURED): ${r.calls} dispatches over ${r.compared} frames; divergence confined ` +
      `to ${r.scratch.length} cell(s) in the stack window above ${hex4(r.lowestSp)}`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────
// Six plausible ways to get this routine wrong, aimed at four different behaviours: fetching
// at all, scaling the index, carrying the scaled index into the base, and reading a word in
// the order the hardware stores one. Each count below is measured and exact; a mismatch means
// the twin, the routine or the tables moved, and all three are worth stopping for.

/** BUG: does nothing — the tell that a gate is measuring an unreached or vacuous routine. */
function brokenNoOp() {}

/** BUG: treats the table as bytes, so every entry past the first is off by its own index. */
function brokenNotDoubled(m) {
  const { regs } = m;
  regs.de = m.mem16[u16(regs.hl + regs.a)];
}

/** BUG: scales the index but throws away the carry, so the top half of the table folds back. */
function brokenNoHighCarry(m) {
  const { regs } = m;
  regs.de = m.mem16[u16(regs.hl + ((ENTRY_WIDTH * regs.a) & 0xff))];
}

/** BUG: adds within the base's own page and never carries into the page above it. */
function brokenNoLowCarry(m) {
  const { regs } = m;
  const scaled = ENTRY_WIDTH * regs.a;
  const page = (regs.hl & 0xff00) + (scaled & 0x100);
  regs.de = m.mem16[u16(page | ((regs.hl + scaled) & 0xff))];
}

/** BUG: reads the word the other way round, so every fetched address has its halves swapped. */
function brokenByteSwapped(m) {
  const { regs } = m;
  const at = u16(regs.hl + ENTRY_WIDTH * regs.a);
  regs.de = (m.mem8[at] << 8) | m.mem8[u16(at + 1)];
}

/** BUG: fetches the entry after the one asked for — the cursor advance mistaken for the read. */
function brokenNextEntry(m) {
  const { regs } = m;
  regs.de = m.mem16[u16(regs.hl + ENTRY_WIDTH * regs.a + ENTRY_WIDTH)];
}

// caught on: the corpus, both real tables, the arithmetic sweep, the compared pages.
const TWINS = [
  { label: "no-op", fn: brokenNoOp, corpus: 600, real: 512, arith: 65536, pages: 240, atEntry: true },
  { label: "not-doubled", fn: brokenNotDoubled, corpus: 496, real: 510, arith: 65206, pages: 104, atEntry: true },
  { label: "no-high-carry", fn: brokenNoHighCarry, corpus: 0, real: 256, arith: 32768, pages: 104, atEntry: false },
  { label: "no-low-carry", fn: brokenNoLowCarry, corpus: 0, real: 268, arith: 32512, pages: 104, atEntry: false },
  { label: "byte-swapped", fn: brokenByteSwapped, corpus: 600, real: 488, arith: 61995, pages: 91, atEntry: true },
  { label: "next-entry", fn: brokenNextEntry, corpus: 600, real: 506, arith: 65152, pages: 97, atEntry: true },
];

for (const t of TWINS) {
  test(`TEETH: the ${t.label} twin, exact catch counts on every space`, OPTS, () => {
    const spaces = [
      ["corpus", corpus(), t.corpus],
      ["real-tables", realTablePairs(), t.real],
      ["arithmetic", arithmeticPairs(), t.arith],
      ["pages", pagePairs().compared, t.pages],
    ];
    const got = [];
    for (const [name, pairs, expected] of spaces) {
      const r = replay(t.fn, pairs);
      assert.equal(
        r.caught,
        expected,
        `${t.label} on the ${name} space: caught ${r.caught} of ${r.n}, expected ${expected}`,
      );
      got.push(`${name} ${r.caught}/${r.n}`);
    }
    assert.ok(
      got.some((_, i) => spaces[i][2] > 0),
      `the ${t.label} twin is caught by nothing — the gate has no teeth against it`,
    );
    console.log(`  TEETH/${t.label}: ${got.join(", ")}`);
  });

  test(`TEETH: the ${t.label} twin at the captured entry`, OPTS, () => {
    const r = gate(t.fn);
    assert.equal(r.ram, null, "RAM is vacuous, as the BLIND arm establishes");
    if (t.atEntry) {
      assert.notEqual(r.live, null, `the gate PASSED the ${t.label} twin at the real entry`);
      console.log(`  TEETH/${t.label}: caught at the entry — ${show(r.live)}`);
    } else {
      // The captured entry takes neither carry, so a carry twin cannot be seen there. Asserting
      // the blindness keeps it a measured hole rather than something a reader has to notice.
      assert.equal(
        r.live,
        null,
        `the captured entry caught the ${t.label} twin — the hole this arm documents has closed`,
      );
      console.log(`  TEETH/${t.label}: invisible at the entry, as the corpus blind spots predict`);
    }
  });
}

test("TEETH: the measured driven run catches a no-op too", OPTS, () => {
  // Without a tooth of its own, "divergence confined to the stack window" could mean the
  // driven-run comparison simply cannot see anything. It can.
  const r = drivenRun(substitutable(brokenNoOp));
  assert.ok(
    r.stopped !== null || r.escaped.length > 0,
    "the measured driven run PASSED a no-op, so its confinement result is vacuous",
  );
  console.log(
    `  TEETH/no-op: measured driven run ${r.stopped ? `stopped at frame ${r.reached}` : `escaped to ${r.escaped.slice(0, 4).map(hex4).join(" ")}`}`,
  );
});
