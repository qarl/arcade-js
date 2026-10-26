// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for triggerDigReaction (ROM 0x191f) — the dig-arm of the actor-movement
 * classifier: it sorts the tile code under a digging actor into an escape band, an always-hit
 * code list, the sub-cell bit-2 gate, the diggable ROM-table lookup, or a keep-moving path,
 * and stages a reaction (scratch bytes 0x80a2-0x80a7, PLAYER_FACING, NEXT_TILE) plus, for an
 * armed actor, an arm-state bump and a sound request, before handing off to the record
 * builder (stageObjectSpriteRecord) or the movement continuation (0x19d0).
 *
 * Its declared LIVE-OUT is MEMORY-ONLY: everything it produces lands in work RAM (the staged
 * reaction, the per-actor arm state, the sound ring, and stageObjectSpriteRecord's record). The oracle's
 * residual registers are dead ABI — and because the idiomatic tail calls the decompiled
 * stageObjectSpriteRecord / enqueueSoundCommand directly (no Z80 ret, no stack pushes) rather than the
 * oracle's stack-threaded tail, comparing the full register file or SP would false-fail an
 * honest rewrite. So the gate is the state dump only (via firstStateDiff), matching stageObjectSpriteRecord's
 * contract — with ONE wrinkle:
 *
 *   THE STACK SCRATCH. The Pit's stack is real diffed work RAM (entry SP = 0x83fd here). On
 *   the armed sound path the oracle pushes a return address and the enqueue tail saves two
 *   register pairs — six dead bytes parked in [SP-6, SP) that the stack-free idiomatic never
 *   writes (confirmed: on the sound path those six bytes are the ONLY difference, and every
 *   named RAM byte matches). Classic dead stack scratch — overwritten by the caller's next
 *   push before anything reads it — so the diff excludes exactly the [SP-8, SP) window and
 *   compares everything else byte-for-byte.
 *
 * SIX checks:
 *   0. IDENTITY (harness) — run oracle vs oracle on a captured entry; EQUAL proves the
 *      capture/clone/replay harness reaches 0x191f in a real attract run (263 dispatches).
 *   1. EQUAL (real dispatches) — for every captured entry, oracle vs idiomatic leave identical
 *      state outside the stack scratch. Attract feeds tile codes 0x26/0x41/0x70/0x78 and all
 *      eight sub-cell offsets, so the escape/keep-moving/diggable-lookup arms are covered live.
 *   2. EQUAL (crafted branch sweep) — force every branch identically on both arms: the escape
 *      band, each always-hit code, the bit-2 gate (set/clear), 196 vs [150,154), the diggable
 *      lookup (mismatch with/without sound, boundary skip, neighbour in/out of range), and the
 *      >=154 / <113 keep-moving arms.
 *   3. NON-VACUOUS — pre-set the staged-reaction bytes to a sentinel on a mismatch entry; both
 *      arms must overwrite every one and agree, so a no-op twin cannot pass.
 *   4. TEETH (reaction) — a twin that writes the wrong reaction step (0 instead of 3) is
 *      CAUGHT at 0x80a2.
 *   5. TEETH (sound) — a twin that requests the wrong sound command is CAUGHT at the ring slot.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-191f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_191f as oracle } from "../../translated/loc_191f.js";
import { triggerDigReaction as idiomatic } from "../triggerDigReaction.js";
import { enqueueSoundCommand } from "../enqueueSoundCommand.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { PLAYER_FACING, NEXT_TILE, SOUND_HEAD, SOUND_RING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x191f;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const REACTION_STEP = 0x80a2; // set to 3 when a reaction is staged
const REACTION_PARAM = 0x80a4;
const NEIGHBOUR_TILE = 0x80a6;
const EXPECTED_TILE = 0x80a7;
const ARM_STATE = 0x80c1;
const REACTION_BYTES = [REACTION_STEP, REACTION_PARAM, NEIGHBOUR_TILE, EXPECTED_TILE, PLAYER_FACING, NEXT_TILE];

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so
// build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook 0x191f in a real attract run and clone the machine at up to K real dispatches. The
 * wrapper snapshots the entry state, then runs the oracle so the host game proceeds undisturbed.
 * The classifier reaches it repeatedly during the attract demo.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return caps;
}

/**
 * First differing state byte between two machines, EXCLUDING the dead stack scratch the
 * oracle's sound-path pushes park just below the entry stack pointer (which the stack-free
 * idiomatic does not reproduce). Null when otherwise identical.
 */
function stateDiffOutsideStack(a, b, entrySP) {
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

/** Run oracle and candidate on independent clones of `entry`; return the first differing
 *  state byte outside the stack scratch (or null). */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

/**
 * Force a branch: poke the register live-ins (tile code, position accumulator) and the arm
 * state identically, and optionally the neighbouring cell's tile (one byte past the actor
 * cell pointer). Returns a fresh entry clone.
 */
function craft(base, { tile, pos, arm, neighbour }) {
  const e = base.clone();
  e.regs.b = tile;
  e.regs.e = pos;
  e.mem.write8(ARM_STATE, arm);
  if (neighbour !== undefined) e.mem.write8((e.regs.ix + 1) & 0xffff, neighbour);
  return e;
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the harness reaches 0x191f in attract and oracle-vs-oracle is EQUAL", () => {
  const [entry] = captureDispatches(1, 3000);
  assert.ok(entry, "expected at least one real 0x191f dispatch during attract");
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log("  IDENTITY: captured a real 0x191f dispatch, cloned, ran oracle vs oracle -> EQUAL");
});

// -- 1. EQUAL over real captured attract dispatches --------------------------

test("EQUAL: triggerDigReaction leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(300, 3000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");

  const tilesSeen = new Set();
  const subCellsSeen = new Set();
  for (const cap of caps) {
    tilesSeen.add(cap.regs.b);
    subCellsSeen.add(cap.regs.e & 7);
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `tile=${hx(cap.regs.b)}: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical to the oracle; ` +
      `tile codes {${[...tilesSeen].sort((x, y) => x - y).map(hx).join(",")}}, ` +
      `sub-cells {${[...subCellsSeen].sort((x, y) => x - y).join(",")}}`,
  );
});

// -- 2. EQUAL over a crafted sweep of every branch ---------------------------

test("EQUAL (crafted): every branch of the classifier matches the oracle", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft branch entries from");

  const arms = [
    ["escape band 54..57", { tile: 56, pos: 3, arm: 0 }],
    ["always-hit 42, unarmed", { tile: 42, pos: 0, arm: 0 }],
    ["always-hit 65, armed (sound)", { tile: 65, pos: 3, arm: 1 }],
    ["always-hit 193, armed (sound)", { tile: 193, pos: 5, arm: 2 }],
    ["196 bit-2 set -> latch (armed)", { tile: 196, pos: 4, arm: 1 }],
    ["196 bit-2 clear -> keep moving", { tile: 196, pos: 1, arm: 1 }],
    ["150..153 bit-2 set -> latch", { tile: 151, pos: 4, arm: 1 }],
    ["150..153 bit-2 clear -> lookup", { tile: 151, pos: 1, arm: 0, neighbour: 128 }],
    [">=154 keep moving", { tile: 160, pos: 2, arm: 1 }],
    ["<113 keep moving", { tile: 80, pos: 2, arm: 1 }],
    ["diggable mismatch, no sound + neighbour", { tile: 120, pos: 3, arm: 0, neighbour: 133 }],
    ["diggable mismatch + sound + neighbour", { tile: 120, pos: 3, arm: 1, neighbour: 133 }],
    ["diggable boundary (sub-cell 0), skip neighbour", { tile: 120, pos: 0, arm: 1 }],
    ["diggable mismatch, neighbour out of range", { tile: 120, pos: 2, arm: 0, neighbour: 16 }],
  ];

  for (const [name, spec] of arms) {
    const d = stateDiff(craft(base, spec), idiomatic);
    assert.equal(d, null, d && `[${name}] state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/crafted: ${arms.length} branch arms identical to the oracle`);
});

// -- 3. NON-VACUOUS: the staged reaction bytes are actually written ----------

test("NON-VACUOUS: with the reaction bytes pre-set to a sentinel, both arms overwrite all and agree", () => {
  const [base] = captureDispatches(1, 3000);
  // tile 120, sub-cell 3, unarmed, diggable neighbour -> full staged reaction, no sound.
  const entry = craft(base, { tile: 120, pos: 3, arm: 0, neighbour: 133 });
  const SENTINEL = 0x55;
  for (const addr of REACTION_BYTES) entry.mem.write8(addr, SENTINEL);

  const a = entry.clone(); // oracle
  const b = entry.clone(); // idiomatic
  oracle(a);
  idiomatic(b);

  for (const addr of REACTION_BYTES) {
    assert.notEqual(b.mem.read8(addr), SENTINEL, `idiomatic left ${hx(addr)} unwritten (still the sentinel)`);
  }
  const d = stateDiffOutsideStack(a, b, entry.regs.sp);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  console.log(`  NON-VACUOUS: all ${REACTION_BYTES.length} reaction bytes overwritten from the sentinel; arms agree`);
});

// -- 4. TEETH (reaction): a wrong reaction step is CAUGHT --------------------

/** Broken twin: does the real work, then writes the wrong reaction-step value. */
function twinWrongStep(m) {
  idiomatic(m);
  m.mem.write8(REACTION_STEP, 0); // BUG: the staged reaction step should be 3
}

test("TEETH (reaction): a twin that writes the wrong reaction step is CAUGHT at 0x80a2", () => {
  const [base] = captureDispatches(1, 3000);
  const entry = craft(base, { tile: 120, pos: 3, arm: 0, neighbour: 133 }); // mismatch stages the reaction

  const d = stateDiff(entry, twinWrongStep);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong-reaction-step twin — it proves nothing");
  assert.equal(d.addr, REACTION_STEP, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(REACTION_STEP)})`);

  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/reaction: wrong-step twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 5. TEETH (sound): a wrong sound request is CAUGHT -----------------------

/** Broken twin: does the real work (which requests the sound), then corrupts the just-filled
 *  ring slot to a different command. */
function twinWrongSound(m) {
  const slot = m.mem.read8(SOUND_HEAD);
  idiomatic(m); // fills ring[slot] with the pending reaction sound, advances the pointer
  m.mem.write8(SOUND_RING + slot, 21 | 0x80); // BUG: wrong sound command in the slot
}

test("TEETH (sound): a twin that requests the wrong sound is CAUGHT at the ring slot", () => {
  const [base] = captureDispatches(1, 3000);
  const entry = craft(base, { tile: 65, pos: 3, arm: 1 }); // always-hit, armed -> the sound path
  const slot = entry.mem.read8(SOUND_HEAD);

  const d = stateDiff(entry, twinWrongSound);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong-sound twin — it proves nothing");
  assert.equal(d.addr, SOUND_RING + slot, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(SOUND_RING + slot)})`);

  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/sound: wrong-sound twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
