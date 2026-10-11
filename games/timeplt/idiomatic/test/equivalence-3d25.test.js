// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for fireBomberShotWhenClearOfPlayer vs its frozen oracle. coin-start never dispatches this address in
// the budget; the attract demo does, and its spawns are the positive control. Real attract entries,
// plus body variants crafted from the one full-path entry, are diffed whole -- minus the frozen
// side's own push window and the scratch registers the dissolved callees leave. Teeth part in memory.
// Run: node --test games/timeplt/idiomatic/test/equivalence-3d25.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { fireBomberShotWhenClearOfPlayer } from "../fireBomberShotWhenClearOfPlayer.js";
import { loc_3d25 as oracle } from "../../translated/loc_3d25.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x3d25;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ERA_COUNT = 0xa8c6;
const SCAN_BANK_FLAG = 0xa8e0;
const BANK_A_FLAG = 0xa840;
const SPAWN_COOLDOWN = 0xa8f4;
const SIDE_TOGGLE = 0xa8d4;
const WINDOW_HALF = 0xa8d6;
const DATA_TOP = 0xadff;
const SCRIBBLE_CELL = 0xa5af; // a compared (non-stack) cell the scratch control flips to prove RAM bites

// The frogger standard: RAM (masked over the frozen side's stack scratch) is the whole contract, and
// only genuine named register live-outs are pinned beside it. This spawn is a pure writer -- its sole
// caller (advanceTwoTileObjectThenTryAimedSpawn) tail-returns and reads no register it leaves, and the
// whole dispatch chain up to serviceEra1BomberObject is memory-only -- so the set is empty. The search
// pointers, doubled velocity pair, aim byte and the exx / ex-af shadows are all scratch, not live-outs.
const GENUINE_LIVE_OUTS = [];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d ? `${d.addr == null ? "reg" : hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical";

let attract = null;
function captureAttract() {
  if (attract) return attract;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => { entries.push(mm.clone()); return oracle(mm); }]]), { tape: [] });
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `attract stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "attract ran short");
  attract = entries;
  return attract;
}

// Bytes below the stack that the oracle moves -- separates a spawn body from a guard bail.
function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  }
  return n;
}

// Whole-dump diff on independent clones, minus the frozen side's push window; then only the genuine
// register live-outs (none here). RAM outside the window must match byte-for-byte.
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  try { candidate(b); } catch (e) { return { addr: null, a: "returned", b: String(e).slice(0, 40) }; }
  if (low <= DATA_TOP) throw new Error(`the stack window ${hex4(low)} reached into game data`);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  return null;
}

function fullPathEntry() {
  for (const e of captureAttract()) if (footprint(e) > 6) return e;
  return null;
}
function craft(fn) { const c = fullPathEntry().clone(); fn(c); return c; }

// Each mutation drives the body down a different arm; the guard trio bails before it.
const VARIANTS = [
  ["bankA phase1 as-is", () => {}],
  ["second bank", (c) => { c.mem8[ERA_COUNT] = 2; c.mem8[SCAN_BANK_FLAG] = 0; }],
  ["phase!=1 scan-skip", (c) => { c.mem8[ERA_COUNT] = 2; c.mem8[SCAN_BANK_FLAG] = 0; c.mem8[BANK_A_FLAG] = 0xff; }],
  ["phase!=1 bankA guarded", (c) => { c.mem8[ERA_COUNT] = 2; c.mem8[SCAN_BANK_FLAG] = 5; c.mem8[BANK_A_FLAG] = 0; }],
  ["no-hit both slots", (c) => { for (let s = 0; s < 2; s++) { c.mem8[u16(c.regs.iy + s * 2)] = 0; c.mem8[u16(c.regs.iy + s * 2 + 0x31)] = 0; } }],
  ["hit on slot 1", (c) => { c.mem8[c.regs.iy & 0xffff] = 0; c.mem8[u16(c.regs.iy + 0x31)] = 0; }],
  ["toggle even", (c) => { c.mem8[SIDE_TOGGLE] = 0x10; }],
  ["toggle odd", (c) => { c.mem8[SIDE_TOGGLE] = 0x11; }],
  ["window tiny", (c) => { c.mem8[WINDOW_HALF] = 1; }],
  ["guard: slot busy", (c) => { c.mem8[c.regs.ix & 0xffff] = 0; }],
  ["guard: cooldown set", (c) => { c.mem8[SPAWN_COOLDOWN] = 7; }],
  ["guard: era 0", (c) => { c.mem8[ERA_COUNT] = 0; }],
];

test("REACHABILITY: attract dispatches the address and reaches the spawn body; coin-start does not",
  { skip }, () => {
    const entries = captureAttract();
    assert.ok(entries.length > 0, "attract never dispatched this address; the instrument is dead");
    const bodies = entries.filter((e) => footprint(e) > 6);
    assert.ok(bodies.length > 0, "attract reached the address but never the spawn body, so every real diff is a guard bail");
    let seen = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => { seen++; return oracle(mm); }]]));
    m.runFrames(ENTRY_FRAMES);
    assert.equal(seen, 0, "coin-start now dispatches this address, so it is the better tape and this note is stale");
    console.log(`  REACHABILITY: attract ${entries.length} dispatches, ${bodies.length} spawn bodies; coin-start ${seen}`);
  });

test("REAL DISPATCHES: every attract entry identical, and at least one runs the body", { skip }, () => {
  const entries = captureAttract();
  for (const e of entries) {
    const d = unitDiff(fireBomberShotWhenClearOfPlayer, e);
    assert.equal(d, null, `an attract dispatch diverged: ${show(d)}`);
  }
  const foots = entries.map(footprint);
  assert.ok(foots.some((n) => n > 6), "no attract dispatch runs the body, so these are trivial guard bails");
  console.log(`  REAL: ${entries.length} attract dispatches identical; footprints ${foots.join(",")}`);
});

test("CRAFTED BODY: both banks, the search hit slots, toggle parity, and the guard trio", { skip }, () => {
  for (const [label, fn] of VARIANTS) {
    const d = unitDiff(fireBomberShotWhenClearOfPlayer, craft(fn));
    assert.equal(d, null, `crafted "${label}" diverged: ${show(d)}`);
  }
  const bankB = footprint(craft(VARIANTS[1][1]));
  assert.ok(bankB > 6, "the second-bank variant no longer runs the spawn body, so it proves nothing about bank choice");
  console.log(`  CRAFTED: ${VARIANTS.length} variants identical; second-bank footprint ${bankB}`);
});

test("STACK: the drift is exactly two bytes and the mask floor clears the data", { skip }, () => {
  const a = fullPathEntry().clone();
  const b = fullPathEntry().clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  fireBomberShotWhenClearOfPlayer(b);
  assert.equal(a.regs.sp - b.regs.sp, 2, `the frozen side no longer re-seats two bytes higher (${a.regs.sp - b.regs.sp})`);
  assert.ok(low > DATA_TOP, `the push window ${hex4(low)} reached down into game data`);
  console.log(`  STACK: spDiff 2; window floor ${hex4(low)}`);
});

test("SCRATCH NOT PINNED: a register-only scribble passes; a RAM scribble is caught", { skip }, () => {
  // No genuine register live-outs, so scribbling a scratch register the routine leaves is DELIBERATELY
  // not flagged -- and the same measurement must still catch a scribbled RAM cell, or the clean read on
  // the register scribble would be worthless.
  const scribbleScratchReg = (mm) => { fireBomberShotWhenClearOfPlayer(mm); mm.regs.b = u8(mm.regs.b + 1); };
  const scribbleData = (mm) => { fireBomberShotWhenClearOfPlayer(mm); mm.mem8[SCRIBBLE_CELL] ^= 0xff; };
  const states = [fullPathEntry(), craft(VARIANTS[1][1])];
  for (const s of states) {
    assert.equal(unitDiff(scribbleScratchReg, s), null,
      "a scratch-register scribble was flagged, but this spawn has no genuine register live-outs to pin");
    const d = unitDiff(scribbleData, s);
    assert.notEqual(d, null, "the RAM measurement missed a scribbled cell, so it has no teeth");
    assert.notEqual(d.addr, null, "the RAM scribble must be caught on a cell, not a register");
  }
  console.log(`  SCRATCH NOT PINNED: register scribble ignored; RAM scribble caught on all ${states.length}`);
});

test("TEETH: broken twins part company IN MEMORY; the genuine routine does not", { skip }, () => {
  const bodyM = fullPathEntry();
  const cooldownBlockedM = craft((c) => { c.mem8[SPAWN_COOLDOWN] = 7; });
  const twins = [
    ["never spawns", () => {}, bodyM],
    ["ignores the cooldown guard", (m) => { m.mem8[SPAWN_COOLDOWN] = 0; fireBomberShotWhenClearOfPlayer(m); }, cooldownBlockedM],
    ["corrupts the reloaded cooldown", (m) => { fireBomberShotWhenClearOfPlayer(m); m.mem8[SPAWN_COOLDOWN] = u8(m.mem8[SPAWN_COOLDOWN] + 1); }, bodyM],
  ];
  for (const [label, twin, machine] of twins) {
    const d = unitDiff(twin, machine);
    assert.notEqual(d, null, `the "${label}" twin escaped the gate`);
    assert.notEqual(d.addr, null, `the "${label}" twin was caught only in a register, not in memory: ${show(d)}`);
  }
  assert.equal(unitDiff(fireBomberShotWhenClearOfPlayer, bodyM), null, "the genuine routine is flagged on the body entry, so the teeth prove nothing");
  console.log(`  TEETH: ${twins.length} twins caught in memory; genuine clean`);
});
