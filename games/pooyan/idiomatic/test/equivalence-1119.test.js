// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawStackedBcdDigits (ROM 0x1119-0x1130, Pooyan) — draw a
 * packed-BCD byte A as two digit tiles at HL: the tens nibble at the cursor (blank tile 0x10
 * when it is a leading zero), then one tilemap row UP (HL += 0xffe0) the units nibble.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM, so
 * each case runs the oracle on one FRESH clone and drawStackedBcdDigits on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the declared return value  +  the live-out registers.
 *
 * pc/SP are NOT compared (oracle m.step/m.ret drive the dropped call/stack ABI; neither is in
 * dumpState). The return { next, byte } is checked against the oracle's exit HL and E; the
 * return-assignment bridge ALSO sets HL, E, and BC on m.regs, and each is asserted equal to the
 * oracle clone's exit register — the SIDE EFFECT the frozen caller advanceIntroPhaseAndDrawHitTally reads back (add hl,bc
 * twice off BC == 0xffe0, ld a,e off E, HL as the running cursor). A return-value-only check would
 * pass a rewrite that returns the right value but never SETS the register.
 *
 * ABI NOTE (for the lead): BC == 0xffe0 is genuinely consumed (advanceIntroPhaseAndDrawHitTally's two add hl,bc), so the
 * bridge SETS it — a real live-out, not dead plumbing. adjustCounterAndPaintBcdHudFields's three call sites read no 0x1119
 * register live-out (each reloads HL/A first, and queueSoundCommand13 does ld a,0x13 immediately). A and the
 * flags are NOT restored by the bridge: no caller tail reads either after the call.
 *
 * Jobs:
 *   1. EQUAL + RETURN + LIVE-OUT (crafted, both branches) — nonzero and zero tens nibbles leave
 *      identical RAM(−stack), drawStackedBcdDigits's {next,byte} matches the oracle's HL/E, and the
 *      module clone's HL/E/BC registers match the oracle clone's (the bridge side effect).
 *   2. CAPTURED (best-effort) — replay any real 0x1119 dispatch a boot happens to reach.
 *   3. WRITE-SET — the oracle's RAM writes land only at dst and dst-0x20 (one row up).
 *   4. TEETH — a twin that writes a WRONG tile at dst MUST be caught, at dst.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1119.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1119 as oracle } from "../../translated/loc_1119.js";
import { drawStackedBcdDigits } from "../drawStackedBcdDigits.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x1119;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

// Crafted pointer: the round/stage counter base advanceIntroPhaseAndDrawHitTally draws through (video RAM). One row up
// is dst - 0x20, also video RAM. Both are inside dumpState so the writes are observed.
const DST = 0x8634;
const ROW_UP = (DST + 0xffe0) & 0xffff; // 0x8614

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A crafted entry machine: hl->cursor, a=byte, sp parked in dead scratch. */
function craft(byte) {
  const base = new Machine(ROM);
  base.regs.hl = DST;
  base.regs.a = byte & 0xff;
  base.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the ret only pops (reads) the word at SP
  return base;
}

/** Best-effort: hook 0x1119 in a real boot and clone at up to K true dispatches. */
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

// Both branches: nonzero tens (drawn as a digit) and zero tens (blank tile 0x10), plus edges.
const CASES = [0x37, 0x05, 0x00, 0x90, 0xff];

// -- 1. EQUAL + RETURN (crafted) ----------------------------------------------

test("EQUAL+RETURN: crafted bytes — RAM(−stack) identical and {next,byte} match the oracle's HL/E", () => {
  for (const byte of CASES) {
    const base = craft(byte);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    const ret = drawStackedBcdDigits(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (byte ${hx(byte)}): oracle=${d.a} mine=${d.b}`);
    assert.equal(ret.next, o.regs.hl, `advanced cursor mismatch for byte ${hx(byte)}`);
    assert.equal(ret.byte, o.regs.e, `echoed byte (E) mismatch for byte ${hx(byte)}`);

    // LIVE-OUT side effect: the bridge must SET the registers advanceIntroPhaseAndDrawHitTally reads out (not just return them).
    assert.equal(c.regs.hl, o.regs.hl, `module must SET HL for the frozen dispatch (byte ${hx(byte)})`);
    assert.equal(c.regs.e, o.regs.e, `module must SET E (source byte) for advanceIntroPhaseAndDrawHitTally's ld a,e (byte ${hx(byte)})`);
    assert.equal(c.regs.bc, o.regs.bc, `module must SET BC (0xffe0 stride) for advanceIntroPhaseAndDrawHitTally's add hl,bc (byte ${hx(byte)})`);

    // Spot-check the actual tiles: tens at dst (blank 0x10 when zero), units one row up.
    const tens = (byte >> 4) & 0x0f;
    assert.equal(c.mem.read8(DST), tens === 0 ? 0x10 : tens, `tens tile wrong for byte ${hx(byte)}`);
    assert.equal(c.mem.read8(ROW_UP), byte & 0x0f, `units tile wrong for byte ${hx(byte)}`);
  }
  console.log(`  EQUAL+RETURN: ${CASES.length} crafted bytes identical (RAM −stack) + return match`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real 0x1119 dispatches replay identically (if reached)", () => {
  const caps = captureDispatches(24, 2400);
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = drawStackedBcdDigits(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
    assert.equal(ret.next, o.regs.hl, "captured advanced cursor mismatch");
    assert.equal(ret.byte, o.regs.e, "captured echoed byte mismatch");
    // LIVE-OUT side effect on the captured dispatches too.
    assert.equal(c.regs.hl, o.regs.hl, "captured: module must SET HL");
    assert.equal(c.regs.e, o.regs.e, "captured: module must SET E");
    assert.equal(c.regs.bc, o.regs.bc, "captured: module must SET BC (0xffe0 stride)");
  }
  console.log(`  CAPTURED: ${caps.length} real 0x1119 dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's RAM writes land only at dst and dst-0x20", () => {
  const base = craft(0x37); // both nibbles nonzero -> both writes are observable changes
  const before = base.clone();
  const after = base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  for (const ch of changed) {
    assert.ok(ch.addr === DST || ch.addr === ROW_UP, `unexpected write at ${hx(ch.addr)}`);
  }
  assert.equal(after.mem.read8(DST), 0x03, "tens tile of 0x37 must be 3");
  assert.equal(after.mem.read8(ROW_UP), 0x07, "units tile of 0x37 must be 7");
  assert.equal(changed.length, 2, `expected exactly the two digit writes, got ${changed.length}`);
  console.log(`  WRITE-SET: 2 writes, ${hx(DST)} := 3 and ${hx(ROW_UP)} := 7`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong tens tile at dst is caught", () => {
  const base = craft(0x37);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  drawStackedBcdDigits(c);
  c.mem.write8(DST, 0xaa); // BUG: wrong tens tile

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tile store — it is worthless");
  assert.equal(d.addr, DST, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong dst store caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
