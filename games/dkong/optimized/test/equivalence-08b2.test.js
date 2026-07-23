// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_08b2 (game state 2 / GAMEPLAY entry: a
 * two-instruction TAIL DISPATCH on the sub-state byte 0x600A through the 2-entry
 * rst-0x28 jump table at ROM 0x08B6). Like handler_01c3 it is an NMI-path
 * dispatch target (reached via dispatchGameState), and it is a third data point
 * on the cycle-collapse rule.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_08b2 (optimized/loc_08b2.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchGameState's override consult (nmi.js), inert when
 *      the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. State 2
 *      is NEVER reached in attract (verified: 0 dispatches over 12000 attract
 *      frames); it needs a coin. So both gates inject a COIN pulse via a custom
 *      Inputs (IN2 bit 7 on reads [6,12)) supplied through a per-construction
 *      `inputs` getter -- fresh instance per machine, so each side's frame-input
 *      timing is identical. With the coin, 0x08b2 dispatches ~33x in 40 frames:
 *      once at sub-state 0 (frame 9), then sub-state 1 for the rest.
 *
 *   3. BRANCH COVERAGE -- the routine's observable output depends on the selector
 *      A (0x600A): A==0 dispatches table[0] (loc_08ba), A==1 dispatches table[1]
 *      (loc_08f8). loc_08b2 itself is straight-line (no internal branch), but each
 *      selector value routes sub_0028 to a different arm, so each is proven EQUAL:
 *      A==0 by the natural unit entry; A==1 by a SYNTHESISED entry (capture the
 *      first real sub-state-1 dispatch, clone, diff translated vs optimized RAM +
 *      regs + pc). A>=2 is unreachable -- the 2-entry table has no such slot and
 *      state 2 never writes 0x600A>=2 -- so it is exempt (like a NotImplemented arm).
 *
 *   4. TEETH -- a deliberately-broken twin (the first video-RAM fill store on the
 *      sub-state-0 path lands the wrong value) must be CAUGHT: NOT-EQUAL, naming
 *      the diverging VRAM address 0x7404.
 *
 *   5. (implicit) the cycle-collapse finding, below.
 *
 * THE RUNG-3 FINDING this routine adds: loc_08b2 is ATOMIC. It runs INSIDE the
 * vblank NMI (dispatchGameState is reached from entry_0066, which clears the NMI
 * mask 0x7D84 on entry), so no nested NMI can fire while it executes. Collapsing
 * its two prologue m.step charges (ld a = 13, rst = 11) to one per-branch TOTAL
 * (24) stays EQUAL whole-machine AND unit. But the total is still load-bearing:
 * STRIPPING the charge entirely diverges at STACK 0x6BF8 (frame 10, 49 vs 187),
 * and a WRONG total (23) diverges at 0x6BEE (frame 14) -- the same shape as
 * entry_0611. A cheaper NMI shifts where a later frame's NMI lands and thus the
 * PC it pushes into the diffed stack RAM; preserving the 24 keeps that landing
 * identical. So a routine's TOTAL cost is observable (here via the downstream
 * NMI landing, like 0611; via the spin count for 05c6); only its DISTRIBUTION
 * is free.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08b2 as translated_08b2 } from "../../translated/state0.js";
import { loc_08b2 as optimized_08b2 } from "../loc_08b2.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { Machine } from "../../machine.js";
import { Inputs, IN2_COIN1 } from "../../../../boards/dkong/io.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x08b2;
const FRAMES = 40; // 0x08b2 dispatches ~33x in this window (sub-state 0 then 1)

// State 2 (GAMEPLAY) is never reached in attract, so drive a COIN. This custom
// Inputs asserts IN2 bit 7 (IN2_COIN1) on in2 reads [6,12) -- a coin pulse in
// stable attract -- and idle otherwise. Reads are deterministic within a run, so
// two runs of identical code see an identical coin, and the game reaches state 2.
class CoinInputs extends Inputs {
  constructor() {
    super();
    this.n = 0;
  }
  in2() {
    const k = this.n++;
    return (super.in2() | (k >= 6 && k < 12 ? IN2_COIN1 : 0)) & 0xff;
  }
}

// A per-construction getter: the harness builds baseline and optimized machines
// from THIS assets object; the getter hands each a FRESH CoinInputs (counter at
// 0), so the coin lands on the same frame on every side -- the "identical both
// sides" the gate requires. (The unit gate runs its host to completion before
// cloning, by which point the shared counter is well past the [6,12) window, so
// the clones read idle IN2 identically -- the isolated routine reads no coin.)
const assets = { get inputs() { return new CoinInputs(); } };

// The first video-RAM fill store on the sub-state-0 arm (loc_08ba -> sub_0874).
// Written ONCE and not rewritten by the rest of the invocation, and it lands in
// the compared state dump (video RAM 0x7400-0x77FF) -- so corrupting it persists
// as a clean state diff (control flow is untouched, unlike the stack writes that
// precede it). The sub-state-0 arm is the one the natural first entry takes.
const BROKEN_ADDR = 0x7404;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x7404 lands a wrong value (correct byte XOR 0xFF). Intercepting
 * exactly that one write lets the dispatch and every subroutine run verbatim --
 * the representative "wrong value to one of the invocation's own output
 * addresses" bug the gate must catch.
 */
function broken_08b2(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_08b2(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Capture the pristine entry state the first time 0x08b2 dispatches with
 * GAME_SUBSTATE (0x600A) == wantSub, driving a coin. Used to SYNTHESISE a
 * per-branch entry the natural unit gate (which grabs the very first entry,
 * sub-state 0) does not localise on its own.
 */
function captureEntry(wantSub, maxFrames = FRAMES) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null && mm.mem.read8(0x600a) === wantSub) entry = mm.clone();
    return translated_08b2(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot, inputs: new CoinInputs() });
  host.runFrames(maxFrames);
  return entry;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_08b2 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, assets, FRAMES, new Map([[TARGET, optimized_08b2]]));

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

test("EQUAL (unit): idiomatic optimized loc_08b2 matches translated in RAM + registers", () => {
  // The natural first entry is sub-state 0 -> table[0] (loc_08ba): the A==0 branch.
  const r = unitEquivalence(ROM, assets, TARGET, translated_08b2, optimized_08b2, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit (A==0 branch): RAM + all registers (incl. F) + pc identical");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH (unit, synthesised): A==1 dispatches table[1] (loc_08f8) EQUAL", () => {
  // The natural unit entry is A==0; capture a real A==1 entry and prove that
  // selector routes identically. loc_08b2 has no internal branch, so this also
  // confirms the optimized routine reads the live selector (not a hardcoded 0).
  const entry = captureEntry(1);
  assert.ok(entry, "no sub-state-1 (A==1) entry captured within the window");

  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  translated_08b2(a);
  optimized_08b2(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${(ram.addr ?? 0).toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(a.pc, b.pc, "pc must match on the A==1 branch");
  console.log("  BRANCH/unit (A==1 branch): RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong fill store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, assets, FRAMES, new Map([[TARGET, broken_08b2]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong fill store is CAUGHT and names 0x7404", () => {
  const r = unitEquivalence(ROM, assets, TARGET, translated_08b2, broken_08b2, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
