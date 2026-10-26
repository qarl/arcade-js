// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for despawnActorAndRenderStageCountdown (ROM 0x34b0, Pooyan) — the shared enemy-despawn tail. It
 * blanks the actor sprite band at IX, decrements the active-enemy count and (while still above
 * zero) the stage countdown, bumps the spawn-phase counter when the play sub-state is the fourth,
 * then repaints the stage countdown as two HUD digits (units, and tens one tilemap row over,
 * leading zero suppressed; a value >= 10 converts to packed BCD first and draws nothing while the
 * play-mode latch is held).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles are NOT compared, and there is NO register/flag live-out — this is
 * a jumped-into tail that ends by rendering; its whole result is in memory. The oracle's
 * call/push/ret for the band-blank all land inside STACK_SCRATCH.
 *
 * Jobs:
 *   1. EQUAL (crafted) — single-digit, packed-BCD, latch-gated, and play-state-4 (spawn bump)
 *      countdown cases: oracle == despawnActorAndRenderStageCountdown in RAM (−stack).
 *   2. WRITE-SET — the full-footprint case (two-digit render + spawn bump) writes exactly the band,
 *      the three counters, and the two HUD tiles.
 *   3. TEETH — a wrong HUD units tile and a wrong stage-countdown byte are each caught by the RAM
 *      diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-34b0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_34b0 as oracle } from "../../translated/loc_34b0.js";
import { despawnActorAndRenderStageCountdown } from "../despawnActorAndRenderStageCountdown.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ACTIVE_ENEMY_COUNT,
  STAGE_COUNTDOWN,
  PLAY_STATE_INDEX,
  PLAY_MODE_LATCH,
  SPAWN_PHASE_COUNTER,
  HUD_STAGE_DIGIT_LO,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX_BASE = 0x8b00; // a work-RAM record base for the sprite band, clear of the seeded cells + stack
const BAND_LEN = 0x17; //  bytes blankActorSpriteBand blanks from IX
const HUD_UNITS = HUD_STAGE_DIGIT_LO; //             units digit tile
const HUD_TENS = (HUD_STAGE_DIGIT_LO + 0x20) & 0xffff; // tens digit tile, one row over
const DIRT = 0xaa; //      sentinel pre-loaded so every real write is observable

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: band pre-dirtied, the countdown/state cells + counters seated, HUD tiles dirtied. */
function craft(stage, playState, playMode) {
  const m = BASE.clone();
  for (let off = 0; off < BAND_LEN; off++) m.mem.write8(IX_BASE + off, DIRT);
  m.mem.write8(STAGE_COUNTDOWN, stage & 0xff);
  m.mem.write8(PLAY_STATE_INDEX, playState & 0xff);
  m.mem.write8(PLAY_MODE_LATCH, playMode & 0xff);
  m.mem.write8(ACTIVE_ENEMY_COUNT, 0x05);
  m.mem.write8(SPAWN_PHASE_COUNTER, 0x02);
  m.mem.write8(HUD_UNITS, DIRT);
  m.mem.write8(HUD_TENS, DIRT);
  m.regs.ix = IX_BASE;
  m.regs.sp = 0x8fe0; // deep in STACK_SCRATCH: the band-blank call/push/ret stay inside
  return m;
}

// [stage, playState, playMode, label]
const CASES = [
  [0x00, 0x00, 0x00, "single digit 0 (no dec, no tens)"],
  [0x05, 0x00, 0x00, "single digit (dec to 4)"],
  [0x10, 0x00, 0x00, "packed-BCD two digits (dec to 0x0f -> 15)"],
  [0x10, 0x00, 0x01, "BCD path gated off by the play-mode latch (draws nothing)"],
  [0x64, 0x04, 0x00, "packed-BCD 99 + play-state-4 spawn bump"],
  [0x0b, 0x04, 0x00, "packed-BCD 10 (dec to 0x0a) + spawn bump"],
  [0x01, 0x03, 0x00, "dec to 0, single digit 0"],
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted countdown/state cases — despawnActorAndRenderStageCountdown == oracle in RAM (−stack)", () => {
  for (const [stage, playState, playMode, label] of CASES) {
    const o = craft(stage, playState, playMode);
    const c = craft(stage, playState, playMode);
    oracle(o);
    despawnActorAndRenderStageCountdown(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full-footprint case writes the band, the 3 counters, and the 2 HUD tiles", () => {
  const [stage, playState, playMode] = CASES[4]; // 0x64 / play-state 4: two digits + spawn bump
  const expected = new Set([ACTIVE_ENEMY_COUNT, STAGE_COUNTDOWN, SPAWN_PHASE_COUNTER, HUD_UNITS, HUD_TENS]);
  for (let off = 0; off < BAND_LEN; off++) expected.add(IX_BASE + off);

  const m = craft(stage, playState, playMode);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  assert.deepEqual(
    [...new Set(changed)].sort((x, y) => x - y),
    [...expected].sort((x, y) => x - y),
    `unexpected write footprint: ${[...new Set(changed)].map(hx).join(",")}`,
  );
  assert.equal(m.mem.read8(HUD_UNITS), 0x09, "units digit of BCD 99");
  assert.equal(m.mem.read8(HUD_TENS), 0x09, "tens digit of BCD 99");
  console.log(`  WRITE-SET: band(${BAND_LEN}) + 3 counters + 2 HUD tiles`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong HUD units tile is CAUGHT by the RAM diff", () => {
  const [stage, playState, playMode] = CASES[2]; // two-digit render writes the units tile
  const o = craft(stage, playState, playMode);
  const c = craft(stage, playState, playMode);
  oracle(o);
  despawnActorAndRenderStageCountdown(c);
  c.mem.write8(HUD_UNITS, (c.mem.read8(HUD_UNITS) ^ 0x01) & 0xff); // BUG: corrupt the units digit
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong units tile — it is worthless");
  assert.equal(d.addr, HUD_UNITS, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/HUD: wrong units tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong stage-countdown byte is CAUGHT by the RAM diff", () => {
  const [stage, playState, playMode] = CASES[1]; // dec path
  const o = craft(stage, playState, playMode);
  const c = craft(stage, playState, playMode);
  oracle(o);
  despawnActorAndRenderStageCountdown(c);
  c.mem.write8(STAGE_COUNTDOWN, 0xee); // BUG: the countdown must be the decremented value
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stage-countdown byte — it is worthless");
  assert.equal(d.addr, STAGE_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/countdown: wrong stage byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
