// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for retireBarrelAtEndOfRange (ROM 0x2104) — the object-record X limit: retire the
 * record (zero OBJ_ACTIVE and OBJ_X) when its X has run down into the bottom of the range,
 * otherwise hand it on untouched. Both arms leave for good through a still-frozen hand-off
 * target (ROM 0x1FCE above the limit, ROM 0x21BA at it), so the rewrite keeps the oracle's
 * calls to both and forwards what they return.
 *
 * WHAT IT ACTUALLY COVERS — read this before trusting a green run:
 *
 *   0. REACHABILITY — the census that decides everything below: 0x2104 is dispatched 382
 *      times in a 6000-frame attract run, on OBJ_ARRAY_67 records 0 and 1 only, with X only
 *      ever in 59..72. EVERY ONE takes the above-the-limit arm. The retire arm, the boundary
 *      values and the wrap are therefore NOT covered by attract at all and are crafted.
 *
 *   1. EQUAL (captured, inline) — every dispatch is replayed, not a sample: at each one the
 *      host clones the entry state, runs the oracle on one clone and the rewrite on another,
 *      compares, and discards. Because both hand-off targets tail back into the caller's
 *      ten-record sweep, each replay runs the REST of that sweep as well, and the comparison
 *      covers all of it. Contract: work/sprite/video RAM outside the stack scratch below the entry SP, the forwarded
 *      return value, pc and SP. pc and SP are asserted because this rewrite keeps the oracle's
 *      hand-off calls and models no stack of its own, so they legitimately hold here.
 *
 *   2. ISOLATED (captured) — the same dispatches replayed with BOTH hand-off targets replaced
 *      by stubs that log their address and return a sentinel. That cuts the sweep off after
 *      this routine, so what is compared is exactly this routine's own write set, the target
 *      it chose, and whether it forwarded the target's return value. The stubs are installed
 *      on each fresh clone (a stub does not survive clone()) and the test asserts each replay
 *      logged exactly one hand-off, so a dead stub cannot pass as a live one.
 *
 *   3. EQUAL (crafted) — thirteen X values poked onto a REAL captured entry, both sides
 *      identically: the retire arm (0, 1, 7), both sides of the limit (8, 9, 15, 16, 17), the
 *      wrap (248, 249, 255) and its far side (247), plus one natural value as a control.
 *
 *   4. TEETH — five broken twins, each of which MUST be caught, and the test records which
 *      half caught it: an inverted limit (captured), a swallowed hand-off return (isolated,
 *      captured), a dropped margin, a dropped wrap, and a retire arm that forgets to zero X
 *      (the last three reachable only from the crafted entries).
 *
 *   5. LIVE-WIRE — the rewrite wired live at 0x2104 for a whole 2000-frame attract run, with
 *      the oracle's own head instruction timing replayed per dispatch, diffed against the
 *      all-oracle baseline over the FULL state dump including STACK_SCRATCH. The dispatch
 *      count is asserted non-zero and equal to the census, so the arm cannot pass by never
 *      running. A CONTROL run without the timing replay shows the same wiring does fork,
 *      which is what makes the green run above mean something.
 *
 * NOT COVERED: attract only, plus pokes on top of attract state. No credited game, no board
 * other than 25m, and no record base other than the two attract drives.
 *
 * LIVE-OUT, DERIVED — cross-file, and therefore recorded here rather than in the routine. Exactly
 * two sites reach 0x2104, both frozen (the branch at ROM 0x20F7, and the fall-through at the end of
 * ROM 0x2101); both are tail hand-offs, so neither reads a register back — and the two hand-off
 * targets overwrite the accumulator before reading it and set their own flags before testing any,
 * which is why the residual registers and flags are dropped.
 *
 * THE GAME READING, corroborated across files and therefore recorded here: the sibling gate at ROM
 * 0x24B4, which the caller at ROM 0x2101 runs immediately before falling in here, makes the SAME
 * two writes (+0 and +3, both zero) once the record's position lands in the window it watches, and
 * then joins the same shared tail. Two independent bodies agree on the idiom. NOT CLAIMED: the
 * identity of the objects that reach here — attract only ever dispatches this on OBJ_ARRAY_67
 * records 0 and 1.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2104.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { loc_2104 as oracle } from "../../translated/loc_2104.js";
import { retireBarrelAtEndOfRange } from "../retireBarrelAtEndOfRange.js";
import { STACK_SCRATCH, OBJ_ACTIVE, OBJ_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const TARGET = 0x2104;
const TAIL_ABOVE = 0x1fce; // hand-off when the record survives the limit
const TAIL_AT = 0x21ba;    // the shared object-sprite tail, entered directly when it does not

const CAPTURE_FRAMES = 6000; // the attract window the routine header's census quotes
const LIVE_FRAMES = 2000;    // the live-wire run and its baseline

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

// -- the contract -------------------------------------------------------------

/** First differing state byte, or null. `skipStack` excludes the dead stack scratch. */
function firstDumpDiff(a, b, skipStack, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (skipStack && dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Every non-stack state address that differs between two machines. */
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (!dead(addr)) out.push(addr);
  }
  return out;
}

/**
 * Run `fn` and report a THROW as a result rather than letting it escape. A broken twin can
 * hand the frozen sweep a value that walks it off the end of a table, and a teeth run that
 * dies instead of reporting proves nothing.
 */
function guarded(fn) {
  try {
    return { threw: false, value: fn() };
  } catch (e) {
    return { threw: true, value: undefined, error: `${e.name}: ${e.message}` };
  }
}

/**
 * Both hand-off targets tail back into the caller's ten-record sweep, which dispatches
 * 0x2104 again for later records. A replay clone inherits the capturing override (clone()
 * rebuilds the routine table from the constructor's assets), so without this depth guard
 * every replay would re-enter the harness and recurse. While it is raised the hook is a
 * plain pass-through to the oracle — identical on the oracle side and the candidate side,
 * which is exactly the callee-is-oracle isolation the unit contract wants.
 */
let replayDepth = 0;
function inReplay(fn) {
  replayDepth += 1;
  try {
    return fn();
  } finally {
    replayDepth -= 1;
  }
}

/** Replay `fn` on a fresh clone of `entry`, with the sweep left LIVE. */
function replayLive(entry, fn) {
  const m = entry.clone();
  const r = inReplay(() => guarded(() => fn(m)));
  return { m, entrySp: entry.regs.sp, ...r };
}

/**
 * Replay `fn` on a fresh clone with BOTH hand-off targets stubbed, so the sweep stops here
 * and what remains is this routine's own effect. The stubs go on the CLONE, because a stub
 * installed on the entry machine is rebuilt away by clone(); the caller asserts the log is
 * non-empty, which is what proves they are live rather than silently absent.
 */
function replayIsolated(entry, fn) {
  const m = entry.clone();
  const log = [];
  m.routines.set(TAIL_ABOVE, () => { log.push("1FCE"); return "handed-off-to-1FCE"; });
  m.routines.set(TAIL_AT, () => { log.push("21BA"); return "handed-off-to-21BA"; });
  const r = inReplay(() => guarded(() => fn(m)));
  return { m, entrySp: entry.regs.sp, log, ...r };
}

/** The differences between an oracle replay and a candidate replay, as printable strings. */
function breaches(ref, cand, { skipStack = true, comparePcSp = true } = {}) {
  const out = [];
  if (ref.threw !== cand.threw) {
    out.push(`fault oracle=${ref.threw ? ref.error : "none"} cand=${cand.threw ? cand.error : "none"}`);
    return out; // the machines are not comparable once one side aborted
  }
  if (ref.threw && ref.error !== cand.error) out.push(`fault oracle=${ref.error} cand=${cand.error}`);
  const d = firstDumpDiff(ref.m, cand.m, skipStack, ref.entrySp);
  if (d) out.push(`RAM@${hx(d.addr)} oracle=${d.a} cand=${d.b}`);
  if (ref.value !== cand.value) out.push(`return oracle=${String(ref.value)} cand=${String(cand.value)}`);
  if (comparePcSp) {
    if (ref.m.pc !== cand.m.pc) out.push(`pc oracle=${hx(ref.m.pc)} cand=${hx(cand.m.pc)}`);
    if (ref.m.regs.sp !== cand.m.regs.sp) out.push(`SP oracle=${hx(ref.m.regs.sp)} cand=${hx(cand.m.regs.sp)}`);
  }
  if (ref.log && String(ref.log) !== String(cand.log)) {
    out.push(`hand-off oracle=[${ref.log}] cand=[${cand.log}]`);
  }
  return out;
}

// -- the broken twins ---------------------------------------------------------
// Each is a copy of the rewrite with ONE defect. They call the same frozen hand-off targets,
// so only the retireBarrelAtEndOfRange-level error is what diverges.

const u8 = (x) => x & 0xff;

/** Twin (a): the limit test is inverted — records above the limit are the ones retired. */
function twinInvertedLimit(m) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (u8(mem8[record + OBJ_X] + 8) < 16) return m.call(TAIL_ABOVE);
  mem8[record + OBJ_ACTIVE] = 0;
  mem8[record + OBJ_X] = 0;
  return m.call(TAIL_AT);
}

/** Twin (b): hands off correctly but swallows the hand-off's return value. */
function twinSwallowsReturn(m) {
  retireBarrelAtEndOfRange(m);
}

/** Twin (c): compares X directly against the limit, dropping the margin. */
function twinDroppedMargin(m) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (mem8[record + OBJ_X] >= 16) return m.call(TAIL_ABOVE);
  mem8[record + OBJ_ACTIVE] = 0;
  mem8[record + OBJ_X] = 0;
  return m.call(TAIL_AT);
}

/** Twin (d): keeps the margin but drops the eight-bit wrap, so an X past zero survives. */
function twinDroppedWrap(m) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (mem8[record + OBJ_X] + 8 >= 16) return m.call(TAIL_ABOVE);
  mem8[record + OBJ_ACTIVE] = 0;
  mem8[record + OBJ_X] = 0;
  return m.call(TAIL_AT);
}

/** Twin (e): retires the record but leaves its X where it died. */
function twinKeepsX(m) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (u8(mem8[record + OBJ_X] + 8) >= 16) return m.call(TAIL_ABOVE);
  mem8[record + OBJ_ACTIVE] = 0;
  return m.call(TAIL_AT);
}

// Twins replayed over the CAPTURED dispatches. The other three are unreachable from attract
// state (every real dispatch sits at X 59..72) and are exercised from the crafted entries.
const CAPTURED_TWINS = [
  { name: "inverted limit", fn: twinInvertedLimit, isolatedOnly: false },
  { name: "swallowed hand-off return", fn: twinSwallowsReturn, isolatedOnly: true },
];

// -- the attract run ----------------------------------------------------------

/**
 * ONE attract run serves every captured test. At each real dispatch it censuses the entry,
 * keeps the first clone at each record base for the crafted arms, replays the rewrite and the
 * captured twins INLINE against the oracle (live and isolated), then hands the dispatch to the
 * oracle so the host run proceeds normally. Inline replay is O(1) in memory, so every dispatch
 * is covered rather than a sample.
 */
let ATTRACT = null;
function attractRun() {
  if (ATTRACT) return ATTRACT;

  const census = { total: 0, bases: new Map(), arms: new Map(), xs: new Map(), firstFrame: null };
  const craftBases = new Map();
  const live = { real: [], ...Object.fromEntries(CAPTURED_TWINS.map((t) => [t.name, []])) };
  const iso = { real: [], ...Object.fromEntries(CAPTURED_TWINS.map((t) => [t.name, []])) };
  let isolatedReplays = 0;
  let handOffCounts = new Map();
  const returnValues = new Set();

  const hook = (mm) => {
    if (replayDepth > 0) return oracle(mm); // a nested dispatch inside a replay
    const base = mm.regs.ix;
    const x = mm.mem8[base + OBJ_X];
    const arm = u8(x + 8) >= 16 ? "above-limit" : "retire";
    census.total += 1;
    if (census.firstFrame === null) census.firstFrame = mm.frames.length;
    census.bases.set(base, (census.bases.get(base) ?? 0) + 1);
    census.arms.set(arm, (census.arms.get(arm) ?? 0) + 1);
    census.xs.set(x, (census.xs.get(x) ?? 0) + 1);
    if (!craftBases.has(base)) craftBases.set(base, mm.clone());

    const where = `dispatch ${census.total} base ${hx(base)} X ${x}`;

    // (1) the sweep left live
    const refLive = replayLive(mm, oracle);
    returnValues.add(String(refLive.value));
    for (const [key, fn] of [["real", retireBarrelAtEndOfRange], ...CAPTURED_TWINS.filter((t) => !t.isolatedOnly).map((t) => [t.name, t.fn])]) {
      const b = breaches(refLive, replayLive(mm, fn));
      if (b.length) live[key].push(`${where}: ${b.join("; ")}`);
    }

    // (2) the sweep cut off after this routine
    const refIso = replayIsolated(mm, oracle);
    isolatedReplays += 1;
    handOffCounts.set(refIso.log.length, (handOffCounts.get(refIso.log.length) ?? 0) + 1);
    for (const [key, fn] of [["real", retireBarrelAtEndOfRange], ...CAPTURED_TWINS.map((t) => [t.name, t.fn])]) {
      const b = breaches(refIso, replayIsolated(mm, fn), { comparePcSp: false });
      if (b.length) iso[key].push(`${where}: ${b.join("; ")}`);
    }

    return oracle(mm);
  };

  const host = new Machine(ROM, { overrides: new Map([[TARGET, hook]]) });
  host.runFrames(CAPTURE_FRAMES);
  ATTRACT = { census, craftBases, live, iso, isolatedReplays, handOffCounts, returnValues, host };
  return ATTRACT;
}

/** A crafted dispatch: a REAL captured entry with its record's X poked, on a fresh clone. */
function craft(entry, x) {
  const m = entry.clone();
  m.mem8[m.regs.ix + OBJ_X] = x;
  return m;
}

/** The captured entry the crafted arms sit on — a real dispatch, with its live sweep state. */
function craftBase() {
  const { craftBases } = attractRun();
  const first = [...craftBases.values()][0];
  assert.ok(first, "no real 0x2104 dispatch was captured, so nothing can be crafted from one");
  return first;
}

// The crafted X values, and what the ROM's own test says each one does. Kept as an
// independent statement of the contract — every verdict below is still a diff against the
// oracle, never against this table.
const CRAFTED = [
  { x: 0, arm: "retire" }, { x: 1, arm: "retire" }, { x: 7, arm: "retire" },
  { x: 8, arm: "above-limit" }, { x: 9, arm: "above-limit" }, { x: 15, arm: "above-limit" },
  { x: 16, arm: "above-limit" }, { x: 17, arm: "above-limit" }, { x: 59, arm: "above-limit" },
  { x: 247, arm: "above-limit" },
  { x: 248, arm: "retire" }, { x: 249, arm: "retire" }, { x: 255, arm: "retire" },
];

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: how often attract dispatches 0x2104, and on which arm", () => {
  const { census, returnValues } = attractRun();
  assert.ok(census.total > 0, "0x2104 was never dispatched — the capture harness never engaged");
  const xs = [...census.xs.keys()].sort((a, b) => a - b);
  console.log(
    `  REACHABILITY: ${census.total} dispatches in ${CAPTURE_FRAMES} attract frames, first at frame ` +
      `${census.firstFrame}; record bases ${[...census.bases].map(([b, n]) => `${hx(b)}x${n}`).join(" ")}; ` +
      `arms ${[...census.arms].map(([a, n]) => `${a}=${n}`).join(" ")}; X in ${xs[0]}..${xs[xs.length - 1]} ` +
      `(${xs.length} distinct); forwarded return values seen: ${[...returnValues].join(",")}`,
  );
  assert.ok(
    !census.arms.has("retire"),
    "attract now reaches the retire arm — the header says it does not, and must be re-derived",
  );
});

// -- 1. EQUAL (captured, sweep live) ------------------------------------------

test("EQUAL (captured): retireBarrelAtEndOfRange matches the oracle on every real attract dispatch", () => {
  const { census, live } = attractRun();
  assert.ok(census.total > 0, "no dispatch was replayed — this arm would be vacuous");
  assert.deepEqual(live.real.slice(0, 3), [], `retireBarrelAtEndOfRange diverged on ${live.real.length} of ${census.total} dispatches`);
  console.log(
    `  EQUAL/captured: all ${census.total} of ${census.total} real dispatches replayed identical ` +
      "(RAM − the stack scratch below the entry SP, forwarded return, pc and SP), each carrying the rest of the caller's sweep",
  );
});

// -- 2. ISOLATED (captured, sweep stubbed off) --------------------------------

test("ISOLATED (captured): the same dispatches, with this routine's own effect cut out", () => {
  const { census, iso, isolatedReplays, handOffCounts } = attractRun();
  assert.equal(isolatedReplays, census.total, "the isolated replay did not run at every dispatch");
  assert.deepEqual(
    [...handOffCounts.keys()],
    [1],
    `every dispatch must log exactly one hand-off; saw ${[...handOffCounts].map(([n, c]) => `${n}x${c}`).join(" ")}` +
      " — a stub that never fires would show as 0 here",
  );
  assert.deepEqual(iso.real.slice(0, 3), [], `retireBarrelAtEndOfRange diverged on ${iso.real.length} of ${census.total} dispatches`);
  console.log(
    `  ISOLATED/captured: ${isolatedReplays} replays with both hand-off targets stubbed — same target, ` +
      "same write set, same forwarded sentinel as the oracle on every one",
  );
});

// -- 3. EQUAL (crafted: the arms attract never reaches) -----------------------

test("EQUAL (crafted): the retire arm, both sides of the limit, and the wrap", () => {
  const base = craftBase();
  const record = base.regs.ix;
  const retired = [];

  for (const { x, arm } of CRAFTED) {
    const entry = craft(base, x);

    // (a) the whole sweep, as the game would run it
    const ref = replayLive(entry, oracle);
    const cand = replayLive(entry, retireBarrelAtEndOfRange);
    assert.deepEqual(breaches(ref, cand), [], `crafted X=${x}: `);

    // (b) cut off after this routine: which target, and exactly which bytes moved
    const refIso = replayIsolated(entry, oracle);
    const candIso = replayIsolated(entry, retireBarrelAtEndOfRange);
    assert.deepEqual(breaches(refIso, candIso, { comparePcSp: false }), [], `crafted X=${x} (isolated): `);

    assert.deepEqual(refIso.log, [arm === "retire" ? "21BA" : "1FCE"],
      `crafted X=${x}: the oracle took the other hand-off, so this table's arm is wrong`);

    const moved = changedAddrs(entry, candIso.m, entry.regs.sp);
    if (arm === "retire") {
      // A subset, not an equality: X is already 0 in one crafted case, so its write moves nothing.
      for (const addr of moved) {
        assert.ok(addr === record + OBJ_ACTIVE || addr === record + OBJ_X,
          `crafted X=${x}: the retire arm wrote outside the record's two fields, at ${hx(addr)}`);
      }
      assert.equal(candIso.m.mem8[record + OBJ_ACTIVE], 0, `crafted X=${x}: the record was not freed`);
      assert.equal(candIso.m.mem8[record + OBJ_X], 0, `crafted X=${x}: the record's X was not cleared`);
      retired.push(x);
    } else {
      assert.deepEqual(moved, [], `crafted X=${x}: the above-limit arm must write nothing, wrote ${moved.map(hx)}`);
    }
  }
  console.log(
    `  EQUAL/crafted: ${CRAFTED.length} poked X values on a real captured entry (record ${hx(record)}) — ` +
      `retired at X ${retired.join(",")}, handed on at the rest; write set and hand-off match the oracle`,
  );
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the two twins the captured replay must catch ARE caught", () => {
  const { census, live, iso } = attractRun();
  const inverted = live["inverted limit"];
  assert.ok(inverted.length > 0, "the inverted-limit twin escaped the captured replay — that arm proves nothing");
  const swallowed = iso["swallowed hand-off return"];
  assert.ok(swallowed.length > 0, "the swallowed-return twin escaped the isolated replay — the stubs prove nothing");
  console.log(
    `  TEETH/captured: inverted limit caught on ${inverted.length} of ${census.total} dispatches ` +
      `(${inverted[0]}); swallowed hand-off return caught on ${swallowed.length} of ${census.total} ` +
      `by the stubbed replay only (${swallowed[0]})`,
  );
});

test("TEETH: the three twins only a crafted entry can reach ARE caught", () => {
  const base = craftBase();
  const cases = [
    { name: "dropped margin", fn: twinDroppedMargin, xs: [8, 15, 248] },
    { name: "dropped wrap", fn: twinDroppedWrap, xs: [248, 255] },
    { name: "retire keeps X", fn: twinKeepsX, xs: [7, 249] },
  ];
  const report = [];
  for (const { name, fn, xs } of cases) {
    const caught = [];
    let firstBreach = null;
    for (const x of xs) {
      const entry = craft(base, x);
      const b = breaches(replayLive(entry, oracle), replayLive(entry, fn));
      if (b.length) {
        caught.push(x);
        firstBreach ??= `X=${x} ${b[0]}`;
      }
    }
    assert.ok(caught.length > 0, `the "${name}" twin escaped every crafted X in ${xs} — the gate is worthless`);
    report.push(`${name} caught at X ${caught.join(",")} (${firstBreach})`);
  }
  console.log(`  TEETH/crafted: ${report.join("; ")}`);
});

// -- 5. LIVE-WIRE -------------------------------------------------------------

/**
 * Run `frames` of attract with `candidate` wired live at 0x2104.
 *
 * `restoreTiming` replays the oracle's own head instruction timing for this dispatch, measured
 * on a throwaway clone. It is a REPLAY of the oracle's step sequence rather than a lump charge
 * so that a vblank interrupt landing inside those instructions pushes the same ROM address the
 * oracle would have pushed — that address lands on the guest stack, which this arm compares.
 *
 * Only the HEAD is priced. The rewrite calls the same frozen hand-off targets the oracle does,
 * so it already charges their whole subtree itself; charging the oracle's total on top would
 * double-count it. Both targets are STUBBED on the probe, which is also what stops the probe
 * from recursing: clone() carries this very override, and both targets tail back into the
 * caller's sweep, which dispatches 0x2104 again.
 */
function liveWire(frames, candidate, restoreTiming) {
  let dispatches = 0;
  const fn = (mm) => {
    dispatches += 1;
    if (restoreTiming) {
      const probe = mm.clone();
      const timing = [];
      const realStep = probe.step.bind(probe);
      probe.step = (addr, cycles) => { timing.push([addr, cycles]); realStep(addr, cycles); };
      probe.routines.set(TAIL_ABOVE, () => undefined);
      probe.routines.set(TAIL_AT, () => undefined);
      oracle(probe);
      for (const [addr, cycles] of timing) mm.step(addr, cycles);
    }
    return candidate(mm);
  };
  const m = new Machine(ROM, { overrides: new Map([[TARGET, fn]]) });
  const sp = recordFrameSp(m);
  const frameDumps = m.runFrames(frames);
  return { m, frameDumps, sp, dispatches };
}

/** First frame and byte where two frame traces differ, or null. Per-frame `floors` skip the scratch below them. */
function firstTraceDiff(base, other, offToAddr, floors = null) {
  for (let f = 0; f < Math.min(base.length, other.length); f++) {
    const dead = floors ? deadStackBelow(STACK_SCRATCH, floors[f]) : () => false;
    for (let i = 0; i < Math.min(base[f].length, other[f].length); i++) {
      if (base[f][i] === other[f][i]) continue;
      const addr = offToAddr(i);
      if (dead(addr)) continue;
      return { frame: f, addr, a: base[f][i], b: other[f][i] };
    }
  }
  return null;
}

test("LIVE-WIRE: wired live for a whole attract run, the rewrite leaves the oracle's trace", () => {
  const base = new Machine(ROM);
  const baseFrames = base.runFrames(LIVE_FRAMES);
  assert.equal(base.stoppedBy ?? null, null, `baseline run stopped early: ${base.stoppedBy}`);
  assert.equal(baseFrames.length, LIVE_FRAMES, "baseline did not reach every frame");

  const { m, frameDumps, dispatches } = liveWire(LIVE_FRAMES, retireBarrelAtEndOfRange, true);
  assert.equal(m.stoppedBy ?? null, null, `live-wire run stopped early: ${m.stoppedBy}`);
  assert.equal(frameDumps.length, LIVE_FRAMES, "live-wire run did not reach every frame");
  // Without this the arm can go green having never executed the routine at all.
  assert.ok(dispatches > 0, "0x2104 was never dispatched in the live run — this arm would be vacuous");
  assert.equal(dispatches, 171, "the live run's dispatch count moved; the header's census must be re-derived");

  const d = firstTraceDiff(baseFrames, frameDumps, (o) => base.stateOffsetToAddr(o));
  assert.equal(d, null, d && `frame ${d.frame} diverged at ${hx(d.addr)}: baseline=${d.a} live=${d.b}` +
    (inStack(d.addr) ? " (inside STACK_SCRATCH — this arm compares the FULL dump on purpose)" : ""));
  console.log(
    `  LIVE-WIRE: ${dispatches} dispatches over ${LIVE_FRAMES} attract frames — all ${frameDumps.length} ` +
      "frames byte-identical to the all-oracle baseline, stack scratch included",
  );
});

test("LIVE-WIRE CONTROL: without the timing replay the same wiring DOES fork", () => {
  const base = new Machine(ROM);
  const baseSp = recordFrameSp(base);
  const baseFrames = base.runFrames(LIVE_FRAMES);
  const { frameDumps, sp } = liveWire(LIVE_FRAMES, retireBarrelAtEndOfRange, false);
  const d = firstTraceDiff(baseFrames, frameDumps, (o) => base.stateOffsetToAddr(o));
  assert.notEqual(d, null, "the un-restored run matched the baseline, so the live-wire arm distinguishes nothing");
  // The first fork lands on the guest stack, which only the FULL dump sees. Demand a LIVE-cell
  // fork as well, so the control cannot be dismissed as an artifact of the excluded region.
  const live = firstTraceDiff(baseFrames, frameDumps, (o) => base.stateOffsetToAddr(o), frameFloors(baseSp, sp));
  assert.notEqual(live, null, "the un-restored run diverged only inside the stack scratch below the live SP");
  console.log(
    `  CONTROL: the un-timed run forks at frame ${d.frame}, ${hx(d.addr)} (baseline=${d.a} live=${d.b}) and ` +
      `outside the stack scratch at frame ${live.frame}, ${hx(live.addr)} (baseline=${live.a} live=${live.b}) — ` +
      "the shifted vblank, not the rewrite",
  );
});
