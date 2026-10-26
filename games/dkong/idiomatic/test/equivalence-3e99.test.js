// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_3e99 (ROM 0x3E99) — the board-1 arm of the overlap-search dispatch:
 * clear OVERLAP_COUNT, count overlaps across OBJ_ARRAY_67 (10 records) then OBJ_ARRAY_64 (5),
 * and grade the shared total into the unary code 0 / 1 / 3 / 7 — zero, one, two or three low bits
 * set, which is the form the consumer walks a bit at a time.
 *
 * WHAT THIS FILE ACTUALLY EXERCISES (no coverage claimed that is not produced by a line here):
 *
 *   0. REACHABILITY — hooks 0x3E99 in a real 6000-frame attract run and reports the count. It
 *      is NOT vacuous: the arm really is dispatched (8 times, first at frame 605). But it is
 *      also NARROW, and the test asserts that narrowness rather than glossing it: every natural
 *      dispatch arrives with the SAME bounds word (0x1308) and the same probe record (Mario's),
 *      and the totals attract produces are only 0 and 1 — so the natural traffic reaches the
 *      code-0 and code-1 arms ONLY. Codes 3 and 7, the caller's other bounds word (0x0508, the one
 *      it picks when P1_INPUT holds no horizontal direction), and any overlap found in the SECOND
 *      array are unreachable from attract and are covered by crafted entries.
 *
 *   1. EQUAL (captured) — every real dispatch replayed oracle-vs-candidate.
 *
 *   2. EQUAL (crafted) — real attract RAM with a surgical nudge, identical on both sides: all
 *      four code arms including the exactly-2 and exactly-3 boundaries, an overlap found only
 *      in the second array, a first-array hit at the LAST scanned index (pins the 10-record count
 *      and the 32-byte stride), a second-array hit at its last index (pins the 5-record count), a
 *      non-zero starting counter (pins the clear), and both bounds words over one geometry that
 *      only the wider window admits (pins the stack-passed word AND its byte order).
 *
 *   REPEATED-CALLEE COVERAGE, stated because the brief expected recursion here: 0x3E99 is NOT
 *   self-recursive — see the note below — but it does call ONE shared callee TWICE with different
 *   arguments, accumulating into a single counter. That is the structural risk this file targets:
 *   the crafted set includes overlaps in the first array only, the second array only, and one in
 *   EACH (the code-3 case), so no test passes unless both invocations run, in order, into the
 *   same counter.
 *
 * NOT SELF-RECURSIVE, verified from the ROM rather than assumed: across the whole 16KB main ROM
 * the address 0x3E99 appears exactly once, as the board-1 word of the jump table at 0x3E8D — no
 * `call`/`jp` anywhere targets it. Its only callee, 0x3EC3, is a flat counted loop containing no
 * call at all. The 0x3E99 → 0x3EC3 subtree is depth 1 and acyclic.
 *
 * CONTRACT. The dissolved arm takes the probe point/tolerances as arguments and returns { overlap }
 * by JS value with no guest-stack ops. Compared: RAM − the stack scratch below the caller frame and the overlap code (the
 * oracle leaves it in A; the candidate returns it). pc/SP are seam artifacts of the oracle's
 * per-scan call/return brackets and are not compared; the bytes those brackets leave behind land in
 * the dead STACK_SCRATCH region, which the memory compare excludes.
 *
 * The oracle's residual B / DE / IX / HL are NOT compared, and that is a claim about the ROM, not
 * a convenience: this routine's `ret` lands at 0x286E, whose `ret` lands at 0x1C23, and 0x1C23's
 * first instruction re-tests A — so the flags are dead too, and nothing reads the loop residue.
 *
 * TEETH — five broken twins, each MUST be caught:
 *   (a) skips the counter clear            -> caught in RAM at OVERLAP_COUNT
 *   (b) drops the second array's scan       -> caught in RAM at OVERLAP_COUNT
 *   (c) swaps the two bounds bytes          -> caught in RAM at OVERLAP_COUNT
 *   (d) scans 9 first-array records, not 10 -> caught in RAM at OVERLAP_COUNT
 *   (e) grades a total of 2 as 7, not 3     -> RAM is IDENTICAL; caught ONLY in the code live-out,
 *                                              which is what proves that assertion earns its place
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3e99.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3e99 as oracle } from "../../translated/loc_3e99.js";
import { loc_3e99 } from "../loc_3e99.js";
import { countObjectOverlaps } from "../countObjectOverlaps.js";
import { Machine } from "../../machine.js";
// THE OFFSET NAMESPACE, picked by what the pointer points AT. The records this arm sweeps live in
// OBJ_ARRAY_67 / OBJ_ARRAY_64 — hazard OBJECT records, not entries of the sprite buffer — so the
// five fields the search reads are the OBJ_* offsets, NOT their SPRITE_* look-alikes (SPRITE_X is
// also +0 and SPRITE_Y is also +3, which is the whole trap). Nothing here indexes a sprite record.
import {
  STACK_SCRATCH, OVERLAP_COUNT, OBJ_ARRAY_67, OBJ_ARRAY_64, MARIO_ACTIVE, MARIO_X,
  OBJ_ACTIVE, OBJ_X, OBJ_Y, OBJ_HIT_EXTENT_X, OBJ_HIT_EXTENT_Y,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3e99;
const ATTRACT_FRAMES = 6000;          // long enough to see every natural dispatch the demo produces
const SP_TOP = STACK_SCRATCH.hi;      // stack top — every crafted push lands inside STACK_SCRATCH
const RETURN_SITE = 0x286e;           // where the real dispatch returns (ROM address, kept hex)
// The probe record pointer, as the live caller sets it: Mario's record base, whose byte +0 names.js
// names MARIO_ACTIVE and whose +3 (the horizontal coordinate the search reads) is MARIO_X.
const PROBE_BASE = MARIO_ACTIVE;
const RECORD_STRIDE = 32;
const GROUP1_RECORDS = 10;
const GROUP2_RECORDS = 5;
const WIDE_BOUNDS = 0x1308;  // the bounds word attract always passes (low = vertical tolerance)
const NARROW_BOUNDS = 0x0508; // the caller's other bounds word; never seen in attract

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const POPPED_ARG = 2; // ROM opens with `pop hl`: the stacked word at entry SP is consumed, so the caller frame starts above it

/** First RAM byte that differs, skipping the stack scratch below the caller frame. { addr, a, b } | null. */
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

/** Run the ORACLE on a fresh clone; it performs its own pop / call / return churn. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

// The probe point (iy/c) and tolerance word (bounds) the dispatcher hands the arm. Crafted entries
// carry them directly; real captures derive them from the machine (bounds off the stack top, where
// the oracle's pop finds it).
function searchArgs(entry) {
  if (entry._args) return entry._args;
  const sp = entry.regs.sp;
  return { iy: entry.regs.iy, c: entry.regs.c, bounds: entry.mem.read8(sp) | (entry.mem.read8((sp + 1) & 0xffff) << 8) };
}

/**
 * Run the candidate on a fresh clone. The dissolved arm returns { overlap } by JS value and does no
 * guest-stack ops, so there is no terminal return to model. Returns the machine plus the code.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const returned = fn(c, searchArgs(entry)).overlap;
  return { c, returned };
}

/** Full contract diff: RAM − the stack scratch below the caller frame, and the overlap code (the oracle leaves it in A; the
 * candidate returns it). pc/SP are NOT compared — the dissolved arm does no guest-stack ops. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const { c, returned } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp + POPPED_ARG);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (returned !== o.regs.a) diffs.push(`code(returned) oracle=${o.regs.a} cand=${returned}`);
  return diffs;
}

/** What the oracle does with this entry: the overlap code and the final overlap tally. */
function classify(entry) {
  const o = runOracle(entry);
  return { code: o.regs.a, total: o.mem.read8(OVERLAP_COUNT) };
}

// A real attract machine so surrounding RAM is realistic; clone() neutralises the frame
// machinery (nextNmi / nextBoundary = Infinity) so the oracle's steps cannot fire an NMI.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// The five record fields the search reads.
const SEARCHED_FIELDS = [OBJ_ACTIVE, OBJ_X, OBJ_Y, OBJ_HIT_EXTENT_X, OBJ_HIT_EXTENT_Y];

// Zero those five fields in every record of both arrays, so only what a case places is active.
function clearArrays(m) {
  for (const [base, count] of [[OBJ_ARRAY_67, GROUP1_RECORDS], [OBJ_ARRAY_64, GROUP2_RECORDS]]) {
    for (let i = 0; i < count; i++) {
      const r = (base + i * RECORD_STRIDE) & 0xffff;
      for (const off of SEARCHED_FIELDS) m.mem.write8((r + off) & 0xffff, 0x00);
    }
  }
}

/** Place one record: the active flag, both coordinates, and the two per-record window widths. */
function putRecord(m, base, index, { active = true, x = 0, y = 0, xExtent = 0, yExtent = 0 }) {
  const r = (base + index * RECORD_STRIDE) & 0xffff;
  m.mem.write8((r + OBJ_ACTIVE) & 0xffff, active ? 0x01 : 0x00);
  m.mem.write8((r + OBJ_X) & 0xffff, x & 0xff);
  m.mem.write8((r + OBJ_Y) & 0xffff, y & 0xff);
  m.mem.write8((r + OBJ_HIT_EXTENT_X) & 0xffff, xExtent & 0xff);
  m.mem.write8((r + OBJ_HIT_EXTENT_Y) & 0xffff, yExtent & 0xff);
}

/**
 * Stamp a crafted 0x3E99 dispatch onto a clone of the base: the dispatcher's stack (the return
 * site under the pushed bounds word the routine pops), the probe point in registers + the probe
 * record's horizontal coordinate, a starting counter value, and the two hazard arrays.
 * `group1` / `group2` are lists of { index, ...record fields }.
 */
function craft(base, { bounds = WIDE_BOUNDS, probeY, probeX, start = 0, group1 = [], group2 = [] }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RETURN_SITE);
  m.push16(bounds);
  m.regs.iy = PROBE_BASE;
  m.regs.c = probeY & 0xff;
  m.mem.write8(MARIO_X, probeX & 0xff);
  m.mem.write8(OVERLAP_COUNT, start & 0xff);
  clearArrays(m);
  for (const { index, ...rec } of group1) putRecord(m, OBJ_ARRAY_67, index, rec);
  for (const { index, ...rec } of group2) putRecord(m, OBJ_ARRAY_64, index, rec);
  // The probe point + tolerance word the dispatcher hands the idiomatic arm.
  m._args = { iy: PROBE_BASE, c: probeY & 0xff, bounds };
  return m;
}

// Realistic probe coordinates, and a record sitting exactly on it (distance 0 on both axes ->
// inside any non-degenerate window).
const PY = 0x64, PX = 0x80;
const onProbe = (index) => ({ index, x: PX, y: PY });

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x3E99 is dispatched in attract, but only into the code-0 / code-1 arms", () => {
  const seen = [];
  const snap = new Map([[TARGET, (mm) => {
    const sp = mm.regs.sp;
    const bounds = (mm.mem.read8(sp) | (mm.mem.read8((sp + 1) & 0xffff) << 8)) & 0xffff;
    const iy = mm.regs.iy;
    const r = oracle(mm);
    seen.push({ bounds, iy, code: mm.regs.a });
    return r;
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(ATTRACT_FRAMES);

  assert.ok(seen.length > 0, "0x3E99 should be dispatched — the 25m overlap search runs in the demo");

  const codes = [...new Set(seen.map((s) => s.code))].sort();
  const boundsSeen = [...new Set(seen.map((s) => s.bounds))];
  // The header claims codes 3 and 7 and the 0x0508 bounds word are crafted-only. Assert exactly
  // that, so the claim cannot rot silently into an overstatement.
  assert.deepEqual(codes, [0, 1], `attract reached overlap codes ${codes.join("/")} — the header's "crafted-only for 3 and 7" claim is stale`);
  assert.deepEqual(boundsSeen, [WIDE_BOUNDS], `attract passed bounds ${boundsSeen.map(hx).join("/")} — the header's single-bounds claim is stale`);

  console.log(`  REACHABILITY: ${seen.length} natural 0x3E99 dispatches in ${ATTRACT_FRAMES} frames; ` +
    `codes {${codes.join(",")}}, bounds {${boundsSeen.map(hx).join(",")}} — codes 3/7 and bounds ${hx(NARROW_BOUNDS)} are crafted-only`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_3e99 == oracle on every real 0x3E99 dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(ATTRACT_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x3E99 dispatch during attract");

  const tally = new Map();
  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_3e99);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    const { code } = classify(entry);
    tally.set(code, (tally.get(code) ?? 0) + 1);
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical (codes ${[...tally].map(([k, v]) => `${k}×${v}`).join(" ")})`);
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): all four code arms, both arrays, both bounds words", () => {
  const base = attractBase();

  const cases = [
    {
      name: "no overlaps -> code 0",
      opts: { probeY: PY, probeX: PX, group1: [{ index: 0, active: false, x: PX, y: PY }] },
      total: 0, code: 0,
    },
    {
      name: "one overlap in the FIRST array -> code 1",
      opts: { probeY: PY, probeX: PX, group1: [onProbe(0)] },
      total: 1, code: 1,
    },
    {
      name: "one overlap in the SECOND array only -> code 1 (proves the second scan runs)",
      opts: { probeY: PY, probeX: PX, group2: [onProbe(0)] },
      total: 1, code: 1,
    },
    {
      name: "one overlap in EACH array -> total 2 -> code 3 (the shared counter spans both scans)",
      opts: { probeY: PY, probeX: PX, group1: [onProbe(0)], group2: [onProbe(0)] },
      total: 2, code: 3,
    },
    {
      name: "exactly 3 overlaps -> code 7 (the <3 boundary)",
      opts: { probeY: PY, probeX: PX, group1: [onProbe(0), onProbe(1)], group2: [onProbe(0)] },
      total: 3, code: 7,
    },
    {
      name: "many overlaps (5) -> code 7",
      opts: {
        probeY: PY, probeX: PX,
        group1: [onProbe(0), onProbe(1), onProbe(2)],
        group2: [onProbe(0), onProbe(1)],
      },
      total: 5, code: 7,
    },
    {
      name: "first-array hit at the LAST scanned index 9 (pins the 10-record count + 32-byte stride)",
      opts: { probeY: PY, probeX: PX, group1: [onProbe(9)] },
      total: 1, code: 1,
    },
    {
      name: "second-array hit at the LAST scanned index 4 (pins the 5-record count)",
      opts: { probeY: PY, probeX: PX, group2: [onProbe(4)] },
      total: 1, code: 1,
    },
    {
      name: "counter starts at 9 and is cleared first -> total 1, code 1",
      opts: { probeY: PY, probeX: PX, start: 9, group1: [onProbe(0)] },
      total: 1, code: 1,
    },
    {
      name: "inactive records are skipped even when they sit on the probe",
      opts: {
        probeY: PY, probeX: PX,
        group1: [{ index: 0, active: false, x: PX, y: PY }, onProbe(1)],
        group2: [{ index: 0, active: false, x: PX, y: PY }],
      },
      total: 1, code: 1,
    },
  ];

  for (const { name, opts, total, code } of cases) {
    const entry = craft(base, opts);
    const k = classify(entry);
    // Non-vacuity: the ORACLE really produced the arm this case is named for.
    assert.equal(k.total, total, `${name}: oracle tallied ${k.total}, expected ${total}`);
    assert.equal(k.code, code, `${name}: oracle graded ${k.code}, expected ${code}`);
    const diffs = contractDiffs(entry, loc_3e99);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (codes 0/1/3/7, both arrays, last indices, counter clear, inactive skip) identical`);
});

test("EQUAL (crafted): the stack-passed bounds word decides the verdict, byte order and all", () => {
  const base = attractBase();
  // A record 8 pixels off the probe HORIZONTALLY, with no per-record horizontal window. The wide
  // bounds word's high byte (0x13) admits it; the narrow one's (0x05) does not. Both share the
  // same low byte (0x08), so ONLY the high byte moves — which is what makes this sensitive to the
  // byte order as well as to the pop itself.
  const rec = [{ index: 0, x: (PX + 8) & 0xff, y: PY, xExtent: 0, yExtent: 0 }];

  const wide = craft(base, { bounds: WIDE_BOUNDS, probeY: PY, probeX: PX, group1: rec });
  const narrow = craft(base, { bounds: NARROW_BOUNDS, probeY: PY, probeX: PX, group1: rec });

  const kw = classify(wide), kn = classify(narrow);
  assert.notEqual(kw.code, kn.code, "the bounds change did not flip the verdict — this case is not exercising the hand-off");

  for (const [label, entry] of [["wide 0x1308", wide], ["narrow 0x0508", narrow]]) {
    const diffs = contractDiffs(entry, loc_3e99);
    assert.equal(diffs.length, 0, `${label}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/bounds: wide -> code ${kw.code}, narrow -> code ${kn.code}; both identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

// The correct grading ladder, shared by the twins so each twin breaks exactly one thing.
function grade(total) {
  if (total === 0) return 0;
  if (total === 1) return 1;
  return total < 3 ? 3 : 7;
}

function scan(m, objectBase, count, probe) {
  countObjectOverlaps(m, { ...probe, objectBase, count });
}

function probeOf(iy, c, bounds) {
  return {
    probeBase: iy,
    probeA: c,
    stride: RECORD_STRIDE,
    threshA: bounds & 0xff,
    threshB: bounds >> 8,
  };
}

/** Twin (a): never clears the shared counter. */
function brokenNoClear(m, { iy, c, bounds }) {
  const probe = probeOf(iy, c, bounds);
  scan(m, OBJ_ARRAY_67, GROUP1_RECORDS, probe);
  scan(m, OBJ_ARRAY_64, GROUP2_RECORDS, probe);
  return { overlap: grade(m.mem.read8(OVERLAP_COUNT)) };
}

/** Twin (b): scans only the first array. */
function brokenSingleGroup(m, { iy, c, bounds }) {
  const probe = probeOf(iy, c, bounds);
  m.mem.write8(OVERLAP_COUNT, 0);
  scan(m, OBJ_ARRAY_67, GROUP1_RECORDS, probe);
  return { overlap: grade(m.mem.read8(OVERLAP_COUNT)) };
}

/** Twin (c): reads the bounds word's two tolerance bytes the wrong way round. */
function brokenSwappedBounds(m, { iy, c, bounds }) {
  const probe = {
    probeBase: iy,
    probeA: c,
    stride: RECORD_STRIDE,
    threshA: bounds >> 8,
    threshB: bounds & 0xff,
  };
  m.mem.write8(OVERLAP_COUNT, 0);
  scan(m, OBJ_ARRAY_67, GROUP1_RECORDS, probe);
  scan(m, OBJ_ARRAY_64, GROUP2_RECORDS, probe);
  return { overlap: grade(m.mem.read8(OVERLAP_COUNT)) };
}

/** Twin (d): scans 9 first-array records instead of 10. */
function brokenShortFirstScan(m, { iy, c, bounds }) {
  const probe = probeOf(iy, c, bounds);
  m.mem.write8(OVERLAP_COUNT, 0);
  scan(m, OBJ_ARRAY_67, GROUP1_RECORDS - 1, probe);
  scan(m, OBJ_ARRAY_64, GROUP2_RECORDS, probe);
  return { overlap: grade(m.mem.read8(OVERLAP_COUNT)) };
}

/** Twin (e): grades a total of 2 as 7 instead of 3 — RAM stays IDENTICAL. */
function brokenLadder(m, { iy, c, bounds }) {
  const probe = probeOf(iy, c, bounds);
  m.mem.write8(OVERLAP_COUNT, 0);
  scan(m, OBJ_ARRAY_67, GROUP1_RECORDS, probe);
  scan(m, OBJ_ARRAY_64, GROUP2_RECORDS, probe);
  const total = m.mem.read8(OVERLAP_COUNT);
  const code = total === 0 ? 0 : total === 1 ? 1 : 7; // BUG: the exactly-2 step is gone
  return { overlap: code };
}

test("TEETH: five broken twins are CAUGHT — four in RAM, the ladder twin only in the live-out", () => {
  const base = attractBase();
  const caught = [];

  const cases = [
    {
      name: "(a) no counter clear",
      twin: brokenNoClear,
      entry: craft(base, { probeY: PY, probeX: PX, start: 9, group1: [onProbe(0)] }),
      at: OVERLAP_COUNT,
    },
    {
      name: "(b) second array not scanned",
      twin: brokenSingleGroup,
      entry: craft(base, { probeY: PY, probeX: PX, group2: [onProbe(0)] }),
      at: OVERLAP_COUNT,
    },
    {
      name: "(c) bounds bytes swapped",
      twin: brokenSwappedBounds,
      // Off by 8 horizontally with no per-record window: admitted by the 0x13 horizontal
      // tolerance, rejected by the 0x08 vertical one, so swapping the bytes flips the verdict.
      entry: craft(base, { probeY: PY, probeX: PX, group1: [{ index: 0, x: (PX + 8) & 0xff, y: PY }] }),
      at: OVERLAP_COUNT,
    },
    {
      name: "(d) first scan 9 records, not 10",
      twin: brokenShortFirstScan,
      entry: craft(base, { probeY: PY, probeX: PX, group1: [onProbe(9)] }),
      at: OVERLAP_COUNT,
    },
  ];

  for (const { name, twin, entry, at } of cases) {
    const diffs = contractDiffs(entry, twin);
    assert.ok(diffs.length > 0, `${name} escaped — the gate is worthless`);
    assert.ok(diffs[0].startsWith(`RAM@${hx(at)}`), `${name}: expected the diff at ${hx(at)}, got ${diffs[0]}`);
    caught.push(`${name}: ${diffs[0]}`);
  }

  // (e) is the one that proves the LIVE-OUT assertion earns its place: the twin writes exactly the
  // same RAM as the correct routine and differs only in the graded code.
  const ladderEntry = craft(base, { probeY: PY, probeX: PX, group1: [onProbe(0)], group2: [onProbe(0)] });
  assert.equal(classify(ladderEntry).code, 3, "sanity: this entry must be the exactly-2 case the ladder twin mis-grades");
  const ladderDiffs = contractDiffs(ladderEntry, brokenLadder);
  assert.ok(ladderDiffs.length > 0, "(e) ladder twin escaped — the gate is worthless");
  assert.ok(
    ladderDiffs.every((d) => !d.startsWith("RAM@")),
    `(e) should be invisible in RAM (that is the point of the case), got ${ladderDiffs.join("; ")}`,
  );
  assert.ok(ladderDiffs[0].startsWith("code("), `(e): expected the diff in the overlap code, got ${ladderDiffs[0]}`);
  caught.push(`(e) exactly-2 graded 7: ${ladderDiffs.join("; ")}`);

  console.log("  TEETH: " + caught.join(" | "));
});
