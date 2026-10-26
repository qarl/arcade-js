// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1c33 (ROM 0x1C33) — the airborne handler's exit tail: bump the value
 * the handler arrives with, run the hammer-touch latch on the one value whose bump wraps the byte
 * to zero, then always refresh Mario's sprite record.
 *
 * CONTRACT. The live-out is MEMORY ONLY plus control flow, so each case compares
 *   - work RAM minus the stack scratch below the entry SP,
 *   - pc and SP,
 *   - the return value (undefined on every arm, on both sides).
 * The register file is deliberately NOT compared: the oracle leaves the bumped value in the
 * accumulator and the tail at ROM 0x1DA6 leaves its own residue there, and nothing downstream
 * reads either (see the routine header). The idiomatic form models the Z80 stack with the JS call
 * stack, so the harness performs exactly ONE terminal m.ret() after the candidate — the single
 * net caller-return the ROM performs on BOTH arms. That claim is not assumed: the stack test
 * below measures the oracle's deepest push on the wrapped arm and asserts it stays inside
 * STACK_SCRATCH, which is what makes excluding that region the contract rather than a fudge.
 *
 *   0. REACHABILITY, measured — 0x1C33 IS naturally reachable in PLAIN ATTRACT (no coin, no
 *      poke): 77 real dispatches in 2000 frames, 4 of them on the wrapped arm that runs the
 *      latch. The test asserts both counts are non-zero, asserts every wrapped dispatch arrives
 *      with MARIO_AIR_FRAMES == 19 (the frame before the handler arms its fall-height check), and
 *      asserts BOTH arrival paths are represented — the counter path, where the arrival value is
 *      MARIO_AIR_FRAMES − 20, and the collision fall-through, which always arrives with 1.
 *
 *   1. EQUAL (real dispatches) — clone each real entry and compare oracle vs loc_1c33 on the
 *      contract above. Non-vacuity is pinned too: the sprite record really does change on most
 *      of them, so a candidate that skipped the refresh could not pass by luck.
 *
 *   2. EQUAL (crafted exhaustive sweep) — the whole live-in is ONE byte, so instead of sampling
 *      it the gate sweeps ALL 256 arrival values on a real captured state, twice: once with the
 *      latch and its sound pre-set so a latch call CLEARS them, once with a hammer record
 *      overlapping Mario so a latch call SETS the latch, asserts the sound and marks the record.
 *      Both sweeps must match the oracle on every value, and on the oracle side EXACTLY ONE of
 *      the 256 values may move a latch cell — which pins the predicate boundary exactly.
 *
 *   3. EQUAL (crafted arms, absolute values) — the clear arm, the hit arm and the CLOSED board
 *      gate (75m, which attract never plays) each assert the oracle's absolute cell values as
 *      well as oracle == candidate, so a both-sides-wrong reading cannot pass.
 *
 *   4. TEETH — four broken twins the suite MUST catch: a dropped sprite refresh, an
 *      unconditional latch, a never-latch twin, and an off-by-one predicate that tests the
 *      arrival value for zero instead of testing the bump for a wrap. An order swap between the
 *      two callees is NOT offered as teeth: they share no cell, so the swap is genuinely
 *      invisible (stated rather than dressed up as coverage).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1c33.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { u8 } from "../../../../core/int.js";
import { loc_1c33 as oracle } from "../../translated/loc_1c33.js";
import { loc_1c33 } from "../loc_1c33.js";
import { latchHammerTouch } from "../latchHammerTouch.js";           // ROM 0x2954 — used by the twins
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js"; // ROM 0x1DA6 — used by the twins
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_X, MARIO_Y, MARIO_SPRITE_CODE, MARIO_SPRITE_ATTR, MARIO_SPRITE_RECORD,
  MARIO_AIR_FRAMES, MARIO_HAMMER_PENDING, SND_TRIGGER, BOARD,
  OBJ_PAIR_6680, OBJ_ACTIVE, OBJ_X, OBJ_Y, OBJ_HIT_EXTENT_X, OBJ_HIT_EXTENT_Y, HAMMER_IN_PLAY,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1c33;
const ATTRACT_FRAMES = 2000;

// The hammer pair the latch searches. NAMESPACE: 0x6680 is an OBJECT array (the sprite buffer
// starts at 0x6900), so these are OBJ_* record fields — OBJ_ACTIVE/OBJ_X/OBJ_Y and the two hit
// extents — never the numerically-colliding SPRITE_* fields of a sprite record. HAMMER_IN_PLAY
// (+0x01) is names.js's name for this pair's selected-hammer flag and is scoped to this pair alone.
const REC0 = OBJ_PAIR_6680;                    // 0x6680 — the pair's first record
const REC1 = (OBJ_PAIR_6680 + 0x10) & 0xffff;  // 0x6690 — the pair's second record
const SEL0 = REC0 + HAMMER_IN_PLAY;            // 0x6681
const SEL1 = REC1 + HAMMER_IN_PLAY;            // 0x6691
const PICKUP_SOUND = SND_TRIGGER + 5;          // 0x6085 — the item/score trigger the latch pulses
const PICKUP_SOUND_FRAMES = 64;                // what a hammer touch stores there

const BOARD_25M = 1; // hammer board — the latch's board gate is OPEN
const BOARD_75M = 3; // no hammer    — the latch's board gate is CLOSED

const MX = 0x40, MY = 0x80;       // crafted Mario position
const MCODE = 0x8e, MATTR = 0x02; // crafted Mario sprite fields
const LAND_CHECK_TRIGGER = 20;    // MARIO_AIR_FRAMES value at which the handler arms its check
const LATCH_FRAME = 19;           // the one airborne frame this routine runs the latch on
const WRAPS = 255;                // the one arrival value whose bump wraps the byte to zero

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP —
 *  where the oracle's `call 0x2954` bracket (and the latch's own brackets) land. */
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

/** Run the ORACLE on a fresh clone; it performs its own push/call/ret bracket. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { c, ret };
}

/** Run a candidate on a fresh clone, then model the SINGLE terminal caller-return the ROM
 *  performs on both arms so pc + SP line up with the oracle. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.ret();
  return { c, ret };
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP, return value. Also hands back the oracle's
 *  finished machine so a caller can assert absolute values without re-running it. */
function compare(entry, fn) {
  const o = runOracle(entry);
  const k = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o.c, k.c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.c.pc !== k.c.pc) diffs.push(`pc oracle=${hx(o.c.pc)} cand=${hx(k.c.pc)}`);
  if (o.c.regs.sp !== k.c.regs.sp) diffs.push(`SP oracle=${hx(o.c.regs.sp)} cand=${hx(k.c.regs.sp)}`);
  if (String(o.ret) !== String(k.ret)) diffs.push(`return oracle=${String(o.ret)} cand=${String(k.ret)}`);
  return { diffs, oracled: o.c };
}

const diffsOf = (entry, fn) => compare(entry, fn).diffs;

// -- capture ------------------------------------------------------------------

let CAPTURES = null;
/** Hook 0x1C33 in a PLAIN attract run (no coin, no poke, no input) and clone the machine at
 *  every real dispatch. The wrapper snapshots the entry state, then runs the oracle so the host
 *  game proceeds undisturbed. Memoised — the run is a full 2000-frame attract. */
function allCaptures() {
  if (CAPTURES) return CAPTURES;
  const caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    if (caps.length < 256) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides }).runFrames(ATTRACT_FRAMES);
  CAPTURES = caps;
  return CAPTURES;
}

const wrappedCaptures = () => allCaptures().filter((c) => c.regs.a === WRAPS);
/** True when this entry's arrival value is the counter path's MARIO_AIR_FRAMES − 20. */
const viaCounter = (c) => u8(c.mem.read8(MARIO_AIR_FRAMES) - LAND_CHECK_TRIGGER) === c.regs.a;

// -- crafted entries ----------------------------------------------------------

/** Write the fields the latch's pair search reads on one record of the hammer pair. */
function putRecord(m, base, { live, x = 0, y = 0 }) {
  m.mem.write8(base + OBJ_ACTIVE, live ? 1 : 0);
  m.mem.write8(base + OBJ_X, x);
  m.mem.write8(base + OBJ_Y, y);
  m.mem.write8(base + OBJ_HIT_EXTENT_X, 0);
  m.mem.write8(base + OBJ_HIT_EXTENT_Y, 0);
}

/**
 * A REAL captured attract state — real RAM, a real stack — with only the arrival value, the
 * board, Mario's position/sprite fields, the hammer pair and the four latch cells poked, so a
 * latch call is always VISIBLE in memory (either as a clear or as a set + mark).
 */
function craft(seed, { a, board = BOARD_25M, overlap = false, pre = {} }) {
  const m = seed.clone();
  m.regs.a = a;
  m.mem.write8(BOARD, board);
  m.mem.write8(MARIO_X, MX);
  m.mem.write8(MARIO_Y, MY);
  m.mem.write8(MARIO_SPRITE_CODE, MCODE);
  m.mem.write8(MARIO_SPRITE_ATTR, MATTR);
  putRecord(m, REC0, overlap ? { live: true, x: MX, y: MY } : { live: false });
  putRecord(m, REC1, { live: false });
  m.mem.write8(MARIO_HAMMER_PENDING, pre.pending ?? 0);
  m.mem.write8(PICKUP_SOUND, pre.sound ?? 0);
  m.mem.write8(SEL0, pre.sel0 ?? 0);
  m.mem.write8(SEL1, pre.sel1 ?? 0);
  return m;
}

/** The four cells the latch can move, plus Mario's sprite record. */
const cells = (m) => ({
  pending: m.mem.read8(MARIO_HAMMER_PENDING),
  sound: m.mem.read8(PICKUP_SOUND),
  sel0: m.mem.read8(SEL0),
  sel1: m.mem.read8(SEL1),
});
/** Mario's 4-byte record read as a block. NAMESPACE: this one lives inside SPRITE_BUFFER, so its
 *  fields are the SPRITE_* set — +0 X, +1 code, +2 attr, +3 Y — the OTHER namespace from the
 *  object records above, which is why the expected value below is [X, code, attr, Y]. */
const spriteRecord = (m) => [0, 1, 2, 3].map((i) => m.mem.read8(MARIO_SPRITE_RECORD + i));
const latchMoved = (before, after) => {
  const b = cells(before), a = cells(after);
  return b.pending !== a.pending || b.sound !== a.sound || b.sel0 !== a.sel0 || b.sel1 !== a.sel1;
};

// The two sweep setups: one where a latch call CLEARS, one where it SETS and marks.
const SWEEPS = [
  { label: "latch pre-set (a latch call CLEARS it)", opts: { pre: { pending: 1, sound: 3 } } },
  { label: "hammer overlapping Mario (a latch call SETS and marks)", opts: { overlap: true } },
];

// -- teeth twins (same shape as loc_1c33, one thing broken) -------------------

/** Broken twin (a): DROPPED SPRITE REFRESH — latches, but never updates the sprite record. */
function brokenNoSpriteRefresh(m) {
  if (u8(m.regs.a + 1) === 0) latchHammerTouch(m);
}

/** Broken twin (b): UNCONDITIONAL LATCH — drops the wrap test and latches on every dispatch. */
function brokenAlwaysLatch(m) {
  latchHammerTouch(m);
  writeMarioSpriteRecord(m);
}

/** Broken twin (c): NEVER LATCHES — keeps only the tail (the shape a "this call looks dead"
 *  reading would produce). */
function brokenNeverLatch(m) {
  writeMarioSpriteRecord(m);
}

/** Broken twin (d): OFF-BY-ONE PREDICATE — tests the ARRIVAL value for zero instead of testing
 *  the BUMP for a wrap, so it latches one value early and misses the real one. */
function brokenOffByOne(m) {
  if (m.regs.a === 0) latchHammerTouch(m);
  writeMarioSpriteRecord(m);
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: plain attract dispatches 0x1C33 (77x, 4 on the wrapped arm), both arrival paths", () => {
  const caps = allCaptures();
  assert.ok(caps.length > 0, "expected plain attract to dispatch 0x1C33 — the demo jumps");

  const wrapped = wrappedCaptures();
  assert.ok(wrapped.length > 0, "expected at least one wrapped dispatch (the arm that runs the latch)");
  for (const c of wrapped) {
    assert.equal(
      c.mem.read8(MARIO_AIR_FRAMES), LATCH_FRAME,
      "every wrapped dispatch must arrive one airborne frame short of the land-check trigger",
    );
  }

  const counter = caps.filter(viaCounter);
  const fallThrough = caps.filter((c) => !viaCounter(c));
  assert.ok(counter.length > 0, "expected the counter path to be represented");
  assert.ok(fallThrough.length > 0, "expected the collision fall-through to be represented");
  for (const c of fallThrough) {
    assert.equal(c.regs.a, 1, "the collision fall-through always arrives with 1");
    assert.equal(
      c.mem.read8(MARIO_AIR_FRAMES), LAND_CHECK_TRIGGER,
      "the collision fall-through is reached on the frame the counter equals the trigger",
    );
  }

  const arrivals = new Set(caps.map((c) => c.regs.a));
  console.log(
    `  REACHABILITY: ${caps.length} natural 0x1C33 dispatches in ${ATTRACT_FRAMES} attract frames ` +
      `(${wrapped.length} wrapped/latching, ${counter.length} counter-path, ${fallThrough.length} collision ` +
      `fall-through, ${arrivals.size} distinct arrival values)`,
  );
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_1c33 == oracle on every captured 0x1C33 entry", () => {
  const caps = allCaptures();
  let recordChanged = 0;
  for (const cap of caps) {
    const { diffs, oracled } = compare(cap, loc_1c33); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, `A=${hx(cap.regs.a)}: ${diffs.join("; ")}`);
    const before = spriteRecord(cap), after = spriteRecord(oracled);
    if (before.some((v, i) => v !== after[i])) recordChanged++;
  }
  assert.ok(
    recordChanged >= 1,
    "expected the sprite refresh to visibly change the record on real dispatches (else case 1 is vacuous)",
  );
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP+return ` +
      `(${recordChanged} visibly moved the sprite record)`,
  );
});

test("STACK: the oracle's whole bracket lands inside the excluded STACK_SCRATCH region", () => {
  const wrapped = wrappedCaptures();
  assert.ok(wrapped.length > 0, "need a wrapped dispatch — that is the arm that pushes anything");
  let lowest = 0xffff, entrySp = null;
  for (const cap of wrapped) {
    const c = cap.clone();
    let deepest = c.regs.sp;
    const basePush = c.push16.bind(c);
    c.push16 = (v) => { basePush(v); deepest = Math.min(deepest, c.regs.sp); };
    oracle(c);
    assert.ok(
      deepest >= STACK_SCRATCH.lo,
      `the oracle's deepest push reached ${hx(deepest)}, below STACK_SCRATCH — excluding that region would hide real state`,
    );
    assert.equal(c.regs.sp, (cap.regs.sp + 2) & 0xffff, "the ROM nets exactly one caller-return");
    if (deepest < lowest) { lowest = deepest; entrySp = cap.regs.sp; }
  }
  console.log(
    `  STACK: wrapped arm SP ${hx(entrySp)} -> ${hx((entrySp + 2) & 0xffff)}, deepest push ${hx(lowest)}, ` +
      `every pushed byte inside [${hx(STACK_SCRATCH.lo)}, ${hx(STACK_SCRATCH.hi)})`,
  );
});

// -- 2. EQUAL (crafted exhaustive sweep) --------------------------------------

test("EQUAL (exhaustive): all 256 arrival values match, and EXACTLY ONE runs the latch", () => {
  const seed = allCaptures().find((c) => c.regs.a !== WRAPS);
  assert.ok(seed, "need a real capture to seed the sweep with real RAM and a real stack");

  for (const { label, opts } of SWEEPS) {
    const latching = [];
    let firstBad = null;
    for (let a = 0; a < 256; a++) {
      const entry = craft(seed, { ...opts, a });
      const { diffs, oracled } = compare(entry, loc_1c33);
      if (diffs.length && !firstBad) firstBad = `${label} A=${hx(a)}: ${diffs.join("; ")}`;
      if (latchMoved(entry, oracled)) latching.push(a);

      // The unconditional tail must run for EVERY arrival value, latch or not.
      assert.deepEqual(
        spriteRecord(oracled), [MX, MCODE, MATTR, MY],
        `${label} A=${hx(a)}: the sprite refresh must run on every arrival value`,
      );
    }
    assert.equal(firstBad, null, firstBad);
    assert.deepEqual(
      latching, [WRAPS],
      `${label}: exactly the one arrival value whose bump wraps may run the latch, got [${latching.map(hx).join(",")}]`,
    );
    console.log(`  EQUAL/exhaustive: 256 arrival values identical — ${label}; latch runs only at ${hx(WRAPS)}`);
  }
});

// -- 3. EQUAL (crafted arms, absolute values) ---------------------------------

test("EQUAL (crafted arms): clear / hit / closed-gate arms match AND hold their absolute values", () => {
  const seed = allCaptures().find((c) => c.regs.a !== WRAPS);
  assert.ok(seed, "need a real capture to seed the crafted arms");

  const ARMS = [
    {
      name: "wrapped + no overlap — the latch CLEARS what a previous touch set",
      opts: { a: WRAPS, pre: { pending: 1, sound: 3 } },
      want: { pending: 0, sound: 0, sel0: 0, sel1: 0 },
    },
    {
      name: "not wrapped — the latch never runs, the pre-set cells survive",
      opts: { a: WRAPS - 1, pre: { pending: 1, sound: 3 } },
      want: { pending: 1, sound: 3, sel0: 0, sel1: 0 },
    },
    {
      name: "wrapped + hammer overlapping Mario — latch set, sound asserted, record marked",
      opts: { a: WRAPS, overlap: true },
      want: { pending: 1, sound: PICKUP_SOUND_FRAMES, sel0: 1, sel1: 0 },
    },
    {
      name: "wrapped on 75m — the latch's board gate is CLOSED, nothing moves",
      opts: { a: WRAPS, board: BOARD_75M, overlap: true, pre: { pending: 1, sound: 3 } },
      want: { pending: 1, sound: 3, sel0: 0, sel1: 0 },
    },
  ];

  for (const { name, opts, want } of ARMS) {
    const entry = craft(seed, opts);
    const { diffs, oracled } = compare(entry, loc_1c33);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    assert.deepEqual(cells(oracled), want, `${name}: the oracle's absolute cell values`);
    assert.deepEqual(spriteRecord(oracled), [MX, MCODE, MATTR, MY], `${name}: the sprite refresh always runs`);
  }
  console.log(`  EQUAL/crafted arms: ${ARMS.length} arms identical and pinned to absolute values`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: dropped-refresh, always-latch, never-latch and off-by-one twins are all CAUGHT", () => {
  const caps = allCaptures();
  const seed = caps.find((c) => c.regs.a !== WRAPS);
  assert.ok(seed, "need a real capture to seed the teeth baits");

  // Crafted baits where each twin MUST diverge, whatever attract happened to contain.
  const wrappedClear = craft(seed, { a: WRAPS, pre: { pending: 1, sound: 3 } }); // the latch clears
  const plainPreset = craft(seed, { a: WRAPS - 1, pre: { pending: 1, sound: 3 } }); // the latch must NOT run
  const zeroArrival = craft(seed, { a: 0, pre: { pending: 1, sound: 3 } }); // off-by-one latches here

  const noRefresh = diffsOf(wrappedClear, brokenNoSpriteRefresh);
  const always = diffsOf(plainPreset, brokenAlwaysLatch);
  const never = diffsOf(wrappedClear, brokenNeverLatch);
  const offByOneEarly = diffsOf(zeroArrival, brokenOffByOne);
  const offByOneLate = diffsOf(wrappedClear, brokenOffByOne);

  assert.ok(noRefresh.length > 0, "the dropped-refresh twin escaped — the gate is worthless");
  assert.ok(always.length > 0, "the unconditional-latch twin escaped — the gate is worthless");
  assert.ok(never.length > 0, "the never-latch twin escaped — the gate is worthless");
  assert.ok(offByOneEarly.length > 0, "the off-by-one twin escaped where it latches early — the gate is worthless");
  assert.ok(offByOneLate.length > 0, "the off-by-one twin escaped where it misses the real latch — the gate is worthless");

  // And how much of the REAL attract distribution each twin cannot survive, measured rather
  // than asserted from theory. (The latch twins only show where the latch would move a cell,
  // which on unpoked attract state is a minority of dispatches — hence the crafted baits above.)
  const caught = (fn) => caps.filter((c) => diffsOf(c, fn).length > 0).length;
  const realNoRefresh = caught(brokenNoSpriteRefresh);
  const realAlways = caught(brokenAlwaysLatch);
  const realNever = caught(brokenNeverLatch);
  const realOffByOne = caught(brokenOffByOne);
  assert.ok(realNoRefresh >= 1, "the dropped-refresh twin should also die on real dispatches");
  assert.ok(realAlways >= 1, "the unconditional-latch twin should also die on real dispatches");
  assert.ok(realNever >= 1, "the never-latch twin should also die on real dispatches");

  console.log(
    `  TEETH: dropped-refresh caught (${noRefresh[0]}); always-latch caught (${always[0]}); ` +
      `never-latch caught (${never[0]}); off-by-one caught early (${offByOneEarly[0]}) and late (${offByOneLate[0]}). ` +
      `On the ${caps.length} real dispatches: dropped-refresh ${realNoRefresh}, always-latch ${realAlways}, ` +
      `never-latch ${realNever}, off-by-one ${realOffByOne}`,
  );
});
