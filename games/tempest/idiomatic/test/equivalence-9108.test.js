// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for reseedWaveWorkingSet (ROM 0x9108, second entry of selectWaveStartSlot.js) vs the
// frozen loc_9108, whole path to its rts: the reseed body then the fall into loc_9149 (tickWaveSpawnCadence).
// Contract: RAM minus STACK_SCRATCH, plus the exit [X, Y] it returns (compared on the CAPTURE arm). Its only
// return site is c7bd's rts-dispatch back into the frame loop at 0xc7b3, whose next jsr (c891) may hand X and Y
// to the sound loader (ccc7 stashes them in $31/$32), so the frame loop threads them on. POKEY RANDOM (read on the off-sign spawn) is frozen both sides.
// Run: node --test games/tempest/idiomatic/test/equivalence-9108.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9108 as oracle } from "../../translated/loc_90c4.js";
import { reseedWaveWorkingSet } from "../selectWaveStartSlot.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH, GAME_MODE, MODE_DELAY_TIMER, STATUS_FLAGS, loc_3d, LEVEL_ID, INPUT_EDGE_FLAGS, PASS_COUNTER,
  TUBE_GEOM_FLAG, SPINNER_ACCUM, RIM_ROT_OFFSET,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);
// Three coins then START2 (IN2 0x40): a two-player game. 0x9108 is GAME_MODE 0x1c, which only c9af (turn
// over) arms, as the pending mode, when the next seat's PLAYER_LEVEL_TBL entry is still 0xff (that seat never
// started). Attract and a one-player game did not dispatch it in 8000 frames; player 1's first death here does
// (~f1224).
const TAPE_2P = [70, 100, 130].map((frame) => ({ port: 0, bits: 0x04, frame, dur: 15 }))
  .concat([{ port: 2, bits: 0x40, frame: 170, dur: 20 }]);

const TARGET = 0x9108;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

// Hook 0x9108 (m.call'd only by c7bd's table rts-dispatch; loc_90c4 falls in directly) and clone each dispatch.
function captureDispatches(K, maxFrames, tape) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  const m = new Machine(ROM, { overrides: snap, ...OPTS });
  m.inputTape = tape;
  try { m.runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(12, 1300, TAPE_2P) : [];

const base = () => freezePokey((CAPS[0] ?? new Machine(ROM, OPTS)).clone());
function pair(pokes) {
  const o = base(), c = base();
  for (const m of [o, c]) for (const [a, v] of pokes) m.mem.write8(a, v);
  return { o, c };
}
const sign = (on) => [STATUS_FLAGS, ((CAPS[0]?.mem.read8(STATUS_FLAGS) ?? 0) & 0x7f) | (on ? 0x80 : 0)];

test("CAPTURE: real 0x9108 dispatches -- reseedWaveWorkingSet == oracle in RAM (-stack)", () => {
  let checked = 0;
  const arms = new Set();
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(reseedWaveWorkingSet(c, ey, ex), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    arms.add(`sign=${cap.mem.read8(STATUS_FLAGS) >> 7} seat=${cap.mem.read8(LEVEL_ID) ? 1 : 0}`);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} compared; arms seen: ${[...arms].join(", ")}`);
  assert.ok(CAPS.length > 0, "positive control: no real 0x9108 dispatch was captured");
  assert.ok(checked > 0, "no captured dispatch ran to its rts");
});

// [label, pokes, oracle-side witness]. Off-sign zeroes PASS_COUNTER and phase, so the tick underflows the
// phase to 0x99, arms edge bit 0x10 and fires a random spawn; on-sign primes the intro (count 20, phase 0x10).
const ARMS = [
  ["seat 0, off-sign: tick + random spawn", [[LEVEL_ID, 0], sign(false), [INPUT_EDGE_FLAGS, 0x80]],
    (o) => o.mem.read8(loc_3d) === 0 && o.mem.read8(MODE_DELAY_TIMER) === 0x99 && o.mem.read8(GAME_MODE) === 2],
  ["seat 1 (table swap), off-sign", [[LEVEL_ID, 1], sign(false), [INPUT_EDGE_FLAGS, 0x80]],
    (o) => o.mem.read8(loc_3d) === 1 && o.mem.read8(GAME_MODE) === 2],
  ["seat 0, intro, no fire", [[LEVEL_ID, 0], sign(true), [INPUT_EDGE_FLAGS, 0x80]],
    (o) => o.mem.read8(GAME_MODE) === 22 && o.mem.read8(MODE_DELAY_TIMER) === 0x10
      && o.mem.read8(PASS_COUNTER) === 19 && o.mem.read8(TUBE_GEOM_FLAG) === 0xff],
  ["seat 1 (table swap), intro, fire from table", [[LEVEL_ID, 1], sign(true), [INPUT_EDGE_FLAGS, 0x88]],
    (o) => o.mem.read8(loc_3d) === 1 && o.mem.read8(GAME_MODE) === 2 && o.mem.read8(PASS_COUNTER) === 19],
  ["seat 0, intro, spinner moving", [[LEVEL_ID, 0], sign(true), [INPUT_EDGE_FLAGS, 0x80], [SPINNER_ACCUM, 0x05]],
    (o) => o.mem.read8(SPINNER_ACCUM) === 0 && o.mem.read8(RIM_ROT_OFFSET) === 0],
];

for (const [label, pokes, witness] of ARMS) {
  test(`CRAFTED (${label}): RAM equal`, () => {
    const { o, c } = pair(pokes);
    oracle(o);
    assert.ok(witness(o), `oracle did not take the ${label} arm`);
    reseedWaveWorkingSet(c);
    assert.equal(ramDiff(o, c), null);
  });
}

// BUG twin: tests the intro (sign) flag inverted.
const broken = (m) => {
  const s = m.mem8[STATUS_FLAGS];
  m.mem8[STATUS_FLAGS] = s ^ 0x80; reseedWaveWorkingSet(m); m.mem8[STATUS_FLAGS] = s;
};

test("TEETH: the inverted-intro-flag twin diverges (crafted + every real dispatch)", () => {
  const { o, c } = pair(ARMS[2][1]);
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "inverted intro flag NOT caught");
  console.log(`  TEETH: crafted caught at 0x${d.addr.toString(16)}`);
  let caught = 0;
  for (const cap of CAPS) {
    const oo = freezePokey(cap.clone()), cc = freezePokey(cap.clone());
    try { oracle(oo); } catch { continue; }
    broken(cc);
    assert.notEqual(ramDiff(oo, cc), null, "twin escaped at a real dispatch");
    caught++;
  }
  console.log(`  TEETH: caught at ${caught} real dispatch(es)`);
});

test("SP-TOOTH: reseedWaveWorkingSet omits its ret and is seam-placeable (moved 0)", () => {
  const { c: m } = pair(ARMS[2][1]);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, reseedWaveWorkingSet, TARGET, m);
  assert.equal(r.placeable, true, `reseedWaveWorkingSet must be seam-placeable; got: ${r.error}`);
});
