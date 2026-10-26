// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for serviceVblankNmi (ROM 0x0066) — the vblank NMI handler:
 * ack the interrupt, kick the watchdog / reject SERVICE, DMA-blit the sprites, read the
 * controls when a game is in play, then run the per-frame work (perFrame).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. serviceVblankNmi WRITES RAM everywhere (frame counter, RNG, sound
 * and task rings, the input latch, and whatever the GAME_STATE handler dispatches), so
 * every case uses a FRESH clone per side. The contract compared here is the DISSOLVED form:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP)  +  io latches  +  the idiomatic side's SP unmoved from entry.
 *
 * The idiomatic engine fires this handler as a DIRECT JS call (machine.js fireNmi, idiomaticNmi):
 * no PC push, no register save, no `retn`. The oracle's stack traffic (the pushed PC, the 12-byte
 * register frame, the epilogue pops) all lands in the excluded STACK_SCRATCH region, so no diffed
 * cell depends on it; its SP/pc are the interrupt ABI the direct call drops and are not compared.
 * What IS asserted is the stronger invariant the direct call needs: the handler never touches SP.
 *
 * CAPTURE — 0x0066 is NOT reached through the m.call registry (fireNmi calls entry_0066
 * DIRECTLY), so it cannot be hooked via the override map like other routines. Instead we
 * wrap the host machine's fireNmi to MIRROR its prologue exactly (push the return PC,
 * charge the 11-t accept cost) and clone at that instant — the precise state entry_0066
 * is entered with — then run the oracle so the host attract run proceeds undisturbed.
 *
 * Jobs:
 *   1. EQUAL (captured NMI entries) — sample ~64 real NMI entries across a 2600-frame
 *      attract run (title frames, GAME_STATE 0 and 1, and demo frames with moving
 *      sprites so the blit is non-trivial); on each, oracle vs serviceVblankNmi leave
 *      identical RAM(−stack) and io latches, and serviceVblankNmi leaves SP where it found it.
 *   2. CRAFTED (game-in-play arm) — attract keeps ATTRACT (0x6007) != 0, so the
 *      controls-read arm is never taken naturally. Poke ATTRACT = 0, hold an input on
 *      IN0 and seat a sentinel at the input latch, identically on both sides; confirm
 *      the oracle overwrote the sentinel and both sides match.
 *   3. TEETH A (the ATTRACT gate) — a twin that INVERTS the gate (reads input during
 *      attract) MUST be caught. On a capture where the oracle leaves the input-latch
 *      sentinel untouched, the inverted twin overwrites it — caught at 0x6010.
 *   4. TEETH B (SP-inert) — a twin that keeps the interrupt return (pops a return
 *      PC) MUST be caught by the SP check, with RAM still equal.
 *   5. TEETH C (the controls read) — a twin that never reads the controls MUST be
 *      caught on the crafted in-play entry, at the input latch 0x6010.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0066.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0066 as oracleNmi } from "../../translated/loc_0066.js";
import { serviceVblankNmi } from "../serviceVblankNmi.js";
import { blitSpritesViaDma } from "../blitSpritesViaDma.js";
import { readControls } from "../readControls.js";
import { perFrame } from "../perFrame.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, ATTRACT, IN0_PORT } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Board I/O + the input latch, for the teeth twins (mirrors the routine's own consts).
const NMI_ENABLE = 0x7d84;
const IN2_WATCHDOG = 0x7d00;
const DMA_SETUP_BLOCK = 0x0138;
const P1_INPUT = 0x6010; // the byte loc_0087 writes; low byte ∈ {0x00-0x0f, 0x80-0x8f}
const SENTINEL = 0x5a; // a value loc_0087 can NEVER leave at 0x6010 -> unambiguous "it ran"

// The board-output latches (the NMI enable, flip, banks, sound) live in io, not in the RAM dump.
const IO_FIELDS = ["nmiMask", "flipScreen", "spriteBank", "paletteBank", "audioIrq", "soundLatch3d"];
function ioDiff(ma, mb) {
  for (const k of IO_FIELDS) {
    if (ma.io[k] !== mb.io[k]) return { kind: "io", field: k, a: ma.io[k], b: mb.io[k] };
  }
  for (let i = 0; i < 8; i++) {
    if (ma.io.latch6h[i] !== mb.io.latch6h[i]) return { kind: "io", field: `latch6h[${i}]`, a: ma.io.latch6h[i], b: mb.io.latch6h[i] };
  }
  return null;
}

/**
 * First divergence on the dissolved contract, or null: RAM (dumpState, minus the dead
 * STACK_SCRATCH region), then the io latches, then the idiomatic side's SP against its
 * entry value `sp0`. One masked forward scan: the oracle leaves many dead-stack diffs (the
 * pushed PC and the 12-byte register-save frame it writes and the idiomatic side does not).
 */
function contractDiff(ma, mb, sp0, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  const n = Math.min(a.length, b.length);
  for (let off = 0; off < n; off++) {
    if (a[off] === b[off]) continue;
    const addr = ma.stateOffsetToAddr(off);
    if (dead(addr)) continue;
    return { kind: "ram", addr, a: a[off], b: b[off] };
  }
  const io = ioDiff(ma, mb);
  if (io) return io;
  if (mb.regs.sp !== sp0) return { kind: "sp", a: sp0, b: mb.regs.sp };
  return null;
}

/** One line for a contract diff. */
function describe(d) {
  if (d.kind === "ram") return `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`;
  if (d.kind === "io") return `io.${d.field} diff: oracle=${d.a} idiomatic=${d.b}`;
  return `SP moved: entry=${hx(d.a)} idiomatic=${hx(d.b)}`;
}

/**
 * Capture up to K real NMI entry states, sampled one in `stride`, over a `maxFrames`
 * attract run. 0x0066 is not in the m.call registry (fireNmi calls entry_0066 directly),
 * so we wrap fireNmi and MIRROR its prologue (push PC, +11 t) to clone the exact state
 * entry_0066 is entered with, then run the oracle so the host proceeds to a clean stop.
 */
function captureNmiEntries(K, stride, maxFrames) {
  const caps = [];
  let seen = 0;
  const host = new Machine(ROM);
  const origFire = host.fireNmi.bind(host);
  host.fireNmi = function () {
    if (!this.pcKnown) return origFire(); // let the real guard throw its diagnostic
    this.nmiCount += 1;
    this.push16(this.pc);
    this.cycles += 11;
    if (caps.length < K && seen % stride === 0) caps.push(this.clone());
    seen += 1;
    return oracleNmi(this);
  };
  host.runFrames(maxFrames);
  return caps;
}

// Sample across ~2600 frames so the window spans the title (GAME_STATE 0/1, trivial
// blit) and the attract 25m demo (moving sprites -> non-trivial blit) alike.
const CAPS = ROM_PRESENT ? captureNmiEntries(64, 40, 2600) : [];

/** Does the oracle's blit move any sprite-RAM byte on this capture? */
function blitIsNonTrivial(cap) {
  const before = cap.clone();
  const after = cap.clone();
  oracleNmi(after);
  for (let a = 0x7000; a <= 0x7180; a++) {
    if (before.mem.read8(a) !== after.mem.read8(a)) return true;
  }
  return false;
}

// -- 1. EQUAL (captured NMI entries) ------------------------------------------

test("EQUAL: real captured NMI entries — serviceVblankNmi == oracle (RAM −stack), SP untouched", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real NMI entry in the attract window");

  let attractSkips = 0, nonTrivial = 0;
  const states = new Set();
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracleNmi(o);
    serviceVblankNmi(c);

    const d = contractDiff(o, c, cap.regs.sp, cap.regs.sp);
    assert.equal(
      d,
      null,
      d && describe(d),
    );

    if (cap.mem.read8(ATTRACT) !== 0) attractSkips += 1;
    if (blitIsNonTrivial(cap)) nonTrivial += 1;
    states.add(cap.mem.read8(0x6005));
  }
  console.log(
    `  EQUAL: ${CAPS.length} NMI entries identical (RAM −stack), SP untouched; ` +
      `attract(skip-input)=${attractSkips}, non-trivial blit=${nonTrivial}, ` +
      `GAME_STATE seen={${[...states].sort().join(",")}}`,
  );
});

// -- 2. CRAFTED (game-in-play arm: loc_0087) ------------------------------

const PRESSED = 0x11; // IN0: right + jump — a nonzero read, so the cooked word differs from the sentinel

/** A crafted in-play entry: ATTRACT=0, a held input on IN0, and the sentinel at the input latch. */
function inPlayEntry(base) {
  const m = base.clone();
  m.mem.write8(ATTRACT, 0);
  m.mem.write8(P1_INPUT, SENTINEL);
  m.io.inputAssert = { [IN0_PORT]: PRESSED };
  return m;
}

test("CRAFTED: game-in-play arm — ATTRACT=0 with a held input, both read the controls, equal", () => {
  const base = CAPS.find((c) => c.mem.read8(ATTRACT) !== 0) ?? CAPS[0];
  const o = inPlayEntry(base);
  const oFloor = o.regs.sp;
  const c = inPlayEntry(base);

  oracleNmi(o);
  serviceVblankNmi(c);

  const d = contractDiff(o, c, base.regs.sp, oFloor);
  assert.equal(d, null, d && describe(d));

  // Non-vacuous: the ORACLE really read the controls — it overwrote the sentinel at the input latch.
  assert.notEqual(o.mem.read8(P1_INPUT), SENTINEL, "the oracle left the input latch untouched — the arm was not exercised");
  console.log(`  CRAFTED: ATTRACT=0 + held input -> input latch ${hx(o.mem.read8(P1_INPUT))} on both sides; RAM/io identical, SP untouched`);
});

// Broken twin: the controls are never read, even in a credited game.
function brokenNoControls(m) {
  const { mem } = m;
  mem.write8(NMI_ENABLE, 0);
  if (mem.read8(IN2_WATCHDOG) & 0x01) throw new Error("service");
  blitSpritesViaDma(m, DMA_SETUP_BLOCK);
  perFrame(m); // BUG: readControls(m) dropped
}

test("TEETH C: a handler that never reads the controls is CAUGHT at the input latch", () => {
  const base = CAPS.find((c) => c.mem.read8(ATTRACT) !== 0) ?? CAPS[0];
  const o = inPlayEntry(base);
  const oFloor = o.regs.sp;
  const c = inPlayEntry(base);
  oracleNmi(o);
  brokenNoControls(c);
  const d = contractDiff(o, c, base.regs.sp, oFloor);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped controls read");
  assert.equal(d.kind, "ram");
  assert.equal(d.addr, P1_INPUT, `expected the catch at ${hx(P1_INPUT)}, got ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH C: dropped controls read caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 3. TEETH A (the ATTRACT gate) --------------------------------------------

// Broken twin: the ATTRACT gate is INVERTED — it reads the controls DURING attract and
// skips them in a credited game. Everything else (blit, per-frame tail) is faithful.
function brokenInvertedGate(m) {
  const { mem } = m;
  mem.write8(NMI_ENABLE, 0);
  if (mem.read8(IN2_WATCHDOG) & 0x01) throw new Error("service");
  blitSpritesViaDma(m, DMA_SETUP_BLOCK);
  if (mem.read8(ATTRACT) !== 0) readControls(m); // BUG: should be === 0
  perFrame(m);
}

test("TEETH A: an inverted ATTRACT gate (reads input during attract) is CAUGHT", () => {
  // Find a capture where the CORRECT handler (attract skip) leaves the input-latch
  // sentinel untouched — i.e. the dispatch does not overwrite 0x6010 that frame — so
  // the inverted twin's loc_0087 write is observable.
  let idx = -1;
  for (let i = 0; i < CAPS.length; i++) {
    const probe = CAPS[i].clone();
    probe.mem.write8(ATTRACT, 1);
    probe.mem.write8(P1_INPUT, SENTINEL);
    oracleNmi(probe);
    if (probe.mem.read8(P1_INPUT) === SENTINEL) { idx = i; break; }
  }
  assert.notEqual(idx, -1, "no capture left the input-latch sentinel intact — cannot stage the gate teeth");

  const o = CAPS[idx].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[idx].clone();
  o.mem.write8(ATTRACT, 1); c.mem.write8(ATTRACT, 1); // force attract -> correct handler SKIPS input
  o.mem.write8(P1_INPUT, SENTINEL); c.mem.write8(P1_INPUT, SENTINEL);

  oracleNmi(o); // correct: skips loc_0087, sentinel survives
  brokenInvertedGate(c); // wrong: reads input in attract, overwrites the sentinel

  const d = contractDiff(o, c, CAPS[idx].regs.sp, oFloor);
  assert.notEqual(d, null, "the gate FAILED to catch an inverted ATTRACT gate — it is worthless");
  assert.equal(d.kind, "ram");
  assert.equal(d.addr, P1_INPUT, `expected the catch at the input latch ${hx(P1_INPUT)}, got ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH A: inverted ATTRACT gate caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. TEETH B (the handler is SP-inert) -------------------------------------

// Broken twin: the correct handler, then the interrupt return the direct call dropped — pop a
// return PC. Memory-identical, so only the SP check sees it.
function brokenKeepsEpilogue(m) {
  serviceVblankNmi(m);
  m.ret();
}

test("TEETH B: a handler that still unwinds an interrupt frame is CAUGHT at SP (RAM equal)", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  oracleNmi(o);
  brokenKeepsEpilogue(c);
  const d = contractDiff(o, c, base.regs.sp, base.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch an SP-moving handler — the inertness check is worthless");
  assert.equal(d.kind, "sp", `expected the catch at SP (RAM equal), got ${d.kind}`);
  console.log(`  TEETH B: SP-moving twin caught (entry=${hx(d.a)} broken=${hx(d.b)})`);
});
