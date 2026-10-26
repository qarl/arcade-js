// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for alienShotSlot4Handler (ROM 0x050f) -- the object step handler reached as a tail-target from
// the saucer handler. It primes the record's descriptor strip into the shared work buffer, stages two
// rate cells, steps the alien shot, clamps the firing column, then either restores the strip (mid-blowup)
// or blits the record's template band and stows the column word. Reached via m.call (not the pchl that
// pushes a record pointer), so it is a clean omitted-ret leaf: the arms compare RAM (-stack) only, and it
// is seam-placeable + wired. The cycle-driven attract boot dispatches it with valid state (SP runs high,
// into video RAM, during these object-walk dispatches -- so the CAPTURE mask spans [sp-0x40, sp+2)).
// Run: node --test games/invaders/idiomatic/test/equivalence-050f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_050f as oracleBody } from "../../translated/loc_050f.js";
import { alienShotSlot4Handler } from "../alienShotSlot4Handler.js";
import { copyRecordToWorkBuffer } from "../copyRecordToWorkBuffer.js";
import { stepAlienShot } from "../stepAlienShot.js";
import { copyWorkBufferToRecord } from "../copyWorkBufferToRecord.js";
import { blockCopy } from "../blockCopy.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import {
  STACK_SCRATCH, ATTRACT_ANIM_ACK, loc_2046, ALIEN_SHOT_RATE_GATE0, loc_2036, ALIEN_SHOT_RATE_GATE_1,
  SHIP_READY_FLAG, TASK_FLAGS, ALIEN_SHOT_COLUMN_CURSOR, loc_1b58, ALIEN_SHOT_BLOWUP_TIMER, ALIEN_SHOT_RECORD_TEMPLATE, ATTRACT_OBJECT_TABLE, ALIEN_SHOT4_COLUMN_CURSOR,
} from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x050f;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2500) : [];

test("CAPTURE: real 0x050f dispatches -- alienShotSlot4Handler == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x050f at least once");
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    // These object-walk dispatches run with SP high (into video RAM); the record-pointer slot the walker
    // pushes lands at [sp, sp+1] and is dead once the handler consumes it, so the mask spans past sp.
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && ((a >= sp - 0x40 && a < sp) || deadStackBelow(STACK_SCRATCH, sp)(a)));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); alienShotSlot4Handler(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A pristine crafted machine: SP seated on a real caller-return word (so the oracle's nested pushes land
// in the dead scratch the diff excludes) and interrupts off. The strip source at the record descriptor is
// seeded so the copied buffer leaves the shot stepper idle (status bit7 clear, launch gate zero) and its
// blowup byte clear -- driving the template-blit + column-stow branch with a NONZERO column to stow.
function craft(extra) {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write16(0x2400, 0xabcd);
  m.io.setInte(false);
  for (let a = ATTRACT_ANIM_ACK; a < ATTRACT_ANIM_ACK + 0x0b; a++) m.mem.write8(a, 0x00);
  m.mem.write8(ATTRACT_ANIM_ACK + 3, 0x05); // -> ALIEN_SHOT_COLUMN_CURSOR (column low) = 5, below the clamp threshold
  m.mem.write8(ATTRACT_ANIM_ACK + 4, 0x12); // -> loc_2077 (column high) = 0x12, so the stow word is nonzero
  m.mem.write8(SHIP_READY_FLAG, 0x00);
  m.mem.write8(TASK_FLAGS, 0x00);
  if (extra) extra(m);
  return m;
}

test("CRAFTED: the template-blit + column-stow branch leaves identical RAM (-stack)", () => {
  const o = craft(), c = craft();
  oracle(o); alienShotSlot4Handler(c);
  assert.equal(ramDiff(o, c), null, "blockCopy/stow branch RAM (-stack) mismatch");
});

// TEETH run a BROKEN inline copy of the module's logic and assert the RAM-diff check catches it -- the
// mutant reproduces the real branch through the shared callees but DROPS the final column-stow store.
function alienShotSlot4Handler_droppedStow(m) {
  copyRecordToWorkBuffer(m, 0xdb, ATTRACT_ANIM_ACK);
  m.mem8[ALIEN_SHOT_RATE_GATE0] = m.mem8[loc_2046];
  m.mem8[ALIEN_SHOT_RATE_GATE_1] = m.mem8[loc_2036];
  stepAlienShot(m);
  if (m.mem8[ALIEN_SHOT_COLUMN_CURSOR] >= 21) m.mem8[ALIEN_SHOT_COLUMN_CURSOR] = m.mem8[loc_1b58];
  if (m.mem8[ALIEN_SHOT_BLOWUP_TIMER] !== 0) return copyWorkBufferToRecord(m, ATTRACT_ANIM_ACK);
  blockCopy(m, ALIEN_SHOT_RECORD_TEMPLATE, ATTRACT_OBJECT_TABLE, 16);
  // BUG: dropped `m.mem16[ALIEN_SHOT4_COLUMN_CURSOR] = m.mem16[ALIEN_SHOT_COLUMN_CURSOR];`
}

test("TEETH: a twin that skips the column-stow store diverges in RAM", () => {
  const o = craft(), c = craft();
  oracle(o); alienShotSlot4Handler_droppedStow(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a dropped column-stow store");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, alienShotSlot4Handler, TARGET, craft());
  assert.equal(r.placeable, true, `alienShotSlot4Handler must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
