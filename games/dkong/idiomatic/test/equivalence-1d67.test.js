// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for endClimbAtLadderLimit (ROM 0x1d67) — the climb stepper's
 * ladder-end dismount arm.
 *
 * The routine WRITES MEMORY (0x6207 := 6, 0x6219 := 0, 0x6215 := 0, then the four
 * sprite-record bytes 0x694C..0x694F via its 0x1DA6 tail) and its oracle ends in a
 * `ret` (the 0x1DA6 tail's), so it is gated on MEMORY-equivalence — RAM (minus
 * STACK_SCRATCH) + pc + SP — never on a register file (its live-out is memory-only;
 * see the routine header), and every case runs on a FRESH clone (a reused clone is
 * only safe for a read-only leaf; this writes). The idiomatic routine models the Z80
 * `ret` as a JS return and touches no pc/SP, so the harness performs ONE m.ret() on
 * the candidate clone after the call to line pc + SP up with the oracle (the oracle
 * reaches its `ret` at 0x1DBC through the unconditional `jp 0x1da6` tail; that pop
 * reads bytes in STACK_SCRATCH, excluded by the contract).
 *
 * The oracle itself dispatches its 0x1DA6 tail through m.call, which resolves via the
 * clone's routine registry to the TRANSLATED entry_1da6 (the frozen oracle for that
 * address); the idiomatic routine calls the proven-equivalent writeMarioSpriteRecord
 * directly. loc_1d67 is a single straight-line arm (no branches), so one real
 * dispatch is its full control-flow coverage; crafted entries then exercise the data.
 *
 *   1. EQUAL (real dispatches) — hook 0x1d67 in a real attract run. The 25m demo
 *      climbs a ladder to its top, so loc_1d11 tail-jumps here for real (once per
 *      attract loop). oracle vs candidate must agree on RAM + pc + SP.
 *
 *   2. EQUAL (crafted source + pre-set targets) — from a real captured state, poke the
 *      four sprite source fields (X/code/attr/Y) to distinct sentinels AND pre-set the
 *      three stored bytes (0x6207/0x6219/0x6215) to non-target values, so the crafted
 *      cases pin (a) the exact source->record-slot copy and (b) that the three stores
 *      force 6/0/0 regardless of prior contents. Each compared identically both sides.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) keep-on-ladder — omits the MARIO_ON_LADDER (0x6215) := 0 store, leaving it
 *          at its entry value; diverges whenever 0x6215 != 0 at entry (it is 1 — on a
 *          ladder — on every real dispatch).
 *      (b) wrong-sprite-code — writes 0x04 (a climb pose) into 0x6207 instead of 0x06,
 *          which also propagates to record slot +1; diverges on every entry.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1d67.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d67 as oracle } from "../../translated/loc_1d67.js";
import { endClimbAtLadderLimit } from "../endClimbAtLadderLimit.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_X, MARIO_Y, MARIO_SPRITE_CODE, MARIO_SPRITE_ATTR, MARIO_ON_LADDER,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1d67;
const CLIMB_TOGGLE = 0x6219; // unnamed climb-toggle scratch (names.js reject); kept hex
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

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

/** Run the ORACLE on a fresh clone. Its 0x1DA6 tail's `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

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

/**
 * Hook 0x1d67 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. The caller (loc_1d11) reaches 0x1d67 by `m.call(0x1d67)`, which resolves
 * through the routine registry the override overlays, so the dispatch is captured here.
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

/**
 * A real captured state with the four sprite source fields poked to sentinels, the
 * three stored bytes pre-set to non-target values, and a safe SP.
 */
function craft(seed, { x, code, attr, y, tog, lad }) {
  const e = seed.clone();
  e.mem.write8(MARIO_X, x);
  e.mem.write8(MARIO_SPRITE_CODE, code);
  e.mem.write8(MARIO_SPRITE_ATTR, attr);
  e.mem.write8(MARIO_Y, y);
  e.mem.write8(CLIMB_TOGGLE, tog);
  e.mem.write8(MARIO_ON_LADDER, lad);
  e.regs.sp = 0x6bfe; // the ret's pop lands in STACK_SCRATCH, well clear of work RAM
  return e;
}

/** Broken twin (a): KEEP-ON-LADDER — omits clearing MARIO_ON_LADDER (0x6215), leaving
 *  it at its entry value. Diverges whenever 0x6215 != 0 on entry (it is 1 — on a ladder
 *  — on every real dispatch). */
function brokenKeepOnLadder(m) {
  const { mem } = m;
  mem.write8(MARIO_SPRITE_CODE, 0x06);
  mem.write8(CLIMB_TOGGLE, 0x00);
  // BUG: MARIO_ON_LADDER := 0 store dropped.
  writeMarioSpriteRecord(m);
}

/** Broken twin (b): WRONG-SPRITE-CODE — writes 0x04 (a climb pose) into 0x6207 instead
 *  of 0x06. Diverges on every entry, both at 0x6207 and at record slot +1 (0x694D). */
function brokenWrongSpriteCode(m) {
  const { mem } = m;
  mem.write8(MARIO_SPRITE_CODE, 0x04); // BUG: 0x04, not 0x06
  mem.write8(CLIMB_TOGGLE, 0x00);
  mem.write8(MARIO_ON_LADDER, 0x00);
  writeMarioSpriteRecord(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): endClimbAtLadderLimit == oracle on every captured 0x1d67 entry", () => {
  const caps = captureDispatches(64, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1d67 dispatch during attract (25m ladder-top)");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, endClimbAtLadderLimit); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const c0 = caps[0];
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatch(es) identical on RAM+pc+SP ` +
      `(entry 0x6215=${hx(c0.mem.read8(MARIO_ON_LADDER))}, 0x6207=${hx(c0.mem.read8(MARIO_SPRITE_CODE))})`,
  );
});

// -- 2. EQUAL (crafted source + pre-set targets) ------------------------------

test("EQUAL (crafted): distinct sprite sources + non-target pre-values match the oracle", () => {
  const caps = captureDispatches(1, 4000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [
    { name: "all sources distinct, targets pre-set high", e: craft(seed, { x: 0x11, code: 0xab, attr: 0x33, y: 0x44, tog: 0xff, lad: 0xff }) },
    { name: "X==Y, code!=attr, targets already 1", e: craft(seed, { x: 0x55, code: 0x88, attr: 0x99, y: 0x55, tog: 0x01, lad: 0x01 }) },
    { name: "extremes 0x00/0xff, mixed targets", e: craft(seed, { x: 0x00, code: 0x00, attr: 0x00, y: 0xff, tog: 0x55, lad: 0xaa }) },
    { name: "code already 0x06 (store is a no-op there), lad set", e: craft(seed, { x: 0x7e, code: 0x06, attr: 0x02, y: 0x10, tog: 0x00, lad: 0x77 }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, endClimbAtLadderLimit);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} distinct-sentinel entries identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the keep-on-ladder and wrong-sprite-code twins are CAUGHT", () => {
  const caps = captureDispatches(64, 4000);
  assert.ok(caps.length >= 1, "need real captures for the teeth check");
  const seed = caps[0];

  // A crafted entry where 0x6215 != 0 and the sprite code differs, so BOTH twins diverge.
  const entry = craft(seed, { x: 0x11, code: 0xab, attr: 0x33, y: 0x44, tog: 0x00, lad: 0x01 });

  const keep = contractDiffs(entry, brokenKeepOnLadder);
  const wrong = contractDiffs(entry, brokenWrongSpriteCode);
  assert.ok(keep.length > 0, "the keep-on-ladder twin escaped on the crafted entry — the gate is worthless");
  assert.ok(wrong.length > 0, "the wrong-sprite-code twin escaped on the crafted entry — the gate is worthless");

  // And confirm each is caught on the real dispatches too (0x6215 is 1 on a ladder, so
  // keep-on-ladder must fork; wrong-sprite-code forks on every entry).
  const keepReal = caps.filter((c) => c.mem.read8(MARIO_ON_LADDER) !== 0);
  let caughtKeep = 0, caughtWrong = 0;
  for (const c of keepReal) if (contractDiffs(c, brokenKeepOnLadder).length > 0) caughtKeep++;
  for (const c of caps) if (contractDiffs(c, brokenWrongSpriteCode).length > 0) caughtWrong++;
  assert.equal(caughtKeep, keepReal.length,
    `keep-on-ladder escaped on ${keepReal.length - caughtKeep}/${keepReal.length} real dispatches where 0x6215 != 0`);
  assert.equal(caughtWrong, caps.length,
    `wrong-sprite-code escaped on ${caps.length - caughtWrong}/${caps.length} real dispatches`);

  console.log(
    `  TEETH: keep-on-ladder caught on the crafted entry (${keep[0]}) and all ${keepReal.length} real on-ladder dispatches; ` +
      `wrong-sprite-code caught on the crafted entry (${wrong[0]}) and all ${caps.length} real dispatches`,
  );
});
