// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnInterludeHeart (ROM 0x1708) — the board-cleared interlude's
 * opening tableau: silence the sound (call 0x011c), seed a fixed 4-byte sprite record at 0x6A20
 * and the blink-sprite code at 0x6905, run the 3-cell descending fill from 0x75C4 (call 0x0514),
 * then set the sound-priority pair 0x608A/0x608B.
 *
 * THE 3-CELL FILL BLANKS, IT DOES NOT COLOUR. (An earlier version of this header called it a
 * "colour column"; the identifiers below still carry that word.) 0x7400-0x77FF is the tilemap's
 * CHARACTER RAM and dkong has no colour RAM at all — a cell's colour comes from the v-5e PROM,
 * indexed by column and four-row band, which cannot be written. The three codes written here,
 * 0x10 / 0x0F / 0x0E, all decode to entirely BLANK tiles in gfx1.bin. So the fill CLEARS three
 * cells of one column; teeth (b) below catches its omission either way.
 *
 * This is the cycle-free / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. spawnInterludeHeart WRITES RAM, so every case uses a FRESH clone per side
 * (never a reused machine). The oracle runs on one clone, spawnInterludeHeart on another, and
 * they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP)     [no live-out regs/flags]
 *
 * SP/PC are deliberately NOT compared: the oracle's only SP/PC mutations are its
 * push16/step/ret stack + PC bookkeeping for the two `call`s and the terminal `ret`,
 * the modelled stack ABI the direct-call layer replaces with the JS call stack. Both
 * callers (begin50mKongRecaptureInterlude `ld a,(0x6910)`, beginKongRecaptureInterlude `ld hl,0x385c`) reload their registers
 * before use, so nothing consumes a register/flag this leaves — live-out is memory.
 *
 * REACHABILITY: spawnInterludeHeart is on the board-cleared INTERLUDE path — its only callers are
 * the two step-0 openers, beginKongRecaptureInterlude (odd boards) and
 * begin50mKongRecaptureInterlude (50m). PC-attributed grounding puts all 6 of its firings in a
 * whole progression run at sub-state 0x16 step 0, with 0 in the 769-frame opening cutscene and 0
 * in 24,243 attract frames — so the older "board load / intro cutscene" reading of this routine is
 * REFUTED, not merely unproven. It is NOT dispatched by a 6000-frame attract run nor by the
 * coin+start tape (measured here — 0 dispatches). Because the routine reads no memory and
 * takes no arguments (its non-stack output values are identical from two wildly
 * different pre-dirtied entries — proven in INPUT-INDEPENDENCE below), a real captured
 * ATTRACT state is a fully valid entry: there are no input arms to miss. So the gate
 * uses real attract states as entries plus crafted pre-dirtied variants.
 *
 * Jobs:
 *   1. EQUAL (real attract states) — clone real attract machine states at several
 *      frames and, on each, oracle vs spawnInterludeHeart leave identical RAM (−STACK_SCRATCH).
 *   2. INPUT-INDEPENDENCE — running the oracle from two entries dirtied with different
 *      fill bytes yields the SAME non-stack output values: it reads nothing, so a
 *      captured state is a valid entry and there are no unreached data-dependent arms.
 *   3. FOOTPRINT — pre-dirty exactly the target addresses to 0xAA; the oracle's only
 *      non-stack changes are those addresses, each landing its documented constant.
 *      Pins the exact memory footprint the gate covers.
 *   4. CRAFTED (overwrites dirt) — pre-dirty the whole target set to 0xAA identically
 *      on both sides; oracle and spawnInterludeHeart leave identical RAM AND both overwrite the
 *      dirt with the correct constants (clear/seed semantics, not agreement-on-preset).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1708.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1708 as oracle } from "../../translated/loc_1708.js";
import { spawnInterludeHeart as candidate } from "../spawnInterludeHeart.js";
// Teeth twins reuse the real idiomatic callees so only the injected defect differs.
import { silenceSound } from "../silenceSound.js";
import { fillDescendingColumn } from "../fillDescendingColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SND_PRIORITY, SND_PRIORITY_FRAMES } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The complete non-stack write footprint of spawnInterludeHeart: address -> final value.
const EXPECTED = new Map([
  // silenceSound zeroes the sound-trigger shadow + control block 0x6080-0x6089...
  [0x6080, 0], [0x6081, 0], [0x6082, 0], [0x6083, 0], [0x6084, 0],
  [0x6085, 0], [0x6086, 0], [0x6087, 0], [0x6088, 0], [0x6089, 0],
  // ...then spawnInterludeHeart sets the sound-priority pair.
  [SND_PRIORITY, 0x07], [SND_PRIORITY_FRAMES, 0x03], // 0x608A / 0x608B
  // the blink-sprite code.
  [0x6905, 0x13],
  // the 4-byte sprite record at 0x6A20.
  [0x6a20, 0x80], [0x6a21, 0x76], [0x6a22, 0x09], [0x6a23, 0x20],
  // the 3-cell descending colour column from 0x75C4, stride 0x20.
  [0x75c4, 0x10], [0x75e4, 0x0f], [0x7604, 0x0e],
]);

/**
 * First RAM difference between two machines on the go-forward contract: the whole
 * state dump minus the stack scratch below the entry SP (dead scratch). This IS load-bearing
 * here — the oracle's two `call`s push16 into STACK_SCRATCH (0x6BFC/0x6BFD) while the
 * direct-call candidate never touches the stack, so those bytes legitimately differ
 * and MUST be masked. Single forward pass, skipping stack addresses inline. Returns
 * {addr,a,b} or null.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = ma.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

function diffAgainstOracle(entry, cand) {
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  cand(b);
  return ramDiffMinusStack(a, b, entry.regs.sp);
}

function dirtyTargets(m, val) {
  for (const addr of EXPECTED.keys()) m.mem.write8(addr, val);
}

/**
 * A real attract-mode machine state at frame ~N. spawnInterludeHeart is never dispatched in
 * attract, but it reads no memory, so any genuine state is a valid entry (job 2
 * proves this). Cloning gives a machine with neutralised frame machinery, so running
 * one routine on it in isolation cannot trip a boundary/NMI.
 */
function attractState(nFrames) {
  const m = new Machine(ROM);
  m.runFrames(nFrames);
  const c = m.clone();
  // Seat SP one call-level into work RAM, as if entered via the CALL its real callers
  // use (begin50mKongRecaptureInterlude/beginKongRecaptureInterlude) — an attract idle sits at the empty-stack top (0x6C00), so
  // the oracle's terminal `ret` would pop unmapped. 0x6BFE lands the pop in dead
  // STACK_SCRATCH (excluded from the compare); the candidate never touches SP.
  c.regs.sp = 0x6bfe;
  return c;
}

const ENTRIES = ROM_PRESENT ? [350, 2000, 4500].map(attractState) : [];

test("EQUAL: real attract states as entries — spawnInterludeHeart == oracle in RAM (−stack)", () => {
  assert.ok(ENTRIES.length >= 1, "expected at least one attract entry state");
  for (const entry of ENTRIES) {
    const d = diffAgainstOracle(entry, candidate);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} cand=${d.b}`);
  }
  console.log(`  EQUAL: ${ENTRIES.length} real attract states — RAM (−stack) identical to the oracle`);
});

test("INPUT-INDEPENDENCE: oracle non-stack outputs are constant across differently-dirtied entries", () => {
  const base = ENTRIES[0];
  const e1 = base.clone();
  const e2 = base.clone();
  // Dirty broad work + video RAM spans with DIFFERENT bytes on each side.
  for (let a = 0x6000; a < 0x6be0; a++) { e1.mem.write8(a, 0x11); e2.mem.write8(a, 0xee); }
  for (let a = 0x7400; a < 0x7800; a++) { e1.mem.write8(a, 0x11); e2.mem.write8(a, 0xee); }
  oracle(e1);
  oracle(e2);
  for (const addr of EXPECTED.keys()) {
    const v1 = e1.mem.read8(addr);
    const v2 = e2.mem.read8(addr);
    assert.equal(v1, v2, `oracle output at ${hx(addr)} depends on prior RAM (${v1} vs ${v2}) — not input-independent`);
  }
  console.log("  INPUT-INDEPENDENCE: identical non-stack outputs from 0x11- vs 0xEE-dirtied entries");
});

test("FOOTPRINT: the oracle's only non-stack changes are the documented targets + constants", () => {
  const entry = ENTRIES[0].clone();
  dirtyTargets(entry, 0xaa); // so every target write shows as a change (0xAA != any target value)
  const before = entry.clone();
  const b0 = before.dumpState();
  oracle(entry);
  const a1 = entry.dumpState();

  const seen = new Set();
  const dead = deadStackBelow(STACK_SCRATCH, before.regs.sp);
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = entry.stateOffsetToAddr(off);
    if (dead(addr)) continue;
    assert.ok(EXPECTED.has(addr), `oracle wrote an UNEXPECTED non-stack addr ${hx(addr)} (${b0[off]}->${a1[off]})`);
    assert.equal(a1[off], EXPECTED.get(addr), `oracle wrote wrong value at ${hx(addr)}`);
    seen.add(addr);
  }
  // Every documented target actually changed (0xAA -> its constant).
  for (const addr of EXPECTED.keys()) {
    assert.ok(seen.has(addr), `documented target ${hx(addr)} was NOT written by the oracle`);
  }
  console.log(`  FOOTPRINT: ${seen.size} non-stack targets written, each to its documented constant`);
});

test("CRAFTED: pre-dirtied targets are overwritten identically by both sides", () => {
  const base = ENTRIES[0];
  const o = base.clone();
  const c = base.clone();
  dirtyTargets(o, 0xaa);
  dirtyTargets(c, 0xaa);

  oracle(o);
  candidate(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} cand=${d.b}`);
  // ...and spawnInterludeHeart genuinely overwrote the dirt with the right constants.
  for (const [addr, val] of EXPECTED) {
    assert.equal(c.mem.read8(addr), val, `spawnInterludeHeart left ${hx(addr)} = ${c.mem.read8(addr)} (expected ${val})`);
  }
  console.log("  CRAFTED: whole target set dirtied to 0xAA -> both overwrite to the documented constants, RAM identical");
});

/** Twin (a): wrong sprite byte at 0x6A21 (0x77 instead of 0x76). */
function brokenSpriteByte(m) {
  const { regs, mem } = m;
  silenceSound(m);
  mem.write8(0x6a20, 0x80);
  mem.write8(0x6a21, 0x77); // BUG: should be 0x76
  mem.write8(0x6a22, 0x09);
  mem.write8(0x6a23, 0x20);
  mem.write8(0x6905, 0x13);
  regs.hl = 0x75c4; regs.de = 0x0020; regs.a = 0x10;
  fillDescendingColumn(m);
  mem.write8(SND_PRIORITY, 0x07);
  mem.write8(SND_PRIORITY_FRAMES, 0x03);
}

/** Twin (b): SKIPS the colour-column fill (leaves 0x75C4/0x75E4/0x7604 as they were). */
function brokenNoColourColumn(m) {
  const { mem } = m;
  silenceSound(m);
  mem.write8(0x6a20, 0x80);
  mem.write8(0x6a21, 0x76);
  mem.write8(0x6a22, 0x09);
  mem.write8(0x6a23, 0x20);
  mem.write8(0x6905, 0x13);
  mem.write8(SND_PRIORITY, 0x07);
  mem.write8(SND_PRIORITY_FRAMES, 0x03);
}

test("TEETH: wrong-sprite-byte and skipped-colour-column twins are both CAUGHT", () => {
  // Run on a dirtied entry so the skipped-fill twin is unambiguous (0xAA vs painted).
  const base = ENTRIES[0].clone();
  dirtyTargets(base, 0xaa);

  const dSprite = diffAgainstOracle(base, brokenSpriteByte);
  assert.notEqual(dSprite, null, "the gate FAILED to catch a wrong sprite byte — it is worthless");
  assert.equal(dSprite.addr, 0x6a21, `wrong-sprite twin must diverge at 0x6A21, got ${hx(dSprite.addr ?? 0)}`);
  assert.equal(dSprite.a, 0x76, "oracle stores 0x76 at 0x6A21");
  assert.equal(dSprite.b, 0x77, "broken twin stores 0x77 at 0x6A21");

  const dCol = diffAgainstOracle(base, brokenNoColourColumn);
  assert.notEqual(dCol, null, "the gate FAILED to catch a skipped colour column — it is worthless");
  assert.ok(
    dCol.addr === 0x75c4 || dCol.addr === 0x75e4 || dCol.addr === 0x7604,
    `skipped-colour twin must diverge in the colour column, got ${hx(dCol.addr ?? 0)}`,
  );

  console.log(
    `  TEETH: wrong sprite byte caught at ${hx(dSprite.addr)} (${dSprite.a}->${dSprite.b}); ` +
      `skipped colour column caught at ${hx(dCol.addr)} (${dCol.a}->${dCol.b})`,
  );
});
