// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0578 (ROM 0x0578) — the FIXED-column entry into the packed-BCD
 * renderer: it hard-wires the destination video cell to 0x7641, then runs the same
 * prologue as renderBcdColumn (ex de,hl → source; ld de,0xffe0 → -0x20 row stride;
 * ld bc,0x0304 → B=3 bytes) and falls into the shared expansion loop expandBcdDigits
 * (0x0583), painting six digits up the column. A second entry mode (enteredAt057C=true)
 * skips the fixed-column store so a caller (draw_056b) that already chose its own column
 * can join the same code.
 *
 * Like renderBcdColumn (0x057c), expandBcdDigits (0x0583) and storeDigitAndAdvance
 * (0x0593), this routine WRITES MEMORY and loops, so it is gated on memory-equivalence
 * (RAM − the stack scratch below the entry SP + pc + SP + reproduced registers), not a returned scalar, and every
 * case runs on a FRESH clone.
 *
 * GROUNDING — attract dispatches 0x0578 in BOTH modes, so the gate is real-grounded:
 *   - the DEFAULT entry (the fixed 0x7641 column) with the source pointing into the
 *     0x60ba counter area, IX a don't-care the routine overwrites; and
 *   - the enteredAt057C=true entry from draw_056b (IX = 0x7781, its own chosen column).
 * Those real dispatches are captured directly. The shared loop 0x0583 (reached in attract
 * with B=3, IX = 0x7641 / 0x7781) grounds extra reconstructed entries: 0x0578's live-in is
 * the source pointer in DE, so setting DE := the captured HL (the real source) rebuilds a
 * genuine 0x0578 call over real game RAM (IX := the captured cell for the caller-column
 * mode; a don't-care for the fixed-column mode).
 *
 *   1. EQUAL (real) — every real captured 0x0578 dispatch (both modes) reproduced exactly.
 *   2. EQUAL (reconstructed) — 0x0578 entries rebuilt from real 0x0583 loop captures, run
 *      in both modes, identical to the oracle.
 *   3. EQUAL (crafted) — arms the real states do not vary (differing-nibble source so the
 *      high-then-low swap is observable; a source-pointer wrap edge; a caller-column dest),
 *      each seeded from real captured RAM. Identical on both sides.
 *   4. TEETH — two twins the gate MUST catch: (a) one that OMITS the fixed-column store, so
 *      in default mode it renders to the caller's stale cell instead of 0x7641 — the exact
 *      thing this entry exists to prevent; (b) one with the wrong stride magnitude (-0x10
 *      instead of -0x20), which lands digits 2..6 at the wrong cells.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so the
 * harness performs one m.ret() on the candidate clone AFTER the call to line pc + SP up with
 * the oracle (whose shared loop rets internally). The oracle's per-digit push16/call/ret
 * nets to zero on SP and touches only bytes inside STACK_SCRATCH, excluded by the gate.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0578.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0578 as oracle } from "../../translated/loc_0578.js";
import { loc_0583 as loopOracle } from "../../translated/loc_0583.js";
import { renderBcdColumnFixedCell as loc_0578 } from "../renderBcdColumnFixedCell.js";
import { expandBcdDigits } from "../expandBcdDigits.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0578; // the fixed-column renderer entry
const LOOP = 0x0583; // the shared loop TARGET falls into — reachable in attract
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead
 * stack region excluded by the standard gate. The oracle's internal per-digit push16/pop
 * touches only bytes inside STACK_SCRATCH.
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

/** Run the ORACLE on a fresh clone. Its shared loop performs the final `ret`, so pc/SP advance. */
function runOracle(entry, entered) {
  const c = entry.clone();
  oracle(c, entered);
  return c;
}

function runCandidate(entry, entered, fn) {
  const c = entry.clone();
  fn(c, entered);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP, and every
 * register the routine reproduces (A/B/HL/IX/DE). LIVE-OUT is memory-only — the caller reads
 * no output register — but the registers are reproduced identically to the oracle and pinned
 * here for extra teeth (the twins are caught via IX as well as via RAM). Returns
 * human-readable mismatches (empty = equal).
 */
function contractDiffs(entry, entered, fn) {
  const o = runOracle(entry, entered);
  let c;
  try {
    c = runCandidate(entry, entered, fn);
  } catch (e) {
    // A candidate that FAULTS where the oracle succeeds (e.g. an out-of-bounds write to a
    // stale destination) is definitively not memory-equivalent. This makes EQUAL tests fail
    // loudly if loc_0578 ever throws, and lets TEETH catch a twin that renders off-map.
    return [`candidate threw: ${e.message}`];
  }
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=${hx(o.regs.a)} cand=${hx(c.regs.a)}`);
  if (o.regs.b !== c.regs.b) diffs.push(`B oracle=${hx(o.regs.b)} cand=${hx(c.regs.b)}`);
  if (o.regs.hl !== c.regs.hl) diffs.push(`HL oracle=0x${o.regs.hl.toString(16)} cand=0x${c.regs.hl.toString(16)}`);
  if (o.regs.ix !== c.regs.ix) diffs.push(`IX oracle=0x${o.regs.ix.toString(16)} cand=0x${c.regs.ix.toString(16)}`);
  if (o.regs.de !== c.regs.de) diffs.push(`DE oracle=0x${o.regs.de.toString(16)} cand=0x${c.regs.de.toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook the target 0x0578 in a real attract run and clone the machine at up to K real
 * dispatches, recording each entry mode (the enteredAt057C arg the caller forwarded). The
 * wrapper snapshots the entry state, then runs the oracle so the host game proceeds. The host
 * is local, so it (and its per-frame buffer) is released when this returns.
 */
function captureTargetStates(K, maxFrames) {
  const caps = [];
  const ov = new Map([[TARGET, (mm, ...args) => {
    if (caps.length < K) caps.push({ entry: mm.clone(), entered: args[0] === true });
    return oracle(mm, ...args);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(maxFrames);
  return caps;
}

/**
 * Hook the shared loop 0x0583 and clone the machine at up to K real B=3 dispatches (the
 * 3-byte / 6-digit renders 0x0578 produces). Used to reconstruct extra 0x0578 entries.
 */
function captureLoopStates(K, maxFrames) {
  const caps = [];
  const ov = new Map([[LOOP, (mm) => {
    if (caps.length < K && mm.regs.b === 3) caps.push(mm.clone());
    return loopOracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(maxFrames);
  return caps;
}

/**
 * Rebuild a genuine 0x0578 entry from a real captured loop state: DE := the captured source
 * pointer (HL), SP into STACK_SCRATCH so the oracle's final `ret` pops identical excluded
 * bytes on both sides. IX is set for the caller-column mode; in default mode the routine
 * overwrites it with 0x7641, so it is a don't-care there.
 */
function target0578EntryFrom(loopCap) {
  const e = loopCap.clone();
  e.regs.de = loopCap.regs.hl; // the real source pointer
  e.regs.ix = loopCap.regs.ix; // the real destination cell (used only in enteredAt057C mode)
  e.regs.sp = 0x6bfe;
  return e;
}

// -- broken twins -------------------------------------------------------------

function brokenNoColumn(m, enteredAt057C) {
  const { regs } = m;
  // BUG: the `if (!enteredAt057C) regs.ix = 0x7641` fixed-column store is missing.
  regs.exDeHl();
  regs.de = 0xffe0;
  regs.bc = 0x0304;
  expandBcdDigits(m);
}

/**
 * Broken twin (b): wrong stride magnitude — -0x10 (half a row) instead of -0x20 (a full row).
 * Still climbs the column but lands digits 2..6 at the wrong cells and leaves IX at start-0x60
 * instead of start-0xC0 — caught via RAM and IX.
 */
function brokenStride(m, enteredAt057C) {
  const { regs } = m;
  if (!enteredAt057C) regs.ix = 0x7641;
  regs.exDeHl();
  regs.de = 0xfff0; // BUG: -0x10 (half-row step) instead of -0x20 (one full tilemap row)
  regs.bc = 0x0304;
  expandBcdDigits(m);
}

// -- 1. EQUAL (real) ----------------------------------------------------------

test("EQUAL (real): loc_0578 == oracle on real captured 0x0578 dispatches (both entry modes)", () => {
  const caps = captureTargetStates(32, 6000);
  assert.ok(caps.length >= 1, "expected >=1 real 0x0578 dispatch in attract — grounding assumption broke");

  const def = caps.filter((c) => !c.entered); // the fixed-column (0x7641) default entry
  const at057c = caps.filter((c) => c.entered); // the caller-column entry from draw_056b
  assert.ok(def.length >= 1, "expected >=1 real DEFAULT (fixed-column) 0x0578 dispatch — this routine's core mode");

  for (const { entry, entered } of caps) {
    const diffs = contractDiffs(entry, entered, loc_0578);
    assert.equal(diffs.length, 0, `entered=${entered} ix=0x${entry.regs.ix.toString(16)} de=0x${entry.regs.de.toString(16)}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/real: ${caps.length} real dispatches identical (default=${def.length}, enteredAt057C=${at057c.length})`);
});

// -- 2. EQUAL (reconstructed) -------------------------------------------------

test("EQUAL (reconstructed): 0x0578 entries rebuilt from real 0x0583 loop captures match in both modes", () => {
  const loops = captureLoopStates(16, 6000);
  assert.ok(loops.length >= 1, "expected >=1 real 3-byte 0x0583 dispatch to reconstruct 0x0578 entries");

  let n = 0;
  for (const cap of loops) {
    for (const entered of [false, true]) {
      const diffs = contractDiffs(target0578EntryFrom(cap), entered, loc_0578); // fresh clones inside — entry untouched
      assert.equal(diffs.length, 0, `entered=${entered} ix=0x${cap.regs.ix.toString(16)} src=0x${cap.regs.hl.toString(16)}: ${diffs.join("; ")}`);
      n++;
    }
  }
  console.log(`  EQUAL/reconstructed: ${n} entries (${loops.length} loop captures × 2 modes) identical to the oracle`);
});

// -- 3. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): differing-nibble, source-wrap and caller-column arms match the oracle", () => {
  const loops = captureLoopStates(1, 6000);
  assert.ok(loops.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = loops[0];

  const craft = (mut) => {
    const e = seed.clone();
    e.regs.sp = 0x6bfe;
    mut(e);
    return e;
  };

  const cases = [
    // Default (fixed-column) mode, writable source with differing nibbles so the high-then-low
    // swap is observable; the routine forces the 0x7641 destination.
    {
      name: "default, differing-nibble source (0x93/0x2a/0xf0)",
      entered: false,
      e: craft((e) => {
        e.mem.write8(0x6100, 0xf0); e.mem.write8(0x6101, 0x2a); e.mem.write8(0x6102, 0x93);
        e.regs.de = 0x6102; // HL walks 0x6102(0x93) -> 0x6101(0x2a) -> 0x6100(0xf0)
      }),
    },
    // Default mode with a source pointer at a page edge, so `dec hl` underflows the low byte.
    {
      name: "default, source-pointer wrap (DE=0x6200)",
      entered: false,
      e: craft((e) => {
        e.mem.write8(0x6200, 0x12); e.mem.write8(0x61ff, 0x34); e.mem.write8(0x61fe, 0x56);
        e.regs.de = 0x6200;
      }),
    },
    // enteredAt057C mode with a caller-chosen destination column and a real source.
    {
      name: "caller-column dest IX=0x74bf",
      entered: true,
      e: craft((e) => { e.regs.ix = 0x74bf; e.regs.de = seed.regs.hl; }),
    },
  ];

  for (const { name, entered, e } of cases) {
    const diffs = contractDiffs(e, entered, loc_0578);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the omitted-fixed-column twin and the wrong-stride twin are CAUGHT", () => {
  const caps = captureTargetStates(32, 6000);
  const def = caps.filter((c) => !c.entered);
  assert.ok(def.length >= 1, "need a real default-entry capture to catch the omitted-column twin");

  // (a) The omitted-fixed-column twin: on every real DEFAULT dispatch it renders to the
  //     caller's stale cell instead of 0x7641, so RAM and IX both diverge.
  let caughtNoCol = 0;
  for (const { entry } of def) {
    if (contractDiffs(entry, false, brokenNoColumn).length > 0) caughtNoCol++;
  }
  assert.equal(caughtNoCol, def.length, "the omitted-column twin escaped on a default entry — the fixed-column store is unguarded");

  // Also on a crafted default entry with an explicit non-0x7641 caller IX (belt and braces:
  // proves the catch is the missing 0x7641, not the 0xffff garbage cell being discarded).
  const loops = captureLoopStates(1, 6000);
  const seed = loops[0];
  const craftedNoCol = seed.clone();
  craftedNoCol.regs.sp = 0x6bfe;
  craftedNoCol.regs.ix = 0x7521; // a valid-but-WRONG column the caller might have left
  craftedNoCol.mem.write8(0x6100, 0xf0); craftedNoCol.mem.write8(0x6101, 0x2a); craftedNoCol.mem.write8(0x6102, 0x93);
  craftedNoCol.regs.de = 0x6102;
  const noColCrafted = contractDiffs(craftedNoCol, false, brokenNoColumn);
  assert.ok(noColCrafted.length > 0, "the omitted-column twin escaped on the crafted wrong-column entry");

  // (b) The wrong-stride twin: caught on every real dispatch (both modes) via cells and IX.
  let caughtStride = 0;
  for (const { entry, entered } of caps) {
    if (contractDiffs(entry, entered, brokenStride).length > 0) caughtStride++;
  }
  assert.equal(caughtStride, caps.length, "the wrong-stride twin escaped on some dispatch — the gate is worthless");

  console.log(
    `  TEETH: omitted-column twin caught on ${caughtNoCol}/${def.length} default entries + the crafted arm (${noColCrafted.join("; ")}); ` +
      `wrong-stride twin caught on ${caughtStride}/${caps.length} dispatches`,
  );
});
