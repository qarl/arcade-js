// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for cullSpriteObjectsAtTop (ROM 0x176c) — the board-advance
 * sprite-object cull pass.
 *
 * The routine WRITES MEMORY (zeroes the X of any of the ten sprite-object records
 * whose Y < 0x19) and hands the sibling scan a pointer/stride pair, so it is gated on
 * memory-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP + the live-out registers
 * HL/DE — against the frozen oracle, and every case runs on a FRESH clone (a reused
 * clone is only safe for a read-only leaf). It is a LEAF (no callees), so no callee
 * pinning is needed. LIVE-OUT includes HL/DE because the traced caller sub_1757 does
 * `inc hl`/`inc de` on them before handing them to sub_1783; A/B/F are dead (sub_1783
 * reloads B and A and overwrites F before reading them) and are NOT compared.
 *
 * REACHABILITY: 0x176c is NOT reached in attract — a real run dispatches it ZERO
 * times (measured 0 / 3000 frames; its only caller, the board-advance arm sub_1757,
 * never runs in attract). So there are no real captures of 0x176c itself to replay.
 * This is a CRAFTED-ENTRY gate: seed from REAL captured RAM — hooked at the sibling
 * 0x003d, which fires during board setup with the 0x6908 sprite-object block
 * populated (exactly the region this routine edits) — then drive the ten record Y
 * bytes across the 0x19 threshold, identically on both sides.
 *
 *   1. EQUAL (uniform Y sweep, all 256) — over one real captured RAM state (X bytes
 *      forced nonzero so a clear is observable), set EVERY record's Y to v for v in
 *      0..255 and compare. Drives the all-clear arm (v < 0x19, 25 values) and the
 *      all-keep arm (v >= 0x19, 231 values), pinning the exact 0x19 boundary.
 *
 *   2. EQUAL (per-record mixed patterns) — patterns where some records fall below the
 *      threshold and some above WITHIN one call, so the per-record X targeting is
 *      checked (a wrong-record write would clear/keep the wrong X).
 *
 *   3. EQUAL (real captured seeds, unmodified) — several distinct real board-setup
 *      states run as-is, so the natural sprite data is exercised too.
 *
 *   4. TEETH (threshold off-by-one) — a twin testing `< 0x18` instead of `< 0x19`
 *      MUST be caught at a record with Y == 0x18 (oracle clears, twin keeps).
 *
 *   5. TEETH (wrong write offset) — a twin that zeroes record+1 (the code byte)
 *      instead of record+0 (X) MUST be caught when a record clears.
 *
 *   6. TEETH (wrong live-out HL) — a twin doing the correct memory work but leaving
 *      HL = 0x6908 instead of 0x6907 MUST be caught, proving HL/DE are really gated.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-176c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_176c as oracle } from "../../translated/loc_176c.js";
import { cullSpriteObjectsAtTop } from "../cullSpriteObjectsAtTop.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const SEED_TARGET = 0x003d; // sibling hooked during board setup to obtain live block RAM
const TOP_Y = 0x19;
const RECORD_COUNT = 10;
const recAddr = (i) => SPRITE_OBJ_BLOCK + i * 4; // +0 X, +3 Y
const X_SENTINEL = 0x77; // nonzero, so "clear X" is an observable byte change

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead
 *  stack region the oracle's `ret` churns — excluded by the standard gate). */
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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP
 *  match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 *  stack, so it never touches pc/SP itself — the harness supplies the return). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the memory-only + live-out contract: RAM −
 *  STACK_SCRATCH, pc, SP, HL, DE. A/B/F are DEAD and intentionally omitted. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  if (o.regs.hl !== c.regs.hl) diffs.push(`HL oracle=0x${o.regs.hl.toString(16)} cand=0x${c.regs.hl.toString(16)}`);
  if (o.regs.de !== c.regs.de) diffs.push(`DE oracle=0x${o.regs.de.toString(16)} cand=0x${c.regs.de.toString(16)}`);
  return diffs;
}

// -- capture (seed only) ------------------------------------------------------

/** Hook the sibling 0x003d in a real attract run and clone the machine at up to K real
 *  dispatches — board setup fires it with the 0x6908 sprite-object block populated, so
 *  these clones carry realistic RAM in the exact region 0x176c edits. 0x176c itself is
 *  never dispatched, so we only need live states to seed crafted entries from. */
function captureSeeds(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[SEED_TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    // do not run the sibling — we only want the entry RAM.
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  try { host.runFrames(maxFrames); } catch { /* attract may reach an untranslated stub */ }
  return caps;
}

/** Craft an entry from a real seed: a safe stack pointer (so the oracle's `ret` pops
 *  harmless STACK_SCRATCH bytes on both sides), all X bytes forced to a nonzero
 *  sentinel (so clears are observable), and the ten Y bytes set from `yOf(i)`. */
function craft(seed, yOf) {
  const e = seed.clone();
  e.regs.sp = 0x6bfe;
  for (let i = 0; i < RECORD_COUNT; i++) {
    const r = recAddr(i);
    e.mem.write8(r, X_SENTINEL);
    e.mem.write8(r + 3, yOf(i) & 0xff);
  }
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** Broken twin: threshold `< 0x18` instead of `< 0x19` — keeps a record with Y == 0x18
 *  that the oracle clears. */
function brokenThresholdOffByOne(m) {
  const { mem, regs } = m;
  for (let i = 0; i < RECORD_COUNT; i++) {
    const r = recAddr(i);
    if (mem.read8(r + 3) < 0x18) mem.write8(r, 0x00); // BUG: 0x18 should be 0x19
  }
  regs.hl = (SPRITE_OBJ_BLOCK - 1) & 0xffff;
  regs.de = 0x0003;
}

/** Broken twin: zeroes record+1 (the code byte) instead of record+0 (X). */
function brokenWrongOffset(m) {
  const { mem, regs } = m;
  for (let i = 0; i < RECORD_COUNT; i++) {
    const r = recAddr(i);
    if (mem.read8(r + 3) < TOP_Y) mem.write8(r + 1, 0x00); // BUG: r+1 should be r
  }
  regs.hl = (SPRITE_OBJ_BLOCK - 1) & 0xffff;
  regs.de = 0x0003;
}

/** Broken twin: correct memory work, but leaves HL = 0x6908 instead of 0x6907. */
function brokenLiveOutHl(m) {
  const { mem, regs } = m;
  for (let i = 0; i < RECORD_COUNT; i++) {
    const r = recAddr(i);
    if (mem.read8(r + 3) < TOP_Y) mem.write8(r, 0x00);
  }
  regs.hl = SPRITE_OBJ_BLOCK; // BUG: should be SPRITE_OBJ_BLOCK - 1 (0x6907)
  regs.de = 0x0003;
}

// -- 1. EQUAL (uniform Y sweep, all 256) --------------------------------------

test("EQUAL (uniform Y sweep): all 256 Y values match the oracle (both arms + 0x19 boundary)", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need one real 0x003d capture to seed crafted entries with real RAM");
  const seed = seeds[0];

  let clear = 0, keep = 0;
  for (let v = 0; v < 256; v++) {
    if (v < TOP_Y) clear++; else keep++;
    const diffs = contractDiffs(craft(seed, () => v), cullSpriteObjectsAtTop);
    assert.equal(diffs.length, 0, `Y=${hx(v)} (${v < TOP_Y ? "clear" : "keep"}): ${diffs.join("; ")}`);
  }
  assert.equal(clear, 0x19, "expected 25 clear values (Y 0x00..0x18)");
  assert.equal(keep, 256 - 0x19, "expected 231 keep values (Y 0x19..0xff)");
  console.log(`  EQUAL/uniform: 256 Y values identical (RAM+pc+SP+HL+DE) — ${clear} clear, ${keep} keep`);
});

// -- 2. EQUAL (per-record mixed patterns) -------------------------------------

test("EQUAL (mixed patterns): straddling-threshold patterns match (per-record X targeting)", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const seed = seeds[0];

  const patterns = {
    "even-clear/odd-keep": (i) => (i % 2 === 0 ? 0x10 : 0x40),
    "odd-clear/even-keep": (i) => (i % 2 === 0 ? 0x40 : 0x10),
    "first5-clear/last5-keep": (i) => (i < 5 ? 0x05 : 0xa0),
    "last5-clear/first5-keep": (i) => (i < 5 ? 0xa0 : 0x05),
    "boundary 0x18-clear/0x19-keep": (i) => (i % 2 === 0 ? 0x18 : 0x19),
    "one-clear (rec3 only)": (i) => (i === 3 ? 0x00 : 0xff),
  };
  for (const [label, yOf] of Object.entries(patterns)) {
    const diffs = contractDiffs(craft(seed, yOf), cullSpriteObjectsAtTop);
    assert.equal(diffs.length, 0, `${label}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/mixed: ${Object.keys(patterns).length} straddling patterns identical to the oracle`);
});

// -- 3. EQUAL (real captured seeds, unmodified) -------------------------------

test("EQUAL (real seeds): unmodified board-setup states match the oracle", () => {
  const seeds = captureSeeds(6, 1500);
  assert.ok(seeds.length >= 1, "expected at least one real 0x003d capture");
  for (const seed of seeds) {
    const e = seed.clone();
    e.regs.sp = 0x6bfe; // safe stack for the oracle's ret; block left as captured
    const diffs = contractDiffs(e, cullSpriteObjectsAtTop);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${seeds.length} distinct captured board-setup states identical to the oracle`);
});

// -- 4. TEETH (threshold off-by-one) ------------------------------------------

test("TEETH: the `< 0x18` threshold twin is CAUGHT at Y == 0x18", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  // every record at exactly the boundary the twin mishandles
  const e = craft(seeds[0], () => 0x18);
  const diffs = contractDiffs(e, brokenThresholdOffByOne);
  assert.ok(diffs.length > 0, "the off-by-one threshold twin escaped detection — the 0x19 boundary is untested");
  assert.equal(contractDiffs(craft(seeds[0], () => 0x18), cullSpriteObjectsAtTop).length, 0,
    "cullSpriteObjectsAtTop must pass the Y==0x18 entry");
  console.log(`  TEETH/threshold: off-by-one twin caught at Y==0x18 (${diffs[0]})`);
});

// -- 5. TEETH (wrong write offset) --------------------------------------------

test("TEETH: the wrong-offset twin (zeroes code byte, not X) is CAUGHT", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const e = craft(seeds[0], () => 0x00); // all records clear -> every write differs
  const diffs = contractDiffs(e, brokenWrongOffset);
  assert.ok(diffs.length > 0, "the wrong-offset twin escaped detection — the X target byte is untested");
  assert.equal(contractDiffs(craft(seeds[0], () => 0x00), cullSpriteObjectsAtTop).length, 0,
    "cullSpriteObjectsAtTop must pass the all-clear entry");
  console.log(`  TEETH/offset: wrong-offset twin caught (${diffs[0]})`);
});

// -- 6. TEETH (wrong live-out HL) ---------------------------------------------

test("TEETH: the wrong live-out twin (HL = 0x6908, not 0x6907) is CAUGHT", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const e = craft(seeds[0], () => 0x40); // all keep -> only the register differs
  const diffs = contractDiffs(e, brokenLiveOutHl);
  assert.ok(diffs.length > 0, "the wrong-HL twin escaped detection — HL is not in the live-out contract");
  assert.ok(diffs.some((d) => d.startsWith("HL")), `expected an HL diff, got: ${diffs.join("; ")}`);
  assert.equal(contractDiffs(craft(seeds[0], () => 0x40), cullSpriteObjectsAtTop).length, 0,
    "cullSpriteObjectsAtTop must pass the all-keep entry");
  console.log(`  TEETH/live-out: wrong-HL twin caught (${diffs.find((d) => d.startsWith("HL"))})`);
});
