// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for perFrame (ROM 0x00B5) — the per-frame service + game-state
 * dispatch tail of the vblank NMI: decrement FRAME, run the three once-per-frame service
 * routines (PRNG stir, coin service, sound tick), dispatch the current GAME_STATE through
 * the 4-entry ROM table at 0x00CA, then the interrupt-return epilogue.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. perFrame WRITES RAM everywhere (frame counter, PRNG, coin/credit and
 * sound/task state, and whatever the GAME_STATE handler dispatches), so every case uses a
 * FRESH clone per side. The contract compared is the DISSOLVED form:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP)  +  io latches  +  perFrame's SP unmoved from entry.
 *
 * perFrame is the tail of a vblank handler the idiomatic engine fires as a DIRECT JS call, so it
 * carries no interrupt-return epilogue: the oracle's register-frame discard and `ret` (and every
 * push/pop in its subtree) land in the excluded STACK_SCRATCH region, and its SP/pc are the
 * interrupt ABI the direct call drops. What IS asserted is that perFrame never touches SP.
 *
 * CAPTURE — 0x00b5 is reached by a direct fall-through from entry_0066, not the override map,
 * so we wrap fireNmi and mirror entry_0066's prologue up to perFrame's entry (accept NMI, ack,
 * watchdog, sprite-DMA blit, read controls in play, reserve the 12-byte register frame), clone
 * that instant, then run the oracle perFrame undisturbed. Two host runs feed the gate — attract
 * (GAME_STATE 0/1) and driven coin+start (2/3) — covering all four dispatch arms with real entries.
 *
 * Jobs:
 *   1. EQUAL (captured perFrame entries) — over attract + driven captures spanning all
 *      four GAME_STATE arms, oracle vs perFrame leave identical RAM(−stack) and io
 *      latches, SP untouched. The
 *      FULL oracle GAME_STATE handler runs on both sides, so a wrong dispatch target or a
 *      live register/flag handoff would surface as divergent RAM.
 *   2. TEETH A (the frame decrement) — a twin that OMITS `dec (FRAME)` MUST be caught
 *      in RAM.
 *   3. TEETH B (SP-inert) — a twin that keeps the interrupt-return epilogue (discard the
 *      register frame, `ret`) MUST be caught at SP, with RAM still equal.
 *   4. TEETH C (the NMI re-arm) — a twin that never re-arms the NMI MUST be caught at
 *      io.nmiMask (the enable latch is an io output, not RAM).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-00b5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_00b5 as oraclePerFrame } from "../../translated/loc_00b5.js";
import { perFrame } from "../perFrame.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { blitSpritesViaDma } from "../blitSpritesViaDma.js";
import { loc_0087 } from "../../translated/loc_0087.js";
import { Machine } from "../../machine.js";
import { NotImplemented } from "../../../../boards/dkong/io.js";
import { STACK_SCRATCH, ATTRACT, GAME_STATE, FRAME } from "../names.js";

// The four GAME_STATE handlers (same references perFrame folds the 0x00CA table into),
// re-imported here so the teeth twins can reproduce perFrame's structure with one bug.
import { stirRandomSeed } from "../stirRandomSeed.js";
import { serviceCoinInput } from "../serviceCoinInput.js";
import { soundDriverTick } from "../soundDriverTick.js";
import { runAttractState } from "../runAttractState.js";
import { dispatchInGameSubstate } from "../dispatchInGameSubstate.js";
import { loc_01c3 } from "../../translated/loc_01c3.js";
import { loc_08b2 } from "../../translated/loc_08b2.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

const NMI_ENABLE = 0x7d84; // NMI-enable latch (io); write 1 re-arms
const IN2_WATCHDOG = 0x7d00; // IN2 read = watchdog kick; bit 0 = SERVICE
const DMA_SETUP_BLOCK = 0x0138;

const NMI_GAME_STATE = [loc_01c3, runAttractState, loc_08b2, dispatchInGameSubstate];

// The 06fe test's coin+start tape: coin on IN2 bit7 @f10, start1 on IN2 bit2 @f30 — credits
// and starts a game so GAME_STATE walks 0 -> 1 -> 2 -> 3.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The board-output latches (the NMI enable, flip, banks, sound) live in io, not in the RAM dump.
const IO_FIELDS = ["nmiMask", "flipScreen", "spriteBank", "paletteBank", "audioIrq", "soundLatch3d"];
function ioDiff(ma, mb) {
  for (const k of IO_FIELDS) {
    if (ma.io[k] !== mb.io[k]) return { kind: "io", field: k, a: ma.io[k], b: mb.io[k] };
  }
  for (let i = 0; i < 8; i++) {
    if (ma.io.latch6h[i] !== mb.io.latch6h[i]) return { kind: "io", field: `latch6h[${i}]`, a: ma.io.latch6h[i], b: mb.io.latch6h[i] };
  }
  return null;
}

/**
 * First divergence on the dissolved contract, or null: RAM (dumpState, minus the dead
 * STACK_SCRATCH region), then the io latches, then perFrame's SP against its entry value
 * `sp0`. One masked forward scan (the oracle leaves many benign dead-stack diffs — the
 * register-save frame it writes and this layer does not).
 */
function contractDiff(ma, mb, sp0, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  const n = Math.min(a.length, b.length);
  for (let off = 0; off < n; off++) {
    if (a[off] === b[off]) continue;
    const addr = ma.stateOffsetToAddr(off);
    if (dead(addr)) continue;
    return { kind: "ram", addr, a: a[off], b: b[off] };
  }
  const io = ioDiff(ma, mb);
  if (io) return io;
  if (mb.regs.sp !== sp0) return { kind: "sp", a: sp0, b: mb.regs.sp };
  return null;
}

/** One line for a contract diff. */
function describe(d) {
  if (d.kind === "ram") return `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`;
  if (d.kind === "io") return `io.${d.field} diff: oracle=${d.a} idiomatic=${d.b}`;
  return `SP moved: entry=${hx(d.a)} idiomatic=${hx(d.b)}`;
}

/**
 * Capture up to `perState` real perFrame-ENTRY states per distinct GAME_STATE over a host
 * run. 0x00b5 is not in the m.call registry (entry_0066 calls perFrame directly), so we
 * wrap fireNmi and MIRROR entry_0066's prologue up to perFrame's entry, clone there, then
 * run the ORACLE perFrame so the host proceeds. Per-state capping guarantees the brief
 * arms (power-on, credited) are not crowded out by the dominant one.
 */
function capturePerFrameEntries({ tape, perState, maxFrames }) {
  const caps = [];
  const perCount = new Map();
  const host = new Machine(ROM);
  if (tape) host.inputTape = tape.map((t) => ({ ...t }));
  const origFire = host.fireNmi.bind(host);
  host.fireNmi = function () {
    if (!this.pcKnown) return origFire(); // let the real guard throw its diagnostic
    // -- entry_0066 prologue, mirrored up to perFrame's entry (0x00b5) --
    this.nmiCount += 1;
    this.push16(this.pc); // NMI accept: push the interrupted PC ...
    this.cycles += 11; //             ... and charge the 11-t accept cost
    // Save the interrupted context — the REAL 12-byte register frame (not a bare SP
    // reserve): this host run spans thousands of frames, and the oracle perFrame epilogue
    // pops these back, so the interrupted main loop must get its true registers restored
    // or it corrupts. (A bare reserve is fine only for the isolated one-shot gate.)
    this.push16(this.regs.af);
    this.push16(this.regs.bc);
    this.push16(this.regs.de);
    this.push16(this.regs.hl);
    this.push16(this.regs.ix);
    this.push16(this.regs.iy);
    this.mem.write8(NMI_ENABLE, 0); // ack / clear the NMI mask
    if (this.mem.read8(IN2_WATCHDOG) & 0x01) {
      // SERVICE switch — never asserted in attract/driven; entry_0066 would jp 0x4000.
      throw new NotImplemented("SERVICE switch held during capture (unexpected)");
    }
    this.regs.hl = DMA_SETUP_BLOCK;
    blitSpritesViaDma(this); // sprite DMA blit
    if (this.mem.read8(ATTRACT) === 0) loc_0087(this); // credited game reads input
    // -- perFrame entry (SP now sits below the 12-byte register frame + return PC) --
    const st = this.mem.read8(GAME_STATE);
    const c = perCount.get(st) || 0;
    if (c < perState) {
      perCount.set(st, c + 1);
      caps.push(this.clone());
    }
    return oraclePerFrame(this); // advance the host to NMI completion
  };
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT
  ? [
      ...capturePerFrameEntries({ perState: 12, maxFrames: 2600 }), //         attract: state 0/1
      ...capturePerFrameEntries({ tape: COIN_START_TAPE, perState: 12, maxFrames: 1500 }), // driven: 2/3
    ]
  : [];

// -- 1. EQUAL (captured perFrame entries) -------------------------------------

// Catch-all override (duck-typed like the Machine's overrides Map) that runs the frozen handler for
// whatever dispatch target was computed. Both sides run the same frozen handler for a target (the
// idiomatic side through the bracketed copy below), so a wrong target still routes to a different
// handler and diverges RAM — perFrame-body-vs-perFrame-body.
function oracleCatchAll() {
  return {
    has: () => true,
    get: (target) => (mm) => ORACLE_ROUTINES.get(target)(mm),
  };
}

// Idiomatic side's copy: perFrame's dispatchers push no continuation, so seat one for the frozen
// handler's `ret` and restore the entry SP after; perFrame's SP check then sees only perFrame.
function bracketedOracleCatchAll() {
  return {
    has: () => true,
    get: (target) => (mm) => {
      const sp0 = mm.regs.sp;
      mm.push16(0x0000);
      try { return ORACLE_ROUTINES.get(target)(mm); } finally { mm.regs.sp = sp0; }
    },
  };
}

test("EQUAL: real captured perFrame entries — perFrame == oracle (RAM −stack), SP untouched", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real perFrame entry across the runs");

  const states = new Set();
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    o.overrides = oracleCatchAll();
    c.overrides = bracketedOracleCatchAll();
    oraclePerFrame(o);
    perFrame(c);

    const d = contractDiff(o, c, cap.regs.sp, cap.regs.sp);
    assert.equal(
      d,
      null,
      d && describe(d),
    );
    states.add(cap.mem.read8(GAME_STATE));
  }

  // Non-vacuous coverage: attract exercises the idiomatic attract handler (state 1), the
  // driven run the idiomatic in-game dispatcher (state 3); both idiomatic dispatch arms
  // plus at least one oracle arm must have been reached.
  assert.ok(states.has(1), "expected a GAME_STATE 1 (attract) capture");
  assert.ok(states.has(3), "expected a GAME_STATE 3 (in-game) capture from the driven run");
  console.log(
    `  EQUAL: ${CAPS.length} perFrame entries identical (RAM −stack), SP untouched; ` +
      `GAME_STATE seen={${[...states].sort().join(",")}}`,
  );
});

// -- 2. TEETH A (the frame decrement) -----------------------------------------

// Broken twin: identical to perFrame but OMITS `dec (FRAME)`. Everything else — services,
// dispatch, epilogue — is faithful, so the divergence is the un-advanced frame clock.
function brokenNoFrameDec(m) {
  const { mem } = m;
  // BUG: no `mem.write8(FRAME, (mem.read8(FRAME) - 1) & 0xff)`.
  stirRandomSeed(m);
  serviceCoinInput(m);
  soundDriverTick(m);
  NMI_GAME_STATE[mem.read8(GAME_STATE)](m);
  mem.write8(NMI_ENABLE, 1);
}

test("TEETH A: omitting the frame decrement is CAUGHT", () => {
  const base = CAPS[0];
  perFrame(base.clone()); // the correct routine runs clean on this state
  const o = base.clone();
  const c = base.clone();
  oraclePerFrame(o);
  brokenNoFrameDec(c);
  const d = contractDiff(o, c, base.regs.sp, base.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch an omitted frame decrement — it is worthless");
  console.log(`  TEETH A: omitted dec (FRAME) caught (${d.kind} @ ${hx(d.addr ?? d.a)})`);
});

// -- 3. TEETH B (perFrame is SP-inert) ---------------------------------------

// Broken twin: the correct perFrame, then the interrupt-return epilogue the direct call dropped —
// discard the 12-byte register frame and `ret`. Memory-identical, so only the SP check sees it.
function brokenKeepsEpilogue(m) {
  perFrame(m);
  m.regs.sp = (m.regs.sp + 12) & 0xffff;
  m.ret();
}

test("TEETH B: a perFrame that still unwinds the interrupt frame is CAUGHT at SP (RAM equal)", () => {
  const base = CAPS[0];
  const o = base.clone();
  const oFloor = o.regs.sp;
  const c = base.clone();
  oraclePerFrame(o);
  brokenKeepsEpilogue(c);
  const d = contractDiff(o, c, base.regs.sp, oFloor);
  assert.notEqual(d, null, "the gate FAILED to catch an SP-moving perFrame — the inertness check is worthless");
  assert.equal(d.kind, "sp", `expected the catch at SP (RAM equal), got ${d.kind}`);
  console.log(`  TEETH B: SP-moving twin caught (entry=${hx(d.a)} broken=${hx(d.b)})`);
});

// -- 4. TEETH C (the NMI re-arm) ----------------------------------------------

// Broken twin: identical to perFrame but never re-arms the NMI. The enable latch is an io output, not
// RAM, so only the io comparison sees it.
function brokenNoRearm(m) {
  const { mem } = m;
  mem.write8(FRAME, (mem.read8(FRAME) - 1) & 0xff);
  stirRandomSeed(m);
  serviceCoinInput(m);
  soundDriverTick(m);
  NMI_GAME_STATE[mem.read8(GAME_STATE)](m);
  // BUG: no `mem.write8(NMI_ENABLE, 1)`.
}

test("TEETH C: a perFrame that never re-arms the NMI is CAUGHT in io", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  oraclePerFrame(o);
  brokenNoRearm(c);
  const d = contractDiff(o, c, base.regs.sp, base.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a missing NMI re-arm");
  assert.equal(d.kind, "io", `expected the catch in io, got ${d.kind}`);
  assert.equal(d.field, "nmiMask");
  console.log(`  TEETH C: missing re-arm caught at io.${d.field} (oracle=${d.a} broken=${d.b})`);
});
