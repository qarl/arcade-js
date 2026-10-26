// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for restorePlayer1Shields -- force the mode flag clear (A:=0), then delegate to saveOrRestorePlayer1Shields (the
// 0x021b fall-through DISSOLVED): store SHIELD_SAVE_RESTORE_MODE=0 and OR the four 22x2 shield blocks
// back onto the player-1 screen region. A at entry is dead (zeroed); live-out is MEMORY only. The oracle
// push/pops around its dispatch, so the RAM diff excludes the dead stack scratch. Interrupts disabled on
// each clone so a handler cannot write RAM only on one side.
// Run: node --test games/invaders/idiomatic/test/equivalence-021a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_021a as oracleBody } from "../../translated/loc_021a.js";
import { restorePlayer1Shields } from "../restorePlayer1Shields.js";
import { saveOrRestorePlayer1Shields } from "../saveOrRestorePlayer1Shields.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SHIELD_SAVE_RESTORE_MODE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x021a;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x021a dispatches -- restorePlayer1Shields == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle push/pops around its dispatch, below the ENTRY SP -- exclude relative to that SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); restorePlayer1Shields(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A distinct pattern across work + video RAM, a real caller return on the stack, and A seeded NONZERO so
// the routine's own zeroing is proven -- the mode flag must land 0 whatever A was at entry.
function seat(m, a) {
  for (let addr = 0x2000; addr < 0x4000; addr++) m.mem.write8(addr, addr & 0xff);
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.a = a;
}

test("CRAFTED: A ignored -- restore path leaves the same RAM as the oracle and mode flag lands 0", () => {
  for (const a of [0x00, 0xff]) {
    const o = new Machine(ROM); seat(o, a);
    const c = new Machine(ROM); seat(c, a);
    oracle(o); restorePlayer1Shields(c);
    const tag = `A=0x${a.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `restore path RAM matches: ${tag}`);
    assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x00, `mode flag cleared: ${tag}`);
    assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), o.mem.read8(SHIELD_SAVE_RESTORE_MODE), `mode matches oracle: ${tag}`);
  }
});

test("TEETH: a module that forwards the entry A (skips the clear) diverges in RAM", () => {
  // Broken twin: delegate WITHOUT zeroing A, so a nonzero entry A takes the wrong (capture) path and
  // stores the wrong mode flag. Mutates restorePlayer1Shields's one job -- forcing the mode clear.
  const broken = (m) => saveOrRestorePlayer1Shields(m); // BUG: forwards m.regs.a instead of 0
  const o = new Machine(ROM); seat(o, 0x01);
  const c = new Machine(ROM); seat(c, 0x01);
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a skipped mode clear -- it is worthless");
});
