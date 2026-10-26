// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchInGameSubstate (ROM 0x06FE) — the credited-game
 * (GAME_STATE 3) per-frame sub-state dispatcher: `ld a,(0x600a)` then vector through
 * the 29-entry inline jump table at ROM 0x0702.
 *
 * loc_06fe is NOT reached in plain attract (attract holds GAME_STATE 0); it fires only
 * once a game is credited and started. And it is not a leaf — it dispatches a sub-state
 * handler that writes memory and drives state. So it is validated by MEMORY-equivalence
 * against the frozen oracle (RAM − the stack scratch below the entry SP, pc, SP), never the full register file
 * and never cycles, with a FRESH clone per case:
 *
 *   1. REALISM (captured driven dispatches) — drive a coin+start into a credited game so
 *      GAME_STATE reaches 3, hook 0x06fe, and clone the machine at each real dispatch.
 *      For each, run the ORACLE on one clone and dispatchInGameSubstate on another and
 *      prove RAM(−stack) + pc + SP identical — the FULL oracle sub-state handler runs on
 *      BOTH sides, so a wrong target OR a live register/flag handoff the folded-away
 *      trampoline would have supplied surfaces as divergent memory. Covers the sub-states
 *      the run naturally reaches (the opening-cutscene, how-high, board-setup and
 *      gameplay-entry sub-states).
 *
 *   2. CRAFTED (exhaustive selector sweep) — the table indices the driven run never
 *      reaches. On a real captured in-game state, poke GAME_SUBSTATE to every byte 0..255
 *      identically on both sides and route ANY computed target to an IDENTICAL catch-all
 *      stub (so the handler never runs), then compare the target the dispatcher handed the
 *      stub + SP. This exhaustively pins the `0x0702 + (2*sel & 0xff)` 8-bit-wrap table
 *      math, including the null slots (idx 9, 24–28 -> 0x0000) and the wrap region sel>=0x80.
 *
 *   3. TEETH — a twin that forms the offset as a full 16-bit `2*sel` (skipping the 8-bit
 *      `add a,a` wrap) MUST be caught by the selector sweep at sel >= 0x80.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-06fe.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_06fe as oracle } from "../../translated/loc_06fe.js";
import { dispatchInGameSubstate } from "../dispatchInGameSubstate.js";
import { loc_00ca } from "../../translated/loc_00ca.js";
import { Machine } from "../../machine.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x06fe;
const GAME_SUBSTATE = 0x600a;
const SUBSTATE_TABLE = 0x0702;
const DISPATCH_TABLE_0702 = "the in-game sub-state table";
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// A coin+start tape (as in the optimized in-game tests): coin on IN2 bit7 at frame 10,
// start1 on IN2 bit2 at frame 30. This credits + starts a game so GAME_STATE reaches 3
// and loc_06fe dispatches per frame.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

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

// -- 1. REALISM (captured driven dispatches) ----------------------------------

/**
 * Drive a coin+start game and clone the machine at each real 0x06fe dispatch, keeping up
 * to `perSub` clones per distinct GAME_SUBSTATE value (so one dominant sub-state cannot
 * crowd out the variety). The wrapper clones the entry state, then runs the oracle so the
 * host game proceeds undisturbed. Capturing is gated off after the host run so the
 * isolated replays below (whose handlers dispatch further sub-states) cannot pollute it.
 */
function captureDrivenDispatches(perSub, maxFrames) {
  const caps = [];
  const perCount = new Map();
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing) {
      const s = mm.mem.read8(GAME_SUBSTATE);
      const c = perCount.get(s) || 0;
      if (c < perSub) { perCount.set(s, c + 1); caps.push(mm.clone()); }
    }
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// A catch-all override (duck-typed like the Machine's overrides Map) that runs the FROZEN ORACLE
// handler for whatever sub-state target the dispatcher computed, and records that target. Installed
// IDENTICALLY on the oracle and the candidate so BOTH loc_00ca take the override path (translated
// line 11, idiomatic line 49) and reach the SAME handler by the SAME direct call. The old REALISM ran
// that handler behind idiomatic loc_00ca's `m.call`; the idiomatic layer no longer has that path, so
// the handler is reached through the production override seam instead. Both sides use the identical
// path and handler, so downstream RAM/SP/pc stay a true dispatcher-vs-dispatcher comparison — a wrong
// target or a wrong LIVE-IN handoff still diverges through the handler, exactly as before.
function oracleCatchAll(rec) {
  return {
    has: () => true,
    get: (target) => (mm) => {
      rec.push(target);
      return ORACLE_ROUTINES.get(target)(mm);
    },
  };
}

test("REALISM: real captured in-game 0x06fe dispatches — target + RAM(−stack) + pc + SP match", () => {
  const caps = captureDrivenDispatches(6, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x06fe dispatch during a credited game");

  const seen = new Set();
  let compared = 0;
  for (const cap of caps) {
    seen.add(cap.mem.read8(GAME_SUBSTATE));
    const a = cap.clone(); // oracle
    const b = cap.clone(); // candidate
    const recA = [], recB = [];
    a.overrides = oracleCatchAll(recA);
    b.overrides = oracleCatchAll(recB);
    oracle(a);
    dispatchInGameSubstate(b);

    // The dispatcher's OWN dispatch is rec[0]; later records are nested dispatches the frozen handler
    // makes. Both sides run the identical handler by the identical path, so the WHOLE dispatch
    // sequence must match address-for-address — the computed sub-state target asserted directly.
    assert.ok(recA.length >= 1, "the dispatcher dispatched nothing on the oracle side");
    assert.deepEqual(
      recB.map(hx),
      recA.map(hx),
      `dispatch sequence diverged (sub-state ${hx(cap.mem.read8(GAME_SUBSTATE))})`,
    );

    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), cap.regs.sp);
    assert.equal(
      ramDiff,
      null,
      ramDiff && `RAM diverged at ${hx(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b} ` +
        `(sub-state ${hx(cap.mem.read8(GAME_SUBSTATE))})`,
    );
    assert.equal(b.regs.sp, a.regs.sp, `SP diverged: oracle=${hx(a.regs.sp)} cand=${hx(b.regs.sp)}`);
    assert.equal(b.pc, a.pc, `pc diverged: oracle=${hx(a.pc)} cand=${hx(b.pc)}`);
    compared++;
  }
  assert.ok(seen.size >= 4, `expected several distinct sub-states, saw ${seen.size}`);
  console.log(
    `  REALISM: ${compared} real dispatches over ${seen.size} distinct sub-states ` +
      `{${[...seen].sort((x, y) => x - y).map(hx).join(", ")}} — target+RAM(−stack)+pc+SP identical`,
  );
});

// -- 2. CRAFTED (exhaustive selector sweep) -----------------------------------

// A catch-all override object (duck-typed like the Machine's overrides Map) that routes
// ANY computed target to `stub`, so the dispatched arm never runs and we can read the
// target the dispatcher formed (from the has/get key, since the oracle passes it via HL
// while the candidate passes it as an argument — recording the get() key works for both).
function stubOverrides(rec) {
  const SENTINEL = 0x5a;
  return {
    has: () => true,
    get: (target) => (mm) => { rec.push({ target, sp: mm.regs.sp }); return SENTINEL; },
  };
}

// A base in-game state to poke selectors onto (a real captured 0x06fe entry).
function craftedBase() {
  const caps = captureDrivenDispatches(1, 400);
  assert.ok(caps.length >= 1, "expected a real in-game 0x06fe state to craft from");
  return caps[0];
}

// Run oracle and candidate on identically-poked clones for one selector; return the
// { target, sp } each handed the stub.
function runCraftedSelector(base, candidate, sel) {
  const mA = base.clone();
  const mB = base.clone();
  mA.mem.write8(GAME_SUBSTATE, sel);
  mB.mem.write8(GAME_SUBSTATE, sel);
  const recA = [], recB = [];
  mA.overrides = stubOverrides(recA);
  mB.overrides = stubOverrides(recB);
  oracle(mA);
  candidate(mB);
  return { recA, recB };
}

test("CRAFTED: dispatchInGameSubstate == oracle over all 256 selectors (0x0702 table)", () => {
  const base = craftedBase();
  let count = 0;
  let mismatch = null;
  for (let sel = 0; sel < 256 && !mismatch; sel++) {
    const { recA, recB } = runCraftedSelector(base, dispatchInGameSubstate, sel);
    count++;
    if (recA.length !== 1 || recB.length !== 1) {
      mismatch = { sel, why: `dispatch fired ${recA.length}/${recB.length} times (want 1/1)` };
    } else if (recA[0].target !== recB[0].target) {
      mismatch = { sel, why: `target ${hx(recA[0].target)}/${hx(recB[0].target)}` };
    } else if (recA[0].sp !== recB[0].sp) {
      mismatch = { sel, why: `SP ${hx(recA[0].sp)}/${hx(recB[0].sp)}` };
    }
  }
  assert.equal(mismatch, null, mismatch && `mismatch at sel=${hx(mismatch.sel)}: ${mismatch.why}`);
  assert.equal(count, 256, "must have swept all 256 selectors");
  console.log(`  CRAFTED: ${count} selectors — dispatched target + SP identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: forms the table offset as a FULL 16-bit `2*sel` instead of the hardware's
 * 8-bit `add a,a` (`2*sel & 0xff`). It agrees with the oracle for every selector < 0x80
 * and diverges from 0x80 up, so only a sweep across the wrap catches it.
 */
function brokenDispatch(m) {
  const { mem } = m;
  const substate = mem.read8(GAME_SUBSTATE);
  const entry = (SUBSTATE_TABLE + 2 * substate) & 0xffff; // BUG: no 8-bit wrap on the *2
  const target = mem.read8(entry) | (mem.read8((entry + 1) & 0xffff) << 8);
  // Dispatch the (wrong) target through the SAME seam the routine uses, so the catch-all
  // stub sees it.
  loc_00ca(m, target, DISPATCH_TABLE_0702);
}

test("TEETH: the 16-bit-offset twin (no 8-bit wrap) is CAUGHT by the selector sweep", () => {
  const base = craftedBase();
  let caughtAt = null;
  for (let sel = 0; sel < 256 && !caughtAt; sel++) {
    const { recA, recB } = runCraftedSelector(base, brokenDispatch, sel);
    if (recA.length !== 1 || recB.length !== 1 || recA[0].target !== recB[0].target) {
      caughtAt = sel;
    }
  }
  assert.notEqual(caughtAt, null, "the sweep FAILED to catch the missing 8-bit offset wrap — it is worthless");
  console.log(`  TEETH: caught the 16-bit-offset twin at sel=${hx(caughtAt)}`);
});
