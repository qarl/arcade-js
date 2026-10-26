// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0b06 (ROM 0x0B06) — one step of the opening Kong-climb
 * cutscene's display-list build (parity idle / walk-a-byte / terminal-beat setup).
 *
 * loc_0b06 WRITES memory and is NOT a leaf (it calls loadSpriteObjectBlock, the rst-0x38
 * vector addToSpriteObjectColumn, scrollClimbGraphicStep and loc_0da7 — all already
 * idiomatic), so it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per
 * case. It is reached ONLY in a credited game while the opening cutscene (GAME_SUBSTATE 7)
 * runs at INTRO_STEP == 4 — never in plain attract — so the states are captured from a
 * DRIVEN coin+start run. The comparison is RAM − the stack scratch below the entry SP: the oracle's stack traffic
 * on the deepest arm (path C) lands entirely in 0x6bea..0x6bed, well inside STACK_SCRATCH
 * [0x6be0,0x6c00), so excluding that region cannot mask a game-visible divergence. SP/pc
 * are the dropped stack model and are NOT compared — the oracle's own final `ret` nets SP+2
 * while the idiomatic side leaves SP put (same convention as the sibling loc_0da7). The gate:
 *
 *   1. REALISM (captured driven dispatches) — hook 0x0b06 during a coin+start game and
 *      clone at every real dispatch. One intro naturally reaches ALL THREE arms (measured:
 *      23 parity-idle / 22 walk-byte / 1 terminal). For each, run the ORACLE on one clone
 *      and idiomatic loc_0b06 on another and prove game-visible RAM identical.
 *
 *   2. CRAFTED (forced arms) — on a real base, repoint the walk pointer 0x63C2 at a scratch
 *      RAM byte set to 0x7F (forces the terminal arm) or to a non-0x7F byte (forces the walk
 *      arm), even-frame, identically on both sides — a deterministic re-hit of each data arm
 *      beyond the single natural terminal, each compared to the oracle. Plus an odd-frame
 *      parity-idle craft (a no-op both sides).
 *
 *   3. TEETH — two deliberately-broken twins MUST be caught by the RAM diff:
 *      (a) WRONG-COLUMN (walk arm) — adds the table byte into the X column (0x6908) instead
 *          of the Y column (0x690b). Caught in SPRITE_OBJ_BLOCK.
 *      (b) DROPPED-STEP (terminal arm) — omits the `inc INTRO_STEP`, so the cutscene never
 *          advances. Caught at INTRO_STEP (0x6385).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0b06.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0b06 as oracle } from "../../translated/loc_0b06.js";
import { loc_0b06 as idiomatic } from "../loc_0b06.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js"; // idiomatic callees, for the twins
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { scrollClimbGraphicStep } from "../scrollClimbGraphicStep.js";
import { drawBoardLayout as loc_0da7 } from "../drawBoardLayout.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0b06;
const FRAME = 0x601a;
const WALK_PTR = 0x63c2;
const INTRO_STEP = 0x6385;
const SCROLL_LOOP_VAR = 0x638e;
const CRAFT_AT = 0x6100; // scratch RAM the routine never writes — a home for a forced walk-target byte

// A coin+start tape (as in the 0x06fe / 0x0a76 dispatcher tests): coin on IN2 bit7 at
// frame 10, start1 on IN2 bit2 at frame 30. Credits + starts a game so GAME_STATE reaches
// 3 and the opening cutscene (sub-state 7, INTRO_STEP walking 0..7) plays.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

// First game-visible RAM byte that differs between two machines (skipping the stack scratch below the entry SP),
// or null. The memory-equivalence contract for this routine is RAM − the stack scratch below the entry SP.
function firstRamDiffExStack(a, b, liveFloor) {
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

// Run oracle and a candidate on two FRESH clones of `entry` (a memory-writing routine
// demands a fresh clone per side) and return the game-visible RAM diff.
function replay(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return firstRamDiffExStack(a, b, entry.regs.sp);
}

/**
 * Drive a coin+start game and clone the machine at each real 0x0b06 dispatch, classified by
 * the arm it will take (A = odd-frame parity idle; B = walk a non-0x7F byte; C = the 0x7F
 * terminal). The wrapper clones then runs the ORACLE so the host game proceeds to a clean
 * stop; capturing is gated off afterward so the isolated replays cannot pollute it.
 */
function captureDrivenDispatches(maxFrames) {
  const caps = { A: [], B: [], C: [] };
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing) {
      const frame = mm.mem.read8(FRAME);
      let path;
      if (frame & 1) path = "A";
      else {
        const ptr = mm.mem.read8(WALK_PTR) | (mm.mem.read8(WALK_PTR + 1) << 8);
        path = mm.mem.read8(ptr) === 0x7f ? "C" : "B";
      }
      caps[path].push(mm.clone());
    }
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

let CACHED = null;
function drivenCaps() {
  if (!CACHED) CACHED = captureDrivenDispatches(2500);
  return CACHED;
}

// -- 1. REALISM (captured driven dispatches) ----------------------------------

test("REALISM: real captured cutscene 0x0b06 dispatches — all three arms, game-visible RAM matches", () => {
  const caps = drivenCaps();
  assert.ok(caps.A.length >= 1, "expected parity-idle (path A) dispatches");
  assert.ok(caps.B.length >= 1, "expected walk-a-byte (path B) dispatches");
  assert.ok(caps.C.length >= 1, "expected a terminal (path C) dispatch");

  let compared = 0;
  for (const [path, list] of Object.entries(caps)) {
    for (const entry of list) {
      // The oracle's stack pushes on the deepest arm confine to STACK_SCRATCH (entry SP well
      // inside it), so excluding that region cannot mask a game-visible divergence.
      assert.ok(inStack(entry.regs.sp), `path ${path}: entry SP ${hx(entry.regs.sp)} must sit in STACK_SCRATCH`);
      const ram = replay(entry, idiomatic);
      assert.equal(
        ram,
        null,
        ram && `path ${path}: game-visible RAM diverged at ${hx(ram.addr)} (oracle=${ram.a} idiomatic=${ram.b})`,
      );
      compared++;
    }
  }
  console.log(
    `  REALISM: ${compared} real dispatches (A=${caps.A.length} B=${caps.B.length} C=${caps.C.length}) — RAM(−stack) identical`,
  );
});

// -- 2. CRAFTED (forced arms) -------------------------------------------------

/** Clone a real base, poke FRAME parity + repoint the walk pointer at a scratch byte. */
function craft(base, { even, targetByte }) {
  const m = base.clone();
  m.mem.write8(FRAME, even ? (m.mem.read8(FRAME) & 0xfe) : (m.mem.read8(FRAME) | 0x01));
  if (targetByte !== undefined) {
    m.mem.write8(CRAFT_AT, targetByte);
    m.mem.write16(WALK_PTR, CRAFT_AT);
  }
  return m;
}

test("CRAFTED: forced terminal / walk / parity arms match the oracle", () => {
  const base = drivenCaps().B[0]; // a real cutscene state to craft onto
  const cases = {
    "terminal (0x7F)": craft(base, { even: true, targetByte: 0x7f }),
    "walk (0x33)": craft(base, { even: true, targetByte: 0x33 }),
    "parity idle (odd frame)": craft(base, { even: false, targetByte: 0x33 }),
  };
  let n = 0;
  for (const [name, entry] of Object.entries(cases)) {
    const ram = replay(entry, idiomatic);
    assert.equal(ram, null, ram && `${name}: RAM diff at ${hx(ram.addr)} (oracle=${ram.a} idiomatic=${ram.b})`);
    n++;
  }
  console.log(`  CRAFTED: ${n} forced arms (terminal + walk + parity) — RAM(−stack) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): the walk arm adds the byte into the X column (0x6908), not the Y column (0x690b). */
function brokenWrongColumn(m) {
  const { regs, mem } = m;
  if (mem.read8(FRAME) & 0x01) return;
  const ptr = mem.read16(WALK_PTR);
  const byte = mem.read8(ptr);
  if (byte === 0x7f) return; // crafted entry is the walk arm; terminal not exercised here
  mem.write16(WALK_PTR, (ptr + 1) & 0xffff);
  regs.hl = 0x6908; // BUG: X column instead of 0x690b (Y column)
  regs.c = byte;
  addToSpriteObjectColumn(m);
}

/** Twin (b): the terminal arm omits the `inc INTRO_STEP` — the cutscene step never advances. */
function brokenDroppedStep(m) {
  const { regs, mem } = m;
  regs.hl = 0x385c;
  loadSpriteObjectBlock(m);
  let src = regs.hl;
  let dst = 0x6900;
  for (let i = 0; i < 8; i++) {
    mem.write8(dst, mem.read8(src));
    src = (src + 1) & 0xffff;
    dst = (dst + 1) & 0xffff;
  }
  regs.hl = 0x6908;
  regs.c = 0x50;
  addToSpriteObjectColumn(m);
  regs.hl = 0x690b;
  regs.c = 0xfc;
  addToSpriteObjectColumn(m);
  do {
    scrollClimbGraphicStep(m);
  } while (mem.read8(SCROLL_LOOP_VAR) !== 0x0a);
  mem.write8(0x6082, 0x03);
  regs.de = 0x392c;
  loc_0da7(m);
  mem.write8(0x74aa, 0x10);
  mem.write8(0x748a, 0x10);
  mem.write8(0x638d, 0x05);
  mem.write8(0x6009, 0x20);
  // BUG: the `inc (INTRO_STEP)` is dropped here.
  mem.write16(0x63c0, INTRO_STEP);
}

test("TEETH (wrong-column): the walk arm adding into the wrong column is CAUGHT", () => {
  const base = drivenCaps().B[0];
  const entry = craft(base, { even: true, targetByte: 0x33 }); // non-zero byte so the add is visible
  const ram = replay(entry, brokenWrongColumn);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch a wrong-column add — it is worthless");
  assert.equal(ram.addr, 0x6908, `expected the X column 0x6908 to differ, got ${hx(ram.addr)}`);
  console.log(`  TEETH/wrong-column: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH (dropped-step): omitting the INTRO_STEP advance is CAUGHT", () => {
  const base = drivenCaps().C[0]; // a real terminal-arm state
  const ram = replay(base, brokenDroppedStep);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch a dropped step advance — it is worthless");
  assert.equal(ram.addr, INTRO_STEP, `expected INTRO_STEP 0x6385 to differ, got ${hx(ram.addr)}`);
  console.log(`  TEETH/dropped-step: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
