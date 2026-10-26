// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for saveOrRestorePlayer1Shields -- seed the shield backup-buffer pointer into DE, then run the shared
// shield save/restore body (DISSOLVED into a direct drawOrSaveShields, buffer fixed to PLAYER1_SHIELD_BUFFER). A at
// entry is the save/restore mode (nonzero => capture, zero => OR-blit); DE at entry is DEAD (the routine
// overwrites it with the fixed buffer). Live-out is MEMORY; the callee's HL/DE thread the loop but no
// caller reads them back. The oracle push/pops around its body's two m.call's, so the diff excludes dead
// stack scratch. Interrupts are disabled on each clone so a handler cannot write RAM only on one side.
// Run: node --test games/invaders/idiomatic/test/equivalence-021b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_021b as oracleBody } from "../../translated/loc_021b.js";
import { saveOrRestorePlayer1Shields } from "../saveOrRestorePlayer1Shields.js";
import { drawOrSaveShields } from "../drawOrSaveShields.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SHIELD_SAVE_RESTORE_MODE, PLAYER1_SHIELD_BUFFER } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x021b;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x021b dispatches -- saveOrRestorePlayer1Shields == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // Residue from the body's per-call push16 sits just below the ENTRY SP -- exclude relative to it.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x20 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); saveOrRestorePlayer1Shields(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a distinct pattern across work + video RAM, a real caller return on the stack,
// the mode in A, and a DECOY DE that both oracle and module must ignore (they force the buffer PLAYER1_SHIELD_BUFFER).
function seat(m, { a }) {
  for (let addr = 0x2000; addr < 0x4000; addr++) m.mem.write8(addr, addr & 0xff);
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.a = a; m.regs.de = 0x2900; // decoy: overwritten by the fixed buffer on both sides
}

test("CRAFTED: restore/blit path (A=0) -- module leaves the same RAM as the oracle", () => {
  const o = new Machine(ROM); seat(o, { a: 0x00 });
  const c = new Machine(ROM); seat(c, { a: 0x00 });
  oracle(o); saveOrRestorePlayer1Shields(c);
  assert.equal(ramDiff(o, c), null, "blit path RAM matches");
  assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x00, "mode stored");
});

test("CRAFTED: save/capture path (A=1) -- module leaves the same RAM as the oracle", () => {
  const o = new Machine(ROM); seat(o, { a: 0x01 });
  const c = new Machine(ROM); seat(c, { a: 0x01 });
  oracle(o); saveOrRestorePlayer1Shields(c);
  assert.equal(ramDiff(o, c), null, "capture path RAM matches");
  assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x01, "mode stored");
  // The captured screen landed in the fixed buffer, not the decoy DE.
  assert.equal(c.mem.read8(PLAYER1_SHIELD_BUFFER), o.mem.read8(PLAYER1_SHIELD_BUFFER), "buffer[0] matches oracle");
});

test("TEETH: a twin that drops the mode forward (forces blit) diverges in RAM", () => {
  // Mutate saveOrRestorePlayer1Shields's OWN contribution: it no longer forwards A as the mode -- it always blits.
  function loc_021b_broken(m) {
    return drawOrSaveShields(m, 0x00, PLAYER1_SHIELD_BUFFER); // BUG: mode hardwired to 0, A ignored
  }
  const o = new Machine(ROM); seat(o, { a: 0x01 });   // capture on the oracle
  const c = new Machine(ROM); seat(c, { a: 0x01 });
  oracle(o); loc_021b_broken(c);                        // blit on the twin
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped mode forward");
  assert.equal(d.addr, SHIELD_SAVE_RESTORE_MODE, "first divergence is the stored mode");
});
