// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for animateSpriteObjectBlock (ROM 0x306f) — the throttled
 * ten-record sprite-object-block animation step.
 *
 * The routine WRITES MEMORY and carries state (a 1-in-8 phase counter), so it is
 * gated on memory-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — against the
 * frozen oracle, and every case runs on a FRESH clone (a reused clone is only safe
 * for a read-only leaf). LIVE-OUT is memory-only: the untranslated callers
 * (0x0AE8/0x1732/0x1757) were not traced, so the oracle's residual A/flags are
 * treated as dead ABI and deliberately NOT compared (comparing them would false-
 * fail — the idiomatic routine leaves the register file in a different, dead state).
 *
 * The oracle drives its callees through `m.call`, so each oracle clone has the four
 * callee addresses (rst-0x38 vector 0x0038, its body 0x003d, the XOR pair 0x3096,
 * the RNG stir 0x0057) pinned to their TRANSLATED oracles — making the reference a
 * fully-translated chain, independent of whatever the capture host's overrides left
 * in the registry. The candidate uses direct imported calls and never consults the
 * registry, so it is immune to it. The candidate models the Z80 `ret` as a JS return,
 * so the harness performs one m.ret() on the candidate clone after the call to line
 * pc + SP up with the oracle (the only place the stack is touched).
 *
 * REACHABILITY: 0x306f is NOT wired into the live dispatcher — a real attract run
 * dispatches it ZERO times (measured over 2000 frames; its callers are in the
 * untranslated subtree and the body runs 1-in-8 even there). So there are no real
 * captures to replay. This is a CRAFTED-ENTRY gate: seed from REAL captured RAM —
 * hooked at the sibling 0x003d, which fires during board setup with the 0x6908
 * sprite-object block populated (exactly the region this routine edits) — then
 * sweep the phase counter and poke the RNG seed identically on both sides.
 *
 *   1. EQUAL (phase sweep, all 256) — over one real captured RAM state, set the
 *      phase counter 0x62AF to every value 0..255 and compare. This drives BOTH
 *      arms (32 body steps at phase→multiple-of-8, 224 early returns) and the 8-bit
 *      counter wrap. Each: oracle vs animateSpriteObjectBlock leave identical
 *      RAM + pc + SP.
 *
 *   2. EQUAL (body step across real seeds) — force the body arm on several distinct
 *      captured sprite-block states, so the Y-scroll and code-XOR edits are checked
 *      against real, varied sprite data.
 *
 *   3. EQUAL (random bit-7 toggle fires) — poke the two frame counters so the
 *      stirred seed's bit 7 is SET on the body path, making record 9's code byte
 *      actually toggle; confirm the toggle fires AND the result matches the oracle.
 *      Without this the plain sweep might never exercise the random-flip arm.
 *
 *   4. TEETH (drop the throttle) — a twin that runs the body on EVERY call MUST be
 *      caught on an early-return phase value (where the oracle only bumps the counter).
 *
 *   5. TEETH (store, not XOR, on record 9) — a twin that STORES the random bit into
 *      0x692d instead of XOR-ing it MUST be caught on the body path with nonzero
 *      sprite data, proving the read-modify-write on record 9 is load-bearing.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-306f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_306f as oracle } from "../../translated/loc_306f.js";
import { loc_0038 } from "../../translated/loc_0038.js";
import { loc_003d } from "../../translated/loc_003d.js";
import { loc_3096 } from "../../translated/loc_3096.js";
import { loc_0057 } from "../../translated/loc_0057.js";
import { animateSpriteObjectBlock } from "../animateSpriteObjectBlock.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { xorMaskStridedPair } from "../xorMaskStridedPair.js";
import { stirRandomSeed } from "../stirRandomSeed.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const SEED_TARGET = 0x003d; // sibling hooked during board setup to obtain live sprite-block RAM
const PHASE_COUNTER = 0x62af;
const REC9_CODE = SPRITE_OBJ_BLOCK + 0x25; // 0x692d — record 9's code byte
const RANDOM = 0x6018, SPIN_COUNT = 0x6019, FRAME = 0x601a;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Pin the oracle's four callees to their TRANSLATED oracles, so the reference is a fully-translated chain regardless
 *  of what the capture host's overrides left in the registry (which stubs 0x003d). */
function pinTranslatedCallees(m) {
  m.routines.set(0x0038, loc_0038);
  m.routines.set(0x003d, loc_003d);
  m.routines.set(0x3096, loc_3096);
  m.routines.set(0x0057, loc_0057);
  return m;
}

/** Run the ORACLE on a fresh clone with the translated callee chain pinned. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = pinTranslatedCallees(entry.clone());
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP match the oracle's (the
 *  idiomatic routine replaces the Z80 stack with the JS call stack, so it never touches pc/SP itself). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the memory-only contract: RAM − the stack scratch below the entry SP, pc, SP. A and
 *  flags are DEAD (untranslated callers, not traced) and intentionally omitted. Returns human-readable mismatches. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture (seed only) ------------------------------------------------------

/** Hook the sibling 0x003d in a real attract run and clone the machine at up to K real dispatches, to seed crafted
 *  entries from — 0x306f itself is never dispatched. */
function captureSeeds(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[SEED_TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    // do NOT run the oracle here — runOracle re-pins the real 0x003d on its own clones.
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  try { host.runFrames(maxFrames); } catch { /* attract may reach an untranslated stub */ }
  return caps;
}

/** Craft an entry from a real seed: a safe stack pointer (so the oracle's `ret` pops
 *  harmless STACK_SCRATCH bytes on both sides) and a chosen phase-counter value. */
function craft(seed, phase) {
  const e = seed.clone();
  e.regs.sp = 0x6bfe;
  e.mem.write8(PHASE_COUNTER, phase & 0xff);
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** Broken twin: bumps the phase counter but IGNORES the 1-in-8 gate — runs the body on EVERY call. */
function brokenNoThrottle(m) {
  const { regs, mem } = m;
  mem.write8(PHASE_COUNTER, (mem.read8(PHASE_COUNTER) + 1) & 0xff);
  // BUG: no `if ((phase & 7) !== 0) return;`
  regs.hl = SPRITE_OBJ_BLOCK + 3; regs.c = 0xfc;
  addToSpriteObjectColumn(m);
  regs.de = 0x0004; regs.c = 0x81;
  regs.hl = SPRITE_OBJ_BLOCK + 1; xorMaskStridedPair(m);
  regs.hl = SPRITE_OBJ_BLOCK + 0x15; xorMaskStridedPair(m);
  stirRandomSeed(m);
  mem.write8(REC9_CODE, mem.read8(REC9_CODE) ^ (regs.a & 0x80));
}

/** Broken twin: on the body path, STORES the random bit into record 9 instead of XOR-ing
 *  it — drops the read-modify-write. Everything else is correct. */
function brokenStoreRec9(m) {
  const { regs, mem } = m;
  const phase = (mem.read8(PHASE_COUNTER) + 1) & 0xff;
  mem.write8(PHASE_COUNTER, phase);
  if ((phase & 0x07) !== 0) return;
  regs.hl = SPRITE_OBJ_BLOCK + 3; regs.c = 0xfc;
  addToSpriteObjectColumn(m);
  regs.de = 0x0004; regs.c = 0x81;
  regs.hl = SPRITE_OBJ_BLOCK + 1; xorMaskStridedPair(m);
  regs.hl = SPRITE_OBJ_BLOCK + 0x15; xorMaskStridedPair(m);
  stirRandomSeed(m);
  mem.write8(REC9_CODE, regs.a & 0x80); // BUG: plain store, not `read ^ (a & 0x80)`
}

// A phase value whose +1 is NOT a multiple of 8 -> the oracle takes the early return.
const EARLY_PHASE = 0x00; // -> phase 1, &7 = 1
// A phase value whose +1 IS a multiple of 8 -> the oracle runs the full body.
const BODY_PHASE = 0x07; // -> phase 8, &7 = 0

// -- 1. EQUAL (phase sweep, all 256) ------------------------------------------

test("EQUAL (phase sweep): all 256 phase-counter values match the oracle (both arms + wrap)", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need one real 0x003d capture to seed crafted entries with real RAM");
  const seed = seeds[0];

  let body = 0, early = 0;
  for (let v = 0; v < 256; v++) {
    const willRunBody = ((v + 1) & 0x07) === 0;
    if (willRunBody) body++; else early++;
    const diffs = contractDiffs(craft(seed, v), animateSpriteObjectBlock);
    assert.equal(diffs.length, 0, `phase=${hx(v)} (${willRunBody ? "body" : "early"}): ${diffs.join("; ")}`);
  }
  assert.equal(body, 32, "expected 32 body steps across the 256 phase values");
  assert.equal(early, 224, "expected 224 early returns across the 256 phase values");
  console.log(`  EQUAL/phase-sweep: 256 phase values identical (RAM+pc+SP) — ${body} body, ${early} early`);
});

// -- 2. EQUAL (body step across real seeds) -----------------------------------

test("EQUAL (body across seeds): the body step matches the oracle on several real sprite states", () => {
  const seeds = captureSeeds(6, 1500);
  assert.ok(seeds.length >= 1, "expected at least one real 0x003d capture");
  for (const seed of seeds) {
    const diffs = contractDiffs(craft(seed, BODY_PHASE), animateSpriteObjectBlock);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/body: body step identical to the oracle on ${seeds.length} distinct captured sprite states`);
});

// -- 3. EQUAL (random bit-7 toggle fires) -------------------------------------

test("EQUAL (random flip): forcing the stirred-seed bit 7 SET toggles record 9 and still matches", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const seed = seeds[0];

  // The stirred seed = (RANDOM + FRAME + SPIN_COUNT) & 0xff; poke the three bytes so its
  // bit 7 is set (0x40 + 0x40 = 0x80) and record 9 holds nonzero low bits, so the XOR is
  // observable. Confirm the toggle actually fired, then that oracle == candidate.
  let fired = 0;
  const cases = [
    { rnd: 0x00, spin: 0x40, frame: 0x40 }, // sum 0x80 -> bit7 set
    { rnd: 0x10, spin: 0x40, frame: 0x40 }, // sum 0x90 -> bit7 set
    { rnd: 0x00, spin: 0x00, frame: 0x00 }, // sum 0x00 -> bit7 clear (no toggle) — control
  ];
  for (const { rnd, spin, frame } of cases) {
    const e = craft(seed, BODY_PHASE);
    e.mem.write8(RANDOM, rnd); e.mem.write8(SPIN_COUNT, spin); e.mem.write8(FRAME, frame);
    e.mem.write8(REC9_CODE, 0x51); // nonzero low bits so a bit-7 toggle is visible

    const before9 = e.mem.read8(REC9_CODE);
    const o = runOracle(e);
    if (o.mem.read8(REC9_CODE) !== before9) fired++;

    const diffs = contractDiffs(e, animateSpriteObjectBlock);
    assert.equal(diffs.length, 0, `rnd=${hx(rnd)} spin=${hx(spin)} frame=${hx(frame)}: ${diffs.join("; ")}`);
  }
  assert.ok(fired >= 1, "the random bit-7 toggle never fired — the random-flip arm went untested");
  console.log(`  EQUAL/random-flip: record-9 toggle fired on ${fired}/${cases.length} crafted seeds, all match the oracle`);
});

// -- 4. TEETH (drop the throttle) ---------------------------------------------

test("TEETH: the drop-the-throttle twin is CAUGHT on an early-return phase value", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const e = craft(seeds[0], EARLY_PHASE);
  const diffs = contractDiffs(e, brokenNoThrottle);
  assert.ok(diffs.length > 0, "the no-throttle twin escaped detection — the 1-in-8 gate is not being tested");
  // and the correct routine IS equal on the very same entry
  assert.equal(contractDiffs(craft(seeds[0], EARLY_PHASE), animateSpriteObjectBlock).length, 0,
    "animateSpriteObjectBlock must pass the early-return entry");
  console.log(`  TEETH/throttle: no-throttle twin caught on early-return phase (${diffs[0]})`);
});

// -- 5. TEETH (store, not XOR, on record 9) -----------------------------------

test("TEETH: the store-instead-of-XOR twin on record 9 is CAUGHT (the RMW is load-bearing)", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture with nonzero sprite data");
  const e = craft(seeds[0], BODY_PHASE);
  // Force the stirred seed's bit 7 CLEAR and record 9 nonzero: store writes 0x00, XOR
  // leaves the byte unchanged — a guaranteed, non-coincidental divergence.
  e.mem.write8(RANDOM, 0x00); e.mem.write8(SPIN_COUNT, 0x00); e.mem.write8(FRAME, 0x00);
  e.mem.write8(REC9_CODE, 0x51);
  const b = e.mem.read8(REC9_CODE);
  assert.notEqual(b, 0x00, "seed record-9 byte is zero — cannot distinguish store from XOR");

  const diffs = contractDiffs(e, brokenStoreRec9);
  assert.ok(diffs.length > 0, "the store-instead-of-XOR twin escaped detection — the record-9 RMW is not being tested");
  assert.equal(contractDiffs(craft(seeds[0], BODY_PHASE), animateSpriteObjectBlock).length, 0,
    "animateSpriteObjectBlock must pass the body-path entry");
  console.log(`  TEETH/store: store-not-XOR twin on record 9 caught (${diffs[0]}) with seed byte ${hx(b)}`);
});
