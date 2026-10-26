// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearWaveStateAndArenaOnHoldExpiry (ROM 0x7421) — "bonus-stage teardown": while the wave-hold
 * timer (WAVE_HOLD_TIMER) is non-zero, tick it down and return; on expiry clear the 9-byte block at
 * TILE_ANIM_PARITY and the 0x48-byte enemy-record region at ENEMY_ACTOR_TABLE to zero, clear
 * PLAY_STATE_INDEX and LATCHED_ENEMY_X, and set ATTRACT_SUBSTATE to 7.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM, so every case uses
 * a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The contract is MEMORY ONLY: a state-dispatch handler whose leftover registers (A/B/HL) the
 * dispatcher does not read. pc/SP/cycles are not compared. The one input is the hold timer, poked
 * per side; the teardown regions are pre-dirtied so every clear is observable.
 *
 * Jobs: 1. EQUAL over hold / expiry; 2. WRITE-SET (clears inside the two ranges + the three named
 * cells); 3. CRAFTED (all sentinels cleared/set); 4. TEETH (a wrong cleared byte + a missed tick).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7421.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7421 as oracle } from "../../translated/loc_7421.js";
import { clearWaveStateAndArenaOnHoldExpiry } from "../clearWaveStateAndArenaOnHoldExpiry.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH, WAVE_HOLD_TIMER, TILE_ANIM_PARITY, ENEMY_ACTOR_TABLE,
  PLAY_STATE_INDEX, LATCHED_ENEMY_X, ATTRACT_SUBSTATE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ATTRACT_AFTER = 0x07;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

const B9_LO = TILE_ANIM_PARITY, B9_HI = TILE_ANIM_PARITY + 0x09;
const EN_LO = ENEMY_ACTOR_TABLE, EN_HI = ENEMY_ACTOR_TABLE + 0x48;
const inCleared = (a) => (a >= B9_LO && a < B9_HI) || (a >= EN_LO && a < EN_HI);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone with the hold timer seated; `dirty` pre-fills the teardown targets with sentinels. */
function craft(hold, dirty) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.mem.write8(WAVE_HOLD_TIMER, hold);
  if (dirty) {
    for (let a = B9_LO; a < B9_HI; a++) m.mem.write8(a, 0xaa);
    for (let a = EN_LO; a < EN_HI; a++) m.mem.write8(a, 0xaa);
    m.mem.write8(PLAY_STATE_INDEX, 0xaa);
    m.mem.write8(LATCHED_ENEMY_X, 0xaa);
    m.mem.write8(ATTRACT_SUBSTATE, 0x11); // != 7 so the set is observable
  }
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: hold / expiry — clearWaveStateAndArenaOnHoldExpiry == oracle in RAM (−stack)", () => {
  for (const [hold, dirty] of [[0x03, true], [0x01, false], [0x00, true], [0x00, false]]) {
    const o = craft(hold, dirty);
    const c = craft(hold, dirty);
    oracle(o);
    clearWaveStateAndArenaOnHoldExpiry(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (hold=${hold} dirty=${dirty}): oracle=${d.a} idiom=${d.b}`);
  }
  console.log("  EQUAL: hold-nonzero and expiry (dirtied + clean) identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: expiry clears the two ranges + the three named cells; hold ticks only the timer", () => {
  // Expiry path (dirtied so every target is observed).
  const before = craft(0x00, true);
  const after = craft(0x00, true);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    if (inCleared(addr) || addr === PLAY_STATE_INDEX || addr === LATCHED_ENEMY_X) {
      assert.equal(a1[off], 0x00, `cell ${hx(addr)} must be cleared to 0`);
    } else if (addr === ATTRACT_SUBSTATE) {
      assert.equal(a1[off], ATTRACT_AFTER, "attract sub-state must be 7");
    } else {
      assert.fail(`unexpected write at ${hx(addr)}`);
    }
  }
  console.log("  WRITE-SET: expiry -> ranges + PLAY_STATE_INDEX/LATCHED_ENEMY_X := 0, ATTRACT_SUBSTATE := 7");
});

// -- 2b. WRITE-SET (hold path) ------------------------------------------------

test("WRITE-SET: hold path ticks only the wave-hold timer", () => {
  const before = craft(0x03, true);
  const after = craft(0x03, true);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) changed.push([addr, a1[off]]);
  }
  assert.equal(changed.length, 1, `hold path writes only the timer, got ${changed.length}`);
  assert.deepEqual(changed[0], [WAVE_HOLD_TIMER, 0x02], "timer 0x03 -> 0x02");
  console.log("  WRITE-SET: hold -> WAVE_HOLD_TIMER 0x03 -> 0x02 only");
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: on expiry all sentinels are cleared/set identically", () => {
  const o = craft(0x00, true);
  const c = craft(0x00, true);
  oracle(o);
  clearWaveStateAndArenaOnHoldExpiry(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  for (let a = B9_LO; a < B9_HI; a++) assert.equal(c.mem.read8(a), 0x00, `9-byte block not cleared at ${hx(a)}`);
  for (let a = EN_LO; a < EN_HI; a++) assert.equal(c.mem.read8(a), 0x00, `enemy region not cleared at ${hx(a)}`);
  assert.equal(c.mem.read8(PLAY_STATE_INDEX), 0x00, "play sub-state cleared");
  assert.equal(c.mem.read8(LATCHED_ENEMY_X), 0x00, "latched enemy X cleared");
  assert.equal(c.mem.read8(ATTRACT_SUBSTATE), ATTRACT_AFTER, "attract sub-state set to 7");
  console.log("  CRAFTED: 9-byte block + 0x48 region cleared, two cells zeroed, attract sub-state = 7");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong cleared byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00, true);
  const c = craft(0x00, true);
  oracle(o);
  clearWaveStateAndArenaOnHoldExpiry(c);
  const bug = EN_LO + 0x10;
  c.mem.write8(bug, 0x55); // BUG: this enemy-region cell must be cleared to 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cleared byte — it is worthless");
  assert.equal(d.addr, bug, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(bug)})`);
  console.log(`  TEETH/RAM: wrong cleared byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a missed timer tick is CAUGHT on the hold path", () => {
  const o = craft(0x03, false);
  const c = craft(0x03, false);
  oracle(o);
  clearWaveStateAndArenaOnHoldExpiry(c);
  c.mem.write8(WAVE_HOLD_TIMER, 0x03); // BUG: timer should have decremented to 0x02

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missed timer tick — it is worthless");
  assert.equal(d.addr, WAVE_HOLD_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/timer: missed tick caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
