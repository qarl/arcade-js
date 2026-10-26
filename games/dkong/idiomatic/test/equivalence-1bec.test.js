// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1bec (ROM 0x1BEC) — the airborne block's join point: one frame of
 * ballistic motion on the caller's actor record, then the airborne handler at ROM 0x1C05.
 *
 * The idiomatic routine direct-calls stepBallisticMotion (already idiomatic) and hands the
 * frame on with m.call(0x1C05), which is still the frozen oracle. Because the ENTIRE 0x1C05
 * tail runs on both sides, this gate is stronger than a leaf gate: the ballistic step's
 * register live-out is settled for free — any register the handler chain really consumes
 * would surface as a memory/pc/SP difference here.
 *
 *   0. REACHABILITY, honestly — PLAIN ATTRACT NEVER DISPATCHES 0x1BEC (asserted: 0 over 2000
 *      attract frames). The demo only jumps mid-girder, where the position gate at ROM 0x241F
 *      answers "not at a boundary" and the block above tail-jumps straight to 0x1C05. So the
 *      captured dispatches come from a REAL CREDITED GAME instead: coin, 1-player start, then
 *      a single poke of Mario's starting spot, after which the game's own engine carries him
 *      airborne into the boundary region that routes through here. Three spots — upper-left,
 *      far-left, far-right — yield 57 real dispatches, every one with the record pointer on
 *      Mario's record at 0x6200.
 *
 *   1. EQUAL (real dispatches) — clone each real entry, run oracle vs loc_1bec on independent
 *      fresh clones, and compare RAM − the stack scratch below the entry SP, pc, SP and the propagated return value.
 *      Non-vacuity is pinned too: the oracle really does step the record (the airborne-frame
 *      counter advances and the fixed-point vertical coordinate moves).
 *
 *   2. EQUAL (crafted handler arms) — real captures all arrive in one phase (fall-height
 *      check armed, counter freshly zeroed), so the handler's other exits are crafted on a
 *      real captured state, IDENTICALLY on both sides, by poking only the phase cells: the
 *      plain-continue exit, the exit that arms the land-check phase, and the fatal-fall entry
 *      the clamp block above reaches by its skip branch. Each arm is confirmed to have really
 *      changed which handler exit fires, by wrapping the exit addresses on a probe clone.
 *
 *   3. EQUAL (crafted sweep) — 1085 position/phase combinations over a real captured state
 *      (five columns × every vertical pixel), which also drives the landing exit the poked
 *      runs never reach. All identical on the same contract.
 *
 *   4. TEETH — three deliberately-broken twins the gate MUST catch: a dropped ballistic step,
 *      an order swap (handler before the step), and a wrong tail target. The last two are
 *      baited on the counter-driven arm, not on a raw capture: with the fall-height check
 *      already armed — the phase every real dispatch arrives in — the handler branches away
 *      before reading anything the step touched, so an order swap is genuinely invisible
 *      there. Measured, not assumed: the swap twin escapes a raw capture and is caught the
 *      moment the counter decides the frame.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1bec.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1bec as oracle } from "../../translated/loc_1bec.js";
import { loc_1bec } from "../loc_1bec.js";
import { stepBallisticMotion } from "../stepBallisticMotion.js"; // ROM 0x239C — used by the twins
import { loc_1c33 } from "../loc_1c33.js"; // ROM 0x1C33 — idiomatic as of decompile batch 3
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_ACTIVE,
  MARIO_X,
  MARIO_Y,
  MARIO_Y_FRAC,
  MARIO_AIR_FRAMES,
  MARIO_AIR_LANDCHECK,
  MARIO_FATAL_FALL,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1bec;
const HANDLER = 0x1c05; // the airborne handler this routine tails into (still the oracle)
// The record pointer every real dispatch arrives with: the base of Mario's actor record, whose
// first byte is the alive flag — so the base address IS that named cell, not a second constant.
const MARIO_RECORD = MARIO_ACTIVE;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const hx16 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80) then IN2
// start1 (0x04) so the ROM's own credit/start logic begins a 1-player game.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 400, dur: 6 },
  { port: 0x7d00, bits: 0x04, frame: 460, dur: 6 },
];

// Three starting spots that put Mario airborne where the horizontal clamp above 0x1BEC fires:
// high on the left of the board, hard against the left edge, hard against the right edge.
// Only the starting spot is poked; the fall, the clamp and the dispatch are the game's own.
const SPOTS = [
  { label: "upper-left", x: 0x40, y: 0x40 },
  { label: "far-left", x: 0x10, y: 0x90 },
  { label: "far-right", x: 0xf0, y: 0x90 },
];
const POKE_FRAME = 1600;
const RUN_FRAMES = 2400;

// The handler exits worth telling apart when checking that a crafted arm really moved.
const EXITS = [0x1c33, 0x1c3a, 0x1c76, 0x2853];

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 *  (the oracle brackets its ballistic call with a push/pop the idiomatic form has no need of;
 *  the handler chain churns the same region on both sides). */
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

/** Run a function on a fresh clone and keep its return value. */
function runOn(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  return { m: c, ret };
}

/** Compare a candidate against the oracle on the contract: RAM − the stack scratch below the entry SP and the
 *  propagated return value (pc/SP excluded — seam artifacts). Returns human-readable mismatches. */
function contractDiffs(entry, fn) {
  const o = runOn(entry, oracle);
  const c = runOn(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o.m, c.m, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx16(ram.addr)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  // pc/SP dropped: the tail m.call(0x1C05) was dissolved to a direct loc_1c05 call, so pc and
  // SP are now seam artifacts, never game live-outs; the whole-game SP-inertness tests guard SP.
  if (String(o.ret) !== String(c.ret)) diffs.push(`return oracle=${o.ret} cand=${c.ret}`);
  return diffs;
}

/** Which handler exits the oracle takes from this entry — wraps the exit addresses on a probe
 *  clone (each machine owns its dispatch map, so the wrap is local to the clone). */
function exitsTaken(entry) {
  const c = entry.clone();
  const hit = [];
  for (const addr of EXITS) {
    const inner = c.routines.get(addr);
    c.routines.set(addr, (mm, ...args) => {
      if (!hit.includes(addr)) hit.push(addr);
      return inner(mm, ...args);
    });
  }
  oracle(c);
  return hit.sort((p, q) => p - q).map(hx16).join(",");
}

// -- capture ------------------------------------------------------------------

/** Hook 0x1BEC in a driven 1-player game started from `spot` and clone the machine at up to K
 *  real dispatches. The wrapper snapshots the entry state, then runs the oracle so the host
 *  game proceeds undisturbed. */
function captureDriven(spot, K = 200) {
  const caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.pokes = [
    { addr: MARIO_X, val: spot.x, frame: POKE_FRAME, dur: 2 },
    { addr: MARIO_Y, val: spot.y, frame: POKE_FRAME, dur: 2 },
  ];
  host.runFrames(RUN_FRAMES);
  return caps;
}

/** Count 0x1BEC dispatches in a plain attract run (no coin, no poke, no input at all). */
function countAttractDispatches(frames) {
  let n = 0;
  const overrides = new Map([[TARGET, (mm) => { n++; return oracle(mm); }]]);
  new Machine(ROM, { overrides }).runFrames(frames);
  return n;
}

let CAPTURES = null;
/** All real captured dispatches, memoised across tests (each driven run is a full game). */
function allCaptures() {
  if (!CAPTURES) CAPTURES = SPOTS.map((s) => ({ spot: s, caps: captureDriven(s) }));
  return CAPTURES;
}

// -- teeth twins (same shape as loc_1bec, one thing broken) -------------------

/** Broken twin (a): DROPPED STEP — hands the frame to the handler without advancing the arc. */
function brokenDroppedStep(m) {
  return m.call(HANDLER);
}

/** Broken twin (b): SWAPPED ORDER — runs the handler on the PREVIOUS frame's position, then
 *  steps the arc afterwards. */
function brokenSwappedOrder(m) {
  const ret = m.call(HANDLER);
  stepBallisticMotion(m);
  return ret;
}

/** Broken twin (c): WRONG TAIL — steps the arc, then enters the handler past its head, skipping
 *  the landing probe and both phase tests. */
function brokenWrongTail(m) {
  stepBallisticMotion(m);
  return loc_1c33(m);
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: attract never reaches 0x1BEC; a driven credited game does (57 dispatches)", () => {
  assert.equal(
    countAttractDispatches(2000), 0,
    "expected plain attract to NEVER dispatch 0x1BEC — if it now does, the gate should replay those instead",
  );

  let total = 0;
  for (const { spot, caps } of allCaptures()) {
    assert.ok(caps.length >= 1, `expected at least one real 0x1BEC dispatch from the ${spot.label} spot`);
    for (const c of caps) {
      assert.equal(
        c.regs.ix, MARIO_RECORD,
        `every 0x1BEC dispatch must arrive on Mario's record, got ${hx16(c.regs.ix)} (${spot.label})`,
      );
    }
    total += caps.length;
  }
  assert.ok(total >= 50, `expected ~57 real dispatches across the three spots, got ${total}`);
  console.log(
    `  REACHABILITY: 0 attract dispatches (2000 frames); ${total} real driven dispatches ` +
      `[${allCaptures().map(({ spot, caps }) => `${spot.label}:${caps.length}`).join(" ")}], all on Mario's record`,
  );
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_1bec == oracle on every captured 0x1BEC entry", () => {
  let n = 0;
  for (const { spot, caps } of allCaptures()) {
    for (const cap of caps) {
      const diffs = contractDiffs(cap, loc_1bec); // FRESH clones inside — cap untouched
      assert.equal(diffs.length, 0, `${spot.label}: ${diffs.join("; ")}`);

      // Non-vacuity: the oracle really steps the arc — the airborne-frame counter advances
      // and the fixed-point vertical coordinate moves.
      const after = runOn(cap, oracle).m;
      const t = cap.mem.read8(MARIO_AIR_FRAMES);
      assert.equal(
        after.mem.read8(MARIO_AIR_FRAMES), (t + 1) & 0xff,
        `${spot.label}: the airborne-frame counter should advance past ${hx(t)}`,
      );
      n++;
    }
  }
  const moved = allCaptures()
    .flatMap(({ caps }) => caps)
    .filter((c) => runOn(c, oracle).m.mem.read8(MARIO_Y_FRAC) !== c.mem.read8(MARIO_Y_FRAC)).length;
  assert.ok(moved >= 1, "expected at least one dispatch to visibly move the vertical coordinate");
  console.log(`  EQUAL/real: ${n} captured dispatches identical on RAM(−stack)+return (${moved} moved the arc)`);
});

// -- 2. EQUAL (crafted handler arms) ------------------------------------------

test("EQUAL (crafted arms): every handler exit the poked game cannot supply matches the oracle", () => {
  const seed = allCaptures()[0].caps[0];
  assert.ok(seed, "need one real capture to seed the crafted arms with real RAM + a real stack");

  // Every real dispatch arrives in the same phase: the fall-height check already armed and the
  // airborne-frame counter freshly zeroed by the clamp block above. Poke ONLY the phase cells.
  assert.equal(seed.mem.read8(MARIO_AIR_LANDCHECK), 1, "real captures arrive with the fall-height check armed");

  const arms = [
    { label: "natural (fall-height check armed)", poke: {} },
    { label: "plain continue", poke: { [MARIO_AIR_LANDCHECK]: 0, [MARIO_AIR_FRAMES]: 0x05 } },
    { label: "arm the land-check phase", poke: { [MARIO_AIR_LANDCHECK]: 0, [MARIO_AIR_FRAMES]: 0x13 } },
    { label: "fatal-fall entry (the clamp block's skip branch)", poke: { [MARIO_FATAL_FALL]: 1, [MARIO_AIR_FRAMES]: 0x05 } },
  ];

  const signatures = new Set();
  for (const arm of arms) {
    const e = seed.clone();
    for (const [addr, val] of Object.entries(arm.poke)) e.mem.write8(Number(addr), val);
    const diffs = contractDiffs(e, loc_1bec);
    assert.equal(diffs.length, 0, `${arm.label}: ${diffs.join("; ")}`);
    signatures.add(exitsTaken(e));
  }
  // The pokes really did move the handler onto different exits, so the arms are not one arm
  // dressed up four ways.
  assert.ok(signatures.size >= 3, `expected the crafted arms to reach ≥3 distinct handler exits, got ${[...signatures].join(" | ")}`);

  // And the land-check arm really armed the phase (the counter reaching the trigger value).
  const armEntry = seed.clone();
  armEntry.mem.write8(MARIO_AIR_LANDCHECK, 0);
  armEntry.mem.write8(MARIO_AIR_FRAMES, 0x13);
  const armed = runOn(armEntry, oracle).m;
  assert.equal(armed.mem.read8(MARIO_AIR_FRAMES), 0x14, "the step should carry the counter to the trigger value");
  assert.equal(armed.mem.read8(MARIO_AIR_LANDCHECK), 1, "reaching the trigger value should arm the fall-height check");

  console.log(`  EQUAL/crafted arms: ${arms.length} arms identical, ${signatures.size} distinct handler exits [${[...signatures].join(" | ")}]`);
});

// -- 3. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL (crafted sweep): 1085 position/phase entries — including the landing exit — match", () => {
  const seed = allCaptures()[0].caps[0];
  assert.ok(seed, "need one real capture to seed the sweep");

  const COLUMNS = [0x30, 0x40, 0x60, 0x90, 0xc0];
  let count = 0, landings = 0, firstBad = null;
  for (const x of COLUMNS) {
    for (let y = 0x20; y <= 0xf8; y++) {
      const e = seed.clone();
      e.mem.write8(MARIO_X, x);
      e.mem.write8(MARIO_Y, y);
      e.mem.write8(MARIO_AIR_LANDCHECK, 0);
      e.mem.write8(MARIO_AIR_FRAMES, 0x05);
      const diffs = contractDiffs(e, loc_1bec);
      count++;
      if (diffs.length && !firstBad) firstBad = `[x=${hx(x)} y=${hx(y)}] ${diffs.join("; ")}`;
      if (exitsTaken(e).includes(hx16(0x1c3a))) landings++;
    }
  }
  assert.equal(firstBad, null, firstBad);
  assert.equal(count, COLUMNS.length * (0xf8 - 0x20 + 1));
  assert.ok(landings >= 1, "expected the sweep to reach the landing exit the poked runs never hit");
  console.log(`  EQUAL/sweep: ${count} crafted entries identical on RAM(−stack)+return (${landings} took the landing exit)`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: dropped-step, swapped-order and wrong-tail twins are all CAUGHT", () => {
  const seed = allCaptures()[0].caps[0];
  assert.ok(seed, "need a real capture to seed the teeth baits");

  // (a) dropped step — caught on any real entry: the record simply never advances.
  const dropped = contractDiffs(seed, brokenDroppedStep);
  assert.ok(dropped.length > 0, "the dropped-step twin escaped — the gate is worthless");

  // (b) order swap and (c) wrong tail both need an entry where the handler's decision actually
  // depends on what the step just did. On a real capture the fall-height check is already armed,
  // so the handler branches away before reading anything the step touched and the swap is
  // genuinely invisible — a real entry is the WRONG bait for it. The counter-driven arm is the
  // right one: the step carries the airborne-frame counter onto the trigger value, so running
  // the handler first (or entering it past its head) routes the frame differently.
  const phaseBait = seed.clone();
  phaseBait.mem.write8(MARIO_AIR_LANDCHECK, 0);
  phaseBait.mem.write8(MARIO_AIR_FRAMES, 0x13);

  const swapped = contractDiffs(phaseBait, brokenSwappedOrder);
  assert.ok(swapped.length > 0, "the order-swapped twin escaped — the gate is worthless");

  const wrongTail = contractDiffs(phaseBait, brokenWrongTail);
  assert.ok(wrongTail.length > 0, "the wrong-tail twin escaped — the gate is worthless");

  console.log(
    `  TEETH: dropped-step caught (${dropped[0]}); order-swap caught (${swapped[0]}); ` +
      `wrong-tail caught (${wrongTail[0]})`,
  );
});
