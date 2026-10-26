// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for setupBoardMode90 (ROM 0x4b40) — the 0x90 board-mode door.
 *
 * setupBoardMode90 stows the board-mode / entry-select byte 0x90 at BOARD_MODE and rebuilds
 * the screen for that board: it clears sprite/attribute RAM, repaints the whole
 * tilemap, flat-fills colour RAM (using that byte as the screen-wide colour), and
 * wipes the sprite-record staging block. Its declared live-out is MEMORY-ONLY — every
 * byte those steps write, plus the return to the caller — so the gate compares RAM +
 * pc + SP and drops the value registers the oracle leaves behind (the honest-signature
 * contract).
 *
 * WHY A CRAFTED ENTRY. The 0x90 door is never dispatched during attract (the demo only
 * reaches the 0x00 and 0xC0 doors), so the capture/replay harness cannot hook 0x4b40
 * directly. Per the crafted-entry method the gate instead runs the routine from a REAL
 * captured sibling state: blankScreen (the 0x00 door) IS reached in attract and shares the
 * identical call convention and body, so its entry is a faithful state for the 0x90
 * door too. Crucially setupBoardMode90 never calls blankScreen, so cloning that entry introduces no
 * registry recursion. The one input that shapes the output — the board-mode byte — is
 * fixed 0x90 by the routine itself.
 *
 * ONE WRINKLE — the oracle runs its three setup steps as real subroutine calls, pushing
 * a return address onto the stack for each; The Pit's stack is real diffed work RAM
 * (0x83ff down). Those pushes leave two dead bytes just below the entry stack pointer
 * that the idiomatic composition does not reproduce (it makes its single net return
 * through the sprite/attribute-clear step and never parks an intermediate return there).
 * They are classic dead stack scratch — overwritten by the caller's next push before
 * anything reads them — so the RAM diff excludes exactly that [SP-2, SP) window and
 * compares everything else byte-for-byte. Both the oracle (via its closing tail-jump)
 * and the idiomatic routine model their own return, so no external ret is added.
 *
 * Five checks:
 *   0. HARNESS — capture a real blankScreen sibling entry and confirm the oracle run of
 *      setupBoardMode90 is deterministic (oracle vs oracle -> identical whole state + pc).
 *      Proves the capture/clone/diff plumbing reaches a genuine setup entry.
 *   1. EQUAL (crafted sibling entry) — setupBoardMode90 == oracle over RAM (outside the stack
 *      scratch) + pc + SP, and the setup actually landed: BOARD_MODE = 0x90, colour RAM
 *      all 0x90, tilemap all the fill code, sprite/attribute block and staging block
 *      zeroed.
 *   2. NON-VACUOUS — the same run proves EQUAL is not a no-op: BOARD_MODE goes
 *      0x00 -> 0x90 and the flat-filled colour RAM changes versus the captured entry.
 *   3. TEETH (wrong board mode) — a twin that stows 0x00 instead of 0x90 is CAUGHT at
 *      BOARD_MODE and in the colour RAM that byte flat-fills.
 *   4. TEETH (dropped tilemap fill) — a twin that skips the tilemap repaint is CAUGHT in
 *      the tilemap on a sentinel-seeded entry (proving a missed setup step surfaces).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4b40.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4b40 as oracle } from "../../translated/loc_4b40.js";
import { setupBoardMode90 as idiomatic } from "../setupBoardMode90.js";
import { loc_4b44 as siblingDoor } from "../../translated/loc_4b44.js";
import { clearSpriteAndAttributeRam } from "../clearSpriteAndAttributeRam.js";
import { fillVideoRam } from "../fillVideoRam.js";
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

const CAPTURE_AT = 0x4b44; // sibling 0x00 door — a real setup entry, reached in attract
const MODE = 0x90; // the board-mode byte this door stows

// The regions the setup rebuilds (for positive checks / teeth seeding).
const SPRITE_ATTR_LO = 0x9800, SPRITE_ATTR_LEN = 128; // cleared sprite + column-scroll RAM
const VRAM_LO = 0x9000, VRAM_HI = 0x93ff; // repainted tilemap
const COLOR_LO = 0x8800, COLOR_HI = 0x8bff; // flat-filled colour RAM
const STAGING_LO = 0x8200, STAGING_HI = 0x823f; // wiped staging block
const FILL_ROM = 0x4b0f; // ROM constant holding the tilemap fill code
const SENTINEL = 0xab; // a byte distinct from any fill, for the coverage teeth
const isColorRam = (a) => a >= COLOR_LO && a <= COLOR_HI;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook the sibling 0x00 door 0x4b44 in a real attract run and clone the machine at its
 * first dispatch — a genuine setup entry (valid stack with a return address, in-play
 * work RAM). The wrapper snapshots then runs the sibling so attract proceeds.
 */
function captureSiblingEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[CAPTURE_AT, (mm) => {
    if (entry === null) entry = mm.clone();
    return siblingDoor(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return entry;
}

/** First differing RAM byte, EXCLUDING the two dead stack-scratch bytes the oracle's setup-call pushes
 *  park just below the entry stack pointer (which the stack-free idiomatic composition does not
 *  reproduce). Null when otherwise identical. */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 2, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Compare a candidate against the oracle over the memory-equivalence contract for one
 * entry: RAM (outside the stack scratch) + pc + SP. Value registers are the declared-
 * dead live-out and excluded. Both arms model their own return, so no external ret is
 * added. Returns { diffs, ram } (diffs empty == EQUAL).
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

/** Pre-seed the whole tilemap span with one byte (both arms start identical). */
function seedTilemap(m, value) {
  for (let cell = VRAM_LO; cell <= VRAM_HI; cell++) m.mem.write8(cell, value);
}

/** True when every byte of [lo, hi] reads `value`. */
function regionIs(m, lo, hi, value) {
  for (let a = lo; a <= hi; a++) if (m.mem.read8(a) !== value) return a;
  return -1;
}

/** Wrong-board-mode twin: stows 0x00 (a sibling door's value) before the same rebuild. */
function twinWrongMode(m) {
  const { mem8 } = m;
  mem8[BOARD_MODE] = 0x00; // BUG: the wrong door's board-mode byte
  clearSpriteAndAttributeRam(m);
  fillVideoRam(m);
  fillColorRam(m); // fills colour RAM with the WRONG byte
  clearSpriteStagingBuffer(m);
}

/** Dropped-tilemap-fill twin: skips the tilemap repaint (leaves it whatever it was). */
function twinMissTilemap(m) {
  const { mem8 } = m;
  mem8[BOARD_MODE] = 0x90;
  clearSpriteAndAttributeRam(m);
  // BUG: fillVideoRam(m) omitted — the tilemap is never repainted.
  fillColorRam(m);
  clearSpriteStagingBuffer(m);
}

test("HARNESS: a real blankScreen sibling entry is captured and the oracle run of setupBoardMode90 is deterministic", () => {
  const entry = captureSiblingEntry(1500);
  assert.ok(entry, "expected the sibling 0x00 door 0x4b44 to be dispatched during attract");
  assert.equal(entry.mem.read8(BOARD_MODE), 0x00, "the sibling entry should carry the 0x00 door's board mode (non-vacuous state)");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  console.log(
    `  HARNESS: captured a real 0x4b44 entry (SP=${hx(entry.regs.sp)}, BOARD_MODE=${hx(entry.mem.read8(BOARD_MODE))}); ` +
      `oracle run of 0x4b40 deterministic`,
  );
});

test("EQUAL (crafted sibling entry): setupBoardMode90 == oracle over RAM + pc + SP, and the setup landed", () => {
  const entry = captureSiblingEntry(1500);
  assert.ok(entry, "need a captured 0x4b44 entry");

  const { diffs } = contractDiffs(entry, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Positive checks: the rebuild really happened, exactly as the setup declares.
  const c = entry.clone();
  idiomatic(c);
  const fill = c.mem.read8(FILL_ROM);
  assert.equal(c.mem.read8(BOARD_MODE), MODE, "BOARD_MODE not set to the 0x90 door's byte");
  assert.equal(regionIs(c, COLOR_LO, COLOR_HI, MODE), -1, "colour RAM not flat-filled with the board-mode byte");
  assert.equal(regionIs(c, VRAM_LO, VRAM_HI, fill), -1, "tilemap not fully repainted with the fill code");
  assert.equal(regionIs(c, SPRITE_ATTR_LO, SPRITE_ATTR_LO + SPRITE_ATTR_LEN - 1, 0), -1, "sprite/attribute block not cleared");
  assert.equal(regionIs(c, STAGING_LO, STAGING_HI, 0), -1, "staging block not wiped");

  // NON-VACUOUS: the setup actually rewrote memory versus the captured entry state.
  assert.notEqual(
    c.mem.read8(BOARD_MODE),
    entry.mem.read8(BOARD_MODE),
    "expected BOARD_MODE to change from the entry state (non-vacuous)",
  );
  assert.notEqual(
    c.mem.read8(COLOR_LO),
    entry.mem.read8(COLOR_LO),
    "expected the flat-filled colour RAM to differ from the entry state (non-vacuous)",
  );

  console.log(
    `  EQUAL/crafted: identical over RAM+pc+SP; BOARD_MODE ${hx(entry.mem.read8(BOARD_MODE))} -> ${hx(MODE)}, ` +
      `colour RAM all ${hx(MODE)}, tilemap all ${hx(fill)}`,
  );
});

test("TEETH (wrong board mode): a twin that stows 0x00 is CAUGHT at BOARD_MODE / colour RAM", () => {
  const entry = captureSiblingEntry(1500);
  assert.ok(entry, "need a captured 0x4b44 entry to seed the teeth check");

  const { diffs, ram } = contractDiffs(entry, twinWrongMode);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong board-mode twin — it proves nothing");
  assert.ok(
    ram && (ram.addr === BOARD_MODE || isColorRam(ram.addr)),
    `expected the caught diff at BOARD_MODE or in the flat-filled colour RAM, got ${ram ? hx(ram.addr) : "(none)"}`,
  );
  console.log(`  TEETH/mode: wrong board-mode twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH (dropped tilemap fill): a twin that skips the tilemap repaint is CAUGHT on a sentinel entry", () => {
  const seed = captureSiblingEntry(1500);
  assert.ok(seed, "need a captured 0x4b44 entry to seed the teeth check");

  const fill = seed.mem.read8(FILL_ROM);
  assert.notEqual(fill, SENTINEL, "sentinel must differ from the fill code for this check to bite");

  // Seed the tilemap with a sentinel on BOTH sides; the oracle repaints it, the twin
  // leaves the sentinel, so the miss surfaces independent of the entry's content.
  const o = seed.clone();
  seedTilemap(o, SENTINEL);
  oracle(o);

  const c = seed.clone();
  seedTilemap(c, SENTINEL);
  twinMissTilemap(c);

  // Diff outside the dead stack scratch — otherwise the intermediate-return bytes the
  // oracle parks (and neither the real routine nor this twin reproduces) surface first,
  // masking the actual tilemap miss this teeth is testing for.
  const d = ramDiffOutsideStack(o, c, seed.regs.sp);
  assert.notEqual(d, null, "the twin ESCAPED the sentinel-seeded diff — the gate is worthless");
  assert.ok(
    d.addr >= VRAM_LO && d.addr <= VRAM_HI,
    `expected the miss in the tilemap span, got ${hx(d.addr ?? 0)}`,
  );
  console.log(`  TEETH/tilemap: dropped-fill twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
