// SPDX-License-Identifier: GPL-3.0-only
/**
 * drawAnimatedObjectGridCellAndAdvance — memory-equivalent to the frozen oracle at ROM 0x2089. The active-slot handler maps the slot's
 * packed coordinate (A) to a VRAM cell, folds the loop counter into a tile variant, and stamps a glyph /
 * 2x2 block; then it restores the slot pointer + stride/count routeObjectGridCellDraw saved, advances the pointer by the
 * stride, and djnz-loops back into routeObjectGridCellDraw (or returns). A crafted entry stages the registers routeObjectGridCellDraw
 * hands over and seeds the stack ([hl][bc][ret]) for the oracle's pop hl / pop bc.
 *
 * The real effects are the VRAM stamp (seen by ramDiff) and the loop-carried register live-outs HL / BC /
 * A (invisible to the memory-only ramDiff, so compared directly via regDiff; DE is excluded scratch, not a
 * live-out -- see the GLYPH->BLOCK arm). EQUAL asserts both are
 * null across carry-clear (glyph) and carry-set (block) coordinates, with the glyph target cells pre-seeded
 * to a sentinel so the stamp is observably non-vacuous. TEETH catch a no-op, a skipped stamp, advancing by
 * the wrong register, a missed djnz decrement, and a stray write. LOOP drives B=2 through the djnz
 * recursion into the co-batch routeObjectGridCellDraw and asserts it terminates with matching RAM.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff as rawRamDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { drawAnimatedObjectGridCellAndAdvance as cand } from "../drawAnimatedObjectGridCellAndAdvance.js";
import { loc_2089 as oracle } from "../../translated/loc_2089.js";
import { mapPackedCoordToVram } from "../mapPackedCoordToVram.js";
import { computeTileVariantFromTimer } from "../computeTileVariantFromTimer.js";
import { drawTileGlyphOrBlock } from "../drawTileGlyphOrBlock.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// The entry is mid-walk: [hl][bc] are the walk's own loop locals (pushed at 0x207d, popped here, re-pushed on
// each djnz pass); the caller's frame starts at the return word above them, so that is the live floor.
const ramDiff = (o, c, e) => rawRamDiff(o, c, e, (e.regs.sp + 4) & 0xffff);
const TIMER = 0x425f;    // per-frame counter feeding the tile-variant fold
const SENTINEL = 0x55;   // seeded into the glyph target cells so the tile stamp is observable
const STRAY = 0x50c0;    // a VRAM cell the draws never touch, for the stray-write tooth

// The VRAM cell mapPackedCoordToVram derives from a packed coordinate (pure arithmetic, no ROM).
const glyphCell = (coord) => mapPackedCoordToVram({ regs: {} }, coord);

// Craft an active-slot entry the way routeObjectGridCellDraw hands it over: A = slot index (packed coordinate), B = loop
// counter, DE = block-draw pointer, the frame counter seeded, and the slot pointer + stride/count on the
// stack top-to-bottom as [hl][bc][caller-ret] for the oracle's pop hl / pop bc. `seedCells` pre-seeds VRAM
// cells so a stamp there is observable against a no-op.
function entry({ coord, count, stride, de, timer, slotPtr, seedCells = [] }) {
  return craft((mem8, e) => {
    e.regs.a = coord;
    e.regs.b = count;
    e.regs.de = de;
    e.regs.hl = slotPtr;              // dead at entry (the first subcall overwrites HL); set for realism
    mem8[TIMER] = timer;
    for (const addr of seedCells) mem8[addr] = SENTINEL;
    e.push16(0x9999);                 // caller return address (deepest)
    e.push16((count << 8) | stride);  // BC saved: B = count, C = stride
    e.push16(slotPtr);                // HL saved: slot pointer (first pop)
  });
}

// The loop carries HL (advanced pointer), BC (decremented counter + stride) and A between drawAnimatedObjectGridCellAndAdvance and
// routeObjectGridCellDraw; ramDiff is memory-only, so compare those live-out registers directly. DE is NOT compared: the
// oracle's mapper leaves DE at its glyph-table-lookup scratch (0x2157+index) which the idiomatic mapper,
// deriving the cell in JS, never reproduces -- and the GLYPH->BLOCK arm proves nothing downstream consumes
// it (RAM identical there, its positive control biting), so DE is excluded scratch, not a live-out.
function regDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  for (const f of ["a", "bc", "hl"]) {
    if (a.regs[f] !== b.regs[f]) return `${f}: 0x${a.regs[f].toString(16)} vs 0x${b.regs[f].toString(16)}`;
  }
  return null;
}

// Single-slot (B=1, djnz not taken) entries: carry-clear coords (bit4=0 -> glyph, target cells seeded) and
// carry-set coords (bit4=1 -> 2x2 block), across mixed frame-counter phases.
function glyphCase(coord, timer, slotPtr, de) {
  const cell = glyphCell(coord);
  return { coord, count: 1, stride: 0x10, de, timer, slotPtr, seedCells: [cell, (cell + 32) & 0xffff] };
}
const GLYPH = [
  glyphCase(0x00, 0x00, 0x4100, 0x5220),
  glyphCase(0x25, 0xa5, 0x4125, 0x5240),
  glyphCase(0x4f, 0x3c, 0x414f, 0x5260),
];
const BLOCK = [
  { coord: 0x10, count: 1, stride: 0x10, de: 0x5280, timer: 0x33, slotPtr: 0x4110 },
  { coord: 0x30, count: 1, stride: 0x10, de: 0x52a0, timer: 0x9e, slotPtr: 0x4130 },
];

// --- broken twins (independent replicas, each with one defect; all ret for B=1) ---
function brokenNoOp() {}

function brokenSkipDraw(m) {
  mapPackedCoordToVram(m); computeTileVariantFromTimer(m, undefined, 0);
  // drawTileGlyphOrBlock omitted -> no VRAM stamp
  const slotPtr = m.pop16(), strideCount = m.pop16();
  const stride = strideCount & 0xff, count = (strideCount >> 8) & 0xff;
  const advLow = (slotPtr + stride) & 0xff;
  return (m.regs.hl = ((slotPtr >> 8) << 8) | advLow, m.regs.a = advLow,
    m.regs.bc = (((count - 1) & 0xff) << 8) | stride, m.ret());
}

function brokenAdvanceByCount(m) {
  mapPackedCoordToVram(m); computeTileVariantFromTimer(m, undefined, 0); drawTileGlyphOrBlock(m);
  const slotPtr = m.pop16(), strideCount = m.pop16();
  const stride = strideCount & 0xff, count = (strideCount >> 8) & 0xff;
  const advLow = (slotPtr + count) & 0xff; // BUG: advance by B (count) instead of C (stride)
  return (m.regs.hl = ((slotPtr >> 8) << 8) | advLow, m.regs.a = advLow,
    m.regs.bc = (((count - 1) & 0xff) << 8) | stride, m.ret());
}

function brokenNoDecrement(m) {
  mapPackedCoordToVram(m); computeTileVariantFromTimer(m, undefined, 0); drawTileGlyphOrBlock(m);
  const slotPtr = m.pop16(), strideCount = m.pop16();
  const stride = strideCount & 0xff, count = (strideCount >> 8) & 0xff;
  const advLow = (slotPtr + stride) & 0xff;
  return (m.regs.hl = ((slotPtr >> 8) << 8) | advLow, m.regs.a = advLow,
    m.regs.bc = (count << 8) | stride, m.ret()); // BUG: B not decremented
}

const brokenStray = (m) => { cand(m); m.mem8[STRAY] = (m.mem8[STRAY] + 1) & 0xff; };

test("EQUAL: drawAnimatedObjectGridCellAndAdvance == oracle (RAM + register live-outs) across glyph and block slots", { skip }, () => {
  for (const c of [...GLYPH, ...BLOCK]) {
    assert.equal(ramDiff(oracle, cand, entry(c)), null, `RAM diverged at coord 0x${c.coord.toString(16)}`);
    assert.equal(regDiff(cand, entry(c)), null, `register live-out diverged at coord 0x${c.coord.toString(16)}`);
  }
  // non-vacuous: with the glyph cells seeded to a sentinel, the oracle demonstrably stamps VRAM (a glyph
  // writes tile and tile+2 — differing by 2, so at least one cell changes from the sentinel), and the
  // block path likewise stamps its 2x2 cells.
  assert.ok(ramDiff(oracle, brokenNoOp, entry(GLYPH[0])), "vacuous: oracle stamped nothing (glyph)");
  assert.ok(ramDiff(oracle, brokenNoOp, entry(BLOCK[0])), "vacuous: oracle stamped nothing (block)");
  console.log("  EQUAL: drawAnimatedObjectGridCellAndAdvance == oracle — glyph + block stamps and HL/BC/A live-outs match");
});

test("TEETH: no-op, skipped stamp, wrong advance register, missed decrement, stray write all caught", { skip }, () => {
  const glyph = GLYPH[0], block = BLOCK[0];
  assert.ok(ramDiff(oracle, brokenNoOp, entry(glyph)), "the no-op twin escaped the RAM diff");
  assert.ok(ramDiff(oracle, brokenSkipDraw, entry(glyph)), "the skipped-stamp twin escaped the RAM diff");
  assert.ok(ramDiff(oracle, brokenSkipDraw, entry(block)), "the skipped-stamp twin escaped on the block path");
  assert.ok(regDiff(brokenAdvanceByCount, entry(glyph)), "advancing by the wrong register escaped");
  assert.ok(regDiff(brokenNoDecrement, entry(glyph)), "the missed-djnz-decrement twin escaped");
  assert.ok(ramDiff(oracle, brokenStray, entry(glyph)), "the stray-write twin escaped the RAM diff");
  console.log("  TEETH: no-op, skipped stamp, wrong-advance (register), missed decrement, stray write all caught");
});

// Integration: B=2 drives the djnz recursion back into the co-batch routeObjectGridCellDraw (both slots active so it stays
// on the bit0-set path); asserts the loop terminates with RAM matching the oracle.
test("LOOP (B=2, both slots active): djnz recurses into routeObjectGridCellDraw, terminates, RAM matches", { skip }, () => {
  const stride = 0x10, slotPtr = 0x4130;
  const e = entry({ coord: 0x30, count: 2, stride, de: 0x5220, timer: 0x5a, slotPtr });
  e.mem8[(slotPtr + stride) & 0xffff] |= 0x01; // advanced slot active -> routeObjectGridCellDraw re-enters drawAnimatedObjectGridCellAndAdvance
  assert.equal(ramDiff(oracle, cand, e), null, "the multi-slot loop diverged from the oracle");
  console.log("  LOOP: B=2 djnz recursion into routeObjectGridCellDraw terminates with matching RAM");
});

// A twin that drives the whole walk itself and, on the block path, stamps the 2x2 at the CARRIED DE
// (left by the prior glyph slot) instead of the mapped cell -- the positive control proving the RAM diff
// below is DE-sensitive.
function twinBlockAtCarriedDe(m, savedHl, savedBc) {
  const coord = m.regs.a;
  mapPackedCoordToVram(m);
  m.regs.b = coord;
  computeTileVariantFromTimer(m, undefined, 0);
  if (m.regs.fC) { const d = m.regs.de & 0xffff; m.mem8[d] = 0xa4; m.mem8[(d + 1) & 0xffff] = 0xa4; }
  else drawTileGlyphOrBlock(m);
  const p = savedHl === undefined ? m.pop16() : savedHl;
  const sc = savedBc === undefined ? m.pop16() : savedBc;
  const st = sc & 0xff, low = (p + st) & 0xff, rem = ((sc >> 8) - 1) & 0xff;
  const np = ((p >> 8) << 8) | low;
  m.regs.hl = np; m.regs.a = low; m.regs.bc = (rem << 8) | st;
  if (rem !== 0 && (m.mem8[np] & 1)) return twinBlockAtCarriedDe(m, np, (rem << 8) | st);
  return m.ret();
}

// GLYPH->BLOCK: slot0 coord 0x00 (glyph) then slot1 coord 0x10 (block), both active -- the ONLY sequence
// that runs a block AFTER a glyph left DE at its table-lookup scratch. Proves the idiomatic block derives
// its destination from the mapped cell (HL via the swap), never the carried DE, so RAM matches the oracle;
// the twin (block at the carried DE) bites, so the match is non-vacuous. This is why regDiff drops DE.
test("GLYPH->BLOCK (DE dead across slots): block draws at the mapped cell, not the carried DE", { skip }, () => {
  const stride = 0x10, slotPtr = 0x4100, cell0 = glyphCell(0x00);
  const mk = () => {
    const e = entry({ coord: 0x00, count: 2, stride, de: 0x5220, timer: 0x00, slotPtr,
                      seedCells: [cell0, (cell0 + 32) & 0xffff] });
    e.mem8[(slotPtr + stride) & 0xffff] |= 0x01; // slot1 active -> a block draw follows the glyph
    return e;
  };
  assert.equal(ramDiff(oracle, cand, mk()), null, "glyph->block diverged: the block consumed the carried DE");
  assert.ok(ramDiff(oracle, twinBlockAtCarriedDe, mk()), "vacuous: drawing the block at the carried DE escaped");
  console.log("  GLYPH->BLOCK: block draws at the mapped cell; carried DE is dead (twin bites) -> DE not a live-out");
});
