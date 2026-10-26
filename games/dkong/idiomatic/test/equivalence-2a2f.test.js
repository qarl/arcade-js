// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2a2f (ROM 0x2A2F) — the moving-object slope-footing probe that snaps
 * an object UP onto a sloped girder it has reached and reports the contact.
 *
 * ★ AXES. This header used to have the record's two coordinate fields SWAPPED (it called +3 "Y"
 * and +5 "X", and described the routine as sliding the object sideways along the slope). names.js
 * grounds OBJ_X = record +3 and OBJ_Y = record +5, and the store at ROM 0x2A7D (`d6 04 / dd 77
 * 05`) writes record +5 = OBJ_Y — see loc_2a2f.js's own AXIS CORRECTION note. The local names
 * below follow the corrected axes so the error cannot be re-derived from this file.
 *
 * loc_2a2f reads the object record the caller's pointer selects (OBJ_X at offset 3, OBJ_Y at
 * offset 5), samples the tilemap cell 4 px BELOW the object, and classifies that tile: passable
 * footing (tile < 0xB0, a girder tile with low nibble >= 8, or exactly 0xC0) does nothing; a
 * slope tile picks a row offset by class, snaps the probe row back to its 8 px tile boundary,
 * adds the offset to get the girder SURFACE row, and — only if that surface is ABOVE the probe
 * point (a smaller Y, i.e. the object has fallen to or through it) — rewrites the object's
 * OBJ_Y record (undoing the 4 px probe nudge) and reports contact.
 *
 * LIVE-OUT is the object-record OBJ_Y byte (rewritten only on the landing arm) plus a BOOLEAN
 * return: the caller consumes the result as `and a / jp nz`, so the test asserts the candidate's
 * return matches the oracle's residual accumulator (0 = no contact, 1 = contact) on every entry.
 *
 * The oracle brackets the cell lookup with `push hl` / `push (return)` / `pop de` around its
 * `call 0x2FF0`; the idiomatic routine dissolves that into a direct tileAddrForPixel call and
 * never touches the stack, so those pushed bytes are dead scratch the candidate does not write.
 * The memory-equivalence contract is therefore RAM MINUS the stack scratch below the entry SP. For crafted entries SP
 * is seated at the top of the scratch region so every push the oracle makes lands inside
 * [0x6be0, 0x6c00); pc/SP are dead (a caller reads only the returned flag), so they are not
 * compared.
 *
 *   1. REACHABILITY / EQUAL (captured) — hook 0x2A2F in a real boot/attract run, clone at each
 *      dispatch, and confirm loc_2a2f == oracle (RAM − the stack scratch below the entry SP, return) on every real
 *      state the game produces. The attract demo reaches BOTH arms (the landing rewrite fires
 *      for rolling objects), so captures span passable and landing alike.
 *   2. EQUAL (crafted) — poke the object record and the foot tile identically on both sides to
 *      drive each passable exit (tile < 0xB0, low nibble >= 8, exactly 0xC0), every slope class
 *      and its offset, and both landing arms (rewrites OBJ_Y / leaves it). Every case matches
 *      the oracle; write cases prove the landing is non-vacuous by observing the OBJ_Y change.
 *   3. TEETH — three broken twins, each of which the crafted cases MUST catch:
 *        (a) off-by-one passable threshold (`<= 0xB0`) — passes a 0xB0 slope where the oracle
 *            lands.
 *        (b) dropped 4 px nudge-undo (writes the surface row, not surface-4) — wrong landing row.
 *        (c) flipped landing comparison (`surface > probeY`) — refuses a landing the oracle takes.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2a2f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2a2f as oracle } from "../../translated/loc_2a2f.js";
import { loc_2a2f } from "../loc_2a2f.js";
import { tileAddrForPixel } from "../tileAddrForPixel.js";
import { STACK_SCRATCH } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2a2f;

// SP at the top of the dead scratch region so the oracle's push hl / push (return) around the
// cell lookup land inside STACK_SCRATCH.
const SAFE_SP = 0x6c00;
// A plausible caller return pushed under SAFE_SP so the oracle's terminal ret pops MAPPED
// scratch (0x6c00 itself is unmapped). Never compared — pc/SP are dead.
const RET_ADDR = 0x02cd;
// An object-record base in the real object array the attract demo uses (barrels at 0x6700).
const OBJ_PTR = 0x6700;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The tilemap cell the routine probes for a given object X/Y, mirroring the oracle: the object's
// X feeds the tilemap's vertical axis and its Y + 4 (the 4 px probe nudge downward) the
// horizontal one — the 90-degree display rotation. Used to plant the foot tile.
const cellFor = (objX, objY) => tileAddrForPixel(objX, u8(objY + 4));

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// All non-stack RAM addresses that changed between two machines (for the no-write non-vacuity
// check on the passable / no-land paths).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

// A real, self-consistent machine: boot + a stretch of attract so the surrounding RAM holds
// realistic values. 0x2A2F's inputs are then crafted on top of it.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// A crafted dispatch: clone the base, aim the object pointer, place the object's X/Y, plant the
// foot tile in video RAM, and seat SP in scratch with a caller return.
function makeEntry(base, { objX = 0x50, objY = 0x60, tile = 0xb0 }) {
  const e = base.clone();
  e.regs.ix = OBJ_PTR;
  e.mem.write8((OBJ_PTR + 3) & 0xffff, objX); // OBJ_X
  e.mem.write8((OBJ_PTR + 5) & 0xffff, objY); // OBJ_Y
  e.mem.write8(cellFor(objX, objY), tile);
  e.regs.sp = SAFE_SP;
  e.push16(RET_ADDR); // land the caller-return in mapped scratch; pushes/pops stay in STACK_SCRATCH
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// Run the oracle on a fresh clone; its residual accumulator is the contact flag (0 / 1).
function runOracle(entry) {
  const c = entry.clone();
  c.nextNmi = Infinity;
  c.nextBoundary = Infinity;
  oracle(c);
  return c;
}

// Run a candidate on a fresh clone; capture its boolean return.
function runCandidate(entry, fn) {
  const c = entry.clone();
  c.nextNmi = Infinity;
  c.nextBoundary = Infinity;
  const ret = fn(c);
  return { c, ret };
}

// Full contract diff: RAM − the stack scratch below the entry SP, plus the boolean return vs the oracle's contact flag.
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const { c, ret } = runCandidate(entry, fn);
  const out = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) out.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  const oracleContact = o.regs.a !== 0;
  if (ret !== oracleContact) out.push(`return oracle=${oracleContact} cand=${ret}`);
  return out;
}

// -- 1. REACHABILITY / EQUAL (captured) ---------------------------------------

test("EQUAL (captured): loc_2a2f == oracle on every real 0x2A2F dispatch", () => {
  const caps = [];
  let count = 0;
  const orig = new Machine(ROM).routines.get(TARGET);
  const snap = new Map([[TARGET, (mm) => {
    count++;
    if (caps.length < 128) caps.push(mm.clone());
    return orig(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  assert.ok(count > 0, "0x2A2F should be dispatched during attract (moving-object slope probe)");

  let sawLanding = 0, sawPassable = 0;
  for (const cap of caps) {
    const before = cap.mem.read8((cap.regs.ix + 5) & 0xffff); // OBJ_Y
    const diffs = contractDiffs(cap, loc_2a2f);
    assert.equal(diffs.length, 0, `real dispatch: ${diffs.join("; ")}`);
    if (runOracle(cap).mem.read8((cap.regs.ix + 5) & 0xffff) !== before) sawLanding++; else sawPassable++;
  }
  console.log(`  EQUAL/captured: ${count} real 0x2A2F dispatches in 2000 attract frames; ${caps.length} replayed identical (${sawLanding} snapped OBJ_Y, ${sawPassable} passable)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------
//
// objY = 0x60 -> probe row 0x64 (100), snapped cell boundary 0x60 (96). Each slope class' offset
// then decides whether the snapped-plus-offset surface sits above 100 (land) or not (no land).

test("EQUAL (crafted): passable exits, every slope class, and both landing arms match the oracle", () => {
  const base = attractBase();

  const cases = [
    // -- passable: tile below the girder range --
    { name: "passable tile 0x00", opts: { tile: 0x00 }, write: false },
    { name: "passable tile 0xAF", opts: { tile: 0xaf }, write: false },
    // -- passable: girder tile with low nibble >= 8 --
    { name: "passable low-nibble 8 (0xB8)", opts: { tile: 0xb8 }, write: false },
    { name: "passable low-nibble F (0xCF)", opts: { tile: 0xcf }, write: false },
    // -- passable: exactly 0xC0 (the flat-tile early-out) --
    { name: "passable exactly 0xC0", opts: { tile: 0xc0 }, write: false },
    // -- slope class 0xB0-0xB7: offset -1, lands --
    { name: "slope 0xB0-0xB7 lands (0xB4)", opts: { tile: 0xb4 }, write: true },
    { name: "slope 0xB0-0xB7 lands (0xB0)", opts: { tile: 0xb0 }, write: true },
    // -- slope class 0xC0-0xC7 (low nibble - 9): lands --
    { name: "slope 0xC0-0xC7 lands (0xC4)", opts: { tile: 0xc4 }, write: true },
    // -- slope class 0xD0-0xD7 (low nibble - 1): land and no-land --
    { name: "slope 0xD0-0xD7 lands (0xD1)", opts: { tile: 0xd1 }, write: true },
    { name: "slope 0xD0-0xD7 no land (0xD5)", opts: { tile: 0xd5 }, write: false },
    // -- slope class 0xE0-0xE7 (low nibble - 9): lands --
    { name: "slope 0xE0-0xE7 lands (0xE3)", opts: { tile: 0xe3 }, write: true },
    // -- slope class 0xF0-0xF7 (low nibble - 1): land and no-land --
    { name: "slope 0xF0-0xF7 lands (0xF1)", opts: { tile: 0xf1 }, write: true },
    { name: "slope 0xF0-0xF7 no land (0xF6)", opts: { tile: 0xf6 }, write: false },
  ];

  for (const { name, opts, write } of cases) {
    const entry = makeEntry(base, opts);
    const diffs = contractDiffs(entry, loc_2a2f);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    const before = entry.mem.read8((OBJ_PTR + 5) & 0xffff);
    if (write) {
      // The landing arm ran: the OBJ_Y record moved and contact was reported.
      assert.notEqual(after.mem.read8((OBJ_PTR + 5) & 0xffff), before, `${name}: OBJ_Y record not rewritten`);
      assert.equal(after.regs.a, 1, `${name}: oracle did not report contact`);
    } else {
      // No landing: nothing non-stack was written and no contact reported.
      assert.deepEqual(changedAddrs(entry, after, entry.regs.sp), [], `${name}: passable/no-land path wrote non-stack RAM`);
      assert.equal(after.regs.a, 0, `${name}: oracle reported contact on a passable path`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (3 passable exits, all 5 slope classes, land + no-land) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------
//
// Each twin is loc_2a2f with a single injected bug. A caught twin diverges on the OBJ_Y record
// and/or the returned contact flag.

/** BUG (a): off-by-one passable threshold — treats a 0xB0 slope tile as passable. */
function twinThreshold(m) {
  const { regs, mem } = m;
  const objPtr = regs.ix;
  const objX = mem.read8((objPtr + 3) & 0xffff);
  const probeY = u8(mem.read8((objPtr + 5) & 0xffff) + 4);
  const tile = mem.read8(tileAddrForPixel(objX, probeY));
  if (tile <= 0xb0) return false; // BUG: `<=` should be `<`
  if ((tile & 0x0f) >= 8) return false;
  if (tile === 0xc0) return false;
  const slope = slopeOffset(tile);
  const surface = u8((probeY & 0xf8) + slope);
  if (surface < probeY) { mem.write8((objPtr + 5) & 0xffff, surface - 4); return true; }
  return false;
}

/** BUG (b): writes the surface row without undoing the 4 px probe nudge. */
function twinNoUndo(m) {
  const { regs, mem } = m;
  const objPtr = regs.ix;
  const objX = mem.read8((objPtr + 3) & 0xffff);
  const probeY = u8(mem.read8((objPtr + 5) & 0xffff) + 4);
  const tile = mem.read8(tileAddrForPixel(objX, probeY));
  if (tile < 0xb0) return false;
  if ((tile & 0x0f) >= 8) return false;
  if (tile === 0xc0) return false;
  const slope = slopeOffset(tile);
  const surface = u8((probeY & 0xf8) + slope);
  if (surface < probeY) { mem.write8((objPtr + 5) & 0xffff, surface); return true; } // BUG: no - 4
  return false;
}

/** BUG (c): flipped landing comparison — refuses a landing the oracle takes. */
function twinFlippedDir(m) {
  const { regs, mem } = m;
  const objPtr = regs.ix;
  const objX = mem.read8((objPtr + 3) & 0xffff);
  const probeY = u8(mem.read8((objPtr + 5) & 0xffff) + 4);
  const tile = mem.read8(tileAddrForPixel(objX, probeY));
  if (tile < 0xb0) return false;
  if ((tile & 0x0f) >= 8) return false;
  if (tile === 0xc0) return false;
  const slope = slopeOffset(tile);
  const surface = u8((probeY & 0xf8) + slope);
  if (surface > probeY) { mem.write8((objPtr + 5) & 0xffff, surface - 4); return true; } // BUG: `>` should be `<`
  return false;
}

// The slope-class offset table, shared by the twins (only their bug line differs).
function slopeOffset(tile) {
  if (tile < 0xc0) return 0xff;
  if (tile < 0xd0) return u8((tile & 0x0f) - 9);
  if (tile < 0xe0) return u8((tile & 0x0f) - 1);
  if (tile < 0xf0) return u8((tile & 0x0f) - 9);
  return u8((tile & 0x0f) - 1);
}

test("TEETH: the off-by-one-threshold twin is CAUGHT", () => {
  const base = attractBase();
  // Tile exactly 0xB0 (a slope the object lands on): the oracle rewrites OBJ_Y and reports
  // contact; the twin treats 0xB0 as passable and does nothing.
  const diffs = contractDiffs(makeEntry(base, { tile: 0xb0 }), twinThreshold);
  assert.ok(diffs.length > 0, "the off-by-one-threshold twin escaped — the gate is worthless");
  console.log(`  TEETH/threshold: caught (${diffs.join("; ")})`);
});

test("TEETH: the dropped-nudge-undo twin is CAUGHT", () => {
  const base = attractBase();
  // A landing case: correct OBJ_Y = surface - 4, twin writes the surface row — different byte.
  const diffs = contractDiffs(makeEntry(base, { tile: 0xb4 }), twinNoUndo);
  assert.ok(diffs.length > 0, "the dropped-nudge-undo twin escaped — the gate is worthless");
  assert.ok(diffs[0].startsWith("RAM@"), `expected the OBJ_Y-record diff first, got ${diffs[0]}`);
  console.log(`  TEETH/no-undo: caught (${diffs.join("; ")})`);
});

test("TEETH: the flipped-landing-comparison twin is CAUGHT", () => {
  const base = attractBase();
  // A landing case: the oracle lands (surface < probeY); the twin's flipped test refuses it.
  const diffs = contractDiffs(makeEntry(base, { tile: 0xb4 }), twinFlippedDir);
  assert.ok(diffs.length > 0, "the flipped-landing-comparison twin escaped — the gate is worthless");
  console.log(`  TEETH/flipped-compare: caught (${diffs.join("; ")})`);
});
