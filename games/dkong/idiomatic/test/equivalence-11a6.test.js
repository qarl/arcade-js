// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for seedSpriteObjectPair (ROM 0x11a6) — seed a pair of object
 * records from ROM templates, mark both active, and emit their two hardware sprite
 * records (a four-step orchestrator over copyBytePairsStrided / replicateGroupStrided
 * / gatherSpriteRecords).
 *
 * sub_11a6 WRITES memory (the two object records at 0x6680–0x669a and the two sprite
 * records at 0x6A18–0x6A1F) and takes an implicit live-in HL (the caller's ROM position
 * table), so it is validated by capture/clone/replay on a FRESH clone per case — never
 * by reusing one machine, and never on the full register file, cycles, SP or PC. The
 * contract compared is RAM (minus the stack scratch below the entry SP) only: LIVE-OUT is memory-only (all
 * three call sites reload HL/DE/BC and branch on no flag right after the call, so every
 * register/flag left here is dead ABI — see the routine header).
 *
 *   1. REALISM — hook 0x11a6 in a real attract run and clone the machine at each real
 *      dispatch. Attract's 25m board build reaches exactly the first call site
 *      (HL=0x3E0C via loc_0fd7). For each, run oracle vs seedSpriteObjectPair on two
 *      fresh clones and confirm identical RAM (ex-stack).
 *
 *   2. CRAFTED — attract only exercises the HL=0x3E0C site, so poke a real capture into
 *      the two sites it never reaches (HL=0x3E10 via loc_101f, HL=0x3E14 via loc_1131),
 *      identically on both sides, and a destination-prefill variant that seeds the whole
 *      object/sprite footprint with a sentinel first (so an incomplete/short write would
 *      surface). Every crafted state is applied to both sides, so any divergence is the
 *      rewrite's fault.
 *
 *   3. TEETH — a stride-transposition twin (swaps step 1's C=0x0e with step 2's C=0x0c,
 *      a copy-paste bug between the two near-identical setup calls) mis-places the second
 *      record's fields and MUST be caught, on the real capture and on a prefilled craft.
 *
 * NOT COMPARED, deliberately: SP, PC, cycles, and the full register file (docs/decompiler-pipeline). The
 * oracle's `ret` and internal `call`s move SP/PC and the cycle counter; the idiomatic
 * layer drops that model (the JS call stack replaces it). Its callees' stray stores land
 * only in STACK_SCRATCH (SP=0x6bec in the real capture), which the RAM diff skips.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-11a6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_11a6 as oracle } from "../../translated/loc_11a6.js";
import { seedSpriteObjectPair } from "../seedSpriteObjectPair.js";
import { copyBytePairsStrided } from "../copyBytePairsStrided.js";
import { replicateGroupStrided } from "../replicateGroupStrided.js";
import { gatherSpriteRecords } from "../gatherSpriteRecords.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x11a6;

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

/**
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing,
 * live-in-dependent routine demands a fresh clone per side) and diff RAM (ex-stack).
 */
function diffRam(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * Hook 0x11a6 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop.
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

/** Clone a capture, point the live-in HL at another call site's ROM table, and
 *  optionally pre-fill the object/sprite footprint with a sentinel so a short write
 *  would show. Applied identically on both sides by diffRam. */
function craftEntry(cap, { hl, prefill }) {
  const w = cap.clone();
  if (hl !== undefined) w.regs.hl = hl;
  if (prefill !== undefined) {
    for (let a = 0x6680; a <= 0x66a0; a++) w.mem.write8(a, prefill);
    for (let a = 0x6a18; a <= 0x6a20; a++) w.mem.write8(a, prefill);
  }
  return w;
}

test("REALISM: real captured 0x11a6 dispatches — RAM (ex-stack) matches the oracle", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x11a6 dispatch during attract");

  for (const cap of caps) {
    const ram = diffRam(cap, seedSpriteObjectPair);
    assert.equal(
      ram,
      null,
      ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b} (HL=${hx(cap.regs.hl)})`,
    );
  }
  console.log(`  REALISM: ${caps.length} real 0x11a6 dispatch(es) — identical RAM (ex-stack)`);
});

test("CRAFTED: the two call sites attract never reaches (HL=0x3E10, 0x3E14) + a prefill match", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to derive crafted entries from");

  const cases = [
    { name: "HL=0x3E10 (loc_101f / call site 0x1073)", hl: 0x3e10 },
    { name: "HL=0x3E14 (loc_1131 / call site 0x1140)", hl: 0x3e14 },
    { name: "HL=0x3E0C, footprint prefilled 0xA5", hl: 0x3e0c, prefill: 0xa5 },
    { name: "HL=0x3E14, footprint prefilled 0x00", hl: 0x3e14, prefill: 0x00 },
  ];

  for (const c of cases) {
    const w = craftEntry(base, c);
    const ram = diffRam(w, seedSpriteObjectPair);
    assert.equal(ram, null, ram && `[${c.name}] RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  CRAFTED: ${cases.length} entries (both unreached sites + prefills) identical to the oracle`);
});

/**
 * Broken twin: transposes the two per-record stride constants — step 1 gets C=0x0c and
 * step 2 gets C=0x0e (they should be 0x0e and 0x0c). A wholly plausible copy-paste
 * between the two near-identical setup calls. It mis-places the SECOND record's position
 * (+3/+5) and appearance (+7..+a) fields, so both that object record and its gathered
 * sprite record diverge. Everything else is faithful, so only a real memory compare bites.
 */
function brokenStrideSwap(m) {
  const { regs, mem } = m;
  regs.de = 0x6683;
  regs.bc = 0x020c; // BUG: C should be 0x0e
  copyBytePairsStrided(m);
  regs.hl = 0x3e08;
  regs.de = 0x6687;
  regs.bc = 0x020e; // BUG: C should be 0x0c
  replicateGroupStrided(m);
  regs.ix = 0x6680;
  mem.write8(0x6680, 0x01);
  mem.write8(0x6690, 0x01);
  regs.hl = 0x6a18;
  regs.b = 0x02;
  regs.de = 0x0010;
  gatherSpriteRecords(m);
}

test("TEETH: the stride-transposition twin is CAUGHT — on a prefilled craft and on the real capture", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to rig a teeth entry from");

  // Prefilled craft: the sentinel makes the second record's mis-placed writes vs the
  // oracle's correct writes deterministically visible.
  const w = craftEntry(base, { hl: 0x3e0c, prefill: 0xa5 });
  const ramCraft = diffRam(w, brokenStrideSwap);
  assert.notEqual(ramCraft, null, "the RAM gate FAILED to catch the stride-transposition twin on a prefilled craft — it is worthless");
  console.log(`  TEETH/craft: caught by RAM at ${hx(ramCraft.addr)} (oracle=${ramCraft.a} broken=${ramCraft.b})`);

  // Also on the real capture (real ROM tables give the two records distinct fields).
  const ramReal = diffRam(base, brokenStrideSwap);
  assert.notEqual(ramReal, null, "the RAM gate FAILED to catch the stride-transposition twin on the real capture");
  console.log(`  TEETH/capture: also caught by RAM at ${hx(ramReal.addr)} (oracle=${ramReal.a} broken=${ramReal.b})`);
});
