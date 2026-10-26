// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for initDescendingObjectSlot (ROM 0x42da, Pooyan) — "object-slot initializer".
 *
 * initDescendingObjectSlot is a CALLER-SKIP for moveFormationAndSpawnObject's spawn loop. In the oracle a live slot ends with a plain
 * `ret` (the loop continues) and an initialized slot ends with `pop af; ret` — discarding its own
 * return to abort the loop. The idiomatic module drops that stack plumbing and returns a BOOLEAN:
 *   true  = normal return (slot busy -> loop continues),
 *   false = the caller-skip (slot initialized -> abort moveFormationAndSpawnObject's loop).
 * The frozen oracle does NOT (yet) carry the boolean protocol, so its skip is read from the STACK
 * DELTA: a plain `ret` moves SP +2, the `pop af; ret` moves it +4. The module composes the real
 * idiomatic callees (fetchWordFromTableIndex + storeActorAnimationPointer + setActorAnimation); equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP. initDescendingObjectSlot has no register live-out — moveFormationAndSpawnObject reloads its own.
 *
 * Jobs:
 *   1. EQUAL — busy (no writes, true) and free (full init, false): oracle == module in RAM (−stack),
 *      and the module boolean matches the oracle's stack-delta skip signal.
 *   2. WRITE-SET — the init path writes the slot's active/state/position/anim fields.
 *   3. TEETH — a wrong initialized byte is CAUGHT by the RAM diff; a wrong boolean by the check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-42da.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_42da as oracle } from "../../translated/loc_42da.js";
import { initDescendingObjectSlot } from "../initDescendingObjectSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ROUND_COUNTER, SPAWN_OBJECT_TABLE, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT = SPAWN_OBJECT_TABLE; //   IY: the slot being initialized (0x8c48)
const SOURCE = ENEMY_ACTOR_TABLE; //  IX: the parent record supplying the position block (0x8ae0)
const ROUND = 0x06; //                (round>>1)-1 & 3 = 2 -> a valid anim-table index
const SP0 = 0x8fd0; //                inside STACK_SCRATCH, room for internal pushes + two ret words
const RET_LO = 0xfffc; //             word at SP0 (own return, discarded on the skip path)
const RET_HI = 0xfffa; //             word at SP0+2 (the caller's caller, ret'd to on the skip path)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: IX/IY seated, round set; `live` marks the slot busy (bit0 of its first byte). */
function craft(live) {
  const m = BASE.clone();
  m.regs.ix = SOURCE;
  m.regs.iy = SLOT;
  m.regs.sp = SP0;
  m.mem.write16(SP0, RET_LO);
  m.mem.write16(SP0 + 2, RET_HI);
  m.mem8[ROUND_COUNTER] = ROUND;
  m.mem8[SLOT] = live ? 0x01 : 0x00; // bit0 -> slot occupied
  m.mem8[SLOT + 1] = 0x00;
  return m;
}

const oracleSkipped = (m) => ((m.regs.sp - SP0) & 0xffff) === 4; // pop af; ret moved +4

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: busy + free paths agree in RAM (−stack) and in the boolean", () => {
  for (const [label, live, wantBool] of [["busy", true, true], ["free -> init", false, false]]) {
    const o = craft(live);
    const oret = oracle(o);
    void oret; // the oracle does not carry the boolean; its skip is the stack delta
    const c = craft(live);
    const cret = initDescendingObjectSlot(c);
    assert.equal(cret, wantBool, `module boolean for "${label}"`);
    assert.equal(cret, !oracleSkipped(o), `module boolean must match the oracle skip signal ("${label}")`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: busy + free identical (RAM −stack + boolean vs stack delta)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the init path writes the slot's active/state/position/anim fields", () => {
  const before = craft(false).dumpState();
  const after = craft(false);
  oracle(after);
  const a1 = after.dumpState();
  const changed = new Set();
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
  }
  // constant writes (0 -> nonzero, guaranteed to differ from the zeroed background)
  for (const cell of [SLOT, SLOT + 2, SLOT + 9, SLOT + 0x11, SOURCE + 0x11]) {
    assert.ok(changed.has(cell), `expected a write at ${hx(cell)}`);
  }
  console.log(`  WRITE-SET: ${changed.size} cells written by the init path`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong initialized byte is CAUGHT by the RAM diff", () => {
  const o = craft(false);
  const c = craft(false);
  oracle(o);
  initDescendingObjectSlot(c);
  c.mem8[SLOT + 2] = (c.mem8[SLOT + 2] ^ 0xff) & 0xff; // BUG: corrupt the seeded state byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong initialized byte");
  assert.equal(d.addr, SLOT + 2, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(SLOT + 2)})`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong boolean is CAUGHT by the boolean check", () => {
  const o = craft(false);
  oracle(o);
  assert.equal(oracleSkipped(o), true, "sanity: the init path skip-returns (stack +4)");
  const brokenTwin = () => true; // a twin that fails to abort moveFormationAndSpawnObject's loop
  assert.throws(() => assert.equal(brokenTwin(), !oracleSkipped(o)), "a wrong boolean must be caught");
  console.log("  TEETH/bool: a twin returning true on the skip path is rejected");
});
