// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorAnimFrame (ROM 0x403c) — "step one actor's animation
 * sequence for the record at IY". +0x0e is a frame-hold counter: while non-zero it decrements and
 * returns; on expiry it walks the stream at +0x0c:+0x0d — a 0xff opcode reloads that pointer from
 * the next two bytes and re-reads; any other byte begins a 3-byte frame record (byte0 -> +0x10,
 * byte1 -> +0x0f, byte2 -> +0x0e new hold), then the advanced pointer is stored back.
 *
 * CYCLE-FREE / memory-equivalence gate: the routine WRITES RAM, so every case uses a FRESH clone
 * per side. The go-forward contract is RAM only (dumpState minus stack scratch below the entry SP): the routine keeps
 * all its state in the record (the advanced stream pointer is written back to +0x0c:+0x0d), so no
 * register is a live-out.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x403c in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Both branches (hold-decrement + stream-walk) and the 0xff
 *      reload path (once and twice), crafted identically on both sides; RAM must agree, and the
 *      module's stamped record bytes must match the independently-derived expectation.
 *   3. TEETH — a twin that corrupts the new hold byte MUST be caught at rec+0x0e.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-403c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_403c as oracle } from "../../translated/loc_403c.js";
import { advanceActorAnimFrame } from "../advanceActorAnimFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x403c;
const REC = ACTOR_TABLE; // 0x8a80: a sane record base inside the actor arena (work RAM)
const STREAM = 0x8b00;   // primary sequence stream (work RAM, disjoint from REC + stack)
const STREAM2 = 0x8b40;  // first reload target
const STREAM3 = 0x8b80;  // second reload target
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const lo = (a) => a & 0xff;
const hi = (a) => (a >> 8) & 0xff;

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

// -- crafted scenarios --------------------------------------------------------
// Each is fully deterministic, so craft(scn) called twice yields two identical machines. `expect`
// is the module-side record state, derived independently of the oracle.
const SCENARIOS = [
  // Hold non-zero: only +0x0e decrements; the stream is never touched.
  { name: "hold=5", hold: 0x05, ptr: STREAM, stream: [[STREAM, [0x11, 0x22, 0x33]]],
    expect: { 0x0e: 0x04 } },
  { name: "hold=1", hold: 0x01, ptr: STREAM, stream: [[STREAM, [0x11, 0x22, 0x33]]],
    expect: { 0x0e: 0x00 } },
  // Hold zero: a plain frame record loads three fields and advances the pointer by 3.
  { name: "frame", hold: 0x00, ptr: STREAM, stream: [[STREAM, [0x12, 0x34, 0x56, 0x9a]]],
    expect: { 0x10: 0x12, 0x0f: 0x34, 0x0e: 0x56, 0x0c: lo(STREAM + 3), 0x0d: hi(STREAM + 3) } },
  // Hold zero: one 0xff reload, then a frame record from the reloaded stream.
  { name: "reload1", hold: 0x00, ptr: STREAM,
    stream: [[STREAM, [0xff, lo(STREAM2), hi(STREAM2)]], [STREAM2, [0x78, 0x9a, 0xbc, 0xde]]],
    expect: { 0x10: 0x78, 0x0f: 0x9a, 0x0e: 0xbc, 0x0c: lo(STREAM2 + 3), 0x0d: hi(STREAM2 + 3) } },
  // Hold zero: two 0xff reloads in a row (the walk loop iterates twice), then a frame record.
  { name: "reload2", hold: 0x00, ptr: STREAM,
    stream: [[STREAM, [0xff, lo(STREAM2), hi(STREAM2)]],
             [STREAM2, [0xff, lo(STREAM3), hi(STREAM3)]],
             [STREAM3, [0x01, 0x02, 0x03, 0x04]]],
    expect: { 0x10: 0x01, 0x0f: 0x02, 0x0e: 0x03, 0x0c: lo(STREAM3 + 3), 0x0d: hi(STREAM3 + 3) } },
];

/** Build a machine with the record pre-dirtied to 0xAA, the scenario's stream laid down, IY=REC. */
function craft(scn) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10;
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, 0xaa);
  m.mem.write8((REC + 0x0e) & 0xffff, scn.hold);
  m.mem.write8((REC + 0x0c) & 0xffff, lo(scn.ptr));
  m.mem.write8((REC + 0x0d) & 0xffff, hi(scn.ptr));
  for (const [addr, bytes] of scn.stream) {
    for (let i = 0; i < bytes.length; i++) m.mem.write8((addr + i) & 0xffff, bytes[i]);
  }
  m.regs.iy = REC;
  return m;
}

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x403c dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    advanceActorAnimFrame(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: both branches + 0xff reload — RAM identical, record bytes as derived", () => {
  for (const scn of SCENARIOS) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    advanceActorAnimFrame(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    for (const [off, val] of Object.entries(scn.expect)) {
      const addr = (REC + Number(off)) & 0xffff;
      assert.equal(c.mem.read8(addr), val, `${scn.name}: rec+${hx(Number(off))} => ${hx(val)}`);
    }
  }
  console.log(`  CRAFTED: ${SCENARIOS.length} scenarios stepped identically`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts the new-hold byte — must be caught at rec+0x0e (written in every branch). */
function brokenAdvance(m) {
  advanceActorAnimFrame(m);
  const bad = (REC + 0x0e) & 0xffff;
  m.mem.write8(bad, (m.mem.read8(bad) ^ 0x01) & 0xff); // BUG: wrong hold byte
}

test("TEETH: a wrong hold byte is CAUGHT at rec+0x0e", () => {
  let caught = null;
  for (const scn of SCENARIOS) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    brokenAdvance(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong hold byte — it is worthless");
  assert.equal(caught.addr, (REC + 0x0e) & 0xffff, `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong hold byte caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
