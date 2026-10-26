// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for landDigTarget (ROM 0x2d4e) — the "target landed on terrain" arm
 * of the descending-target handler. On a terrain hit it queues a sound, stamps the
 * finished-target tile into the map cell just ahead of the target, resets the target's
 * small state block (spawn gate → idle, target X → 0, state → done/target, attribute →
 * fixed colour), then tail-hands-off to the record builder at 0x2bd3.
 *
 * Its declared live-out is MEMORY-ONLY, so the gate compares RAM (outside the transient
 * stack scratch), not the value registers the oracle leaves behind (the honest-signature
 * contract). Both arms run the full downstream tail (0x2bd3 → 0x2f71 → …) off the SAME
 * cloned entry, so that shared work is identical on both sides and the diff isolates this
 * routine's own writes; the tail also confirms this routine seeds the block the builder
 * then reads.
 *
 * WHY A CRAFTED ENTRY. This arm is only reached when the descending target hits a specific
 * terrain tile, which attract never drives — and it requests sound-command 17, which the
 * attract loop never asks for (the sibling requestSound17 gate relies on exactly that), so
 * the capture harness cannot hook 0x2d4e directly. Per the crafted-entry method the gate
 * runs it from a REAL captured attract state (the tile-offset leaf 0x3dae, reliably reached
 * ~frame 81, gives a valid deep RAM + stack). The one input that shapes the tile stamp —
 * the target's map-cell pointer, which the still-oracle caller leaves in a register — is
 * placed at a known video-RAM cell identically on both sides. 0x2d4e never calls 0x3dae,
 * so cloning that entry introduces no registry recursion.
 *
 * WHY NO ENTROPY PIN. Both arms are the same engine run from a byte-identical clone, so the
 * downstream tail's RNG draws advance identically; the pin only matters when comparing
 * across engines or cycle models.
 *
 * Checks:
 *   0. HARNESS — capture a real attract entry, place the target cell, and confirm the
 *      oracle run of 0x2d4e is deterministic (oracle vs oracle → identical whole state).
 *   1. EQUAL — landDigTarget == oracle over RAM outside the stack scratch, and the routine's
 *      own effects (stamped tile, reset state block, queued sound) hold their values.
 *   2. TEETH (wrong tile) — a twin that stamps a different completion tile is CAUGHT at
 *      the stamped video-RAM cell.
 *   3. TEETH (wrong state) — a twin that seeds the wrong done/target code is CAUGHT at the
 *      state byte.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2d4e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d4e as oracle } from "../../translated/loc_2d4e.js";
import { landDigTarget as idiomatic } from "../landDigTarget.js";
import { loc_3dae as reachedLeaf } from "../../translated/loc_3dae.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { HAZARD_X, HAZARD_STATE, HAZARD_TYPE, HAZARD_ACTIVE_COUNT, SOUND_HEAD, SOUND_RING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const CAPTURE_AT = 0x3dae; // a tilemap-offset leaf reliably reached in attract (~frame 81)
const TARGET_CELL = 0x9200; // where we place the target's map-cell pointer (video RAM)
const STAMP_CELL = TARGET_CELL - 31; // the cell this arm stamps (one ahead of the pointer)
const STAMP_TILE = 65; // 0x41 — the finished-target tile this arm writes
const DONE_STATE = 9; // the done/target state code it seeds
const FIXED_ATTR = 7; // the fixed colour/attribute it seeds
const SOUND_CMD = 17; // sound-command 0x11 the arrival cue requests
const PENDING = SOUND_CMD | 0x80; // 0x91 — the byte the ring slot holds once queued
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Hook a leaf that is reliably reached in attract, clone the machine at its first dispatch (a valid deep attract
 *  state), then place the target's map-cell pointer at a known video-RAM cell — the value the still-oracle caller
 *  would have left in the register. */
function captureCraftedEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[CAPTURE_AT, (mm) => {
    if (entry === null) entry = mm.clone();
    return reachedLeaf(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  if (!entry) return null;
  entry.regs.ix = TARGET_CELL;
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING a small window of dead stack
 * scratch just below the entry stack pointer: the oracle brackets its sound call with a
 * saved return address the stack-free idiomatic JS never writes, and those bytes are
 * classic dead scratch (below SP, overwritten before anything reads them). Null when
 * otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 8, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

test("HARNESS: a real crafted terrain-hit entry is captured and the oracle run is deterministic", () => {
  const entry = captureCraftedEntry(1500);
  assert.ok(entry, "expected the leaf 0x3dae to be dispatched during attract");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  console.log(
    `  HARNESS: captured a real attract entry (SP=${hx(entry.regs.sp)}, cell=${hx(TARGET_CELL)}); ` +
      `oracle run of 0x2d4e deterministic`,
  );
});

test("EQUAL: landDigTarget == oracle over RAM (outside stack scratch)", () => {
  const entry = captureCraftedEntry(1500);
  assert.ok(entry, "need a captured attract entry");
  const sp = entry.regs.sp;
  const head = entry.mem.read8(SOUND_HEAD);

  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  idiomatic(c);

  const ram = ramDiffOutsideStack(o, c, sp);
  assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);

  // Positive checks: the routine's own effects landed (cells the downstream tail doesn't touch).
  assert.equal(c.mem.read8(STAMP_CELL), STAMP_TILE, "finished-target tile not stamped");
  assert.equal(c.mem.read8(HAZARD_ACTIVE_COUNT), 0, "spawn gate not reopened to idle");
  assert.equal(c.mem.read8(HAZARD_X), 0, "target X not cleared");
  assert.equal(c.mem.read8(HAZARD_STATE), DONE_STATE, "done/target state not seeded");
  assert.equal(c.mem.read8(HAZARD_TYPE), FIXED_ATTR, "fixed attribute not seeded");
  assert.equal(c.mem.read8(SOUND_RING + head), PENDING, `arrival sound not queued into ring slot ${head}`);
  console.log(
    `  EQUAL: identical over RAM outside stack scratch; stamp ${hx(STAMP_CELL)}=${STAMP_TILE}, ` +
      `state block reset, sound slot ${head}=${hx(PENDING)}`,
  );
});

/** Broken twin: correct routine, then one wrong store to the stamped tile cell. */
function twinWrongTile(m) {
  idiomatic(m);
  m.mem.write8(STAMP_CELL, STAMP_TILE ^ 0xff); // BUG: wrong finished-target tile
}

test("TEETH (wrong tile): a twin that stamps the wrong tile is CAUGHT at the stamped cell", () => {
  const entry = captureCraftedEntry(1500);
  assert.ok(entry, "need a captured attract entry to seed the teeth check");
  const sp = entry.regs.sp;

  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  twinWrongTile(c);

  const ram = ramDiffOutsideStack(o, c, sp);
  assert.ok(ram, "the gate FAILED to catch the wrong-tile twin — it proves nothing");
  assert.equal(ram.addr, STAMP_CELL, `teeth caught the wrong address ${hx(ram.addr)} (expected ${hx(STAMP_CELL)})`);
  console.log(`  TEETH/tile: wrong-tile twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

/** Broken twin: correct routine, then one wrong store to the done/target state byte. */
function twinWrongState(m) {
  idiomatic(m);
  m.mem.write8(HAZARD_STATE, DONE_STATE - 1); // BUG: wrong done/target state code
}

test("TEETH (wrong state): a twin that seeds the wrong state code is CAUGHT at the state byte", () => {
  const entry = captureCraftedEntry(1500);
  assert.ok(entry, "need a captured attract entry to seed the teeth check");
  const sp = entry.regs.sp;

  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  twinWrongState(c);

  const ram = ramDiffOutsideStack(o, c, sp);
  assert.ok(ram, "the gate FAILED to catch the wrong-state twin — it proves nothing");
  assert.equal(ram.addr, HAZARD_STATE, `teeth caught the wrong address ${hx(ram.addr)} (expected ${hx(HAZARD_STATE)})`);
  console.log(`  TEETH/state: wrong-state twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
