// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_12de (0x639D dispatch arm 2: advance
 * GAME_SUBSTATE and re-arm the substate gate). Like its sibling loc_12ac it is an
 * NMI game-state dispatch target (dispatchGameState), reached as table[2] of the
 * 0x639D rst-0x28 table (entry_127f @ ROM 0x1283) -- the arm loc_12ac's advance
 * branch bumps the 0x639D state into.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized loc_12de
 *      (optimized/loc_12de.js) reads EQUAL against its translated oracle, every
 *      frame. The override routes through dispatchGameState's override consult
 *      (nmi.js), inert when the map is empty. loc_12de first dispatches at frame
 *      2724 (a gate-skip); its one natural gate-PASS is at frame 2851, so a
 *      2860-frame window exercises branches A and B in the whole-machine run.
 *
 *   2. EQUAL (unit) -- EQUAL in RAM + the whole register file (incl. F) + pc, on
 *      the naturally-captured first entry (frame 2724, the GATE-SKIP branch).
 *
 *   3. TEETH (whole-machine) -- a deliberately-broken twin (the first store on the
 *      routine's path -- sub_0018's dec of SUBSTATE_TIMER 0x6009, reached through
 *      loc_12de's own `rst 0x18` gate -- lands the wrong value) must be CAUGHT:
 *      NOT-EQUAL, naming a diverging address. (0x6009 is control-flow-safe as a
 *      corruption target; corrupting GAME_SUBSTATE 0x600A instead derails a later
 *      frame into an untranslated handler, so the timer is the whole-machine
 *      target and 0x600A is exercised by the unit TEETH below.)
 *
 *   4. TEETH (unit) -- loc_12de's OWN primary output store is broken: on a
 *      synthesised gate-PASS entry (SUBSTATE_TIMER poked to expire) the first
 *      write to GAME_SUBSTATE (0x600A) -- the routine's own `inc (hl)`, not a
 *      callee's -- lands the wrong value, and the gate must catch it and name
 *      0x600A.
 *
 *   5. FULL BRANCH COVERAGE -- loc_12de's three data-dependent branches each
 *      proven EQUAL on a synthesised entry (RAM + registers + pc), AND -- because
 *      the tail cycles are COLLAPSED to one charge per branch -- each branch's
 *      CYCLE TOTAL is asserted equal to the oracle's, so a wrong collapsed total
 *      has teeth even for the arm the whole-machine run does not reach:
 *        A  gate-skip        (SUBSTATE_TIMER != 1)            -> early return, no writes
 *        B  advance player 1 (== 1, 0x600E == 0)              -> one inc of GAME_SUBSTATE
 *        C  advance player 2 (== 1, 0x600E != 0)              -> two incs (the extra inc)
 *      Branch C (a 2-player game) never occurs on the natural run, so it is
 *      reached only by synthesis here.
 *
 * THE CYCLE FINDING this routine shares with loc_12ac: loc_12de is ATOMIC and its
 * per-branch tail total is COLLAPSED onto the ret (player 1 = 74, player 2 = 85).
 * It runs inside the NMI handler, where the hardware NMI mask is cleared (no
 * nested NMI) and -- with NMI_CYCLE_IN_FRAME=0 -- ~50688 cycles from the next
 * frame boundary (no mid-routine state capture), so its internal cycle
 * DISTRIBUTION is unobservable. Neither callee (sub_0018, entry_30db) re-enables
 * the mask. The TOTAL is still load-bearing (the NMI handler's cost sets the
 * main-loop spin count that seeds the PRNG, README §2); preserving each branch's
 * total keeps the whole-machine trace identical, which tests 1 and 5 both prove.
 * The two CALL instructions keep their own charge before the m.call (rst 0x18 =
 * 11t, call 0x30db = 17t).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_12de as translated_12de } from "../../translated/state0.js";
import { loc_12de as optimized_12de } from "../loc_12de.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { Machine } from "../../machine.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x12de;
// loc_12de first dispatches at frame 2724 (gate-skip); its one natural gate-pass
// is at frame 2851 -- so a 2860-frame window exercises branches A and B naturally.
const FRAMES = 2860;
const MAXFRAMES_UNIT = 2730; // enough to reach the first (frame-2724) entry

// RAM bytes that steer the branches when synthesising entries.
const SUBSTATE_TIMER = 0x6009; // the rst-0x18 gate counter
const GAME_SUBSTATE = 0x600a; // the routine's primary output (advanced by inc (hl))
const PLAYER_IDX = 0x600e; // 0 = 1-player (one inc), != 0 = 2-player (two incs)

/**
 * Deliberately-broken twin factory: behaviourally the optimized handler EXCEPT
 * the first store to `addr` lands a wrong value (the correct byte XOR 0xFF,
 * guaranteed to differ). Intercepting exactly that one write lets the rest of the
 * routine and every subroutine it calls run verbatim -- the representative "wrong
 * value to one of the routine's own output addresses" bug the gate must catch.
 */
function makeBroken(addr) {
  return function broken(m) {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (a, value, busOffset) => {
      if (!broke && a === addr) {
        broke = true;
        return realWrite(a, value ^ 0xff, busOffset);
      }
      return realWrite(a, value, busOffset);
    };
    try {
      return optimized_12de(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

const brokenTimer = makeBroken(SUBSTATE_TIMER); // whole-machine TEETH (control-flow-safe)
const brokenSubstate = makeBroken(GAME_SUBSTATE); // unit TEETH: the routine's own output

// -- shared entry snapshot for the synthesised branch tests --------------------
// Capture the machine at the instant loc_12de is first entered, ONCE, and clone
// it per branch. (The unit harness does the same internally for tests 2 and 4.)
let ENTRY = null;
function capturedEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_12de(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(MAXFRAMES_UNIT);
  assert.ok(entry !== null, "loc_12de never entered — cannot synthesise branches");
  ENTRY = entry;
  return ENTRY;
}

/**
 * Run oracle and optimized from an identical synthesised entry (SUBSTATE_TIMER and
 * the player index poked to force a branch), and return the RAM/reg/pc diffs plus
 * each side's cycle delta across the routine.
 */
function runBranch(timer, player) {
  const base = capturedEntry();
  const a = base.clone();
  a.mem.write8(SUBSTATE_TIMER, timer);
  a.mem.write8(PLAYER_IDX, player);
  const b = base.clone();
  b.mem.write8(SUBSTATE_TIMER, timer);
  b.mem.write8(PLAYER_IDX, player);

  const ca0 = a.cycles;
  const cb0 = b.cycles;
  translated_12de(a);
  optimized_12de(b);

  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pcEqual: a.pc === b.pc,
    cyclesOracle: a.cycles - ca0,
    cyclesOptimized: b.cycles - cb0,
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_12de matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_12de]]));

  // The override must actually have run, or EQUAL would be vacuous.
  assert.ok(
    r.invocations.get(TARGET) >= 1,
    `override at 0x${TARGET.toString(16)} never dispatched (invocations=${r.invocations.get(TARGET)})`,
  );
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, FRAMES);
  console.log(
    `  EQUAL/whole: ${r.framesCompared} frames identical, ` +
      `override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_12de matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_12de, optimized_12de, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry = gate-skip branch)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, brokenTimer]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong GAME_SUBSTATE store is CAUGHT and names 0x600A", () => {
  // The natural first entry is the gate-skip branch (no body write to 0x600A), so
  // this synthesises a gate-PASS entry -- the branch loc_12de's own inc of
  // GAME_SUBSTATE lives on -- and breaks that store.
  const base = capturedEntry();
  const a = base.clone();
  a.mem.write8(SUBSTATE_TIMER, 1);
  a.mem.write8(PLAYER_IDX, 0);
  const b = base.clone();
  b.mem.write8(SUBSTATE_TIMER, 1);
  b.mem.write8(PLAYER_IDX, 0);

  translated_12de(a);
  brokenSubstate(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.ok(ram != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(
    ram.addr,
    GAME_SUBSTATE,
    `expected first diff at the broken address 0x${GAME_SUBSTATE.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (RAM + regs + pc + collapsed cycle total) ------------

test("BRANCH A (gate-skip): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(8, 0); // SUBSTATE_TIMER != 1 -> rst 0x18 skips, early return
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch A cycle total must equal the oracle's");
  console.log(`  BRANCH A: EQUAL, cycles ${r.cyclesOptimized} (== oracle)`);
});

test("BRANCH B (advance, player 1): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(1, 0); // gate passes, 0x600E == 0 -> one inc of GAME_SUBSTATE
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch B cycle total must equal the oracle's");
  console.log(`  BRANCH B: EQUAL, cycles ${r.cyclesOptimized} (== oracle; collapsed tail total 74)`);
});

test("BRANCH C (advance, player 2): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(1, 1); // gate passes, 0x600E != 0 -> the EXTRA inc (never natural)
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch C cycle total must equal the oracle's");
  console.log(`  BRANCH C: EQUAL, cycles ${r.cyclesOptimized} (== oracle; collapsed tail total 85)`);
});
