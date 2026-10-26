// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for spawnAltPhaseActor (ROM 0x37cf) — the alt-phase actor's
 * per-frame entry point: on the first frame it builds the primary+twin records, marks
 * the actor live, plays the spawn sound, and stamps its opening 2x4 tile+colour block;
 * every frame after, it hands off to the per-frame animator (advanceAltPhaseActor).
 *
 * The whole observable effect is memory: the seeded actor/twin records, the spawn flag,
 * the queued sound command, the stamped tile+colour block, and the two staged sprite
 * records the tail stager (stageActorSpriteRecords) builds. Registers, flags, and the
 * return address the oracle pushes for the sound call are dead — the caller chain is all
 * tail-jumps that read no returned register. So the contract is work+video+colour+sprite
 * RAM, MINUS the dead stack scratch: SP boots at 0x83ff and the oracle's sound-call push
 * leaves residue at 0x83f7-0x83fc that a direct-call rewrite (which uses the JS call
 * stack, not the Z80 stack) does not reproduce. That residue is the ONLY thing that
 * differs — every byte of real data matches.
 *
 * Attract keeps the actor already-active, so the natural dispatches almost all take the
 * animate hand-off; there is exactly one natural first-frame spawn (sub-phase 1, start
 * row 23). The other start-row arm (sub-phase 2, row 22) is forced with a crafted entry.
 *
 *   1. REALISM — hook 0x37cf across an attract run (dispatched hundreds of times), clone
 *      at each dispatch, run oracle vs idiomatic on two fresh clones, diff RAM minus the
 *      stack scratch. Covers every already-active hand-off AND the one natural spawn.
 *   2. NATURAL SPAWN — pull the one real first-frame-spawn dispatch out of the captures
 *      and prove idiomatic == oracle on that real state specifically.
 *   3. CRAFTED — force the row-22 sub-phase and other sub-phases on a real background, and
 *      a sentinel-preset non-vacuous check proving the spawn overwrites every target byte.
 *   4. TEETH — a twin whose shadow twin trails the wrong column offset MUST be caught.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-37cf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_37cf as oracle } from "../../translated/loc_37cf.js";
import { spawnAltPhaseActor as idiomatic } from "../spawnAltPhaseActor.js";
import { makeMachineFactory } from "../../machine.js";
import {
  BOARD_END_PHASE, ENEMY3_X, ENEMY3_Y, ENEMY3_TILE, ENEMY3_TIMER,
  ENEMY3_TWIN_X, ENEMY3_TWIN_TILE, ENEMY3_TWIN_Y,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x37cf;
const CAPTURE_FRAMES = 6000; // enough to reach the one natural first-frame spawn
const PRIMARY_PAIRED = 0x810c; // primary paired-display byte (unnamed in names.js)
const TWIN_PAIRED = 0x811d; // twin paired-display byte (unnamed in names.js)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The Z80 stack lives at the top of work RAM (SP boots at 0x83ff). The oracle pushes a
// return address for its sound call; that residue lands here and is dead scratch no
// routine names. The memory-equivalence contract is RAM minus stack scratch below the entry SP.
const STACK = { lo: 0x8300, hi: 0x8400 };

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** First differing RAM byte between two dumps, excluding stack scratch below `entrySP`. */
function firstRamDiffExStack(a, b, offToAddr, entrySP) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (deadStackBelow(STACK, entrySP)(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

/** Run oracle and candidate on two FRESH clones of `entry`; return the first RAM
 *  difference outside the stack scratch below the entry SP (or null). */
function ramDiff(entry, candidate) {
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  candidate(b);
  return firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), entry.regs.sp);
}

/** Capture a clone at every 0x37cf dispatch across an attract run, tagging each with the
 *  spawn-flag byte seen at entry (255 = already-active hand-off, else a spawn sub-phase). */
function captureDispatches() {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    const c = mm.clone();
    c._entryPhase = mm.mem.read8(BOARD_END_PHASE);
    caps.push(c);
    return oracle(mm);
  }]]);
  makeMachine(snapshot).runFrames(CAPTURE_FRAMES);
  return caps;
}

/** A crafted entry: a real captured background with the spawn flag poked to a sub-phase. */
function craft(base, pokes) {
  const e = base.clone();
  for (const [addr, val] of pokes) e.mem.write8(addr, val);
  return e;
}

// Capture once and share (an attract run is not cheap).
const caps = ROM_PRESENT ? captureDispatches() : [];

// -- 1. REALISM: every real dispatch, RAM minus stack scratch -----------------

test("REALISM: idiomatic == oracle on real RAM over every real attract dispatch", () => {
  assert.ok(caps.length >= 100, `expected many real 0x37cf dispatches, got ${caps.length}`);
  let checked = 0;
  for (const cap of caps) {
    const d = ramDiff(cap, idiomatic);
    assert.equal(
      d,
      null,
      d && `RAM diverges at ${hx(d.addr ?? 0)} (oracle=${d.a} idiomatic=${d.b}) on dispatch ${checked}`,
    );
    checked++;
  }
  console.log(`  REALISM: ${checked} real dispatches — real RAM identical to the oracle`);
});

// -- 2. NATURAL SPAWN: the one real first-frame-spawn dispatch -----------------

test("NATURAL SPAWN: idiomatic == oracle on the real first-frame-spawn dispatch", () => {
  const spawns = caps.filter((c) => c._entryPhase !== 255);
  assert.ok(spawns.length >= 1, `expected at least one natural spawn dispatch, got ${spawns.length}`);
  for (const cap of spawns) {
    const d = ramDiff(cap, idiomatic);
    assert.equal(d, null, d && `spawn RAM diverges at ${hx(d.addr ?? 0)} (oracle=${d.a} idiomatic=${d.b})`);
  }
  console.log(
    `  NATURAL SPAWN: ${spawns.length} real spawn dispatch(es) (sub-phase ${spawns[0]._entryPhase}) — real RAM identical`,
  );
});

// -- 3. CRAFTED: the row-22 sub-phase + non-vacuous write-completeness ---------

test("CRAFTED: both start-row sub-phases match the oracle on real backgrounds", () => {
  const bg = caps[caps.length - 1];
  const crafted = [
    { tag: "sub-phase 2 -> start row 22", pokes: [[BOARD_END_PHASE, 2]] },
    { tag: "sub-phase 1 -> start row 23", pokes: [[BOARD_END_PHASE, 1]] },
    { tag: "sub-phase 0 -> start row 23", pokes: [[BOARD_END_PHASE, 0]] },
    { tag: "sub-phase 3 -> start row 23", pokes: [[BOARD_END_PHASE, 3]] },
    { tag: "sub-phase 200 -> start row 23", pokes: [[BOARD_END_PHASE, 200]] },
  ];
  for (const { tag, pokes } of crafted) {
    const d = ramDiff(craft(bg, pokes), idiomatic);
    assert.equal(d, null, d && `crafted "${tag}": RAM diverges at ${hx(d.addr ?? 0)} (oracle=${d.a} idiomatic=${d.b})`);
  }
  console.log(`  CRAFTED: ${crafted.length} forced spawn sub-phases — real RAM identical to the oracle`);
});

test("NON-VACUOUS: every spawn target is overwritten from a sentinel and both arms agree", () => {
  const SENTINEL = 0x55;
  // Every byte the first-frame spawn writes from a constant (records + block + a sample of
  // the staged sprite bytes); BOARD_END_PHASE is set to 2 to select the spawn path deterministically.
  const RECORD_TARGETS = [
    ENEMY3_Y, ENEMY3_TWIN_Y, ENEMY3_X, ENEMY3_TWIN_X, ENEMY3_TILE, ENEMY3_TWIN_TILE, ENEMY3_TIMER,
    PRIMARY_PAIRED, TWIN_PAIRED,
  ];
  const BLOCK_TARGETS = [
    0x9343, 0x9344, 0x9363, 0x9364, 0x9383, 0x9384, 0x93a3, 0x93a4, // video cells
    0x8b43, 0x8b44, 0x8b63, 0x8b64, 0x8b83, 0x8b84, 0x8ba3, 0x8ba4, // colour cells
  ];

  const base = caps[caps.length - 1].clone();
  base.mem.write8(BOARD_END_PHASE, 2); // select the spawn path (row 22)
  for (const addr of [...RECORD_TARGETS, ...BLOCK_TARGETS]) base.mem.write8(addr, SENTINEL);

  const a = base.clone();
  const b = base.clone();
  oracle(a);
  idiomatic(b);

  for (const addr of [...RECORD_TARGETS, ...BLOCK_TARGETS]) {
    assert.notEqual(b.mem.read8(addr), SENTINEL, `idiomatic left ${hx(addr)} unwritten (still the sentinel)`);
  }
  assert.equal(b.mem.read8(BOARD_END_PHASE), 255, "spawn must mark the actor active (255)");
  const d = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  console.log(`  NON-VACUOUS: all ${RECORD_TARGETS.length + BLOCK_TARGETS.length} spawn targets overwritten, arms agree`);
});

// -- 4. TEETH: a deliberately-broken twin MUST be caught ----------------------

/** Broken twin: spawns correctly, then puts the shadow twin at the wrong column offset. */
function brokenShadowOffset(m) {
  idiomatic(m);
  m.mem.write8(ENEMY3_TWIN_X, 48); // BUG: shadow offset should be +16 (column 32), not +32
}

test("TEETH: a wrong shadow-column-offset twin is CAUGHT", () => {
  const bg = caps[caps.length - 1];
  const spawnEntry = craft(bg, [[BOARD_END_PHASE, 2]]);
  const d = ramDiff(spawnEntry, brokenShadowOffset);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong shadow-offset twin — it proves nothing");
  assert.equal(d.addr, ENEMY3_TWIN_X, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(ENEMY3_TWIN_X)})`);
  console.log(`  TEETH: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
