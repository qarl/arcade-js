// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for steerDemoPlayer (ROM 0x03e8, The Pit) — the attract
 * demo's wall-follower that writes the one-of-four steering direction
 * (DEMO_STEER_DIR, 0x801b) the movement dispatcher reads in place of the joystick.
 *
 * CONTRACT — OBSERVABLE RAM (relaxed after the callee dissolve). This gate USED to demand
 * whole-RAM + exit pc + SP byte-identity. That broke when the two painters this routine
 * reaches — drawCreditsDisplay (panel repaint) and cyclePanelColumnColour (column recolour) — were dissolved: their
 * inner layout/colour helpers (rowColToTileOffset, deriveTileWriteCursors, fillColourColumn)
 * are now DIRECT JS calls with no Z80 stack frame. steerDemoPlayer itself is UNCHANGED
 * — its two housekeeping arms still `push16` a Z80 return address and then call the painter —
 * but those push16 brackets are now unbalanced (no callee `ret` unwinds them), and the direct
 * JS helpers push no nested return addresses. Two by-construction divergences result, both
 * proven dead, both excluded here:
 *
 *   - A dead STACK-SCRATCH window [entrySP-4, entrySP). Measured across every real captured
 *     dispatch AND every crafted arm (busy-tick, painter-only, tick-recolour, both-brackets,
 *     the full classify sweep), the RAM divergence is confined to exactly these four bytes
 *     (0x83f9..0x83fc for the captured entrySP 0x83fd): return-address bytes the oracle's
 *     nested CALLs park below SP that the stack-free direct JS helpers never write. This is
 *     the same [SP-4, SP) dead scratch the sibling dissolve equivalence-4c5f.test.js excludes.
 *   - The exit pc + SP. They match the oracle EXACTLY on the classify path (no bracket arm),
 *     and diverge only in the two bracket arms, where the routine's own final `ret` pops a
 *     bracket instead of the real return address. They are DEAD: the ONLY caller of 0x03e8 is
 *     the main loop loc_0348, which re-seats `ld sp,0x83ff` (regs.sp = 0x83ff) at the top of
 *     EVERY pass and never reads the leftover pc/registers as data — the leftover SP/pc is
 *     discarded before anything consumes it. (0x03e8 is not even wired live yet — the manifest
 *     still dispatches it to the oracle.) So pc + SP are EXCLUDED, NOT re-aligned with a
 *     modelled ret: unlike the tail-call siblings (4894/4c5f), steerDemoPlayer does its
 *     OWN final ret, so there is no tail return to model and the bracket-arm pc/SP cannot be
 *     lined up anyway. RAM-only, like equivalence-3968.test.js, plus the [SP-4,SP) exclusion.
 *
 * Net: the honest live-out is MEMORY-ONLY (the steer direction, band hint, timer, and the panel/colour
 * cells the painters write) and the gate compares the observable RAM dump byte-for-byte
 * outside the dead stack window. Verified: ZERO observable (at/above entrySP) divergences
 * across all 40 real captured dispatches plus every crafted arm. The teeth twins all bite
 * observable cells (DEMO_STEER_DIR 0x801b / BAND_HINT 0x800c / FILL_LEN 0x8055 — far below the
 * stack window) and are still caught.
 *
 * WHAT THIS ROUTINE NEEDS FROM THE GATE, and how it is met:
 *
 *   1. REAL dispatches for the housekeeping arms. The main loop runs 0x03e8 only
 *      while the game-mode byte is 4 — which the attract demo does enter — so real
 *      captured entries are available. The very first one (frame 1 of the demo)
 *      is rich: it repaints the panel (drawCreditsDisplay), reloads the 30-frame timer, and
 *      recolours a column (cyclePanelColumnColour) before the probe-absent early return. Later
 *      entries exercise the timer countdown + early return. EQUAL is proven on all.
 *
 *   2. CRAFTED entries for the classification chain. Attract's demo never presents a
 *      live probe object (0x8079 stays 0), so the whole band-scan is unreached in the
 *      wild. A real entry is nudged into the classify path (skip the painter, hold the
 *      timer off its 30-frame tick, mark the probe live) and then swept: the probe
 *      X/Y across every wall-line value and the band hint across every band, so every
 *      band, wall line, and half-plane split is driven on both sides.
 *
 *   3. Its callees (drawCreditsDisplay, cyclePanelColumnColour) are already idiomatic and are imported and
 *      called directly by the routine, and the oracle reaches the same two routines
 *      through the registry — so both sides run identical callee code and the gate
 *      tests 0x03e8's own logic and routing (the dissolve consequence above is theirs,
 *      not this routine's, and is excluded as the dead scratch it is).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-03e8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_03e8 as oracle } from "../../translated/loc_03e8.js";
import { steerDemoPlayer as idiomatic } from "../steerDemoPlayer.js";
import { drawCreditsDisplay as idiomaticPainter } from "../drawCreditsDisplay.js";
import { cyclePanelColumnColour as idiomaticRecolour } from "../cyclePanelColumnColour.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) =>
      nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x03e8;
// Work-RAM cells this routine reads / writes.
const PLAY_PHASE_COUNTER = 0x8010; // wraps to 0 -> repaint the panel
const WALL_TIMER = 0x800b;    // 30-frame countdown
const BAND_HINT = 0x800c;     // cached maze band index
const PROBE_GATE = 0x8079;    // nonzero -> classify this frame
const TICK_BUSY = 0x807c;     // nonzero on a tick frame -> skip classification
const BOARD_END_PHASE = 0x807b;   // 0 on a tick frame -> recolour a column (cyclePanelColumnColour)
const PLAYER_Y = 0x8068;
const PLAYER_X = 0x806b;
const DEMO_STEER_DIR = 0x801b;      // the one-of-four steering direction this routine produces
const FILL_LEN = 0x8055;      // cyclePanelColumnColour's first write (column length 9); where a skipped-recolour twin shows up
const CAPTURE_FRAMES = 720;   // the demo runs 0x03e8 within this window
// The dead stack-scratch window excluded from the RAM diff. The dissolved painters'
// direct JS helpers push no nested Z80 return address, and this routine's own push16
// brackets are now unbalanced, so the oracle parks return-address bytes just below the
// entry SP that the idiomatic run does not. Measured across every real + crafted arm the
// divergence is confined to exactly [entrySP-4, entrySP) (see header). Same [SP-4, SP)
// dead scratch equivalence-4c5f.test.js excludes for its sibling dissolve.
const STACK_SCRATCH = 4;
// Hard floor proving the excluded window sits unambiguously in the Z80 stack page (top of
// work RAM) and is disjoint from every observable cell this routine or its teeth touch
// (all <= 0x8079 in work RAM, or the painted >= 0x8800 video/colour RAM). Asserted below,
// so the exclusion can never silently hide an observable divergence.
const STACK_PAGE_FLOOR = 0x8300;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The Pit's routine registry is async, so build the factory once and reuse it.
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Capture real states at 0x03e8's demo dispatches (up to `limit`); the oracle then runs so the host continues. */
function captureRealEntries(limit) {
  const entries = [];
  const overrides = new Map([
    [TARGET, (mm) => {
      if (entries.length < limit) entries.push(mm.clone());
      return oracle(mm);
    }],
  ]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return entries;
}

const ENTRIES = ROM_PRESENT ? captureRealEntries(40) : [];

/** First differing OBSERVABLE RAM byte, EXCLUDING the dead stack-scratch window [entrySP-STACK_SCRATCH, entrySP)
 *  (header). Returns { addr, a, b } or null. */
function observableRamDiff(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the oracle and a candidate on two independent clones of one entry and diff OBSERVABLE RAM only, outside the
 *  dead [SP-4, SP) stack window; pc, SP and the value registers are dead and deliberately excluded (header). */
function runPair(entry, candidate) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  candidate(b);
  return { ram: observableRamDiff(a, b, sp) };
}

function assertEqual(entry, candidate, label) {
  const r = runPair(entry, candidate);
  assert.equal(r.ram, null, r.ram && `${label}: observable RAM diverged at ${hx(r.ram.addr ?? 0)} (oracle=${r.ram.a} idiomatic=${r.ram.b})`);
}

// Build a crafted entry that forces the classification path without any subroutine
// call: PLAY_PHASE_COUNTER != 0 (no panel repaint), the timer held off its 30-frame tick
// (dec leaves it nonzero, so no reload / recolour), and the probe marked live.
function classifyBase(bVal, cVal, hint) {
  const e = ENTRIES[0].clone();
  e.mem.write8(PLAY_PHASE_COUNTER, 1);
  e.mem.write8(WALL_TIMER, 5);
  e.mem.write8(PROBE_GATE, 1);
  e.mem.write8(TICK_BUSY, 0);
  e.mem.write8(BAND_HINT, hint);
  e.mem.write8(PLAYER_Y, (bVal - 3 + 256) % 256); // probe X so PLAYER_Y + 3 == bVal
  e.mem.write8(PLAYER_X, (cVal - 5 + 256) % 256); // probe Y so PLAYER_X + 5 == cVal
  return e;
}

// -- 0. CONTRACT: the excluded stack window is dead + hides nothing observable -
// Anti-fudge guard. Proves the ONLY thing the relaxation excludes is the dead stack
// scratch: on the richest entry (both bracket arms taken) EVERY raw RAM divergence sits
// strictly inside [entrySP-STACK_SCRATCH, entrySP), which is inside the Z80 stack page and
// disjoint from every observable cell. If any observable byte ever diverged, this fails.

test("CONTRACT: every raw divergence is confined to the dead [SP-4, SP) stack window", () => {
  assert.ok(ENTRIES.length > 0, "need a captured entry");
  const entry = ENTRIES[0];
  const sp = entry.regs.sp;

  // The excluded window must sit wholly inside the stack page — never overlapping an
  // observable cell — so excluding it can never mask a real RAM bug.
  assert.ok(sp - STACK_SCRATCH >= STACK_PAGE_FLOOR, `stack window floor ${hx(sp - STACK_SCRATCH)} escaped the stack page ${hx(STACK_PAGE_FLOOR)}`);

  // Oracle determinism (also keeps the shared diff util honest).
  const o1 = entry.clone(); oracle(o1);
  const o2 = entry.clone(); oracle(o2);
  assert.equal(firstStateDiff(o1.dumpState(), o2.dumpState(), (off) => o1.stateOffsetToAddr(off)), null, "oracle run must be deterministic");

  // Enumerate EVERY raw divergence (no exclusion) and assert each is dead stack scratch.
  const a = entry.clone(); oracle(a);
  const b = entry.clone(); idiomatic(b);
  const da = a.dumpState(), db = b.dumpState();
  const raw = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    raw.push(addr);
    assert.ok(addr >= sp - STACK_SCRATCH && addr < sp, `divergence at ${hx(addr)} is OUTSIDE the dead [${hx(sp - STACK_SCRATCH)}, ${hx(sp)}) window — a real observable bug, not stack scratch`);
  }
  assert.ok(raw.length > 0, "expected the dissolve to leave its dead stack-scratch signature on the both-bracket entry");
  console.log(`  CONTRACT: entrySP=${hx(sp)}; ${raw.length} raw diffs all in dead scratch [${hx(sp - STACK_SCRATCH)}, ${hx(sp)}) — observable RAM identical`);
});

test("EQUAL (captured): idiomatic == oracle on every real demo dispatch", () => {
  assert.ok(ENTRIES.length > 0, "captured at least one real 0x03e8 demo dispatch");
  for (let i = 0; i < ENTRIES.length; i++) assertEqual(ENTRIES[i], idiomatic, `entry#${i}`);
  console.log(`  EQUAL/captured: ${ENTRIES.length} real demo entries identical (observable RAM, outside dead [SP-4, SP) stack scratch)`);
});

test("EQUAL (captured): the first entry really exercises the painter + recolour arms", () => {
  // Sanity that the rich arms are genuinely covered above (not vacuously all-early-return).
  const e = ENTRIES[0];
  assert.equal(e.mem.read8(PLAY_PHASE_COUNTER), 0, "first demo entry repaints the panel (drawCreditsDisplay)");
  assert.equal(e.mem.read8(WALL_TIMER), 1, "first demo entry hits the 30-frame tick");
  assert.equal(e.mem.read8(TICK_BUSY), 0, "first demo entry is not busy -> reaches the recolour");
  assert.equal(e.mem.read8(BOARD_END_PHASE), 0, "first demo entry recolours a column (cyclePanelColumnColour)");
  console.log("  EQUAL/captured: entry#0 covers the panel-repaint + timer-reload + recolour arms");
});

test("EQUAL (crafted): the busy-tick arm returns without classifying", () => {
  // Timer hits its 30-frame tick AND the busy flag is set -> reload timer, then return
  // with no classification (DEMO_STEER_DIR untouched).
  const e = ENTRIES[0].clone();
  e.mem.write8(PLAY_PHASE_COUNTER, 1); // skip the painter to isolate this arm
  e.mem.write8(WALL_TIMER, 1);    // dec -> 0 -> tick
  e.mem.write8(TICK_BUSY, 0x5a);  // busy -> early return before classify
  assertEqual(e, idiomatic, "busy-tick");
  console.log("  EQUAL/crafted: busy-tick reload-then-return arm identical");
});

test("EQUAL (crafted): the tick recolour arm (cyclePanelColumnColour) with the painter skipped", () => {
  const e = ENTRIES[0].clone();
  e.mem.write8(PLAY_PHASE_COUNTER, 1); // skip the painter
  e.mem.write8(WALL_TIMER, 1);    // dec -> 0 -> tick
  e.mem.write8(TICK_BUSY, 0);     // not busy
  e.mem.write8(BOARD_END_PHASE, 0);   // -> recolour a column
  e.mem.write8(PROBE_GATE, 0);    // then early-return (no live probe)
  assertEqual(e, idiomatic, "tick-recolour");
  console.log("  EQUAL/crafted: tick recolour (cyclePanelColumnColour) arm identical");
});

test("EQUAL (crafted): the painter arm alone (frame counter at zero)", () => {
  const e = ENTRIES[0].clone();
  e.mem.write8(PLAY_PHASE_COUNTER, 0); // -> repaint the panel (drawCreditsDisplay)
  e.mem.write8(WALL_TIMER, 5);    // dec -> 4, no tick, straight to the probe gate
  e.mem.write8(PROBE_GATE, 0);    // early return
  assertEqual(e, idiomatic, "painter-only");
  console.log("  EQUAL/crafted: panel-repaint (drawCreditsDisplay) arm identical");
});

// Every X/Y wall-line value the band scans compare against (in probe b/c space),
// each with +-1 to drive both sides of each half-plane split, plus a coarse grid.
const THRESHOLDS = [
  24, 40, 47, 48, 50, 55, 56, 63, 64, 71, 72, 80, 83, 84, 87, 88, 92, 95, 96, 103,
  104, 108, 127, 128, 143, 144, 159, 160, 168, 176, 191, 192, 199, 200, 215, 216,
  223, 224, 231, 232,
];
const INTERESTING = (() => {
  const s = new Set([0, 128, 255]);
  for (const t of THRESHOLDS) { s.add((t - 1) & 0xff); s.add(t); s.add((t + 1) & 0xff); }
  for (let v = 0; v <= 240; v += 16) s.add(v);
  return [...s].sort((a, b) => a - b);
})();

// One hint per band bucket, plus every bucket-boundary value, so band selection and
// fall-through are both exercised.
const HINTS = [0, 6, 7, 9, 10, 13, 14, 22, 23, 29, 30, 40, 200];

test("EQUAL (sweep): classifier identical across all bands + wall lines", () => {
  let n = 0;
  for (const hint of HINTS) {
    for (const b of INTERESTING) {
      for (const c of INTERESTING) {
        assertEqual(classifyBase(b, c, hint), idiomatic, `hint=${hint} b=${b} c=${c}`);
        n++;
      }
    }
  }
  console.log(`  EQUAL/sweep: ${n} crafted (band-hint, X, Y) classify states identical`);
});

test("EQUAL (sweep): exhaustive X*Y at the cascade extremes", () => {
  // hint 0 falls through the whole band cascade; hint 200 lands straight in the last
  // band. Sweeping every probe X/Y at both ends covers the full fall-through path.
  let n = 0;
  for (const hint of [0, 200]) {
    for (let x = 0; x < 256; x++) {
      for (let y = 0; y < 256; y++) {
        assertEqual(classifyBase((x + 3) % 256, (y + 5) % 256, hint), idiomatic, `hint=${hint} x=${x} y=${y}`);
        n++;
      }
    }
  }
  console.log(`  EQUAL/sweep: ${n} exhaustive probe positions at the cascade extremes identical`);
});

// A local reference implementation mirroring the routine's classify path, with an
// injectable bug. bug=null must equal the oracle; each bug must be caught.
function refClassify(b, c, bug) {
  const flip = (lo, hi) => (bug === "swapTop" ? [hi, lo] : [lo, hi]);
  const bandTop = () => {
    if (b === 48) { const [x, y] = flip(4, 2); return c <= 55 ? x : y; }
    if (c === 56) return b <= 87 ? 2 : 4;
    if (b === 88) return c <= 63 ? 4 : 2;
    if (c === 64) return b <= 103 ? 2 : 4;
    if (b === 104) return c <= 83 ? 4 : 2;
    if (c === 84) return b <= 143 ? 2 : 4;
    if (b === 144) return c <= 127 ? 4 : 2;
    if (c === 128) return b <= 191 ? 2 : 4;
    if (b === 192) return c <= 159 ? 4 : 2;
    if (c === 160) return b <= 199 ? 2 : 4;
    if (b === 200) return c <= 191 ? 4 : 2;
    if (c === 192) return b <= 223 ? 2 : 4;
    if (b === 224) return c <= 215 ? 4 : 1;
    return null;
  };
  const band7 = () => {
    if (c === 216) return b > 176 ? 1 : 4;
    if (b === 176) return c <= 231 ? 4 : 1;
    if (c === 232) return b > 168 ? 1 : 8;
    return null;
  };
  return { bandTop, band7 };
}

/** Broken twin: mirrors the routine's classify path but injects one bug. */
function makeBrokenRoutine(bug) {
  return function broken(m) {
    const { mem } = m;
    if (mem.read8(PLAY_PHASE_COUNTER) === 0) { m.push16(0x03ef); idiomaticPainter(m); }
    const timer = (mem.read8(WALL_TIMER) - 1) % 256;
    mem.write8(WALL_TIMER, timer);
    if (timer === 0) {
      mem.write8(WALL_TIMER, 30);
      if (mem.read8(TICK_BUSY) !== 0) { m.ret(); return; }
      if (mem.read8(BOARD_END_PHASE) === 0 && bug !== "skip48c4") { m.push16(0x0409); idiomaticRecolour(m); }
    }
    if (mem.read8(PROBE_GATE) === 0) { m.ret(); return; }
    const b = (mem.read8(PLAYER_Y) + 3) % 256;
    const c = (mem.read8(PLAYER_X) + 5) % 256;
    const hint = mem.read8(BAND_HINT);
    const { bandTop, band7 } = refClassify(b, c, bug);
    let mask = null;
    if (hint < 7) mask = bandTop();
    if (mask === null && hint < 10) { mem.write8(BAND_HINT, bug === "badHint" ? 8 : 7); mask = band7(); }
    if (mask === null) { mem.write8(DEMO_STEER_DIR, 99); m.ret(); return; } // (unreached by our teeth inputs)
    mem.write8(DEMO_STEER_DIR, mask);
    m.ret();
  };
}

// The broken twins call the SAME idiomatic callees the real routine does (imported at
// the top), so their only divergence from the oracle is the injected bug.

test("TEETH: a swapped wall facing is CAUGHT at the steer byte", () => {
  // b == 48 in the top band, c <= 55: oracle raises bit 4, the swapped twin raises 2.
  const e = classifyBase(48, 0, 0);
  const r = runPair(e, makeBrokenRoutine("swapTop"));
  assert.notEqual(r.ram, null, "the gate FAILED to catch a swapped wall facing — it is worthless");
  assert.equal(r.ram.addr, DEMO_STEER_DIR, `teeth caught ${hx(r.ram.addr ?? 0)} (expected the steer byte ${hx(DEMO_STEER_DIR)})`);
  console.log(`  TEETH: swapped facing caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a wrong band-hint stamp is CAUGHT at the hint byte", () => {
  // hint 0 falls through the top band into band 7 (b == 176) which restamps the hint.
  const e = classifyBase(176, 0, 0);
  const r = runPair(e, makeBrokenRoutine("badHint"));
  assert.notEqual(r.ram, null, "the gate FAILED to catch a wrong band-hint stamp — it is worthless");
  assert.equal(r.ram.addr, BAND_HINT, `teeth caught ${hx(r.ram.addr ?? 0)} (expected the hint ${hx(BAND_HINT)})`);
  console.log(`  TEETH: wrong band-hint caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a skipped column recolour (cyclePanelColumnColour) is CAUGHT", () => {
  // The first real entry recolours a column; a twin that skips it first diverges at
  // cyclePanelColumnColour's opening write — the column length it sets to 9 (the painter left 8).
  const r = runPair(ENTRIES[0], makeBrokenRoutine("skip48c4"));
  assert.notEqual(r.ram, null, "the gate FAILED to catch a skipped recolour — it is worthless");
  assert.equal(r.ram.addr, FILL_LEN, `teeth caught ${hx(r.ram.addr ?? 0)} (expected ${hx(FILL_LEN)})`);
  console.log(`  TEETH: skipped recolour caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("TEETH: a corrupted steer store is CAUGHT", () => {
  const brokenOut = (m) => { idiomatic(m); m.mem.write8(DEMO_STEER_DIR, m.mem.read8(DEMO_STEER_DIR) ^ 0xff); };
  const r = runPair(classifyBase(48, 0, 0), brokenOut);
  assert.notEqual(r.ram, null, "the gate FAILED to catch a corrupted steer value — it is worthless");
  assert.equal(r.ram.addr, DEMO_STEER_DIR, `teeth caught ${hx(r.ram.addr ?? 0)} (expected ${hx(DEMO_STEER_DIR)})`);
  console.log(`  TEETH: corrupted steer caught at ${hx(r.ram.addr)} (oracle=${r.ram.a} broken=${r.ram.b})`);
});

test("IDENTITY: oracle vs oracle reports EQUAL on a captured entry", () => {
  assertEqual(ENTRIES[0], oracle, "identity");
  console.log("  IDENTITY: oracle vs oracle -> EQUAL");
});
