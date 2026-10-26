// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for dispatchFramePhaseHandler (ROM 0xc7bd-0xc7d9) -- a DSW-gated RTS-trick dispatcher: when (DSW1_COINAGE & 0x83)
// == 0x82 it returns immediately; otherwise it runs a pre-pass (stepSpikeTableCollapse), sets bit7 of INPUT_EDGE_FLAGS, and
// rts-dispatches to word($c7da+GAME_MODE)+1. The table has 19 entries (idx0..18); idx6 is an unused slot
// (ROM word 0x0000 -> a jump into RAM, never validly selected). The idiomatic form dissolves the trick
// into TABLE[GAME_MODE>>1](m, y, x). Contract: RAM (dumpState minus STACK_SCRATCH), plus the exit [X, Y] the
// dispatcher returns (the handler's, or the entry X/Y when the DSW gate skips), which the main loop hands to
// seedFramePhaseAndTick (EXIT-REGS). DSW1_COINAGE is the read-only DSW1 port (driven via m.io.dsw1); a handler
// reaches the clock-coupled POKEY RANDOM so CAPTURE freezes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-c7bd.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c7bd as oracle } from "../../translated/loc_c7bd.js";
import { dispatchFramePhaseHandler } from "../dispatchFramePhaseHandler.js";
import { resetLevelPlayfieldSlots } from "../resetLevelPlayfieldSlots.js";
import { setupLevelTimers } from "../setupLevelTimers.js";
import { runPerFrameUpdates } from "../runPerFrameUpdates.js";
import { tickEnemyPacingCountdown } from "../tickEnemyPacingCountdown.js";
import { reloadPacingFromPeakSlot } from "../reloadPacingFromPeakSlot.js";
import { commitPendingModeAfterDelay } from "../commitPendingModeAfterDelay.js";
import { bumpLevelEnemyQuota } from "../bumpLevelEnemyQuota.js";
import { buildSortedSoundRequest } from "../buildSortedSoundRequest.js";
import { tickActiveSoundSlot } from "../tickActiveSoundSlot.js";
import { seedModeParamsFromMaskedFlags } from "../seedModeParamsFromMaskedFlags.js";
import { tickWaveSpawnCadence, reseedWaveWorkingSet } from "../selectWaveStartSlot.js";
import { autoAdvanceRimRotation } from "../autoAdvanceRimRotation.js";
import { seedModeParamsWithBounds } from "../seedModeParamsWithBounds.js";
import { seedModeParamsMinimal } from "../seedModeParamsMinimal.js";
import { runFrameStateUpdaters } from "../runFrameStateUpdaters.js";
import { armModeAndRebuildIfEnabled } from "../armModeAndRebuildIfEnabled.js";
import { stepEnemyFleetAndSpawn } from "../stepEnemyFleetAndSpawn.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stepSpikeTableCollapse } from "../stepSpikeTableCollapse.js";
import {
  STACK_SCRATCH, GAME_MODE, INPUT_EDGE_FLAGS, SPIKED_SEGMENT_COUNT, PLAYER_FINE_ANGLE, STATUS_FLAGS, SPINNER_ACCUM,
  RIM_ROT_OFFSET, PLAYER_SEGMENT, TUBE_GEOM_FLAG, SPIKE_TABLE_GUARD, loc_3fe, loc_32,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc7bd;
const GARBAGE_IDX = 6; // the only unused slot (ROM word 0x0000)
const TABLE = [
  resetLevelPlayfieldSlots, setupLevelTimers, runPerFrameUpdates, tickEnemyPacingCountdown, reloadPacingFromPeakSlot, commitPendingModeAfterDelay, null, bumpLevelEnemyQuota, buildSortedSoundRequest, tickActiveSoundSlot,
  seedModeParamsFromMaskedFlags, tickWaveSpawnCadence, autoAdvanceRimRotation, seedModeParamsWithBounds, reseedWaveWorkingSet, seedModeParamsMinimal, runFrameStateUpdaters, armModeAndRebuildIfEnabled, stepEnemyFleetAndSpawn,
];
const OFFSETS = TABLE.map((t, idx) => (t ? idx * 2 : -1)).filter((o) => o >= 0);
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xc7bd dispatches -- dispatchFramePhaseHandler == oracle in RAM (-stack)", () => {
  let checked = 0, skippedGarbage = 0;
  for (const cap of CAPS) {
    // Only the genuine idx6 garbage slot is skipped (there the oracle jumps into RAM); the coinage gate
    // (DSW1_COINAGE & 0x83)==0x82 short-circuits before the dispatch and is compared normally.
    if ((cap.io.readDsw1() & 0x83) !== 0x82 && (cap.mem.read8(GAME_MODE) >> 1) === GARBAGE_IDX) { skippedGarbage++; continue; }
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a real dispatch may reach an unimplemented handler arm; POKEY RANDOM frozen
    dispatchFramePhaseHandler(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} compared (${skippedGarbage} idx6-garbage skipped)`);
});

test("GATE: (DSW1 & 0x83)==0x82 -> early return, no dispatch (INPUT_EDGE_FLAGS bit7 untouched)", () => {
  const o = new Machine(ROM, OPTS); o.io.dsw1 = 0x82; o.mem.write8(INPUT_EDGE_FLAGS, 0x00);
  const c = new Machine(ROM, OPTS); c.io.dsw1 = 0x82; c.mem.write8(INPUT_EDGE_FLAGS, 0x00);
  oracle(o); dispatchFramePhaseHandler(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the gated (no-dispatch) path");
  assert.equal(c.mem.read8(INPUT_EDGE_FLAGS) & 0x80, 0, "gate closed: the dispatch (and its INPUT_EDGE_FLAGS bit7 set) did not run");
});

test("CRAFTED: each live entry offset -> dispatchFramePhaseHandler == oracle in RAM (gate open); skip on oracle throw", () => {
  let checked = 0;
  for (const off of OFFSETS) {
    const o = freezePokey(new Machine(ROM, OPTS)); o.io.dsw1 = 0x00; o.mem.write8(GAME_MODE, off);
    const c = freezePokey(new Machine(ROM, OPTS)); c.io.dsw1 = 0x00; c.mem.write8(GAME_MODE, off);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a handler the generic seed cannot provision
    dispatchFramePhaseHandler(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching offset ${off}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/${OFFSETS.length} entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

test("TEETH: a twin that dispatches the WRONG entry (off>>1)^1 diverges in RAM", () => {
  let caught = false, tried = 0;
  for (const off of OFFSETS) {
    const o = freezePokey(new Machine(ROM, OPTS)); o.io.dsw1 = 0x00; o.mem.write8(GAME_MODE, off);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const idx = off >> 1, flipped = idx ^ 1;
    if (flipped >= TABLE.length || !TABLE[flipped]) continue;
    const c = freezePokey(new Machine(ROM, OPTS)); c.io.dsw1 = 0x00; c.mem.write8(GAME_MODE, off);
    let brokeThrew = false;
    try { c.mem.write8(INPUT_EDGE_FLAGS, c.mem.read8(INPUT_EDGE_FLAGS) | 0x80); TABLE[flipped](c); } catch { brokeThrew = true; }
    if (brokeThrew) continue;
    tried++;
    if (ramDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no entry pair could be exercised for the teeth arm");
  assert.ok(caught, "the RAM diff FAILED to catch a wrong-entry dispatch on every exercised pair");
});

test("SP-TOOTH: the omitted-ret dispatcher is seam-placeable", () => {
  const m = freezePokey(new Machine(ROM, OPTS)); m.io.dsw1 = 0x00; m.mem.write8(GAME_MODE, 0x04); // -> runPerFrameUpdates
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, dispatchFramePhaseHandler, TARGET, m);
  assert.equal(r.placeable, true, `dispatchFramePhaseHandler must be seam-placeable; got: ${r.error}`);
});

// Mode 0x20 (runFrameStateUpdaters) with a negative spike guard and slot 0 empty: the pre-pass leaves Y = 1
// (slot 0's neighbour index, 0+1), and that Y, not the entry Y, reaches the sound loader's loc_32 stash.
function seedPrepassY(m) {
  const w = (a, v) => m.mem.write8(a, v);
  m.io.dsw1 = 0x00; w(GAME_MODE, 0x20);
  w(SPIKED_SEGMENT_COUNT, 0xc4); w(PLAYER_FINE_ANGLE, 0x00); w(STATUS_FLAGS, 0x80);
  w(SPINNER_ACCUM, 0x10); w(RIM_ROT_OFFSET, 0x40); w(PLAYER_SEGMENT, 0x0f); w(TUBE_GEOM_FLAG, 0x00);
  w(SPIKE_TABLE_GUARD, 0xff);
  for (let i = 0; i < 8; i++) w(loc_3fe + i, i === 0 ? 0x00 : 0x40);
  m.regs.x = 0x3c;
  return freezePokey(m);
}

test("STALE-REGS: the spike pre-pass exit Y (not the entry Y) reaches the handler's loc_32 stash", () => {
  const o = seedPrepassY(new Machine(ROM, OPTS)); o.regs.y = 0x4d;
  const c = seedPrepassY(new Machine(ROM, OPTS)); c.regs.y = 0x5a; c.regs.x = 0xa5; c.regs.a = 0xc3; // poisoned
  oracle(o);
  assert.equal(o.mem.read8(loc_32), 0x01, "control: the oracle stashed the pre-pass Y = 1, not the entry 0x4d");
  dispatchFramePhaseHandler(c, 0x4d);
  assert.equal(ramDiff(o, c), null, "RAM equal with the pre-pass Y threaded to the handler");
});

// Spinning during the warp while the spike table collapses: mode 0x18 (autoAdvanceRimRotation), whose
// rim-cue sound loader stashes Y in loc_32. The pre-pass reloads Y first, so the stash must be the
// reloaded Y, not the entry Y. Port side gets a stale m.regs.y so a dropped thread cannot hide.
const ENTRY_Y = 0x33, STASH_SEED = 0xee;
function warpSpin() {
  const m = freezePokey(new Machine(ROM, OPTS)); m.io.dsw1 = 0x00;
  const w = (a, v) => m.mem.write8(a, v);
  w(GAME_MODE, 0x18); w(STATUS_FLAGS, 0x80); w(SPIKE_TABLE_GUARD, 0x40);
  for (let i = 0; i < 8; i++) w(loc_3fe + i, 0x30);
  w(loc_3fe, 0x05);
  w(PLAYER_FINE_ANGLE, 0x00); w(SPINNER_ACCUM, 0x10); w(RIM_ROT_OFFSET, 0x50); w(PLAYER_SEGMENT, 0x05); w(TUBE_GEOM_FLAG, 0x00);
  w(loc_32, STASH_SEED);
  m.regs.x = 0x18; m.regs.y = ENTRY_Y;
  return m;
}

test("WARP-SPIN: the pre-pass's reloaded Y reaches the mode-0x18 rim-cue stash (loc_31/32/35/36 == oracle)", () => {
  const o = warpSpin(); oracle(o);
  const c = warpSpin(); c.regs.y = 0x00; dispatchFramePhaseHandler(c, ENTRY_Y);
  // Positive controls: the oracle's loader ran (stash rewritten), and with a Y other than the entry Y.
  const stash = o.mem.read8(loc_32);
  assert.notEqual(stash, STASH_SEED, "oracle never reached the rim-cue loader (stash still the seed)");
  assert.notEqual(stash, ENTRY_Y, "oracle's pre-pass did not reload Y (stash equals entry Y)");
  // A twin that skips the reload (handler gets the entry Y) must diverge from the oracle.
  const t = warpSpin();
  stepSpikeTableCollapse(t, ENTRY_Y); t.mem.write8(INPUT_EDGE_FLAGS, t.mem.read8(INPUT_EDGE_FLAGS) | 0x80);
  autoAdvanceRimRotation(t, ENTRY_Y);
  assert.notEqual(t.mem.read8(loc_32), stash, "teeth: the entry-Y twin matches the oracle, so this arm cannot see a dropped reload");
  for (const a of [0x31, 0x32, 0x35, 0x36]) assert.equal(c.mem.read8(a), o.mem.read8(a), `cell 0x${a.toString(16)}`);
  assert.equal(ramDiff(o, c), null, "RAM equal (-stack)");
});

// Every handler's exit registers, which the main loop hands to seedFramePhaseAndTick (and from there, via the
// sound loader, into loc_31/loc_32). Bases: the captured dispatches; each trial forces one mode and seeds that
// handler's branch cells (and the pre-pass's) from a fixed LCG, enters with random X/Y on the oracle and the
// same values as arguments on the port (m.regs poisoned; one trial in five enters through the register bridge
// instead), and compares RAM and the returned [X, Y]. A trial
// the oracle cannot finish (an unprovisioned arm, or a seed that spins) is skipped. One trial in seven closes
// the DSW gate, whose skip must hand the entry X/Y straight back.
const BCD = (v) => ((((v >> 4) % 10) << 4) | ((v & 0x0f) % 10));
const CELLS = { // GAME_MODE -> [cell, value-from-random]
  0x00: [[0x05], [0x3e, (v) => v & 1], [0x126], [0x09]],
  0x02: [[0x3f, (v) => v & 1], [0x3d, (v) => v & 1], [0x05], [0x117]],
  0x04: [[0x201, (v) => (v & 0x80 ? v : v & 0x0f)], [0x05], [0x50], [0x111], [0x116], [0x106, (v) => (v & 1 ? v : 0)], [0x3ab, (v) => (v & 1 ? v : 0)],
    [0x4d], [0x09], [0x135, (v) => (v & 1 ? v : 0)], [0xa6, (v) => v & 7], [0x3d, (v) => v & 1], [0x2df], [0x2dc], [0x30a], [0x48, (v) => v & 1],
    [0x2d3, (v) => (v & 1 ? 0xe8 : v)], [0x2d4, (v) => (v & 1 ? 0xe8 : v)], [0x2d5, (v) => (v & 3 ? 0 : v)], [0x2d6, (v) => (v & 3 ? 0 : v)],
    [0x2d7, (v) => (v & 3 ? 0 : v)], [0x2d8, (v) => (v & 3 ? 0 : v)], [0x2d9, (v) => (v & 3 ? 0 : v)], [0x2da, (v) => (v & 3 ? 0 : v)]],
  0x06: [[0x3d, (v) => v & 1], [0x3e, (v) => v & 1], [0x3f, (v) => v & 1], [0x46], [0x47], [0x48, (v) => v & 3], [0x49, (v) => v & 3]],
  0x08: [[0x3e, (v) => v & 1], [0x46], [0x47], [0x05]],
  0x0a: [[0x03], [0x16b], [0x04], [0x201, (v) => (v & 0x80 ? v : v & 0x0f)], [0x05], [0x50], [0x111]],
  0x0e: [[0x3d, (v) => v & 1], [0x46], [0x47], [0x102], [0x103], [0x05]],
  0x10: [[0x3e, (v) => v & 1], [0x3d, (v) => v & 1], [0x09], [0x600], [0x601]],
  0x12: [[0x03, (v) => (v & 1 ? 0x20 : v)], [0x605, (v) => v & 3], [0x602, (v) => v & 0x0f], [0x4e], [0x604, (v) => v & 1], [0x3d, (v) => v & 1],
    [0x600], [0x601], [0x603, (v) => (v & 1 ? 0 : v)], [0x606], [0x607], [0x608]],
  0x14: [], 0x1a: [], 0x1e: [],
  0x16: [[0x05], [0x605, (v) => (v & 1 ? 0 : v)], [0x04, (v) => (v & 0x10 ? 4 : BCD(v))], [0x4e], [0x200, (v) => v & 0x0f], [0x3d, (v) => v & 1], [0x9f]],
  0x18: [[0x121], [0x5f, (v) => (v & 1 ? 0xf0 : v)], [0x5b, (v) => (v & 2 ? 0xff : v)], [0x5d], [0x201, (v) => (v & 0x80 ? v : v & 0x0f)], [0x05],
    [0x3d, (v) => v & 1]],
  0x1c: [[0x05], [0x3f, (v) => v & 1], [0x605], [0x04, BCD], [0x4e], [0x200, (v) => v & 0x0f], [0x9f]],
  0x20: [[0x201, (v) => (v & 0x80 ? v : v & 0x0f)], [0x05], [0x106], [0x116, (v) => (v & 1 ? 0 : v)], [0x50], [0x111],
    [0x135, (v) => (v & 1 ? 0 : v)], [0xa6, (v) => (v & 1 ? 0 : v)], [0x3d, (v) => v & 1], [0x48, (v) => v & 1], [0x202], [0x5b], [0x5f]],
  0x22: [[0x1ca, (v) => (v & 1 ? v : 0)], [0x1c9]],
  0x24: [[0x10e, (v) => v & 3], [0x283], [0x284], [0x285], [0x292], [0x03]],
};
test("EXIT-REGS: every handler's exit [X, Y] (and the DSW skip's) == the oracle's, RAM equal, m.regs poisoned", () => {
  let seed = 0x2545f491;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
  const checked = new Map(), moved = { x: 0, y: 0 };
  let skips = 0;
  for (const off of OFFSETS) {
    for (let k = 0; k < 64; k++) {
      const base = CAPS[k % CAPS.length];
      const o = freezePokey(base.clone()), c = freezePokey(base.clone());
      const gated = k % 7 === 6;
      const writes = [[GAME_MODE, off], ...CELLS[off].map(([a, f]) => [a, (f ?? ((v) => v))(rnd())])];
      if (rnd() & 1) writes.push([SPIKE_TABLE_GUARD, rnd()], ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [loc_3fe + i, rnd() & 0x7f]));
      const dsw2 = rnd(); // the option dips feed decodeOptionSwitches (the d7e1 rebuild's exit Y)
      for (const m of [o, c]) { m.io.dsw1 = gated ? 0x82 : 0x00; m.io.dsw2 = dsw2; for (const [a, v] of writes) m.mem.write8(a, v); }
      const ex = rnd(), ey = rnd();
      // One trial in five enters through the register bridge (no arguments, as a frozen caller would), so the
      // param defaults must read the X/Y the file holds; the rest pass them explicitly with m.regs poisoned.
      const bridge = k % 5 === 4;
      o.regs.x = ex; o.regs.y = ey; c.regs.x = bridge ? ex : ex ^ 0xff; c.regs.y = bridge ? ey : ey ^ 0xff;
      o.maxCycles = o.cycles + 2e6;
      try { oracle(o); } catch { continue; }
      const got = bridge ? dispatchFramePhaseHandler(c) : dispatchFramePhaseHandler(c, ey, ex);
      assert.equal(ramDiff(o, c), null, `RAM equal: mode 0x${off.toString(16)} trial ${k}`);
      assert.deepEqual(got, [o.regs.x, o.regs.y], `exit [X, Y]: mode 0x${off.toString(16)} trial ${k} (entry ${ex}/${ey})`);
      if (gated) skips++;
      else {
        checked.set(off, (checked.get(off) ?? 0) + 1);
        if (o.regs.x !== off) moved.x++;
        if (o.regs.y !== ey) moved.y++;
      }
    }
  }
  // Positive controls: every handler ran ungated on several seeds, the gate's skip ran, and the handlers'
  // exits are not all the entry values (X = the mode byte, Y = the entry Y).
  for (const off of OFFSETS) assert.ok((checked.get(off) ?? 0) >= 8, `mode 0x${off.toString(16)} checked only ${checked.get(off) ?? 0}x`);
  assert.ok(skips >= 8, "the DSW skip was barely exercised");
  assert.ok(moved.x > 100 && moved.y > 100, `handlers rarely moved X/Y (${moved.x}/${moved.y})`);
});
