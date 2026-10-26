// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for requestSound7 (ROM 0x4c6b) — the sound-trigger stub
 * that requests command 7 by delegating to the shared sound-ring enqueue.
 *
 * The stub's distinctive job is a single number: it queues command index 7, which the
 * shared enqueue marks pending (high bit) and stores into the ring slot at SOUND_HEAD
 * before advancing that pointer (wrapping after the eighth slot). Its declared live-out
 * is MEMORY-ONLY — the filled ring slot and advanced pointer — so the gate compares
 * RAM + pc + SP, NOT the value registers (the honest-signature contract). No caller
 * reads the command byte or flags the oracle path leaves in registers.
 *
 * WRINKLE 1 (unreached arm): command 7 is NEVER requested during attract, so 0x4c6b is
 * never dispatched in a boot run — the target-hooking harness cannot capture it. That is
 * the doc-sanctioned "unreached arm" case: capture a REAL machine state at a proxy leaf
 * that IS reached (0x3dae, the (row,col)->tilemap-offset calc, entered early in attract
 * and never a caller of 0x4c6b, so its capture hook cannot re-enter this stub), then run
 * the stub on that real state with the ring write pointer swept across all eight slots —
 * a surgical, identical-both-sides nudge that exercises every ring slot and the wrap.
 *
 * WRINKLE 2 (dead stack scratch): the oracle path saves and restores two register pairs
 * on the stack, and The Pit's stack is real diffed work RAM (0x83ff downward). Those
 * pushes leave four dead bytes just below the entry stack pointer that the stack-free
 * idiomatic JS (delegating to the decompiled enqueue) never reproduces — classic dead
 * stack scratch, overwritten by the caller's own next push before anything reads them —
 * so the RAM diff excludes exactly that [SP-4, SP) window and compares everything else.
 * The oracle path rets internally (its enqueue tail unwinds to this stub's caller); the
 * candidate models that return with one m.ret() so pc + SP line up.
 *
 * Checks:
 *   1. EQUAL (real states, all ring slots) — over several captured proxy entries and
 *      every ring write pointer 0..7, oracle and requestSound7 leave identical RAM
 *      (outside the stack scratch) + pc + SP, and the slot ends up holding 0x87
 *      (7 | pending bit) with the pointer advanced/wrapped.
 *   2. POSITIVE (the enqueue really happened) — with SOUND_HEAD pinned to slots 0/3/7,
 *      requestSound7 writes 0x87 into exactly that ring slot and advances the pointer,
 *      wrapping after the eighth. Proves the gate tests a real effect, not a no-op.
 *   3. TEETH — a twin that requests the WRONG command (6, a real neighbour's payload)
 *      MUST be caught at the ring slot (0x86 instead of 0x87). An always-EQUAL gate is
 *      worthless.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4c6b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4c6b as oracle } from "../../translated/loc_4c6b.js";
import { loc_3dae as proxyOracle } from "../../translated/loc_3dae.js";
import { requestSound7 } from "../requestSound7.js";
import { enqueueSoundCommand } from "../enqueueSoundCommand.js";
import { makeMachineFactory } from "../../machine.js";
import { SOUND_HEAD, SOUND_RING } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const PROXY = 0x3dae; // a leaf reached early in attract; never a caller of 0x4c6b
const COMMAND = 7; // this stub's fixed sound-command index
const PENDING = (COMMAND | 0x80) & 0xff; // 0x87 — the byte the ring slot must end up holding
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Capture up to K real entry states at the PROXY leaf during a boot/attract run. The
 * wrapper clones on entry, then runs the proxy's own oracle so the host game proceeds
 * normally. Capturing at the proxy (not at 0x4c6b, which never fires) gives real,
 * in-distribution machine states to run the stub on.
 */
function captureEntries(K, maxFrames) {
  const caps = [];
  const snap = new Map([[PROXY, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return proxyOracle(mm);
  }]]);
  const host = makeMachine(snap);
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

/** Broken twin: requests the WRONG command index (6, a real neighbour stub's payload). */
function twinWrongIndex(m) {
  enqueueSoundCommand(m, 6); // BUG: this stub must request 7, not 6
}

// -- 1. EQUAL on real captured states, ring slot swept -----------------------

test("EQUAL (real states, all ring slots): requestSound7 == oracle over RAM+pc+SP", () => {
  const caps = captureEntries(6, 400);
  assert.ok(caps.length >= 1, "expected at least one real proxy dispatch during boot/attract");

  let compared = 0;
  for (const cap of caps) {
    for (let head = 0; head < 8; head++) {
      // Surgical, identical-both-sides nudge: pin the ring write position.
      const seed = cap.clone();
      seed.mem.write8(SOUND_HEAD, head);

      const { diffs } = contractDiffs(seed, requestSound7);
      assert.equal(diffs.length, 0, diffs.join("; ") + ` (head=${head})`);

      // Positive: slot filled with command 7 (pending), pointer advanced/wrapped.
      const c = seed.clone();
      requestSound7(c);
      assert.equal(
        c.mem.read8(SOUND_RING + head),
        PENDING,
        `ring slot ${head} not filled with the pending command 7`,
      );
      assert.equal(
        c.mem.read8(SOUND_HEAD),
        (head + 1) % 8,
        `write pointer did not advance/wrap correctly from ${head}`,
      );
      compared++;
    }
  }
  console.log(
    `  EQUAL: ${caps.length} captured proxy states x 8 ring slots = ${compared} entries, ` +
      `identical over RAM+pc+SP; slot filled with ${hx(PENDING)} (command 7, pending)`,
  );
});

// -- 2. POSITIVE: the enqueue really lands command 7 in the pinned slot -------

test("POSITIVE: command 7 is stored (pending) in the pinned ring slot and the pointer advances/wraps", () => {
  const caps = captureEntries(1, 400);
  assert.ok(caps.length >= 1, "need a captured entry to craft from");

  for (const head of [0, 3, 7]) {
    const seed = caps[0].clone();
    seed.mem.write8(SOUND_HEAD, head);

    const b = seed.clone();
    requestSound7(b);

    assert.equal(
      b.mem.read8(SOUND_RING + head),
      PENDING,
      `ring slot ${head} should hold ${hx(PENDING)} after the request`,
    );
    assert.equal(
      b.mem.read8(SOUND_HEAD),
      (head + 1) % 8,
      `write pointer should advance to ${(head + 1) % 8} (wrapping after the eighth slot)`,
    );
  }
  console.log(`  POSITIVE: command 7 -> ${hx(PENDING)} landed in slots 0/3/7, pointer advanced with wrap`);
});

// -- 3. TEETH: the wrong-index twin is caught --------------------------------

test("TEETH: a twin that requests the wrong command index (6) is CAUGHT at the ring slot", () => {
  const caps = captureEntries(1, 400);
  assert.ok(caps.length >= 1, "need a real capture to seed the teeth check");

  const head = 2;
  const seed = caps[0].clone();
  seed.mem.write8(SOUND_HEAD, head);

  const { diffs, ram } = contractDiffs(seed, twinWrongIndex);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-index twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_RING + head,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_RING + head)})`,
  );
  console.log(`  TEETH: wrong-index twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
