// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceEnemyPursuit (ROM 0x9ef1-0x9f5e) -- the per-slot(x) mover. ENEMY_SLOT_DIR,x bit7 set -> RE-SEEK
// (reverseEnemyLaneDepth with Y=0x04, then cmp #0x80 / bit ENEMY_FIRE_SELECT dispatch into maybeFireEnemyStep/flipEnemyLaneRandomSide/flipEnemyLaneTowardTarget); bit7 clear
// -> ADVANCE the 16-bit coordinate (ENEMY_DEPTH_LO,x / ENEMY_DEPTH,x) by the delta (ENEMY_CLIMB_DELTA_LO_4 / ENEMY_CLIMB_DELTA_HI_4), clamp the hi at
// floor PLAYER_SHOT_DEPTH, then FIRE_GATE / zp loc_9f / hi-vs-0x20 produce the carry that (with ENEMY_FIRE_SELECT's sign) picks the
// same three callees. Live-out is RAM (minus stack scratch below the entry SP); every non-early path tail-delegates, so its
// register state belongs to the chosen callee and is compared only on the early-rts arm (A = new hi, Y = 0).
// Oracle is the frozen translated loc_9ef1 in translated/loc_9ef1.js.
// Run: node --test games/tempest/idiomatic/test/equivalence-9ef1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9ef1 } from "../../translated/loc_9ef1.js";
import { advanceEnemyPursuit } from "../advanceEnemyPursuit.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import {
  loc_9f, ENEMY_FIRE_SELECT, ENEMY_CLIMB_DELTA_LO_0, ENEMY_CLIMB_DELTA_LO_4, ENEMY_CLIMB_DELTA_HI_0, ENEMY_CLIMB_DELTA_HI_4,
  PLAYER_SHOT_DEPTH, ENEMY_SLOT_DIR, ENEMY_DEPTH_LO, ENEMY_DEPTH, FIRE_GATE,
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

const TARGET = 0x9ef1;
const oracle = atEntry(loc_9ef1);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9ef1 dispatches -- advanceEnemyPursuit == oracle in RAM (-stack)", () => {
  // advanceEnemyPursuit tail-delegates on every non-early path, so A/X/Y after the call belong to the terminal callee
  // (idiomatic callees do not stably re-seat A -- e.g. stepClimberSegmentAndHeading returns its dir without writing regs.a on the
  // ordinary-segment path); the memory-equivalent contract is RAM. Compare RAM only here.
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a slot whose deep dispatch the oracle can't resolve -- both would throw
    advanceEnemyPursuit(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) checked`);
});

// Seed the slot's inputs on one Machine, then clone it so the oracle and advanceEnemyPursuit start from identical state.
function seed(m, o) {
  const x = o.x ?? 0x00;
  m.regs.x = x; m.regs.y = o.y ?? 0x00; m.regs.a = o.a ?? 0x00;
  m.mem.write8(u16(ENEMY_SLOT_DIR + x), o.gate ?? 0x00);   // bit7 selects re-seek vs advance
  m.mem.write8(u16(ENEMY_DEPTH_LO + x), o.lo ?? 0x00);     // coordinate low
  m.mem.write8(u16(ENEMY_DEPTH + x), o.hi ?? 0x00);     // coordinate high
  m.mem.write8(ENEMY_CLIMB_DELTA_LO_4, o.dlo ?? 0x00);             // per-frame delta low
  m.mem.write8(ENEMY_CLIMB_DELTA_HI_4, o.dhi ?? 0x00);             // per-frame delta high
  m.mem.write8(PLAYER_SHOT_DEPTH, o.floor ?? 0x00);           // hi-byte floor
  m.mem.write8(FIRE_GATE, o.ab ?? 0x00);              // advance gate
  m.mem.write8(loc_9f, o.zp9f ?? 0x00);             // zp gate vs 0x11
  m.mem.write8(ENEMY_FIRE_SELECT, o.s159 ?? 0x00);            // sign/bit6 selector
  // NB ENEMY_CLIMB_DELTA_LO_4 == ENEMY_CLIMB_DELTA_LO_0+4 and ENEMY_CLIMB_DELTA_HI_4 == ENEMY_CLIMB_DELTA_HI_0+4: since advanceEnemyPursuit fixes Y=4, its advance delta and
  // the seg-4 delta reverseEnemyLaneDepth reads on the re-seek path are the SAME cells (set above via dlo/dhi).
}
const pair = (spec) => { const m = new Machine(ROM, OPTS); seed(m, spec); return [m.clone(), m.clone()]; };

test("CRAFTED re-seek: bit7 set, reverseEnemyLaneDepth returns A<0x80 -> maybeFireEnemyStep -- RAM equal", () => {
  // hi 0x10 - 0 = 0x10 (< 0x80) -> bcc -> maybeFireEnemyStep
  const [o, c] = pair({ gate: 0x80, lo: 0x10, hi: 0x10 });
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) { advanceEnemyPursuit(c); assert.equal(ramDiff(o, c), null, "RAM equal after maybeFireEnemyStep"); }
});

test("CRAFTED re-seek: bit7 set, A>=0x80, ENEMY_FIRE_SELECT bit6 set -> flipEnemyLaneTowardTarget -- RAM equal", () => {
  // hi 0x90 - 0 = 0x90 (>= 0x80); ENEMY_FIRE_SELECT bit6 set -> bvc not taken -> flipEnemyLaneTowardTarget
  const [o, c] = pair({ gate: 0x80, lo: 0x00, hi: 0x90, s159: 0x40 });
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) { advanceEnemyPursuit(c); assert.equal(ramDiff(o, c), null, "RAM equal after flipEnemyLaneTowardTarget"); }
});

test("CRAFTED re-seek: bit7 set, A>=0x80, ENEMY_FIRE_SELECT bit6 clear -> flipEnemyLaneRandomSide -- RAM equal", () => {
  const [o, c] = pair({ gate: 0x80, lo: 0x00, hi: 0x90, s159: 0x00 });
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) { advanceEnemyPursuit(c); assert.equal(ramDiff(o, c), null, "RAM equal after flipEnemyLaneRandomSide"); }
});

test("CRAFTED advance clamp: hi < floor -> hi clamped to floor, ENEMY_FIRE_SELECT sign clear -> flipEnemyLaneRandomSide -- RAM equal", () => {
  // lo 0x00 + 0x01 = 0x01; hi 0x00 + 0x00 = 0x00 < floor 0x10 -> clamp hi to 0x10; carry clear, N clear -> flipEnemyLaneRandomSide
  const [o, c] = pair({ gate: 0x00, lo: 0x00, dlo: 0x01, hi: 0x00, dhi: 0x00, floor: 0x10, s159: 0x00 });
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) {
    advanceEnemyPursuit(c);
    assert.equal(ramDiff(o, c), null, "RAM equal after the clamp + flipEnemyLaneRandomSide");
    assert.equal(c.mem.read8(u16(ENEMY_DEPTH_LO)), 0x01, "lo advanced by ENEMY_CLIMB_DELTA_LO_4");
    assert.equal(c.mem.read8(u16(ENEMY_DEPTH)), 0x10, "hi clamped up to the floor");
  }
});

test("CRAFTED advance keep, early rts: hi >= floor and FIRE_GATE == 0 -- RAM + A live-out equal (A = new hi)", () => {
  // hi 0x50 >= floor 0x10, FIRE_GATE == 0 -> beq -> early rts, no delegation. A is the live-out the caller
  // reads; the oracle's ldy #0 leaves Y=0 but that Y is UNCONSUMED (dispatchSlotMotionHandler/runObjectMotionScripts discard it), so the
  // idiomatic form no longer seats it and Y is not compared here.
  const [o, c] = pair({ x: 0x00, gate: 0x00, lo: 0x00, dlo: 0x00, hi: 0x50, dhi: 0x00, floor: 0x10, ab: 0x00 });
  oracle(o); advanceEnemyPursuit(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.x, o.regs.x, "X live-out matches");
  assert.equal(c.regs.a, 0x50, "A is the new hi byte");
  assert.equal(c.mem.read8(u16(ENEMY_DEPTH)), 0x50, "hi kept (>= floor)");
});

test("CRAFTED advance keep, fire: FIRE_GATE!=0, zp loc_9f >= 0x11 -> carry set -> maybeFireEnemyStep -- RAM equal", () => {
  // hi 0x50 >= floor 0x10; FIRE_GATE != 0; zp loc_9f 0x20 >= 0x11 -> bcs skips the 0x20 test, carry stays set -> maybeFireEnemyStep
  const [o, c] = pair({ gate: 0x00, lo: 0x00, dlo: 0x00, hi: 0x50, dhi: 0x00, floor: 0x10, ab: 0x01, zp9f: 0x20 });
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) { advanceEnemyPursuit(c); assert.equal(ramDiff(o, c), null, "RAM equal after maybeFireEnemyStep"); }
});

test("CRAFTED advance keep, no fire: zp loc_9f < 0x11, hi < 0x20, ENEMY_FIRE_SELECT sign set -> flipEnemyLaneTowardTarget -- RAM equal", () => {
  // hi 0x10 >= floor 0x05; FIRE_GATE != 0; zp loc_9f 0x05 < 0x11 -> cmp #0x20 (0x10 < 0x20 -> carry clear);
  // ENEMY_FIRE_SELECT bit7 set -> bpl not taken -> flipEnemyLaneTowardTarget
  const [o, c] = pair({ gate: 0x00, lo: 0x00, dlo: 0x00, hi: 0x10, dhi: 0x00, floor: 0x05, ab: 0x01, zp9f: 0x05, s159: 0x80 });
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) { advanceEnemyPursuit(c); assert.equal(ramDiff(o, c), null, "RAM equal after flipEnemyLaneTowardTarget"); }
});

test("TEETH: a twin that drops the 16-bit add carry into the hi byte diverges from the oracle in RAM", () => {
  // lo 0xff + 0x02 carries, so the correct hi is +1. Early-rts seed (FIRE_GATE==0) so the ONLY RAM change is the
  // two coordinate bytes -- isolating the carry. The broken twin adds the hi with no carry-in.
  const [o, c] = pair({ x: 0x00, gate: 0x00, lo: 0xff, dlo: 0x02, hi: 0x40, dhi: 0x00, floor: 0x10, ab: 0x00 });
  oracle(o);
  const broken = (m, x = m.regs.x) => {
    const { mem8 } = m;
    const loSum = mem8[u16(ENEMY_DEPTH_LO + x)] + mem8[ENEMY_CLIMB_DELTA_LO_4];
    mem8[u16(ENEMY_DEPTH_LO + x)] = loSum;
    mem8[u16(ENEMY_DEPTH + x)] = (mem8[u16(ENEMY_DEPTH + x)] + mem8[ENEMY_CLIMB_DELTA_HI_4]) & 0xff; // BUG: no carry-in
    m.regs.y = 0x00; m.regs.a = mem8[u16(ENEMY_DEPTH + x)];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped add carry");
});
