// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickEnemyPacingCountdown (ROM 0xc9af-0xc9f0) -- clears $04, decrements $48,x; when $48|$49 == 0 it
// hands off to reloadPacingFromPeakSlot and returns, else it picks the next non-empty slot via the $3f toggle and arms the
// $02/$00 timers. The idiomatic dissolves the m.call(0xc9f1) into a direct reloadPacingFromPeakSlot(m). Live-out is RAM
// plus the exit [X, Y] it returns (it differs per exit path; the frame loop carries it to the sound loader's
// stash), which the CRAFTED arms compare on both exit paths (the CAPTURE arm may capture none). A leaf: the module omits the ROM ret and the seam
// completes it, so arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-c9af.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c9af } from "../../translated/loc_c9af.js";
import { tickEnemyPacingCountdown } from "../tickEnemyPacingCountdown.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { GAME_MODE, GAME_MODE_PENDING, MODE_DELAY_TIMER, loc_3d, ACTIVE_SLOT_COUNT, LEVEL_ID, PLAYER_LEVEL_TBL, loc_47, SLOT_COUNTDOWN, SLOT_COUNTDOWN_HI, WAVE_PEAK_SEED } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc9af;
const oracle = atEntry(loc_c9af);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xc9af dispatches -- tickEnemyPacingCountdown == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(tickEnemyPacingCountdown(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED pick-slot: gate byte survives -> slot chosen, $02/$00 timers armed", () => {
  const seed = (m) => {
    m.mem.write8(loc_3d, 0x00); // X source
    m.mem.write8(SLOT_COUNTDOWN, 0x03); // gate byte, decremented to 0x02 (still nonzero)
    m.mem.write8(SLOT_COUNTDOWN_HI, 0x00);
    m.mem.write8(ACTIVE_SLOT_COUNT, 0x00); // no toggle
    m.mem.write8(LEVEL_ID, 0x00); // selected slot
    m.mem.write8(PLAYER_LEVEL_TBL, 0x05); // $46+slot -> nonzero increment
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); c.regs.x ^= 0xff; c.regs.y ^= 0xff;
  assert.deepEqual([o.regs.x, o.regs.y], [0x00, 0x06], "positive control: the oracle exits the pick-slot path");
  assert.deepEqual(tickEnemyPacingCountdown(c), [o.regs.x, o.regs.y], "exit [X, Y]");
  assert.equal(ramDiff(o, c), null, "RAM equal on the pick-slot path");
  assert.equal(c.mem.read8(SLOT_COUNTDOWN), 0x02, "$48 decremented");
  assert.equal(c.mem.read8(GAME_MODE_PENDING), 0x02, "$02 timer = 0x02");
  assert.equal(c.mem.read8(GAME_MODE), 0x0a, "$00 timer = 0x0a");
  assert.equal(c.mem.read8(MODE_DELAY_TIMER), 0x00, "$04 cleared");
});

// The toggle moves the pick to slot 1, so the exit X (the picked slot) differs from the ticked slot loc_3d.
test("CRAFTED pick-slot toggled: exit X is the toggled slot, not loc_3d", () => {
  const seed = (m) => {
    m.mem.write8(loc_3d, 0x00);
    m.mem.write8(SLOT_COUNTDOWN, 0x03);
    m.mem.write8(SLOT_COUNTDOWN_HI, 0x02); // slot 1 non-empty
    m.mem.write8(ACTIVE_SLOT_COUNT, 0x01); // toggle on
    m.mem.write8(LEVEL_ID, 0x00); // toggles to 1
    m.mem.write8(loc_47, 0x05); // $46+1 -> Y = 6
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); c.regs.x ^= 0xff; c.regs.y ^= 0xff;
  assert.deepEqual([o.regs.x, o.regs.y], [0x01, 0x06], "positive control: the oracle picks slot 1");
  assert.deepEqual(tickEnemyPacingCountdown(c), [o.regs.x, o.regs.y], "exit [X, Y]");
  assert.equal(ramDiff(o, c), null, "RAM equal on the toggled pick-slot path");
});

test("CRAFTED gate-zero: $48|$49 spent -> the dissolved reloadPacingFromPeakSlot hand-off runs", () => {
  const seed = (m) => {
    m.mem.write8(loc_3d, 0x00);
    m.mem.write8(SLOT_COUNTDOWN, 0x01); // decrements to 0x00
    m.mem.write8(SLOT_COUNTDOWN_HI, 0x00); // -> $48|$49 == 0
    m.mem.write8(ACTIVE_SLOT_COUNT, 0x02); // c9f1 scan window
    m.mem.write8(PLAYER_LEVEL_TBL, 0x10);
    m.mem.write8(loc_47, 0x30); // largest in the window
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); c.regs.x ^= 0xff; c.regs.y ^= 0xff;
  assert.deepEqual([o.regs.x, o.regs.y], [0xff, 0x30], "positive control: the oracle exits through c9f1");
  assert.deepEqual(tickEnemyPacingCountdown(c), [o.regs.x, o.regs.y], "exit [X, Y]");
  assert.equal(ramDiff(o, c), null, "RAM equal on the c9f1 hand-off path");
  assert.equal(c.mem.read8(WAVE_PEAK_SEED), 0x2f, "c9f1 wrote max-1 to $126");
});

test("TEETH: a twin that skips the $48,x decrement diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(loc_3d, 0x00);
    m.mem.write8(SLOT_COUNTDOWN, 0x03);
    m.mem.write8(SLOT_COUNTDOWN_HI, 0x00);
    m.mem.write8(ACTIVE_SLOT_COUNT, 0x00);
    m.mem.write8(LEVEL_ID, 0x00);
    m.mem.write8(PLAYER_LEVEL_TBL, 0x05);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenC9af = (m) => {
    const mem = m.mem8;
    mem[MODE_DELAY_TIMER] = 0;
    // BUG: never decrements $48,x
    mem[GAME_MODE_PENDING] = 0x02;
    mem[GAME_MODE] = 0x0a;
  };
  brokenC9af(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the skipped decrement");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, tickEnemyPacingCountdown, TARGET, m);
  assert.equal(r.placeable, true, `tickEnemyPacingCountdown must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
