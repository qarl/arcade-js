// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for launchFormationObjectIntoFreeSlot (ROM 0x2be5) — "try to launch one formation slot".
 *
 * launchFormationObjectIntoFreeSlot is a DISSOLVED CALLER-SKIP for scanFormationSlotsAndLaunchFree. In the oracle it ends one path with
 * `pop af; ret` (aborting scanFormationSlotsAndLaunchFree's scan) and another with a plain `ret c` (busy slot). The
 * idiomatic module drops the stack plumbing and returns a BOOLEAN in its place:
 *   true  = normal return (slot busy -> keep scanning),
 *   false = the caller-skip (slot launched -> abort the scan).
 * The translated oracle ALSO returns that boolean, so the two are compared directly.
 *
 * Cycle-free / memory-equivalence gate: the routine WRITES RAM, so every case uses a FRESH
 * clone per side, compared on RAM (dumpState, minus stack scratch below the entry SP) plus the boolean return.
 * pc/SP/cycles are NOT compared (the oracle drives them through m.step/m.push/m.pop/m.ret).
 * launchFormationObjectIntoFreeSlot has NO register live-out: scanFormationSlotsAndLaunchFree protects its loop counter and stride across the
 * call (exx) and reads back only its own record pointer, which launchFormationObjectIntoFreeSlot never modifies.
 *
 * The record pointer is the only input register (IX); the free path also consumes the wave
 * counter (0x8903) and reseeds the spawn countdown (0x8d30). Records live in work RAM, so a
 * case pokes the record bytes plus those two cells identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — busy slot (true, no writes) and free slot over several wave values (false, full
 *      seed) agree in RAM (−stack) and in the boolean, incl. the parity flag and the clamped
 *      countdown.
 *   2. WRITE-SET — the free path's exact write footprint (record fields + anim + 0x8903/0x8d30).
 *   3. TEETH — a twin with a WRONG seeded byte is caught by the RAM diff, and a twin returning
 *      the WRONG boolean is caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2be5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2be5 as oracle } from "../../translated/loc_2be5.js";
import { launchFormationObjectIntoFreeSlot } from "../launchFormationObjectIntoFreeSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, WAVE_ARRIVAL_COUNTER, FORMATION_SPAWN_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c60; // a formation record base in work RAM
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with IX = record base, the record's activity word seated, plus the two cells. */
function craft({ rec = REC, act0 = 0x00, act1 = 0x00, wave = 0x05, timer = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.ix = rec;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH — the oracle's push/pop stay in the dead region
  m.mem.write8(rec + 0x00, act0);
  m.mem.write8(rec + 0x01, act1);
  m.mem.write8(WAVE_ARRIVAL_COUNTER, wave);
  m.mem.write8(FORMATION_SPAWN_TIMER, timer);
  return m;
}

// Free-path wave values chosen to cover parity 0/1 and both sides of the clamp (wave-1 vs 0x0a).
const FREE_WAVES = [0x05, 0x01, 0x08, 0x0f, 0x00];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: busy slot — no writes, returns true (keep scanning)", () => {
  for (const [act0, act1] of [[0x01, 0x00], [0x00, 0x01], [0x03, 0x00], [0x00, 0xff]]) {
    const o = craft({ act0, act1 });
    const c = craft({ act0, act1 });
    const oret = oracle(o);
    const cret = launchFormationObjectIntoFreeSlot(c);
    assert.equal(oret, true, `oracle should report busy=true for act=${hx(act0)}|${hx(act1)}`);
    assert.equal(cret, oret, `boolean mismatch for busy act=${hx(act0)}|${hx(act1)}`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (busy)`);
  }
  console.log("  EQUAL/busy: 4 activity words -> true, no writes");
});

test("EQUAL: free slot — full seed, returns false (abort scan)", () => {
  for (const wave of FREE_WAVES) {
    const o = craft({ wave });
    const c = craft({ wave });
    const oret = oracle(o);
    const cret = launchFormationObjectIntoFreeSlot(c);
    assert.equal(oret, false, `oracle should report launched=false for wave=${hx(wave)}`);
    assert.equal(cret, oret, `boolean mismatch for free wave=${hx(wave)}`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (wave=${hx(wave)})`);
  }
  console.log(`  EQUAL/free: ${FREE_WAVES.length} wave values -> false, RAM identical`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the free path writes the record fields + anim + wave/spawn cells", () => {
  const wave = 0x08;
  const before = craft({ wave });
  const after = craft({ wave });
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.set(after.stateOffsetToAddr(off), { from: b0[off], to: a1[off] });
  }
  // record activity/state/coord/kind/parity/timer, the 3 anim bytes, and the two shared cells
  const expect = {
    [REC + 0x00]: 0x01, [REC + 0x02]: 0x11, [REC + 0x03]: 0x00, [REC + 0x04]: 0x1c,
    [REC + 0x05]: 0x00, [REC + 0x06]: 0x03, [REC + 0x07]: (wave - 1) & 0x01,
    [REC + 0x09]: 0x10, [REC + 0x0c]: 0x5d, [REC + 0x0d]: 0x2d, [REC + 0x0e]: 0x00,
    [WAVE_ARRIVAL_COUNTER]: (wave - 1) & 0xff,
    [FORMATION_SPAWN_TIMER]: 0x20 - Math.min(wave - 1, 0x0a),
  };
  // rec+0x03 and rec+0x05 are seeded to 0x00 == their pre-value, so they may not appear as "changed".
  for (const [addr, val] of Object.entries(expect)) {
    const a = Number(addr);
    if (val === 0x00 && !changed.has(a)) continue; // unchanged 0 -> 0 is allowed
    assert.ok(changed.has(a), `expected a write at ${hx(a)}`);
    assert.equal(changed.get(a).to, val, `cell ${hx(a)} := ${hx(val)}, got ${hx(changed.get(a).to)}`);
  }
  console.log(`  WRITE-SET: ${changed.size} cells written on the free path (wave=${hx(wave)})`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craft({ wave: 0x05 });
  const c = craft({ wave: 0x05 });
  oracle(o);
  launchFormationObjectIntoFreeSlot(c);
  c.mem.write8(REC + 0x09, 0x00); // BUG: the spawn field must be 0x10

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte");
  assert.equal(d.addr, REC + 0x09, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(REC + 0x09)})`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong boolean is CAUGHT by the boolean check", () => {
  const o = craft({ wave: 0x05 });
  const oret = oracle(o); // false (launched)
  assert.equal(oret, false, "sanity: the free path reports false");
  const brokenTwin = () => true; // a twin that says "keep scanning" after launching
  assert.throws(() => assert.equal(brokenTwin(), oret), "a wrong boolean must be caught");
  console.log("  TEETH/bool: a twin returning true on the free path is rejected");
});
