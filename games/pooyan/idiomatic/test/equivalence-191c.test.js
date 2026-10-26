// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for pickEnemyGroupSpeedAndClearAim (ROM 0x191c, Pooyan) — "choose the enemy
 * speed/column value for a new target group". It runs only while STAGE_COUNTDOWN (0x8901)
 * and LEAD_ACTOR_STATE (0x8a82) are both zero, and aborts if any of the six enemy records
 * (0x8ae2, stride 0x18) already holds state 3. Otherwise it bumps PLAY_STATE_INDEX
 * (0x880a), builds a value from DIFFICULTY_DSW (0x8820) plus ROUND_COUNTER (0x8907) — the
 * round halved plus WAVE_ARRIVAL_COUNTER (0x8903) when round bit0 is clear — clamps it
 * below 0x20 to 0x1f, stores it to SPEED_INDEX (0x8900), and clears 0x8a87/0x8905/0x8906.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP). The routine reads no incoming register and no caller reads one
 * back, so it is memory-only — no register is compared.
 *
 * Jobs:
 *   1. EQUAL (crafted) — both early-return gates, the abort scan, the round-odd and
 *      round-even value paths, and the clamp: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the full path writes exactly {0x880a, 0x8900, 0x8a87, 0x8905, 0x8906}.
 *   3. TEETH — a twin that skips clearing 0x8906, and a twin that clamps to the wrong
 *      value, are both CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-191c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_191c as oracle } from "../../translated/loc_191c.js";
import { pickEnemyGroupSpeedAndClearAim } from "../pickEnemyGroupSpeedAndClearAim.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const STAGE = 0x8901;
const LEAD = 0x8a82;
const ENEMY = 0x8ae0;
const PLAY_STATE = 0x880a;
const ROUND = 0x8907;
const DIFF = 0x8820;
const WAVE = 0x8903;
const SPEED = 0x8900;
const AIM = 0x8a87;
const CELL_8905 = 0x8905;
const CELL_8906 = 0x8906;
const STRIDE = 0x18;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with all inputs seated identically and the output cells pre-dirtied. */
function craft({ stage = 0, lead = 0, round = 0, base = 0, wave = 0, busySlot = -1, playState = 0x30 }) {
  const m = BASE.clone();
  m.mem.write8(STAGE, stage);
  m.mem.write8(LEAD, lead);
  for (let i = 0; i < 6; i++) m.mem.write8((ENEMY + 0x02 + i * STRIDE) & 0xffff, i === busySlot ? 0x03 : 0x00);
  m.mem.write8(ROUND, round);
  m.mem.write8(DIFF, base);
  m.mem.write8(WAVE, wave);
  m.mem.write8(PLAY_STATE, playState);
  // pre-dirty the output cells so every commit/clear is an observable change
  m.mem.write8(SPEED, 0xee);
  m.mem.write8(AIM, 0x77);
  m.mem.write8(CELL_8905, 0x77);
  m.mem.write8(CELL_8906, 0x77);
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { name: "early: stage nonzero", opts: { stage: 1 } },
  { name: "early: lead nonzero", opts: { lead: 1 } },
  { name: "abort: slot 2 busy", opts: { busySlot: 2 } },
  { name: "round odd (base+round)", opts: { round: 0x03, base: 0x02 } },
  { name: "round even (base+round/2+wave)", opts: { round: 0x04, base: 0x02, wave: 0x06 } },
  { name: "clamp to 0x1f", opts: { round: 0x21, base: 0x10 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/value cases — pickEnemyGroupSpeedAndClearAim == oracle in RAM (−stack)", () => {
  for (const { name, opts } of CASES) {
    const o = craft(opts);
    const c = craft(opts);
    oracle(o);
    pickEnemyGroupSpeedAndClearAim(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full path writes exactly {0x880a, 0x8900, 0x8a87, 0x8905, 0x8906}", () => {
  const m = craft({ round: 0x04, base: 0x02, wave: 0x06 });
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  const set = new Set(changed);
  assert.equal(changed.length, 5, `expected 5 writes, got ${changed.length}: ${changed.map(hx)}`);
  for (const cell of [PLAY_STATE, SPEED, AIM, CELL_8905, CELL_8906]) {
    assert.ok(set.has(cell), `missing a write at ${hx(cell)}`);
  }
  assert.equal(m.mem.read8(SPEED), 0x0a, "round-even value should be 0x0a");
  console.log("  WRITE-SET: 5 cells written (0x8900 = 0x0a)");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: full behaviour but forgets to clear 0x8906. */
function brokenNoClear(m) {
  if (m.mem.read8(STAGE) !== 0) return;
  if (m.mem.read8(LEAD) !== 0) return;
  for (let i = 0; i < 6; i++) if (m.mem.read8((ENEMY + 0x02 + i * STRIDE) & 0xffff) === 0x03) return;
  m.mem.write8(PLAY_STATE, (m.mem.read8(PLAY_STATE) + 1) & 0xff);
  const round = m.mem.read8(ROUND);
  const base = m.mem.read8(DIFF);
  let v = round & 1 ? (base + round) & 0xff : (base + (round >> 1) + m.mem.read8(WAVE)) & 0xff;
  if (v >= 0x20) v = 0x1f;
  m.mem.write8(SPEED, v);
  m.mem.write8(AIM, 0);
  m.mem.write8(CELL_8905, 0);
  // BUG: 0x8906 left dirty
}

/** Broken twin: clamps to 0x20 instead of 0x1f. */
function brokenClamp(m) {
  if (m.mem.read8(STAGE) !== 0 || m.mem.read8(LEAD) !== 0) return;
  for (let i = 0; i < 6; i++) if (m.mem.read8((ENEMY + 0x02 + i * STRIDE) & 0xffff) === 0x03) return;
  m.mem.write8(PLAY_STATE, (m.mem.read8(PLAY_STATE) + 1) & 0xff);
  const round = m.mem.read8(ROUND);
  const base = m.mem.read8(DIFF);
  let v = round & 1 ? (base + round) & 0xff : (base + (round >> 1) + m.mem.read8(WAVE)) & 0xff;
  if (v >= 0x20) v = 0x20; // BUG: should clamp to 0x1f
  m.mem.write8(SPEED, v);
  m.mem.write8(AIM, 0);
  m.mem.write8(CELL_8905, 0);
  m.mem.write8(CELL_8906, 0);
}

test("TEETH: a twin that skips clearing 0x8906 is CAUGHT by the RAM diff", () => {
  const o = craft({ round: 0x04, base: 0x02, wave: 0x06 });
  const c = craft({ round: 0x04, base: 0x02, wave: 0x06 });
  oracle(o);
  brokenNoClear(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an uncleared 0x8906 — it is worthless");
  assert.equal(d.addr, CELL_8906, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(clear): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin that clamps to the wrong value is CAUGHT by the RAM diff", () => {
  const o = craft({ round: 0x21, base: 0x10 });
  const c = craft({ round: 0x21, base: 0x10 });
  oracle(o);
  brokenClamp(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong clamp — it is worthless");
  assert.equal(d.addr, SPEED, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(clamp): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
