// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for seedFramePhaseAndTick (ROM 0xc891-0xc90b) -- the per-frame dispatcher. It sets speed/mode cells from
// the coin input + phase counters, then a common tail advances FRAME_COUNTER and fires the sub-steps advanceLevelCounter
// (c8d2), stepEaromTransfer (odd frames) and requestActiveSoundCue (when SOUND_STEP_GATE is live), threading the slot index X/Y from one to
// the next. Contract: RAM (dumpState minus stack scratch below the entry SP), plus the exit [X, Y] it returns (compared on the CAPTURE and CRAFTED setup arms). The ROM's decimal-mode arm (SED gated on
// DECIMAL_MODE_FLAG != 0 && loc_9f > 0x13) is DEAD -- DECIMAL_MODE_FLAG is the checksum 0xa7 ^ fold(ROM[0xaace..0xaad8]) of a
// fixed program-ROM span, which is 0, so the gate never opens (verified statically and by a MAME tap over
// gameplay). The idiomatic routine omits it; on every reachable state D is left untouched, matching the
// oracle, which the CAPTURE test still checks. c891 is a full JS dispatcher (calls its sub-steps as JS),
// not an omitted-ret leaf, so there is no SP-tooth. The X/Y threading into requestActiveSoundCue is load-bearing: ccfa
// forwards them to loadSoundVoiceSlots, which stamps loc_31/loc_32 -- a stale (entry) X/Y writes the wrong cells.
// Run: node --test games/tempest/idiomatic/test/equivalence-c891.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c891 } from "../../translated/loc_c891.js";
import { seedFramePhaseAndTick } from "../seedFramePhaseAndTick.js";
import { advanceLevelCounter } from "../advanceLevelCounter.js";
import { stepEaromTransfer } from "../stepEaromTransfer.js";
import { requestActiveSoundCue } from "../requestActiveSoundCue.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  FRAME_COUNTER, SOUND_STEP_GATE, GAME_MODE, MODE_DISPATCH_SEL, PHASE_COUNTER, loc_a2, loc_31, loc_32, IN0_PORT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc891;
const oracle = atEntry(loc_c891);
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 4000) : [];

test("CAPTURE: real 0xc891 dispatches -- seedFramePhaseAndTick == oracle in RAM (-stack) and in the D flag", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(seedFramePhaseAndTick(c, ex, ey), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.fD, o.regs.fD, "decimal-flag live-out matches");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} compared`);
});

// Force the tail sub-steps: odd frame (so stepEaromTransfer runs) and SOUND_STEP_GATE live (so requestActiveSoundCue runs).
const forceTailSubsteps = (m) => { m.mem.write8(FRAME_COUNTER, 0x00); m.mem.write8(SOUND_STEP_GATE, 0x01); };

test("CRAFTED: requestActiveSoundCue reached (odd frame + SOUND_STEP_GATE live) -- RAM equal, X/Y threaded correctly", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()); forceTailSubsteps(o);
    const c = freezePokey(cap.clone()); forceTailSubsteps(c);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    seedFramePhaseAndTick(c);
    assert.equal(ramDiff(o, c), null, "RAM equal after the ccfa-reaching tail (loc_31/loc_32 stamped by threaded X/Y)");
    checked++;
  }
  console.log(`  CRAFTED ccfa: ${checked} states`);
  assert.ok(checked >= 1, "no state reached the ccfa tail cleanly");
});

// The setup branches that feed X/Y, from a live state with crafted cells. Entry X/Y are 0x5a and the per-seed ey (0xa5,
// or 1 for C and E, which tells the loaded PHASE_COUNTER apart from the entry Y), and m.regs is poisoned, so a dropped
// PHASE_COUNTER load or a discarded c81b exit shows in RAM or the pair.
const SETUP_SEEDS = [
  // A: odd phase, PHASE_COUNTER 1, gate armed -> the Y=1 branch (mode 0x0a), no level step.
  { name: "A odd phase Y=1", ey: 0xa5, cells: { 0x05: 0x00, 0x0a: 0x01, 0x06: 0x01, 0xa2: 0x80, 0x4e: 0x20, 0x03: 0x01, 0x0c: 0x01, 0x09: 0x01 },
    control: (o) => o.mem8[GAME_MODE] === 0x0a && o.mem8[MODE_DISPATCH_SEL] === 0x16 && o.regs.y === 0x01 },
  // B: even phase, PHASE_COUNTER 2, advance pending, even frame, sound live -> c81b's exit [0, 1] reaches the loader.
  { name: "B even phase c81b", ey: 0xa5, cells: { 0x05: 0x00, 0x0a: 0x00, 0x06: 0x02, 0x4e: 0x20, 0x03: 0x01, 0x0c: 0x01, 0x09: 0x01 },
    control: (o, pcs) => !pcs.has(0xc8a9) && o.mem8[PHASE_COUNTER] === 0x01 && (o.mem8[FRAME_COUNTER] & 1) === 0 },
  // C: odd phase, PHASE_COUNTER 3 (>= 2), gate armed -> mode 0x14 then c81b. Entry Y 1 would take the Y=1 branch.
  { name: "C odd phase Y>=2", ey: 0x01, cells: { 0x05: 0x00, 0x0a: 0x01, 0x06: 0x03, 0xa2: 0x80, 0x4e: 0x20, 0x03: 0x01, 0x0c: 0x01, 0x09: 0x01 },
    control: (o, pcs) => pcs.has(0xc8ca) && o.mem8[loc_a2] === 0x00 && o.mem8[PHASE_COUNTER] === 0x02 && (o.mem8[FRAME_COUNTER] & 1) === 0 },
  // D: even phase, PHASE_COUNTER 2, no advance pending ($4e&0x60 = 0) -> c81b hands back the entry X.
  { name: "D even phase c81b no advance", ey: 0xa5, cells: { 0x05: 0x00, 0x0a: 0x00, 0x06: 0x02, 0x4e: 0x00, 0x03: 0x01, 0x0c: 0x01, 0x09: 0x01 },
    control: (o) => o.mem8[PHASE_COUNTER] === 0x02 && o.regs.x === 0x5a && o.regs.y === 0x00 },
  // E: odd phase, PHASE_COUNTER 2 (the >= 2 boundary), gate armed -> mode 0x14 then c81b, not the Y=1 branch.
  { name: "E odd phase Y=2", ey: 0x01, cells: { 0x05: 0x00, 0x0a: 0x01, 0x06: 0x02, 0xa2: 0x80, 0x4e: 0x20, 0x03: 0x01, 0x0c: 0x01, 0x09: 0x01 },
    control: (o, pcs) => pcs.has(0xc8ca) && o.mem8[loc_a2] === 0x00 },
];

test("CRAFTED setup: PHASE_COUNTER load and c81b exit thread to the loader -- RAM, loc_31/loc_32 and [X, Y] equal", () => {
  assert.ok(CAPS.length > 0, "no capture to seed from");
  for (const { name, ey, cells, control } of SETUP_SEEDS) {
    const base = freezePokey(CAPS[CAPS.length - 1].clone());
    for (const [a, v] of Object.entries(cells)) base.mem.write8(+a, v);
    base.regs.x = 0x5a; base.regs.y = ey;
    assert.notEqual(base.mem8[IN0_PORT] & 0x10, 0, `${name}: coin input bit4 set, so setup is not skipped`);
    const o = base.clone(), pcs = new Set();
    { const st = o.step.bind(o); o.step = (pc, cy) => { pcs.add(pc); return st(pc, cy); }; }
    oracle(o);
    assert.ok(control(o, pcs), `${name}: positive control -- the oracle took the intended branch`);
    if (name[0] === "B" || name[0] === "C") assert.deepEqual([o.regs.x, o.regs.y, o.mem8[loc_31], o.mem8[loc_32]], [0, 1, 0, 1], `${name}: c81b ran, its exit stashed`);
    const c = base.clone(); c.regs.x = 0x33; c.regs.y = 0xcc;
    assert.deepEqual(seedFramePhaseAndTick(c, 0x5a, ey), [o.regs.x, o.regs.y], `${name}: returned exit [X, Y]`);
    assert.deepEqual([c.mem8[loc_31], c.mem8[loc_32]], [o.mem8[loc_31], o.mem8[loc_32]], `${name}: loc_31/loc_32`);
    assert.equal(ramDiff(o, c), null, `${name}: RAM equal`);
  }
});

// A full copy of seedFramePhaseAndTick identical EXCEPT the ccfa call hands over the stale (entry-register) X/Y
// instead of the threaded locals -- the exact R37 defect this routine's threading prevents.
function brokenStaleBridge(m, x = m.regs.x, y = m.regs.y) {
  const rd = (a) => m.mem8[a], wr = (a, v) => { m.mem8[a] = v & 0xff; };
  let toC81b = false, toTail = false;
  if ((rd(0x0c00) & 0x10) === 0) { wr(0x00, 0x22); toTail = true; }
  else if ((rd(0x05) & 0x40) !== 0) { toTail = true; }
  else if ((rd(0x0a) & 0x01) === 0) { toC81b = true; }
  else {
    y = rd(0x06);
    if (y === 0) wr(0xa2, 0x80);
    if ((rd(0xa2) & 0x80) === 0) toC81b = true;
    else if (y >= 2) { wr(0x00, 0x14); wr(0xa2, 0x00); toC81b = true; }
    else if (y !== 0) { wr(0x01, 0x16); wr(0x00, 0x0a); }
  }
  if (!toTail) {
    if (toC81b && rd(0x06) !== 0) [x, y] = advanceLevelCounter(m, x);
    if ((rd(0x09) & 0x03) === 0) wr(0x06, 0x02);
  }
  wr(0x03, rd(0x03) + 1);
  if ((rd(0x03) & 0x01) !== 0) [x, y] = stepEaromTransfer(m, x, y);
  if (rd(0x0c) !== 0) requestActiveSoundCue(m); // BUG: stale entry X/Y from the bridge, not the threaded de1b/c81b exit
  if ((rd(0x4e) & 0x80) !== 0) wr(0x4e, 0x00);
}

test("TEETH (X/Y threading): a twin that lets requestActiveSoundCue read the stale bridge diverges from the oracle", () => {
  // On an odd frame stepEaromTransfer changes X/Y, so a ccfa that reads the entry registers stamps the wrong
  // loc_31/loc_32. Scan the forced states for one that diverges (the design measured ~148/200), proving it.
  let caught = false, tried = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()); forceTailSubsteps(o);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const s = freezePokey(cap.clone()); forceTailSubsteps(s);
    brokenStaleBridge(s);
    tried++;
    if (ramDiff(o, s) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no state could be exercised for the threading teeth");
  assert.ok(caught, "the RAM diff FAILED to catch a stale-bridge ccfa on every exercised state");
});
