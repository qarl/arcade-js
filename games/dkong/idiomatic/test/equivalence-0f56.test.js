// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for initBoardState (ROM 0x0F56) — the per-board work-RAM
 * reset + bonus/timer setup + shared-sprite seed, which then tail-dispatches (via the
 * ROM 0x0FCD rst-0x28 table) to the board's own object setup (seed25m/50m/75m/100m).
 *
 * This is the cycle-free / memory-equivalence gate (docs/decompiler-pipeline), NOT the retired strict
 * whole-machine one. sub_0f56 WRITES a large span (0x6200–0x6226, 0x6280–0x6AFF, the
 * bonus bytes, and — via the dispatched board setup — the object/sprite records) and
 * reads only LEVEL (0x6229), BOARD (0x6227) and ROM. It has NO `ret`: it tail-jumps to
 * a board setup whose `ret` lands on a `call` (0x0D62) that reads no register it leaves,
 * so LIVE-OUT is memory-only. Every case therefore runs on a FRESH clone per side and
 * is compared on:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) only.
 *
 * NOT COMPARED, deliberately (like the sibling equivalence-0fd7 gate): SP, PC, cycles,
 * and the full register file. The oracle threads PC through m.step and balances the Z80
 * stack across its rst-0x28 push/pop + m.call/ret; the idiomatic layer drops that model
 * (direct JS calls, no m.step), so PC differs and any transient stack write lands only in
 * STACK_SCRATCH, which the RAM diff skips.
 *
 *   1. REALISM — hook 0x0F56 in a real attract run and clone at each real dispatch.
 *      Attract plays 25m, so the board build dispatches this routine with BOARD == 1.
 *      Oracle vs initBoardState on two fresh clones leave identical RAM (ex-stack).
 *
 *   2. LEVEL SWEEP — the routine's only real computation is the bonus/period arithmetic,
 *      keyed off LEVEL (0x6229). Attract is level 1, so poke LEVEL = 0..255 identically
 *      both sides on a real BOARD == 1 capture and confirm RAM matches for every value —
 *      an exhaustive check of the *10-mod-256, the 0x50 clamp, and the period formula.
 *
 *   3. CRAFTED BOARD 2/3/4 — the other three dispatch arms attract never reaches. Take a
 *      real capture and poke BOARD (0x6227) = 2/3/4 identically both sides; the routine
 *      clears the object span itself, so the board setup reads a well-defined (zeroed)
 *      state on both sides. Board 4 also exercises the bit-2 skip of the 0x6A00 seed.
 *      Plus a full-footprint sentinel prefill (0x6200–0x6AFF, both sides) so any short,
 *      missing, or mis-placed write surfaces as a sentinel-vs-written mismatch.
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) PERIOD-DOUBLE: drops the `add a,a`, computing 0xDC − bonus instead of
 *          0xDC − 2*bonus — caught at BONUS_PERIOD/BONUS_TICK on the real capture;
 *      (b) WRONG-GATE: gates the 0x6A00 seed on bit 1 instead of bit 2, so a crafted
 *          BOARD == 4 entry (which must SKIP the seed) is wrongly seeded — caught at 0x6A00.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0f56.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f56 as oracle } from "../../translated/loc_0f56.js";
import { initBoardState } from "../initBoardState.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0f56;
const LEVEL = 0x6229;
const BOARD = 0x6227;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = ma.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

/**
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing,
 * dispatching routine demands a fresh clone per side) and diff RAM (ex-stack). The
 * oracle's nested m.call(0x0fd7/0x101f/0x1087/0x1131) resolve through the clone's
 * default (oracle) registry to the translated board setups.
 */
function diffRam(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * Hook 0x0F56 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop.
 */
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

/** Fresh clone of `entry` with one byte poked (applied identically to both sides by diffRam). */
function craftPoke(cap, addr, val) {
  const w = cap.clone();
  w.mem.write8(addr, val);
  return w;
}

/** Fresh clone of `entry` sentinel-filled across the whole write footprint (both sides). */
function craftPrefill(cap, sentinel, addr, val) {
  const w = cap.clone();
  for (let a = 0x6200; a <= 0x6aff; a++) w.mem.write8(a, sentinel);
  if (addr !== undefined) w.mem.write8(addr, val);
  return w;
}

// -- 1. REALISM (captured attract dispatches, BOARD == 1) ---------------------

test("REALISM: real captured 0x0F56 dispatches (BOARD 1) — RAM (ex-stack) matches the oracle", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x0F56 dispatch during attract");

  for (const cap of caps) {
    const ram = diffRam(cap, initBoardState);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  REALISM: ${caps.length} real 0x0F56 dispatch(es) — identical RAM (ex-stack)`);
});

// -- 2. LEVEL SWEEP (exhaustive over the bonus/period arithmetic) -------------

test("LEVEL SWEEP: bonus/period arithmetic matches the oracle for LEVEL = 0..255", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to sweep LEVEL over");

  for (let level = 0; level < 256; level++) {
    const w = craftPoke(base, LEVEL, level);
    const ram = diffRam(w, initBoardState);
    assert.equal(
      ram,
      null,
      ram && `[LEVEL=${hx(level)}] RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`,
    );
  }
  console.log("  LEVEL SWEEP: all 256 LEVEL values — bonus/period identical to the oracle");
});

// -- 3. CRAFTED (the BOARD 2/3/4 dispatch arms + footprint prefill) -----------

test("CRAFTED: BOARD 2/3/4 dispatch arms + footprint prefill — RAM (ex-stack) matches the oracle", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to derive crafted entries from");

  for (const board of [2, 3, 4]) {
    const w = craftPoke(base, BOARD, board);
    const ram = diffRam(w, initBoardState);
    assert.equal(
      ram,
      null,
      ram && `[BOARD=${board}] RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`,
    );

    for (const sentinel of [0xa5, 0x00]) {
      const wp = craftPrefill(base, sentinel, BOARD, board);
      const rp = diffRam(wp, initBoardState);
      assert.equal(
        rp,
        null,
        rp && `[BOARD=${board} prefill ${hx(sentinel)}] RAM diff at ${hx(rp.addr)}: oracle=${rp.a} cand=${rp.b}`,
      );
    }
  }
  console.log("  CRAFTED: BOARD 2/3/4 arms + 0xA5/0x00 footprint prefills identical to the oracle");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): PERIOD-DOUBLE — 0xDC - bonus instead of 0xDC - 2*bonus. */
function periodDoubleTwin(m) {
  const { mem } = m;
  for (let a = 0x6200; a <= 0x6226; a++) mem.write8(a, 0x00);
  for (let a = 0x6280; a < 0x6b00; a++) mem.write8(a, 0x00);
  for (let i = 0; i < 0x40; i++) mem.write8(0x6280 + i, mem.read8(0x3d9c + i));
  let bonus = (mem.read8(0x6229) * 10 + 0x28) & 0xff;
  if (bonus > 0x50) bonus = 0x50;
  mem.write8(0x62b0, bonus);
  mem.write8(0x62b1, bonus);
  mem.write8(0x62b2, bonus);
  let period = (0xdc - bonus) & 0xff; // BUG: dropped the `add a,a` (should be 2*bonus)
  if (period < 0x28) period = 0x28;
  mem.write8(0x62b3, period);
  mem.write8(0x62b4, period);
  mem.write8(0x6209, 0x04);
  mem.write8(0x620a, 0x08);
  const board = mem.read8(0x6227);
  if ((board & 0x04) === 0) {
    let code = 0x4f;
    for (let i = 0; i < 3; i++) {
      const rec = 0x6a00 + i * 4;
      mem.write8(rec + 0, code);
      mem.write8(rec + 1, 0x3a);
      mem.write8(rec + 2, 0x0f);
      mem.write8(rec + 3, 0x18);
      code = (code + 0x10) & 0xff;
    }
  }
  BOARD_SETUP_ORACLE(m, board);
}

/** Broken twin (b): WRONG-GATE — gate the 0x6A00 seed on bit 1 instead of bit 2. */
function wrongGateTwin(m) {
  const { mem } = m;
  for (let a = 0x6200; a <= 0x6226; a++) mem.write8(a, 0x00);
  for (let a = 0x6280; a < 0x6b00; a++) mem.write8(a, 0x00);
  for (let i = 0; i < 0x40; i++) mem.write8(0x6280 + i, mem.read8(0x3d9c + i));
  let bonus = (mem.read8(0x6229) * 10 + 0x28) & 0xff;
  if (bonus > 0x50) bonus = 0x50;
  mem.write8(0x62b0, bonus);
  mem.write8(0x62b1, bonus);
  mem.write8(0x62b2, bonus);
  let period = (0xdc - 2 * bonus) & 0xff;
  if (period < 0x28) period = 0x28;
  mem.write8(0x62b3, period);
  mem.write8(0x62b4, period);
  mem.write8(0x6209, 0x04);
  mem.write8(0x620a, 0x08);
  const board = mem.read8(0x6227);
  if ((board & 0x02) === 0) { // BUG: bit 1 mask, should be bit 2 (0x04)
    let code = 0x4f;
    for (let i = 0; i < 3; i++) {
      const rec = 0x6a00 + i * 4;
      mem.write8(rec + 0, code);
      mem.write8(rec + 1, 0x3a);
      mem.write8(rec + 2, 0x0f);
      mem.write8(rec + 3, 0x18);
      code = (code + 0x10) & 0xff;
    }
  }
  BOARD_SETUP_ORACLE(m, board);
}

/** The twins dispatch through the ORACLE board setups so the ONLY divergence is the
 *  introduced bug (not a board-setup difference). */
function BOARD_SETUP_ORACLE(m, board) {
  if (board === 1) return oracle_setup(m, 0x0fd7);
  if (board === 2) return oracle_setup(m, 0x101f);
  if (board === 3) return oracle_setup(m, 0x1087);
  if (board === 4) return oracle_setup(m, 0x1131);
}
function oracle_setup(m, addr) {
  return m.call(addr);
}

test("TEETH: the period-double twin and the wrong-gate twin are CAUGHT", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to rig teeth entries from");

  // (a) period-double: caught on the real BOARD == 1 capture at the bonus-period bytes.
  const rp = diffRam(base, periodDoubleTwin);
  assert.notEqual(rp, null, "the RAM gate FAILED to catch the period-double twin — it is worthless");

  // (b) wrong-gate: caught on a crafted BOARD == 4 entry (correct SKIPS the 0x6A00 seed).
  const b4 = craftPoke(base, BOARD, 4);
  const rg = diffRam(b4, wrongGateTwin);
  assert.notEqual(rg, null, "the RAM gate FAILED to catch the wrong bit-gate twin on BOARD 4");

  console.log(
    `  TEETH: period-double caught at ${hx(rp.addr)} (oracle=${rp.a} broken=${rp.b}); ` +
      `wrong-gate caught at ${hx(rg.addr)} (oracle=${rg.a} broken=${rg.b})`,
  );
});
