// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for enqueueTaskBatch (ROM 0x0965) — the fixed task-batch poster.
 *
 * enqueueTaskBatch posts seven messages through enqueueTask, so it WRITES memory
 * (the ring at 0x60C0–0x60FF and the tail at 0x60B0) and is not a pure leaf. It is
 * therefore gated by capture / clone / replay (docs/decompiler-pipeline), with a FRESH clone per case
 * because it mutates RAM — never the exhaustive-leaf pattern:
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0965 in a real attract run and clone
 *      the machine at each true dispatch (it fires once per attract cycle, as the
 *      title screen is composed). For each, run the ORACLE on one clone and
 *      enqueueTaskBatch on another and confirm they leave IDENTICAL RAM everywhere
 *      game-visible — the only residual difference is confined to STACK_SCRATCH. That
 *      confinement is the whole point: the oracle models the per-call push/ret stack
 *      traffic (its SP/pc move); enqueueTaskBatch uses the JS call stack and models
 *      neither, so the sole residue is the pushed bytes in the dead stack scratch.
 *
 *   2. EQUAL (crafted arms) — attract only ever hits this with a free ring, so the
 *      FULL-ring DROP arm (every slot occupied → all seven posts dropped, tail
 *      untouched) and the WRAP arm (tail near the end → the batch wraps past 0xFF back
 *      to 0xC0) are forced by poking the ring/tail on a real captured entry,
 *      IDENTICALLY on both sides. A CLEAN-ring arm additionally pins the exact 14-byte
 *      payload the batch must lay down: 04 00 03 14 03 15 03 16 03 17 03 18 03 19.
 *
 *   3. TEETH — a deliberately-broken twin that posts only FIVE of the six 0x03
 *      messages (args 0x14..0x18 — a classic off-by-one loop count) MUST be caught,
 *      both by the captured sweep and by the deterministic CLEAN-ring arm. A gate a
 *      real corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0965.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0965 as oracle } from "../../translated/loc_0965.js";
import { enqueueTaskBatch } from "../enqueueTaskBatch.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0965;
const TASK_TAIL = 0x60b0;
const RING_LO = 0x60c0, RING_HI = 0x60ff; // 32 slots x 2 bytes
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch (the tolerated push residue).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry state through the oracle and a candidate on independent clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x0965 in a real attract run and clone the machine at up to K true dispatches.
 * It fires once per attract cycle (the title-screen composer), so a long run is needed
 * to collect several; the wrapper delegates to the oracle so the host run proceeds.
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

// Poke a whole ring state (fill + tail) IDENTICALLY on a real entry — a surgical
// crafted nudge (docs/decompiler-pipeline), not a fabrication.
const fillRing = (m, byte) => { for (let s = RING_LO; s <= RING_HI; s++) m.mem.write8(s, byte); };
const CLEAN = (m) => { fillRing(m, 0xff); m.mem.write8(TASK_TAIL, 0xc0); }; // all free, base
const FULL  = (m) => { fillRing(m, 0x00); m.mem.write8(TASK_TAIL, 0xc0); }; // all occupied
const WRAP  = (m) => { fillRing(m, 0xff); m.mem.write8(TASK_TAIL, 0xf8); }; // near the end

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): enqueueTaskBatch == oracle on every real attract dispatch (diff confined to stack)", () => {
  const caps = captureDispatches(64, 9000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0965 dispatch during attract");

  for (const entry of caps) {
    // The oracle's push traffic must land in dead stack scratch, so excluding
    // STACK_SCRATCH cannot mask a real diff — the entry SP sits inside the region.
    assert.ok(
      entry.regs.sp > STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `entry SP must sit inside STACK_SCRATCH so oracle pushes stay in-region (SP=${hx(entry.regs.sp)})`,
    );

    const { bad } = replay(entry, enqueueTaskBatch);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on tail=${hx(entry.mem.read8(TASK_TAIL))}`,
    );

    // enqueueTaskBatch must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    enqueueTaskBatch(b);
    assert.equal(b.regs.sp, sp0, "enqueueTaskBatch must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "enqueueTaskBatch must leave pc unchanged (no ret modelling)");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): CLEAN / FULL / WRAP ring arms match the oracle, exact payload pinned", () => {
  const caps = captureDispatches(1, 3000);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  for (const [label, craft] of [["CLEAN", CLEAN], ["FULL", FULL], ["WRAP", WRAP]]) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    craft(a); craft(b);
    oracle(a);
    enqueueTaskBatch(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(`  EQUAL/crafted ${label}: tail 0x60b0 -> ${hx(a.mem.read8(TASK_TAIL))}, game-visible RAM identical`);
  }

  // Positive content check: on a clean ring the batch lays down exactly this payload,
  // and advances the tail by 7 messages x 2 bytes = 14 (0xC0 -> 0xCE).
  const want = [0x04, 0x00, 0x03, 0x14, 0x03, 0x15, 0x03, 0x16, 0x03, 0x17, 0x03, 0x18, 0x03, 0x19];
  const b = entry.clone();
  CLEAN(b);
  enqueueTaskBatch(b);
  const got = want.map((_, i) => b.mem.read8(RING_LO + i));
  assert.deepEqual(got, want, `clean-ring payload mismatch: got ${got.map(hx).join(" ")}`);
  assert.equal(b.mem.read8(TASK_TAIL), 0xce, "tail must advance 0xC0 -> 0xCE (7 messages)");
  console.log(`  EQUAL/crafted payload: ${got.map((v) => v.toString(16).padStart(2, "0")).join(" ")}, tail -> 0xce`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: posts only FIVE of the six 0x03 messages (args 0x14..0x18) — a classic
 * off-by-one loop count. It writes one fewer ring slot and advances the tail two
 * short, so it diverges wherever the ring had a free slot.
 */
function brokenEnqueueTaskBatch(m) {
  const { regs } = m;
  regs.d = 0x04; regs.e = 0x00;
  postOne(m);
  regs.d = 0x03;
  for (let arg = 0x14; arg <= 0x18; arg++) { regs.e = arg; postOne(m); } // BUG: stops at 0x18
}
// Local one-message post equivalent to enqueueTask, so the twin differs ONLY in count.
function postOne(m) {
  const { regs, mem } = m;
  const tail = mem.read8(TASK_TAIL);
  const slot = 0x6000 | tail;
  if ((mem.read8(slot) & 0x80) === 0) return;
  mem.write8(slot, regs.d);
  mem.write8(0x6000 | ((tail + 1) & 0xff), regs.e);
  let next = (tail + 2) & 0xff;
  if (next < 0xc0) next = 0xc0;
  mem.write8(TASK_TAIL, next);
}

test("TEETH: the five-of-six off-by-one twin is CAUGHT (captured + deterministic clean ring)", () => {
  const caps = captureDispatches(64, 9000);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  // Captured sweep (free-ring dispatches diverge; report the first catch).
  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenEnqueueTaskBatch);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a short batch — it is worthless");

  // Deterministic clean-ring catch, independent of whatever ring state attract minted.
  const a = caps[0].clone(), b = caps[0].clone();
  const aFloor = a.regs.sp;
  CLEAN(a); CLEAN(b);
  oracle(a);
  brokenEnqueueTaskBatch(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "clean-ring sweep FAILED to catch the short batch");
  console.log(`  TEETH: caught at ${hx(caught.addr)} (captured) and ${hx(bad.addr)} (clean ring)`);
});
