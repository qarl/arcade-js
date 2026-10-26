// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for blankScreen (ROM 0x4b44) — the mode-0 door of the
 * display-setup fan-in.
 *
 * blankScreen stows board-mode 0 at BOARD_MODE and blanks the screen for setup in four
 * fixed-region steps: clear sprite/attribute RAM, fill the tilemap, flat-fill colour
 * RAM with the board-mode byte, and wipe the sprite-staging work block. All four
 * callees are already decompiled, so the idiomatic rewrite calls them directly and
 * models the original's tail-jump into the staging wipe as a JS return.
 *
 * The gate is MEMORY-ONLY. The oracle marshals its three intermediate calls on the
 * Z80 stack (which lives in diffed work RAM near 0x83ff), leaving a two-byte return-
 * address residue just below the entry stack pointer that the stack-free idiomatic JS
 * never writes. That residue is classic dead stack scratch (the caller overwrites it
 * before any read), so the RAM diff excludes exactly the window just below the entry
 * SP and compares every other byte — work, colour, video and sprite/attribute RAM —
 * byte for byte. pc and SP are excluded too: the idiomatic layer does not preserve the
 * Z80 return trace, and a strict pc/SP contract would break the moment a callee is
 * later dissolved.
 *
 * Five checks:
 *   0. HARNESS — capture a real 0x4b44 dispatch in a boot/attract run and confirm the
 *      oracle run is deterministic (oracle vs oracle identical). Proves the capture/
 *      clone/replay plumbing reaches 0x4b44 at all.
 *   1. EQUAL (real dispatches) — idiomatic == oracle over RAM (outside the stack
 *      scratch) on every captured entry: same blanked screen, no stray writes.
 *   2. EQUAL (crafted dirty screen) — pre-seed colour / video / sprite / staging RAM
 *      with a sentinel on both sides; both blank them identically, and the idiomatic
 *      run really replaced the sentinel (non-vacuous: proves the fills/clears run, not
 *      that the screen was already blank).
 *   3. TEETH (wrong board-mode byte) — a twin that stows 0xC0 instead of 0 is CAUGHT
 *      at BOARD_MODE / the colour RAM it flat-fills.
 *   4. TEETH (skipped staging wipe) — a twin that omits the tail wipe leaves a dirtied
 *      staging block, CAUGHT at 0x8200; proves the tail step actually runs.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4b44.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4b44 as oracle } from "../../translated/loc_4b44.js";
import { blankScreen as idiomatic } from "../blankScreen.js";
import { clearSpriteAndAttributeRam } from "../clearSpriteAndAttributeRam.js";
import { fillVideoRam } from "../fillVideoRam.js";
import { fillColorRam } from "../fillColorRam.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { BOARD_MODE } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x4b44;

// Display regions the blank rewrites (used by the crafted dirty-screen check).
const COLOR_RAM_LO = 0x8800, COLOR_RAM_HI = 0x8bff; // flat-filled with the board-mode byte
const VIDEO_RAM_LO = 0x9000, VIDEO_RAM_HI = 0x93ff; // filled with the background tile
const SPRITE_RAM_LO = 0x9800, SPRITE_RAM_HI = 0x987f; // cleared to zero
const STAGING_LO = 0x8200, STAGING_HI = 0x823f; // wiped to zero (the tail step)
const SENTINEL = 0xa5; // any non-zero marker a correct blank must overwrite
const isColorRam = (a) => a >= COLOR_RAM_LO && a <= COLOR_RAM_HI;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Capture up to K real entry states of 0x4b44 during a boot/attract run. The wrapper
 * clones on entry, then runs the oracle so the host game proceeds undisturbed.
 */
function captureEntries(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  makeMachine(snap).runFrames(maxFrames);
  return caps;
}

/**
 * First differing RAM byte between two machines' full state dumps, EXCLUDING the dead
 * stack-scratch window just below the entry stack pointer (the oracle parks a return-
 * address residue there that the stack-free idiomatic JS never writes). Null when
 * otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 8, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Paint a sentinel across all four blank regions on a machine (both sides, so a
 *  correct blank must overwrite it and a diff means a real logic difference). */
function dirtyScreen(m) {
  const { mem } = m;
  const paint = (lo, hi) => { for (let a = lo; a <= hi; a++) mem.write8(a, SENTINEL); };
  paint(COLOR_RAM_LO, COLOR_RAM_HI);
  paint(VIDEO_RAM_LO, VIDEO_RAM_HI);
  paint(SPRITE_RAM_LO, SPRITE_RAM_HI);
  paint(STAGING_LO, STAGING_HI);
}

// -- 0. HARNESS (reachability + oracle determinism) --------------------------

test("HARNESS: a real 0x4b44 dispatch is captured and the oracle run is deterministic", () => {
  const caps = captureEntries(1, 600);
  assert.ok(caps.length >= 1, "expected 0x4b44 to be dispatched during boot/attract");

  const entry = caps[0];
  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  console.log(`  HARNESS: captured a real 0x4b44 entry (SP=${hx(entry.regs.sp)}); oracle run deterministic`);
});

// -- 1. EQUAL on real captured dispatches (memory-only) ----------------------

test("EQUAL (real dispatches): idiomatic blankScreen == oracle over RAM outside the stack scratch", () => {
  const caps = captureEntries(8, 600);
  assert.ok(caps.length >= 1, "expected at least one real 0x4b44 dispatch");
  for (const cap of caps) {
    const entrySP = cap.regs.sp;
    const a = cap.clone();
    oracle(a);
    const b = cap.clone();
    idiomatic(b);
    const bad = ramDiffOutsideStack(a, b, entrySP);
    assert.equal(bad, null, bad && `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (outside stack scratch)`);
});

// -- 2. EQUAL on a crafted dirty screen (memory-only) + NON-VACUOUS ----------

test("EQUAL (crafted dirty screen): both blank the same regions, and idiomatic really overwrote the sentinel", () => {
  const caps = captureEntries(1, 600);
  assert.ok(caps.length >= 1, "need a captured entry to craft from");
  const dirty = caps[0].clone();
  dirtyScreen(dirty);
  const entrySP = dirty.regs.sp;

  const a = dirty.clone();
  oracle(a);
  const b = dirty.clone();
  idiomatic(b);

  const bad = ramDiffOutsideStack(a, b, entrySP);
  assert.equal(bad, null, bad && `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // NON-VACUOUS: the blank really overwrote the sentinel, so EQUAL is not passing on a
  // screen that was already blank.
  assert.equal(b.mem.read8(BOARD_MODE), 0, "BOARD_MODE not stowed to 0");
  assert.equal(b.mem.read8(COLOR_RAM_LO), 0, "colour RAM not flat-filled (sentinel survived)");
  assert.equal(b.mem.read8(SPRITE_RAM_LO), 0, "sprite/attribute RAM not cleared (sentinel survived)");
  assert.equal(b.mem.read8(STAGING_LO), 0, "staging block not wiped (sentinel survived)");
  console.log("  EQUAL/crafted: dirtied screen blanked identically; sentinel overwritten in colour/sprite/staging RAM");
});

// -- 3. TEETH: a wrong board-mode byte is caught -----------------------------

/** Broken twin: stows 0xC0 (a sibling door's value) instead of 0, so BOARD_MODE and
 *  the colour RAM it flat-fills both come out wrong. */
function twinWrongBoardMode(m) {
  const { mem8 } = m;
  mem8[BOARD_MODE] = 0xc0; // BUG: wrong door's selector byte
  clearSpriteAndAttributeRam(m);
  fillVideoRam(m);
  fillColorRam(m);
  // (staging wipe omitted is irrelevant here; the selector diff comes first)
  return undefined;
}

test("TEETH (wrong board-mode): a twin that stows 0xC0 is CAUGHT at BOARD_MODE / colour RAM", () => {
  const caps = captureEntries(1, 600);
  const cap = caps[0];
  const entrySP = cap.regs.sp;

  const a = cap.clone();
  oracle(a);
  const b = cap.clone();
  twinWrongBoardMode(b);

  const bad = ramDiffOutsideStack(a, b, entrySP);
  assert.notEqual(bad, null, "the gate FAILED to catch a wrong board-mode byte — it is worthless");
  assert.ok(
    bad.addr === BOARD_MODE || isColorRam(bad.addr),
    `expected the caught diff at BOARD_MODE or in the flat-filled colour RAM, got ${hx(bad.addr)}`,
  );
  console.log(`  TEETH/board-mode: wrong byte caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

// -- 4. TEETH: a skipped staging wipe is caught ------------------------------

/** Broken twin: correct board-mode + fills, but omits the tail staging wipe. On a
 *  dirtied staging block it leaves the sentinel that the oracle zeroes. */
function twinSkipStagingWipe(m) {
  const { mem8 } = m;
  mem8[BOARD_MODE] = 0;
  clearSpriteAndAttributeRam(m);
  fillVideoRam(m);
  fillColorRam(m);
  // BUG: the tail clearSpriteStagingBuffer(m) is missing.
  return undefined;
}

test("TEETH (skipped staging wipe): a twin that omits the tail wipe is CAUGHT at 0x8200", () => {
  const caps = captureEntries(1, 600);
  const dirty = caps[0].clone();
  dirtyScreen(dirty); // dirties the staging block among the rest
  const entrySP = dirty.regs.sp;

  const a = dirty.clone();
  oracle(a);
  const b = dirty.clone();
  twinSkipStagingWipe(b);

  const bad = ramDiffOutsideStack(a, b, entrySP);
  assert.notEqual(bad, null, "the gate FAILED to catch the skipped staging wipe — it proves nothing");
  assert.equal(bad.addr, STAGING_LO, `expected the caught diff at ${hx(STAGING_LO)}, got ${hx(bad.addr)}`);
  console.log(`  TEETH/staging: skipped wipe caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});
