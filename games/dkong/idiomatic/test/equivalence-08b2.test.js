// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchCreditedSubstate (ROM 0x08B2) — the credited-state
 * (GAME_STATE 2) per-frame sub-state dispatcher. The routine is now DISSOLVED: it selects a
 * handler directly by GAME_SUBSTATE (0x600A) — `HANDLERS[substate](m)`, sub-state 0 ->
 * enterCreditScreen, 1 -> commitGameStart — with no ROM jump table, no computed target
 * address, and no `m.call`/`m.overrides` seam. The retired table-math / stub-sweep tests are
 * inexpressible against this form and are gone.
 *
 * loc_08b2 is NOT reached in plain attract (attract holds GAME_STATE 0/1); it fires only once
 * a coin has been accepted and the credited-state setup runs. It is not a leaf — it dispatches
 * a sub-state handler that clears the playfield, sets up 1P/2P and advances the game state. So
 * it is validated by MEMORY-equivalence against the frozen oracle: RAM − the stack scratch below the entry SP, never
 * SP, never pc, never the full register file, never cycles. The dissolved form deliberately
 * does not seat a guest-stack return, so SP/pc legitimately differ from the oracle and are
 * outside the compare. Two arms:
 *
 *   1. REALISM (captured coin dispatches) — drop a coin so GAME_STATE reaches 2, hook 0x08b2,
 *      and clone the machine at each real dispatch. For each, run the ORACLE on one clone and
 *      dispatchCreditedSubstate on another and prove RAM(−stack) identical — the FULL oracle
 *      sub-state handler runs on BOTH sides, so a wrong handler mapping or a dropped write
 *      surfaces as divergent RAM. A coin naturally reaches BOTH sub-states: 0 once (the setup
 *      arm) then 1 for the rest (the idle "wait for start" arm).
 *
 *   2. MAPPING TOOTH — a broken twin that maps the sub-states to the WRONG handlers
 *      (0 -> commitGameStart, 1 -> enterCreditScreen — the swapped order). The REALISM
 *      cross-check must CATCH it: RAM diverges on at least one real captured sub-state. This
 *      pins the HANDLERS array; a wrong ordering would be caught here.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-08b2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08b2 as oracle } from "../../translated/loc_08b2.js";
import { dispatchCreditedSubstate } from "../dispatchCreditedSubstate.js";
import { enterCreditScreen } from "../enterCreditScreen.js";
import { commitGameStart } from "../commitGameStart.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x08b2;
const GAME_SUBSTATE = 0x600a;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// A coin tape: assert IN2 bit7 (coin1) at frame 10 for 6 frames — MAME's coin hold. This
// credits the machine so GAME_STATE reaches 2 and loc_08b2 dispatches per frame. No start
// button, so the credited state persists (sub-state 1 idles waiting for start).
const COIN_TAPE = [{ port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }];

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
 * Drop a coin and clone the machine at each real 0x08b2 dispatch, keeping up to `perSub`
 * clones per distinct GAME_SUBSTATE value (so the dominant idle sub-state 1 cannot crowd out
 * sub-state 0). The wrapper clones the entry state, then runs the oracle so the host game
 * proceeds undisturbed. Capturing is gated off after the host run so the isolated replays
 * below cannot pollute it.
 */
function captureCoinDispatches(perSub, maxFrames) {
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
  host.inputTape = COIN_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// -- 1. REALISM (captured coin dispatches) ------------------------------------

test("REALISM: real captured credited-state 0x08b2 dispatches — RAM(−stack) matches oracle", () => {
  const caps = captureCoinDispatches(6, 300);
  assert.ok(caps.length >= 1, "expected at least one real 0x08b2 dispatch after a coin");

  const seen = new Set();
  let compared = 0;
  for (const cap of caps) {
    seen.add(cap.mem.read8(GAME_SUBSTATE));
    const a = cap.clone(); // oracle
    const b = cap.clone(); // candidate
    oracle(a);
    dispatchCreditedSubstate(b);

    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), cap.regs.sp);
    assert.equal(
      ramDiff,
      null,
      ramDiff && `RAM diverged at ${hx(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b} ` +
        `(sub-state ${hx(cap.mem.read8(GAME_SUBSTATE))})`,
    );
    compared++;
  }
  // The 2-entry handler table has exactly two reachable arms, and a coin exercises both.
  assert.ok(seen.has(0) && seen.has(1), `expected both sub-states 0 and 1, saw {${[...seen].sort().join(", ")}}`);
  console.log(
    `  REALISM: ${compared} real dispatches over sub-states {${[...seen].sort().map(hx).join(", ")}} ` +
      `— RAM(−stack) identical to the oracle`,
  );
});

// -- 2. MAPPING TOOTH ---------------------------------------------------------

// Broken twin: swaps the two handlers (sub-state 0 -> commitGameStart, 1 -> enterCreditScreen).
// A wrong HANDLERS ordering. The REALISM cross-check must catch it on the real sub-states.
function brokenSwappedDispatch(m) {
  const WRONG = [commitGameStart, enterCreditScreen];
  return WRONG[m.mem8[GAME_SUBSTATE]](m);
}

test("MAPPING TOOTH: the swapped-handler twin is CAUGHT by the realism cross-check", () => {
  const caps = captureCoinDispatches(6, 300);
  assert.ok(caps.length >= 1, "expected a real 0x08b2 dispatch to test the mapping against");

  let caught = 0;
  let example = null;
  const seen = new Set();
  for (const cap of caps) {
    const s = cap.mem.read8(GAME_SUBSTATE);
    seen.add(s);
    const a = cap.clone(); // oracle (correct mapping)
    const b = cap.clone(); // broken twin (swapped mapping)
    oracle(a);
    brokenSwappedDispatch(b);
    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), cap.regs.sp);
    if (ramDiff) { caught++; if (!example) example = { sub: s, ramDiff }; }
  }
  assert.ok(caught >= 1, "the realism cross-check FAILED to catch the swapped-handler twin — the mapping is untested");
  console.log(
    `  MAPPING TOOTH: caught the swapped-handler twin on ${caught} of ${caps.length} real dispatches ` +
      `(sub-states seen {${[...seen].sort().map(hx).join(", ")}}); e.g. sub-state ${hx(example.sub)} ` +
      `diverges at ${hx(example.ramDiff.addr)} (oracle=${example.ramDiff.a} broken=${example.ramDiff.b})`,
  );
});
