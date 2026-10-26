// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for retireEnemyOnFrameTimerExpiry (Pooyan) — per-frame object tick with a frame-timer countdown.
 *
 * Steps the object's animation sequence (record based at IX), then decrements the +0x11 frame timer.
 * While the timer is still running (result != 0) it returns after the animation step only. Once it
 * elapses (result == 0) it hands the record to the sprite-band blanker, which zeros the 0x17-byte band
 * at IX and leaves HL = the advanced pointer past the run and B = 0.
 *
 * The record is seated at ACTOR_TABLE with +0x0e (the animation frame-hold) non-zero, so the animation
 * step just decrements that hold — deterministic, no stream walk. Compared on RAM (dumpState) minus
 * stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the oracle's push/ret traffic falls out of the diff.
 *
 * Jobs: 1. EQUAL across the running / elapsed branches; 2. WRITE-SET (hold decremented; timer
 * decremented; band zeroed on expiry) + live-out (HL/B on the tail); 3. TEETH (a corrupted timer byte
 * is caught; the two branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-154d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_154d as oracle } from "../../translated/loc_154d.js";
import { retireEnemyOnFrameTimerExpiry } from "../retireEnemyOnFrameTimerExpiry.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ACTOR_TABLE; // record base seated at IX (RAM, clear of STACK_SCRATCH)
const HOLD = 0x0e; //       animation frame-hold counter
const FRAME_TIMER = 0x11; // per-frame down-counter
const BAND_LEN = 0x17; //   bytes zeroed by the band blanker
const SP0 = 0x8ff0; //      inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record: a non-zero animation hold and a chosen frame timer, band pre-dirtied. */
function seat({ hold = 0x05, timer = 0x03 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  for (let i = 0; i < BAND_LEN; i++) m.mem.write8(REC + i, 0x5a + i); // pre-dirty the band
  m.mem.write8(REC + HOLD, hold);
  m.mem.write8(REC + FRAME_TIMER, timer);
  return m;
}

const CASES = [
  { name: "timer running -> return after animation step", cfg: { hold: 0x05, timer: 0x03 } },
  { name: "timer elapsed -> blank the sprite band", cfg: { hold: 0x05, timer: 0x01 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: retireEnemyOnFrameTimerExpiry == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    retireEnemyOnFrameTimerExpiry(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET + live-out --------------------------------------------------

test("WRITE-SET: hold--/timer--; band zeroed on expiry; HL/B live-out on the tail", () => {
  // running branch: hold decremented, timer decremented, band otherwise intact
  const run = seat({ hold: 0x05, timer: 0x03 });
  oracle(run);
  assert.equal(run.mem.read8(REC + HOLD), 0x04, "animation hold decremented");
  assert.equal(run.mem.read8(REC + FRAME_TIMER), 0x02, "frame timer decremented, still running");
  assert.equal(run.mem.read8(REC + 0x05), 0x5a + 0x05, "band untouched while timer runs");

  // elapsed branch: whole band zeroed; HL/B set by the tail blanker
  const exp = seat({ hold: 0x05, timer: 0x01 });
  oracle(exp);
  let allZero = true;
  for (let i = 0; i < BAND_LEN; i++) if (exp.mem.read8(REC + i) !== 0) allZero = false;
  assert.equal(allZero, true, "sprite band zeroed on timer expiry");
  assert.equal(exp.regs.hl, (REC + BAND_LEN) & 0xffff, "HL = pointer advanced past the band");
  assert.equal(exp.regs.b, 0, "B = drained fill counter");

  // live-out matches the module on the tail branch
  const mod = seat({ hold: 0x05, timer: 0x01 });
  retireEnemyOnFrameTimerExpiry(mod);
  assert.equal(mod.regs.hl, exp.regs.hl, "HL live-out matches oracle");
  assert.equal(mod.regs.b, exp.regs.b, "B live-out matches oracle");
  console.log("  WRITE-SET: hold--/timer--; band=0 on expiry; HL/B tail live-out equal");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted timer byte is CAUGHT; branches are load-bearing", () => {
  const o = seat({ hold: 0x05, timer: 0x03 });
  const c = seat({ hold: 0x05, timer: 0x03 });
  oracle(o);
  retireEnemyOnFrameTimerExpiry(c);
  c.mem.write8(REC + FRAME_TIMER, (o.mem.read8(REC + FRAME_TIMER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted timer byte");
  assert.equal(d.addr, REC + FRAME_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // running vs elapsed must differ, or the countdown guard is dead
  const run = seat({ hold: 0x05, timer: 0x03 });
  const done = seat({ hold: 0x05, timer: 0x01 });
  oracle(run);
  oracle(done);
  assert.notEqual(ramDiffMinusStack(run, done), null, "running and elapsed branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; countdown branch load-bearing`);
});
