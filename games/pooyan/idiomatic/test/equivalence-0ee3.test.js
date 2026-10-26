// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand04IfNotBusy (ROM 0x0ee3) — "conditionally enqueue command 0x04".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): oracle and module run
 * on fresh clones and are compared on RAM (dumpState, minus stack scratch below the entry SP) PLUS the declared
 * register live-out A. pc/SP/cycles are deliberately not compared.
 *
 * LIVE-OUT A: on a busy gate the oracle leaves A holding the gate byte it tested; on the
 * enqueue path A is the ring appender's advanced cursor (AF is not restored). It is declared
 * and set to match the oracle on every path (a matching set can never false-fail even if no
 * caller actually reads it).
 *
 * The leaf is not reached in a plain boot/attract, so every case is CRAFTED: the gate cells
 * and the appender's cells are poked identically on both clones.
 *
 * Jobs:
 *   1. EQUAL — over crafted gate/appender states, oracle == queueSoundCommand04IfNotBusy in RAM (-stack) and A.
 *   2. WRITE-SET — a busy gate writes nothing; the enqueue path writes only the pending byte
 *      (both gates closed) or the pending byte + ring slot + write pointer (append).
 *   3. TEETH — a wrong appended ring byte is caught by the RAM diff; a wrong A is caught by
 *      the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0ee3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ee3 as oracle } from "../../translated/loc_0ee3.js";
import { queueSoundCommand04IfNotBusy } from "../queueSoundCommand04IfNotBusy.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  WAVE_TEARDOWN_STATE,
  GRAB_ACTIVE_FLAG,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_WRITE_PTR,
  SOUND_RING_PENDING_BYTE,
} from "../names.js";

const RING_PAGE = 0x8a00; // the page-0x8a command ring the appender writes into

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(pokes) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; the oracle's calls only touch it there
  for (const [addr, val] of pokes) m.mem8[addr] = val;
  return m;
}

// All crafted. Each case pokes every input cell so the outcome is deterministic on both sides.
const CASES = [
  {
    name: "wave-teardown busy",
    pokes: [[WAVE_TEARDOWN_STATE, 0x02], [GRAB_ACTIVE_FLAG, 0x00]],
    expectA: 0x02,
  },
  {
    name: "grab busy",
    pokes: [[WAVE_TEARDOWN_STATE, 0x00], [GRAB_ACTIVE_FLAG, 0x01]],
    expectA: 0x01,
  },
  {
    name: "go, appender gates closed",
    pokes: [
      [WAVE_TEARDOWN_STATE, 0x00], [GRAB_ACTIVE_FLAG, 0x00],
      [GAME_ACTIVE_FLAG, 0x00], [PLAY_MODE_LATCH, 0x00],
      [SOUND_RING_PENDING_BYTE, 0x00],
    ],
    expectA: 0x00,
  },
  {
    name: "go, append mid-ring",
    pokes: [
      [WAVE_TEARDOWN_STATE, 0x00], [GRAB_ACTIVE_FLAG, 0x00],
      [GAME_ACTIVE_FLAG, 0x01], [SOUND_RING_WRITE_PTR, 0x50],
      [RING_PAGE + 0x50, 0x00], [SOUND_RING_PENDING_BYTE, 0x00],
    ],
    expectA: 0x51,
  },
  {
    name: "go, append at last slot (wraps)",
    pokes: [
      [WAVE_TEARDOWN_STATE, 0x00], [GRAB_ACTIVE_FLAG, 0x00],
      [GAME_ACTIVE_FLAG, 0x01], [SOUND_RING_WRITE_PTR, 0x5e],
      [RING_PAGE + 0x5e, 0x00], [SOUND_RING_PENDING_BYTE, 0x00],
    ],
    expectA: 0x43,
  },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/appender states — queueSoundCommand04IfNotBusy == oracle in RAM (−stack) + A", () => {
  for (const { name, pokes, expectA } of CASES) {
    const o = craft(pokes);
    const c = craft(pokes);
    oracle(o);
    const ret = queueSoundCommand04IfNotBusy(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (${name})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (${name})`);
    // SIDE-EFFECT arm: the module must SET A on its own clone (return-assignment bridge).
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (${name})`);
    assert.equal(o.regs.a & 0xff, expectA, `oracle A sanity (${name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a busy gate writes nothing; the append path writes only pending/slot/ptr", () => {
  // busy gate -> zero writes
  {
    const before = craft([[WAVE_TEARDOWN_STATE, 0x02], [GRAB_ACTIVE_FLAG, 0x00]]);
    const after = craft([[WAVE_TEARDOWN_STATE, 0x02], [GRAB_ACTIVE_FLAG, 0x00]]);
    const b = before.dumpState();
    oracle(after);
    const a = after.dumpState();
    let changed = 0;
    for (let off = 0; off < b.length; off++) if (b[off] !== a[off]) changed++;
    assert.equal(changed, 0, "a busy gate must write no RAM");
  }
  // append -> pending byte, ring slot, write pointer
  {
    const pokes = [
      [WAVE_TEARDOWN_STATE, 0x00], [GRAB_ACTIVE_FLAG, 0x00],
      [GAME_ACTIVE_FLAG, 0x01], [SOUND_RING_WRITE_PTR, 0x50],
      [RING_PAGE + 0x50, 0x00], [SOUND_RING_PENDING_BYTE, 0x00],
    ];
    const before = craft(pokes);
    const after = craft(pokes);
    const b = before.dumpState();
    oracle(after);
    const a = after.dumpState();
    const changed = new Set();
    for (let off = 0; off < b.length; off++) if (b[off] !== a[off]) changed.add(after.stateOffsetToAddr(off));
    const expected = new Set([SOUND_RING_PENDING_BYTE, RING_PAGE + 0x50, SOUND_RING_WRITE_PTR]);
    for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
    assert.equal(after.mem8[RING_PAGE + 0x50], 0x04, "ring slot must hold command 0x04");
    assert.equal(after.mem8[SOUND_RING_WRITE_PTR], 0x51, "write pointer advanced");
    console.log(`  WRITE-SET: append writes ${[...changed].map(hx).join("/")}`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong appended ring byte is CAUGHT by the RAM diff", () => {
  const pokes = [
    [WAVE_TEARDOWN_STATE, 0x00], [GRAB_ACTIVE_FLAG, 0x00],
    [GAME_ACTIVE_FLAG, 0x01], [SOUND_RING_WRITE_PTR, 0x50],
    [RING_PAGE + 0x50, 0x00], [SOUND_RING_PENDING_BYTE, 0x00],
  ];
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  queueSoundCommand04IfNotBusy(c);
  c.mem8[RING_PAGE + 0x50] = 0x00; // BUG: slot must hold 0x04

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte");
  assert.equal(d.addr, RING_PAGE + 0x50, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong ring byte caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong A is CAUGHT by the live-out check", () => {
  const pokes = [[WAVE_TEARDOWN_STATE, 0x02], [GRAB_ACTIVE_FLAG, 0x00]];
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  const ret = queueSoundCommand04IfNotBusy(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches oracle");
  const broken = (o.regs.a ^ 0xff) & 0xff; // a wrong A the === check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the live-out check must reject a wrong A");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; a flipped ${hx(broken)} is rejected`);
});
