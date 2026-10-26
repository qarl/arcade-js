// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for startMarioFallWhenGroundGivesWay (ROM 0x2A85) — the grounded foot-contact tile check that
 * hands off to the slope-footing fall decision.
 *
 * startMarioFallWhenGroundGivesWay runs while Mario is in plain grounded contact: it early-outs on three gates
 * (on-ladder, airborne, edge-reposition), then samples the tilemap cell under his foot and,
 * if that tile is not a solid flat girder, defers to decideSlopeGirderFooting. Its only
 * memory-observable effect on any path is the one-shot MARIO_START_FALL (0x6221) trigger the
 * slope check raises on its fall branches; every other path writes nothing.
 *
 * The oracle brackets the foot-cell lookup with `push hl` / `push (return)` / `pop de` around
 * its `call 0x2ff0`. The idiomatic routine dissolves that into a direct tileAddrForPixel call
 * and never touches the stack, so those pushed bytes are dead scratch the candidate does not
 * write — the memory-equivalence contract is RAM MINUS the stack scratch below the entry SP. SP is placed at the top
 * of the scratch region so every push the oracle (and the nested slope cascade) makes lands
 * inside [0x6be0, 0x6c00). Live-out is memory-only; pc/SP are dead (the caller tail-invokes
 * and consumes nothing), so the gate compares RAM only, minus the stack scratch below the entry SP.
 *
 * Decision structure the crafted entries cover:
 *   GATES — three independent early-outs: on-ladder != 0, airborne != 0, edge-flag == 1.
 *   TILE  — past the gates: keep footing iff the foot tile is a solid flat girder
 *           (tile >= 0xB0 AND low nibble < 8); otherwise defer to decideSlopeGirderFooting,
 *           reached by EITHER tile < 0xB0 OR (tile & 0x0F) >= 8.
 *   FALL  — inside the slope check, a column-aligned probe X (low 3 bits zero) falls
 *           unconditionally; otherwise the tile one row up decides.
 *
 *   1. REACHABILITY / EQUAL (captured) — hook 0x2A85 in a real boot/attract run, clone at
 *      each dispatch, and confirm startMarioFallWhenGroundGivesWay == oracle (RAM − the stack scratch below the entry SP) on every real state
 *      the game produces. The attract tape reaches the keeps-footing / gate exits; the
 *      slope hand-off is a frontier the crafted entries carry.
 *   2. EQUAL (crafted) — poke gate cells, Mario X/Y, and the foot/upper tiles identically on
 *      both sides to drive each gate return, the keeps-footing exit, and both slope arms
 *      (tile < 0xB0 and low-nibble >= 8), with the fall both taken (alignment / upper slope)
 *      and not taken (upper solid). Every case matches the oracle; the fall cases prove the
 *      hand-off is non-vacuous by observing MARIO_START_FALL rise.
 *   3. TEETH — three broken twins, each of which the crafted cases MUST catch on
 *      MARIO_START_FALL:
 *        (a) drops the on-ladder gate — falls where the oracle returns.
 *        (b) drops the edge-reposition gate — falls where the oracle returns.
 *        (c) off-by-one solid threshold (`<= 0xB0`) — defers at tile 0xB0 where the oracle
 *            keeps footing.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2a85.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2a85 as oracle } from "../../translated/loc_2a85.js";
import { startMarioFallWhenGroundGivesWay } from "../startMarioFallWhenGroundGivesWay.js";
import { tileAddrForPixel } from "../tileAddrForPixel.js";
import { decideSlopeGirderFooting } from "../decideSlopeGirderFooting.js";
import {
  STACK_SCRATCH,
  MARIO_ON_LADDER,
  MARIO_AIRBORNE,
  EDGE_REPOSITION_FLAG,
  MARIO_X,
  MARIO_Y,
  MARIO_START_FALL,
} from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2a85;

// SP at the top of the dead scratch region so the oracle's push hl / push (return) around the
// foot-cell lookup — and every push the nested slope cascade makes — land inside STACK_SCRATCH.
const SAFE_SP = 0x6c00;
// A plausible caller return pushed under SAFE_SP so the oracle's terminal ret pops MAPPED
// scratch (0x6c00 itself is unmapped). Never compared — pc/SP are dead.
const RET_ADDR = 0x02cd;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The foot-cell address for a given Mario X/Y, mirroring tileAddrForPixel / the oracle's
// sub_2ff0: probe X = MarioX-3 feeds the tilemap's vertical axis, probe Y = MarioY+0x0C the
// horizontal one (the 90-degree rotation). Used to plant the foot tile and the upper tile.
function footCellFor(marioX, marioY) {
  const probeX = (marioX - 3) & 0xff;
  const probeY = (marioY + 0x0c) & 0xff;
  return tileAddrForPixel(probeX, probeY);
}
const upperCellOf = (footCell) => (footCell - 0x20) & 0xffff;

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

// All non-stack RAM addresses that changed between two machines (for the no-write
// non-vacuity check on the gate-return / keeps-footing paths).
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
// realistic values. 0x2A85's inputs are then crafted on top of it.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// A crafted dispatch: clone the base, open/close the three gates, place Mario, plant the foot
// tile and the upper tile (one row up) in video RAM, clear MARIO_START_FALL, and seat SP in
// scratch. Frame machinery re-neutralised so the oracle's step()/ret() cannot fire an NMI.
function makeEntry(base, {
  onLadder = 0, airborne = 0, edgeFlag = 0,
  marioX = 0x60, marioY = 0x50, tile = 0xb0, upperTile = 0xb0,
}) {
  const e = base.clone();
  e.mem.write8(MARIO_ON_LADDER, onLadder);
  e.mem.write8(MARIO_AIRBORNE, airborne);
  e.mem.write8(EDGE_REPOSITION_FLAG, edgeFlag);
  e.mem.write8(MARIO_X, marioX);
  e.mem.write8(MARIO_Y, marioY);
  e.mem.write8(MARIO_START_FALL, 0);
  const foot = footCellFor(marioX, marioY);
  e.mem.write8(foot, tile);
  e.mem.write8(upperCellOf(foot), upperTile);
  e.regs.sp = SAFE_SP;
  e.push16(RET_ADDR); // land the caller-return in mapped scratch; pushes/pops stay in STACK_SCRATCH
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// Run the oracle and a candidate on two fresh, byte-identical entries (the routine writes
// memory, so each side needs its own copy) and diff RAM − the stack scratch below the entry SP.
function runPair(base, opts, candidate) {
  const a = makeEntry(base, opts);
  const aFloor = a.regs.sp;
  const b = makeEntry(base, opts);
  oracle(a);
  candidate(b);
  return { diff: firstRamDiff(a, b, aFloor), oracleAfter: a, entry: makeEntry(base, opts) };
}

// -- 1. REACHABILITY / EQUAL (captured) ---------------------------------------

test("EQUAL (captured): startMarioFallWhenGroundGivesWay == oracle on every real 0x2A85 dispatch", () => {
  const caps = [];
  let count = 0;
  const orig = new Machine(ROM).routines.get(TARGET);
  const snap = new Map([[TARGET, (mm) => {
    count++;
    if (caps.length < 96) caps.push(mm.clone());
    return orig(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  assert.ok(count > 0, "0x2A85 should be dispatched during attract (grounded foot-contact check)");

  let sawFall = 0, sawQuiet = 0;
  for (const cap of caps) {
    const a = cap.clone(); a.nextNmi = Infinity; a.nextBoundary = Infinity;
    const b = cap.clone(); b.nextNmi = Infinity; b.nextBoundary = Infinity;
    oracle(a);
    startMarioFallWhenGroundGivesWay(b);
    const diff = firstRamDiff(a, b, cap.regs.sp);
    assert.equal(diff, null, diff && `real dispatch diverges at ${hx(diff.addr)} (oracle=${diff.a} cand=${diff.b})`);
    if (a.mem.read8(MARIO_START_FALL) !== cap.mem.read8(MARIO_START_FALL)) sawFall++; else sawQuiet++;
  }
  console.log(`  EQUAL/captured: ${count} real 0x2A85 dispatches in 2000 attract frames; ${caps.length} replayed identical (${sawFall} raised MARIO_START_FALL, ${sawQuiet} quiet)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

// marioX = 0x60 -> probeX 0x5D (low 3 bits = 5, NOT column-aligned): the tile governs.
// marioX = 0x63 -> probeX 0x60 (low 3 bits = 0, column-aligned): the slope check falls
//                  unconditionally, so the hand-off always writes MARIO_START_FALL.
const ALIGNED_X = 0x63;
const UNALIGNED_X = 0x60;

test("EQUAL (crafted): gate returns, keeps-footing, and both slope arms all match the oracle", () => {
  const base = attractBase();

  const cases = [
    // -- the three gate early-outs (a slope tile past them would fall, so a dropped gate shows) --
    { name: "gate: on ladder", opts: { onLadder: 1, marioX: ALIGNED_X, tile: 0x00 }, write: false },
    { name: "gate: airborne", opts: { airborne: 1, marioX: ALIGNED_X, tile: 0x00 }, write: false },
    { name: "gate: edge-reposition", opts: { edgeFlag: 1, marioX: ALIGNED_X, tile: 0x00 }, write: false },
    // edge flag == 2 is NOT the gate value (only == 1 returns): proceeds, solid tile keeps footing
    { name: "edge flag 2 is not the gate", opts: { edgeFlag: 2, marioX: UNALIGNED_X, tile: 0xb0 }, write: false },
    // -- keeps footing: solid flat girder (>= 0xB0, low nibble < 8), not aligned --
    { name: "keeps footing (solid 0xB0)", opts: { marioX: UNALIGNED_X, tile: 0xb0 }, write: false },
    { name: "keeps footing (solid 0xB7)", opts: { marioX: UNALIGNED_X, tile: 0xb7 }, write: false },
    // -- slope arm via tile < 0xB0, not aligned, upper tile SOLID -> keeps footing, no write --
    { name: "slope tile, upper solid -> no fall", opts: { marioX: UNALIGNED_X, tile: 0x40, upperTile: 0xb0 }, write: false },
    // -- slope arm via tile < 0xB0, not aligned, upper tile SLOPE -> fall --
    { name: "slope tile, upper slope -> fall", opts: { marioX: UNALIGNED_X, tile: 0x40, upperTile: 0x00 }, write: true },
    // -- slope arm via tile < 0xB0, aligned -> unconditional fall --
    { name: "slope tile, aligned -> fall", opts: { marioX: ALIGNED_X, tile: 0x00 }, write: true },
    // -- slope arm via low nibble >= 8 (tile >= 0xB0), aligned -> fall --
    { name: "girder low-nibble 8 arm -> fall", opts: { marioX: ALIGNED_X, tile: 0xb8 }, write: true },
    { name: "girder low-nibble 0xF arm -> fall", opts: { marioX: ALIGNED_X, tile: 0xbf }, write: true },
  ];

  for (const { name, opts, write } of cases) {
    const { diff, oracleAfter, entry } = runPair(base, opts, startMarioFallWhenGroundGivesWay);
    assert.equal(diff, null, `${name}: RAM diverges at ${diff ? hx(diff.addr) : "?"} (oracle=${diff?.a} cand=${diff?.b})`);
    if (write) {
      // The slope hand-off genuinely reached triggerMarioFall.
      assert.equal(oracleAfter.mem.read8(MARIO_START_FALL), 1, `${name}: expected MARIO_START_FALL raised`);
    } else {
      // No memory changed at all — the path is truly a no-op, so equivalence is not vacuous.
      assert.deepEqual(changedAddrs(entry, oracleAfter, entry.regs.sp), [], `${name}: expected no non-stack RAM write`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (3 gates, non-gate edge value, keeps-footing x2, both slope arms with fall taken/not) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------
//
// Each twin is startMarioFallWhenGroundGivesWay with a single injected bug; it reaches the SAME idiomatic slope check
// on its fall branches, so a caught twin diverges on MARIO_START_FALL — never a spurious cell.

function probeOf(m) {
  const { mem } = m;
  const probeX = (mem.read8(MARIO_X) - 3) & 0xff;
  const probeY = (mem.read8(MARIO_Y) + 0x0c) & 0xff;
  return { probeX, footCell: tileAddrForPixel(probeX, probeY) };
}
function deferSlope(m, probeX, footCell) {
  m.regs.d = probeX;
  m.regs.hl = footCell;
  return decideSlopeGirderFooting(m);
}

/** BUG (a): drops the on-ladder gate. */
function twinDropLadderGate(m) {
  const { mem } = m;
  if (mem.read8(MARIO_AIRBORNE) !== 0) return;
  if (mem.read8(EDGE_REPOSITION_FLAG) === 1) return;
  const { probeX, footCell } = probeOf(m);
  const tile = mem.read8(footCell);
  if (tile < 0xb0 || (tile & 0x0f) >= 8) return deferSlope(m, probeX, footCell);
}

/** BUG (b): drops the edge-reposition gate. */
function twinDropEdgeGate(m) {
  const { mem } = m;
  if (mem.read8(MARIO_ON_LADDER) !== 0) return;
  if (mem.read8(MARIO_AIRBORNE) !== 0) return;
  const { probeX, footCell } = probeOf(m);
  const tile = mem.read8(footCell);
  if (tile < 0xb0 || (tile & 0x0f) >= 8) return deferSlope(m, probeX, footCell);
}

/** BUG (c): off-by-one solid threshold — treats 0xB0 as a slope. */
function twinThreshold(m) {
  const { mem } = m;
  if (mem.read8(MARIO_ON_LADDER) !== 0) return;
  if (mem.read8(MARIO_AIRBORNE) !== 0) return;
  if (mem.read8(EDGE_REPOSITION_FLAG) === 1) return;
  const { probeX, footCell } = probeOf(m);
  const tile = mem.read8(footCell);
  if (tile <= 0xb0 || (tile & 0x0f) >= 8) return deferSlope(m, probeX, footCell); // BUG: `<=` should be `<`
}

test("TEETH: the dropped-on-ladder-gate twin is CAUGHT on MARIO_START_FALL", () => {
  const base = attractBase();
  // On a ladder + slope tile + aligned probe: the oracle returns at the gate (no write); the
  // twin proceeds and the aligned slope check falls.
  const { diff } = runPair(base, { onLadder: 1, marioX: ALIGNED_X, tile: 0x00 }, twinDropLadderGate);
  assert.notEqual(diff, null, "the dropped-on-ladder-gate twin escaped — the gate is worthless");
  assert.equal(diff.addr, MARIO_START_FALL, `expected divergence at MARIO_START_FALL, got ${hx(diff.addr)}`);
  console.log(`  TEETH/ladder-gate: caught at ${hx(diff.addr)} (oracle=${diff.a} twin=${diff.b})`);
});

test("TEETH: the dropped-edge-reposition-gate twin is CAUGHT on MARIO_START_FALL", () => {
  const base = attractBase();
  const { diff } = runPair(base, { edgeFlag: 1, marioX: ALIGNED_X, tile: 0x00 }, twinDropEdgeGate);
  assert.notEqual(diff, null, "the dropped-edge-reposition-gate twin escaped — the gate is worthless");
  assert.equal(diff.addr, MARIO_START_FALL, `expected divergence at MARIO_START_FALL, got ${hx(diff.addr)}`);
  console.log(`  TEETH/edge-gate: caught at ${hx(diff.addr)} (oracle=${diff.a} twin=${diff.b})`);
});

test("TEETH: the off-by-one solid-threshold twin is CAUGHT on MARIO_START_FALL", () => {
  const base = attractBase();
  // Tile exactly 0xB0 (solid, keeps footing), not aligned, with a slope tile one row up: the
  // oracle keeps footing (no write); the twin defers and the upper slope makes it fall.
  const { diff } = runPair(base, { marioX: UNALIGNED_X, tile: 0xb0, upperTile: 0x00 }, twinThreshold);
  assert.notEqual(diff, null, "the off-by-one solid-threshold twin escaped — the gate is worthless");
  assert.equal(diff.addr, MARIO_START_FALL, `expected divergence at MARIO_START_FALL, got ${hx(diff.addr)}`);
  console.log(`  TEETH/threshold: caught at ${hx(diff.addr)} (oracle=${diff.a} twin=${diff.b})`);
});
