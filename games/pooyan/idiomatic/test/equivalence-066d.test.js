// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence + SP-tooth for runVblankNmiService (ROM 0x066d, Pooyan) — the vblank NMI service routine,
 * the game's sole per-frame heartbeat. The oracle saves the full register file, does its per-frame work
 * (scroll rebuild, input edge-ring, frame counters, coin/sound service, state dispatch), and restores the
 * file; the generator main loop holds no CPU registers, so the module drops the save/restore and keeps its
 * scratch in JS locals. The rst-28 state dispatch (table 0x06f0) becomes a switch.
 *
 * ENTRY: the NMI runs a whole frame of game logic through the state dispatch, so a raw power-on clone is
 * not a valid entry (uninitialised state dereferences null). We boot the idiomatic engine (with the real
 * overrides) to several attract frames and capture each as an entry, then run the oracle and module NMI on
 * identical copies of it. The oracle's copy is handed the translated routine map, so its callees are frozen.
 *
 * Jobs:
 *   1. EQUAL — on each booted clone, oracle == module in RAM (−stack): the NMI's whole per-frame write-set
 *      (IO latches, input ring, counters, and the dispatched state handler's effects) matches, proving the
 *      dropped register save/restore and the switch-for-rst28 change nothing observable.
 *   2. SP-TOOTH — the module is SP-neutral through the game's withOmittedRet dispatch seam (it does no
 *      stack ops; the seam supplies the ret). Null-mutant coverage for the seam is in sp-seam-tooth.test.js.
 *
 * The heartbeat's full per-state dispatch across boot/attract/play is exercised every frame by tape.test.js.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-066d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_066d as oracle } from "../../translated/loc_066d.js";
import { runVblankNmiService } from "../runVblankNmiService.js";
import { buildRoutines } from "../../routines.js";
import { Machine, resolveAllIdiomatic, withOmittedRet } from "../../machine.js";
import { runIdiomaticGame } from "../../../../core/frame-stepped.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";
import manifest from "../../manifest.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const nmiReturnPC = manifest.convergence.idiomatic.nmiReturnPC;
const AT = [90, 400, 1200, 2400]; // attract frames: at 90 the sprite pairs are still uniform, so a slot swap reads equal
const SP0 = 0x8fe0; //         inside STACK_SCRATCH — the oracle's 12 register pushes land in dead scratch
const RET = 0xfffc; //         a caller-return word seeded at SP0 for the oracle's final ret to pop
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

// Boot the generator engine (real overrides) once through several attract frames; each captured state is an entry.
// The boot machine runs the idiomatic map, so its clones would hand the oracle idiomatic callees.
const ORACLE_ROUTINES = ROM_PRESENT ? buildRoutines() : null;
const SNAPS = [];
if (ROM_PRESENT) {
  const overrides = await resolveAllIdiomatic();
  const boot = new Machine(ROM, { overrides });
  runIdiomaticGame(boot, {
    bootAddr: 0x0000, nmiReturnPC, maxFrames: Math.max(...AT) + 1,
    onFrame: (m, f) => { if (AT.includes(f)) SNAPS.push(m.clone()); },
  });
}
function forNmi(snap, routines = snap.routines) {
  const m = snap.clone(); m.routines = routines; m.regs.sp = SP0; m.mem.write16(SP0, RET); return m;
}
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

test("EQUAL: booted clones — module == oracle in RAM (−stack)", () => {
  assert.equal(SNAPS.length, AT.length, "boot reached every capture frame");
  SNAPS.forEach((snap, i) => {
    const o = forNmi(snap, ORACLE_ROUTINES);
    const c = forNmi(snap);
    oracle(o);
    runVblankNmiService(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `frame ${AT[i]}: RAM diff at 0x${(d.addr ?? 0).toString(16)}: oracle=${d.a} module=${d.b}`);
  });
  console.log(`  EQUAL booted clones: one NMI frame at each of ${AT.join(", ")}, RAM identical`);
});

test("SP-TOOTH: the NMI places SP-neutral through the withOmittedRet seam", () => {
  const { placeable, error } = seamPlaceable(withOmittedRet, runVblankNmiService, 0x066d, forNmi(SNAPS[0]));
  assert.equal(placeable, true, error || "runVblankNmiService must place SP-neutral (no stack ops; seam supplies the ret)");
  console.log("  SP-TOOTH: placeable === true");
});
