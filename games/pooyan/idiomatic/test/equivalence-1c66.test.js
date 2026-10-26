// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchRoundEndElseWipeColumn (ROM 0x1c66) — the round-clear / game-over / player-swap
 * master of the play-state dispatch handler. Void handler; LIVE-OUT is memory only, comparison is RAM
 * minus stack scratch below the entry SP. Cases: not-armed pre-pass, armed-but-not-expired pre-pass, armed+expired with a
 * failing integrity checksum (stamp the reset column then abort), and armed+expired with a passing
 * checksum (disarm + dispatch to a split-out tail). The checksum region is seeded so the pass/fail
 * arms are deterministic; the reset column is pre-dirtied so the stamp is observable.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1c66.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1c66 as oracle } from "../../translated/loc_1c66.js";
import { dispatchRoundEndElseWipeColumn } from "../dispatchRoundEndElseWipeColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PHASE_TIMER = 0x8808;
const RESET_SCAN_LATCH = 0x8e2a;
const RESET_ATTR_COLUMN = 0x855f;
const HUD_INTEGRITY_STRIP_A = 0x82bc;
const TWO_PLAYER_FLAG = 0x880e;
const ROW_STRIDE = 0x20;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Zero the 10 checksum cells (stride -0x20), then set the head so the byte sum equals `sum`. */
function seedChecksum(m, sum) {
  let a = HUD_INTEGRITY_STRIP_A;
  for (let i = 0; i < 0x0a; i++) { m.mem.write8(a, 0); a = (a - ROW_STRIDE) & 0xffff; }
  m.mem.write8(HUD_INTEGRITY_STRIP_A, sum & 0xff);
}

function seat(m, { latch = 0, timer = 5, sum = 0 } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(RESET_SCAN_LATCH, latch);
  m.mem.write8(PHASE_TIMER, timer);
  seedChecksum(m, sum);
  let a = RESET_ATTR_COLUMN; // pre-dirty the 8 reset-column cells so the stamp is observable
  for (let i = 0; i < 8; i++) { m.mem.write8(a, 0x55); a = (a - ROW_STRIDE) & 0xffff; }
  return m;
}

const CASES = {
  "not armed -> pre-pass": (m) => seat(m, { latch: 0, timer: 5 }),
  "armed, not expired -> pre-pass": (m) => seat(m, { latch: 1, timer: 5 }),
  "armed, expired, checksum fail -> stamp + abort": (m) => seat(m, { latch: 1, timer: 1, sum: 0x00 }),
  "armed, expired, checksum pass -> dispatch": (m) => {
    seat(m, { latch: 1, timer: 1, sum: 0xaa });
    m.mem.write8(TWO_PLAYER_FLAG, 0); // -> the full-clear tail
    return m;
  },
};

// -- 1. EQUAL ----------------------------------------------------------------

test("EQUAL: dispatchRoundEndElseWipeColumn == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    dispatchRoundEndElseWipeColumn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET ------------------------------------------------------------

test("WRITE-SET: the expired path stamps the reset column; a clean checksum disarms the latch", () => {
  const stamp = CASES["armed, expired, checksum fail -> stamp + abort"](BASE.clone());
  oracle(stamp);
  assert.equal(stamp.mem.read8(RESET_ATTR_COLUMN), 0x10, "reset column head stamped to 0x10");
  assert.equal(stamp.mem.read8(RESET_SCAN_LATCH), 1, "a failing checksum leaves the latch armed");

  const pass = CASES["armed, expired, checksum pass -> dispatch"](BASE.clone());
  oracle(pass);
  assert.equal(pass.mem.read8(RESET_SCAN_LATCH), 0, "a passing checksum disarms the latch");
  console.log("  WRITE-SET: stamp 0x10; fail keeps latch, pass disarms");
});

// -- 3. TEETH ----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["armed, expired, checksum fail -> stamp + abort"](BASE.clone());
  const c = CASES["armed, expired, checksum fail -> stamp + abort"](BASE.clone());
  oracle(o);
  dispatchRoundEndElseWipeColumn(c);
  c.mem.write8(RESET_ATTR_COLUMN, (o.mem.read8(RESET_ATTR_COLUMN) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, RESET_ATTR_COLUMN, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the reset-column stamp diverges from the oracle", () => {
  const o = CASES["armed, expired, checksum fail -> stamp + abort"](BASE.clone());
  const c = CASES["armed, expired, checksum fail -> stamp + abort"](BASE.clone());
  oracle(o); // stamps the pre-dirtied 0x55 column to 0x10
  // twin: do nothing -> the pre-run 0x55 filler survives
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped stamp must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
