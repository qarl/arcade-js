// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for seed25mBoardObjects (ROM 0x0FD7) — the 25m board's initial
 * object-record + sprite-shadow setup (entry 1 of the 0x0FCD per-board dispatch
 * table). A straight-line orchestrator over two inline `ldir`s and four callee calls
 * (replicateGroupStrided ×3, loc_11fa, seedSpriteObjectPair).
 *
 * loc_0fd7 WRITES memory across pages 0x64/0x66/0x67/0x68/0x69/0x6A and reads only
 * ROM constants (all its sources are < 0x4000; the only RAM it reads are object
 * records it wrote itself, inside seedSpriteObjectPair). So it is validated by
 * capture/clone/replay on a FRESH clone per case — never by reusing one machine, and
 * never on the full register file, cycles, SP or PC. The contract compared is RAM
 * (minus the stack scratch below the entry SP) only: LIVE-OUT is memory-only (the `ret` returns to a `call`
 * that reads no register this routine leaves — see the routine header).
 *
 *   1. REALISM — hook 0x0FD7 in a real attract run and clone the machine at each real
 *      dispatch. Attract plays 25m, so its board build dispatches this routine. For
 *      each capture, run oracle vs seed25mBoardObjects on two fresh clones and confirm
 *      identical RAM (ex-stack).
 *
 *   2. CRAFTED — the routine's inputs are fixed ROM constants (a real dispatch already
 *      exercises every write), so the crafted cases harden the gate instead of reaching
 *      new arms: sentinel-fill the entire destination footprint (0x6400–0x6AFF) FIRST,
 *      identically on both sides, so any short, missing, or mis-placed write surfaces as
 *      a sentinel-vs-written mismatch. Both 0xA5 and 0x00 sentinels.
 *
 *   3. TEETH — a twin that breaks step 7's one subtlety: instead of reusing step 6's
 *      preserved source (0x101B) and stride (C=0x1C), it reloads a different source and
 *      stride. That mis-fills the 0x68 records and MUST be caught — on the real capture
 *      (0x6807 differs) and on a prefilled craft.
 *
 * NOT COMPARED, deliberately: SP, PC, cycles, and the full register file (docs/decompiler-pipeline). The
 * oracle's `ret` and internal `call`s move SP/PC and the cycle counter; the idiomatic
 * layer drops that model (the JS call stack replaces it). The oracle's stack pushes land
 * only in STACK_SCRATCH, which the RAM diff skips.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0fd7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fd7 as oracle } from "../../translated/loc_0fd7.js";
import { seed25mBoardObjects } from "../seed25mBoardObjects.js";
import { replicateGroupStrided } from "../replicateGroupStrided.js";
import { loc_11fa } from "../loc_11fa.js";
import { seedSpriteObjectPair } from "../seedSpriteObjectPair.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0fd7;

const hx = (v) => "0x" + (v & 0xffff).toString(16);


/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

function diffRam(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * Hook 0x0FD7 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop. (An unhooked Machine wires only the ORACLE registry, so
 * the oracle's own nested m.call(0x122a/0x11fa/0x11a6) resolve to translated too.)
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** Clone a capture and sentinel-fill the whole destination footprint so a short or
 *  mis-placed write shows. Applied identically on both sides by diffRam. */
function craftPrefill(cap, sentinel) {
  const w = cap.clone();
  for (let a = 0x6400; a <= 0x6aff; a++) w.mem.write8(a, sentinel);
  return w;
}

// -- 1. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x0FD7 dispatches — RAM (ex-stack) matches the oracle", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x0FD7 dispatch during attract");

  for (const cap of caps) {
    const ram = diffRam(cap, seed25mBoardObjects);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  REALISM: ${caps.length} real 0x0FD7 dispatch(es) — identical RAM (ex-stack)`);
});

// -- 2. CRAFTED (footprint prefill, both sides) -------------------------------

test("CRAFTED: footprint-prefill (0xA5 and 0x00) — RAM (ex-stack) still matches the oracle", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to derive crafted entries from");

  for (const sentinel of [0xa5, 0x00]) {
    const w = craftPrefill(base, sentinel);
    const ram = diffRam(w, seed25mBoardObjects);
    assert.equal(
      ram,
      null,
      ram && `[prefill ${hx(sentinel)}] RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`,
    );
  }
  console.log("  CRAFTED: both prefills (0xA5, 0x00) identical to the oracle across the full footprint");
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: step 7 reloads a fresh source (0x3E00) and stride (C=0x0C) instead of
 * reusing the 0x101B source and C=0x1C that step 6 left in place — the exact mistake a
 * reader would make by "helpfully" re-initialising the second call. It mis-fills the
 * 0x68-page records (wrong bytes at wrong stride), so a real memory compare bites while
 * everything else stays faithful.
 */
function brokenReloadStep7(m) {
  const { regs, mem } = m;

  blockCopy(mem, 0x3ddc, 0x69a8, 0x10);

  regs.hl = 0x3dec;
  regs.de = 0x6407;
  regs.bc = 0x051c;
  replicateGroupStrided(m);

  regs.hl = 0x3df4;
  loc_11fa(m);

  blockCopy(mem, 0x3e00, 0x69fc, 0x04);

  regs.hl = 0x3e0c;
  seedSpriteObjectPair(m);

  regs.hl = 0x101b;
  regs.de = 0x6707;
  regs.bc = 0x081c;
  replicateGroupStrided(m);

  regs.hl = 0x3e00; // BUG: should reuse 0x101B preserved from step 6
  regs.de = 0x6807;
  regs.bc = 0x020c; // BUG: should reuse C=0x1C preserved from step 6 (B ok)
  replicateGroupStrided(m);
}

/** local LDIR mirror for the twin (the real routine's blockCopy is module-private). */
function blockCopy(mem, src, dst, len) {
  for (let i = 0; i < len; i++) mem.write8((dst + i) & 0xffff, mem.read8((src + i) & 0xffff));
}

test("TEETH: the step-7 source/stride-reload twin is CAUGHT — on the real capture and a prefill", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to rig a teeth entry from");

  const ramReal = diffRam(base, brokenReloadStep7);
  assert.notEqual(ramReal, null, "the RAM gate FAILED to catch the step-7 reload twin on the real capture — it is worthless");
  console.log(`  TEETH/capture: caught by RAM at ${hx(ramReal.addr)} (oracle=${ramReal.a} broken=${ramReal.b})`);

  const w = craftPrefill(base, 0xa5);
  const ramCraft = diffRam(w, brokenReloadStep7);
  assert.notEqual(ramCraft, null, "the RAM gate FAILED to catch the step-7 reload twin on a prefilled craft");
  console.log(`  TEETH/craft: also caught by RAM at ${hx(ramCraft.addr)} (oracle=${ramCraft.a} broken=${ramCraft.b})`);
});
