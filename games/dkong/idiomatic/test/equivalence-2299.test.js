// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advance50mObjectStateOnRandomGate (ROM 0x2299) — advance a board object to its next state
 * on a randomised pacing gate.
 *
 * advance50mObjectStateOnRandomGate is a LEAF and one of the four state-machine arms dispatch50mObjectState dispatches for a board
 * object. dispatch50mObjectState's body picks the object's record base (0x6280 odd frames / 0x6288 even),
 * PUSHES it, and jumps into this arm; the arm's `pop hl` reads that record base back, so the
 * pointer arrives on the STACK, not in a register. The idiomatic routine models it honestly
 * as a PARAMETER — advance50mObjectStateOnRandomGate(m, recordBase) — and returns plainly, dropping the oracle's
 * `pop hl` + `ret` bracket. The whole memory-observable behaviour is a function of just two
 * bytes: RANDOM (0x6018) decides the gate, and the record's state byte is what gets stepped.
 *
 * ABI: the oracle consumes exactly TWO stack slots on every path — the record base (`pop hl`)
 * and the caller return (`ret`). So runCandidate pops the record base off the crafted stack,
 * passes it as the honest argument, then does one m.ret() to line pc + SP up with the oracle.
 * The pushed slots live in STACK_SCRATCH and are excluded from the RAM diff (memory-equivalence
 * contract); they are identical on both sides anyway (the oracle only READS them).
 *
 *   1. EQUAL (exhaustive) — all 256 RANDOM values decide the gate completely; swept against
 *      both real record bases (0x6280 / 0x6288) and boundary state bytes (0x00, 0x02, 0xFF —
 *      including the 0xFF -> 0x00 wrap), on a real attract base. RAM − the stack scratch below the entry SP + pc + SP
 *      identical to the oracle across the whole product. A proof, not a sample.
 *
 *   2. EQUAL (crafted arms) — the two decisions made explicit with oracle-behaviour checks:
 *      gate OPEN (RANDOM & 0x3C == 0) steps the state byte to state+1 (non-vacuity: the byte
 *      really changed), gate CLOSED (RANDOM & 0x3C != 0) writes nothing outside the stack.
 *
 *   3. TEETH — three broken twins, each MUST be caught by the exhaustive sweep:
 *      (a) inverted gate — advances when it should linger and vice-versa.
 *      (b) dropped advance — never steps the state byte (caught AT the record base).
 *      (c) wrong mask (0x1C) — drops gate bit 5, so it advances on RANDOM values the oracle
 *          holds on (e.g. 0x20); justifies the exact 0x3C mask.
 *
 *   4. REACHABILITY — 0x2299 is NOT naturally dispatched in attract (dispatch50mObjectState runs every
 *      frame there but its object machine never reaches this arm), so there are no captured
 *      dispatches; the exhaustive gate sweep is the coverage. Any dispatch that DOES occur is
 *      verified against the oracle so the test stays correct if attract ever reaches it.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2299.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2299 as oracle } from "../../translated/loc_2299.js";
import { loc_2207 as oracle2207 } from "../../translated/loc_2207.js";
import { advance50mObjectStateOnRandomGate } from "../advance50mObjectStateOnRandomGate.js";
import { Machine } from "../../machine.js";
import { RANDOM, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2299;
// The caller-return the terminal `ret` pops. advance50mObjectStateOnRandomGate is a shared tail reached by `jp`, so the
// real return goes all the way back to dispatch50mObjectState's caller (~0x199e); the exact value is
// immaterial — both sides pop the SAME one, so pc lines up regardless.
const RET_ADDR = 0x199e;

// The two record bases dispatch50mObjectState's body actually supplies (BOARD_OBJ_SCRATCH and +8). Each is
// the object's own state byte — the cell this arm steps. Well outside the stack scratch below the entry SP.
const REC_A = 0x6280;
const REC_B = 0x6288;
const START_BYTES = [0x00, 0x02, 0xff]; // 0x02 is the realistic state that selects this arm; 0xFF proves the wrap.

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// Non-stack RAM addresses that changed between two machines (no-write check on the gate-closed path).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic
// values. The 0x2299 arm is never reached here; its paths are crafted by poking on top.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x2299 dispatch onto a clone of the base: the caller return and the record
// base pushed (so the oracle's `pop hl` + `ret` have valid targets), the RANDOM gate byte, and
// the record's starting state byte.
function makeEntry(base, recordBase, rnd, startByte) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);   // popped by the terminal `ret`
  m.push16(recordBase); // popped by `pop hl` — the stacked record-base argument
  m.mem.write8(RANDOM, rnd);
  m.mem.write8(recordBase, startByte);
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

/** Run the ORACLE on a fresh clone. It performs its own `pop hl` + terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone. The stacked record base is popped and handed in as the
 * honest argument (mirroring how dispatch50mObjectState passes it), then one m.ret() models the terminal
 * `ret` so pc + SP match the oracle — the idiomatic routine touches no stack itself.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const recordBase = c.pop16(); // the stacked argument
  fn(c, recordBase);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// Exhaustive sweep over (record base × start byte × all 256 RANDOM). Returns the first
// mismatching case (with its RAM diff) or null, plus the number of combos compared.
function sweep(base, fn) {
  let count = 0;
  for (const recordBase of [REC_A, REC_B]) {
    for (const startByte of START_BYTES) {
      for (let rnd = 0; rnd < 256; rnd++) {
        const entry = makeEntry(base, recordBase, rnd, startByte);
        const diffs = contractDiffs(entry, fn);
        count++;
        if (diffs.length) {
          const ram = firstRamDiff(runOracle(entry), runCandidate(entry, fn), entry.regs.sp);
          return { mismatch: { recordBase, rnd, startByte, diffs, ram }, count };
        }
      }
    }
  }
  return { mismatch: null, count };
}

const describe = (mm) =>
  mm &&
  `recordBase=${hx(mm.recordBase)} RANDOM=${hx(mm.rnd)} startByte=${hx(mm.startByte)}: ${mm.diffs.join("; ")}`;

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): advance50mObjectStateOnRandomGate == oracle across the full (base × startByte × RANDOM) space", () => {
  const base = attractBase();
  const { mismatch, count } = sweep(base, advance50mObjectStateOnRandomGate);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 2 * START_BYTES.length * 256, "must have compared the whole product exhaustively");
  console.log(`  EQUAL/exhaustive: ${count} (base, startByte, RANDOM) combos — RAM+pc+SP identical to the oracle`);
});

// -- 2. EQUAL (crafted arms, explicit oracle behaviour) -----------------------

test("EQUAL (crafted): gate-open steps the state byte, gate-closed writes nothing", () => {
  const base = attractBase();
  const OPEN = [0x00, 0x03, 0x40, 0xc0];   // RANDOM & 0x3C == 0  -> advance
  const CLOSED = [0x04, 0x08, 0x20, 0x3c, 0xff]; // RANDOM & 0x3C != 0 -> linger

  let opened = 0, closed = 0;
  for (const recordBase of [REC_A, REC_B]) {
    for (const rnd of OPEN) {
      const entry = makeEntry(base, recordBase, rnd, 0x02);
      assert.equal(contractDiffs(entry, advance50mObjectStateOnRandomGate).length, 0, `open ${hx(rnd)} @ ${hx(recordBase)}`);
      const after = runOracle(entry);
      // Non-vacuity: the state byte really advanced by one.
      assert.equal(after.mem.read8(recordBase), 0x03, `open ${hx(rnd)}: state byte not stepped 0x02->0x03`);
      opened++;
    }
    for (const rnd of CLOSED) {
      const entry = makeEntry(base, recordBase, rnd, 0x02);
      assert.equal(contractDiffs(entry, advance50mObjectStateOnRandomGate).length, 0, `closed ${hx(rnd)} @ ${hx(recordBase)}`);
      const after = runOracle(entry);
      // Nothing non-stack changed on the gate-closed path.
      assert.deepEqual(changedAddrs(entry, after, entry.regs.sp), [], `closed ${hx(rnd)}: wrote non-stack RAM`);
      closed++;
    }
  }
  console.log(`  EQUAL/crafted: ${opened} gate-open (state stepped) + ${closed} gate-closed (no write), both bases — identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): inverts the gate — advances when it should linger, lingers when it should advance. */
function brokenInvertedGate(m, recordBase) {
  const { mem } = m;
  if ((mem.read8(RANDOM) & 0x3c) === 0) return; // BUG: inverted
  mem.write8(recordBase, mem.read8(recordBase) + 1);
}

/** Broken twin (b): never steps the state byte. */
function brokenDroppedAdvance(m, recordBase) {
  const { mem } = m;
  if ((mem.read8(RANDOM) & 0x3c) !== 0) return;
  // BUG: the advance write is missing.
}

/** Broken twin (c): wrong mask 0x1C drops gate bit 5, so it fires on RANDOM values (e.g. 0x20) the oracle skips. */
function brokenWrongMask(m, recordBase) {
  const { mem } = m;
  if ((mem.read8(RANDOM) & 0x1c) !== 0) return; // BUG: 0x1C, not 0x3C
  mem.write8(recordBase, mem.read8(recordBase) + 1);
}

test("TEETH: inverted-gate, dropped-advance, and wrong-mask twins are all CAUGHT", () => {
  const base = attractBase();

  const inv = sweep(base, brokenInvertedGate);
  assert.notEqual(inv.mismatch, null, "the sweep FAILED to catch an inverted gate — worthless");

  const drop = sweep(base, brokenDroppedAdvance);
  assert.notEqual(drop.mismatch, null, "the sweep FAILED to catch a dropped advance — worthless");
  assert.equal(drop.mismatch.ram.addr, drop.mismatch.recordBase,
    `dropped-advance must diverge AT the record base, got ${hx(drop.mismatch.ram?.addr)}`);

  const mask = sweep(base, brokenWrongMask);
  assert.notEqual(mask.mismatch, null, "the sweep FAILED to catch a wrong gate mask — worthless");

  console.log(`  TEETH: inverted caught (${describe(inv.mismatch)}); dropped caught (${describe(drop.mismatch)}); wrong-mask caught (${describe(mask.mismatch)})`);
});

// -- 4. REACHABILITY (crafted-coverage rationale) -----------------------------

test("REACHABILITY: dispatch50mObjectState runs in attract but its 0x2299 arm is not reached", () => {
  let n2207 = 0;
  const caps = [];
  const snap = new Map([
    [0x2207, (mm) => { n2207++; return oracle2207(mm); }],
    [TARGET, (mm) => { if (caps.length < 32) caps.push(mm.clone()); return oracle(mm); }],
  ]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);

  assert.ok(n2207 > 0, "dispatch50mObjectState should be dispatched every frame in attract — harness sanity");
  // If attract ever DOES reach the arm, every real dispatch must still match the oracle.
  for (const cap of caps) {
    assert.equal(contractDiffs(cap, advance50mObjectStateOnRandomGate).length, 0, "a real 0x2299 dispatch diverged from the oracle");
  }
  console.log(`  REACHABILITY: dispatch50mObjectState dispatched ${n2207}× / 3000 frames; 0x2299 arm reached ${caps.length}× — crafted entries are the coverage`);
});
