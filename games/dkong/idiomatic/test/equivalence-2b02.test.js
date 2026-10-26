// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for moveMarioX (ROM 0x2B02) — advance Mario's X by the current
 * velocity, mirror it into the sprite record, then clamp one pixel at the horizontal
 * limits via the position gate limitMarioHorizontalTravel.
 *
 * move_2b02 is reached only on the moving-platform boards, through the platform-row
 * mover sub_2ad3 / arm_2af6 (Y == 0x50 / 0x78 / 0xC8). Attract never rides those rows,
 * so there are ZERO real 0x2B02 dispatches in a long attract run (see REACHABILITY);
 * coverage is therefore CRAFTED on a real attract base. The routine's whole
 * memory-observable behaviour is a total function of:
 *   - the new X it stamps: (velocity + prior X), truncated to 8 bits;
 *   - the position-gate verdict limitMarioHorizontalTravel returns for that new X, which depends on the
 *     new X, MARIO_Y (>= 0x58 band) and BOARD parity;
 * so a sweep over all 256 new-X values x both board parities x both Y bands drives every
 * verdict — far-left/default (1,0) -> nudge X right, far-right (0,1) -> nudge X left,
 * and blocked (0,0) -> leave X — with a fixed nonzero velocity split so the add (and its
 * 8-bit wrap) is exercised at each X.
 *
 * DISSOLVED CALL / STACK: the oracle brackets its clamp with `push16 0x2b0c ; call
 * 0x241f` (sub_241f `ret`s it back) and ends each path with `ret`. The idiomatic routine
 * models no stack (a direct limitMarioHorizontalTravel call + plain returns), so runCandidate performs ONE
 * m.ret() after it to line pc + SP up with the oracle, and the RAM diff excludes the dead
 * STACK_SCRATCH [0x6be0,0x6c00) the oracle's push writes.
 *
 *   1. REACHABILITY — 0x2B02 is NOT dispatched during attract (documents why the gate is
 *      crafted; if this ever becomes nonzero, add captured coverage).
 *   2. EQUAL (crafted sweep) — moveMarioX == oracle over the full 256 x 2 x 2 space
 *      (RAM - the stack scratch below the entry SP, pc, SP).
 *   3. TEETH — three broken twins, each MUST be caught:
 *      (a) drops the +velocity (writes prior X)          -> MARIO_X / sprite record diverge.
 *      (b) mirrors the edge nudge into the sprite record -> sprite record diverges at the edges.
 *      (c) swaps the two edge directions                 -> MARIO_X diverges at an edge nudge.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b02.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b02 as oracle } from "../../translated/loc_2b02.js";
import { moveMarioX } from "../moveMarioX.js";
import { limitMarioHorizontalTravel } from "../limitMarioHorizontalTravel.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_X, MARIO_Y, BOARD, MARIO_SPRITE_RECORD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b02;
// A plausible caller return address the modelled `ret` pops. Its value is irrelevant to
// the compare — both oracle and candidate pop the SAME byte — it only needs the two sides
// to agree, which they do by construction.
const RET_ADDR = 0x2ad9;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region (the memory-equivalence contract is RAM - the stack scratch below the entry SP). { addr, a, b } | null.
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM - the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
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
// realistic values. The moving-platform mover is never reached here; it is crafted.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x2B02 dispatch onto a clone of the base: a stack with a plausible
 * caller return (so the terminal `ret` has a sane target), the velocity + prior X in the
 * live-in registers, and the Y / board the position gate reads. MARIO_X itself is NOT
 * poked — the routine overwrites it with (velocity + prior X) before the gate reads it.
 */
function craft(base, { velocity, priorX, y, board }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.a = velocity;
  m.regs.b = priorX;
  m.mem.write8(MARIO_Y, y);
  m.mem.write8(BOARD, board);
  return m;
}

// The crafted sweep: for every intended new X, split it as a fixed nonzero velocity plus
// the prior X that makes velocity + priorX land on that new X (mod 256) — so the add is
// real and wraps for new X < the velocity. Cross every board parity and Y band so limitMarioHorizontalTravel
// yields each verdict (odd/even board, below/at-or-above the 0x58 band).
const VELOCITY = 0x37; // fixed, nonzero, so a "dropped +velocity" twin is catchable
const BOARDS = [0x01, 0x02]; // odd (25m/75m) and even (50m/100m) — only bit0 matters to the gate
const YBANDS = [0x30, 0x60]; // below 0x58, and at/above 0x58

function sweep(candidate) {
  const base = attractBase();
  let count = 0;
  for (let newX = 0; newX < 256; newX++) {
    const priorX = (newX - VELOCITY) & 0xff;
    for (const board of BOARDS) {
      for (const y of YBANDS) {
        const entry = craft(base, { velocity: VELOCITY, priorX, y, board });
        const diffs = contractDiffs(entry, candidate);
        count++;
        if (diffs.length) return { mismatch: { newX, priorX, board, y, diffs }, count };
      }
    }
  }
  return { mismatch: null, count };
}

const describe = (mm) =>
  mm &&
  `at newX=${hx(mm.newX)} (velocity=${hx(VELOCITY)} priorX=${hx(mm.priorX)}) ` +
    `board=${hx(mm.board)} y=${hx(mm.y)}: ${mm.diffs.join("; ")}`;

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x2B02 is NOT dispatched during attract (gate must be crafted)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.equal(count, 0, `expected 0 natural 0x2B02 dispatches in attract, saw ${count} — add captured coverage`);
  console.log(`  REACHABILITY: 0 natural 0x2B02 dispatches in 3000 attract frames — crafted entries are load-bearing`);
});

// -- 2. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL (crafted sweep): moveMarioX == oracle over all new-X x parity x Y-band", () => {
  const { mismatch, count } = sweep(moveMarioX);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256 * BOARDS.length * YBANDS.length, "must have compared the full crafted space");
  console.log(`  EQUAL/crafted: ${count} (new-X, board, Y) combos — RAM - the stack scratch below the entry SP, pc, SP identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): drops the +velocity — writes the prior X as the new position. */
function brokenNoVelocity(m) {
  const { regs, mem } = m;
  const newX = regs.b; // BUG: should be regs.a + regs.b
  mem.write8(MARIO_X, newX);
  mem.write8(MARIO_SPRITE_RECORD, newX);
  const { d, e } = limitMarioHorizontalTravel(m);
  if (e === 1) { mem.write8(MARIO_X, mem.read8(MARIO_X) - 1); return; }
  if (d === 1) { mem.write8(MARIO_X, mem.read8(MARIO_X) + 1); return; }
}

/** BUG (b): mirrors the edge nudge into the sprite record too. */
function brokenMirrorNudge(m) {
  const { regs, mem } = m;
  const newX = regs.a + regs.b;
  mem.write8(MARIO_X, newX);
  mem.write8(MARIO_SPRITE_RECORD, newX);
  const { d, e } = limitMarioHorizontalTravel(m);
  if (e === 1) {
    mem.write8(MARIO_X, mem.read8(MARIO_X) - 1);
    mem.write8(MARIO_SPRITE_RECORD, mem.read8(MARIO_SPRITE_RECORD) - 1); // BUG: nudge the mirror
    return;
  }
  if (d === 1) {
    mem.write8(MARIO_X, mem.read8(MARIO_X) + 1);
    mem.write8(MARIO_SPRITE_RECORD, mem.read8(MARIO_SPRITE_RECORD) + 1); // BUG: nudge the mirror
    return;
  }
}

/** BUG (c): swaps the two edge directions (far-right pushes right, far-left pulls left). */
function brokenSwapEdges(m) {
  const { regs, mem } = m;
  const newX = regs.a + regs.b;
  mem.write8(MARIO_X, newX);
  mem.write8(MARIO_SPRITE_RECORD, newX);
  const { d, e } = limitMarioHorizontalTravel(m);
  if (e === 1) { mem.write8(MARIO_X, mem.read8(MARIO_X) + 1); return; } // BUG: should dec
  if (d === 1) { mem.write8(MARIO_X, mem.read8(MARIO_X) - 1); return; } // BUG: should inc
}

test("TEETH: the dropped-velocity twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenNoVelocity);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped +velocity — the gate is worthless");
  console.log(`  TEETH/velocity: caught — ${describe(mismatch)}`);
});

test("TEETH: the mirror-the-nudge twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenMirrorNudge);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a nudge mirrored into the sprite record — worthless");
  assert.equal(mismatch.diffs.length > 0 && /694c/i.test(mismatch.diffs[0]), true,
    `expected the mirror twin to diverge on the sprite record (0x694c), got ${mismatch.diffs[0]}`);
  console.log(`  TEETH/mirror: caught — ${describe(mismatch)}`);
});

test("TEETH: the swapped-edges twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenSwapEdges);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch swapped edge directions — worthless");
  console.log(`  TEETH/swap: caught — ${describe(mismatch)}`);
});
