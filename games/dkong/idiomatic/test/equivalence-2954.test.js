// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for latchHammerTouch (ROM 0x2954) — the hammer-touch latch: gate on the board, test
 * Mario against the two-record hammer pair, store the overlap flag into MARIO_HAMMER_PENDING,
 * pulse the item/score sound trigger, and mark the touched record as the pair's selected one.
 *
 * CONTRACT. The routine's live-out is MEMORY ONLY plus control flow. It returns nothing, and its
 * caller chain (ROM 0x1C33 falls into the player-sprite copy at 0x1DA6, whose first two actions
 * reload the accumulator and its pointer from memory) reads no register or flag it leaves
 * behind. So each case compares:
 *   - work RAM minus the stack scratch below the entry SP,
 *   - pc and SP,
 *   - the RETURN VALUE (undefined on every arm, on both sides).
 * The register file is deliberately NOT compared: the oracle's terminal `ld a,b / and a / cp 1`
 * leaves the accumulator holding the residue while the idiomatic form leaves it holding the
 * overlap flag, and on the closed-gate arm the oracle's rst-0x30 rotates A and zeroes B. Both
 * are dead — see the reasoning above.
 *
 * STACK. The oracle brackets two calls with real Z80 pushes (its rst-0x30 return address and the
 * `call 0x2974` return address, plus what those callees push), and every arm ends with a single
 * net caller-return: the open gate returns through the routine's own `ret`, and the CLOSED gate
 * returns through rst-0x30's `pop hl / ret`, which discards the routine's own return address
 * instead. Both leave pc = the caller's return address and SP = entry + 2. The idiomatic form
 * models no stack, so the harness performs exactly ONE terminal `m.ret()` after the candidate to
 * line pc/SP up. The bytes the oracle's bracket leaves behind land in STACK_SCRATCH — measured
 * at a real dispatch: SP enters at 0x6BEA and the deepest push reaches 0x6BE4, inside the
 * [0x6BE0, 0x6C00) region — and are excluded from the memory compare.
 *
 *   0. REACHABILITY — 0x2954 IS naturally reachable: the 25m attract demo jumps at hammers and
 *      dispatches it 4x in 2000 frames (14x in 12000).
 *
 *   1. EQUAL (captured) — hook 0x2954 in a real attract run and confirm latchHammerTouch == oracle on
 *      every real dispatch. Those four dispatches already span the no-overlap arm and one
 *      genuine record-1 hammer touch, but four is thin, hence case 2.
 *
 *   2. EQUAL (crafted) — a real attract state with the two records, Mario's X/Y and BOARD poked
 *      identically on both sides, pinning every arm: the closed board gate (75m), a miss that
 *      must CLEAR an already-set latch and sound, a hit on the pair's first record, a hit on its
 *      second, and both-active (the first wins). Each asserts the oracle's ABSOLUTE cell values
 *      as well as oracle == candidate, so a both-sides-wrong reading cannot pass.
 *
 *   3. TEETH — four broken twins the same suite MUST catch: one that marks the wrong record of
 *      the pair, one that skips the unconditional clear on a miss, one that asserts the sound
 *      for the usual 3 frames instead of 64, and one that drops the board gate.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2954.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2954 as oracle } from "../../translated/loc_2954.js";
import { latchHammerTouch } from "../latchHammerTouch.js";
import { findHammerOverlappingMario } from "../findHammerOverlappingMario.js";
import { boardBitGate } from "../boardBitGate.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_X,
  MARIO_Y,
  MARIO_HAMMER_PENDING,
  SND_TRIGGER,
  OBJ_PAIR_6680,
  HAMMER_IN_PLAY,
  BOARD,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2954;
const SP_TOP = 0x6c00;   // stack top — inside STACK_SCRATCH, so every push is excluded
const RET_ADDR = 0x1c37; // the real `call 0x2954` return site (in ROM 0x1C33)

const REC0 = OBJ_PAIR_6680;                    // the pair's first record  (0x6680)
const REC1 = (OBJ_PAIR_6680 + 0x10) & 0xffff;  // the pair's second record (0x6690)
const SEL0 = REC0 + HAMMER_IN_PLAY;            // 0x6681 — first record's in-play flag
const SEL1 = REC1 + HAMMER_IN_PLAY;            // 0x6691 — second record's in-play flag
const PICKUP_SOUND = SND_TRIGGER + 5;          // 0x6085 — the item/score sound trigger

const BOARD_25M = 0x01; // hammer board  — mask 0x0b bit0 set, gate OPEN
const BOARD_75M = 0x03; // no hammer     — mask 0x0b bit2 clear, gate CLOSED

const MX = 0x40; // crafted Mario X (the search's axis-2 reference)
const MY = 0x80; // crafted Mario Y (the search's axis-1 reference)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP.
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

/**
 * Run the candidate on a fresh clone, then model the SINGLE terminal caller-return the ROM
 * performs on every arm so pc + SP line up with the oracle. latchHammerTouch models no stack.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.ret();
  return { c, ret };
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP, and the return value. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const k = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o.c, k.c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.c.pc !== k.c.pc) diffs.push(`pc oracle=${hx(o.c.pc)} cand=${hx(k.c.pc)}`);
  if (o.c.regs.sp !== k.c.regs.sp) diffs.push(`SP oracle=${hx(o.c.regs.sp)} cand=${hx(k.c.regs.sp)}`);
  if (o.ret !== k.ret) diffs.push(`return oracle=${String(o.ret)} cand=${String(k.ret)}`);
  return diffs;
}

/** The four cells this routine can write, read off a machine. */
function cells(m) {
  return {
    pending: m.mem.read8(MARIO_HAMMER_PENDING),
    sound: m.mem.read8(PICKUP_SOUND),
    sel0: m.mem.read8(SEL0),
    sel1: m.mem.read8(SEL1),
  };
}

// A real attract machine so surrounding RAM is realistic; clone() neutralises the frame
// machinery (nextNmi/nextBoundary = Infinity) so the oracle's steps cannot fire an NMI.
function attractBase(frames = 120) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// Write the record fields the pair search reads: +0 flag (bit0 = the slot holds an object),
// +3 the axis-2 coordinate, +5 the axis-1 coordinate, +9/+0x0A the per-axis extra spans.
function putRecord(m, base, { live, f3 = 0, f5 = 0 }) {
  m.mem.write8((base + 0x00) & 0xffff, live ? 0x01 : 0x00);
  m.mem.write8((base + 0x03) & 0xffff, f3 & 0xff);
  m.mem.write8((base + 0x05) & 0xffff, f5 & 0xff);
  m.mem.write8((base + 0x09) & 0xffff, 0x00);
  m.mem.write8((base + 0x0a) & 0xffff, 0x00);
}

/**
 * Stamp a crafted 0x2954 dispatch onto a clone of the base: a stack with the real caller return
 * (so the terminal `ret` has a sane target), the board, Mario's X/Y, the two records, and a
 * starting value for each of the four cells the routine writes.
 */
function craft(base, { board = BOARD_25M, rec0, rec1, mx = MX, my = MY, pre = {} }) {
  const m = base.clone();
  m.regs.sp = SP_TOP;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board);
  m.mem.write8(MARIO_X, mx & 0xff);
  m.mem.write8(MARIO_Y, my & 0xff);
  putRecord(m, REC0, rec0);
  putRecord(m, REC1, rec1);
  m.mem.write8(MARIO_HAMMER_PENDING, pre.pending ?? 0);
  m.mem.write8(PICKUP_SOUND, pre.sound ?? 0);
  m.mem.write8(SEL0, pre.sel0 ?? 0);
  m.mem.write8(SEL1, pre.sel1 ?? 0);
  return m;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2954 is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(count > 0, "0x2954 should be dispatched — the attract demo jumps at a hammer");
  console.log(`  REACHABILITY: ${count} natural 0x2954 dispatches in 2000 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): latchHammerTouch == oracle on every real 0x2954 dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2954 dispatch during attract");

  let touches = 0, misses = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, latchHammerTouch);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    if (runOracle(entry).c.mem.read8(MARIO_HAMMER_PENDING) === 1) touches++; else misses++;
  }
  assert.ok(touches >= 1, "expected at least one real hammer TOUCH among the captured dispatches");
  assert.ok(misses >= 1, "expected at least one real no-overlap dispatch");
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical (${touches} touch, ${misses} miss)`);
});

// -- 2. EQUAL (crafted, every arm pinned) -------------------------------------

const CRAFTED = [
  {
    name: "board gate CLOSED (75m) — nothing is touched",
    opts: {
      board: BOARD_75M,
      rec0: { live: true, f3: MX, f5: MY }, // would be a hit if the gate were open
      rec1: { live: false },
      pre: { pending: 1, sound: 3, sel0: 0, sel1: 0 },
    },
    want: { pending: 1, sound: 3, sel0: 0, sel1: 0 },
  },
  {
    name: "no overlap — CLEARS the latch and the sound a previous run set",
    opts: {
      rec0: { live: false },
      rec1: { live: false },
      pre: { pending: 1, sound: 3, sel0: 0, sel1: 0 },
    },
    want: { pending: 0, sound: 0, sel0: 0, sel1: 0 },
  },
  {
    name: "live record out of range — still a miss, still clears",
    opts: {
      // axis-2 far off (|MX - f3| = 0x60, beyond the search's base tolerance of 4).
      rec0: { live: true, f3: (MX + 0x60) & 0xff, f5: MY },
      rec1: { live: false },
      pre: { pending: 1, sound: 3, sel0: 0, sel1: 0 },
    },
    want: { pending: 0, sound: 0, sel0: 0, sel1: 0 },
  },
  {
    name: "touch on the pair's FIRST record",
    opts: {
      rec0: { live: true, f3: MX, f5: MY },
      rec1: { live: false },
    },
    want: { pending: 1, sound: 64, sel0: 1, sel1: 0 },
  },
  {
    name: "touch on the pair's SECOND record",
    opts: {
      rec0: { live: false },
      rec1: { live: true, f3: MX, f5: MY },
    },
    want: { pending: 1, sound: 64, sel0: 0, sel1: 1 },
  },
  {
    name: "both records overlap — the FIRST one wins",
    opts: {
      rec0: { live: true, f3: MX, f5: MY },
      rec1: { live: true, f3: MX, f5: MY },
    },
    want: { pending: 1, sound: 64, sel0: 1, sel1: 0 },
  },
];

test("EQUAL (crafted): every arm matches the oracle, at the expected absolute values", () => {
  const base = attractBase();
  for (const { name, opts, want } of CRAFTED) {
    const entry = craft(base, opts);
    const got = cells(runOracle(entry).c);
    assert.deepEqual(got, want, `${name}: the ORACLE did not do what this case claims (got ${JSON.stringify(got)})`);
    const diffs = contractDiffs(entry, latchHammerTouch);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${CRAFTED.length} arms identical to the oracle at pinned values`);
});

// -- 3. TEETH -----------------------------------------------------------------

const HAMMER_BOARDS = 0x0b;
const PICKUP_SOUND_FRAMES = 64;
const PAIR_STRIDE = 0x10;

/** Broken twin (a): marks the OTHER record of the pair as the selected one. */
function twinWrongRecord(m) {
  const { regs, mem } = m;
  regs.a = HAMMER_BOARDS;
  if (!boardBitGate(m)) return;
  findHammerOverlappingMario(m);
  const touching = regs.a, matched = regs.b;
  mem.write8(MARIO_HAMMER_PENDING, touching);
  mem.write8(PICKUP_SOUND, touching ? PICKUP_SOUND_FRAMES : 0);
  if (matched === 0) return;
  const touched = matched === 1 ? OBJ_PAIR_6680 : OBJ_PAIR_6680 + PAIR_STRIDE; // BUG: swapped
  mem.write8(touched + HAMMER_IN_PLAY, 0x01);
}

/** Broken twin (b): only writes the latch and sound on a TOUCH, so a miss never clears them. */
function twinNoClear(m) {
  const { regs, mem } = m;
  regs.a = HAMMER_BOARDS;
  if (!boardBitGate(m)) return;
  findHammerOverlappingMario(m);
  const touching = regs.a, matched = regs.b;
  if (!touching) return; // BUG: the oracle writes both cells unconditionally
  mem.write8(MARIO_HAMMER_PENDING, touching);
  mem.write8(PICKUP_SOUND, PICKUP_SOUND_FRAMES);
  if (matched === 0) return;
  const touched = matched === 1 ? OBJ_PAIR_6680 + PAIR_STRIDE : OBJ_PAIR_6680;
  mem.write8(touched + HAMMER_IN_PLAY, 0x01);
}

/** Broken twin (c): asserts the sound for the usual 3 frames instead of 64. */
function twinShortSound(m) {
  const { regs, mem } = m;
  regs.a = HAMMER_BOARDS;
  if (!boardBitGate(m)) return;
  findHammerOverlappingMario(m);
  const touching = regs.a, matched = regs.b;
  mem.write8(MARIO_HAMMER_PENDING, touching);
  mem.write8(PICKUP_SOUND, touching ? 3 : 0); // BUG: the hammer pickup holds it for 64
  if (matched === 0) return;
  const touched = matched === 1 ? OBJ_PAIR_6680 + PAIR_STRIDE : OBJ_PAIR_6680;
  mem.write8(touched + HAMMER_IN_PLAY, 0x01);
}

/** Broken twin (d): drops the board gate, so it latches on 75m too. */
function twinNoGate(m) {
  const { regs, mem } = m;
  findHammerOverlappingMario(m); // BUG: no boardBitGate
  const touching = regs.a, matched = regs.b;
  mem.write8(MARIO_HAMMER_PENDING, touching);
  mem.write8(PICKUP_SOUND, touching ? PICKUP_SOUND_FRAMES : 0);
  if (matched === 0) return;
  const touched = matched === 1 ? OBJ_PAIR_6680 + PAIR_STRIDE : OBJ_PAIR_6680;
  mem.write8(touched + HAMMER_IN_PLAY, 0x01);
}

test("TEETH: all four broken twins are CAUGHT by the same crafted suite", () => {
  const base = attractBase();
  const twins = [
    ["wrong record marked", twinWrongRecord],
    ["miss does not clear", twinNoClear],
    ["sound too short", twinShortSound],
    ["board gate dropped", twinNoGate],
  ];

  const caught = [];
  for (const [label, twin] of twins) {
    let firstDiff = null;
    for (const { opts } of CRAFTED) {
      const diffs = contractDiffs(craft(base, opts), twin);
      if (diffs.length > 0) { firstDiff = diffs[0]; break; }
    }
    assert.ok(firstDiff, `the "${label}" twin escaped the whole crafted suite — the gate is worthless`);
    caught.push(`${label} (${firstDiff})`);
  }
  console.log(`  TEETH: ${caught.join("; ")}`);
});
