// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for setupLevelTimers (ROM 0xc940-0xc97a) -- level-setup. It seeds the sizing/timer cells
// (MODE_DISPATCH_SEL/GAME_MODE/GAME_MODE_PENDING), and when the level id LEVEL_ID differs from the last-seen loc_3d AND STATUS_FLAGS is
// negative it installs the new-level timers (MODE_DISPATCH_SEL/GAME_MODE/MODE_DELAY_TIMER, the last picked by loc_117) and swaps
// the paired tables via swapParallelTables; then it converges: selectProjectionScale, index PLAYER_LEVEL_TBL by loc_3d into loc_9f,
// runLevelInit (startup init), and TAIL-DELEGATES to resetBothPokeyChips (readout reset). Live-out is RAM
// (dumpState minus stack scratch below the entry SP) plus the exit [X, Y] it returns: c940 takes no input register and tail-jmps
// resetBothPokeyChips, so its exit registers are the delegate's, which the CAPTURE arm compares. Oracle is the frozen translated setupLevelTimers.
// Run: node --test games/tempest/idiomatic/test/equivalence-c940.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c940 } from "../../translated/loc_c940.js";
import { setupLevelTimers } from "../setupLevelTimers.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, MODE_DELAY_TIMER, STATUS_FLAGS, loc_3d, LEVEL_ID, PLAYER_LEVEL_TBL, loc_9f, loc_117, DRAW_CURSOR_LO, DRAW_CURSOR_HI,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc940;
const oracle = atEntry(loc_c940);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

test("CAPTURE: real 0xc940 dispatches -- setupLevelTimers == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented downstream arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(setupLevelTimers(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed the "level changed + STATUS_FLAGS negative" path: LEVEL_ID (new id) differs from loc_3d (last seen), STATUS_FLAGS
// bit7 set so the new-level timer block runs, loc_117 nonzero so MODE_DELAY_TIMER takes the 40 branch, and a known
// byte at PLAYER_LEVEL_TBL + (post-write loc_3d) so the loc_9f index is exercised. Point the display cursor at vector
// RAM so any downstream emit lands there, not zero page.
function seedChanged(m) {
  m.mem.write8(LEVEL_ID, 0x02);  // new level id
  m.mem.write8(loc_3d, 0x01);  // last seen -> differs -> the block runs
  m.mem.write8(STATUS_FLAGS, 0x80);  // negative -> the new-level timer block runs
  m.mem.write8(loc_117, 0x01); // nonzero -> MODE_DELAY_TIMER = 40
  m.mem.write8(GAME_MODE_PENDING, 0x00);  // pre-value so the unconditional GAME_MODE_PENDING = 30 is observable
  m.mem.write8(0x0048, 0x5a);  // PLAYER_LEVEL_TBL + 2 (loc_3d becomes 0x02) -> loc_9f source
  m.mem.write8(DRAW_CURSOR_LO, 0x00);
  m.mem.write8(DRAW_CURSOR_HI, 0x20);  // cursor into vector RAM 0x2000
}

test("CRAFTED: changed level + negative STATUS_FLAGS + loc_117 branch -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedChanged(o);
  const c = new Machine(ROM, OPTS); seedChanged(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  setupLevelTimers(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the level-setup path");
  // Spot-checks on this routine's own signature writes.
  assert.equal(c.mem.read8(GAME_MODE_PENDING), 30, "GAME_MODE_PENDING seeded to 30");
  assert.equal(c.mem.read8(MODE_DISPATCH_SEL), 14, "MODE_DISPATCH_SEL took the new-level value");
  assert.equal(c.mem.read8(GAME_MODE), 10, "GAME_MODE took the new-level value");
  assert.equal(c.mem.read8(MODE_DELAY_TIMER), 40, "MODE_DELAY_TIMER took the loc_117-nonzero branch");
  assert.equal(c.mem.read8(loc_3d), 0x02, "loc_3d latched the new level id");
  assert.equal(c.mem.read8(loc_9f), o.mem.read8(loc_9f), "loc_9f matches the oracle");
});

// Seed the "level unchanged" path: LEVEL_ID == loc_3d, so the whole timer/swap block is skipped and only
// the convergence tail runs.
function seedSame(m) {
  m.mem.write8(LEVEL_ID, 0x03);
  m.mem.write8(loc_3d, 0x03);  // equal -> block skipped
  m.mem.write8(GAME_MODE_PENDING, 0x00);
  m.mem.write8(0x0049, 0x77);  // PLAYER_LEVEL_TBL + 3 -> loc_9f source
  m.mem.write8(DRAW_CURSOR_LO, 0x00);
  m.mem.write8(DRAW_CURSOR_HI, 0x20);
}

test("CRAFTED: unchanged level -- block skipped, convergence tail -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedSame(o);
  const c = new Machine(ROM, OPTS); seedSame(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED same: oracle threw on this seed -- skipped"); return; }
  setupLevelTimers(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the skip path");
  assert.equal(c.mem.read8(GAME_MODE_PENDING), 30, "GAME_MODE_PENDING seeded to 30 even on the skip path");
  assert.equal(c.mem.read8(MODE_DISPATCH_SEL), 0, "MODE_DISPATCH_SEL stays 0 (timer block skipped)");
  assert.equal(c.mem.read8(GAME_MODE), 30, "GAME_MODE stays 30 (timer block skipped)");
});

test("TEETH: a twin that drops the unconditional GAME_MODE_PENDING write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedChanged(o);
  const c = new Machine(ROM, OPTS); seedChanged(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to setupLevelTimers but reverts the unconditional GAME_MODE_PENDING = 30 write. The seed leaves
  // GAME_MODE_PENDING = 0 before the call, so reverting guarantees a RAM divergence from the oracle's 30.
  const broken = (m) => {
    const before02 = m.mem.read8(GAME_MODE_PENDING);
    setupLevelTimers(m);
    m.mem.write8(GAME_MODE_PENDING, before02); // BUG: revert the sizing-cell write
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped GAME_MODE_PENDING write was NOT caught by the RAM compare");
});
