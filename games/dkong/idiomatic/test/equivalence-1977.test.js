// SPDX-License-Identifier: GPL-3.0-only
/**
 * runAttractDemoFrame — memory-equivalent to the frozen oracle at ROM 0x1977: the attract demo's
 * per-frame entry, which issues the scripted input and then runs the shared per-frame update
 * cascade at ROM 0x197A.
 * GATE:  real captures + live-wire. EVERY dispatch a 2000-frame attract run produces is replayed
 *        oracle-against-rewrite with no sampling; the rewrite is then wired live for a
 *        1200-frame run whose whole frame trace must match the all-oracle baseline on
 *        RAM − the stack scratch below each frame's live SP. THERE IS NO CRAFTED ARM, and the reason is not an omission: the
 *        routine is branch-free, so it has no unreached arm to craft. Teeth: dropping the
 *        demo-input step, taking it twice, and taking it after the cascade instead of before.
 *
 * The rewrite replaces exactly one thing — the oracle's bracketed `call` to ROM 0x21EE — with a
 * direct JS call to the already-idiomatic advanceAttractDemoInput, and keeps the tail into the
 * still-frozen 0x197A as an m.call. So the whole burden of this gate is that the replaced
 * fragment behaves identically INCLUDING everything the shared cascade does afterwards with the
 * state it left. That cascade is large, so the gate leans on real dispatches and a whole-run
 * live trace rather than on crafted inputs.
 *
 * What actually runs here, and nothing more:
 *
 *   1. REAL CAPTURES — hook 0x1977 in a 2000-frame attract run and, at EVERY dispatch, clone the
 *      entry state twice and run oracle vs rewrite on the two clones before letting the host
 *      proceed on the oracle. No sampling: the test asserts the number replayed equals the
 *      number dispatched. The contract checked is RAM − the stack scratch below the entry SP plus the declared live-out
 *      (memory-only + the returned value). It ALSO checks the full state dump, SP and the whole
 *      register file, which are stronger than the contract and hold here because the shared
 *      0x197A tail rewrites everything the replaced call left; that stronger check is what would
 *      notice the rewrite drifting into a merely-memory-equivalent shape.
 *      Coverage is reported honestly: the number of distinct entry shapes seen, and how many
 *      dispatches took the demo script's advance branch as opposed to holding a step.
 *
 *   2. REACH — the same probe under a coin+start tape that really starts a game. This is what
 *      backs the "attract demo" reading: it could have come out the other way. Every dispatch
 *      seen is at GAME_STATE 1 / GAME_SUBSTATE 3, and the credited tape produces none. WHAT IS
 *      NOT ESTABLISHED is whether GAME_STATE 1 / GAME_SUBSTATE 3 can be entered outside attract
 *      at all — a continue or two-player path, say. Only attract and that one tape were driven.
 *
 *   3. LIVE-WIRE — wire the rewrite live for a 1200-frame run and require the per-frame trace to
 *      equal the all-oracle baseline on RAM − the stack scratch below each frame's live SP. Cycle-free idiomatic code
 *      under-charges the frame, which shifts the NMI and forks the timing-seeded spin counter, so
 *      the harness restores the replaced fragment's cycle cost by measuring it on a throwaway
 *      clone. That restoration is test-only scaffolding: the shipped layer runs frame-stepped and
 *      has no cycle model. The test proves the trace is SENSITIVE by re-running without the
 *      restoration and requiring divergence.
 *
 *   4. TEETH — three deliberately broken twins of the real routine. Two (no demo input, double
 *      demo input) are caught by the unit replay on every single entry. The third — running the
 *      demo input AFTER the cascade instead of before — surfaces on only about 1% of single
 *      dispatches, because a lone frame rarely consumes the input it was handed: the 120-entry
 *      sample used here catches it once, and it is the LIVE trace that catches it outright, at the
 *      demo's very first frame. That split is the reason the live-wire arm exists. (The
 *      no-sampling replay in test 1 does catch it too, several times over its 1416 dispatches —
 *      which is what a fixed-stride sample would have thrown away.)
 *
 * WHY NOT pc: the rewrite models the Z80 `ret` as a JS return, so pc is not part of the contract.
 * SP is compared only because it happens to be preserved exactly (the frozen 0x197A tail performs
 * the same single `ret` on both sides).
 *
 * WHY THE REGISTER LIVE-OUT IS EMPTY, derived as well as measured. The only call site of ROM
 * 0x1977 in the frozen layer is the shared rst-0x28 dispatcher, and the one table carrying that
 * address is the game-state-1 sub-state table at ROM 0x0748, whose dispatch is a tail — it drops
 * the returned value. That table is itself reached as a tail from the NMI game-state dispatch,
 * whose epilogue at ROM 0x00D2 pops AF, BC, DE, HL, IX and IY straight back off the stack. So
 * nothing reads a register or flag the routine leaves, which is why test 1 can compare the whole
 * register file as free teeth rather than as the contract.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1977.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1977 as oracle } from "../../translated/loc_1977.js";
import { runAttractDemoFrame } from "../runAttractDemoFrame.js";
import { advanceAttractDemoInput } from "../advanceAttractDemoInput.js"; // reused to build faithful twins
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import {
  STACK_SCRATCH,
  GAME_STATE,
  GAME_SUBSTATE,
  P1_INPUT,
  DEMO_SCRIPT_INDEX,
  DEMO_SCRIPT_COUNTDOWN,
} from "../names.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const TARGET = 0x1977;
const CASCADE = 0x197a; // the shared per-frame update cascade the oracle falls through into
const DEMO_INPUT = 0x21ee; // the scripted-input step the rewrite replaces with a direct call

const ATTRACT_FRAMES = 2000; // the demo's first dispatch lands around frame 586
const LIVE_FRAMES = 1200;
const GAMEPLAY_FRAMES = 1600;
const TWIN_CAPTURES = 120;

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse the coin input, then start-1,
// so the ROM's own credit/start logic begins a real game.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 },
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 },
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First differing RAM byte outside the dead stack scratch — the memory-equivalence contract. */
function ramDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** First differing entry between two traced runs ({ frames, sp }), outside the stack scratch below each frame's live SP. */
function traceDiff(baseline, live, mapper) {
  const floors = frameFloors(baseline.sp, live.sp);
  for (let f = 0; f < Math.min(baseline.frames.length, live.frames.length); f++) {
    const a = baseline.frames[f];
    const b = live.frames[f];
    const dead = deadStackBelow(STACK_SCRATCH, floors[f]);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      const addr = mapper(i);
      if (dead(addr)) continue;
      return { frame: f, addr, a: a[i], b: b[i] };
    }
  }
  return null;
}

/** First differing CPU register, or null. Stronger than the contract; see the header. */
function regDiff(a, b) {
  for (const k of REG_FIELDS) {
    if (a.regs[k] !== b.regs[k]) return { reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/**
 * Cycle cost of the fragment the rewrite replaced — the `call` instruction plus the scripted-input
 * routine it dispatches — measured on a throwaway clone of this exact machine state, because the
 * cost differs between the script's hold and advance branches. Test-only: the shipped idiomatic
 * layer is cycle-free and runs under the frame-stepped engine.
 */
function replacedFragmentCycles(m) {
  const probe = m.clone();
  const before = probe.cycles;
  probe.push16(CASCADE); // the return address the oracle's `call` pushes
  probe.step(DEMO_INPUT, 17); // the `call` instruction itself
  probe.call(DEMO_INPUT);
  return probe.cycles - before;
}

/** Wrap a candidate so it charges what the oracle charged for the fragment it replaced. */
const cycleRestored = (fn) => (m) => {
  m.tick(replacedFragmentCycles(m));
  return fn(m);
};

// -- 1. REAL CAPTURES ---------------------------------------------------------

test("REAL CAPTURES: every 0x1977 dispatch in a 2000-frame attract run == oracle", () => {
  const shapes = new Map();
  const states = new Set();
  let dispatched = 0;
  let replayed = 0;
  let advanceBranch = 0; // dispatches where the demo script steps to its next pair
  let inputChanges = 0; // dispatches where the oracle left a different cooked control word
  let firstFrame = -1;
  const failures = [];

  const host = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      dispatched++;
      if (firstFrame < 0) firstFrame = mm.frames.length;
      // The entry shape that matters: which script step is selected, and whether this frame holds
      // it or advances to the next one. (The raw countdown is excluded on purpose — it changes
      // every frame, so keying on it would report one "shape" per dispatch and mean nothing.)
      const advances = mm.mem8[DEMO_SCRIPT_COUNTDOWN] === 0;
      const shape = `step ${mm.mem8[DEMO_SCRIPT_INDEX]}, ${advances ? "advance" : "hold"}`;
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
      states.add(`${mm.mem8[GAME_STATE]}/${mm.mem8[GAME_SUBSTATE]}`);
      if (advances) advanceBranch++;

      const before = mm.mem8[P1_INPUT];
      const a = mm.clone();
      const b = mm.clone();
      const oracleReturn = oracle(a);
      const candidateReturn = runAttractDemoFrame(b);
      replayed++;
      if (a.mem8[P1_INPUT] !== before) inputChanges++;

      const ram = ramDiff(a, b, mm.regs.sp);
      const reg = regDiff(a, b);
      const state = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
      if (ram || reg || state || oracleReturn !== candidateReturn) {
        if (failures.length < 5) {
          failures.push(
            `dispatch #${dispatched} [${shape}]: ` +
              (ram ? `RAM ${hx(ram.addr)} ${ram.a}->${ram.b}; ` : "") +
              (state ? `state dump ${hx(state.addr ?? 0)} ${state.a}->${state.b}; ` : "") +
              (reg ? `register ${reg.reg} ${reg.a}->${reg.b}; ` : "") +
              (oracleReturn !== candidateReturn ? `return ${oracleReturn} vs ${candidateReturn}; ` : ""),
          );
        }
      }
      return oracle(mm); // let the host run on the oracle, undisturbed
    }]]),
  });
  host.runFrames(ATTRACT_FRAMES);

  assert.deepEqual(failures, [], failures.join("\n"));
  assert.ok(dispatched >= 1400, `expected the attract demo to dispatch 0x1977 many times, got ${dispatched}`);
  assert.equal(replayed, dispatched, "every dispatch must be replayed — this gate does not sample");
  assert.ok(shapes.size >= 20, `expected many distinct entry shapes, got ${shapes.size}`);
  // The routine header reads this as the attract demo's entry; that rests on the state every
  // dispatch arrives in, so pin it here rather than leaving it as prose.
  assert.deepEqual([...states], ["1/3"], `dispatched from unexpected states: ${[...states].join(" ")}`);
  // Non-vacuity: the replayed fragment must really be doing something on these entries.
  assert.ok(advanceBranch > 0, "no dispatch took the demo script's advance branch — coverage is vacuous");
  assert.ok(inputChanges > 0, "the oracle never changed the cooked control word — the replay is vacuous");

  console.log(
    `  REAL CAPTURES: ${replayed}/${dispatched} dispatches replayed (first at frame ${firstFrame}), ` +
      `all from GAME_STATE/GAME_SUBSTATE ${[...states].join(" ")}, ${shapes.size} distinct entry shapes ` +
      `(script step × hold/advance), ${advanceBranch} on the advance branch, ${inputChanges} that left a ` +
      `changed control word — RAM − the stack scratch below the entry SP, full dump, SP, every register and the return value ` +
      `all == oracle`,
  );
});

// -- 2. REACH -----------------------------------------------------------------

test("REACH: a coin+start tape that reaches gameplay never dispatches 0x1977", () => {
  let attractDispatches = 0;
  const attract = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => { attractDispatches++; return oracle(mm); }]]),
  });
  attract.runFrames(LIVE_FRAMES);

  let gameplayDispatches = 0;
  const played = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => { gameplayDispatches++; return oracle(mm); }]]),
  });
  played.inputTape = COIN_START_TAPE;
  played.runFrames(GAMEPLAY_FRAMES);

  assert.equal(played.mem8[GAME_STATE], 3, "the coin+start tape must actually have started a game");
  assert.ok(attractDispatches > 0, "the attract run must dispatch 0x1977, or this comparison says nothing");
  assert.equal(
    gameplayDispatches, 0,
    `0x1977 was dispatched ${gameplayDispatches}× during play — the routine is not attract-only`,
  );
  console.log(
    `  REACH: ${attractDispatches} dispatches in ${LIVE_FRAMES} attract frames vs ` +
      `${gameplayDispatches} in ${GAMEPLAY_FRAMES} frames of a started game`,
  );
});

// -- 3. LIVE-WIRE -------------------------------------------------------------

let cachedBaseline = null;
const traced = (m) => { const sp = recordFrameSp(m); return { frames: m.runFrames(LIVE_FRAMES), sp }; };
const oracleBaseline = () => (cachedBaseline ??= traced(new Machine(ROM)));
const liveTrace = (fn) => traced(new Machine(ROM, { overrides: new Map([[TARGET, fn]]) }));

test("LIVE-WIRE: the rewrite wired live for 1200 frames reproduces the all-oracle trace", () => {
  const mapper = new Machine(ROM);
  const baseline = oracleBaseline();

  const wired = liveTrace(cycleRestored(runAttractDemoFrame));
  const diff = traceDiff(baseline, wired, (off) => mapper.stateOffsetToAddr(off));
  assert.equal(
    diff, null,
    diff && `live trace diverges at frame ${diff.frame}, ${hx(diff.addr)}: ${diff.a} -> ${diff.b}`,
  );
  assert.equal(wired.frames.length, baseline.frames.length, "the live run must have completed the same number of frames");

  // The trace is only worth anything if it can fail. Dropping the fragment's cycle charge is the
  // known way to make cycle-free code fork a timing-seeded run; it must be caught.
  const uncharged = traceDiff(baseline, liveTrace(runAttractDemoFrame), (off) => mapper.stateOffsetToAddr(off));
  assert.notEqual(uncharged, null, "the live trace FAILED to notice the missing cycle charge — it is blind");

  console.log(
    `  LIVE-WIRE: ${baseline.frames.length} frames identical on RAM − the stack scratch below each frame's live SP with the fragment's ` +
      `cycles restored; without them the same trace forks at frame ${uncharged.frame}, ${hx(uncharged.addr)}`,
  );
});

// -- 4. TEETH -----------------------------------------------------------------

// Faithful re-implementations of the real routine, each with a single switchable defect.
const noDemoInput = (m) => m.call(CASCADE); // BUG: the demo's input is never issued
const doubleDemoInput = (m) => { // BUG: the script is stepped twice per frame
  advanceAttractDemoInput(m);
  advanceAttractDemoInput(m);
  return m.call(CASCADE);
};
const demoInputAfterCascade = (m) => { // BUG: the cascade runs on the previous frame's input
  const r = m.call(CASCADE);
  advanceAttractDemoInput(m);
  return r;
};

/** Capture up to K real entry states from an attract run. */
function captureEntries(k, frames) {
  const caps = [];
  const host = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      if (caps.length < k) caps.push(mm.clone());
      return oracle(mm);
    }]]),
  });
  host.runFrames(frames);
  return caps;
}

/** How many of the captured entries the unit replay catches this candidate on. */
function unitCatches(caps, candidate) {
  let caught = 0;
  let first = null;
  for (const cap of caps) {
    const a = cap.clone();
    const b = cap.clone();
    oracle(a);
    candidate(b);
    const ram = ramDiff(a, b, cap.regs.sp);
    if (ram) {
      caught++;
      if (!first) first = ram;
    }
  }
  return { caught, first };
}

test("TEETH: the unit replay catches a dropped and a doubled demo-input step", () => {
  const caps = captureEntries(TWIN_CAPTURES, LIVE_FRAMES);
  assert.ok(caps.length >= 100, `expected plenty of captured entries, got ${caps.length}`);

  // Sanity: the real routine passes the same replay, so a caught twin is a real signal.
  assert.equal(unitCatches(caps, runAttractDemoFrame).caught, 0, "the correct routine must pass the unit replay");

  const dropped = unitCatches(caps, noDemoInput);
  assert.equal(
    dropped.caught, caps.length,
    "the unit replay FAILED to catch a dropped demo-input step on every entry — it is not pinning the call",
  );
  const doubled = unitCatches(caps, doubleDemoInput);
  assert.equal(
    doubled.caught, caps.length,
    "the unit replay FAILED to catch a doubled demo-input step on every entry — it is not pinning the count",
  );

  console.log(
    `  TEETH/unit: dropped caught ${dropped.caught}/${caps.length} (first at ${hx(dropped.first.addr)}: ` +
      `${dropped.first.a}->${dropped.first.b}); doubled caught ${doubled.caught}/${caps.length} ` +
      `(first at ${hx(doubled.first.addr)}: ${doubled.first.a}->${doubled.first.b})`,
  );
});

test("TEETH: the live trace catches issuing the demo input AFTER the cascade", () => {
  const mapper = new Machine(ROM);
  const caps = captureEntries(TWIN_CAPTURES, LIVE_FRAMES);

  // Stated because it is the reason the live-wire arm exists: a single dispatch almost never
  // consumes the input it was handed, so the unit replay is nearly blind to this ordering defect.
  const unit = unitCatches(caps, demoInputAfterCascade);

  const live = traceDiff(
    oracleBaseline(),
    liveTrace(cycleRestored(demoInputAfterCascade)),
    (off) => mapper.stateOffsetToAddr(off),
  );
  assert.notEqual(
    live, null,
    "the live trace FAILED to catch the demo input being issued after the cascade — ordering is unproven",
  );

  console.log(
    `  TEETH/live: ordering twin caught at frame ${live.frame}, ${hx(live.addr)} (${live.a} -> ${live.b}); ` +
      `the unit replay caught it on only ${unit.caught}/${caps.length} single dispatches`,
  );
});
