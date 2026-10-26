// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stepSpriteAnimationSequence (ROM 0x1839) — index 2 of the
 * 0x6388-driven sprite animation sequence (dispatchRivetBoardInterludeStep's rst-0x28 table).
 *
 * loc_1839 WRITES memory (the 0x6390 sub-counter always; on a stamp the ten-record
 * SPRITE_OBJ_BLOCK; on the counter's wrap also SUBSTATE_TIMER and the 0x6388 selector)
 * and it is UNREACHED in attract (0 dispatches over 4000 frames — it is a post-board
 * interlude step), so it is validated by crafted-entry capture/clone/replay on a FRESH
 * clone per side, never the full register file, never cycles. Its whole input surface
 * is two RAM bytes — the 0x6390 sub-counter and the 0x6388 selector — so the sweep is
 * effectively EXHAUSTIVE. The contract compared is RAM (minus the stack scratch below the entry SP); live-out
 * is memory-only (the sequence-dispatcher successor reads none of the residual regs).
 *
 *   1. EQUAL (exhaustive over 0x6390) — from a real attract RAM base, sweep the stored
 *      0x6390 byte over all 256 values (the routine increments it, so this drives every
 *      post-increment counter: the early return, frame-A and frame-B stamps, and the
 *      wrap). For each, oracle vs candidate on two fresh clones, identical RAM (ex-stack).
 *
 *   2. EQUAL (wrap-selector breadth) — force the wrap (0x6390 = 0xFF) and sweep the
 *      0x6388 selector over all 256 values, confirming the 0x6388++ advance and the
 *      SUBSTATE_TIMER re-arm match the oracle for every selector value.
 *
 *   3. ARMS (coverage is not vacuous) — on the oracle, confirm each arm actually fires
 *      with a DISTINCTIVE memory effect: the early return touches only 0x6390; frame A
 *      and frame B stamp DIFFERENT sprite blocks (so the bit-3 select genuinely matters);
 *      the wrap sets SUBSTATE_TIMER = 0x20 and advances 0x6388. This is what gives the
 *      exhaustive sweep and the teeth twin something real to bite on.
 *
 *   4. TEETH (exhaustive) — a twin that selects the frame on the WRONG counter bit
 *      (bit 4, mask 0x10, instead of bit 3, mask 0x08) MUST be caught by the same 0x6390
 *      sweep (it stamps the wrong template on the very first 8th tick, counter = 0x08).
 *
 * NOT COMPARED, deliberately: SP, PC, the full register file, cycles. The oracle's
 * terminal `ret` pops the stack and vectors PC; the idiomatic layer drops that
 * bookkeeping (the JS call stack replaces it). Residual A/HL/DE/BC/flags are dead ABI.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1839.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1839 as oracle } from "../../translated/loc_1839.js";
import { stepSpriteAnimationSequence } from "../stepSpriteAnimationSequence.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const ANIM_COUNTER = 0x6390; // stored sub-counter (routine increments it)
const SEQ_SELECTOR = 0x6388; // sequence step selector
const SUBSTATE_TIMER = 0x6009; // hold timer re-armed on wrap
const OBJ_BLOCK_BYTES = 0x28; // ten 4-byte sprite records

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Craft an entry from a real base: fresh clone, SP parked in STACK_SCRATCH (so the
 * oracle's callee push/pop and terminal `ret` land in the skipped region), and the
 * two input bytes poked. Returns a machine ready to run one side on.
 */
function craftEntry(base, counterByte, selectorByte) {
  const w = base.clone();
  w.regs.sp = 0x6bfe; // inside STACK_SCRATCH [0x6be0,0x6c00)
  w.mem.write8(ANIM_COUNTER, counterByte & 0xff);
  if (selectorByte !== undefined) w.mem.write8(SEQ_SELECTOR, selectorByte & 0xff);
  return w;
}

/** Run oracle and candidate on two fresh clones of `entry`; return first RAM diff. */
function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/** A real attract RAM base: booted machine, work RAM populated, no overrides so the
 *  oracle's m.call(0x004e)/(0x0038) resolve to the frozen translated callees. */
function attractBase() {
  const host = new Machine(ROM);
  host.runFrames(600);
  return host.clone();
}

// -- 1. EQUAL (exhaustive over the 0x6390 sub-counter) ------------------------

test("EQUAL (exhaustive): all 256 sub-counter values match the oracle (RAM ex-stack)", () => {
  const base = attractBase();
  let count = 0;
  for (let s = 0; s < 256; s++) {
    const ram = diffAgainstOracle(craftEntry(base, s), stepSpriteAnimationSequence);
    count++;
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} for 0x6390=${hx(s)}: oracle=${ram.a} cand=${ram.b}`);
  }
  assert.equal(count, 256, "must have swept all 256 sub-counter values");
  console.log(`  EQUAL/exhaustive: ${count} sub-counter values identical to the oracle (RAM ex-stack)`);
});

// -- 2. EQUAL (wrap-selector breadth) -----------------------------------------

test("EQUAL (wrap breadth): all 256 selector values on the wrap arm match the oracle", () => {
  const base = attractBase();
  let count = 0;
  for (let sel = 0; sel < 256; sel++) {
    // 0x6390 = 0xFF -> increments to 0x00 -> the wrap arm (advances 0x6388, arms 0x6009).
    const ram = diffAgainstOracle(craftEntry(base, 0xff, sel), stepSpriteAnimationSequence);
    count++;
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} for wrap 0x6388=${hx(sel)}: oracle=${ram.a} cand=${ram.b}`);
  }
  assert.equal(count, 256, "must have swept all 256 selector values on the wrap arm");
  console.log(`  EQUAL/wrap-breadth: ${count} selector values on the wrap arm identical to the oracle`);
});

// -- 3. ARMS (the sweep is not vacuous) ---------------------------------------

/** Run the oracle on a crafted (counter, selector) and report the memory effect. */
function oracleEffect(base, counterByte, selectorByte) {
  const before = craftEntry(base, counterByte, selectorByte);
  const after = before.clone();
  oracle(after);
  return {
    counterAfter: after.mem.read8(ANIM_COUNTER),
    selectorAfter: after.mem.read8(SEQ_SELECTOR),
    timerAfter: after.mem.read8(SUBSTATE_TIMER),
    block: Array.from({ length: OBJ_BLOCK_BYTES }, (_, i) => after.mem.read8((SPRITE_OBJ_BLOCK + i) & 0xffff)),
    blockBefore: Array.from({ length: OBJ_BLOCK_BYTES }, (_, i) => before.mem.read8((SPRITE_OBJ_BLOCK + i) & 0xffff)),
  };
}

test("ARMS: early-return / frame-A / frame-B / wrap each fire with a distinctive effect", () => {
  const base = attractBase();
  const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

  // Early return: 0x6390=0x00 -> counter 0x01 (low bits set) -> only the counter moves.
  const early = oracleEffect(base, 0x00, 0x10);
  assert.equal(early.counterAfter, 0x01, "early-return arm must still increment 0x6390");
  assert.ok(eq(early.block, early.blockBefore), "early-return arm must NOT stamp the sprite block");

  // Frame A: 0x6390=0x07 -> counter 0x08 (bit 3 set) -> stamp template 0x39CF.
  const frameA = oracleEffect(base, 0x07, 0x10);
  assert.ok(!eq(frameA.block, frameA.blockBefore), "frame-A arm must stamp the sprite block");

  // Frame B: 0x6390=0x0F -> counter 0x10 (bit 3 clear) -> stamp template 0x39F7.
  const frameB = oracleEffect(base, 0x0f, 0x10);
  assert.ok(!eq(frameB.block, frameB.blockBefore), "frame-B arm must stamp the sprite block");
  assert.ok(!eq(frameA.block, frameB.block), "frame A and frame B must stamp DIFFERENT blocks (bit-3 select is real)");

  // Wrap: 0x6390=0xFF -> counter 0x00 -> base figure + arm timer + advance selector.
  const wrap = oracleEffect(base, 0xff, 0x10);
  assert.equal(wrap.timerAfter, 0x20, "wrap arm must re-arm SUBSTATE_TIMER to 0x20");
  assert.equal(wrap.selectorAfter, 0x11, "wrap arm must advance the 0x6388 selector (0x10 -> 0x11)");
  assert.ok(!eq(wrap.block, wrap.blockBefore), "wrap arm must stamp the base figure");

  console.log("  ARMS: early-return, frame-A, frame-B (distinct), and wrap all exercised with distinctive effects");
});

// -- 4. TEETH (exhaustive) ----------------------------------------------------

/** Broken twin: selects the animation frame on the WRONG counter bit (bit 4 / 0x10
 *  instead of bit 3 / 0x08). Otherwise byte-for-byte the real routine. */
function brokenStep(m) {
  const { regs, mem } = m;
  const counter = (mem.read8(ANIM_COUNTER) + 1) & 0xff;
  mem.write8(ANIM_COUNTER, counter);
  const stamp = (templateAddr) => {
    regs.hl = templateAddr;
    loadSpriteObjectBlock(m);
    regs.hl = SPRITE_OBJ_BLOCK;
    regs.c = 0x44;
    addToSpriteObjectColumn(m);
  };
  if (counter === 0) {
    stamp(0x385c);
    mem.write8(SUBSTATE_TIMER, 0x20);
    mem.write8(SEQ_SELECTOR, (mem.read8(SEQ_SELECTOR) + 1) & 0xff);
    return;
  }
  if ((counter & 0x07) !== 0) return;
  stamp((counter & 0x10) !== 0 ? 0x39cf : 0x39f7); // BUG: 0x10 should be 0x08
}

test("TEETH (exhaustive): the wrong-bit frame-select twin is CAUGHT by the sweep", () => {
  const base = attractBase();
  let caughtAt = null;
  for (let s = 0; s < 256; s++) {
    const ram = diffAgainstOracle(craftEntry(base, s), brokenStep);
    if (ram) { caughtAt = { s, ram }; break; }
  }
  assert.notEqual(caughtAt, null, "the sweep FAILED to catch the wrong frame-select bit — it is worthless");
  console.log(
    `  TEETH/exhaustive: caught at 0x6390=${hx(caughtAt.s)} — RAM diff at ${hx(caughtAt.ram.addr)} ` +
      `(oracle=${caughtAt.ram.a} broken=${caughtAt.ram.b})`,
  );
});
