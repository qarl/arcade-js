// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for saveOrRestorePlayer2Shields -- seat the player-2 shield source/dest base, then delegate to
// drawOrSaveShields (the 0x021e tail dissolved): store the caller's mode flag A, then run four 22x2
// blocks -- capture the screen region when the flag is set, else OR the source bitmap in. A is a live-in
// (the callers seat A=1 for capture / A=0 for blit); live-out is MEMORY only. The oracle push/pops around
// its two dispatches, so the diff excludes the dead stack scratch. Interrupts are disabled on each clone.
// Run: node --test games/invaders/idiomatic/test/equivalence-0214.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0214 as oracleBody } from "../../translated/loc_0214.js";
import { saveOrRestorePlayer2Shields } from "../saveOrRestorePlayer2Shields.js";
import { drawOrSaveShields } from "../drawOrSaveShields.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SHIELD_SAVE_RESTORE_MODE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0214;
const BASE = 0x2242;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0214 dispatches -- saveOrRestorePlayer2Shields == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle push/pops psw+bc+a return slot around its two dispatches, below the ENTRY SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); saveOrRestorePlayer2Shields(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A distinct pattern across work + video RAM, a real caller return on the stack, the mode flag in A.
// The routine seats DE itself, so the incoming DE is irrelevant.
function seat(m, a) {
  for (let addr = 0x2000; addr < 0x4000; addr++) m.mem.write8(addr, addr & 0xff);
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.a = a;
}

test("CRAFTED: blit path (A=0) -- module leaves the same RAM as the oracle", () => {
  const o = new Machine(ROM); seat(o, 0x00);
  const c = new Machine(ROM); seat(c, 0x00);
  oracle(o); saveOrRestorePlayer2Shields(c);
  assert.equal(ramDiff(o, c), null, "blit path RAM matches");
  assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x00, "mode flag stored");
});

test("CRAFTED: capture path (A!=0) -- module leaves the same RAM as the oracle", () => {
  const o = new Machine(ROM); seat(o, 0x01);
  const c = new Machine(ROM); seat(c, 0x01);
  oracle(o); saveOrRestorePlayer2Shields(c);
  assert.equal(ramDiff(o, c), null, "capture path RAM matches");
  assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x01, "mode flag stored");
});

test("TEETH: a module that drops the caller's mode flag is caught by the RAM diff", () => {
  // Broken twin: forward a hard-coded blit mode instead of the caller's A. On the capture case (A=1)
  // this stores the wrong flag and takes the wrong draw path.
  const broken = (m) => drawOrSaveShields(m, 0x00, BASE); // BUG: ignores the live-in mode flag
  const o = new Machine(ROM); seat(o, 0x01);
  const c = new Machine(ROM); seat(c, 0x01);
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped mode flag -- it is worthless");
});
