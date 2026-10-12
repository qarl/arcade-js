// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for flyBomberThenTryAimedShot vs its frozen translation at ROM 0x3b77. Attract dispatches only
// the mirror+spawn arm (all carry-clear); coin-start never reaches it. Real attract entries prove
// that arm; the retire arm and a live spawn body are crafted from a real entry with one nudge each.
// Diffed whole, minus the frozen side's push window and a register ceiling. Teeth part in memory.
// Run: node --test games/timeplt/idiomatic/test/equivalence-3b77.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { flyBomberThenTryAimedShot } from "../flyBomberThenTryAimedShot.js";
import { loc_3b77 as frozen } from "../../translated/loc_3b77.js";
import { flyAlongStoredVelocity } from "../flyAlongStoredVelocity.js";
import { hasReachedBoundaryBandSelectedByHeading } from "../hasReachedBoundaryBandSelectedByHeading.js";
import { retireObjectAndHold } from "../retireObjectAndHold.js";
import { mirrorTwoTileObjectByHeading } from "../mirrorTwoTileObjectByHeading.js";
import { fireBomberShotWhenClearOfPlayer } from "../fireBomberShotWhenClearOfPlayer.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x3b77;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const WORLD_SCROLL_Y = 0xa808;
const HEADING = 2;
const VELOCITY_HIGH = 10;
const FRACTION_HIGH = 3;
const TILE_Y = 0x31;
const SECOND_TILE_Y = 0x33;
const SECOND_TILE_X = 0x02;
const RECORD_HEAD = 0;
const HELD_BYTE = 14;
const HELD_AT = 128;
const ARRIVED_Y = 238;
const LOWER_BAND_HEADING = 0;
const DATA_TOP = 0xadff;

const SLOT_FREE = 0xff;
const SPAWN_COOLDOWN = 0xa8f4;
const ERA_COUNT = 0xa8c6;
const BANK_A_FLAG = 0xa840;
const WINDOW_HALF = 0xa8d6;

// The frogger standard: RAM (masked over the frozen side's stack scratch) is the contract, and only
// genuine named register live-outs are pinned. Both arms leave their product in memory, and the whole
// dispatch chain up to serviceEra1BomberObject tail-returns and reads no register these leave -- so the
// set is empty. (ix/iy the spawn arm once left are now scratch: the spawn re-expresses them as locals.)
const GENUINE_LIVE_OUTS = [];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d ? `${d.addr == null ? "reg " + d.k : hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical";

let attract = null;
function captureAttract() {
  if (attract) return attract;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => { entries.push(mm.clone()); return frozen(mm); }]]), { tape: [] });
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `attract stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "attract ran short");
  attract = entries;
  return attract;
}

function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  frozen(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  }
  return n;
}

// Whole-dump diff on independent clones, minus the frozen side's push window and the ceiling, then
// the return value.
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const ra = frozen(a);
  let rb;
  try { rb = candidate(b); } catch (e) { return { addr: null, k: "threw", a: "returned", b: String(e).slice(0, 30) }; }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, k, a: a.regs[k], b: b.regs[k] };
  }
  if (ra !== rb) return { addr: null, k: "ret", a: ra, b: rb };
  return null;
}

// The carry arm: force hasReachedBoundaryBandSelectedByHeading to answer arrived. Heading picks the lower band, the object's own
// velocity and the shared scroll are zeroed so the flown Y lands in the three-wide arrival window.
function craftRetire() {
  const c = captureAttract()[0].clone();
  c.mem8[WORLD_SCROLL_Y] = 0;
  c.mem8[WORLD_SCROLL_Y + 1] = 0;
  c.mem8[u16(c.regs.ix + HEADING)] = LOWER_BAND_HEADING;
  c.mem8[u16(c.regs.ix + VELOCITY_HIGH)] = 0;
  c.mem8[u16(c.regs.ix + VELOCITY_HIGH + 1)] = 0;
  c.mem8[u16(c.regs.ix + FRACTION_HIGH)] = 0;
  c.mem8[u16(c.regs.iy + TILE_Y)] = ARRIVED_Y;
  return c;
}

// The no-carry arm reaching a live spawn. The real entry is already carry-clear, so heading and the
// coordinates are left untouched; only the spawn guards open, and a zero window makes the first slot
// a certain hit so the body runs to completion.
function craftSpawn() {
  const c = captureAttract()[0].clone();
  c.mem8[u16(c.regs.ix + RECORD_HEAD)] = SLOT_FREE;
  c.mem8[SPAWN_COOLDOWN] = 0;
  c.mem8[ERA_COUNT] = 1;
  c.mem8[BANK_A_FLAG] = 0;
  c.mem8[WINDOW_HALF] = 0;
  return c;
}

test("REACHABILITY: attract dispatches the address on the carry-clear arm; coin-start does not",
  { skip }, () => {
    const entries = captureAttract();
    assert.ok(entries.length > 0, "attract never dispatched this address; the instrument is dead");
    for (const e of entries) {
      const probe = e.clone();
      hasReachedBoundaryBandSelectedByHeading(probe);
      assert.equal(probe.regs.f & 0x01, 0, "an attract entry sets carry, so it is real evidence for the retire arm");
    }
    let seen = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => { seen++; return frozen(mm); }]]));
    m.runFrames(ENTRY_FRAMES);
    assert.equal(seen, 0, "coin-start now dispatches this address, so it is the better tape and this note is stale");
    console.log(`  REACHABILITY: attract ${entries.length} dispatches, all carry-clear; coin-start ${seen}`);
  });

test("REAL DISPATCHES: every attract entry identical", { skip }, () => {
  const entries = captureAttract();
  for (const e of entries) {
    const d = unitDiff(flyBomberThenTryAimedShot, e);
    assert.equal(d, null, `an attract dispatch diverged: ${show(d)}`);
  }
  const foots = entries.map(footprint);
  assert.ok(foots.every((n) => n > 0), "an attract dispatch wrote nothing, so its comparison is trivial");
  console.log(`  REAL: ${entries.length} attract dispatches identical; footprints ${foots.join(",")}`);
});

test("RETIRE ARM: crafted carry entry identical, and the retire really fires", { skip }, () => {
  const c = craftRetire();
  assert.equal(unitDiff(flyBomberThenTryAimedShot, c), null, `the retire arm diverged: ${show(unitDiff(flyBomberThenTryAimedShot, c))}`);
  const after = c.clone();
  frozen(after);
  assert.equal(after.mem8[u16(c.regs.ix + RECORD_HEAD)], 0, "the record head was not cleared, so this is not the retire arm");
  assert.equal(after.mem8[u16(c.regs.ix + HELD_BYTE)], HELD_AT, "the held byte was not armed, so this is not the retire arm");
  console.log(`  RETIRE: identical; record head cleared, held byte ${HELD_AT}`);
});

test("SPAWN BODY: crafted no-carry entry identical, and the body writes", { skip }, () => {
  const c = craftSpawn();
  assert.equal(unitDiff(flyBomberThenTryAimedShot, c), null, `the spawn body diverged: ${show(unitDiff(flyBomberThenTryAimedShot, c))}`);
  assert.ok(footprint(c) > 6, "the crafted entry did not run the spawn body, so it proves nothing about that arm");
  console.log(`  SPAWN: identical; footprint ${footprint(c)}`);
});

test("STACK: the drift is exactly two bytes and the mask floor clears the data", { skip }, () => {
  for (const machine of [captureAttract()[0], craftRetire()]) {
    const a = machine.clone();
    const b = machine.clone();
    const seat = a.regs.sp;
    let low = seat;
    const push = a.push16.bind(a);
    a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
    frozen(a);
    flyBomberThenTryAimedShot(b);
    assert.equal(a.regs.sp - b.regs.sp, 2, `the frozen side no longer re-seats two bytes higher (${a.regs.sp - b.regs.sp})`);
    assert.ok(low > DATA_TOP, `the push window ${hex4(low)} reached down into game data`);
  }
  console.log("  STACK: spDiff 2 on both arms; window floor clears the data");
});

// Each twin is paired with the machine whose arm it corrupts; the retire twins need the crafted
// carry entry, the spawn twin the crafted body.
const SPAWN_ENTRY = () => captureAttract()[0];
const TWINS = [
  ["no-fly", (m) => { const { regs, mem8 } = m; const s = regs.iy; mem8[u16(s + SECOND_TILE_Y)] = u8(mem8[u16(s + TILE_Y)] + 0x10); mem8[u16(s + SECOND_TILE_X)] = mem8[u16(s)]; if (hasReachedBoundaryBandSelectedByHeading(m)) return retireObjectAndHold(m); mirrorTwoTileObjectByHeading(m); return fireBomberShotWhenClearOfPlayer(m); }, SPAWN_ENTRY],
  ["wrong-drop", (m) => { const { regs, mem8 } = m; const s = regs.iy; flyAlongStoredVelocity(m); mem8[u16(s + SECOND_TILE_Y)] = u8(mem8[u16(s + TILE_Y)] + 0x08); mem8[u16(s + SECOND_TILE_X)] = mem8[u16(s)]; if (hasReachedBoundaryBandSelectedByHeading(m)) return retireObjectAndHold(m); mirrorTwoTileObjectByHeading(m); return fireBomberShotWhenClearOfPlayer(m); }, SPAWN_ENTRY],
  ["no-second-x", (m) => { const { regs, mem8 } = m; const s = regs.iy; flyAlongStoredVelocity(m); mem8[u16(s + SECOND_TILE_Y)] = u8(mem8[u16(s + TILE_Y)] + 0x10); if (hasReachedBoundaryBandSelectedByHeading(m)) return retireObjectAndHold(m); mirrorTwoTileObjectByHeading(m); return fireBomberShotWhenClearOfPlayer(m); }, SPAWN_ENTRY],
  ["skip-mirror", (m) => { const { regs, mem8 } = m; const s = regs.iy; flyAlongStoredVelocity(m); mem8[u16(s + SECOND_TILE_Y)] = u8(mem8[u16(s + TILE_Y)] + 0x10); mem8[u16(s + SECOND_TILE_X)] = mem8[u16(s)]; if (hasReachedBoundaryBandSelectedByHeading(m)) return retireObjectAndHold(m); return fireBomberShotWhenClearOfPlayer(m); }, SPAWN_ENTRY],
  ["always-retire", (m) => { const { regs, mem8 } = m; const s = regs.iy; flyAlongStoredVelocity(m); mem8[u16(s + SECOND_TILE_Y)] = u8(mem8[u16(s + TILE_Y)] + 0x10); mem8[u16(s + SECOND_TILE_X)] = mem8[u16(s)]; hasReachedBoundaryBandSelectedByHeading(m); return retireObjectAndHold(m); }, SPAWN_ENTRY],
  ["ignore-carry", (m) => { const { regs, mem8 } = m; const s = regs.iy; flyAlongStoredVelocity(m); mem8[u16(s + SECOND_TILE_Y)] = u8(mem8[u16(s + TILE_Y)] + 0x10); mem8[u16(s + SECOND_TILE_X)] = mem8[u16(s)]; hasReachedBoundaryBandSelectedByHeading(m); mirrorTwoTileObjectByHeading(m); return fireBomberShotWhenClearOfPlayer(m); }, craftRetire],
  ["skip-spawn", (m) => { const { regs, mem8 } = m; const s = regs.iy; flyAlongStoredVelocity(m); mem8[u16(s + SECOND_TILE_Y)] = u8(mem8[u16(s + TILE_Y)] + 0x10); mem8[u16(s + SECOND_TILE_X)] = mem8[u16(s)]; if (hasReachedBoundaryBandSelectedByHeading(m)) return retireObjectAndHold(m); mirrorTwoTileObjectByHeading(m); }, craftSpawn],
];

test("TEETH: each broken twin parts company IN MEMORY; the genuine routine does not", { skip }, () => {
  for (const [label, twin, machineFor] of TWINS) {
    const machine = machineFor();
    const d = unitDiff(twin, machine);
    assert.notEqual(d, null, `the "${label}" twin escaped the gate`);
    assert.notEqual(d.addr, null, `the "${label}" twin was caught only in a register, not in memory: ${show(d)}`);
    assert.equal(unitDiff(flyBomberThenTryAimedShot, machine), null, `the genuine routine is flagged on the "${label}" machine, so its teeth prove nothing`);
  }
  console.log(`  TEETH: ${TWINS.length} twins caught in memory; genuine clean on each`);
});
