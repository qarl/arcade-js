// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for promoteEnemyRecordsOnCountdownFire (ROM 0x6b3b, Pooyan) — "deferred-object promoter". Bails
 * unless the game-idle gate (0x8806), the busy latch (0x8d5f) and the round counter's low bit
 * (0x8907) are all clear. Then a countdown (0x8d5e): 0 idles, >1 decrements and returns, ==1 fires.
 * Firing arms the state (0x880a = 0x8d5f = 0x11, 0x8d5e = 0xff), scans the eleven enemy records
 * (0x8ae0, stride 0x18) and — for each whose (rec+4)&0x1f is in [0x06,0x1a) — copies the record
 * pointer + (rec+6) into the promoted list (0x8d80, three bytes/entry) and clears (rec+6). It then
 * queues five display commands and tails into the sprite-list rebuild.
 *
 * Cycle-free memory-equivalence gate (docs/decompiler-pipeline). Each case runs the oracle on one
 * FRESH clone and the module on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The routine takes no input register and produces no consumed register live-out: the fire path
 * tails into the memory-only sprite-list rebuild, and the sole caller ignores the gate byte the
 * early exits leave in A. So the contract is pure RAM. The guard cells, countdown, and enemy table
 * are poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — the four guard exits and the countdown-decrement path: module == oracle in RAM (−stack).
 *   2. FIRE — the countdown-fires path: module == oracle in RAM, and the promoted list / state cells /
 *      cleared record fields hold the expected contract.
 *   3. WRITE-SET — the countdown-decrement path writes exactly {the countdown cell}.
 *   4. TEETH — a corrupted promoted-list byte, and a wrong decremented countdown, are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6b3b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6b3b as oracle } from "../../translated/loc_6b3b.js";
import { promoteEnemyRecordsOnCountdownFire } from "../promoteEnemyRecordsOnCountdownFire.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  ROUND_COUNTER,
  PLAY_STATE_INDEX,
  ENEMY_ACTOR_TABLE,
  PENDING_OBJECT_STATE,
  PENDING_OBJECT_COUNTDOWN,
  PROMOTED_OBJECT_LIST,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD_STRIDE = 0x18;
const ENEMY_BLOCK_COUNT = 0x0b;
const REC_TYPE = 0x04;
const REC_SAVED = 0x06;
const FIRE_STATE = 0x11;
const COUNTDOWN_RELOAD = 0xff;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x9000);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the guard cells, countdown, and (optionally) the enemy table seated. */
function craft({ active = 0, busy = 0, round = 0, countdown = 1, enemies = null }) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PENDING_OBJECT_STATE, busy);
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(PENDING_OBJECT_COUNTDOWN, countdown);
  if (enemies) {
    for (let i = 0; i < ENEMY_BLOCK_COUNT; i++) {
      const rec = (ENEMY_ACTOR_TABLE + i * RECORD_STRIDE) & 0xffff;
      m.mem.write8(rec + REC_TYPE, enemies[i]?.type ?? 0x00);
      m.mem.write8(rec + REC_SAVED, enemies[i]?.saved ?? 0x00);
    }
    for (let k = 0; k < 0x10; k++) m.mem.write8(PROMOTED_OBJECT_LIST + k, 0xee); // dirty so list writes show
  }
  m.regs.sp = 0x9000; // real stack top: the fire tail nests the sprite-list rebuild
  return m;
}

// Guard + decrement cases (no enemy table needed).
const CASES = [
  { name: "game active -> bail", opts: { active: 0x01 } },
  { name: "busy latch set -> bail", opts: { busy: 0x11 } },
  { name: "round bit0 set -> bail", opts: { round: 0x01 } },
  { name: "countdown idle -> bail", opts: { countdown: 0x00 } },
  { name: "countdown > 1 -> decrement", opts: { countdown: 0x05 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: guard exits + countdown-decrement — promoteEnemyRecordsOnCountdownFire == oracle in RAM (−stack)", () => {
  for (const { name, opts } of CASES) {
    const o = craft(opts);
    const c = craft(opts);
    oracle(o);
    promoteEnemyRecordsOnCountdownFire(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} guard/decrement cases identical (RAM −stack)`);
});

// -- 2. FIRE ------------------------------------------------------------------

test("FIRE: countdown==1 fires — promoteEnemyRecordsOnCountdownFire == oracle, and the promoted contract holds", () => {
  const enemies = [];
  enemies[0] = { type: 0x06, saved: 0x33 }; // low boundary of the range -> promoted
  enemies[2] = { type: 0x19, saved: 0x44 }; // top of the range -> promoted
  enemies[3] = { type: 0x1a }; //                exclusive high bound -> skipped
  enemies[4] = { type: 0x25, saved: 0x55 }; //   (0x25 & 0x1f) = 0x05 < 0x06 -> skipped

  const o = craft({ countdown: 0x01, enemies });
  const c = craft({ countdown: 0x01, enemies });
  oracle(o);
  promoteEnemyRecordsOnCountdownFire(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `FIRE: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

  // The armed state cells.
  assert.equal(c.mem.read8(PLAY_STATE_INDEX), FIRE_STATE, "play-state armed");
  assert.equal(c.mem.read8(PENDING_OBJECT_STATE), FIRE_STATE, "busy latch armed");
  assert.equal(c.mem.read8(PENDING_OBJECT_COUNTDOWN), COUNTDOWN_RELOAD, "countdown reseeded");

  // The two promoted records, three bytes per entry (pointer little-endian + saved field).
  const rec0 = ENEMY_ACTOR_TABLE; // 0x8ae0
  const rec2 = ENEMY_ACTOR_TABLE + 2 * RECORD_STRIDE; // 0x8b10
  assert.equal(c.mem.read8(PROMOTED_OBJECT_LIST + 0), rec0 & 0xff, "entry0 ptr low");
  assert.equal(c.mem.read8(PROMOTED_OBJECT_LIST + 1), rec0 >> 8, "entry0 ptr high");
  assert.equal(c.mem.read8(PROMOTED_OBJECT_LIST + 2), 0x33, "entry0 saved field");
  assert.equal(c.mem.read8(PROMOTED_OBJECT_LIST + 3), rec2 & 0xff, "entry1 ptr low");
  assert.equal(c.mem.read8(PROMOTED_OBJECT_LIST + 4), rec2 >> 8, "entry1 ptr high");
  assert.equal(c.mem.read8(PROMOTED_OBJECT_LIST + 5), 0x44, "entry1 saved field");
  // Only two entries: the sixth byte stays the dirtied sentinel (the skipped records added nothing).
  assert.equal(c.mem.read8(PROMOTED_OBJECT_LIST + 6), 0xee, "no third entry");

  // The promoted records had (rec+6) cleared; a skipped one keeps its value.
  assert.equal(c.mem.read8(rec0 + REC_SAVED), 0x00, "promoted record field cleared");
  assert.equal(c.mem.read8(rec2 + REC_SAVED), 0x00, "promoted record field cleared");
  assert.equal(c.mem.read8((ENEMY_ACTOR_TABLE + 4 * RECORD_STRIDE) + REC_SAVED), 0x55, "skipped record untouched");
  console.log("  FIRE: two records promoted; state armed; RAM identical to oracle");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: countdown-decrement writes exactly {the countdown cell}", () => {
  const m = craft({ countdown: 0x05 });
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    changed.push({ addr, to: a1[off] });
  }
  assert.equal(changed.length, 1, `expected 1 write, got ${changed.length}`);
  assert.equal(changed[0].addr, PENDING_OBJECT_COUNTDOWN, `expected the countdown cell, got ${hx(changed[0].addr)}`);
  assert.equal(changed[0].to, 0x04, "countdown decremented 5 -> 4");
  console.log("  WRITE-SET: decrement -> countdown cell only (5 -> 4)");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted promoted-list byte is CAUGHT by the RAM diff", () => {
  const enemies = [{ type: 0x06, saved: 0x33 }];
  const o = craft({ countdown: 0x01, enemies });
  const c = craft({ countdown: 0x01, enemies });
  oracle(o);
  promoteEnemyRecordsOnCountdownFire(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  const cell = PROMOTED_OBJECT_LIST + 2; // the saved-field byte of the first promoted entry
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt a promoted-list byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong promoted byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(list): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong decremented countdown is CAUGHT by the RAM diff", () => {
  const o = craft({ countdown: 0x05 });
  const c = craft({ countdown: 0x05 });
  oracle(o);
  promoteEnemyRecordsOnCountdownFire(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(PENDING_OBJECT_COUNTDOWN, 0x03); // BUG: should be 4 (5 - 1), not 3
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong countdown — it is worthless");
  assert.equal(d.addr, PENDING_OBJECT_COUNTDOWN, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(countdown): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
