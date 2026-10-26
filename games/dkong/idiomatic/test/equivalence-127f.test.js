// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchDeathAnimationPhase (ROM 0x127F), now DISSOLVED to a direct
 * `HANDLERS[m.mem8[DEATH_ANIM_PHASE]](m)` (phase 0 -> beginMarioDeathAnimation, 1 ->
 * stepMarioDeathAnimation, 2 -> loc_12de) — no ROM jump table, no computed target, no
 * loc_00ca/m.call/m.overrides seam (the retired table-math/stub-sweep/wrap TEETH are gone).
 * Validated by MEMORY-equivalence vs the frozen oracle loc_127f: RAM − the stack scratch below the entry SP, never
 * SP/pc/registers/cycles (the dissolved form does not seat a guest return, so SP/pc differ).
 * Two arms:
 *   1. FULL-HANDLER — on a real attract base, poke DEATH_ANIM_PHASE (0x639D) to each reachable
 *      index 0/1/2 with the 0x6009 tick gate open, run the oracle on one clone and the candidate
 *      on another; the full arm handler runs both sides, so a wrong mapping or a dropped
 *      register/flag handoff surfaces as divergent RAM. Non-vacuous: each arm mutates RAM.
 *   2. MAPPING TOOTH — a twin with phases 0 and 1 swapped must be CAUGHT (RAM diverges on ≥1
 *      reachable phase), pinning the HANDLERS ordering.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_127f as oracle } from "../../translated/loc_127f.js";
import { dispatchDeathAnimationPhase } from "../dispatchDeathAnimationPhase.js";
import { beginMarioDeathAnimation } from "../beginMarioDeathAnimation.js";
import { stepMarioDeathAnimation } from "../stepMarioDeathAnimation.js";
import { loc_12de } from "../loc_12de.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, DEATH_ANIM_PHASE, SUBSTATE_TIMER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

// DEATH_ANIM_PHASE (0x639D, the phase selector) and SUBSTATE_TIMER (0x6009, the rst-0x18
// tick gate; = 1 makes the next tick expire) come from names.js — the single source of truth.
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First differing RAM byte between two dumps, EXCLUDING the dead stack-scratch region
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns { addr, a, b } or null.
function firstRamDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM (the sprite
// record 0x694D/0x694E, the player index 0x600E, the object scratch the arms touch) holds
// realistic values. dispatchDeathAnimationPhase is never dispatched here — we craft its entry
// by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted dispatch entry onto a clone: a deep stack with a plausible caller return
// (so the oracle arm's terminal `ret` has a sane target), the phase, and an open tick gate.
function craftEntry(base, phase, gateOpen = true) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e);              // caller return, exactly as boot.test.js frames it
  m.mem.write8(DEATH_ANIM_PHASE, phase);
  if (gateOpen) m.mem.write8(SUBSTATE_TIMER, 0x01); // rst 0x18 will decrement 1 -> 0 and run the body
  return m;
}

// -- 1. FULL-HANDLER (crafted reachable arms) ---------------------------------

test("FULL-HANDLER: dispatchDeathAnimationPhase == oracle on real bases poked to each reachable phase (0,1,2)", () => {
  const base = attractBase();
  const REACHABLE = [0x00, 0x01, 0x02];

  let mutatedAny = false;
  for (const phase of REACHABLE) {
    const a = craftEntry(base, phase); // oracle
    const aFloor = a.regs.sp;
    const b = craftEntry(base, phase); // candidate
    const before = a.dumpState();

    oracle(a);
    dispatchDeathAnimationPhase(b);

    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), aFloor);
    assert.equal(
      ramDiff,
      null,
      ramDiff && `RAM diverged at ${hx(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b} ` +
        `(phase ${hx(phase)})`,
    );

    // Non-vacuous: the arm body actually ran and wrote RAM (else the replay proves nothing).
    if (firstRamDiffExStack(before, a.dumpState(), (o) => a.stateOffsetToAddr(o), aFloor)) mutatedAny = true;
  }
  assert.ok(mutatedAny, "no reachable arm mutated RAM — the gate was never open, replay is vacuous");
  console.log(`  FULL-HANDLER: phases {0x00,0x01,0x02} — full oracle arm run both sides, RAM(−stack) identical`);
});

// -- 2. MAPPING TOOTH ---------------------------------------------------------

// Broken twin: the correct HANDLERS array with phases 0 and 1 swapped
// (beginMarioDeathAnimation <-> stepMarioDeathAnimation). A wrong slot ordering. The
// FULL-HANDLER cross-check must catch it on at least one real reachable phase.
function brokenSwappedDispatch(m) {
  const WRONG = [
    stepMarioDeathAnimation, // phase 0 <- phase 1's handler (SWAPPED)
    beginMarioDeathAnimation, // phase 1 <- phase 0's handler (SWAPPED)
    loc_12de,
  ];
  const handler = WRONG[m.mem8[DEATH_ANIM_PHASE]];
  return handler(m);
}

test("MAPPING TOOTH: the swapped-handler twin is CAUGHT by the full-handler cross-check", () => {
  const base = attractBase();
  const REACHABLE = [0x00, 0x01, 0x02];

  let caught = 0;
  let example = null;
  for (const phase of REACHABLE) {
    const a = craftEntry(base, phase); // oracle (correct mapping)
    const aFloor = a.regs.sp;
    const b = craftEntry(base, phase); // broken twin (swapped mapping)
    oracle(a);
    brokenSwappedDispatch(b);
    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), aFloor);
    if (ramDiff) { caught++; if (!example) example = { phase, ramDiff }; }
  }
  assert.ok(caught >= 1, "the full-handler cross-check FAILED to catch the swapped-handler twin — the mapping is untested");
  console.log(
    `  MAPPING TOOTH: caught the swapped-handler twin on ${caught} of ${REACHABLE.length} reachable phases; ` +
      `e.g. phase ${hx(example.phase)} diverges at ${hx(example.ramDiff.addr)} ` +
      `(oracle=${example.ramDiff.a} broken=${example.ramDiff.b})`,
  );
});
