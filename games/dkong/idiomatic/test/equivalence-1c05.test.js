// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1c05 (ROM 0x1C05) — the airborne-frame resolver: run the descent
 * probe, then take one of four tails (settle the landing / re-run the fall-height test /
 * carry on as an ordinary airborne frame / arm the fall-height test and run the object-overlap
 * search).
 *
 * WHAT THIS GATE ACTUALLY COVERS, stated plainly:
 *
 *   1. REALISM (captured, ATTRACT ONLY). 0x1C05 is richly reachable without input: hooking it
 *      through a plain 6000-frame attract run captures 360 real dispatches, and all four tails
 *      fire there. The replay is SAMPLED — every 20th capture, plus the first at each distinct
 *      entry shape (board / land-check / airborne-frame count), plus the first of each observed
 *      tail chain — and the test asserts in-test that the sample covers every shape and every
 *      chain it saw, so the sampling cannot silently drop an arm. The counts it replayed are
 *      printed by the run. Credited gameplay, the other three boards in PLAY, and two-player
 *      are NOT covered by this part; boards 2/3/4 are reached only by the crafted arm below.
 *
 *   2. DISSOLVED-FORM NOTE. loc_1c05 was dissolved: `m.push16(0x1c08); m.call(0x2b1c)` became a
 *      direct `loc_2b1c(m)` call (and the overlap search's bracket likewise fell away). A stub
 *      installed at ROM 0x2B1C is therefore BYPASSED by the candidate, which no longer dispatches
 *      through the seam. The old crafted arm that swept all 256 synthetic verdict bytes through such
 *      a stub is RETIRED — the real loc_2b1c produces only real verdicts, so the sweep cannot run
 *      stub-free — and is backstopped by the REALISM arm and the TEETH verdict twin (see its note).
 *
 *   3. EQUAL (crafted, STUB-FREE). One crafted arm survives, made stub-free: a real trigger-frame
 *      capture (the one attract takes down the overlap tail) is driven on boards 2, 3 and 4, whose
 *      per-board overlap arms attract never dispatches from here. Both sides run the real descent
 *      probe and the real overlap search; equivalence proves the candidate drives each board's arm
 *      as the oracle does, and a delegating counter over the oracle's own run confirms each board
 *      reached the 0x2853 search (non-vacuity).
 *
 *   4. TEETH — five broken twins, each of which the suite MUST catch:
 *      (a) verdict predicate off by one (0 selects the landing tail, not 1).
 *      (b) trigger frame off by one (21 instead of 20).
 *      (c) dropped land-check arm.
 *      (d) dropped ITEM_COLLECTED latch.
 *      (e) inverted severity test.
 *
 * CONTRACT. RAM MINUS the stack scratch below the entry SP [0x6BE0,0x6C00), plus the propagated return value. The oracle's
 * two call brackets (the descent probe's and the overlap search's) land in that dead stack region,
 * and the REALISM arm asserts at least one real dispatch differs ONLY inside it, so the exclusion is
 * load-bearing rather than decorative. The dissolved candidate opens no guest bracket of its own —
 * it calls loc_2b1c and every tail directly — so pc and SP are NOT part of this contract (they were
 * compared only under the old seam form, which owned a live bracket); the whole-game SP tests guard
 * SP-correctness. The result register is likewise not asserted — it differs on every dispatch, the
 * measurement behind the routine's memory-only live-out.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1c05.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1c05 as oracle } from "../../translated/loc_1c05.js";
import { loc_2853 } from "../../translated/loc_2853.js";
import { loc_1c05 } from "../loc_1c05.js";
import { loc_1c33 } from "../loc_1c33.js";
import { loc_1c3a } from "../loc_1c3a.js";
import { markFatalFallByHeight } from "../markFatalFallByHeight.js";
import { searchPlayerObjectOverlap } from "../searchPlayerObjectOverlap.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine, resolveAllIdiomatic } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  STACK_SCRATCH,
  BOARD,
  EFFECT_SELECT,
  EFFECT_STATE,
  ITEM_COLLECTED,
  MARIO_AIR_FRAMES,
  MARIO_AIR_LANDCHECK,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1c05;
const DESCENT_PROBE = 0x2b1c; // still the frozen oracle; the TEETH twins keep the `m.call` seam to it
const OVERLAP_SEARCH = 0x2853; // the per-board overlap-search trampoline the trigger frame dispatches
const ATTRACT_FRAMES = 6000;
const LAND_CHECK_TRIGGER_FRAME = 20;

// The per-board object-overlap arms (BOARD_OVERLAP_DISPATCH_TABLE @0x3e8d), all wired idiomatic in the
// shipping config. The candidate below dispatches them IDIOMATICALLY so its guest stack matches the
// shipping game: idiomatic loc_1c05 opens no guest bracket around the overlap search because these arms
// return via JS (not a guest `ret`). Running them as the frozen oracle here — the mixed world the
// capture hook alone produces — would demand a bracket the shipping game never needs. The oracle side
// keeps the frozen arms (its own `ret` closes its own push), so this stays a faithful reference compare.
const OVERLAP_ARMS = [0x3e99, 0x28b0, 0x28e0, 0x2901];
const SHIP = ROM_PRESENT ? await resolveAllIdiomatic() : null;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- diff plumbing ------------------------------------------------------------

/** First RAM byte that differs, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** First RAM byte that differs INCLUDING the stack — proves the exclusion is load-bearing. */
function firstAnyRamDiff(a, b) {
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] !== db[i]) return { addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone; it performs its own terminal `ret`. */
function runOracle(entry, prep) {
  const c = entry.clone();
  if (prep) prep(c);
  const value = oracle(c);
  return { c, value };
}

/**
 * Run a candidate on a fresh clone. The dissolved loc_1c05 calls loc_2b1c and every tail DIRECTLY
 * and opens no guest-stack bracket of its own, so there is no terminal `ret` to model and pc/SP are
 * not part of the contract (the whole-game SP tests guard SP-correctness).
 */
function runCandidate(entry, fn, prep) {
  const c = entry.clone();
  // Shipping model: the overlap arms run idiomatic (they return via JS, opening no guest bracket), so
  // the candidate's dispatch matches the live game rather than the capture's oracle-arm mixed world.
  for (const addr of OVERLAP_ARMS) c.routines.set(addr, SHIP.get(addr));
  if (prep) prep(c);
  const value = fn(c);
  return { c, value };
}

/**
 * Contract diff: RAM − the stack scratch below the entry SP and the propagated return value. pc and SP are seam artifacts of
 * the oracle's guest-stack splice (its two call brackets land in the excluded STACK_SCRATCH) and the
 * dissolved candidate owns no bracket, so they are NOT compared — the whole-game SP tests are what
 * guard SP-correctness now.
 */
function contractDiffs(entry, fn, prep) {
  const o = runOracle(entry, prep);
  const k = runCandidate(entry, fn, prep);
  const diffs = [];
  const ram = firstRamDiff(o.c, k.c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.value !== k.value) diffs.push(`return oracle=${String(o.value)} cand=${String(k.value)}`);
  return diffs;
}

// -- capture, classify, sample ------------------------------------------------

/** Hook 0x1C05 through a plain attract run and clone the machine at every dispatch. */
function captureAttractDispatches(frames = ATTRACT_FRAMES) {
  const caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(frames);
  return caps;
}

// The five tail targets the routine can reach, in the order the ROM tests them.
const TAIL_NAMES = [
  [0x1c3a, "landing"],
  [0x1c76, "fallHeight"],
  [0x1c33, "ordinary"],
  [0x2853, "overlap"],
  [0x1da6, "spriteTail"],
];

/** Which chain of tails the ORACLE takes from this entry, e.g. "overlap+ordinary+spriteTail". */
function tailChain(entry) {
  const c = entry.clone();
  const seen = [];
  for (const [addr, name] of TAIL_NAMES) {
    const base = c.routines.get(addr);
    c.routines.set(addr, (mm, ...args) => {
      if (!seen.includes(name)) seen.push(name);
      return base(mm, ...args);
    });
  }
  oracle(c);
  return seen.join("+");
}

/** Entry shape: what a reader can see about the dispatch before it runs. */
const entryShape = (m) =>
  `board=${m.mem.read8(BOARD)} landcheck=${m.mem.read8(MARIO_AIR_LANDCHECK)} air=${m.mem.read8(MARIO_AIR_FRAMES)}`;

/**
 * The sampling policy: every 20th capture, PLUS the first at each distinct entry shape, PLUS
 * the first of each observed tail chain (without which a rare arm — the overlap search's
 * nonzero-severity path, 2 of 360 — shares its entry shape with a common one and would be
 * dropped by the sample).
 */
function sample(caps, chains) {
  const picked = new Set();
  const shapeSeen = new Set(), chainSeen = new Set();
  for (let i = 0; i < caps.length; i++) {
    const shape = entryShape(caps[i]);
    let take = i % 20 === 0;
    if (!shapeSeen.has(shape)) { shapeSeen.add(shape); take = true; }
    if (!chainSeen.has(chains[i])) { chainSeen.add(chains[i]); take = true; }
    if (take) picked.add(i);
  }
  return [...picked].sort((a, b) => a - b);
}

// -- 1. REALISM (captured, attract only) --------------------------------------

test("REALISM: real captured 0x1C05 attract dispatches — loc_1c05 matches the oracle chain", () => {
  const caps = captureAttractDispatches();
  assert.ok(caps.length >= 1, "expected at least one real 0x1C05 dispatch during attract");

  const chains = caps.map(tailChain);
  const idx = sample(caps, chains);

  const allShapes = new Set(caps.map(entryShape));
  const allChains = new Set(chains);
  const sampledShapes = new Set(idx.map((i) => entryShape(caps[i])));
  const sampledChains = new Set(idx.map((i) => chains[i]));
  for (const s of allShapes) assert.ok(sampledShapes.has(s), `sample dropped entry shape "${s}"`);
  for (const t of allChains) assert.ok(sampledChains.has(t), `sample dropped tail chain "${t}"`);

  // All four tails must actually be present in a plain attract run — if the demo ever stops
  // reaching one, this gate must say so instead of quietly narrowing.
  for (const want of ["landing", "fallHeight", "ordinary", "overlap"]) {
    assert.ok([...allChains].some((t) => t.startsWith(want)), `attract never took the "${want}" tail`);
  }

  let stackOnly = 0;
  for (const i of idx) {
    const diffs = contractDiffs(caps[i], loc_1c05);
    assert.equal(diffs.length, 0, `captured dispatch #${i} (${entryShape(caps[i])}): ${diffs.join("; ")}`);
    // Load-bearing STACK_SCRATCH exclusion: the oracle's brackets leave bytes there that the
    // JS-call-stack rewrite never writes.
    const o = runOracle(caps[i]), k = runCandidate(caps[i], loc_1c05);
    const any = firstAnyRamDiff(o.c, k.c);
    if (any && deadStackBelow(STACK_SCRATCH, caps[i].regs.sp)(any.addr)) stackOnly++;
  }
  assert.ok(stackOnly > 0, "no replayed dispatch differed only inside the stack scratch below the entry SP — the exclusion would be vacuous");

  const perChain = [...allChains].map((t) => `${t}=${chains.filter((x) => x === t).length}`).join(", ");
  console.log(`  REALISM: ${idx.length} of ${caps.length} real 0x1C05 dispatches replayed (${ATTRACT_FRAMES} attract frames), ` +
    `${sampledShapes.size} of ${allShapes.size} entry shapes, ${sampledChains.size} of ${allChains.size} tail chains; ` +
    `chain counts over all captures: ${perChain}; ${stackOnly} replays differed ONLY in STACK_SCRATCH`);
});

// -- 2. EQUAL (crafted, all 256 verdicts) — RETIRED as a real-candidate arm ----
//
// This arm swept all 256 descent-probe verdict bytes and both object-counter arms by STUBBING the
// descent probe at 0x2B1C (`regs.a = verdict; regs.b = counter`) on both sides. The dissolved
// loc_1c05 no longer does `m.push16(0x1c08); m.call(0x2b1c)` — it calls loc_2b1c DIRECTLY — so a stub
// installed at 0x2B1C is BYPASSED by the candidate and its synthetic verdicts can no longer be
// injected into it. The real loc_2b1c yields only the verdicts real descent physics produces, so the
// 256-value sweep cannot be reproduced stub-free.
//
// The property it guarded — verdict 1 selects the landing-settle tail, every other value does not —
// is backstopped two ways: the REALISM arm exercises the verdicts the real probe actually produces
// (all four tails, the landing included, fire in a plain attract run and are asserted present), and
// the TEETH "verdict predicate off by one" twin, still written `m.call(0x2b1c)`, keeps the seam and
// is caught on a real landing capture.

// -- 3. EQUAL (crafted): boards 2/3/4 — STUB-FREE ------------------------------

test("EQUAL (crafted): the trigger frame on boards 2, 3 and 4 matches the oracle — stub-free", () => {
  const caps = captureAttractDispatches();
  const chains = caps.map(tailChain);
  const idx = chains.findIndex((t) => t.startsWith("overlap"));
  assert.ok(idx >= 0, "attract never took the overlap tail — no real trigger frame to craft from");
  const trigger = caps[idx]; // a real trigger frame (air==20, landcheck==0, natural non-landing verdict)

  for (const board of [2, 3, 4]) {
    const setBoard = (m) => m.mem.write8(BOARD, board);

    // STUB-FREE: both sides run the real descent probe (loc_2b1c) and the real per-board overlap
    // search; equivalence proves the dissolved candidate drives board `board`'s overlap arm exactly
    // as the oracle does. (There is no 0x2B1C stub to bypass — the candidate calls loc_2b1c directly.)
    const diffs = contractDiffs(trigger, loc_1c05, setBoard);
    assert.equal(diffs.length, 0, `board ${board}: ${diffs.join("; ")}`);

    // Non-vacuity, via a delegating counter over the ORACLE's own run: prove the trigger frame really
    // armed the fall-height test and dispatched THIS board's overlap search (0x2853), rather than
    // taking an earlier tail. The 0x2853 override records the board, then delegates to the frozen
    // loc_2853 so the run stays faithful.
    const reached = [];
    const probe = runOracle(trigger, (m) => {
      setBoard(m);
      m.routines.set(OVERLAP_SEARCH, (mm) => { reached.push(board); return loc_2853(mm); });
    }).c;
    assert.ok(reached.length > 0, `board ${board}: the oracle never dispatched the overlap search`);
    assert.equal(probe.mem.read8(MARIO_AIR_LANDCHECK), 1, `board ${board}: the trigger frame must arm the fall-height test`);
  }
  console.log("  EQUAL/crafted: boards 2/3/4 drive their own overlap-search arms identically (stub-free; " +
    "a delegating counter confirms each board reached the 0x2853 search)");
});

// -- 4. TEETH ------------------------------------------------------------------

/** Broken twin (a): the verdict predicate off by one — 0 selects the landing tail. */
function brokenVerdictPredicate(m) {
  const { regs, mem8 } = m;
  m.push16(0x1c08);
  m.call(DESCENT_PROBE);
  const probeVerdict = regs.a;
  regs.a = u8(probeVerdict - 1);
  if (probeVerdict === 0) return loc_1c3a(m); // BUG: 1 selects the landing tail, not 0
  if (mem8[MARIO_AIR_LANDCHECK] === 1) return markFatalFallByHeight(m);
  const framesToTrigger = u8(mem8[MARIO_AIR_FRAMES] - LAND_CHECK_TRIGGER_FRAME);
  if (framesToTrigger !== 0) { regs.a = framesToTrigger; return loc_1c33(m); }
  mem8[MARIO_AIR_LANDCHECK] = 1;
  const severity = searchPlayerObjectOverlap(m);
  if (severity === 0) return writeMarioSpriteRecord(m);
  mem8[EFFECT_SELECT] = severity;
  mem8[EFFECT_STATE] = 1;
  mem8[ITEM_COLLECTED] = 1;
  regs.a = 1;
  return loc_1c33(m);
}

/** Broken twin (b): the trigger frame off by one — 21 instead of 20. */
function brokenTriggerFrame(m) {
  const { regs, mem8 } = m;
  m.push16(0x1c08);
  m.call(DESCENT_PROBE);
  const probeVerdict = regs.a;
  regs.a = u8(probeVerdict - 1);
  if (probeVerdict === 1) return loc_1c3a(m);
  if (mem8[MARIO_AIR_LANDCHECK] === 1) return markFatalFallByHeight(m);
  const framesToTrigger = u8(mem8[MARIO_AIR_FRAMES] - 21); // BUG: the trigger frame is 20
  if (framesToTrigger !== 0) { regs.a = framesToTrigger; return loc_1c33(m); }
  mem8[MARIO_AIR_LANDCHECK] = 1;
  const severity = searchPlayerObjectOverlap(m);
  if (severity === 0) return writeMarioSpriteRecord(m);
  mem8[EFFECT_SELECT] = severity;
  mem8[EFFECT_STATE] = 1;
  mem8[ITEM_COLLECTED] = 1;
  regs.a = 1;
  return loc_1c33(m);
}

/** Broken twin (c): never arms the fall-height check. */
function brokenNoLandCheckArm(m) {
  const { regs, mem8 } = m;
  m.push16(0x1c08);
  m.call(DESCENT_PROBE);
  const probeVerdict = regs.a;
  regs.a = u8(probeVerdict - 1);
  if (probeVerdict === 1) return loc_1c3a(m);
  if (mem8[MARIO_AIR_LANDCHECK] === 1) return markFatalFallByHeight(m);
  const framesToTrigger = u8(mem8[MARIO_AIR_FRAMES] - LAND_CHECK_TRIGGER_FRAME);
  if (framesToTrigger !== 0) { regs.a = framesToTrigger; return loc_1c33(m); }
  // BUG: MARIO_AIR_LANDCHECK never armed
  const severity = searchPlayerObjectOverlap(m);
  if (severity === 0) return writeMarioSpriteRecord(m);
  mem8[EFFECT_SELECT] = severity;
  mem8[EFFECT_STATE] = 1;
  mem8[ITEM_COLLECTED] = 1;
  regs.a = 1;
  return loc_1c33(m);
}

/** Broken twin (d): drops the pickup flag the landing code consumes. */
function brokenNoItemLatch(m) {
  const { regs, mem8 } = m;
  m.push16(0x1c08);
  m.call(DESCENT_PROBE);
  const probeVerdict = regs.a;
  regs.a = u8(probeVerdict - 1);
  if (probeVerdict === 1) return loc_1c3a(m);
  if (mem8[MARIO_AIR_LANDCHECK] === 1) return markFatalFallByHeight(m);
  const framesToTrigger = u8(mem8[MARIO_AIR_FRAMES] - LAND_CHECK_TRIGGER_FRAME);
  if (framesToTrigger !== 0) { regs.a = framesToTrigger; return loc_1c33(m); }
  mem8[MARIO_AIR_LANDCHECK] = 1;
  const severity = searchPlayerObjectOverlap(m);
  if (severity === 0) return writeMarioSpriteRecord(m);
  mem8[EFFECT_SELECT] = severity;
  mem8[EFFECT_STATE] = 1;
  // BUG: ITEM_COLLECTED never latched
  regs.a = 1;
  return loc_1c33(m);
}

/** Broken twin (e): inverted severity test — latches on a miss, tails out on a hit. */
function brokenInvertedSeverity(m) {
  const { regs, mem8 } = m;
  m.push16(0x1c08);
  m.call(DESCENT_PROBE);
  const probeVerdict = regs.a;
  regs.a = u8(probeVerdict - 1);
  if (probeVerdict === 1) return loc_1c3a(m);
  if (mem8[MARIO_AIR_LANDCHECK] === 1) return markFatalFallByHeight(m);
  const framesToTrigger = u8(mem8[MARIO_AIR_FRAMES] - LAND_CHECK_TRIGGER_FRAME);
  if (framesToTrigger !== 0) { regs.a = framesToTrigger; return loc_1c33(m); }
  mem8[MARIO_AIR_LANDCHECK] = 1;
  const severity = searchPlayerObjectOverlap(m);
  if (severity !== 0) return writeMarioSpriteRecord(m); // BUG: inverted
  mem8[EFFECT_SELECT] = severity;
  mem8[EFFECT_STATE] = 1;
  mem8[ITEM_COLLECTED] = 1;
  regs.a = 1;
  return loc_1c33(m);
}

test("TEETH: five broken twins are all CAUGHT on real captured dispatches", () => {
  const caps = captureAttractDispatches();
  const chains = caps.map(tailChain);

  const at = (prefix) => {
    const i = chains.findIndex((t) => t.startsWith(prefix));
    assert.ok(i >= 0, `no captured dispatch took the "${prefix}" tail`);
    return caps[i];
  };
  const hitIdx = chains.findIndex((t) => t === "overlap+ordinary+spriteTail");
  assert.ok(hitIdx >= 0, "no captured dispatch reached the overlap-search LATCH block (0x1C23)");

  const landing = at("landing");
  const trigger = at("overlap");
  const hit = caps[hitIdx];

  // The expected address is the LOWEST cell the twin can disturb, because the state dump is
  // walked in address order; a twin whose only expectation is "something differs" carries null.
  const cases = [
    ["verdict predicate off by one", landing, brokenVerdictPredicate, null],
    ["trigger frame off by one", trigger, brokenTriggerFrame, [MARIO_AIR_LANDCHECK]],
    ["dropped land-check arm", trigger, brokenNoLandCheckArm, [MARIO_AIR_LANDCHECK]],
    ["dropped ITEM_COLLECTED latch", hit, brokenNoItemLatch, [ITEM_COLLECTED]],
    ["inverted severity test", hit, brokenInvertedSeverity, [ITEM_COLLECTED, EFFECT_STATE, EFFECT_SELECT]],
  ];

  const caught = [];
  for (const [name, entry, twin, wantAddrs] of cases) {
    const diffs = contractDiffs(entry, twin);
    assert.ok(diffs.length > 0, `the "${name}" twin escaped — the gate is worthless`);
    if (wantAddrs !== null) {
      assert.ok(
        wantAddrs.some((a) => diffs[0].startsWith(`RAM@${hx(a)}`)),
        `"${name}": expected the first diff at one of ${wantAddrs.map(hx).join("/")}, got ${diffs[0]}`,
      );
    }
    caught.push(`${name} (${diffs[0]})`);
  }
  console.log(`  TEETH: ${caught.length} caught — ${caught.join("; ")}`);
});
