// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_13aa (ROM 0x13AA) — the small in-game state reset
 * (0x0702 sub-state table idx 18): flip-screen ← DIP, GAME_SUBSTATE ← 0,
 * CURRENT_PLAYER/0x600E ← 1.
 *
 * loc_13aa's entire memory-observable behaviour is a TOTAL FUNCTION of exactly one
 * input byte, DIP_UPRIGHT (0x6026): it reads that byte, copies it to the flip-screen
 * latch, and otherwise writes three fixed values (0x600A ← 0, 0x600D ← 1, 0x600E ← 1).
 * So it is validated the strongest way — EXHAUSTIVELY over that one byte:
 *
 *   1. EQUAL (exhaustive) — loc_13aa == oracle over ALL 256 DIP_UPRIGHT values,
 *      compared on RAM − the stack scratch below the entry SP (the memory-equivalence contract) AND the
 *      flip-screen latch. The base entry seeds 0x600A/0x600D/0x600E to non-target
 *      SENTINELS so each of the routine's writes is observable (a dropped write would
 *      leave a sentinel behind and diverge). The oracle's terminal `ret` pops the
 *      stack inside STACK_SCRATCH (SP set there) and is excluded; the direct-call
 *      candidate leaves the stack alone. 256 values is the complete input space.
 *
 *      NB the flip-screen write targets 0x7D82, an I/O latch the memory seam routes to
 *      io.writeFlipScreen(value & 1). dumpState() captures work + sprite + video RAM
 *      only, NOT that latch — so io.flipScreen is compared EXPLICITLY here, or the
 *      flip write would carry no teeth.
 *
 *   2. TEETH (exhaustive) — three deliberately-broken twins, one per effect the
 *      routine owns, each of which the sweep MUST catch:
 *        (a) broken-flip     — writes a constant 0 to the flip latch instead of the DIP;
 *            caught by the io.flipScreen compare on the odd-DIP rows.
 *        (b) broken-substate — drops the GAME_SUBSTATE clear; caught by the 0x600A diff
 *            (the sentinel survives).
 *        (c) broken-player   — writes CURRENT_PLAYER = 0 instead of 1; caught by the
 *            0x600D diff.
 *
 *   3. REALISM (crafted onto real credited-game states) — attract never dispatches an
 *      in-game sub-state, so we drive a coin+start game, hook 0x06fe (the in-game
 *      sub-state dispatcher, which fires every in-game frame), and clone REAL
 *      credited-game states. Onto each — keeping its full real RAM background — we poke
 *      only DIP_UPRIGHT (a few values) and a safe SP, then confirm loc_13aa reproduces
 *      the oracle's RAM − the stack scratch below the entry SP and flip latch against a realistic machine, not
 *      just a fresh boot.
 *
 * Contract: RAM − the stack scratch below the entry SP + io.flipScreen. LIVE-OUT is memory + that latch; SP/PC
 * are the Z80 `ret` the direct-call return replaces and the dispatcher ignores the
 * handler's residual registers/flags — so neither is compared (never the full register
 * file, never cycles).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-13aa.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13aa as oracle } from "../../translated/loc_13aa.js";
import { loc_06fe as oracleDispatcher } from "../../translated/loc_06fe.js";
import { loc_13aa } from "../loc_13aa.js";
import { DIP_UPRIGHT, GAME_SUBSTATE, CURRENT_PLAYER, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const DISPATCHER = 0x06fe;
const FLIP_SCREEN_LATCH = 0x7d82; // I/O latch — NOT in dumpState(); compared via io.flipScreen
const PLAYER_CONTEXT_HI = 0x600e; // un-named scratch, high byte of the 0x600D word store

const SENTINEL_SUBSTATE = 0x99; // -> 0x600A (routine clears to 0)
const SENTINEL_PLAYER = 0x55;   // -> 0x600D (routine sets to 1)
const SENTINEL_PLAYER_HI = 0xaa; // -> 0x600E (routine sets to 1)

// The oracle's terminal `ret` pops two bytes off the stack; point SP low in work RAM so
// that pop stays valid (never I/O) and lands wholly inside STACK_SCRATCH, which is
// excluded from the diff — so it never affects the compared state.
const SAFE_SP = 0x6bf8;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

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
 * Run the oracle and a candidate on two FRESH clones of `entry` (docs/decompiler-pipeline: a routine
 * that WRITES memory must get a fresh clone per side — only a pure read-only leaf may
 * reuse one) and diff the full contract: RAM − the stack scratch below the entry SP first, then the flip-screen
 * latch (io.flipScreen — the 0x7D82 write dumpState() cannot see). Returns a
 * divergence descriptor or null.
 */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  const ram = firstRamDiffExStack(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off), entry.regs.sp);
  if (ram) return { kind: "ram", ...ram };
  if (a.io.flipScreen !== b.io.flipScreen) {
    return { kind: "flip", addr: FLIP_SCREEN_LATCH, a: a.io.flipScreen, b: b.io.flipScreen };
  }
  return null;
}

/**
 * A synthetic entry: `base` with the sole input byte (DIP_UPRIGHT) set, the three output
 * bytes seeded to sentinels, the flip latch seeded to the OPPOSITE of what a correct run
 * will write (so a "no flip write" bug is also observable), and a safe stack.
 */
function makeEntry(base, dip) {
  const e = base.clone();
  e.mem.write8(DIP_UPRIGHT, dip);
  e.mem.write8(GAME_SUBSTATE, SENTINEL_SUBSTATE);
  e.mem.write8(CURRENT_PLAYER, SENTINEL_PLAYER);
  e.mem.write8(PLAYER_CONTEXT_HI, SENTINEL_PLAYER_HI);
  e.io.flipScreen = (dip & 1) ^ 1; // opposite of the correct result -> a dropped flip write diverges
  e.regs.sp = SAFE_SP;
  return e;
}

/**
 * Sweep a candidate against the oracle over all 256 DIP_UPRIGHT values.
 * Returns the first divergence (or null) and the value count.
 */
function sweep(base, candidate) {
  let count = 0;
  for (let dip = 0; dip < 256; dip++) {
    const diff = runPair(makeEntry(base, dip), candidate);
    count++;
    if (diff) return { mismatch: { dip, diff }, count };
  }
  return { mismatch: null, count };
}

test("EQUAL (exhaustive): loc_13aa == oracle over all 256 DIP_UPRIGHT values (RAM + flip latch)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, loc_13aa);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at 0x6026=${hx(mismatch.dip)}: ${mismatch.diff.kind} diverges at ` +
        `0x${(mismatch.diff.addr ?? 0).toString(16)} (${mismatch.diff.a}->${mismatch.diff.b})`,
  );
  assert.equal(count, 256, "must have compared all 256 DIP_UPRIGHT values");
  console.log(`  EQUAL/exhaustive: ${count} DIP_UPRIGHT values — RAM − the stack scratch below the entry SP + flip latch identical to the oracle`);
});

/** BUG: writes a constant 0 to the flip latch instead of DIP_UPRIGHT. Caught by the
 *  io.flipScreen compare whenever the DIP's bit 0 is set (odd rows). */
function brokenFlip(m) {
  const { mem } = m;
  mem.write8(FLIP_SCREEN_LATCH, 0); // BUG: ignores DIP_UPRIGHT
  mem.write8(GAME_SUBSTATE, 0);
  mem.write8(CURRENT_PLAYER, 1);
  mem.write8(PLAYER_CONTEXT_HI, 1);
}

/** BUG: drops the GAME_SUBSTATE clear; the 0x99 sentinel survives. Caught by the 0x600A diff. */
function brokenSubstate(m) {
  const { mem } = m;
  mem.write8(FLIP_SCREEN_LATCH, mem.read8(DIP_UPRIGHT));
  mem.write8(CURRENT_PLAYER, 1);
  mem.write8(PLAYER_CONTEXT_HI, 1);
}

/** BUG: sets CURRENT_PLAYER to 0 instead of 1. Caught by the 0x600D diff. */
function brokenPlayer(m) {
  const { mem } = m;
  mem.write8(FLIP_SCREEN_LATCH, mem.read8(DIP_UPRIGHT));
  mem.write8(GAME_SUBSTATE, 0);
  mem.write8(CURRENT_PLAYER, 0); // BUG: should be 1
  mem.write8(PLAYER_CONTEXT_HI, 1);
}

test("TEETH (exhaustive): the broken-flip twin is CAUGHT (flip latch has teeth)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, brokenFlip);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong flip-screen source — it is worthless");
  assert.equal(mismatch.diff.kind, "flip", "the broken-flip twin must be caught on the flip latch");
  console.log(
    `  TEETH/flip: caught after ${count} values at 0x6026=${hx(mismatch.dip)} ` +
      `(flip oracle=${mismatch.diff.a} broken=${mismatch.diff.b})`,
  );
});

test("TEETH (exhaustive): the broken-substate twin is CAUGHT (GAME_SUBSTATE has teeth)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = sweep(base, brokenSubstate);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped GAME_SUBSTATE clear — it is worthless");
  assert.equal(mismatch.diff.kind, "ram", "the broken-substate twin must be caught in RAM");
  assert.equal(mismatch.diff.addr, GAME_SUBSTATE, "must be caught at GAME_SUBSTATE (0x600A)");
  console.log(
    `  TEETH/substate: caught at 0x6026=${hx(mismatch.dip)} ` +
      `(0x600A oracle=${mismatch.diff.a} broken=${mismatch.diff.b})`,
  );
});

test("TEETH (exhaustive): the broken-player twin is CAUGHT (CURRENT_PLAYER has teeth)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = sweep(base, brokenPlayer);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong CURRENT_PLAYER value — it is worthless");
  assert.equal(mismatch.diff.kind, "ram", "the broken-player twin must be caught in RAM");
  assert.equal(mismatch.diff.addr, CURRENT_PLAYER, "must be caught at CURRENT_PLAYER (0x600D)");
  console.log(
    `  TEETH/player: caught at 0x6026=${hx(mismatch.dip)} ` +
      `(0x600D oracle=${mismatch.diff.a} broken=${mismatch.diff.b})`,
  );
});

// A coin+start tape: coin on IN2 bit7 at frame 10, start1 on IN2 bit2 at frame 30. Credits
// and starts a game so GAME_STATE reaches 3 and the 0x06fe sub-state dispatcher runs.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

/**
 * Drive a coin+start game and clone the machine at up to K real 0x06fe dispatches — real,
 * fully-populated credited-game states. The wrapper clones then runs the frozen dispatcher
 * oracle so the host game proceeds undisturbed; capturing is gated off after the run so
 * isolated replays can't pollute it.
 */
function captureInGameStates(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[DISPATCHER, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracleDispatcher(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

test("REALISM: loc_13aa on real credited-game states (full RAM background) — RAM − the stack scratch below the entry SP + flip match", () => {
  const caps = captureInGameStates(6, 1500);
  assert.ok(caps.length >= 1, "expected at least one real in-game 0x06fe state to craft from");

  const DIPS = [0x00, 0x01, 0x80, 0x81]; // cocktail/upright, and upper bits set (must be ignored past bit 0)
  let compared = 0;
  for (const cap of caps) {
    for (const dip of DIPS) {
      const entry = cap.clone(); // keep the real RAM background; poke only the input + a safe SP
      entry.mem.write8(DIP_UPRIGHT, dip);
      entry.regs.sp = SAFE_SP;
      const diff = runPair(entry, loc_13aa);
      assert.equal(
        diff,
        null,
        diff && `diverged on real state (0x6026=${hx(dip)}) — ${diff.kind} at ` +
          `0x${(diff.addr ?? 0).toString(16)} (${diff.a}->${diff.b})`,
      );
      compared++;
    }
  }
  console.log(`  REALISM: ${compared} crafted entries over ${caps.length} real in-game states — RAM − the stack scratch below the entry SP + flip == oracle`);
});
