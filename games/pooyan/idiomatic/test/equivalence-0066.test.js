// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence for enterVblankService (ROM 0x0066, Pooyan) — the Z80 NMI vector, a bare jump to the vblank
 * service routine runVblankNmiService. The oracle steps + m.call(0x066d); the module delegates directly. Both run a
 * whole NMI frame, so (as in equivalence-066d) each entry is a booted clone captured from the generator engine
 * at one of several attract frames, not a raw power-on one; on each the two produce identical RAM (−stack). The oracle's copy runs the translated routine map, so its 0x066d is the frozen one.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0066.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0066 as oracle } from "../../translated/loc_0066.js";
import { enterVblankService } from "../enterVblankService.js";
import { buildRoutines } from "../../routines.js";
import { Machine, resolveAllIdiomatic } from "../../machine.js";
import { runIdiomaticGame } from "../../../../core/frame-stepped.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";
import manifest from "../../manifest.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const nmiReturnPC = manifest.convergence.idiomatic.nmiReturnPC;
const AT = [90, 400, 1200, 2400];
const SP0 = 0x8fe0;
const RET = 0xfffc;
const inDeadStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

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

test("EQUAL: booted clones — module == oracle in RAM (−stack)", () => {
  assert.equal(SNAPS.length, AT.length, "boot reached every capture frame");
  SNAPS.forEach((snap, i) => {
    const o = forNmi(snap, ORACLE_ROUTINES);
    const c = forNmi(snap);
    oracle(o);
    enterVblankService(c);
    const d = firstStateDiff(o.dumpState(), c.dumpState(), (off) => o.stateOffsetToAddr(off), inDeadStack);
    assert.equal(d, null, d && `frame ${AT[i]}: RAM diff at 0x${(d.addr ?? 0).toString(16)}: oracle=${d.a} module=${d.b}`);
  });
  console.log(`  EQUAL booted clones: NMI-vector delegation at each of ${AT.join(", ")}, RAM identical`);
});
