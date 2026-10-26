// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for drawCappedTileColumn (ROM 0x0EE8) — the kind-3 capped vertical
 * tile run of the board-layout drawer chain.
 *
 * loc_0ee8 WRITES memory (0x63B1 column extent + the tilemap VRAM cells) and advances
 * DE, so it is gated by capture / clone / replay (docs/decompiler-pipeline), NOT the exhaustive-leaf
 * pattern. It is also UNREACHED in attract: the attract board's segment records are
 * all kind 2, which loc_0e4f (the girder drawer) handles itself and never tails here
 * (loc_0e4f only `jp`s to 0x0EE8 for kind != 2). Every case is therefore a CRAFTED
 * ENTRY (docs/decompiler-pipeline): a real render-walk state with a surgical nudge. States are captured
 * at the live sibling loc_0e4f, which shares the exact render-scratch loc_0ee8 consumes
 * — 0x63AB (converted tilemap address), 0x63B1 (column extent), 0x63B3 (record kind),
 * and DE (record pointer) — and the kind (and, for the kind-3 arm, the extent) is
 * nudged to reach each behaviour, identically on both sides.
 *
 *   1. EQUAL (crafted from real captures) — for every captured loc_0e4f state and
 *      every crafted kind (kind 3 = the capped column; kinds 4/5/6/default = the
 *      fillTileColumn delegation; kind >= 7 = the bail), run the ORACLE loc_0ee8 on one
 *      clone and drawCappedTileColumn on another and confirm IDENTICAL game-visible RAM
 *      (any diff confined to STACK_SCRATCH) AND identical DE (the live-out record
 *      pointer). Then, for the kind-3 arm, sweep crafted EXTENTS spanning the immediate
 *      bottom cap (extent < 0x10, no body rows), the extent boundary, the one-row run,
 *      and multi-row runs — so the top cap, the body loop, the per-row 0x63B1 stores,
 *      and the bottom cap are all exercised on real tilemap addresses. Also asserts
 *      drawCappedTileColumn leaves SP (compared to the oracle's, both unchanged) and pc
 *      untouched — the dropped stack / control-flow model.
 *
 *   2. TEETH (first step) — a twin that pays the FIRST step down by 0x08 instead of
 *      0x10 (a plausible confusion with fillTileColumn's flat step) MUST be caught: it
 *      stores different 0x63B1 values and lays a different number of rows, so a
 *      game-visible RAM byte (the tilemap, or 0x63B1) diverges.
 *
 *   3. TEETH (body tile) — a twin that lays body tile 0xB0 instead of 0xB1 MUST be
 *      caught in the tilemap VRAM.
 *
 *   4. TEETH (live-out DE) — a twin that forgets to advance DE on the kind-3 path MUST
 *      be caught by the DE comparison; a gate blind to the record pointer would let the
 *      walk desync silently.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0ee8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ee8 as oracle } from "../../translated/loc_0ee8.js";
import { loc_0e4f } from "../../translated/loc_0e4f.js";
import { drawCappedTileColumn } from "../drawCappedTileColumn.js";
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

const TARGET = 0x0ee8;
const SIBLING = 0x0e4f; // the live routine we capture real render-scratch from
const KIND = 0x63b3; // record kind — the byte the crafted entry nudges
const EXTENT = 0x63b1; // column extent — nudged too, for the kind-3 arm
const TILEMAP_PTR = 0x63ab; // converted VRAM address the run is drawn from

// Kinds spanning every arm: 3 = the capped column (ours); 4/5/6 = the fillTileColumn
// fill tiles; 2/0 = its default fall-through; 7/8/0xFF = the kind>=7 bail.
const KINDS = [0x03, 0x04, 0x05, 0x06, 0x02, 0x00, 0x07, 0x08, 0xff];

// Crafted extents for the kind-3 arm: immediate bottom cap (< 0x10, no body rows), the
// 0x10 boundary, the one-row run, and multi-row runs. (The captured extent — a real
// multi-row value ~0x2F..0xCF — is also covered by the kind==3 entry in KINDS above.)
const EXTENTS_K3 = [0x00, 0x05, 0x08, 0x0f, 0x10, 0x11, 0x18, 0x20, 0x48, 0x80];

// A safe interior tilemap cell used WITH the crafted extents: a real record's captured
// address is positioned so its real extent fits on-screen, but an artificially LARGE
// crafted extent from that address would walk the write pointer off the end of mapped
// VRAM (the oracle itself throws UnmappedAccess). Crafting the base near the top of the
// tilemap (identically on both sides) keeps every crafted extent within mapped VRAM.
const SAFE_TILEMAP = 0x7440;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch. loc_0ee8 never touches the stack, so stackDiffs should be 0.
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
 * Craft one entry — poke the kind (and, when not null, 0x63B1 and the tilemap base)
 * identically on both sides — replay the oracle and a candidate on independent FRESH
 * clones (the routine writes RAM), and return the RAM diff + the DE live-out comparison
 * + the SP comparison. A fresh clone per case is mandatory: this routine mutates memory.
 */
function craftReplay(entry, kind, extent, base, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  for (const mm of [a, b]) {
    mm.mem.write8(KIND, kind);
    if (extent !== null) mm.mem.write8(EXTENT, extent);
    if (base !== null) mm.mem.write16(TILEMAP_PTR, base);
  }
  oracle(a);
  candidate(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, entry.regs.sp);
  const deMismatch = a.regs.de !== b.regs.de ? { oracle: a.regs.de, cand: b.regs.de } : null;
  const spMismatch = a.regs.sp !== b.regs.sp ? { oracle: a.regs.sp, cand: b.regs.sp } : null;
  return { a, b, bad, stackDiffs, deMismatch, spMismatch };
}

/**
 * Hook loc_0e4f (dispatched once per kind-2 record while the attract board is drawn)
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

test("EQUAL (crafted): drawCappedTileColumn == oracle on every real render-scratch state × every arm", () => {
  const caps = captureWalkStates(64, 2500);
  assert.ok(caps.length >= 1, "expected at least one real loc_0e4f render-scratch state during attract");

  let cases = 0;
  for (const entry of caps) {
    // Every kind arm at the REAL captured extent + REAL captured tilemap address (the
    // fully-real realism anchor — no base/extent nudge).
    for (const kind of KINDS) {
      assertCraftEqual(entry, kind, null, null);
      cases++;
    }
    // The kind-3 capped-column arm across crafted extents, from a safe interior base so
    // even large extents stay mapped (edge coverage: immediate cap → deep multi-row).
    for (const extent of EXTENTS_K3) {
      assertCraftEqual(entry, 0x03, extent, SAFE_TILEMAP);
      cases++;
    }
  }
  console.log(`  EQUAL/crafted: ${caps.length} real states × (${KINDS.length} kinds + ${EXTENTS_K3.length} k3 extents) = ${cases} cases — game-visible RAM + DE + SP identical to the oracle`);

  function assertCraftEqual(entry, kind, extent, base) {
    const { bad, stackDiffs, deMismatch, spMismatch } = craftReplay(entry, kind, extent, base, drawCappedTileColumn);
    const where = `kind=${hx(kind)} extent=${extent === null ? "captured(" + hx(entry.mem.read8(EXTENT)) + ")" : hx(extent)} tilemap=${base === null ? hx(entry.mem.read16(TILEMAP_PTR)) : hx(base)}`;
    assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ${where}`);
    assert.equal(stackDiffs, 0, `loc_0ee8 touches no stack — no stack-scratch residue expected (${where})`);
    assert.equal(deMismatch, null, deMismatch && `DE live-out diff ${where}: oracle=${hx(deMismatch.oracle)} idiomatic=${hx(deMismatch.cand)}`);
    assert.equal(spMismatch, null, spMismatch && `SP diff ${where}: oracle=${hx(spMismatch.oracle)} idiomatic=${hx(spMismatch.cand)}`);

    // drawCappedTileColumn must NOT model the stack or control flow: SP and pc
    // unchanged from entry (the oracle threads pc through m.step, so pc is asserted
    // on the candidate, not compared against the oracle).
    const c = entry.clone();
    c.mem.write8(KIND, kind);
    if (extent !== null) c.mem.write8(EXTENT, extent);
    if (base !== null) c.mem.write16(TILEMAP_PTR, base);
    const sp0 = c.regs.sp, pc0 = c.pc;
    drawCappedTileColumn(c);
    assert.equal(c.regs.sp, sp0, `drawCappedTileColumn must leave SP unchanged (no stack modelling) — ${where}`);
    assert.equal(c.pc, pc0, `drawCappedTileColumn must leave pc unchanged (no jp/ret modelling) — ${where}`);
  }
});

// -- 2. TEETH (first step) ----------------------------------------------------

/** Broken twin: pays the FIRST step down by 0x08 instead of 0x10, so it stores
 *  different 0x63B1 values and lays a different row count — a plausible confusion with
 *  fillTileColumn's flat 0x08 step. */
function brokenFirstStep(m) {
  const { regs, mem } = m;
  const kind = mem.read8(0x63b3);
  if (kind !== 0x03) { fillTileColumn(m); return; }
  let addr = mem.read16(0x63ab);
  mem.write8(addr, 0xb3);
  addr = (addr + 0x20) & 0xffff;
  const extent0 = mem.read8(0x63b1);
  let extent = (extent0 - 0x08) & 0xff; // BUG: first step should be 0x10
  let spent = extent0 < 0x08;           // (matching the wrong step)
  for (;;) {
    if (spent) { mem.write8(addr, 0xb2); break; }
    mem.write8(0x63b1, extent);
    mem.write8(addr, 0xb1);
    addr = (addr + 0x20) & 0xffff;
    spent = extent < 0x08;
    extent = (extent - 0x08) & 0xff;
  }
  regs.de = (regs.de + 1) & 0xffff;
}

test("TEETH (first step): the wrong FIRST step (0x08, not 0x10) is CAUGHT in game-visible RAM", () => {
  const caps = captureWalkStates(64, 2500);
  assert.ok(caps.length >= 1, "need a real render-scratch state to craft from");

  let caught = null;
  outer: for (const entry of caps) {
    for (const extent of [null, ...EXTENTS_K3]) {
      const { bad } = craftReplay(entry, 0x03, extent, extent === null ? null : SAFE_TILEMAP, brokenFirstStep);
      if (bad) { caught = { ...bad, extent }; break outer; }
    }
  }
  assert.notEqual(caught, null, "the crafted sweep FAILED to catch a wrong first step — it is worthless");
  assert.equal(inStack(caught.addr), false, "the caught diff must be game-visible, not stack scratch");
  console.log(`  TEETH/first-step: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b}) extent=${caught.extent === null ? "captured" : hx(caught.extent)}`);
});

// -- 3. TEETH (body tile) -----------------------------------------------------

/** Broken twin: lays body tile 0xB0 instead of 0xB1 — an off-by-one on the body tile
 *  code. Caught in the tilemap VRAM on any multi-row run. */
function brokenBodyTile(m) {
  const { regs, mem } = m;
  const kind = mem.read8(0x63b3);
  if (kind !== 0x03) { fillTileColumn(m); return; }
  let addr = mem.read16(0x63ab);
  mem.write8(addr, 0xb3);
  addr = (addr + 0x20) & 0xffff;
  const extent0 = mem.read8(0x63b1);
  let extent = (extent0 - 0x10) & 0xff;
  let spent = extent0 < 0x10;
  for (;;) {
    if (spent) { mem.write8(addr, 0xb2); break; }
    mem.write8(0x63b1, extent);
    mem.write8(addr, 0xb0); // BUG: body tile should be 0xB1
    addr = (addr + 0x20) & 0xffff;
    spent = extent < 0x08;
    extent = (extent - 0x08) & 0xff;
  }
  regs.de = (regs.de + 1) & 0xffff;
}

test("TEETH (body tile): the wrong body tile (0xB0, not 0xB1) is CAUGHT in the tilemap", () => {
  const caps = captureWalkStates(64, 2500);
  assert.ok(caps.length >= 1, "need a real render-scratch state to craft from");

  let caught = null;
  outer: for (const entry of caps) {
    for (const extent of [null, ...EXTENTS_K3]) {
      const { bad } = craftReplay(entry, 0x03, extent, extent === null ? null : SAFE_TILEMAP, brokenBodyTile);
      if (bad) { caught = { ...bad, extent }; break outer; }
    }
  }
  assert.notEqual(caught, null, "the crafted sweep FAILED to catch a wrong body tile — it is worthless");
  assert.equal(inStack(caught.addr), false, "the caught diff must be game-visible, not stack scratch");
  console.log(`  TEETH/body-tile: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b}) extent=${caught.extent === null ? "captured" : hx(caught.extent)}`);
});

// -- 4. TEETH (live-out DE) ---------------------------------------------------

/** Broken twin: forgets to advance DE on the kind-3 path, so the walk would re-read
 *  the same record. Only the DE comparison catches this (RAM is identical). */
function brokenDeAdvance(m) {
  const { regs, mem } = m;
  const kind = mem.read8(0x63b3);
  if (kind !== 0x03) { fillTileColumn(m); return; }
  let addr = mem.read16(0x63ab);
  mem.write8(addr, 0xb3);
  addr = (addr + 0x20) & 0xffff;
  const extent0 = mem.read8(0x63b1);
  let extent = (extent0 - 0x10) & 0xff;
  let spent = extent0 < 0x10;
  for (;;) {
    if (spent) { mem.write8(addr, 0xb2); break; }
    mem.write8(0x63b1, extent);
    mem.write8(addr, 0xb1);
    addr = (addr + 0x20) & 0xffff;
    spent = extent < 0x08;
    extent = (extent - 0x08) & 0xff;
  }
  // BUG: missing regs.de = (regs.de + 1) & 0xffff;
}

test("TEETH (live-out DE): the missing record-pointer advance is CAUGHT by the DE compare", () => {
  const caps = captureWalkStates(64, 2500);
  assert.ok(caps.length >= 1, "need a real render-scratch state to craft from");

  let caught = null;
  outer: for (const entry of caps) {
    for (const extent of [null, ...EXTENTS_K3]) {
      const { deMismatch } = craftReplay(entry, 0x03, extent, extent === null ? null : SAFE_TILEMAP, brokenDeAdvance);
      if (deMismatch) { caught = { ...deMismatch, extent }; break outer; }
    }
  }
  assert.notEqual(caught, null, "the DE compare FAILED to catch a missing record-pointer advance — it is worthless");
  console.log(`  TEETH/DE: caught extent=${caught.extent === null ? "captured" : hx(caught.extent)} (oracle DE=${hx(caught.oracle)} broken DE=${hx(caught.cand)})`);
});
