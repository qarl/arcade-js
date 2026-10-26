// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blitSpritesViaDma (ROM 0x0141) — the once-per-vblank
 * sprite DMA: program the i8257 from the 9-byte block at (HL) and pulse DRQ so the
 * sprite shadow buffer (0x6900) is blitted into sprite RAM (0x7000).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES RAM (sprite RAM, via the DMA blit), so every
 * captured case uses a FRESH clone per side (never a reused machine): the oracle runs
 * on one clone, blitSpritesViaDma on another, and they are compared on the go-forward
 * contract, which here is:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP).
 *
 * pc AND SP are BOTH excluded, unlike a routine whose oracle leaves them untouched.
 * The sub_0141 oracle models the full Z80 instruction stream and ENDS IN `ret`, so it
 * sets pc <- 0x0080 and pops SP+2; its popped bytes live in the dead STACK_SCRATCH
 * region (excluded), and the pc/SP deltas are exactly the modelled stack-return ABI
 * that the direct-call idiomatic layer replaces with a JS return. blitSpritesViaDma
 * touches neither, so comparing them would test the stack model we deliberately drop,
 * not the routine. The i8257 registers + DRQ latch are write-only board outputs (io
 * side), not in the dump, so they are not compared either — only their VISIBLE effect
 * (the sprite-RAM blit) is.
 *
 * REVIEWER NOTE (cycles): the oracle also charges m.io.dma.cyclesStolen (~3121 t, the
 * bus the DMA steals) via m.tick. The idiomatic layer drops the cycle model, so
 * blitSpritesViaDma does NOT charge it. This is the routine where dropping cycles has
 * its LARGEST single effect — those stolen cycles are the bulk of the NMI's cost and
 * feed SPIN_COUNT / the PRNG — but it is exactly the design docs/decompiler-pipeline endorses (the
 * shipped game runs a real, non-MAME-bit-identical RNG). cyclesStolen is io-side, not
 * RAM, so it is outside this gate regardless.
 *
 * Jobs:
 *   1. EQUAL (captured dispatches) — hook 0x0141 in a real attract run, sampled across
 *      the window so both title and moving-sprite demo frames appear; on each true
 *      dispatch oracle vs blitSpritesViaDma leave identical RAM (−STACK_SCRATCH).
 *   2. WRITE-SET (captured) — the oracle's ONLY dumpState changes are in sprite RAM
 *      0x7000-0x7180; no work-RAM or video-RAM byte moves. Justifies LIVE-OUT = the
 *      sprite-RAM blit and nothing else.
 *   3. CRAFTED (blit overwrites prior contents) — straight-line, no unreached arms, so
 *      the meaningful crafted case is prior sprite-RAM contents: pre-dirty the blit
 *      target to 0xAA identically on both sides and confirm both overwrite it with the
 *      shadow buffer (proves the blit semantics, not mere agreement on equal RAM).
 *   4. TEETH — a twin that PROGRAMS the controller but never pulses DRQ high (the blit
 *      never fires) MUST be caught: guaranteed on a crafted ramp-buffer state, and
 *      also demonstrated on a real captured frame whose blit is non-trivial.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0141.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0141 as oracle } from "../../translated/loc_0141.js";
import { blitSpritesViaDma } from "../blitSpritesViaDma.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_BUFFER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0141;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The blit's destination window: 385 bytes from sprite-RAM base (count 0x4180 -> n-1
// form -> 385 transfers). Last byte = 0x7000 + 384 = 0x7180.
const SPRITE_RAM_BASE = 0x7000;
const BLIT_LEN = 385;
const BLIT_END = SPRITE_RAM_BASE + BLIT_LEN - 1; // 0x7180

/**
 * First RAM difference between two machines on the go-forward contract: the whole
 * state dump minus the stack scratch below the entry SP (dead scratch — neither side writes it
 * here, masked per the contract). Returns {addr,a,b} or null.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  let d = firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off));
  let from = 0;
  while (d && dead(d.addr)) {
    from = d.offset + 1;
    d = firstStateDiff(a.subarray(from), b.subarray(from), (off) => ma.stateOffsetToAddr(off + from));
  }
  return d;
}

/**
 * Hook 0x0141 and clone the machine at up to K dispatches, SAMPLED one in `stride` so
 * the window spans early title frames and the later moving-sprite demo rather than only
 * the first K consecutive frames. The wrapper snapshots the entry state then runs the
 * oracle so the host proceeds undisturbed.
 */
function captureSampled(K, stride, maxFrames) {
  const caps = [];
  let seen = 0;
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K && seen % stride === 0) caps.push(mm.clone());
    seen++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

// Sample across ~2600 frames so the window straddles both the early title (trivial,
// all-zero) blits and the attract 25m demo, whose moving sprites make the blit
// non-trivial from ~frame 522 on.
const CAPS = ROM_PRESENT ? captureSampled(64, 40, 2600) : [];

/** Run the oracle on a clone and return whether it changed any sprite-RAM byte. */
function blitIsNonTrivial(cap) {
  const before = cap.clone();
  const after = cap.clone();
  oracle(after);
  for (let a = SPRITE_RAM_BASE; a <= BLIT_END; a++) {
    if (before.mem.read8(a) !== after.mem.read8(a)) return true;
  }
  return false;
}

// -- 1. EQUAL (captured dispatches) -------------------------------------------

test("EQUAL: real captured dispatches — blitSpritesViaDma == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x0141 dispatch in the run window");

  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    blitSpritesViaDma(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} blit=${d.b}`);
  }
  console.log(`  EQUAL: ${CAPS.length} real dispatches identical (RAM −stack)`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only dumpState changes are sprite RAM 0x7000-0x7180", () => {
  // Pick a capture whose blit actually moves bytes, so the assertion is not vacuous.
  const cap = CAPS.find(blitIsNonTrivial) ?? CAPS[0];
  const nonTrivial = blitIsNonTrivial(cap);

  const before = cap.clone();
  const after = cap.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  for (const ch of changed) {
    assert.ok(
      ch.addr >= SPRITE_RAM_BASE && ch.addr <= BLIT_END,
      `oracle changed a dumpState byte outside the blit window: ${hx(ch.addr)} (${ch.from}->${ch.to})`,
    );
  }
  console.log(
    `  WRITE-SET: ${changed.length} dumpState byte(s) changed, all in 0x7000-0x7180 ` +
      `(non-trivial blit: ${nonTrivial})`,
  );
});

// -- 3. CRAFTED (blit overwrites prior contents) ------------------------------

test("CRAFTED: a pre-dirtied blit target is overwritten with the shadow buffer, identically", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  // Identical surgical nudge on BOTH sides: dirty the whole 385-byte blit target so the
  // blit has something visible to overwrite (proves it copies, vs agreeing on equal RAM).
  for (let a = SPRITE_RAM_BASE; a <= BLIT_END; a++) {
    o.mem.write8(a, 0xaa);
    c.mem.write8(a, 0xaa);
  }
  oracle(o);
  blitSpritesViaDma(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} blit=${d.b}`);

  // ...and blitSpritesViaDma genuinely copied the shadow buffer over the 0xAA dirt:
  // sprite RAM 0x7000.. now equals the source shadow buffer 0x6900.. byte for byte.
  for (let i = 0; i < BLIT_LEN; i++) {
    const src = c.mem.read8(SPRITE_BUFFER + i);
    const dst = c.mem.read8(SPRITE_RAM_BASE + i);
    assert.equal(dst, src, `blit left sprite RAM ${hx(SPRITE_RAM_BASE + i)} = ${dst}, shadow = ${src}`);
  }
  console.log(`  CRAFTED: blit target dirtied to 0xAA -> both overwrite it with the shadow buffer, RAM identical`);
});

// -- 4. TEETH -----------------------------------------------------------------

// Broken twin: programs the i8257 exactly right but NEVER pulses DRQ high, so the blit
// never fires and sprite RAM is left stale. A plausible "forgot to kick the DMA" bug
// that agrees with the oracle whenever the shadow buffer happens to already match sprite
// RAM, so only a state where the blit is non-trivial catches it.
const DMA_DRQ = 0x7d85;
const TEETH_PORTS = [0x7808, 0x7800, 0x7800, 0x7801, 0x7801, 0x7802, 0x7802, 0x7803, 0x7803];
function brokenBlitSpritesViaDma(m) {
  const { regs, mem } = m;
  mem.write8(DMA_DRQ, 0);
  let block = regs.hl;
  for (const port of TEETH_PORTS) {
    mem.write8(port, mem.read8(block));
    block = (block + 1) & 0xffff;
  }
  // BUG: the DRQ rising edge (mem.write8(DMA_DRQ, 1)) is missing — the blit never runs.
  mem.write8(DMA_DRQ, 0);
}

test("TEETH: a twin that never pulses DRQ high (no blit) is CAUGHT", () => {
  // Guaranteed catch: a crafted non-constant ramp shadow buffer + a dirtied target, so
  // the oracle blits the ramp while the twin leaves the dirt.
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  for (let i = 0; i < BLIT_LEN; i++) {
    const ramp = (i * 7 + 1) & 0xff; // non-constant, and != 0xAA at i=0
    o.mem.write8(SPRITE_BUFFER + i, ramp);
    c.mem.write8(SPRITE_BUFFER + i, ramp);
    o.mem.write8(SPRITE_RAM_BASE + i, 0xaa);
    c.mem.write8(SPRITE_RAM_BASE + i, 0xaa);
  }
  oracle(o);
  brokenBlitSpritesViaDma(c);
  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a missing DRQ pulse (no blit) — it is worthless");
  assert.ok(
    d.addr >= SPRITE_RAM_BASE && d.addr <= BLIT_END,
    `teeth caught a diff outside the blit window: ${hx(d.addr ?? 0)}`,
  );

  // And on a real captured frame whose blit is non-trivial (if the window produced one).
  const realCap = CAPS.find(blitIsNonTrivial);
  let caughtReal = null;
  if (realCap) {
    const ro = realCap.clone();
    const rc = realCap.clone();
    oracle(ro);
    brokenBlitSpritesViaDma(rc);
    caughtReal = ramDiffMinusStack(ro, rc, realCap.regs.sp);
    assert.notEqual(caughtReal, null, "the gate FAILED to catch the missing blit on a real non-trivial frame");
  }

  console.log(
    `  TEETH: missing DRQ pulse caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})` +
      (caughtReal ? `; also on a real frame at ${hx(caughtReal.addr)}` : "; (no non-trivial captured frame in window)"),
  );
});
