// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for fillTileBlock (ROM 0x1826) — the 5×14 tilemap block fill.
 *
 * fillTileBlock WRITES memory (70 tilemap cells) and is a subroutine, not a pure
 * leaf, so it is gated by capture / clone / replay (docs/decompiler-pipeline). sub_1826 is UNREACHED
 * in attract — its five callers are the death / player-switch render (loc_12f2,
 * loc_1344) and the board-start intro-setup arms (loc_17b6, loc_1880), none of which
 * attract enters (probed: 0 dispatches of 0x1826 and of every caller over 4000
 * attract frames). It IS reached in driven gameplay, so the gate combines a real
 * driven capture with the crafted-entry breadth of the fillTileColumn (0x0F1B)
 * pattern.
 *
 * The sweep is complete rather than approximate because the routine READS NO
 * MEMORY: HL (the destination) is its entire input, so covering every real caller
 * value plus the region-crossing edges exhausts what can vary.
 *
 *   1. REAL (driven capture) — drive coin+start to GAME OVER; the game-over render
 *      (loc_12f2, counter==0) dispatches 0x1826 for real with the true live-in
 *      HL=0x76D4. Clone at that dispatch and confirm fillTileBlock leaves IDENTICAL
 *      game-visible RAM to the oracle, and models no stack (SP/pc unchanged). This
 *      is the gold-standard input — the exact state the running game produces.
 *
 *   2. EQUAL (crafted @ real caller HLs on real captured states) — capture real
 *      attract states at the VRAM-render sibling sub_0DA7 (literally the call made
 *      right after 0x1826 in loc_17b6 / loc_1880) and at the task primitive sub_309F
 *      (many varied machine environments). For each base × each real caller HL
 *      (0x76C6/CB/D0/D3/D4/D5/DA), run the ORACLE and fillTileBlock on independent
 *      FRESH clones (the routine mutates RAM) and confirm IDENTICAL game-visible RAM
 *      (diff confined to STACK_SCRATCH). Also confirm fillTileBlock models no stack:
 *      SP and pc unchanged from entry (the oracle's `ret` moves both; it pops but
 *      never writes the stack, so there is no stack-write residue at all here).
 *
 *   3. EQUAL (region-crossing crafts) — HLs that make the fill cross the
 *      VRAM↔sprite↔discard boundaries, identically on both sides, proving the mem
 *      write-seam and the `& 0xffff` row step match the oracle byte-for-byte on
 *      addresses the real callers never reach. (A true 16-bit wrap is not writable —
 *      every wrapped address is ROM/unmapped, which the write seam faults on both
 *      sides alike — so the defensive wrap is left as faithful-but-unexercised.)
 *
 *   4. TEETH (crafted) — a deliberately-broken twin that steps HL back by 0x24
 *      instead of 0x25 (a plausible off-by-one on the DE constant) shifts every row
 *      after the first. Over a sentinel-primed footprint it MUST be caught, and the
 *      caught diff must land inside the fill region.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1826.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1826 as oracle } from "../../translated/loc_1826.js";
import { fillTileBlock } from "../fillTileBlock.js";
import { Machine } from "../../machine.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1826;
const SIBLING = 0x0da7; // reachable VRAM-render sibling — called right after 0x1826 in the callers
const TASK = 0x309f; // reachable task-post primitive — many varied real machine environments

// Every real live-in HL, read straight off the five call sites (loc_12f2 0x76D4/D3,
// loc_1880 0x76C6, loc_17b6 0x76DA/D5/D0/CB, loc_1344 0x76D3).
const CALLER_HLS = [0x76c6, 0x76cb, 0x76d0, 0x76d3, 0x76d4, 0x76d5, 0x76da];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch. (For 0x1826 the oracle's `ret` pops but never writes the
 * stack, so in practice even the stack side is clean; the exclusion is the
 * standard contract, kept so a future stack touch could not mask a real diff.)
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Hook `target` in a real attract run and clone the machine at up to K true
 * dispatches. The wrapper delegates to `target`'s pristine oracle so the host run
 * proceeds to a clean stop (it does NOT re-enter the override — ORACLE_ROUTINES is
 * the un-wrapped table).
 */
function captureAt(target, K, maxFrames) {
  const caps = [];
  const orig = ORACLE_ROUTINES.get(target);
  const overrides = new Map([[target, (mm, ...args) => {
    if (caps.length < K) caps.push(mm.clone());
    return orig(mm, ...args);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return caps;
}

/**
 * Drive a game to GAME OVER (coin + start, then no play input, so Mario is overrun)
 * and clone the machine at each REAL 0x1826 dispatch. The routine is unreached in
 * attract, but the game-over render (loc_12f2, counter==0) invokes it with the true
 * live-in HL=0x76D4 — a genuine captured dispatch, the gold-standard input.
 */
function captureDrivenDispatches(K, maxFrames) {
  const caps = [];
  const orig = ORACLE_ROUTINES.get(TARGET);
  const overrides = new Map([[TARGET, (mm, ...args) => {
    if (caps.length < K) caps.push(mm.clone());
    return orig(mm, ...args);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.inputTape = [
    { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin (IN2 bit 7)
    { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start 1P (IN2 bit 2)
  ];
  host.runFrames(maxFrames);
  return caps;
}

/** A fresh clone of `base` with HL set to `hl` (and, optionally, its fill footprint
 *  primed to a sentinel so a missed/extra cell is unmissable). */
function craft(base, hl, sentinel) {
  const m = base.clone();
  if (sentinel != null) {
    // Footprint of a 5×14 block anchored at hl: rows span hl down to hl-13*0x20.
    for (let a = (hl - 0x1a0) & 0xffff, end = (hl + 4) & 0xffff; ; a = (a + 1) & 0xffff) {
      m.mem.write8(a, sentinel);
      if (a === end) break;
    }
  }
  m.regs.hl = hl & 0xffff;
  return m;
}

test("REAL (driven): fillTileBlock == oracle on the real game-over dispatch (HL=0x76D4)", () => {
  const caps = captureDrivenDispatches(8, 8500);
  assert.ok(caps.length >= 1, "expected at least one real 0x1826 dispatch driving coin+start to game over");

  for (const entry of caps) {
    const a = entry.clone();
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    oracle(a);
    fillTileBlock(b);

    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) on real HL=${hx(entry.regs.hl)}`,
    );
    assert.equal(b.regs.sp, sp0, "fillTileBlock must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "fillTileBlock must leave pc unchanged (no ret modelling)");
  }
  console.log(
    `  REAL/driven: ${caps.length} real 0x1826 dispatch(es) (HL=${hx(caps[0].regs.hl)}) — game-visible RAM identical to the oracle`,
  );
});

test("EQUAL (crafted): fillTileBlock == oracle at every real caller HL over real captured states", () => {
  const bases = [...captureAt(SIBLING, 4, 700), ...captureAt(TASK, 8, 400)];
  assert.ok(bases.length >= 1, "expected at least one real sibling/task dispatch to capture a base state from");

  let count = 0;
  for (const base of bases) {
    for (const hl of CALLER_HLS) {
      const seeded = craft(base, hl, null); // realistic VRAM background, no sentinel
      const a = seeded.clone();
      const b = seeded.clone();
      const sp0 = b.regs.sp, pc0 = b.pc;
      oracle(a);
      fillTileBlock(b);

      const { bad } = ramDiffMinusStack(a, b, seeded.regs.sp);
      assert.equal(
        bad,
        null,
        bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) on HL=${hx(hl)}`,
      );
      // No stack modelling: fillTileBlock must leave SP and pc exactly as entered.
      assert.equal(b.regs.sp, sp0, `fillTileBlock must leave SP unchanged (HL=${hx(hl)})`);
      assert.equal(b.pc, pc0, `fillTileBlock must leave pc unchanged (HL=${hx(hl)})`);
      count++;
    }
  }
  console.log(`  EQUAL/crafted: ${count} (base × caller-HL) combos — game-visible RAM identical to the oracle`);
});

test("EQUAL (edges): region-crossing HLs match the oracle byte-for-byte", () => {
  const [base] = captureAt(TASK, 1, 400);
  assert.ok(base, "need a real entry to craft from");

  // All footprints stay within [0x6000, 0x77FF] — writing below 0x6000 or into the
  // 0x7800+ latch/DMA space would fault (identically on both sides, but it would
  // error the run). The real callers never wrap 0x0000, and every wrapped address
  // lands in ROM/unmapped space that write8 refuses, so the `& 0xffff` wrap is
  // defensive-faithful and not separately writable — the region crossings below are
  // what is safely exercisable.
  const edges = [
    ["VRAM/sprite boundary", 0x7420], // rows cross the 0x7400 VRAM base down into sprite RAM
    ["sprite/discard boundary", 0x7080], // rows cross the 0x7000 sprite base into the 0x6C00-0x6FFF discard span
    ["high VRAM", 0x77c0], // near the top of VRAM (highest write 0x77C4)
  ];

  for (const [label, hl] of edges) {
    const seeded = craft(base, hl, null);
    const a = seeded.clone();
    const b = seeded.clone();
    oracle(a);
    fillTileBlock(b);
    const { bad } = ramDiffMinusStack(a, b, seeded.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) on HL=${hx(hl)}`,
    );
    console.log(`  EQUAL/edge ${label} (HL=${hx(hl)}): game-visible RAM identical`);
  }
});

/**
 * Broken twin: steps HL back by 0x24 instead of 0x25 after each row (DE = 0xFFDC
 * not 0xFFDB — a plausible off-by-one). Row 0 is identical; every later row is
 * shifted one cell, so the symmetric-difference cells diverge. A sentinel-primed
 * footprint makes the divergence certain regardless of the captured VRAM content.
 */
function brokenFillTileBlock(m) {
  const { regs, mem } = m;
  let addr = regs.hl;
  for (let row = 0; row < 0x0e; row++) {
    for (let col = 0; col < 5; col++) {
      mem.write8(addr, 0x10);
      addr = (addr + 1) & 0xffff;
    }
    addr = (addr - 0x24) & 0xffff; // BUG: should be 0x25
  }
}

test("TEETH (crafted): the wrong row step is CAUGHT inside the fill region", () => {
  const [base] = captureAt(TASK, 1, 400);
  assert.ok(base, "need a real entry to craft the teeth from");

  let caught = null;
  for (const hl of CALLER_HLS) {
    const seeded = craft(base, hl, 0xaa); // prime the footprint so any miss shows
    const a = seeded.clone();
    const b = seeded.clone();
    oracle(a);
    brokenFillTileBlock(b);
    const { bad } = ramDiffMinusStack(a, b, seeded.regs.sp);
    if (bad) { caught = { ...bad, hl }; break; }
  }
  assert.notEqual(caught, null, "the crafted sweep FAILED to catch a wrong row step — it is worthless");
  assert.ok(
    caught.addr >= 0x7400 && caught.addr < 0x7800,
    `expected the caught diff inside the VRAM fill region, got ${hx(caught.addr)}`,
  );
  console.log(
    `  TEETH/crafted: caught at ${hx(caught.addr)} on HL=${hx(caught.hl)} (oracle=${caught.a} broken=${caught.b})`,
  );
});
