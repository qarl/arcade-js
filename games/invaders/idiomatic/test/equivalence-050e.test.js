// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence + wiring for attractAnimHandler (ROM 0x050e) -- the attract-demo object handler for
// the ISR-handshaked reveal animation (credit / high-score attract screen). runHandshakedAttractAnim
// block-copies a fixed descriptor (ROM 0x1bc0, handler target 0x050e) into the attract object table at
// 0x2050, arms TASK_FLAGS bit2, and spins on ATTRACT_ANIM_ACK 0x2055; when the record's timer expires the
// object walker (walkObjectTable) dispatches to 0x050e, which steps the animated object and toggles 0x2055
// through its block-copy to complete the handshake.
//
// ROM 0x050e is ONE byte before the loc_050f body and enters it via `pop h` (0xe1): the walker's `pchl`
// (loc_024b @ 0x026e) pushes the record pointer before jumping, so this direct-dispatched entry pops it to
// rebalance the stack before falling into the shared body -- exactly as the saucer handler (0x0682) does at
// its own entry, and exactly as the saucer handler reaches this same body in-game via `call 0x050f`. `pop h`
// touches NO RAM (it moves HL + SP only) and the popped HL is dead (loc_0550 overwrites it before any use),
// so the observable memory/IO behaviour of 0x050e is exactly the loc_050f body. The idiomatic walker calls
// handlers directly as JS and pushes nothing, so attractAnimHandler simply runs that body
// (alienShotSlot4Handler); the oracle's internal pushes and the (absent) pop only move dead stack, which the
// RAM(-stack) diff excludes. MAME-grounded: during input-free attract 0x050e executes every reveal cycle and
// 0x2055 bit0 toggles 0 -> 1 -> 0 (games/invaders/tools/lua/ground_050e.lua).
// Run: node --test games/invaders/idiomatic/test/equivalence-050e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_050f as oracleBody } from "../../translated/loc_050f.js";
import { attractAnimHandler } from "../attractAnimHandler.js";
import { walkObjectTable } from "../walkObjectTable.js";
import { copyRecordToWorkBuffer } from "../copyRecordToWorkBuffer.js";
import { stepAlienShot } from "../stepAlienShot.js";
import { blockCopy } from "../blockCopy.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import {
  STACK_SCRATCH, ATTRACT_ANIM_ACK, ATTRACT_ANIM_HANDLER_ADDR, loc_2046, ALIEN_SHOT_RATE_GATE0, loc_2036, ALIEN_SHOT_RATE_GATE_1,
  SHIP_READY_FLAG, TASK_FLAGS, ALIEN_SHOT_COLUMN_CURSOR, loc_1b58, ALIEN_SHOT_BLOWUP_TIMER, ALIEN_SHOT_RECORD_TEMPLATE, ATTRACT_OBJECT_TABLE, ALIEN_SHOT4_COLUMN_CURSOR,
} from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

// The shared loc_050f body is dispatched in-game via the saucer handler's `call 0x050f`; 0x050e is the same
// body reached by the walker's pchl. Capture real dispatch STATES at 0x050f (valid runtime state for the
// body attractAnimHandler runs) and compare the handler against the oracle there.
const BODY = 0x050f;

function captureBodyDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[BODY, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureBodyDispatches(24, 2500) : [];

test("CAPTURE: real body dispatches -- attractAnimHandler == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch the shared body at least once");
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    // These object-walk dispatches run with SP high (into video RAM); the record-pointer slot the walker
    // pushes lands at [sp, sp+1] and is dead once the handler consumes it, so the mask spans past sp.
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && ((a >= sp - 0x40 && a < sp) || deadStackBelow(STACK_SCRATCH, sp)(a)));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); attractAnimHandler(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} body dispatch(es) checked`);
});

// The REAL attract entry state: block-copy the fixed reveal descriptor (ROM 0x1bc0, handler target 0x050e)
// into the attract object table at 0x2050, arm the reveal task (TASK_FLAGS bit2), and seat SP on a real
// caller-return word so the oracle's nested pushes land in the dead scratch the diff excludes. This is the
// state the walker dispatches 0x050e from every reveal cycle. The descriptor's byte 5 (0x2055) is 0, so the
// shot stepper is idle and the armed task drives it live -- the reveal-anim path.
const ATTRACT_DESC_ROM = 0x1bc0;
function craftAttract(extra) {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write16(0x2400, 0xabcd);
  m.io.setInte(false);
  for (let i = 0; i < 0x10; i++) m.mem.write8(ATTRACT_OBJECT_TABLE + i, ROM[ATTRACT_DESC_ROM + i]); // real reveal descriptor
  m.mem.write8(TASK_FLAGS, 0x04); // reveal task armed (bit2), the live gate stepAlienShot reads
  m.mem.write8(SHIP_READY_FLAG, 0x00);
  if (extra) extra(m);
  return m;
}

test("CRAFTED (attract descriptor): the reveal entry leaves identical RAM (-stack) vs the oracle body", () => {
  const o = craftAttract(), c = craftAttract();
  oracle(o); attractAnimHandler(c);
  assert.equal(ramDiff(o, c), null, "attract reveal-anim entry RAM (-stack) mismatch");
});

// END-TO-END WIRING: the walker must route the attract record's 0x050e target to attractAnimHandler. Seed
// the descriptor with the timer + gate expired (so the walker dispatches this frame) and a 0xff terminator
// at the next record, then walk from 0x2050 and assert it does NOT throw and produces the same RAM (-stack)
// as running the oracle body from the same dispatch state.
function craftWalk(target = ATTRACT_ANIM_HANDLER_ADDR) {
  const m = craftAttract((mm) => {
    mm.mem.write8(ATTRACT_OBJECT_TABLE + 0, 0x00); mm.mem.write8(ATTRACT_OBJECT_TABLE + 1, 0x00); // 16-bit timer = 0 (expired)
    mm.mem.write8(ATTRACT_OBJECT_TABLE + 2, 0x00);                                    // gate byte = 0 (expired)
    mm.mem.write8(ATTRACT_OBJECT_TABLE + 3, target & 0xff);                           // handler target lo
    mm.mem.write8(ATTRACT_OBJECT_TABLE + 4, (target >> 8) & 0xff);                    // handler target hi
    mm.mem.write8(ATTRACT_OBJECT_TABLE + 0x10, 0xff);                                 // walk terminator (next record)
  });
  return m;
}

test("WIRING: walkObjectTable routes the attract record 0x050e -> attractAnimHandler (RAM -stack == oracle body)", () => {
  const w = craftWalk();
  const o = craftWalk();
  // The oracle body from the same dispatch state: the walker consumes the timer/gate (both 0 -> no writes)
  // then dispatches the record data pointer (rec+4). Run the oracle body directly for the reference.
  assert.doesNotThrow(() => walkObjectTable(w, ATTRACT_OBJECT_TABLE), "the 0x050e attract target must dispatch, not throw");
  oracle(o);
  assert.equal(ramDiff(w, o), null, "the walker's 0x050e dispatch diverged from the oracle body in RAM (-stack)");
});

test("WIRING NEGATIVE CONTROL: an unmapped object-handler target still throws (guard has teeth)", () => {
  const bad = craftWalk(0x1234); // not in the HANDLERS map
  assert.throws(() => walkObjectTable(bad, ATTRACT_OBJECT_TABLE), /unexpected object-handler target 0x1234/);
});

// The real reveal descriptor (ROM 0x1bc0 byte 10 = 0x07 -> work-buffer ALIEN_SHOT_BLOWUP_TIMER 0x2078)
// takes the mid-blowup RESTORE branch (copyWorkBufferToRecord writes the stepped strip -- incl. the shot's
// now-live status byte at 0x2055 -- back into the record). TEETH: a BROKEN twin that reproduces the branch
// through the shared callees but DROPS that restore copy; the RAM(-stack) diff must catch it.
function body_droppedRestore(m) {
  copyRecordToWorkBuffer(m, 0xdb, ATTRACT_ANIM_ACK);
  m.mem8[ALIEN_SHOT_RATE_GATE0] = m.mem8[loc_2046];
  m.mem8[ALIEN_SHOT_RATE_GATE_1] = m.mem8[loc_2036];
  stepAlienShot(m);
  if (m.mem8[ALIEN_SHOT_COLUMN_CURSOR] >= 21) m.mem8[ALIEN_SHOT_COLUMN_CURSOR] = m.mem8[loc_1b58];
  if (m.mem8[ALIEN_SHOT_BLOWUP_TIMER] !== 0) return; // BUG: dropped `copyWorkBufferToRecord(m, ATTRACT_ANIM_ACK)`
  blockCopy(m, ALIEN_SHOT_RECORD_TEMPLATE, ATTRACT_OBJECT_TABLE, 16);
  m.mem16[ALIEN_SHOT4_COLUMN_CURSOR] = m.mem16[ALIEN_SHOT_COLUMN_CURSOR];
}

test("TEETH: a twin that skips the mid-blowup strip restore diverges in RAM (-stack)", () => {
  const o = craftAttract(), c = craftAttract();
  // Sanity: the real reveal descriptor drives the restore branch (blowup timer nonzero after the strip copy).
  oracle(o); body_droppedRestore(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a dropped mid-blowup strip restore");
});
