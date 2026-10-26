// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for setupBoardDisplay (ROM 0x4b46) — the shared display-setup
 * body of the three board-mode doors: it records the board-mode byte and rebuilds the
 * whole screen for it (clear sprites/columns, wipe the tilemap, flood the colour RAM
 * with that byte, blank the sprite-staging block).
 *
 * HONEST SIGNATURE. The board-mode byte arrives in a register (the door sets it), so the
 * idiomatic routine takes it as a plain parameter, setupBoardDisplay(m, boardMode); the
 * oracle reads it from the accumulator. The gate feeds BOTH the same value — the captured
 * accumulator on a real entry, a swept value on the crafted entries.
 *
 * CONTRACT — OBSERVABLE RAM ONLY. Declared live-out is memory-only, so the gate diffs
 * work + colour + video + attr/sprite RAM and nothing else — NOT pc, SP, or the value
 * registers/flags, which the idiomatic layer deliberately does not preserve (a strict
 * pc/SP contract would break the instant a callee is later dissolved). The one RAM
 * difference that is NOT a bug: the oracle's three internal setup CALLs each park a 2-byte
 * return frame in the stack-scratch just below the entry stack pointer; the stack-free
 * idiomatic JS never writes there, so the diff excludes exactly that [entrySP-2, entrySP)
 * window (dead scratch — overwritten before anything reads it).
 *
 * REACHABILITY. 0x4b46 is dispatched through the registry during cold boot: the 0xC0 door
 * (setupBoardModeC0) sets the byte and tail-calls it. The capture hook fires there, so the real
 * entry is genuine, mid-boot state.
 *
 * Checks:
 *   0. HARNESS — capture a real 0x4b46 entry and confirm the oracle run is deterministic.
 *   1. EQUAL (real entry) — setupBoardDisplay == oracle over observable RAM, and the
 *      positive checks hold (byte recorded, colour flooded, tilemap wiped, sprites and
 *      staging cleared).
 *   2. EQUAL (board-mode sweep 0..255) — with the byte forced to each value on both sides,
 *      the whole screen rebuild is identical. Exhaustive over the one input that shapes
 *      the output.
 *   3. TEETH (wrong board-mode byte) — a twin that records the complement is CAUGHT at
 *      BOARD_MODE (the byte drives both the mode latch and the flood colour).
 *   4. TEETH (skipped tilemap wipe, dirtied entry) — with the tilemap pre-dirtied to a
 *      sentinel on both sides, a twin that skips the video-RAM fill leaves the sentinel and
 *      is CAUGHT in video RAM.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4b46.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4b46 as oracle } from "../../translated/loc_4b46.js";
import { setupBoardDisplay as idiomatic } from "../setupBoardDisplay.js";
import { clearSpriteAndAttributeRam } from "../clearSpriteAndAttributeRam.js";
import { fillColorRam } from "../fillColorRam.js";
import { clearSpriteStagingBuffer } from "../clearSpriteStagingBuffer.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { BOARD_MODE } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x4b46;
const FILL_TILE_ADDR = 0x4b0f; // ROM constant the tilemap wipe stamps into every cell
const COLOR_RAM_BASE = 0x8800;
const COLOR_RAM_END = 0x8bff;
const VIDEO_RAM_BASE = 0x9000;
const VIDEO_RAM_END = 0x93ff;
const SPRITE_RAM_BASE = 0x9800; // cleared to 0 by the sprite/attribute wipe
const STAGING_BASE = 0x8200; // cleared to 0 by the sprite-staging wipe
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/**
 * Hook 0x4b46 in a real cold-boot/attract run and clone the machine at its first
 * dispatch — a genuine display-setup entry (the 0xC0 door hands the byte in during boot).
 * The wrapper snapshots then runs the oracle so the run proceeds undisturbed.
 */
function captureRealEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the dead 2-byte stack-scratch
 * window [entrySP-2, entrySP) the oracle's setup CALLs park their return frames in (the
 * stack-free idiomatic JS never writes it). Null when otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 2, hi: entrySP }, entrySP)(addr)) continue; // dead pushed return frame
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run `fn(clone, boardMode)` against the oracle (fed the same byte in the accumulator)
 *  on two clones of `entry`, and return the first observable-RAM difference (null == EQUAL). */
function diffAgainstOracle(entry, boardMode, fn) {
  const sp = entry.regs.sp;

  const o = entry.clone();
  o.regs.a = boardMode;
  oracle(o);

  const c = entry.clone();
  fn(c, boardMode);

  return ramDiffOutsideStack(o, c, sp);
}

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: a real 0x4b46 display-setup entry is captured and the oracle run is deterministic", () => {
  const entry = captureRealEntry(600);
  assert.ok(entry, "expected 0x4b46 to be dispatched during cold boot / attract (via the 0xC0 door)");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  console.log(
    `  HARNESS: captured a real 0x4b46 entry (SP=${hx(entry.regs.sp)}, ` +
      `board-mode byte=${hx(entry.regs.a)}); oracle run deterministic`,
  );
});

// -- 1. EQUAL on the real captured entry -------------------------------------

test("EQUAL (real entry): setupBoardDisplay == oracle over observable RAM", () => {
  const entry = captureRealEntry(600);
  assert.ok(entry, "need a captured 0x4b46 entry");
  const boardMode = entry.regs.a;
  const expectedTile = entry.mem.read8(FILL_TILE_ADDR);

  const ram = diffAgainstOracle(entry, boardMode, idiomatic);
  assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} oracle=${ram.a} idiomatic=${ram.b}`);

  // Positive checks: the byte was recorded and the whole screen really was rebuilt.
  const c = entry.clone();
  idiomatic(c, boardMode);
  assert.equal(c.mem.read8(BOARD_MODE), boardMode, "board-mode byte not recorded at BOARD_MODE");
  assert.equal(c.mem.read8(COLOR_RAM_BASE), boardMode, "colour RAM not flooded with the board-mode colour");
  assert.equal(c.mem.read8(COLOR_RAM_END), boardMode, "colour RAM not flooded to its last cell");
  assert.equal(c.mem.read8(VIDEO_RAM_BASE), expectedTile, "tilemap not wiped to the background tile");
  assert.equal(c.mem.read8(VIDEO_RAM_END), expectedTile, "tilemap not wiped to its last cell");
  assert.equal(c.mem.read8(SPRITE_RAM_BASE), 0, "sprite/attribute RAM not cleared");
  assert.equal(c.mem.read8(STAGING_BASE), 0, "sprite-staging block not cleared");
  console.log(
    `  EQUAL/real: identical observable RAM; board-mode=${hx(boardMode)} flooded colour, ` +
      `tilemap wiped to ${hx(expectedTile)}, sprites+staging cleared`,
  );
});

// -- 2. EQUAL across a crafted sweep of every board-mode byte 0..255 ----------

test("EQUAL (board-mode sweep 0..255): every byte rebuilds the screen identically to the oracle", () => {
  const seed = captureRealEntry(600);
  assert.ok(seed, "need a captured 0x4b46 entry to craft the sweep from");

  for (let boardMode = 0; boardMode <= 255; boardMode++) {
    const ram = diffAgainstOracle(seed, boardMode, idiomatic);
    assert.equal(ram, null, ram && `board-mode ${hx(boardMode)}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} idiomatic=${ram.b}`);

    // Spot-confirm the byte reached both the mode latch and the flood colour.
    const c = seed.clone();
    idiomatic(c, boardMode);
    assert.equal(c.mem.read8(BOARD_MODE), boardMode, `board-mode ${hx(boardMode)}: not recorded`);
    assert.equal(c.mem.read8(COLOR_RAM_BASE), boardMode, `board-mode ${hx(boardMode)}: colour not flooded`);
  }
  console.log("  EQUAL/sweep: board-mode bytes 0..255 all rebuild the screen identically to the oracle");
});

// -- 3. TEETH: a wrong board-mode byte is caught -----------------------------

/** Broken twin: records the COMPLEMENT of the board-mode byte, otherwise a correct rebuild. */
function twinWrongByte(m, boardMode) {
  const { mem8 } = m;
  mem8[BOARD_MODE] = boardMode ^ 0xff; // BUG: wrong byte -> wrong mode latch and flood colour
  clearSpriteAndAttributeRam(m);
  fillColorRam(m);
  clearSpriteStagingBuffer(m);
}

test("TEETH (wrong board-mode byte): a twin that records the complement is CAUGHT at BOARD_MODE", () => {
  const entry = captureRealEntry(600);
  assert.ok(entry, "need a captured 0x4b46 entry to seed the teeth check");
  const boardMode = entry.regs.a;

  const ram = diffAgainstOracle(entry, boardMode, twinWrongByte);
  assert.ok(ram, "the gate FAILED to catch the wrong-byte twin — it proves nothing");
  assert.equal(
    ram.addr,
    BOARD_MODE,
    `teeth caught the wrong address ${hx(ram.addr)} (expected BOARD_MODE ${hx(BOARD_MODE)})`,
  );
  console.log(`  TEETH/byte: wrong board-mode byte caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

// -- 4. TEETH: a skipped tilemap wipe is caught (dirtied entry) ---------------

/** Broken twin: rebuilds the screen but SKIPS the tilemap wipe (fillVideoRam omitted). */
function twinSkipVideo(m, boardMode) {
  const { mem8 } = m;
  mem8[BOARD_MODE] = boardMode;
  clearSpriteAndAttributeRam(m);
  // BUG: the tilemap wipe (fillVideoRam) is skipped
  fillColorRam(m);
  clearSpriteStagingBuffer(m);
}

test("TEETH (skipped tilemap wipe): a twin that leaves the tilemap dirty is CAUGHT in video RAM", () => {
  const captured = captureRealEntry(600);
  assert.ok(captured, "need a captured 0x4b46 entry to seed the teeth check");
  const boardMode = captured.regs.a;
  const expectedTile = captured.mem.read8(FILL_TILE_ADDR);

  // Pre-dirty the whole tilemap to a sentinel distinct from the fill tile, on BOTH sides,
  // so the skipped wipe leaves a visible difference regardless of the entry's video RAM.
  const seed = captured.clone();
  const sentinel = expectedTile ^ 0xff;
  for (let addr = VIDEO_RAM_BASE; addr <= VIDEO_RAM_END; addr++) seed.mem.write8(addr, sentinel);

  const ram = diffAgainstOracle(seed, boardMode, twinSkipVideo);
  assert.ok(ram, "the gate FAILED to catch the skipped-tilemap-wipe twin — it proves nothing");
  assert.equal(
    ram.addr,
    VIDEO_RAM_BASE,
    `teeth caught the wrong address ${hx(ram.addr)} (expected the first video-RAM cell ${hx(VIDEO_RAM_BASE)})`,
  );
  console.log(`  TEETH/video: skipped tilemap wipe caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
