// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runLevelIntroPhase1Frame (ROM 0x6e59, Pooyan) — the level-intro phase-1 per-frame body:
 * a fixed run of nine sub-passes (frame-tick + gameplay dispatch tickHudRefresh, phase-1 spawner, joystick
 * sampler, object-update gate, sprite rebuild, bonus tally, speed pick, collision driver, sound-ring
 * drain), all dissolved to direct idiomatic calls; the oracle drives the same siblings. runLevelIntroPhase1Frame is a
 * void driver, so equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The state is seated benign (valid-ROM flags clear, formation off, timers on their decrement arms,
 * HUD_REFRESH_TICK seeded so tickHudRefresh ticks then returns early): the tick is the first observable
 * footprint, the sound-ring head advance the last.
 *
 * Jobs: EQUAL (benign chain matches the oracle in RAM −stack), WRITE-SET (the tick fires first, the
 * sound head advances last), TEETH (a wrong tick is caught by the RAM diff), SP-TOOTH (the driver is
 * seam-placeable, moved 0).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6e59.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6e59 as oracle } from "../../translated/loc_6e59.js";
import { runLevelIntroPhase1Frame } from "../runLevelIntroPhase1Frame.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FRAME_TICK = 0x8f4d; //  0x1583's per-frame counter (inc -> low nibble != 0 -> early return)
const SND_HEAD = 0x8a41; //    SOUND_RING_READ_PTR
const SND_SLOT = 0x8a43; //    SOUND_RING_BUFFER first slot (HIGH_SCORE_TABLE + 0x43)
const SP0 = 0x8ff0; //         inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //  caller-return word at SP0 (the seam completes the omitted ret)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat every sub-pass on a benign arm and give the driver a real caller-return word. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[0x881e] = 0x00; //  TAMPER_FREEZE_FLAG clear
  m.mem8[0x8ef0] = 0x00; //  SIGNATURE_MISMATCH_FLAG clear -> spawner takes its live arm
  m.mem8[0x8806] = 0x00; //  GAME_ACTIVE_FLAG clear -> handlers early-return / sound silent
  m.mem8[0x8821] = 0x00; //  DEMO_SOUNDS_DSW off -> attract sound silent
  m.mem8[0x8f04] = 0x00; //  FORMATION_ENABLE_FLAG off
  m.mem8[0x8f50] = 0x00; //  PLAY_MODE_LATCH neutral
  m.mem8[0x8907] = 0x01; //  ROUND_COUNTER odd -> rope timer path
  m.mem8[0x8f09] = 0x05; //  ROPE_DRAW_STEP_TIMER running
  m.mem8[0x8f30] = 0x00; //  launch state 0
  m.mem8[0x8a82] = 0x01; //  LEAD_ACTOR_STATE 1 -> frame-delay handler
  m.mem8[0x8a91] = 0x05; //  lead frame-delay running
  m.mem8[0x8a87] = 0x00; //  lead aim/rec7 minimal
  for (let i = 0; i < 7; i++) m.mem8[0x89e7 + i] = 0x00; // integrity flag block clear
  m.mem8[FRAME_TICK] = 0x00; // 0x1583: inc -> 1 -> early return
  m.mem8[SND_HEAD] = 0x43; //  sound head at the first slot
  m.mem8[SND_SLOT] = 0x00; //  one queued (silent) entry -> drain frees + advances the head
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------
test("EQUAL: benign nine-pass chain — runLevelIntroPhase1Frame == oracle in RAM (−stack)", () => {
  const o = craft(); oracle(o);
  const c = craft(); runLevelIntroPhase1Frame(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: nine-pass chain identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------
test("WRITE-SET: the chain runs end to end (first tick + last drain)", () => {
  const m = craft(); oracle(m);
  assert.equal(m.mem8[FRAME_TICK], 0x01, "first pass (0x1583) ticked 0x8f4d 0 -> 1");
  assert.equal(m.mem8[SND_HEAD], 0x44, "last pass (sound drain) advanced the ring head 0x43 -> 0x44");
  assert.equal(m.mem8[SND_SLOT], 0xff, "the drained slot was freed");
  console.log("  WRITE-SET: chain executed from the tick through the sound drain");
});

// -- 3. TEETH -----------------------------------------------------------------
test("TEETH: a wrong 0x8f4d tick is CAUGHT by the RAM diff", () => {
  const o = craft(); const c = craft();
  oracle(o); runLevelIntroPhase1Frame(c);
  c.mem8[FRAME_TICK] = (c.mem8[FRAME_TICK] + 1) & 0xff; // corrupt the tick
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tick — it is worthless");
  assert.equal(d.addr, FRAME_TICK, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong tick caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------
test("SP-TOOTH: the driver is seam-placeable (moved 0)", () => {
  const r = seamPlaceable(withOmittedRet, runLevelIntroPhase1Frame, 0x6e59, craft());
  assert.equal(r.placeable, true, `driver must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: runLevelIntroPhase1Frame placeable (moved 0, seam supplies the ret)");
});
