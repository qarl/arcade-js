// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loadBoardObjectRecords (ROM 0x2441) — the board-setup helper
 * that scatters a board's ROM object-init records into two 0x63xx attribute arrays.
 *
 * This routine READS BOARD + ROM tables and WRITES MEMORY (the two de-interleaved
 * arrays), and its declared LIVE-OUT is memory-only, so it is gated on
 * memory-equivalence (RAM − the stack scratch below the entry SP + pc + SP), never on a returned scalar or
 * the register file. Every case runs on a FRESH clone (a reused clone is only safe
 * for a read-only leaf); this routine mutates RAM, so each case re-clones.
 *
 *   1. EQUAL (real captured dispatch) — hook 0x2441 in a real attract run and clone
 *      the machine at the true dispatch. Attract only ever sets up 25m, so this is a
 *      BOARD == 1 entry (table 0x3AE4: 11 type-0 + 4 type-1 + 9 skipped records). Run
 *      the ORACLE on one clone and loadBoardObjectRecords on another and confirm
 *      identical RAM (minus the stack scratch below the entry SP) + pc + SP.
 *
 *   2. EQUAL (crafted table arms) — the arms attract never reaches, from the real
 *      captured RAM with a single identical-both-sides poke of BOARD (0x6227): 2 ->
 *      table 0x3B5D, 3 -> 0x3BE5, 4 -> 0x3C8B, 0 -> the default 0x3C8B. A Karl-
 *      sanctioned board poke (attract stays on 25m). Each compared identically both
 *      sides — this exercises every table-selection arm and the "skip other type" path.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught on the real board-1
 *      dispatch:
 *      (a) a field-offset twin (type-0 field B written to +0x14 instead of +0x15) —
 *          board 1 has 11 type-0 records, so its de-interleaved array shifts;
 *      (b) a HEAD-A mis-seed twin (checksum seeded 0x5F not 0x5E, so the IY group base
 *          becomes 0x6311 not 0x6310) — board 1 has 4 type-1 records, so they land one
 *          byte off. This gives the otherwise-constant HEAD-A checksum real teeth.
 *
 * The idiomatic routine models the Z80 terminal `ret` as a JS return (no stack
 * modelling), so the harness performs one m.ret() on the candidate clone AFTER the
 * call to line pc + SP up with the oracle (which rets internally). The routine pushes
 * nothing, so STACK_SCRATCH is untouched by either side; excluding it is the standard
 * contract, harmless here.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2441.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2441 as oracle } from "../../translated/loc_2441.js";
import { loadBoardObjectRecords } from "../loadBoardObjectRecords.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2441;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region the standard gate excludes. (This routine pushes nothing, so
 * neither side writes the stack; the exclusion is the standard contract, not a fudge.)
 */
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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP.
 * LIVE-OUT is memory-only, so no register is compared (all are dead — loc_0d5f reloads
 * HL/A/DE/BC and reads neither IX/IY nor any flag). Returns human-readable mismatches.
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x2441 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. m.call(0x2441) resolves through the routine registry the override
 * overlays, so the loc_0d5f call site is captured here.
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

// -- broken twins -------------------------------------------------------------

/**
 * Broken twin (a): the type-0 middle field is stored at group offset +0x14 instead of
 * +0x15, so every type-0 record de-interleaves one byte low. Agrees on type-1/skip
 * records, diverges on the first type-0 record (board 1 has 11).
 */
function brokenFieldOffset(m) {
  const { mem } = m;
  let checksum = 0x5e;
  for (let i = 0; i < 6; i++) checksum = (checksum + mem.read8((0x3f0c + i) & 0xffff)) & 0xff;
  let iy = checksum === 0 ? 0x6310 : 0x6311;
  const board = mem.read8(BOARD);
  let hl = board === 1 ? 0x3ae4 : board === 2 ? 0x3b5d : board === 3 ? 0x3be5 : 0x3c8b;
  let ix = 0x6300;
  for (;;) {
    const type = mem.read8(hl);
    if (type === 0x00) {
      hl = (hl + 1) & 0xffff; mem.write8((ix + 0x00) & 0xffff, mem.read8(hl));
      hl = (hl + 1) & 0xffff; mem.write8((ix + 0x14) & 0xffff, mem.read8(hl)); // BUG: 0x14 should be 0x15
      hl = (hl + 1) & 0xffff;
      hl = (hl + 1) & 0xffff; mem.write8((ix + 0x2a) & 0xffff, mem.read8(hl));
      ix = (ix + 1) & 0xffff; hl = (hl + 1) & 0xffff; continue;
    }
    if (type === 0x01) {
      hl = (hl + 1) & 0xffff; mem.write8((iy + 0x00) & 0xffff, mem.read8(hl));
      hl = (hl + 1) & 0xffff; mem.write8((iy + 0x15) & 0xffff, mem.read8(hl));
      hl = (hl + 1) & 0xffff;
      hl = (hl + 1) & 0xffff; mem.write8((iy + 0x2a) & 0xffff, mem.read8(hl));
      iy = (iy + 1) & 0xffff; hl = (hl + 1) & 0xffff; continue;
    }
    if (type === 0xaa) return;
    hl = (hl + 5) & 0xffff;
  }
}

/**
 * Broken twin (b): the HEAD-A checksum is seeded 0x5F instead of 0x5E, so the sum is 1
 * not 0 and the IY group base becomes 0x6311 instead of 0x6310. Every type-1 record
 * then lands one byte high. Agrees on type-0/skip records; caught wherever a board has
 * type-1 records (board 1 has 4).
 */
function brokenHeadASeed(m) {
  const { mem } = m;
  let checksum = 0x5f; // BUG: seed should be 0x5e
  for (let i = 0; i < 6; i++) checksum = (checksum + mem.read8((0x3f0c + i) & 0xffff)) & 0xff;
  let iy = checksum === 0 ? 0x6310 : 0x6311;
  const board = mem.read8(BOARD);
  let hl = board === 1 ? 0x3ae4 : board === 2 ? 0x3b5d : board === 3 ? 0x3be5 : 0x3c8b;
  let ix = 0x6300;
  for (;;) {
    const type = mem.read8(hl);
    if (type === 0x00) {
      hl = (hl + 1) & 0xffff; mem.write8((ix + 0x00) & 0xffff, mem.read8(hl));
      hl = (hl + 1) & 0xffff; mem.write8((ix + 0x15) & 0xffff, mem.read8(hl));
      hl = (hl + 1) & 0xffff;
      hl = (hl + 1) & 0xffff; mem.write8((ix + 0x2a) & 0xffff, mem.read8(hl));
      ix = (ix + 1) & 0xffff; hl = (hl + 1) & 0xffff; continue;
    }
    if (type === 0x01) {
      hl = (hl + 1) & 0xffff; mem.write8((iy + 0x00) & 0xffff, mem.read8(hl));
      hl = (hl + 1) & 0xffff; mem.write8((iy + 0x15) & 0xffff, mem.read8(hl));
      hl = (hl + 1) & 0xffff;
      hl = (hl + 1) & 0xffff; mem.write8((iy + 0x2a) & 0xffff, mem.read8(hl));
      iy = (iy + 1) & 0xffff; hl = (hl + 1) & 0xffff; continue;
    }
    if (type === 0xaa) return;
    hl = (hl + 5) & 0xffff;
  }
}

// -- 1. EQUAL (real captured dispatch) ----------------------------------------

test("EQUAL (real dispatch): loadBoardObjectRecords == oracle on the captured board-1 0x2441 entry", () => {
  const caps = captureDispatches(8, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2441 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loadBoardObjectRecords); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = caps.map((c) => `BOARD=${hx(c.mem.read8(BOARD))} SP=0x${c.regs.sp.toString(16)}`);
  console.log(`  EQUAL/real: ${caps.length} captured dispatch(es) identical\n    ` + shapes.join("\n    "));
});

// -- 2. EQUAL (crafted table arms) --------------------------------------------

test("EQUAL (crafted): the BOARD 2/3/4/0 table arms match the oracle (identical-both-sides poke)", () => {
  const caps = captureDispatches(1, 3000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const craft = (board) => {
    const e = seed.clone();
    e.mem.write8(BOARD, board); // the ONE surgical nudge, applied identically to both sides
    return e;
  };

  const cases = [
    { name: "BOARD=2 -> table 0x3B5D (13 type-0, 2 type-1, 12 skipped)", e: craft(2) },
    { name: "BOARD=3 -> table 0x3BE5 (12 type-0, 0 type-1, 21 skipped)", e: craft(3) },
    { name: "BOARD=4 -> default table 0x3C8B (14 type-0, 6 skipped)", e: craft(4) },
    { name: "BOARD=0 -> default table 0x3C8B (the wrap-to-default arm)", e: craft(0) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, loadBoardObjectRecords);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} table arms identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the field-offset twin and the HEAD-A mis-seed twin are CAUGHT on the real dispatch", () => {
  const caps = captureDispatches(8, 3000);
  assert.ok(caps.length >= 1, "need a real capture (board 1, with type-0 and type-1 records) to catch both twins");

  let caughtField = 0, caughtHeadA = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenFieldOffset).length > 0) caughtField++;
    if (contractDiffs(cap, brokenHeadASeed).length > 0) caughtHeadA++;
  }
  assert.equal(caughtField, caps.length,
    `the field-offset twin escaped on ${caps.length - caughtField}/${caps.length} real dispatches — the gate is worthless`);
  assert.equal(caughtHeadA, caps.length,
    `the HEAD-A mis-seed twin escaped on ${caps.length - caughtHeadA}/${caps.length} real dispatches — the checksum has no teeth`);

  console.log(
    `  TEETH: field-offset caught on all ${caps.length} real dispatch(es) (e.g. ${contractDiffs(caps[0], brokenFieldOffset)[0]}); ` +
      `HEAD-A mis-seed caught (e.g. ${contractDiffs(caps[0], brokenHeadASeed)[0]})`,
  );
});
