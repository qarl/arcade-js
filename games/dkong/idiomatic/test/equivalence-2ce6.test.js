// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2ce6 (ROM 0x2CE6) — the entry point of the 0x2C-cluster chain.
 *
 * Its only ROM caller is the 25m barrel-release slot claim (ROM 0x2CB8), which leaves the pointer
 * register on BONUS — the byte it has just decremented — so loc_2ce6 reads the bonus counter for
 * this release. While four or more remain it does nothing; below four it zeroes the X field of the
 * record whose index EQUALS the remaining count, in the four-record sprite group at 0x69A8 (seeded
 * once per 25m board build from the ROM template at 0x3DDC and touched by no other ROM site).
 * Zeroing a sprite record's X blanks it. Both arms then continue into stampReleasedBarrelKind, which presets the
 * freshly-claimed barrel record and falls on into the frame-gated renderer tick.
 *
 * CONTEXT, GROUNDED (live MAME 0.288 on the real dkong ROM, understanding pass 12,
 * scratchpad/pass12-grounding.md): this cluster is ORDINARY 25m BARREL PLAY, not a cutscene — the
 * older "0x2C-cluster cutscene renderer" framing is REFUTED. All 46 observed dispatches of the next
 * link, stampReleasedBarrelKind, fell at gameplay substates (17 credited in-board 25m, 29 attract 25m demo) and
 * ZERO at substate 7, the opening Kong-climb cutscene; board 1 only; the index register held an
 * OBJ_ARRAY_67 barrel-record base at 46/46, each paired 1:1 with a slot claim at ROM 0x2CB8.
 * Grounding deliberately did NOT establish which NAMED Donkey Kong object either barrel kind is, so
 * no lore name is used here.
 *
 * loc_2ce6 WRITES MEMORY (its own record clear, and — through the continuation — everything the
 * stampReleasedBarrelKind/advanceBarrelRelease chain touches), so it is gated on memory-equivalence, not a returned scalar, and
 * every case runs on FRESH clones. The contract is RAM (minus the stack scratch below the entry SP) + pc + SP.
 *
 * LIVE-OUT: memory-only, plus the control-flow boundary. loc_2ce6 pushes nothing of its own — both
 * exits are a jump/fall-through into stampReleasedBarrelKind — so the whole chain nets exactly ONE caller-return
 * pop, performed on loc_2ce6's behalf downstream. The idiomatic routine models that as a plain JS
 * return, so the harness performs one m.ret() on the candidate AFTER the call to line pc + SP up
 * with the oracle; the crafted cases additionally assert, non-vacuously, that both sides land on the
 * return address that was actually on the stack at entry with SP popped by exactly 2. No register is
 * asserted: stampReleasedBarrelKind overwrites the accumulator from BARREL_CLAIM_MODE and neither it nor advanceBarrelRelease
 * reads an incoming pointer register, so the oracle's counter/index/pointer residue is dead. On the
 * renderer's deeper table-load path the oracle's dissolved `call 0x004e` bracket churns the dead
 * STACK_SCRATCH region, which the contract excludes.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x2CE6 in a real attract run and clone the machine at
 *      each true dispatch. Run the ORACLE on one clone and loc_2ce6 on another; confirm identical
 *      RAM (minus the stack scratch below the entry SP) + pc + SP. These all take the SKIP arm: the counter starts at 50 on
 *      25m level 1 and steps down one per barrel release, so attract never reaches 3.
 *
 *   2. EQUAL (crafted) — from a real captured dispatch, poke that ONE counter byte identically on
 *      both sides to force every clear index (0/1/2/3) and the 4 and 5 skip cases, over a
 *      sentinel-filled group so every write is unambiguous, plus one case that drives the
 *      continuation through the renderer's acting frame instead of its frame-gate return.
 *      Non-vacuity: the right record really was blanked on both sides, every other sentinel byte
 *      survived, and the barrel record downstream really was stamped.
 *
 *   3. TEETH — three broken twins, each MUST be caught:
 *      (a) wrong-stride — indexes the group with a 2-byte stride instead of the 4-byte sprite record
 *          stride, so it blanks the wrong record.
 *      (b) off-by-one boundary — clears at `remaining <= 4` instead of `< 4`, so at 4 it walks off
 *          the end of the group and blanks the first record of the neighbouring OBJ_65A0_SPRITES.
 *      (c) drop-continuation — does the (correct) record clear but returns WITHOUT continuing into
 *          stampReleasedBarrelKind, so the barrel-record preset and the renderer's frame-gate decrement are missing.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2ce6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ce6 as oracle } from "../../translated/loc_2ce6.js";
import { loc_2ce6 } from "../loc_2ce6.js";
import { stampReleasedBarrelKind } from "../stampReleasedBarrelKind.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH, BONUS, SPRITE_X, OBJ_65A0_SPRITES, BARREL_CLAIM_MODE,
  OBJ_SPRITE_CODE, OBJ_SPRITE_ATTR,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2ce6;

// The four-record sprite group loc_2ce6 empties (no names.js name — an unnamed sub-block of
// SPRITE_BUFFER). Its 16 bytes end exactly where the named OBJ_65A0_SPRITES group begins, which is
// what makes the off-by-one boundary twin detectable.
const COUNTDOWN_SPRITES = 0x69a8;
const COUNTDOWN_RECORDS = 4;
const SPRITE_RECORD_BYTES = 4;
const SENTINEL_END = OBJ_65A0_SPRITES + SPRITE_RECORD_BYTES; // covers the group + the neighbour's first record

// Downstream renderer control bytes, poked so each crafted case picks a deterministic path.
const FRAME_GATE = 0x62af;   // advanceBarrelRelease's per-tick down-counter (unnamed)
const ANIM_COUNTER = 0x638f; // advanceBarrelRelease's animation sub-counter (unnamed)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const recordX = (index) => COUNTDOWN_SPRITES + index * SPRITE_RECORD_BYTES + SPRITE_X;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs, skipping the stack scratch below the entry SP. */
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

/** Run the ORACLE on a fresh clone. Its chain performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single terminal `ret` with one m.ret() so pc + SP
 * match the oracle's (the idiomatic chain replaces the Z80 stack with the JS call stack).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory + the return boundary. */
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

/** Which arm the state will take (mirrors the routine's own compare). */
const classify = (mm) => (mm.mem.read8(mm.regs.hl) < COUNTDOWN_RECORDS ? "clear" : "skip");

// -- capture ------------------------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/**
 * A crafted dispatch: a REAL captured entry with a surgical nudge — the counter byte the caller's
 * pointer aims at, the group filled with distinct nonzero sentinels so any write (or mis-addressed
 * write) shows, and the downstream renderer's control bytes pinned so the continuation takes a
 * chosen path. Applied to a clone, so the capture itself is untouched.
 */
function craft(cap, { remaining, gate = 0x05, counter = 0x00 }) {
  const m = cap.clone();
  m.mem.write8(m.regs.hl, remaining);
  for (let a = COUNTDOWN_SPRITES; a < SENTINEL_END; a++) {
    m.mem.write8(a, 0xa0 + (a - COUNTDOWN_SPRITES)); // distinct and nonzero
  }
  m.mem.write8(FRAME_GATE, gate);
  m.mem.write8(ANIM_COUNTER, counter);
  return m;
}

// -- broken twins -------------------------------------------------------------

/** Twin (a): indexes the group with a 2-byte stride instead of the sprite record stride of 4. */
function brokenWrongStride(m) {
  const { regs, mem } = m;
  const remaining = mem.read8(regs.hl);
  if (remaining < COUNTDOWN_RECORDS) {
    mem.write8(COUNTDOWN_SPRITES + remaining * 2 + SPRITE_X, 0); // BUG: stride 2
  }
  return stampReleasedBarrelKind(m);
}

/** Twin (b): clears at `<= 4`, so at 4 it walks past the group into OBJ_65A0_SPRITES. */
function brokenBoundary(m) {
  const { regs, mem } = m;
  const remaining = mem.read8(regs.hl);
  if (remaining <= COUNTDOWN_RECORDS) { // BUG: <=, not <
    mem.write8(COUNTDOWN_SPRITES + remaining * SPRITE_RECORD_BYTES + SPRITE_X, 0);
  }
  return stampReleasedBarrelKind(m);
}

/** Twin (c): correct clear, but returns without continuing into stampReleasedBarrelKind. */
function brokenDropContinuation(m) {
  const { regs, mem } = m;
  const remaining = mem.read8(regs.hl);
  if (remaining < COUNTDOWN_RECORDS) {
    mem.write8(COUNTDOWN_SPRITES + remaining * SPRITE_RECORD_BYTES + SPRITE_X, 0);
  }
  // BUG: missing `return stampReleasedBarrelKind(m);`
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2CE6 is dispatched during attract, always through the bonus counter", () => {
  let count = 0;
  const arms = { skip: 0, clear: 0 };
  const pointers = new Set();
  const values = [];
  const snap = new Map([[TARGET, (mm) => {
    count++;
    arms[classify(mm)]++;
    pointers.add(mm.regs.hl);
    values.push(mm.mem.read8(mm.regs.hl));
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(4000);

  assert.ok(count > 0, "0x2CE6 should be dispatched — the 25m barrel-release chain's entry point");
  // The caller's pointer really is the bonus counter, on every natural dispatch.
  assert.deepEqual([...pointers], [BONUS], `expected the pointer to be BONUS, saw ${[...pointers].map(hx)}`);
  // Attract only ever reaches the skip arm; the clear arm is why the crafted cases exist.
  assert.equal(arms.clear, 0, "attract is not expected to reach the clear arm");
  assert.ok(Math.min(...values) >= COUNTDOWN_RECORDS, "every natural counter value should be >= 4");
  console.log(
    `  REACHABILITY: ${count} natural 0x2CE6 dispatches in 4000 frames; ` +
    `arms ${JSON.stringify(arms)}; counter ${Math.max(...values)}..${Math.min(...values)}`,
  );
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_2ce6 == oracle on every captured 0x2CE6 entry", () => {
  const caps = captureDispatches(400, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2CE6 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_2ce6); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (all skip arm)`);
});

// -- 2. EQUAL (crafted: every clear index, the boundary, and an acting renderer frame) ----

test("EQUAL (crafted): every clear index, the 4/5 skip cases, and an acting renderer frame", () => {
  const caps = captureDispatches(1, 4000);
  assert.ok(caps.length >= 1, "expected a real 0x2CE6 dispatch to craft from");
  const cap = caps[0];

  const cases = [
    { name: "remaining 0 -> clear record 0", opts: { remaining: 0 }, cleared: 0 },
    { name: "remaining 1 -> clear record 1", opts: { remaining: 1 }, cleared: 1 },
    { name: "remaining 2 -> clear record 2", opts: { remaining: 2 }, cleared: 2 },
    { name: "remaining 3 -> clear record 3", opts: { remaining: 3 }, cleared: 3 },
    { name: "remaining 4 -> boundary, no clear", opts: { remaining: 4 }, cleared: null },
    { name: "remaining 5 -> no clear", opts: { remaining: 5 }, cleared: null },
    // Same clear, but the continuation runs the renderer's acting frame rather than its gate return.
    { name: "remaining 2, acting renderer frame", opts: { remaining: 2, gate: 0x01, counter: 0x00 }, cleared: 2 },
  ];

  for (const { name, opts, cleared } of cases) {
    const entry = craft(cap, opts);
    const diffs = contractDiffs(entry, loc_2ce6);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const o = runOracle(entry);
    const c = runCandidate(entry, loc_2ce6);

    // Non-vacuity 1: the intended record was blanked and NOTHING else in the group (or in the
    // neighbouring OBJ_65A0_SPRITES record just past it) moved — on BOTH sides.
    for (let a = COUNTDOWN_SPRITES; a < SENTINEL_END; a++) {
      const want = cleared !== null && a === recordX(cleared) ? 0 : 0xa0 + (a - COUNTDOWN_SPRITES);
      assert.equal(o.mem.read8(a), want, `${name}: oracle ${hx(a)}`);
      assert.equal(c.mem.read8(a), want, `${name}: loc_2ce6 ${hx(a)}`);
    }

    // Non-vacuity 2: the continuation really ran — the barrel record downstream got its preset.
    const preset = entry.mem.read8(BARREL_CLAIM_MODE) & 0x80 ? [0x19, 0x0c] : [0x15, 0x0b];
    for (const [off, want] of [[OBJ_SPRITE_CODE, preset[0]], [OBJ_SPRITE_ATTR, preset[1]]]) {
      assert.equal(o.mem.read8(entry.regs.ix + off), want, `${name}: oracle barrel record +${off}`);
      assert.equal(c.mem.read8(entry.regs.ix + off), want, `${name}: loc_2ce6 barrel record +${off}`);
    }

    // Live-out: both sides return to the address that was on the stack at entry, SP popped by 2.
    const retAddr = entry.mem.read16(entry.regs.sp);
    assert.equal(o.pc, retAddr, `${name}: oracle should return to ${hx(retAddr)}`);
    assert.equal(c.pc, retAddr, `${name}: loc_2ce6 should return to ${hx(retAddr)}`);
    assert.equal(c.regs.sp, (entry.regs.sp + 2) & 0xffff, `${name}: SP should pop exactly one return address`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} cases identical to the oracle; clears + presets + return boundary asserted`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-stride, boundary and drop-continuation twins are CAUGHT", () => {
  const caps = captureDispatches(1, 4000);
  const cap = caps[0];

  // (a) wrong-stride: at remaining 3 the correct record is 3 (0x69B4); a 2-byte stride hits
  // 0x69AE instead, so the group differs at BOTH addresses and the lower one is reported.
  const strideEntry = craft(cap, { remaining: 3 });
  const strideDiffs = contractDiffs(strideEntry, brokenWrongStride);
  assert.ok(strideDiffs.length > 0, "the wrong-stride twin escaped — the record indexing is unproven");
  assert.ok(
    strideDiffs[0].startsWith(`RAM@${hx(COUNTDOWN_SPRITES + 6)}`),
    `expected the diff at ${hx(COUNTDOWN_SPRITES + 6)}, got ${strideDiffs[0]}`,
  );

  // (b) boundary: at remaining 4 the correct routine writes nothing; `<=` blanks the first record
  // of the neighbouring OBJ_65A0_SPRITES group.
  const boundaryEntry = craft(cap, { remaining: 4 });
  const boundaryDiffs = contractDiffs(boundaryEntry, brokenBoundary);
  assert.ok(boundaryDiffs.length > 0, "the boundary twin escaped — the compare limit is unproven");
  assert.ok(
    boundaryDiffs[0].startsWith(`RAM@${hx(OBJ_65A0_SPRITES + SPRITE_X)}`),
    `expected the diff at ${hx(OBJ_65A0_SPRITES + SPRITE_X)}, got ${boundaryDiffs[0]}`,
  );

  // (c) drop-continuation: the clear is right, but stampReleasedBarrelKind never runs, so the renderer's
  // frame-gate decrement at 0x62AF is missing (and so is the barrel-record preset above it).
  const dropEntry = craft(cap, { remaining: 2 });
  const dropDiffs = contractDiffs(dropEntry, brokenDropContinuation);
  assert.ok(dropDiffs.length > 0, "the drop-continuation twin escaped — the continuation is unproven");
  assert.ok(
    dropDiffs[0].startsWith(`RAM@${hx(FRAME_GATE)}`),
    `expected the diff at the frame gate ${hx(FRAME_GATE)}, got ${dropDiffs[0]}`,
  );

  console.log(
    `  TEETH: wrong-stride caught (${strideDiffs[0]}); boundary caught (${boundaryDiffs[0]}); ` +
    `drop-continuation caught (${dropDiffs[0]})`,
  );
});
