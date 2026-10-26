// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for runAttractState (ROM 0x073C) — the attract game-state handler. It
 * writes GAME_SUBSTATE/GAME_STATE and, on the no-credit branch, dispatches a sub-state
 * handler, so it is gated by capture/clone/replay, not an exhaustive-leaf sweep:
 *   1. EQUAL (real captured dispatches) — clone at a strided set of true 0x073C dispatches;
 *      run the oracle on one clone and runAttractState on another; assert RAM(−STACK_SCRATCH)
 *      identical, and that runAttractState (with its directly-called idiomatic sub-state
 *      handler) leaves SP untouched — the oracle's `ret`-set SP/pc are call ABI it drops.
 *   2. EQUAL (crafted) — forces CREDIT and every sub-state 0-7 on one captured entry, RAM-equal
 *      both sides; the CREDIT arm also asserts runAttractState leaves SP/pc unchanged from entry.
 *   3. TEETH — a twin reading the index from GAME_STATE (0x6005) not GAME_SUBSTATE (0x600A) must
 *      be caught by the captured sweep.
 * Known holes: the stride-16 sweep can step over a single-frame divergence (re-run at stride 1
 * for an interchangeability claim); slot 5 is never captured, so its SP is asserted nowhere.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_073c as oracle } from "../../translated/loc_073c.js";
import { runAttractState } from "../runAttractState.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, CREDITS, GAME_STATE, GAME_SUBSTATE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x073c;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch (the tolerated rst-push / ret residue).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Replay one entry state through the oracle and a candidate on independent clones
 * (FRESH per side — the routine and its callees write RAM), and return the diff.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x073C in a real attract run and clone the machine at every `stride`-th true
 * dispatch (up to K). The stride spreads the sample across a full attract loop so it
 * reaches the later sub-states, not just the sub-1 attract-screen wait. Each clone is
 * one real captured entry; the wrapper delegates to the oracle so the host run
 * proceeds to a clean stop.
 */
function captureDispatches(K, maxFrames, stride = 1) {
  const caps = [];
  let n = 0;
  const snapshot = new Map([[TARGET, (mm) => {
    if (n % stride === 0 && caps.length < K) caps.push(mm.clone());
    n++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** One early real entry, to craft the unreached arms from. */
function captureFirst(maxFrames) {
  let first = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (!first) first = mm.clone();
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: snapshot }).runFrames(maxFrames);
  return first;
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): runAttractState == oracle on real attract dispatches (diff confined to stack)", () => {
  const caps = captureDispatches(300, 4000, 16);
  assert.ok(caps.length >= 8, "expected many real 0x073C dispatches across an attract loop");

  const seen = new Set();
  for (const entry of caps) {
    const sub = entry.mem.read8(GAME_SUBSTATE);
    seen.add(sub);

    // All captured dispatches are no-credit (attract inserts no coin).
    assert.equal(entry.mem.read8(CREDITS), 0, "captured attract dispatch must have no credit");

    const { a, b, bad } = replay(entry, runAttractState);
    // RAM(−STACK_SCRATCH) equivalence is the real behavioral guard and is asserted for EVERY
    // sub-state, including the de-seamed death sub-state 4.
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on sub-state ${sub}`,
    );
    // No-credit is a TAIL dispatch to an idiomatic sub-state handler, called as JS: neither
    // runAttractState nor the handler models the oracle's `ret`, so the idiomatic side must leave
    // SP exactly where it found it (the oracle's SP/pc are the call ABI the direct call drops).
    assert.equal(b.regs.sp, entry.regs.sp, `SP must be untouched on the dispatch branch (${hx(entry.regs.sp)} -> ${hx(b.regs.sp)}) on sub-state ${sub}`);

    // The oracle's stack activity must land inside STACK_SCRATCH, so excluding it
    // cannot mask a real diff (its rst push16(0x0748) writes just below entry SP).
    assert.ok(
      entry.regs.sp > STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push target must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
  }
  assert.ok(seen.size >= 4, `captured sweep should span several sub-states, saw ${[...seen].sort((x, y) => x - y).join(",")}`);
  console.log(
    `  EQUAL/captured: ${caps.length} real dispatches over sub-states {${[...seen].sort((x, y) => x - y).join(",")}} — ` +
      "game-visible RAM identical, SP untouched",
  );
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): CREDIT and every sub-state 0-7 forced on a real entry match the oracle", () => {
  const entry = captureFirst(200);
  assert.ok(entry, "need a real entry to craft from");

  // CREDIT: poke a credit; the oracle advances GAME_STATE + resets GAME_SUBSTATE and
  // returns via `ret`, runAttractState via JS return.
  {
    const a = entry.clone(); const b = entry.clone();
    a.mem.write8(CREDITS, 1); b.mem.write8(CREDITS, 1);
    const sp0 = b.regs.sp, pc0 = b.pc;
    oracle(a);
    runAttractState(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(bad, null, bad && `CREDIT: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
    assert.equal(b.mem.read8(GAME_SUBSTATE), 0x00, "CREDIT must reset GAME_SUBSTATE to 0");
    assert.equal(b.mem.read8(GAME_STATE), (entry.mem.read8(GAME_STATE) + 1) & 0xff, "CREDIT must advance GAME_STATE by 1");
    // The credit branch's `ret` is a JS return — no stack modelling.
    assert.equal(b.regs.sp, sp0, "CREDIT: runAttractState must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "CREDIT: runAttractState must leave pc unchanged (no ret modelling)");
    console.log(`  EQUAL/crafted CREDIT: GAME_STATE ${entry.mem.read8(GAME_STATE)} -> ${b.mem.read8(GAME_STATE)}, game-visible RAM identical`);
  }

  // Every sub-state 0-7, forced deterministically (some are rare or unreached in a
  // bounded attract run). The oracle runs its frozen handler, runAttractState the idiomatic
  // one, on the SAME poked state, so game-visible RAM must be identical.
  for (let s = 0; s <= 7; s++) {
    const a = entry.clone(); const b = entry.clone();
    a.mem.write8(GAME_SUBSTATE, s); b.mem.write8(GAME_SUBSTATE, s);
    oracle(a);
    runAttractState(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `sub-state ${s}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
  }
  console.log("  EQUAL/crafted sub-states: 0-7 each match the oracle handler — game-visible RAM identical");
});

// -- 3. TEETH -----------------------------------------------------------------

const ATTRACT_SUBSTATE = [0x0779, 0x0763, 0x123c, 0x1977, 0x127c, 0x07c3, 0x07cb, 0x084b];

/**
 * Broken twin: reads the dispatch index from GAME_STATE (0x6005) instead of
 * GAME_SUBSTATE (0x600A) — a plausible wrong-selector-address bug. It shares the
 * credit branch, so it only diverges on the no-credit dispatch, and only when the real
 * sub-state differs from GAME_STATE (== 1 during attract) — i.e. every captured
 * dispatch that is not sub-state 1 misdispatches. Built to mirror runAttractState so
 * the ONLY difference is the selector address; requires a real sweep to catch.
 */
function brokenRunAttractState(m) {
  const { mem } = m;
  if (mem.read8(CREDITS) !== 0) {
    mem.write8(GAME_SUBSTATE, 0x00);
    mem.write8(GAME_STATE, (mem.read8(GAME_STATE) + 1) & 0xff);
    return;
  }
  const substate = mem.read8(GAME_STATE); // BUG: should read GAME_SUBSTATE (0x600A)
  return m.call(ATTRACT_SUBSTATE[substate]); // via the oracle registry, to stay a fair twin
}

test("TEETH (captured): the wrong-selector twin is CAUGHT by the captured sweep", () => {
  const caps = captureDispatches(300, 4000, 16);
  assert.ok(caps.length >= 8, "need real dispatches to test the teeth against");

  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenRunAttractState);
    if (bad) { caught = { ...bad, sub: entry.mem.read8(GAME_SUBSTATE) }; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a wrong-selector misdispatch — it is worthless");
  console.log(
    `  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b}) on sub-state ${caught.sub}`,
  );
});
