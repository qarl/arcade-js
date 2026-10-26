// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for savePlayer2Shields -- force save mode (1) then run the shared shield save/restore body
// against the player-2 backup buffer (DISSOLVED into a direct savePlayer2Shields -> saveOrRestorePlayer2Shields -> drawOrSaveShields).
// The mode is unconditional (1 => captureScreenRect saves the screen region into the PLAYER2_SHIELD_BUFFER buffer), so
// the incoming A is a decoy. Live-out is MEMORY; the callee threads HL/DE but no caller reads them back
// (the delegate loc_02f8 reloads HL/DE via 0x0878 and restores A via `pop psw`). The oracle push/pops
// around its body's m.call's, so the diff excludes dead stack scratch. Interrupts are disabled per clone.
// Run: node --test games/invaders/idiomatic/test/equivalence-020e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_020e as oracleBody } from "../../translated/loc_020e.js";
import { savePlayer2Shields } from "../savePlayer2Shields.js";
import { saveOrRestorePlayer2Shields } from "../saveOrRestorePlayer2Shields.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SHIELD_SAVE_RESTORE_MODE, PLAYER2_SHIELD_BUFFER } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x020e;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x020e dispatches -- savePlayer2Shields == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // Residue from the body's per-call push16 sits just below the ENTRY SP -- exclude relative to it.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x20 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); savePlayer2Shields(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x01, "save mode stored");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A distinct pattern across work + video RAM, a real caller return on the stack, and a DECOY A that both
// sides must ignore (the routine forces mode 1 internally).
function seat(m) {
  for (let addr = 0x2000; addr < 0x4000; addr++) m.mem.write8(addr, addr & 0xff);
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.a = 0x55; // decoy: overridden by the forced save mode on both sides
}

test("CRAFTED: forced save path -- module leaves the same RAM as the oracle, mode := 1", () => {
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); savePlayer2Shields(c);
  assert.equal(ramDiff(o, c), null, "save path RAM matches");
  assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x01, "mode forced to save (1), not the decoy A");
  assert.equal(c.mem.read8(PLAYER2_SHIELD_BUFFER), o.mem.read8(PLAYER2_SHIELD_BUFFER), "captured into the player-2 buffer, matches oracle");
});

test("TEETH: a twin that forwards the wrong mode (blit) diverges in RAM at the stored mode", () => {
  // Mutate savePlayer2Shields's OWN contribution: it forwards mode 0 (blit) instead of the forced save mode 1.
  function loc_020e_broken(m) {
    saveOrRestorePlayer2Shields(m, 0); // BUG: restore/blit instead of save
  }
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); loc_020e_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped save mode");
  assert.equal(d.addr, SHIELD_SAVE_RESTORE_MODE, "first divergence is the stored mode");
});
