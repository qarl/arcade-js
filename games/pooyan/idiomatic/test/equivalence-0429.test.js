// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for splitBcdByte (ROM 0x0429-0x0438, Pooyan) — the BCD byte
 * splitter used by the HUD/score renderers: read the byte at (ix), store its low nibble
 * as a tile at (hl), advance HL by DE, and hand the high nibble back (A, with Z-sense =
 * high == 0 for leading-zero suppression).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). splitBcdByte
 * WRITES RAM, so every case runs the oracle on one FRESH clone and splitBcdByte on another,
 * compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the declared return value.
 *
 * pc/SP are deliberately NOT compared: the oracle drives pc through the ROM with m.step and
 * pops a return address with m.ret (SP+2), the modelled call/stack ABI the direct-call
 * idiomatic layer replaces with a plain JS return. Comparing them would test the dropped
 * stack model, not the routine; neither pc nor SP is part of dumpState anyway.
 *
 * splitBcdByte carries the runbook RETURN-ASSIGNMENT BRIDGE: it returns the tuple
 * [A=high, HL=next, Z=high===0] AND sets each on m.regs, because the frozen translated callers
 * (0x03e9, 0x0439) read A (store the high digit), HL (advanced cursor) and Z (jr z leading-zero
 * suppress) straight out of the registers. Each tuple element is checked against the ORACLE's
 * own exit registers (high vs A, next vs HL, high===0 vs Z), and a LIVE-OUT arm additionally
 * asserts the module clone's own regs (A/HL/Z) equal the oracle's — proving the SIDE EFFECT,
 * not just the return value.
 *
 * Jobs:
 *   1. EQUAL + RETURN (crafted, both branches) — nonzero and zero high-nibble bytes leave
 *      identical RAM(−stack), and splitBcdByte's {high,next} + Z-sense match the oracle.
 *   2. CAPTURED (best-effort) — if a plain attract boot dispatches 0x0429 (the score panel
 *      is an attract screen), replay the real captured states too.
 *   3. WRITE-SET — the oracle's ONLY RAM write is the low digit at dst.
 *   4. TEETH — a twin that writes a WRONG digit byte at dst MUST be caught, at dst.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0429.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0429 as oracle } from "../../translated/loc_0429.js";
import { splitBcdByte } from "../splitBcdByte.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x0429;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

// Crafted pointers: a work-RAM source byte (the score table lives at 0x8a00), a video-RAM
// tile cell as the cursor, and the fixed 0x20 inter-digit stride the score renderer uses.
const SRC = 0x8a00;
const DST = 0x8500;
const ADVANCE = 0x0020;

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A crafted entry machine: ix->source byte, hl->cursor, de->stride, sp parked in dead scratch. */
function craft(byte) {
  const base = new Machine(ROM);
  base.regs.ix = SRC;
  base.regs.hl = DST;
  base.regs.de = ADVANCE;
  base.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the ret only pops (reads) the word at SP
  base.mem.write8(SRC, byte & 0xff);
  return base;
}

/** Best-effort: hook 0x0429 in a real attract boot and clone at up to K true dispatches. */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  return caps;
}

// Both branches: nonzero high nibble (Z clear) and zero high nibble (Z set), plus edges.
const CASES = [0x37, 0x05, 0x90, 0x00, 0x9f];

// -- 1. EQUAL + RETURN (crafted) ----------------------------------------------

test("EQUAL+RETURN: crafted BCD bytes — RAM(−stack) identical and {high,next}+Z-sense match the oracle", () => {
  for (const byte of CASES) {
    const base = craft(byte);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    const [high, next, zsense] = splitBcdByte(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (byte ${hx(byte)}): oracle=${d.a} mine=${d.b}`);
    assert.equal(high, o.regs.a, `high digit mismatch for byte ${hx(byte)}`);
    assert.equal(next, o.regs.hl, `advanced cursor mismatch for byte ${hx(byte)}`);
    assert.equal(zsense, o.regs.fZ, `leading-zero Z-sense mismatch for byte ${hx(byte)}`);
    // LIVE-OUT SIDE EFFECT: the bridge must SET the registers/flag the translated callers read
    // out (A=high digit store, HL=advanced cursor, Z=jr z leading-zero suppress). A return-only
    // check would pass a rewrite that returns right but never sets the registers.
    assert.equal(c.regs.a, o.regs.a, `module must SET A (high digit) for the translated store, byte ${hx(byte)}`);
    assert.equal(c.regs.hl, o.regs.hl, `module must SET HL (advanced cursor) for the translated caller, byte ${hx(byte)}`);
    assert.equal(c.regs.fZ, o.regs.fZ, `module must SET Z (leading-zero jr z) for the translated caller, byte ${hx(byte)}`);
  }
  console.log(`  EQUAL+RETURN: ${CASES.length} crafted bytes identical (RAM −stack) + return/Z match`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real 0x0429 dispatches in an attract boot replay identically (if reached)", () => {
  const caps = captureDispatches(24, 2400);
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const [high, next] = splitBcdByte(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
    assert.equal(high, o.regs.a, "captured high digit mismatch");
    assert.equal(next, o.regs.hl, "captured advanced cursor mismatch");
    // LIVE-OUT SIDE EFFECT: bridge sets the registers/flag the translated callers read
    assert.equal(c.regs.a, o.regs.a, "captured: module must SET A for the translated store");
    assert.equal(c.regs.hl, o.regs.hl, "captured: module must SET HL for the translated caller");
    assert.equal(c.regs.fZ, o.regs.fZ, "captured: module must SET Z for the translated caller");
  }
  console.log(`  CAPTURED: ${caps.length} real 0x0429 dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only RAM write is the low digit at dst", () => {
  const base = craft(0x37);
  const before = base.clone();
  const after = base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  assert.equal(changed.length, 1, `expected exactly one changed byte, got ${changed.length}`);
  assert.equal(changed[0].addr, DST, `write landed at ${hx(changed[0].addr)} (expected dst)`);
  assert.equal(changed[0].to, 0x07, `low digit of 0x37 must be 7, got ${changed[0].to}`);
  console.log(`  WRITE-SET: 1 write, ${hx(DST)} := 0x07 (low digit)`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong low-digit byte at dst is caught", () => {
  const base = craft(0x37);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  splitBcdByte(c);
  c.mem.write8(DST, 0xaa); // BUG: wrong digit tile written to the cursor cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong digit store — it is worthless");
  assert.equal(d.addr, DST, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong dst store caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
