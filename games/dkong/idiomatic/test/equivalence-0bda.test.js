// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for buildHowHighScreen (ROM 0x0BDA) — the credited-game (GAME_STATE 3)
 * sub-state 8 handler that builds the "HOW HIGH CAN YOU GET?" interlude screen and steps
 * the sub-state forward. It is reached via dispatchInGameSubstate off the 0x0702 table[8],
 * only once a game is credited and started — attract never reaches it.
 *
 * It is not a leaf: it silences sound, gates on the frame timer, clears the screen, posts
 * two ring tasks, seeds palette/sound/climb-figure state, steps the height index, and paints
 * a variable number of girder rows. So it is validated by MEMORY-equivalence against the
 * frozen oracle — RAM − the stack scratch below the entry SP — never the full register file, never cycles, with a
 * FRESH clone per case (it writes memory and carries state across rows):
 *
 *   1. REALISM (captured driven dispatch) — drive a coin+start into a credited game so
 *      GAME_STATE reaches 3 and sub-state 8 dispatches, and clone the machine at the real
 *      entry. Run the ORACLE on one clone and buildHowHighScreen on another and prove
 *      RAM(−stack) identical. The four callees (silenceSound, tickSubstateTimer,
 *      clearPlayfieldAndSprites, enqueueTask) run their real idiomatic implementations on
 *      the candidate side and the frozen oracle on the oracle side, so a divergence anywhere
 *      in the routine or its marshalling surfaces as divergent memory. The natural dispatch
 *      is the gate-expired / clamp-keep / step-take / 1-row arm.
 *
 *   2. CRAFTED (branch coverage) — the arms the driven run never reaches, each poked
 *      IDENTICALLY on both sides on a real captured entry: the rst-0x18 gate-SKIP early
 *      return, the clamp-set-5 arm, the height step-skip arm, several row counts, and the
 *      256-row do-while wrap (row count 0). Each is proven EQUAL on RAM(−stack), and the gate
 *      arm additionally asserts SUBSTATE_TIMER shows the branch actually taken (0x04 skipped
 *      vs 0xA0 body-ran) so the coverage is not vacuous.
 *
 *   3. TEETH — a twin whose first store to HOW_HIGH_LAST_SEQ (0x622F) lands the wrong value
 *      MUST be caught: buildHowHighScreen writes 0x622F once and nothing rewrites it, so the
 *      corruption persists as the sole RAM(−stack) divergence.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0bda.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0bda as oracle } from "../../translated/loc_0bda.js";
import { buildHowHighScreen } from "../buildHowHighScreen.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0bda;
const SUBSTATE_TIMER = 0x6009; // gate byte; 0x04 => body skipped, 0xA0 => body re-armed it
const GAME_SUBSTATE = 0x600a;
const HOW_HIGH_INDEX = 0x622e;
const BOARD_SEQ_PTR = 0x622a;
const HOW_HIGH_LAST_SEQ = 0x622f;
const BROKEN_ADDR = HOW_HIGH_LAST_SEQ;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Coin+start tape: coin on IN2 bit7 at frame 10, start1 on IN2 bit2 at frame 30, each a
// 6-frame hold (MAME's coin hold). This credits + starts a game so GAME_STATE reaches 3 and
// the ROM's own sub-state progression dispatches buildHowHighScreen at sub-state 8.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// First differing RAM byte between two dumps, EXCLUDING the dead stack-scratch region — the
// memory-equivalence contract is RAM − the stack scratch below the entry SP (the oracle's push residue lands there
// and is benign; measured 0x6bec–0x6bef at the real dispatch). Returns { addr, a, b } or null.
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
 * Drive a coin+start game and clone the machine at the first real 0x0bda dispatch. The
 * wrapper clones the entry state, then runs the oracle so the host game proceeds undisturbed
 * to a clean stop; capturing is gated off after the run so isolated replays cannot pollute it.
 */
function captureEntry(maxFrames) {
  let entry = null;
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return entry;
}

// -- 1. REALISM (captured driven dispatch) ------------------------------------

test("REALISM: real captured sub-state-8 dispatch — buildHowHighScreen == oracle on RAM(−stack)", () => {
  const entry = captureEntry(900);
  assert.ok(entry, "expected a real 0x0bda dispatch during a credited game");
  assert.equal(entry.mem.read8(GAME_SUBSTATE), 8, "captured entry must be sub-state 8");

  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  buildHowHighScreen(b);

  const d = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), entry.regs.sp);
  assert.equal(
    d,
    null,
    d && `RAM diverged at ${hx(d.addr)}: oracle=${d.a} cand=${d.b}`,
  );
  // The body must have run (gate expired), or "EQUAL" would prove nothing about the paint.
  assert.equal(b.mem.read8(SUBSTATE_TIMER), 0xa0, "natural dispatch should run the body (0x6009 re-armed to 0xA0)");
  console.log("  REALISM: real sub-state-8 dispatch — RAM(−stack) identical, body ran");
});

// -- 2. CRAFTED (branch coverage) ---------------------------------------------

test("CRAFTED: every branch arm reads EQUAL on RAM(−stack), gate arm verified taken", () => {
  const entry = captureEntry(900);
  assert.ok(entry, "expected a real 0x0bda entry to craft from");

  // p pokes the deciding RAM: 0x6009 gate, 0x622E clamp/row-count, 0x622A board-seq low,
  // 0x622F saved copy. Gate runs when 0x6009 dec's to 0.
  const p = (m, six, e, aa, f) => {
    m.mem.write8(SUBSTATE_TIMER, six);
    if (e !== null) m.mem.write8(HOW_HIGH_INDEX, e);
    if (aa !== null) m.mem.write8(BOARD_SEQ_PTR, aa);
    if (f !== null) m.mem.write8(HOW_HIGH_LAST_SEQ, f);
  };
  const cases = [
    // gate NOT expired -> body skipped, early return (0x6009 dec'd 5->4, not re-armed).
    ["gate-skip (early return)", (m) => p(m, 5, null, null, null), true],
    // gate expired (0x6009=1) -> body runs. clamp keep/set5 x step take/skip x rows.
    ["run keep / step-take / 1 row", (m) => p(m, 1, 0, 0x65, 0), false],
    ["run keep / step-take / 2 rows", (m) => p(m, 1, 1, 0x40, 0), false],
    ["run keep / step-skip / 3 rows", (m) => p(m, 1, 3, 0x40, 0x40), false],
    ["run keep / step-skip / 5 rows", (m) => p(m, 1, 5, 0x40, 0x40), false],
    ["run set5 / step-take / 6 rows", (m) => p(m, 1, 8, 0x40, 0), false],
    ["run set5 / step-skip / 5 rows", (m) => p(m, 1, 9, 0x40, 0x40), false],
    // do-while wrap: 0x622E==0 with step-skip -> row count dec's 0->0xFF -> 256 rows painted.
    ["run keep / step-skip / 256-row wrap", (m) => p(m, 1, 0, 0x40, 0x40), false],
  ];
  for (const [label, setup, expectSkipped] of cases) {
    const a = entry.clone(); // oracle
    const b = entry.clone(); // candidate
    setup(a);
    setup(b);
    oracle(a);
    buildHowHighScreen(b);

    const d = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), entry.regs.sp);
    assert.equal(
      d,
      null,
      d && `[${label}] RAM diverged at ${hx(d.addr)}: oracle=${d.a} cand=${d.b}`,
    );
    // The gate arm must actually take the branch we intend, or the coverage is vacuous.
    const subTimer = b.mem.read8(SUBSTATE_TIMER);
    assert.equal(
      subTimer,
      expectSkipped ? 0x04 : 0xa0,
      `[${label}] expected 0x6009=${expectSkipped ? "0x04 (skipped)" : "0xA0 (body ran)"}, got ${hx(subTimer)}`,
    );
    console.log(`  CRAFTED ${label}: EQUAL on RAM(−stack)`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: buildHowHighScreen EXCEPT its first store to HOW_HIGH_LAST_SEQ (0x622F) lands
 * a wrong value (correct XOR 0xFF, guaranteed to differ). Intercepting exactly that one write
 * lets the rest of the routine and every callee run verbatim — the representative "wrong value
 * to one of the routine's own outputs" bug the gate must catch.
 */
function brokenBuild(m) {
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
    return buildHowHighScreen(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

test("TEETH: a wrong HOW_HIGH_LAST_SEQ store is CAUGHT and names 0x622F", () => {
  const entry = captureEntry(900);
  assert.ok(entry, "expected a real 0x0bda entry for the teeth case");

  const a = entry.clone(); // oracle
  const b = entry.clone(); // broken candidate
  oracle(a);
  brokenBuild(b);

  const d = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), entry.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong HOW_HIGH_LAST_SEQ store — it is worthless");
  assert.equal(
    d.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address ${hx(BROKEN_ADDR)}, got ${hx(d.addr)}`,
  );
  console.log(`  TEETH: caught at ${hx(d.addr)} (oracle=${d.a} vs broken=${d.b})`);
});
