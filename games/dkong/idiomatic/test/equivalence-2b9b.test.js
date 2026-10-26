// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for probeTileForLanding (ROM 0x2B9B) — the tile gate at the head of the
 * airborne-descent collision probe. It maps a pixel to its tilemap cell, classifies the
 * tile under it, and on a hit builds a column boundary in C and tails into
 * resolveAirborneTileLanding (0x2BE1); on a miss it reports code 0 and returns.
 *
 * The whole memory-observable behaviour reduces to:
 *   - a CLASSIFICATION of the tile byte (all 256 values) plus the pixel x:
 *       tile < 0xB0 / (tile & 0x0F) >= 8 / tile == 0xC0  -> REJECT (A=0, B=0, normal return)
 *       tile < 0xC0                                       -> HIT, boundary = (x&0xF8) - 1
 *       tile > 0xC0                                       -> HIT iff (x&0xF8)+bandOffset < x
 *   - the tail into resolveAirborneTileLanding, whose arm (airborne A=2 / landed A=1 +
 *     MARIO_Y snap) is a function of the boundary in C and the descent probe.
 *
 * RETURN CONTRACT (caller-skip): true = normal return (REJECT or the airborne arm), false =
 * the two-frame unwind that aborts the whole collision walk (the landed arm). The candidate
 * models no stack; the harness performs the matching ret / two-frame unwind AFTER it so pc +
 * SP line up with the oracle, and a wrong boolean therefore diverges on pc/SP.
 *
 * STACK-SCRATCH EXCLUSION: the oracle brackets its lookup with `push hl` + `call 0x2ff0`
 * (a leaf that only rets, verified push-free), so it churns STACK_SCRATCH [0x6be0,0x6c00) that
 * the direct-call candidate never touches. Every crafted dispatch sets SP = 0x6c00 and every
 * real captured dispatch runs at SP in [0x6be4,0x6be8], so the oracle's deepest write (SP-4)
 * stays inside that region; the RAM diff excludes it (the memory-equivalence contract) and
 * keeps every live cell.
 *
 *   1. EQUAL (classification x descent) — a real attract base + crafted pokes of the tile
 *      byte (all 256) under the computed tilemap address across a representative pixel x,
 *      each run under TWO descent configs that force the landed arm (probe 0) and the
 *      airborne arm (probe 0xFF) on every HIT. Assert probeTileForLanding == oracle on
 *      RAM(-STACK_SCRATCH) + pc + SP + A + B over the whole grid; the sweep spans all three
 *      result codes.
 *
 *   2. REALISM (captured dispatches) — hook 0x2B9B in a real attract run (193/4000 frames),
 *      clone at each dispatch, and confirm probeTileForLanding reproduces the oracle on every real state
 *      the game actually produces.
 *
 *   3. TEETH — five deliberately-broken twins, each of which the sweep MUST catch:
 *      (a) wrong reject threshold (tile < 0xB1) — flips tile 0xB0 from hit to reject.
 *      (b) wrong band offset (sub 1 instead of sub 9 on the 0xC1..0xCF band).
 *      (c) wrong success-2 boundary (x&0xF8 instead of x&0xF8 - 1) — MARIO_Y snap diverges.
 *      (d) wrong comparison (boundary <= x instead of < x) — flips the boundary==x case.
 *      (e) dropped arithmetic wrap on the boundary (no u8) — diverges where it overflows.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b9b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b9b as oracle } from "../../translated/loc_2b9b.js";
import { probeTileForLanding } from "../probeTileForLanding.js";
import { tileAddrForPixel } from "../tileAddrForPixel.js";
import { resolveAirborneTileLanding } from "../resolveAirborneTileLanding.js";
import { STACK_SCRATCH, MARIO_Y, MARIO_AIR_PREV_Y } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b9b;
const OBJ_IX = 0x6200;                 // object record base the caller passes (Mario; +5 == MARIO_Y)
const SP_TOP = 0x6c00;                 // crafted stack top (top of STACK_SCRATCH)
const R1 = 0x0111, R2 = 0x0222, R3 = 0x0333; // distinct sentinel return frames
const FIXED_Y = 0x80;                  // pixel y — affects only the tilemap address, not the class

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM - the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Stamp a crafted 3-deep stack: this routine's own return (R1) and its caller's return
 * (R2) — both discarded on the two-frame unwind — over the real unwind target (R3).
 */
function stampStack(m) {
  m.regs.sp = SP_TOP;
  m.push16(R3);
  m.push16(R2);
  m.push16(R1);
}

/**
 * A crafted 0x2B9B dispatch: pixel (FIXED_Y, x), the tile byte written under the computed
 * tilemap address, the object pointer, and a descent config that forces a chosen tail arm.
 *   config "landed":   objectY = x, airPrevY = 0        -> probe 0    <= boundary -> landed
 *   config "airborne": objectY = 0, airPrevY = 0xFF - x -> probe 0xFF  > boundary -> airborne
 */
function craft(base, x, tile, config) {
  const m = base.clone();
  m.regs.hl = ((FIXED_Y << 8) | (x & 0xff)) & 0xffff;
  m.mem.write8(tileAddrForPixel(FIXED_Y, x), tile & 0xff);
  m.regs.ix = OBJ_IX;
  if (config === "landed") {
    m.mem.write8((OBJ_IX + 5) & 0xffff, x & 0xff); // objectY == x
    m.mem.write8(MARIO_AIR_PREV_Y, 0x00);
  } else {
    m.mem.write8((OBJ_IX + 5) & 0xffff, 0x00);     // objectY == 0
    m.mem.write8(MARIO_AIR_PREV_Y, u8(0xff - x));
  }
  stampStack(m);
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

/** Run the ORACLE on a fresh clone. It performs its own ret / two-frame unwind. */
function runOracle(entry) {
  const c = entry.clone();
  c.nextNmi = Infinity;
  c.nextBoundary = Infinity;
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal control flow from the boolean
 * it returns so pc + SP match the oracle: true -> one caller-return pop; false -> discard
 * two frames then return (the caller-skip two-frame unwind).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  c.nextNmi = Infinity;
  c.nextBoundary = Infinity;
  const ret = fn(c);
  // Caller-skip signal: probeTileForLanding returns { skip, ... }; the broken twins below still
  // return a bare boolean. Read skip from either shape (the contract diff is unchanged).
  const normal = ret && typeof ret === "object" ? ret.skip : ret;
  if (normal) {
    c.ret();
  } else {
    c.pop16();
    c.pop16();
    c.ret();
  }
  return c;
}

/** Full contract diff: RAM - the stack scratch below the entry SP + pc + SP + the register live-outs A and B. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=${o.regs.a} cand=${c.regs.a}`);
  if (o.regs.b !== c.regs.b) diffs.push(`B oracle=${o.regs.b} cand=${c.regs.b}`);
  return diffs;
}

// A real, self-consistent machine for realistic work RAM; the crafted entries poke every
// input the routine reads, so the base's own gameplay state is irrelevant.
function attractBase(frames = 240) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// -- the crafted sweep --------------------------------------------------------

const XSET = [0x00, 0x01, 0x02, 0x07, 0x08, 0x0f, 0x40, 0x7f, 0x80, 0x84, 0x87, 0x88, 0xf7, 0xf8, 0xff];
const CONFIGS = ["landed", "airborne"];

// Sweep every (x, tile, config); return the first mismatch (or null) plus arm tallies.
function fullSweep(base, candidate) {
  let count = 0;
  const arms = { reject: 0, airborne: 0, landed: 0 };
  for (const x of XSET) {
    for (let tile = 0; tile < 256; tile++) {
      for (const config of CONFIGS) {
        const entry = craft(base, x, tile, config);
        const diffs = contractDiffs(entry, candidate);
        count++;
        if (candidate === probeTileForLanding) {
          const a = runOracle(entry).regs.a;
          if (a === 0) arms.reject++; else if (a === 2) arms.airborne++; else arms.landed++;
        }
        if (diffs.length) return { mismatch: { x, tile, config, diffs }, count, arms };
      }
    }
  }
  return { mismatch: null, count, arms };
}

const describe = (mm) =>
  mm && `at x=${hx(mm.x)} tile=${hx(mm.tile)} [${mm.config}]: ${mm.diffs.join("; ")}`;

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2B9B is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(4000);
  assert.ok(count > 0, "0x2B9B should be dispatched during the attract collision probe");
  console.log(`  REACHABILITY: ${count} natural 0x2B9B dispatches in 4000 frames`);
});

// -- 1. EQUAL (classification x descent) --------------------------------------

test("EQUAL: probeTileForLanding == oracle over the tile x pixel-x x descent grid", () => {
  const base = attractBase();
  const { mismatch, count, arms } = fullSweep(base, probeTileForLanding);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, XSET.length * 256 * CONFIGS.length, "must have compared the full grid");
  assert.ok(arms.reject > 0 && arms.airborne > 0 && arms.landed > 0,
    `sweep must span all arms, got ${JSON.stringify(arms)}`);
  console.log(`  EQUAL: ${count} (x, tile, config) combos — RAM + pc + SP + A + B identical ` +
    `(${arms.reject} reject, ${arms.airborne} airborne, ${arms.landed} landed)`);
});

// -- 2. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x2B9B dispatches — probeTileForLanding matches the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 128) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2B9B dispatch during attract");

  const arms = { reject: 0, airborne: 0, landed: 0 };
  for (const cap of caps) {
    const diffs = contractDiffs(cap, probeTileForLanding);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    const a = runOracle(cap).regs.a;
    if (a === 0) arms.reject++; else if (a === 2) arms.airborne++; else arms.landed++;
  }
  console.log(`  REALISM: ${caps.length} real 0x2B9B dispatches identical to the oracle ` +
    `(${arms.reject} reject, ${arms.airborne} airborne, ${arms.landed} landed)`);
});

// -- 3. TEETH -----------------------------------------------------------------

function reject(regs) { regs.a = 0; regs.b = 0; return true; }

/** (a) wrong reject threshold: tile < 0xB1 rejects tile 0xB0 (a real hit). */
function brokenRejectThreshold(m) {
  const { regs, mem } = m;
  const pixel = regs.hl, x = pixel & 0xff;
  regs.hl = tileAddrForPixel((pixel >> 8) & 0xff, x); regs.de = pixel;
  let tile = mem.read8(regs.hl);
  if (tile < 0xb1) return reject(regs); // BUG: 0xB1
  if ((tile & 0x0f) >= 0x08) return reject(regs);
  tile = mem.read8(regs.hl);
  if (tile === 0xc0) return reject(regs);
  if (tile < 0xc0) { regs.c = u8((x & 0xf8) - 1); return resolveAirborneTileLanding(m); }
  let col;
  if (tile < 0xd0) col = u8((tile & 0x0f) - 9);
  else if (tile < 0xe0) col = u8((tile & 0x0f) - 1);
  else if (tile < 0xf0) col = u8((tile & 0x0f) - 9);
  else col = u8((tile & 0x0f) - 1);
  const boundary = u8((x & 0xf8) + col); regs.c = boundary;
  if (boundary < x) return resolveAirborneTileLanding(m);
  return reject(regs);
}

/** (b) wrong band offset: the 0xC1..0xCF band subtracts 1 instead of 9. */
function brokenBandOffset(m) {
  const { regs, mem } = m;
  const pixel = regs.hl, x = pixel & 0xff;
  regs.hl = tileAddrForPixel((pixel >> 8) & 0xff, x); regs.de = pixel;
  let tile = mem.read8(regs.hl);
  if (tile < 0xb0) return reject(regs);
  if ((tile & 0x0f) >= 0x08) return reject(regs);
  tile = mem.read8(regs.hl);
  if (tile === 0xc0) return reject(regs);
  if (tile < 0xc0) { regs.c = u8((x & 0xf8) - 1); return resolveAirborneTileLanding(m); }
  let col;
  if (tile < 0xd0) col = u8((tile & 0x0f) - 1);       // BUG: -1 not -9
  else if (tile < 0xe0) col = u8((tile & 0x0f) - 1);
  else if (tile < 0xf0) col = u8((tile & 0x0f) - 9);
  else col = u8((tile & 0x0f) - 1);
  const boundary = u8((x & 0xf8) + col); regs.c = boundary;
  if (boundary < x) return resolveAirborneTileLanding(m);
  return reject(regs);
}

/** (c) wrong success-2 boundary: x&0xF8 (drops the -1) -> MARIO_Y snap diverges. */
function brokenSuccess2Boundary(m) {
  const { regs, mem } = m;
  const pixel = regs.hl, x = pixel & 0xff;
  regs.hl = tileAddrForPixel((pixel >> 8) & 0xff, x); regs.de = pixel;
  let tile = mem.read8(regs.hl);
  if (tile < 0xb0) return reject(regs);
  if ((tile & 0x0f) >= 0x08) return reject(regs);
  tile = mem.read8(regs.hl);
  if (tile === 0xc0) return reject(regs);
  if (tile < 0xc0) { regs.c = u8(x & 0xf8); return resolveAirborneTileLanding(m); } // BUG: no -1
  let col;
  if (tile < 0xd0) col = u8((tile & 0x0f) - 9);
  else if (tile < 0xe0) col = u8((tile & 0x0f) - 1);
  else if (tile < 0xf0) col = u8((tile & 0x0f) - 9);
  else col = u8((tile & 0x0f) - 1);
  const boundary = u8((x & 0xf8) + col); regs.c = boundary;
  if (boundary < x) return resolveAirborneTileLanding(m);
  return reject(regs);
}

/** (d) wrong comparison: boundary <= x lets the boundary==x case through as a hit. */
function brokenComparison(m) {
  const { regs, mem } = m;
  const pixel = regs.hl, x = pixel & 0xff;
  regs.hl = tileAddrForPixel((pixel >> 8) & 0xff, x); regs.de = pixel;
  let tile = mem.read8(regs.hl);
  if (tile < 0xb0) return reject(regs);
  if ((tile & 0x0f) >= 0x08) return reject(regs);
  tile = mem.read8(regs.hl);
  if (tile === 0xc0) return reject(regs);
  if (tile < 0xc0) { regs.c = u8((x & 0xf8) - 1); return resolveAirborneTileLanding(m); }
  let col;
  if (tile < 0xd0) col = u8((tile & 0x0f) - 9);
  else if (tile < 0xe0) col = u8((tile & 0x0f) - 1);
  else if (tile < 0xf0) col = u8((tile & 0x0f) - 9);
  else col = u8((tile & 0x0f) - 1);
  const boundary = u8((x & 0xf8) + col); regs.c = boundary;
  if (boundary <= x) return resolveAirborneTileLanding(m); // BUG: <=
  return reject(regs);
}

/** (e) dropped arithmetic wrap: boundary without u8 overflows past a byte. */
function brokenNoWrap(m) {
  const { regs, mem } = m;
  const pixel = regs.hl, x = pixel & 0xff;
  regs.hl = tileAddrForPixel((pixel >> 8) & 0xff, x); regs.de = pixel;
  let tile = mem.read8(regs.hl);
  if (tile < 0xb0) return reject(regs);
  if ((tile & 0x0f) >= 0x08) return reject(regs);
  tile = mem.read8(regs.hl);
  if (tile === 0xc0) return reject(regs);
  if (tile < 0xc0) { regs.c = u8((x & 0xf8) - 1); return resolveAirborneTileLanding(m); }
  let col;
  if (tile < 0xd0) col = u8((tile & 0x0f) - 9);
  else if (tile < 0xe0) col = u8((tile & 0x0f) - 1);
  else if (tile < 0xf0) col = u8((tile & 0x0f) - 9);
  else col = u8((tile & 0x0f) - 1);
  const boundary = (x & 0xf8) + col; regs.c = boundary; // BUG: no u8()
  if (boundary < x) return resolveAirborneTileLanding(m);
  return reject(regs);
}

const TWINS = [
  ["wrong-reject-threshold", brokenRejectThreshold],
  ["wrong-band-offset", brokenBandOffset],
  ["wrong-success2-boundary", brokenSuccess2Boundary],
  ["wrong-comparison", brokenComparison],
  ["dropped-arithmetic-wrap", brokenNoWrap],
];

test("TEETH: every broken twin is CAUGHT by the sweep", () => {
  const base = attractBase();
  for (const [name, twin] of TWINS) {
    const { mismatch } = fullSweep(base, twin);
    assert.notEqual(mismatch, null, `the sweep FAILED to catch the ${name} twin — worthless`);
    console.log(`  TEETH/${name}: caught — ${describe(mismatch)}`);
  }
});
