// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for enqueueTask (ROM 0x309F) — the task-ring post primitive.
 *
 * enqueueTask WRITES memory (the ring at 0x60C0–0x60FF and the tail at 0x60B0) and
 * is a subroutine, not a pure leaf, so it is gated by capture / clone / replay
 * (docs/decompiler-pipeline), NOT the exhaustive-leaf pattern:
 *
 *   1. EQUAL (real captured dispatches) — hook 0x309F in a real attract run and
 *      clone the machine at each true dispatch (a FRESH clone per case, since the
 *      routine mutates RAM). For each, run the ORACLE on one clone and enqueueTask
 *      on another and confirm they leave IDENTICAL RAM everywhere game-visible —
 *      the diff is confined to STACK_SCRATCH. That confinement is the whole point:
 *      the oracle models `push hl … pop hl … ret` (writing HL to the stack and
 *      consuming the return address, so its SP/pc move); enqueueTask uses the JS
 *      call stack and models neither, so the ONLY residual difference is the
 *      pushed-HL bytes in dead stack scratch. Every game-visible byte matches.
 *
 *   2. EQUAL (crafted arms) — attract only exercises the no-wrap WRITE arm, so the
 *      OCCUPIED-slot DROP arm and the wrap-around arm are forced by poking one
 *      byte on a real captured entry, IDENTICALLY on both sides (the crafted
 *      entry): DROP (clear the slot's bit 7 → full), WRAP (tail = 0xFE → advance
 *      past 0xFF wraps to 0xC0), plus the base and pre-wrap boundaries.
 *
 *   3. TEETH — a deliberately-broken twin that advances the tail by 1 instead of 2
 *      (a plausible off-by-one) MUST be caught by the captured sweep, naming
 *      TASK_TAIL (0x60B0). A gate that a real corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-309f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_309f as oracle } from "../../translated/loc_309f.js";
import { enqueueTask } from "../enqueueTask.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x309f;
const TASK_TAIL = 0x60b0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference that is OUTSIDE
 * STACK_SCRATCH (game-visible — a real failure) or null, plus how many bytes
 * differed inside the dead stack scratch (the tolerated push-HL residue).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Replay one entry state through the oracle and a candidate on independent
 * clones (FRESH per side — the routine writes RAM), and return the diff.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x309F in a real attract run and clone the machine at up to K true
 * dispatches. Each clone is one real captured entry; the wrapper delegates to the
 * oracle so the host run proceeds to a clean stop.
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

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): enqueueTask == oracle on every real attract dispatch (diff confined to stack)", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x309F dispatch during attract");

  for (const entry of caps) {
    const { bad } = replay(entry, enqueueTask);
    // bad is the first difference OUTSIDE stack scratch, so bad === null means
    // every game-visible byte matches the oracle (any residue is stack-confined).
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on tail=${hx(entry.mem.read8(TASK_TAIL))}`,
    );
    // The oracle's push writes HL to [SP-2,SP-1]; that residue must land inside
    // dead stack scratch, so excluding the stack scratch below the entry SP cannot mask a real diff.
    // (It may be invisible when the stack already holds HL there — that is fine;
    // what matters is that the push TARGET is in-region.)
    assert.ok(
      (entry.regs.sp - 2) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push target must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    // enqueueTask must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    enqueueTask(b);
    assert.equal(b.regs.sp, sp0, "enqueueTask must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "enqueueTask must leave pc unchanged (no ret modelling)");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): DROP / WRAP / boundary arms attract never reaches match the oracle", () => {
  const caps = captureDispatches(1, 400);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // Each craft pokes ONE variable identically on both sides; the crafted entry is
  // a real state with a surgical nudge (docs/decompiler-pipeline), not a fabrication.
  const arms = [
    // Occupied slot at the tail (bit 7 clear) -> ring full -> DROP, tail untouched.
    ["DROP", (m) => { m.mem.write8(0x6000 | m.mem.read8(TASK_TAIL), 0x00); }],
    // Tail at the last slot, free -> write, advance past 0xFF -> WRAP to 0xC0.
    ["WRAP", (m) => { m.mem.write8(TASK_TAIL, 0xfe); m.mem.write8(0x60fe, 0xff); m.mem.write8(0x60ff, 0xff); }],
    // Base slot, free -> plain write, no wrap.
    ["NOWRAP@base", (m) => { m.mem.write8(TASK_TAIL, 0xc0); m.mem.write8(0x60c0, 0xff); }],
    // Pre-wrap boundary: tail 0xFC -> next 0xFE (>= 0xC0, no wrap).
    ["boundary", (m) => { m.mem.write8(TASK_TAIL, 0xfc); m.mem.write8(0x60fc, 0xff); }],
  ];

  for (const [label, craft] of arms) {
    const a = entry.clone(); const b = entry.clone();
    craft(a); craft(b);
    oracle(a);
    enqueueTask(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(`  EQUAL/crafted ${label}: tail 0x60b0 -> ${hx(a.mem.read8(TASK_TAIL))}, game-visible RAM identical`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: advances the tail by 1 instead of 2 (a plausible off-by-one). It
 * writes the same two payload bytes, so it only diverges at TASK_TAIL — which is
 * exactly the subtle, load-bearing kind of bug the gate must not miss.
 */
function brokenEnqueueTask(m) {
  const { regs, mem } = m;
  const tail = mem.read8(TASK_TAIL);
  const slot = 0x6000 | tail;
  if ((mem.read8(slot) & 0x80) === 0) return;
  mem.write8(slot, regs.d);
  mem.write8(0x6000 | ((tail + 1) & 0xff), regs.e);
  let next = (tail + 1) & 0xff; // BUG: should advance by 2
  if (next < 0xc0) next = 0xc0;
  mem.write8(TASK_TAIL, next);
}

test("TEETH (captured): the wrong tail advance is CAUGHT and names 0x60b0", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenEnqueueTask);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a wrong tail advance — it is worthless");
  assert.equal(caught.addr, TASK_TAIL, `expected the caught diff at 0x60b0, got ${hx(caught.addr)}`);
  console.log(`  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
