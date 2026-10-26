// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchIntroCutsceneStep (ROM 0x0A76) — the opening Kong-climb
 * cutscene's per-frame step dispatcher. The routine is now DISSOLVED: it selects a handler
 * directly by INTRO_STEP (0x6385) — `HANDLERS[step](m)`, step 0 -> setupIntroCutsceneStep …
 * 7 -> runIntroRoarStep (steps 3 and 5 share advanceSequenceStepWhenTimerExpires) — with no
 * ROM jump table, no computed target address, and no `loc_00ca`/`m.overrides` seam. The
 * retired table-math / stub-sweep / 8-bit-wrap TEETH tests are inexpressible against this
 * form and are gone.
 *
 * loc_0a76 is NOT reached in plain attract (verified: 0 dispatches over 2000 attract frames);
 * it fires only once a game is credited and started, while the opening cutscene plays. It is
 * not a leaf — it dispatches a step handler that writes memory and drives the cutscene. So it
 * is validated by MEMORY-equivalence against the frozen oracle: RAM − the stack scratch below the entry SP, never SP,
 * never pc, never the full register file, never cycles. The dissolved form deliberately does
 * not seat a guest-stack return, so SP/pc legitimately differ from the oracle and are outside
 * the compare. Two arms:
 *
 *   1. REALISM (captured driven dispatches) — drive a coin+start into a credited game so the
 *      opening cutscene plays, hook 0x0a76, and clone the machine at each real dispatch. For
 *      each, run the ORACLE on one clone and dispatchIntroCutsceneStep on another and prove
 *      RAM(−stack) identical — the FULL oracle step handler runs on BOTH sides, so a wrong
 *      handler mapping or a dropped write surfaces as divergent RAM. The run naturally reaches
 *      all 8 cutscene steps (0..7).
 *
 *   2. MAPPING TOOTH — a broken twin whose HANDLERS array has two slots swapped (steps 1 and
 *      2 — the climb vs. the climb-animation handlers). The REALISM cross-check must CATCH it:
 *      RAM diverges on at least one real captured step. This pins the HANDLERS ordering; a
 *      wrong slot mapping would be caught here.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0a76.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a76 as oracle } from "../../translated/loc_0a76.js";
import { dispatchIntroCutsceneStep } from "../dispatchIntroCutsceneStep.js";
import { setupIntroCutsceneStep } from "../setupIntroCutsceneStep.js";
import { runIntroClimbStep } from "../runIntroClimbStep.js";
import { animateIntroClimbStep } from "../animateIntroClimbStep.js";
import { advanceSequenceStepWhenTimerExpires } from "../advanceSequenceStepWhenTimerExpires.js";
import { loc_0b06 } from "../loc_0b06.js";
import { loc_0b68 } from "../loc_0b68.js";
import { runIntroRoarStep } from "../runIntroRoarStep.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0a76;
const INTRO_STEP = 0x6385;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// A coin+start tape (as in the 0x06fe dispatcher test): coin on IN2 bit7 at frame 10, start1
// on IN2 bit2 at frame 30. This credits + starts a game so GAME_STATE reaches 3, the opening
// cutscene plays, and loc_0a76 dispatches per frame while it runs.
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

/**
 * Drive a coin+start game and clone the machine at each real 0x0a76 dispatch, keeping up to
 * `perStep` clones per distinct INTRO_STEP value (so one dominant step cannot crowd out the
 * variety). The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Capturing is gated off after the host run so the isolated replays below (whose
 * handlers dispatch further steps) cannot pollute it.
 */
function captureDrivenDispatches(perStep, maxFrames) {
  const caps = [];
  const perCount = new Map();
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing) {
      const s = mm.mem.read8(INTRO_STEP);
      const c = perCount.get(s) || 0;
      if (c < perStep) { perCount.set(s, c + 1); caps.push(mm.clone()); }
    }
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// -- 1. REALISM (captured driven dispatches) ----------------------------------

test("REALISM: real captured cutscene 0x0a76 dispatches — RAM(−stack) matches oracle", () => {
  const caps = captureDrivenDispatches(6, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x0a76 dispatch during the opening cutscene");

  const seen = new Set();
  let compared = 0;
  for (const cap of caps) {
    seen.add(cap.mem.read8(INTRO_STEP));
    const a = cap.clone(); // oracle
    const b = cap.clone(); // candidate
    oracle(a);
    dispatchIntroCutsceneStep(b);

    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), cap.regs.sp);
    assert.equal(
      ramDiff,
      null,
      ramDiff && `RAM diverged at ${hx(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b} ` +
        `(INTRO_STEP ${hx(cap.mem.read8(INTRO_STEP))})`,
    );
    compared++;
  }
  assert.ok(seen.size >= 5, `expected several distinct cutscene steps, saw ${seen.size}`);
  console.log(
    `  REALISM: ${compared} real dispatches over ${seen.size} distinct steps ` +
      `{${[...seen].sort((x, y) => x - y).map(hx).join(", ")}} — RAM(−stack) identical to the oracle`,
  );
});

// -- 2. MAPPING TOOTH ---------------------------------------------------------

// Broken twin: the correct HANDLERS array with steps 1 and 2 swapped (runIntroClimbStep and
// animateIntroClimbStep). A wrong slot ordering. The REALISM cross-check must catch it on the
// real captured steps.
function brokenSwappedDispatch(m) {
  const WRONG = [
    setupIntroCutsceneStep,
    animateIntroClimbStep, // step 1 <- step 2's handler (SWAPPED)
    runIntroClimbStep, // step 2 <- step 1's handler (SWAPPED)
    advanceSequenceStepWhenTimerExpires,
    loc_0b06,
    advanceSequenceStepWhenTimerExpires,
    loc_0b68,
    runIntroRoarStep,
  ];
  const handler = WRONG[m.mem8[INTRO_STEP]];
  return handler(m);
}

test("MAPPING TOOTH: the swapped-slot twin is CAUGHT by the realism cross-check", () => {
  const caps = captureDrivenDispatches(6, 1500);
  assert.ok(caps.length >= 1, "expected a real 0x0a76 dispatch to test the mapping against");

  let caught = 0;
  let example = null;
  const seen = new Set();
  for (const cap of caps) {
    const s = cap.mem.read8(INTRO_STEP);
    seen.add(s);
    const a = cap.clone(); // oracle (correct mapping)
    const b = cap.clone(); // broken twin (swapped mapping)
    oracle(a);
    brokenSwappedDispatch(b);
    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), cap.regs.sp);
    if (ramDiff) { caught++; if (!example) example = { step: s, ramDiff }; }
  }
  assert.ok(caught >= 1, "the realism cross-check FAILED to catch the swapped-slot twin — the mapping is untested");
  console.log(
    `  MAPPING TOOTH: caught the swapped-slot twin on ${caught} of ${caps.length} real dispatches ` +
      `(steps seen {${[...seen].sort((x, y) => x - y).map(hx).join(", ")}}); e.g. step ${hx(example.step)} ` +
      `diverges at ${hx(example.ramDiff.addr)} (oracle=${example.ramDiff.a} broken=${example.ramDiff.b})`,
  );
});
