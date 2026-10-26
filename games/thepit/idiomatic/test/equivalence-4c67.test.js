// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for requestSound6 (ROM 0x4c67) — the sound-trigger stub
 * that requests command 6 by delegating to the shared sound-ring enqueue (loc_4ca5).
 *
 * The stub's distinctive job is a single number: it queues command index 6, which
 * the shared enqueue marks pending (high bit) and stores into the ring slot at
 * SOUND_HEAD before advancing that pointer (wrapping after the eighth slot). Its
 * declared live-out is MEMORY-ONLY — the filled ring slot and advanced pointer — so
 * the gate compares RAM + pc + SP, NOT the value registers (the honest-signature
 * contract). No caller reads the command byte or flags the oracle path leaves in
 * registers; the next thing every caller does is reload before it reads.
 *
 * SAME STACK WRINKLE as the enqueue tail: the oracle path saves and restores two
 * register pairs on the stack, and The Pit's stack is real diffed work RAM (0x83ff
 * downward). Those pushes leave four dead bytes just below the entry stack pointer
 * that the stack-free idiomatic JS never reproduces — classic dead stack scratch,
 * overwritten by the caller's own next push before anything reads them — so the RAM
 * diff excludes exactly that [SP-4, SP) window and compares everything else.
 *
 * A timing wrinkle: unlike its boot-time siblings, command 6 is requested only once
 * the attract demo is well underway (a few hundred frames in), so the capture run
 * needs a larger frame budget to reach it — hence maxFrames well above the default.
 *
 * Four checks:
 *   0. IDENTITY (harness) — run the unit gate with both arms = the oracle; EQUAL
 *      proves the capture/clone/replay harness reaches 0x4c67 in a real attract run.
 *   1. EQUAL (real dispatch, full contract) — for the captured entry, oracle vs
 *      requestSound6 leave identical RAM (outside the stack scratch) + pc + SP, and
 *      the ring slot holds 0x86 (6 | pending bit) with the pointer advanced.
 *   2. EQUAL (crafted wrap, pointer==7) — force SOUND_HEAD to 7 on both sides and
 *      confirm both write slot 7 with command 6 and wrap the pointer to 0, identical.
 *   3. TEETH — a twin that requests the WRONG command index (7, the neighbour stub's
 *      payload) MUST be caught at the ring slot (0x87 instead of 0x86).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4c67.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4c67 as oracle } from "../../translated/loc_4c67.js";
import { requestSound6 } from "../requestSound6.js";
import { enqueueSoundCommand } from "../enqueueSoundCommand.js";
import { makeMachineFactory } from "../../machine.js";
import { unitEquivalence, deadStackBelow } from "../../../../core/equivalence.js";
import { SOUND_HEAD, SOUND_RING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x4c67;
const COMMAND = 6; // this stub's fixed sound-command index
const PENDING = (COMMAND | 0x80) & 0xff; // 0x86 — the byte the ring slot must end up holding
// Command 6 is requested only once the attract demo has run for a while; the capture
// run needs enough frames to reach that dispatch.
const CAPTURE_FRAMES = 900;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook 0x4c67 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Attract reaches this stub once, partway through the demo.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return caps;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the four dead stack-scratch
 * bytes the oracle path's two register saves park just below the entry stack pointer
 * (which the stack-free idiomatic JS does not reproduce). Null when otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 4, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Compare a candidate against the oracle over the memory-equivalence contract for one
 * entry: RAM (outside the stack scratch) + pc + SP. Value registers are the declared-
 * dead live-out and excluded. The oracle path rets internally (its enqueue tail unwinds
 * to this stub's caller); the candidate models that return with one m.ret() so pc + SP
 * line up. Returns { diffs, ram } — diffs empty means EQUAL.
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret();

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

/** Broken twin: requests the WRONG command index (7, the neighbour stub's payload). */
function twinWrongIndex(m) {
  enqueueSoundCommand(m, 7); // BUG: this stub must request 6, not 7
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the unit gate runs on The Pit and reports EQUAL when both arms are the oracle", () => {
  const res = unitEquivalence(makeMachine, TARGET, oracle, oracle, { maxFrames: CAPTURE_FRAMES });
  assert.equal(
    res.equal,
    true,
    `gate reported a diff for identical arms: ram=${JSON.stringify(res.ram)} regs=${JSON.stringify(res.regs)}`,
  );
  console.log("  IDENTITY: captured 0x4c67 (an in-demo sound request), cloned, ran oracle vs oracle -> EQUAL");
});

// -- 1. EQUAL (real dispatch, full contract) ---------------------------------

test("EQUAL (real dispatch): requestSound6 == oracle on the captured 0x4c67 entry", () => {
  const caps = captureDispatches(8, CAPTURE_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x4c67 dispatch during attract");

  for (const cap of caps) {
    const preHead = cap.mem.read8(SOUND_HEAD);

    // Full-contract equivalence: RAM (outside the stack scratch) + pc + SP.
    const { diffs } = contractDiffs(cap, requestSound6); // fresh clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));

    // Positive checks: slot filled with command 6 (pending bit set), pointer advanced.
    const c = cap.clone();
    requestSound6(c);
    assert.equal(
      c.mem.read8(SOUND_RING + preHead),
      PENDING,
      `ring slot ${preHead} not filled with the pending command 6 on a real dispatch`,
    );
    assert.equal(
      c.mem.read8(SOUND_HEAD),
      (preHead + 1) % 8,
      `write pointer did not advance/wrap correctly from ${preHead}`,
    );
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatch(es) identical over RAM+pc+SP; ` +
      `slot filled with ${hx(PENDING)} (command 6, pending)`,
  );
});

// -- 2. EQUAL (crafted wrap, pointer==7) --------------------------------------

test("EQUAL (crafted wrap): with SOUND_HEAD forced to 7, both write slot 7 (command 6) and wrap to 0", () => {
  const seed = captureDispatches(1, CAPTURE_FRAMES)[0];
  assert.ok(seed, "need a real capture to craft the wrap entry from");

  const entry = seed.clone();
  entry.mem.write8(SOUND_HEAD, 7); // force the wrap edge

  const { diffs } = contractDiffs(entry, requestSound6);
  assert.equal(diffs.length, 0, diffs.join("; "));

  const c = entry.clone();
  requestSound6(c);
  assert.equal(c.mem.read8(SOUND_HEAD), 0, "the pointer must wrap 7 -> 0");
  assert.equal(c.mem.read8(SOUND_RING + 7), PENDING, "slot 7 must be filled with command 6");
  console.log("  EQUAL/crafted: pointer 7 -> 0 wrap, slot 7 filled with command 6, identical to the oracle");
});

// -- 3. TEETH: the wrong-index twin is caught --------------------------------

test("TEETH: a twin that requests the wrong command index (7) is CAUGHT at the ring slot", () => {
  const cap = captureDispatches(1, CAPTURE_FRAMES)[0];
  assert.ok(cap, "need a real capture to seed the teeth check");
  const slot = cap.mem.read8(SOUND_HEAD);

  const { diffs, ram } = contractDiffs(cap, twinWrongIndex);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-index twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_RING + slot,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_RING + slot)})`,
  );
  console.log(`  TEETH: wrong-index twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
