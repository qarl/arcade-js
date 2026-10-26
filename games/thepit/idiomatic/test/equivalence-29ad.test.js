// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceDigCarveObject (ROM 0x29ad, The Pit) — the per-frame driver for
 * the dig/carve object. It clears the three overlap-seam flags, gates a new spawn or a
 * capture hand-off when the tracked object is aligned on a feature cell, then dispatches
 * on the spawn counter and runs the carve countdown: stepping the dig position + digging
 * animation while it ticks, and on expiry either completing the column or probing the
 * carve box and carving one tile into the tilemap. Every exit hands off to an idiomatic
 * callee (background update 0x2f71 = advanceChamberCreature, startNextDigSpawn, captureTargetOnOverlap,
 * commitDigEntity, stageDigObjectSpriteRecord).
 *
 * CONTRACT. The routine has NO register live-ins — every input is read from RAM — and
 * every hand-off is delegated to an idiomatic callee that is memory-equivalent to its
 * oracle but returns via plain JS instead of the Z80 stack dance. So the gate is a
 * RAM-only diff via dumpState: pc/SP and value-registers are the dead Z80 trace and are
 * NOT compared, and the stack scratch below the entry SP is excluded (the
 * oracle's bracketed calls park return addresses there; nothing this routine's own effect
 * lives there — its writes are the 0x807e/0x807f/0x8080 flags, the dig-object record around
 * 0x80a9-0x80c1, PLAYER_CELL_PTR neighbours + the carved cells in video RAM, and the
 * delegated record/sprite/sound writes, all far below the stack).
 *
 * REACHABILITY. 0x29ad is dispatched every frame in attract (~3694 / 4000 frames, entry
 * SP≈0x83fd), so the entry is captured live via the dispatch/m.call override hook. Its
 * natural inputs sit on the background arm (HAZARD_ACTIVE_COUNT==0, no feature latch), so the
 * spawn / capture / carve / commit arms — and the exact tile the classifier sees — are
 * driven by poking the decision bytes identically on both sides (the crafted-entry method).
 *
 * Checks:
 *   0. HARNESS — capture a real 0x29ad entry; the oracle run is deterministic.
 *   1. EQUAL (real entry) — idiomatic == oracle over RAM (minus stack) on natural inputs
 *      (the background arm).
 *   2. EQUAL (every arm) — crafted states take each branch: spawn-start gate, capture
 *      gate, spawn==2 staged-overlap (surviving to a completed column), timer-running
 *      animation (retreat / advance / mid-phase), column complete (sub-type 0 and 2),
 *      arm-in-box capture. Plus positive checks (overlap flag value, snapped PLAYER_Y).
 *   3. EQUAL (carve classify sweep) — reach the carve and sweep the tile already in the
 *      cell 0..255 across several sub-columns; every classification (keep / channel edge /
 *      diggable remap / blank / pass-through) identical, incl. the pending-entity hand-off.
 *   4. TEETH — a genuine logic twin (diggable band one tile too wide) is CAUGHT at the
 *      carved cell; and dropped live-out writes (overlap gate on the background arm, the
 *      carve sprite) are each CAUGHT at their address.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-29ad.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_29ad as oracle } from "../../translated/loc_29ad.js";
import { advanceDigCarveObject as idiomatic } from "../advanceDigCarveObject.js";
import { makeMachineFactory } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  MOVE_BLOCK_FLAG,
  PRIZE_GATE,
  HAZARD_ACTIVE_COUNT,
  HAZARD_STATE,
  DIG_OBJ_TIMER,
  DIG_COLLISION_STATE,
  DIG_OBJ_SUBTYPE,
  PLAYER_Y,
  PLAYER_X,
  HAZARD_X,
  HAZARD_Y,
  STAGED_TARGET_X,
  STAGED_TARGET_Y,
  PLAYER_CELL_PTR,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x29ad;
const FEATURE_ALIGN_LATCH = 0x8078; // set while the tracked object sits on a feature cell
const SEAM_RIGHT_FLAG = 0x807f;
const SEAM_LEFT_FLAG = 0x807e;
const SAVED_CELL_PTR = 0x80ba; // 16-bit saved carve cell for the pending-entity hand-off
const WALL_TILE = 193;
// Stack window at the top of The Pit's work RAM; only the part below the entry SP is dead scratch.
const STACK_LO = 0x8380;
const STACK_HI = 0x8400;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/** Hook 0x29ad in a real attract run and clone the machine at its first entry — a genuine
 *  dig-driver state (valid stack + live object/target bytes). */
function captureRealEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return entry;
}

/** First differing RAM byte between two machines, EXCLUDING stack scratch below the entry SP. */
function ramDiffExStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: STACK_LO, hi: STACK_HI }, entrySP)(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Clone `entry` and write whichever decision bytes the spec supplies. */
function seed(entry, s = {}) {
  const e = entry.clone();
  const w8 = (addr, v) => { if (v !== undefined) e.mem.write8(addr, v); };
  w8(FEATURE_ALIGN_LATCH, s.featLatch);
  w8(PRIZE_GATE, s.tileLatch);
  w8(HAZARD_ACTIVE_COUNT, s.spawn);
  w8(HAZARD_STATE, s.digState);
  w8(DIG_OBJ_TIMER, s.timer);
  w8(DIG_COLLISION_STATE, s.arm);
  w8(DIG_OBJ_SUBTYPE, s.subtype);
  w8(PLAYER_Y, s.objX);
  w8(PLAYER_X, s.objY);
  w8(HAZARD_X, s.targetX);
  w8(HAZARD_Y, s.targetY);
  w8(STAGED_TARGET_X, s.stagedX);
  w8(STAGED_TARGET_Y, s.stagedY);
  if (s.actorCell !== undefined) e.mem.write16(PLAYER_CELL_PTR, s.actorCell);
  if (s.savedCell !== undefined) e.mem.write16(SAVED_CELL_PTR, s.savedCell);
  if (s.cellTile !== undefined) e.mem.write8(carveCellOf(s.targetX, s.targetY) + 1, s.cellTile);
  return e;
}

/** Run oracle vs `fn` on identical clones of a seeded state; return the RAM diff + both. */
function compare(entry, s, fn) {
  const base = seed(entry, s);
  const o = base.clone();
  oracle(o);
  const c = base.clone();
  fn(c);
  return { ram: ramDiffExStack(o, c, base.regs.sp), o, c };
}

/**
 * The video-RAM cell the carve folds the dig position into (from first principles): an
 * inverted row from HAZARD_X, the advanced column from HAZARD_Y. Mirrors the routine's
 * arithmetic so a crafted tile can be planted at cellPtr+1 where the classifier reads it.
 */
function carveCellOf(targetX, targetY) {
  const rowTile = u8(31 - (u8(targetX + 7) >> 3));
  const colByte = u8(u8(targetY + 1) + 9);
  return 0x9000 + rowTile * 32 + (colByte >> 3);
}

// -- 0. HARNESS ---------------------------------------------------------------

test("HARNESS: a real 0x29ad entry is captured and the oracle run is deterministic", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "expected 0x29ad to be dispatched during attract");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  assert.equal(ramDiffExStack(a, b, entry.regs.sp), null, "oracle run of 0x29ad is not deterministic");
  console.log(
    `  HARNESS: captured a real 0x29ad entry (SP=${hx(entry.regs.sp)}); ` +
      `HAZARD_ACTIVE_COUNT=${entry.mem.read8(HAZARD_ACTIVE_COUNT)} HAZARD_STATE=${entry.mem.read8(HAZARD_STATE)}; oracle deterministic`,
  );
});

// -- 1. EQUAL on the real captured entry (background arm) ----------------------

test("EQUAL (real entry): advanceDigCarveObject == oracle over RAM (minus stack) on the natural inputs", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x29ad entry");
  const { ram } = compare(entry, {}, idiomatic);
  assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  console.log("  EQUAL/real: identical over RAM on the natural captured inputs (background arm)");
});

// -- 2. EQUAL over every arm --------------------------------------------------

test("EQUAL (every arm): spawn-start / capture / spawn==2 overlap / animation / complete / arm-in-box match", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x29ad entry");

  const cases = [
    // Feature-aligned gate: no spawn active -> start the next queued spawn (startNextDigSpawn).
    { name: "gate: spawn-start", s: { featLatch: 1, tileLatch: 1, spawn: 0 } },
    // Feature-aligned gate: spawn active + not mid-carve -> capture hand-off (loc_2cb7).
    { name: "gate: capture hand-off", s: { featLatch: 1, tileLatch: 1, spawn: 1, digState: 9 } },
    // Feature-aligned gate: spawn active + mid-carve -> falls through to the carve timer.
    { name: "gate: fall-through (mid-carve)", s: { featLatch: 1, tileLatch: 1, spawn: 1, digState: 48, timer: 5, arm: 1, subtype: 0 } },
    // spawn==2 staged overlap, timer=1+armed -> completeCarveColumn keeps MOVE_BLOCK_FLAG.
    { name: "spawn==2 overlap=1 -> complete", s: { spawn: 2, timer: 1, arm: 1, subtype: 0, objX: 44, objY: 60, stagedX: 40, stagedY: 48, actorCell: 0x9300 } },
    { name: "spawn==2 overlap=0 -> complete", s: { spawn: 2, timer: 1, arm: 1, subtype: 0, objX: 200, objY: 60, stagedX: 40, stagedY: 48, actorCell: 0x9300 } },
    // Timer running: the three animation sub-phases.
    { name: "animation: retreat (ticked&7==0)", s: { spawn: 1, timer: 9, arm: 1, subtype: 0, targetX: 100, targetY: 100, objX: 50, objY: 60 } },
    { name: "animation: advance (ticked&7==4)", s: { spawn: 1, timer: 5, arm: 1, subtype: 0, targetX: 100, targetY: 100, objX: 50, objY: 60 } },
    { name: "animation: mid-phase (ticked&3!=0)", s: { spawn: 1, timer: 4, arm: 1, subtype: 0, targetX: 100, targetY: 100, objX: 50, objY: 60 } },
    // Column complete on timer expiry, both sub-types.
    { name: "complete column, sub-type 0", s: { spawn: 1, timer: 1, arm: 1, subtype: 0, targetX: 100, targetY: 100, actorCell: 0x9300 } },
    { name: "complete column, sub-type 2", s: { spawn: 1, timer: 1, arm: 1, subtype: 2, targetX: 100, targetY: 100, actorCell: 0x9300 } },
  ];

  for (const { name, s } of cases) {
    const { ram } = compare(entry, s, idiomatic);
    assert.equal(ram, null, ram && `${name}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  }

  // Positive: spawn==2 overlap survives to MOVE_BLOCK_FLAG on the completed-column path.
  const c1 = seed(entry, { spawn: 2, timer: 1, arm: 1, subtype: 0, objX: 44, objY: 60, stagedX: 40, stagedY: 48, actorCell: 0x9300 });
  idiomatic(c1);
  assert.equal(c1.mem.read8(MOVE_BLOCK_FLAG), 1, "row-aligned, in-band staged box must set the overlap flag");
  const c0 = seed(entry, { spawn: 2, timer: 1, arm: 1, subtype: 0, objX: 200, objY: 60, stagedX: 40, stagedY: 48, actorCell: 0x9300 });
  idiomatic(c0);
  assert.equal(c0.mem.read8(MOVE_BLOCK_FLAG), 0, "out-of-band staged box must leave the overlap flag clear");

  // Positive: arm-in-box capture snaps PLAYER_Y to the target's near edge and arms the object.
  const cap = seed(entry, { spawn: 1, timer: 0, arm: 0, subtype: 0, objX: 101, objY: 112, targetX: 100, targetY: 100 });
  const { ram: capRam } = compare(entry, { spawn: 1, timer: 0, arm: 0, subtype: 0, objX: 101, objY: 112, targetX: 100, targetY: 100 }, idiomatic);
  assert.equal(capRam, null, capRam && `arm-in-box: RAM diff at ${hx(capRam.addr)}`);
  idiomatic(cap);
  assert.equal(cap.mem.read8(PLAYER_Y), 104, "arm-in-box capture must snap PLAYER_Y to targetX+4");
  assert.equal(cap.mem.read8(DIG_COLLISION_STATE), 1, "arm-in-box capture must arm the dig object");
  console.log(`  EQUAL/arms: all ${cases.length} arms identical; overlap flag + arm-in-box snap verified`);
});

// -- 3. EQUAL over the carve classify sweep -----------------------------------

test("EQUAL (carve classify sweep): every tile-in-cell 0..255 across sub-columns matches", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x29ad entry");

  // Reach the carve: no feature latch, spawn active, timer==0, armed -> probe -> carveTile.
  // objY=0 keeps the probe above the object's row band, so no seam flag, straight to carve.
  // targetY selects the sub-column (colByte = (targetY+1)+9); span 0 / 4 / 7 and channel-bit.
  const targetX = 100;
  const targetYs = [0, 90, 245, 246, 250];
  let checked = 0;
  for (const targetY of targetYs) {
    for (let cellTile = 0; cellTile < 256; cellTile++) {
      const s = { spawn: 1, timer: 0, arm: 1, subtype: 0, objX: 50, objY: 0, targetX, targetY, cellTile };
      const { ram } = compare(entry, s, idiomatic);
      assert.equal(ram, null, ram && `targetY=${targetY} tile=${cellTile}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
      checked++;
    }
  }

  // Pending-entity hand-off: spawn==3 so the commit decrements to a nonzero count and tails
  // into commitDigEntity (its saved cell pointed into video RAM). A kept-wall tile drives the commit.
  const pend = { spawn: 3, timer: 0, arm: 1, subtype: 0, objX: 50, objY: 0, targetX, targetY: 90, cellTile: WALL_TILE, savedCell: 0x9280 };
  const { ram: pendRam } = compare(entry, pend, idiomatic);
  assert.equal(pendRam, null, pendRam && `pending hand-off: RAM diff at ${hx(pendRam.addr)} oracle=${pendRam.a} cand=${pendRam.b}`);
  console.log(`  EQUAL/carve: ${checked} tile classifications identical across ${targetYs.length} sub-columns, + pending-entity hand-off`);
});

// -- 4. TEETH -----------------------------------------------------------------

/**
 * Broken twin: faithful for the carve-sweep scenario (no feature latch, spawn active,
 * timer==0, armed, probe above the row band), but the diggable band is one tile too wide
 * (treats 154 as diggable). Total over the sweep inputs it is fed.
 */
function twinWideDiggableBand(m) {
  const { mem8, mem16 } = m;
  mem8[MOVE_BLOCK_FLAG] = 0;
  mem8[SEAM_RIGHT_FLAG] = 0;
  mem8[SEAM_LEFT_FLAG] = 0;
  // spawn active, timer==0, armed -> straight to the carve (objY=0 keeps the probe above).
  const rowTile = u8(31 - (u8(mem8[HAZARD_X] + 7) >> 3));
  const column = u8(mem8[HAZARD_Y] + 1);
  mem8[HAZARD_Y] = column;
  const colByte = u8(column + 9);
  const cellPtr = 0x9000 + rowTile * 32 + (colByte >> 3);
  mem16[0x80af] = cellPtr;
  const existing = mem8[cellPtr + 1];
  const subCol = colByte & 7;
  const commit = (spriteId, rewrite) => {
    if (rewrite !== null) mem8[cellPtr + 1] = rewrite;
    mem8[cellPtr] = spriteId;
    m.mem.write8(0x8020 + mem8[0x801e], 19 | 0x80); // enqueue carve sound (like requestSound19)
    mem8[0x801e] = (mem8[0x801e] + 1) & 7;
    const remaining = u8(mem8[HAZARD_ACTIVE_COUNT] - 1);
    mem8[HAZARD_ACTIVE_COUNT] = remaining;
    mem8[HAZARD_X] = 0;
    mem8[HAZARD_STATE] = 9;
    return m.call(0x2f71);
  };
  if (existing === 42 || existing === 43 || existing === 193 || existing === 149) return commit(193, null);
  if (existing === 196 && (colByte & 4) !== 0) return commit(196, 193);
  if (existing < 113 || existing >= 155) return m.call(0x2f71); // BUG: band upper bound 155, not 154
  const remapped = mem8[0x2dc7 + (existing - 113) * 8 + subCol];
  if (remapped !== 0) {
    if (subCol === 0) return commit(193, null);
    return commit(196, remapped);
  }
  if (subCol !== 7) return m.call(0x2f71);
  mem8[cellPtr + 1] = 112;
  return m.call(0x2f71);
}

test("TEETH (too-wide diggable band): treating tile 154 as diggable is CAUGHT", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x29ad entry for the teeth check");

  // targetY=245 -> sub-column 7, so even a zero remap forces a divergent write for tile 154.
  const s = { spawn: 1, timer: 0, arm: 1, subtype: 0, objX: 50, objY: 0, targetX: 100, targetY: 245, cellTile: 154 };
  const { ram } = compare(entry, s, twinWideDiggableBand);
  assert.ok(ram, "the gate FAILED to catch the too-wide diggable band — it proves nothing");
  assert.equal(compare(entry, s, idiomatic).ram, null, "idiomatic must PASS the input the twin fails");
  console.log(`  TEETH/band: tile-154 miscarve caught (first at ${hx(ram.addr)}; oracle=${ram.a} twin=${ram.b})`);
});

test("TEETH (dropped live-outs): the overlap gate and the carve sprite are each CAUGHT", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x29ad entry for the teeth check");

  // Background arm leaves MOVE_BLOCK_FLAG = 0; a twin that stamps it is caught at MOVE_BLOCK_FLAG.
  const bg = { featLatch: 0, spawn: 0, objX: 40, objY: 60 };
  const { ram: gateRam } = compare(entry, bg, (m) => { idiomatic(m); m.mem.write8(MOVE_BLOCK_FLAG, 0x77); });
  assert.ok(gateRam, "gate FAILED to catch a stamped overlap gate on the background arm");
  assert.equal(gateRam.addr, MOVE_BLOCK_FLAG, `teeth caught ${hx(gateRam.addr)} (expected ${hx(MOVE_BLOCK_FLAG)})`);

  // Carve path stamps the sprite id into the carved cell; corrupting it is caught there.
  const carve = { spawn: 1, timer: 0, arm: 1, subtype: 0, objX: 50, objY: 0, targetX: 100, targetY: 90, cellTile: WALL_TILE };
  const cellPtr = carveCellOf(100, 90);
  const { ram: cellRam } = compare(entry, carve, (m) => { idiomatic(m); m.mem.write8(cellPtr, m.mem.read8(cellPtr) ^ 0xff); });
  assert.ok(cellRam, "gate FAILED to catch a corrupted carved cell");
  assert.equal(cellRam.addr, cellPtr, `teeth caught ${hx(cellRam.addr)} (expected the carved cell ${hx(cellPtr)})`);
  console.log(`  TEETH/live-outs: overlap gate caught at ${hx(MOVE_BLOCK_FLAG)}, carved cell at ${hx(cellPtr)}`);
});
