// SPDX-License-Identifier: GPL-3.0-only
/**
 * sendOneQueuedSoundThenReopenFrameInterrupt — memory-equivalent to the frozen oracle at ROM 0x0174, the
 * close of the vertical-blank service, in its DISSOLVED form (see _vblankService.js for the contract every
 * gate in this family shares: memory outside the oracle's measured dead stack scratch, every device, SP
 * unmoved).
 *
 * ★ NOT AN ORDINARY CALL TARGET. Nothing in the image executes `call 0x0174`: the service pushes 0x0174
 *   as the return slot of the phase arm it dispatches, the arm's `ret` lands here, and this entry then
 *   unstacks the ten register words the service laid down and returns through the resume word the
 *   interrupt pushed — SP +22 in all. The dissolved service calls this close directly after its switch,
 *   so the rewrite keeps only what the machine can see: one queued sound byte sent, and the interrupt
 *   gate reopened from the image byte at 0x1600. It unstacks nothing and returns through nothing.
 *
 * ★ THE CORPUS NEVER DRAINS. Measured: the sound queue's count cell is zero at every real dispatch under
 *   both tapes, so QUEUE crafts counts to cover the send and the slide, and shows the oracle's sound latch
 *   really moves on them.
 *
 * What it exercises, holes stated:
 *   1. CORPUS — every captured dispatch of both tapes.
 *   2. QUEUE — the blind spot asserted, then crafted counts swept over the send and the slide.
 *   3. GATE — the interrupt gate ends open from either starting state, with a skipped-write control.
 *   4. SP — the oracle nets +22 on every entry; the rewrite 0, and a twin that pops is caught.
 *   5. WINDOW / BOUNDARY — the oracle's own push depth measured, floor above the data; a byte below is
 *      caught, one at the seat is caught, one inside is masked.
 *   6. REGISTERS — not compared (not live-out of the dissolved interrupt); the divergent set is shown.
 *   7. TEETH — six twins, each caught on the corpus, the queue crafts or the gate crafts.
 *
 * HOLE: the drain itself is gated by its own file; this gate asserts only that the close sends what the
 * oracle sends and reopens the gate as the oracle does.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0174.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent } from "./_harness.js";
import {
  captureAt, dissolvedDiff, runOracle, oracleDepth, TAPES, hex4, DATA_TOP,
} from "./_vblankService.js";
import { sendOneQueuedSoundThenReopenFrameInterrupt } from "../sendOneQueuedSoundThenReopenFrameInterrupt.js";
import { sendOldestQueuedSoundCommand } from "../sendOldestQueuedSoundCommand.js";
import { loc_0174 as oracle } from "../../translated/loc_0174.js";
import { NMI_ENABLE_LATCH, NMI_REENABLE_BYTE, SOUND_QUEUE_COUNT, SOUND_QUEUE_HEAD } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x0174;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

/** The interrupt frame the oracle unwinds: ten register words and the pushed resume address. */
const FRAME_BYTES = 22;
/** LS259 bit 0 — the interrupt gate. */
const ENABLE_BIT = 0;
const CRAFTED_COUNTS = [0, 1, 2, 3, 8, 64, 255];
const CORPUS_ENTRIES = 120;

const corpusOf = (label, opts) => captureAt(TARGET, label, opts, { limit: CORPUS_ENTRIES });
const corpus = () => TAPES.flatMap(([label, opts]) => corpusOf(label, opts));
const diff = (cand, e) => dissolvedDiff(oracle, cand, e);

function queueCrafts() {
  const base = corpusOf("coin-start", {})[0];
  return CRAFTED_COUNTS.map((count) => {
    const e = base.clone();
    e.mem8[SOUND_QUEUE_COUNT] = count;
    for (let i = 0; i < Math.min(count, 16); i++) e.mem8[SOUND_QUEUE_HEAD + i] = (0x11 * (i + 1)) & 0xff;
    return [count, e];
  });
}

function gateCrafts() {
  const base = corpusOf("coin-start", {})[0];
  return [0, 1].map((bit) => {
    const e = base.clone();
    e.mem8[NMI_ENABLE_LATCH] = bit;
    return [bit, e];
  });
}

// ── twins ────────────────────────────────────────────────────────────────────────────────

const TWINS = [
  ["no-op", () => {}, "corpus"],
  ["no-send", (m) => { m.mem8[NMI_ENABLE_LATCH] = m.mem8[NMI_REENABLE_BYTE]; }, "queue"],
  ["sends-twice", (m) => { sendOldestQueuedSoundCommand(m); sendOneQueuedSoundThenReopenFrameInterrupt(m); }, "queue"],
  ["gate-closed", (m) => { sendOldestQueuedSoundCommand(m); m.mem8[NMI_ENABLE_LATCH] = 0; }, "corpus"],
  ["gate-unwritten", (m) => { sendOldestQueuedSoundCommand(m); }, "gate"],
  ["pops-a-slot", (m) => { sendOneQueuedSoundThenReopenFrameInterrupt(m); m.pop16(); }, "corpus"],
];

// ── the gate ─────────────────────────────────────────────────────────────────────────────

test("CORPUS: every captured dispatch of both tapes agrees outside the dead stack window", { skip }, () => {
  for (const [label, opts] of TAPES) {
    const entries = corpusOf(label, opts);
    assert.ok(entries.length > 0, `vacuous: the ${label} tape never reached the close`);
    for (const e of entries) {
      const d = diff(sendOneQueuedSoundThenReopenFrameInterrupt, e);
      assert.equal(d, null, `${label}: ${d}`);
    }
  }
  console.log(`  CORPUS: ${corpus().length} dispatches identical over ${TAPES.length} tapes`);
});

test("QUEUE: the corpus never drains, so crafted counts carry the send and the slide", { skip }, () => {
  const draining = corpus().filter((e) => e.mem8[SOUND_QUEUE_COUNT] !== 0).length;
  assert.equal(draining, 0, "the corpus now reaches a nonzero queue; this arm's premise moved");
  const sent = new Set();
  for (const [count, e] of queueCrafts()) {
    const d = diff(sendOneQueuedSoundThenReopenFrameInterrupt, e);
    assert.equal(d, null, `count ${count}: ${d}`);
    sent.add(runOracle(oracle, e).m.io.soundData);
  }
  assert.ok(sent.size > 1, "the crafted counts never move the oracle's sound latch, so they test nothing");
  console.log(`  QUEUE: corpus count always 0; ${CRAFTED_COUNTS.length} crafted counts agree; sound latch took ${sent.size} values`);
});

test("GATE: the interrupt gate ends open from either starting state", { skip }, () => {
  for (const [bit, e] of gateCrafts()) {
    assert.equal(e.io.latch[ENABLE_BIT], bit, `the craft did not seat the gate at ${bit}`);
    const d = diff(sendOneQueuedSoundThenReopenFrameInterrupt, e);
    assert.equal(d, null, `from ${bit}: ${d}`);
    const r = e.clone();
    sendOneQueuedSoundThenReopenFrameInterrupt(r);
    assert.equal(r.io.latch[ENABLE_BIT], 1, `from ${bit} the gate did not end open`);
  }
  console.log("  GATE: open at the end from 0 and from 1, as the oracle leaves it");
});

test("SP: the oracle unwinds the 22-byte interrupt frame; the rewrite moves SP not at all", { skip }, () => {
  for (const e of corpus()) {
    const o = runOracle(oracle, e);
    assert.equal((o.m.regs.sp - e.regs.sp) & 0xffff, FRAME_BYTES, "the oracle did not unwind exactly the frame");
    const r = e.clone();
    sendOneQueuedSoundThenReopenFrameInterrupt(r);
    assert.equal(r.regs.sp, e.regs.sp, "the rewrite moved SP");
  }
  console.log(`  SP: oracle +${FRAME_BYTES} on all ${corpus().length} dispatches; rewrite 0`);
});

test("WINDOW / BOUNDARY: the oracle's push depth measured, floor above the data, edges exact", { skip }, () => {
  const all = [...corpus(), ...queueCrafts().map(([, e]) => e)];
  const depths = all.map((e) => oracleDepth(oracle, e));
  for (const e of all) assert.ok(e.regs.sp - Math.max(...depths) > DATA_TOP, "the window floor reaches game data");
  const [, base] = queueCrafts().find(([c]) => c === 2);
  const depth = oracleDepth(oracle, base);
  assert.ok(depth > 0, "the oracle pushed nothing on a draining entry, so the window is not exercised");
  const scribble = (offset) => (m) => {
    sendOneQueuedSoundThenReopenFrameInterrupt(m);
    const at = (base.regs.sp + offset) & 0xffff;
    m.mem8[at] = (m.mem8[at] + 1) & 0xff;
  };
  assert.notEqual(diff(scribble(-depth - 1), base), null, "a byte below the window was swallowed");
  assert.notEqual(diff(scribble(0), base), null, "a byte at the entry seat was swallowed");
  assert.equal(diff(scribble(-1), base), null, "a byte inside the window was caught");
  console.log(`  WINDOW: depth ${Math.min(...depths)}..${Math.max(...depths)} bytes; BOUNDARY exact on a draining entry`);
});

test("REGISTERS: not live-out of the dissolved interrupt; the divergent set is measured and shown", { skip }, () => {
  const moved = new Set();
  for (const e of corpus()) {
    const a = runOracle(oracle, e).m;
    const b = e.clone();
    sendOneQueuedSoundThenReopenFrameInterrupt(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  REGISTERS (measured, not compared): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ") || "none"}`);
});

for (const [label, twin, where] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const pool = where === "corpus" ? corpus()
      : where === "queue" ? queueCrafts().map(([, e]) => e)
        : gateCrafts().map(([, e]) => e);
    const caught = pool.filter((e) => diff(twin, e) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught}/${pool.length} (${where})`);
    assert.ok(caught > 0, `every ${where} entry PASSED the ${label} twin`);
  });
}
