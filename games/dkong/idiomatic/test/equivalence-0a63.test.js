// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearScreenAndSelectIntro (ROM 0x0a63) — the credited-game
 * (GAME_STATE 3) board-start sub-state (index 6 of the 0x0702 table) that ticks the
 * rst-0x18 sub-state timer, and on expiry CLEARS the screen (call 0x0874), re-arms
 * SUBSTATE_TIMER (0x6009) to 1, and ADVANCES GAME_SUBSTATE (0x600A) — by 1 to the intro
 * cutscene, or by 2 (skipping the intro to the how-high interlude) when PLAY_INTRO
 * (0x622C) is clear.
 *
 * loc_0a63 is NOT reached in plain attract (headless attract holds GAME_STATE 0); it
 * fires only once a game is credited and started. It reads NO register — its whole
 * behaviour is a function of three memory bytes (SUBSTATE_TIMER, GAME_SUBSTATE,
 * PLAY_INTRO) and it writes only fixed memory (the 0x0874 clear regions + those two
 * counters). So it is validated by MEMORY-equivalence against the frozen oracle on
 * RAM − the stack scratch below the entry SP, with a FRESH clone per case (it writes memory) — never the full
 * register file, never cycles, and NOT SP/PC (the idiomatic layer replaces the rst-0x18
 * caller-skip and the call/ret stack surgery with the JS stack + a boolean, so the
 * oracle's terminal SP is deliberately not reproduced):
 *
 *   1. REALISM (captured driven dispatch) — drive a coin+start game to GAME_STATE 3 so
 *      the board-start sequence reaches sub-state 6, hook 0x0a63, and clone the machine
 *      at each real dispatch (the natural first-game path: timer expired, PLAY_INTRO set
 *      -> advance to the intro). Run oracle vs clearScreenAndSelectIntro on two fresh
 *      clones and confirm identical RAM (ex-stack).
 *
 *   2. CRAFTED (gate x branch x wrap + footprint) — the arms the natural run never
 *      reaches. Because the routine reads no register, one start state per case fully
 *      determines it: poke SUBSTATE_TIMER (expired == 1 vs still-ticking), PLAY_INTRO
 *      (== 0 vs != 0), and GAME_SUBSTATE (INCLUDING the 8-bit wrap edge 0xFF->0x00), and
 *      paint every cell the clear could touch with a SENTINEL — all identically on both
 *      sides. This pins: the timer gate (skip vs run), the intro branch (+1 vs +2), the
 *      wrapping inc, and the exact clear footprint (a stray/missing write shows
 *      sentinel-vs-fill; a wrong advance shows a lone 0x600A diff).
 *
 *   3. TEETH — three deliberately-broken twins the RAM gate MUST catch: (a) an INVERTED
 *      intro branch (extra advance when PLAY_INTRO is SET) — caught at 0x600A; (b) a
 *      MISSING timer gate (body runs even while the timer is still ticking) — caught at
 *      0x600A/0x6009 on a not-yet-expired entry; and (c) a SKIP-CLEAR (advance without
 *      blanking the screen) — caught on a sentinel entry, where a clear region the
 *      oracle filled still holds the sentinel.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0a63.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a63 as oracle } from "../../translated/loc_0a63.js";
import { clearScreenAndSelectIntro } from "../clearScreenAndSelectIntro.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { Machine } from "../../machine.js";
import { SPRITE_BUFFER, SUBSTATE_TIMER, GAME_SUBSTATE, PLAY_INTRO, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0a63;
const SPRITE_BUFFER_BYTES = 0x180;

// A coin+start tape (as in the in-game sibling tests): coin on IN2 bit7 at frame 10,
// start1 on IN2 bit2 at frame 30. This credits + starts a game so GAME_STATE reaches 3
// and the board-start sequence walks through sub-state 6 (loc_0a63).
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);


/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
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

function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * Drive a coin+start game and clone the machine at each real 0x0a63 dispatch (up to K).
 * The wrapper clones the entry state, then runs the ORACLE so the host game proceeds
 * undisturbed to a clean stop. Capturing is gated off after the host run so the
 * isolated replays below cannot pollute it.
 */
function captureDrivenDispatches(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

/**
 * A real captured in-game 0x0a63 entry to derive crafted entries from — it carries a
 * valid mid-NMI SP (deep in the stack region), so the oracle's push/call/ret stay inside
 * STACK_SCRATCH and never touch compared RAM. The routine reads no register, so any such
 * base is a fine seed once its three control bytes are poked.
 */
function craftedBase() {
  const [base] = captureDrivenDispatches(1, 1500);
  assert.ok(base, "expected one real in-game 0x0a63 dispatch to craft from");
  return base;
}

/**
 * Paint every cell the clear could touch — all of video RAM (0x7400-0x77FF) and a
 * guard-banded span around the sprite buffer — with `sentinel`, then poke the three
 * control bytes SUBSTATE_TIMER / GAME_SUBSTATE / PLAY_INTRO. All identical on both sides.
 * The painted regions (>= 0x68F0) never overlap the control bytes (0x60xx), so the inc
 * and the gate are measured cleanly against the fill.
 */
function craftEntry(base, sentinel, timer, substate, intro) {
  const w = base.clone();
  for (let a = 0x7400; a <= 0x77ff; a++) w.mem.write8(a, sentinel);
  for (let a = SPRITE_BUFFER - 0x10; a < SPRITE_BUFFER + SPRITE_BUFFER_BYTES + 0x10; a++) {
    w.mem.write8(a & 0xffff, sentinel);
  }
  w.mem.write8(SUBSTATE_TIMER, timer & 0xff);
  w.mem.write8(GAME_SUBSTATE, substate & 0xff);
  w.mem.write8(PLAY_INTRO, intro & 0xff);
  return w;
}

// -- 1. REALISM (captured driven dispatch) ------------------------------------

test("REALISM: real captured in-game 0x0a63 dispatch — RAM (ex-stack) matches the oracle", () => {
  const caps = captureDrivenDispatches(8, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x0a63 dispatch during a credited game");

  for (const cap of caps) {
    assert.equal(cap.mem.read8(GAME_SUBSTATE), 6, "0x0a63 is table index 6 → GAME_SUBSTATE==6 at entry");
    assert.equal(cap.mem.read8(SUBSTATE_TIMER), 1, "natural entry has the timer about to expire (0x6009==1)");
    const ram = diffAgainstOracle(cap, clearScreenAndSelectIntro);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  REALISM: ${caps.length} real 0x0a63 dispatch(es) — identical RAM (ex-stack)`);
});

// -- 2. CRAFTED (gate x branch x wrap + footprint) ----------------------------

test("CRAFTED: timer-gate x intro-branch x substate-wrap x sentinel all match the oracle", () => {
  const base = craftedBase();

  // Timer: 1 == expired (dec -> 0, body runs); everything else still ticking (skip),
  // incl. 0 (dec -> 0xFF wrap) and 0xFF.
  const TIMERS = [0x01, 0x02, 0x05, 0x00, 0xff];
  // PLAY_INTRO: 0 takes the extra advance; any non-zero holds at +1.
  const INTROS = [0x00, 0x01, 0x80, 0xff];
  // GAME_SUBSTATE incl. the 8-bit wrap edges (0xFF -> 0x00, 0xFE -> +2 wrap).
  const SUBSTATES = [0x06, 0x7f, 0x80, 0xfe, 0xff];
  // Sentinels distinct from the fill bytes (0x10 playfield/columns, 0x00 sprite buf).
  const SENTINELS = [0xee, 0x55];

  let count = 0;
  for (const timer of TIMERS) {
    for (const intro of INTROS) {
      for (const substate of SUBSTATES) {
        for (const sentinel of SENTINELS) {
          const w = craftEntry(base, sentinel, timer, substate, intro);
          const ram = diffAgainstOracle(w, clearScreenAndSelectIntro);
          assert.equal(
            ram,
            null,
            ram &&
              `mismatch (timer ${hx(timer)}, intro ${hx(intro)}, substate ${hx(substate)}, ` +
                `sentinel ${hx(sentinel)}) at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`,
          );
          count++;
        }
      }
    }
  }
  console.log(`  CRAFTED: ${count} gate/branch/wrap/sentinel entries — identical RAM (ex-stack) to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin A: the intro branch is INVERTED — it takes the extra advance when
 *  PLAY_INTRO is SET (!= 0) instead of clear. Wrong sub-state on the intro path. */
function brokenInvertedIntro(m) {
  const { mem } = m;
  if (!tickSubstateTimer(m)) return;
  clearPlayfieldAndSprites(m);
  mem.write8(SUBSTATE_TIMER, 0x01);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  if (mem.read8(PLAY_INTRO) !== 0) { // BUG: should be === 0
    mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  }
}

/** Broken twin B: ticks the timer but IGNORES expiry — the body runs every frame the
 *  sub-state is dispatched, not only when the countdown elapses (missing rst-0x18 gate). */
function brokenNoGate(m) {
  const { mem } = m;
  tickSubstateTimer(m); // BUG: return value ignored — no early-out while still ticking
  clearPlayfieldAndSprites(m);
  mem.write8(SUBSTATE_TIMER, 0x01);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  if (mem.read8(PLAY_INTRO) === 0) {
    mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  }
}

/** Broken twin C: advances the sub-state but SKIPS the clear (screen not blanked). */
function brokenSkipClear(m) {
  const { mem } = m;
  if (!tickSubstateTimer(m)) return;
  // BUG: dropped the clearPlayfieldAndSprites call
  mem.write8(SUBSTATE_TIMER, 0x01);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  if (mem.read8(PLAY_INTRO) === 0) {
    mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  }
}

test("TEETH: inverted-intro, missing-gate, and skip-clear twins are all CAUGHT", () => {
  const base = craftedBase();

  // (a) Inverted intro branch: on the natural intro path (timer expired, PLAY_INTRO
  //     set) the oracle advances 6 -> 7; the twin advances 6 -> 8.
  const eIntro = craftEntry(base, 0xee, 0x01, 0x06, 0x01);
  const dIntro = diffAgainstOracle(eIntro, brokenInvertedIntro);
  assert.notEqual(dIntro, null, "the RAM gate FAILED to catch an inverted intro branch — it is worthless");
  assert.equal(dIntro.addr, GAME_SUBSTATE, "the inverted branch must diverge at GAME_SUBSTATE (0x600A)");
  assert.equal(dIntro.a, 0x07, "oracle advances 6 -> 7 (intro plays)");
  assert.equal(dIntro.b, 0x08, "broken twin wrongly advances 6 -> 8 (skips the intro)");

  // (b) Missing timer gate: on a NOT-yet-expired entry (timer 5) the oracle only ticks
  //     the timer (5 -> 4) and skips the body; the twin runs the body anyway.
  const eGate = craftEntry(base, 0xee, 0x05, 0x06, 0x01);
  const dGate = diffAgainstOracle(eGate, brokenNoGate);
  assert.notEqual(dGate, null, "the RAM gate FAILED to catch a missing timer gate — it is worthless");
  assert.ok(
    dGate.addr === GAME_SUBSTATE || dGate.addr === SUBSTATE_TIMER ||
      dGate.addr === 0x6900 || (dGate.addr >= 0x7400 && dGate.addr <= 0x77ff),
    `missing-gate diff must land in the body's footprint (0x600A / 0x6009 / a clear region), got ${hx(dGate.addr)}`,
  );

  // (c) Skip-clear: on a sentinel entry (timer expired) a clear region the oracle filled
  //     still holds the sentinel under the twin.
  const eSkip = craftEntry(base, 0xee, 0x01, 0x06, 0x01);
  const dSkip = diffAgainstOracle(eSkip, brokenSkipClear);
  assert.notEqual(dSkip, null, "the RAM gate FAILED to catch a skipped screen-clear — it is worthless");
  assert.ok(
    dSkip.addr === 0x6900 || (dSkip.addr >= 0x7400 && dSkip.addr <= 0x77ff),
    `skip-clear diff must land in a clear region (sprite buffer or VRAM), got ${hx(dSkip.addr)}`,
  );
  assert.ok(dSkip.a === 0x00 || dSkip.a === 0x10, "oracle fills the clear region with a blank byte (0x00 / 0x10)");
  assert.equal(dSkip.b, 0xee, "broken twin leaves the sentinel (never cleared)");

  console.log(
    `  TEETH: inverted-intro caught at ${hx(dIntro.addr)} (o=${dIntro.a} b=${dIntro.b}); ` +
      `missing-gate caught at ${hx(dGate.addr)}; skip-clear caught at ${hx(dSkip.addr)} (o=${dSkip.a} b=${dSkip.b})`,
  );
});
