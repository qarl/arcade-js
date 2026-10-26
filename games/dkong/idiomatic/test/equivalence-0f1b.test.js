// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for fillTileColumn (ROM 0x0F1B) — the kind-4/5/6 tilemap column fill.
 *
 * entry_0f1b WRITES memory (0x63B5 fill tile, 0x63B1 extent, and the tilemap VRAM)
 * and advances DE, so it is gated by capture / clone / replay (docs/decompiler-pipeline), NOT the
 * exhaustive-leaf pattern. It is also UNREACHED in attract — the attract board's 9
 * segment records are all kind 2, which route to loc_0e4f (the girder drawer), so
 * 0x0F1B never dispatches (probed: 0 hits over 2500 frames). Every case here is
 * therefore a CRAFTED ENTRY (docs/decompiler-pipeline): a real render-walk state with a surgical
 * nudge. The states are captured at the live sibling loc_0e4f, which shares the
 * exact render-scratch entry_0f1b consumes — 0x63AB (converted tilemap address),
 * 0x63B1 (column extent), 0x63B3 (record kind), and DE (record pointer) — and the
 * kind byte is nudged to reach each arm, identically on both sides.
 *
 *   1. EQUAL (crafted from real captures) — for every captured loc_0e4f state and
 *      every crafted kind (the three fill tiles 4/5/6, the default fall-through, and
 *      the kind>=7 bail), run the ORACLE on one clone and fillTileColumn on another
 *      and confirm they leave IDENTICAL game-visible RAM (the diff, if any, confined
 *      to STACK_SCRATCH) AND identical DE (the live-out record pointer). The captured
 *      extents (0x2F..0xCF) make the fills multi-row, so the whole column loop and
 *      its VRAM writes are exercised on real tilemap addresses. Also asserts
 *      fillTileColumn leaves SP and pc untouched (the dropped stack model).
 *
 *   2. TEETH (column step) — a twin that pays the height down by 0x10 instead of 0x08
 *      (a plausible confusion with loc_0ee8's first step) MUST be caught: it lays
 *      fewer rows, so a game-visible RAM byte (the tilemap, or 0x63B1) diverges.
 *
 *   3. TEETH (live-out DE) — a twin that forgets to advance DE on the fill path MUST
 *      be caught by the DE comparison. A gate blind to the record pointer would let
 *      the walk desync silently.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0f1b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f1b as oracle } from "../../translated/loc_0f1b.js";
import { loc_0e4f } from "../../translated/loc_0e4f.js";
import { fillTileColumn } from "../fillTileColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0f1b;
const SIBLING = 0x0e4f; // the live routine we capture real render-scratch from
const KIND = 0x63b3; // record kind — the one byte the crafted entry nudges

// Kinds spanning every arm: the three fill tiles, the default fall-through (0x02/
// 0x00 land on 0xFE like kind 6), and the kind>=7 bail (0x07/0x08/0xFF).
const KINDS = [0x04, 0x05, 0x06, 0x02, 0x00, 0x07, 0x08, 0xff];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch. entry_0f1b never touches the stack, so stackDiffs should be 0.
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
 * Craft one entry (poke the kind identically on both sides — a real state with a
 * surgical nudge), replay the oracle and a candidate on independent FRESH clones
 * (the routine writes RAM), and return the RAM diff + the DE live-out comparison.
 */
function craftReplay(entry, kind, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  a.mem.write8(KIND, kind);
  b.mem.write8(KIND, kind);
  oracle(a);
  candidate(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, entry.regs.sp);
  const deMismatch = a.regs.de !== b.regs.de ? { oracle: a.regs.de, cand: b.regs.de } : null;
  return { a, b, bad, stackDiffs, deMismatch };
}

/**
 * Hook loc_0e4f (which the attract board render dispatches once per kind-2 record)
 * and clone the machine at up to K true dispatches. Each clone is a real render-walk
 * state; the wrapper delegates to the loc_0e4f oracle so the host run proceeds.
 */
function captureWalkStates(K, maxFrames) {
  const caps = [];
  const overrides = new Map([[SIBLING, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return loc_0e4f(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. EQUAL (crafted from real captures) ------------------------------------

test("EQUAL (crafted): fillTileColumn == oracle on every real render-scratch state × every arm", () => {
  const caps = captureWalkStates(64, 2500);
  assert.ok(caps.length >= 1, "expected at least one real loc_0e4f render-scratch state during attract");

  let cases = 0;
  for (const entry of caps) {
    for (const kind of KINDS) {
      const { bad, stackDiffs, deMismatch } = craftReplay(entry, kind, fillTileColumn);
      cases++;
      assert.equal(
        bad,
        null,
        bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
          `kind=${hx(kind)} extent=${hx(entry.mem.read8(0x63b1))} tilemap=${hx(entry.mem.read16(0x63ab))}`,
      );
      assert.equal(stackDiffs, 0, "entry_0f1b touches no stack — there must be no stack-scratch residue");
      assert.equal(
        deMismatch,
        null,
        deMismatch && `DE live-out diff kind=${hx(kind)}: oracle=${hx(deMismatch.oracle)} idiomatic=${hx(deMismatch.cand)}`,
      );

      // fillTileColumn must NOT model the stack: SP and pc unchanged from entry.
      const b = entry.clone();
      b.mem.write8(KIND, kind);
      const sp0 = b.regs.sp, pc0 = b.pc;
      fillTileColumn(b);
      assert.equal(b.regs.sp, sp0, "fillTileColumn must leave SP unchanged (no stack modelling)");
      assert.equal(b.pc, pc0, "fillTileColumn must leave pc unchanged (no jp/ret modelling)");
    }
  }
  console.log(`  EQUAL/crafted: ${caps.length} real states × ${KINDS.length} arms = ${cases} cases — game-visible RAM + DE identical to the oracle`);
});

// -- 2. TEETH (column step) ---------------------------------------------------

/** Broken twin: pays the height down by 0x10 instead of 0x08, so it lays fewer
 *  rows — a plausible confusion with loc_0ee8's 0x10 first step. */
function brokenColumnStep(m) {
  const { regs, mem } = m;
  const kind = mem.read8(0x63b3);
  if (((kind - 0x07) & 0x80) === 0) { regs.de = (regs.de + 1) & 0xffff; return; }
  const tile = kind === 0x04 ? 0xe0 : kind === 0x05 ? 0xb0 : 0xfe;
  mem.write8(0x63b5, tile);
  let addr = mem.read16(0x63ab);
  for (;;) {
    mem.write8(addr, tile);
    addr = (addr + 0x20) & 0xffff;
    const h = mem.read8(0x63b1);
    mem.write8(0x63b1, (h - 0x10) & 0xff); // BUG: should be 0x08
    if (h < 0x10) break; // (matching the wrong step)
  }
  regs.de = (regs.de + 1) & 0xffff;
}

test("TEETH (column step): the wrong height step is CAUGHT in game-visible RAM", () => {
  const caps = captureWalkStates(64, 2500);
  assert.ok(caps.length >= 1, "need a real render-scratch state to craft from");

  let caught = null;
  outer: for (const entry of caps) {
    for (const kind of KINDS) {
      const { bad } = craftReplay(entry, kind, brokenColumnStep);
      if (bad) { caught = { ...bad, kind }; break outer; }
    }
  }
  assert.notEqual(caught, null, "the crafted sweep FAILED to catch a wrong column step — it is worthless");
  assert.equal(inStack(caught.addr), false, "the caught diff must be game-visible, not stack scratch");
  console.log(`  TEETH/step: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b}) kind=${hx(caught.kind)}`);
});

// -- 3. TEETH (live-out DE) ---------------------------------------------------

/** Broken twin: forgets to advance DE on the fill path, so the walk would re-read
 *  the same record. Only the DE comparison catches this (RAM is identical). */
function brokenDeAdvance(m) {
  const { regs, mem } = m;
  const kind = mem.read8(0x63b3);
  if (((kind - 0x07) & 0x80) === 0) { regs.de = (regs.de + 1) & 0xffff; return; }
  const tile = kind === 0x04 ? 0xe0 : kind === 0x05 ? 0xb0 : 0xfe;
  mem.write8(0x63b5, tile);
  let addr = mem.read16(0x63ab);
  for (;;) {
    mem.write8(addr, tile);
    addr = (addr + 0x20) & 0xffff;
    const h = mem.read8(0x63b1);
    mem.write8(0x63b1, (h - 0x08) & 0xff);
    if (h < 0x08) break;
  }
  // BUG: missing regs.de = (regs.de + 1) & 0xffff;
}

test("TEETH (live-out DE): the missing record-pointer advance is CAUGHT by the DE compare", () => {
  const caps = captureWalkStates(64, 2500);
  assert.ok(caps.length >= 1, "need a real render-scratch state to craft from");

  let caught = null;
  outer: for (const entry of caps) {
    for (const kind of KINDS) {
      const { deMismatch } = craftReplay(entry, kind, brokenDeAdvance);
      if (deMismatch) { caught = { ...deMismatch, kind }; break outer; }
    }
  }
  assert.notEqual(caught, null, "the DE compare FAILED to catch a missing record-pointer advance — it is worthless");
  console.log(`  TEETH/DE: caught kind=${hx(caught.kind)} (oracle DE=${hx(caught.oracle)} broken DE=${hx(caught.cand)})`);
});
