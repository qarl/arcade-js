// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blit2x2TileBlock (ROM 0x3325) — "blit a 2x2 tile block". Four source
 * bytes at (DE) are copied into the video-RAM square at (HL): top-left, top-right (+0x01), bottom-right
 * (+0x21), bottom-left (+0x20). The oracle advances HL to the bottom-left cell (HL + 0x20) and that
 * advanced pointer is consumed by the two-tile animators (blitStackedTwoTileAnimFrameOnHoldTimer / blitTwoTileAnimFrameOnHoldTimer / movePlayerVerticallyAndTickStatusRender all read it),
 * so it is part of the go-forward contract:
 *
 *     RAM (dumpState minus stack scratch below the entry SP)  AND  the HL live-out (== dest + 0x20).
 *
 * blit2x2TileBlock WRITES video RAM, so each case uses a FRESH clone per side. DE/A are left as plumbing
 * (callers restore DE via push/pop and never read A), so they are NOT part of the contract.
 *
 * Jobs:
 *   1. CRAFTED — pre-dirty the dest square to 0xAA, seed four source bytes: both sides land the same four
 *      cells, the four source bytes map to the right corners, and the surrounding dirt is preserved.
 *   2. WRITE-SET — the oracle writes exactly {dest, dest+1, dest+0x20, dest+0x21}.
 *   3. TEETH(RAM) — a twin writing a WRONG bottom-left byte MUST be caught at dest+0x20.
 *   4. TEETH(HL)  — an un-advanced HL return (dest) MUST differ from the oracle's advanced HL.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3325.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3325 as oracle } from "../../translated/loc_3325.js";
import { blit2x2TileBlock } from "../blit2x2TileBlock.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const DEST = 0x8460; // a video-RAM anchor; the square spans 0x8460/0x8461/0x8480/0x8481
const SRC = 0x8b00; //  a work-RAM source block (no overlap with the dest square)
const CELLS = [DEST + 0x00, DEST + 0x01, DEST + 0x21, DEST + 0x20]; // TL, TR, BR, BL <- src+0..src+3
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Dirty the dest square to 0xAA, seed four source bytes, point HL at dest / DE at source. */
function craft(bytes) {
  const m = new Machine(ROM);
  for (const c of CELLS) m.mem.write8(c & 0xffff, 0xaa);
  m.mem.write8((DEST + 0x02) & 0xffff, 0xaa); // a between-corners neighbour, must stay dirty
  for (let i = 0; i < 4; i++) m.mem.write8((SRC + i) & 0xffff, bytes[i]);
  m.regs.hl = DEST;
  m.regs.de = SRC;
  return m;
}

const DATA = [
  [0x11, 0x22, 0x33, 0x44],
  [0x00, 0xff, 0x5a, 0xa5],
  [0xaa, 0xaa, 0xaa, 0xaa], // all equal to the dirt: writes still land, diff still null
  [0x10, 0x34, 0x37, 0x01],
];

test("CRAFTED: four bytes land in the 2x2 square, dirt preserved, RAM + HL identical", () => {
  for (const bytes of DATA) {
    const o = craft(bytes);
    const c = craft(bytes);
    oracle(o);
    const ret = blit2x2TileBlock(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${bytes}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.hl, `${bytes}: HL live-out ${hx(ret)} != oracle ${hx(o.regs.hl)}`);
    // SIDE-EFFECT arm: the bridge must SET HL on the module clone (not merely return it) —
    // blitStackedTwoTileAnimFrameOnHoldTimer/blitTwoTileAnimFrameOnHoldTimer do `add hl,de` on the returned HL and movePlayerVerticallyAndTickStatusRender/wrapRenderPhaseAndPaintTileTriplet do `ld l,X`
    // reading the H byte, so the register itself is consumed. A return-only rewrite fails here.
    assert.equal(c.regs.hl, o.regs.hl, `${bytes}: module must SET HL (== dest+0x20) for the translated animators`);
    assert.equal(ret, (DEST + 0x20) & 0xffff, `${bytes}: HL should advance to the bottom-left cell`);

    assert.equal(c.mem.read8(DEST + 0x00), bytes[0], `${bytes}: top-left`);
    assert.equal(c.mem.read8(DEST + 0x01), bytes[1], `${bytes}: top-right`);
    assert.equal(c.mem.read8(DEST + 0x21), bytes[2], `${bytes}: bottom-right`);
    assert.equal(c.mem.read8(DEST + 0x20), bytes[3], `${bytes}: bottom-left`);
    assert.equal(c.mem.read8(DEST + 0x02), 0xaa, `${bytes}: between-corners neighbour untouched`);
  }
  console.log(`  CRAFTED: ${DATA.length} source blocks blitted identically, dirt preserved`);
});

test("WRITE-SET: the oracle writes exactly {dest, dest+1, dest+0x20, dest+0x21}", () => {
  const written = new Set(CELLS.map((a) => a & 0xffff));
  for (const bytes of DATA) {
    const before = craft(bytes);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) {
        const addr = after.stateOffsetToAddr(off);
        assert.ok(written.has(addr), `${bytes}: oracle wrote unexpected addr ${hx(addr)}`);
      }
    }
  }
  console.log("  WRITE-SET: every oracle write is within the declared four cells");
});

test("TEETH(RAM): a wrong bottom-left byte is CAUGHT at dest+0x20", () => {
  const broken = (m, dest = m.regs.hl, src = m.regs.de) => {
    const ret = blit2x2TileBlock(m, dest, src);
    m.mem.write8((dest + 0x20) & 0xffff, (m.mem.read8((src + 0x03) & 0xffff) ^ 0x01) & 0xff); // BUG
    return ret;
  };
  let caught = null;
  for (const bytes of DATA) {
    const o = craft(bytes);
    const c = craft(bytes);
    oracle(o);
    broken(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong bottom-left byte — it is worthless");
  assert.equal(caught.addr, (DEST + 0x20) & 0xffff, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH(RAM): wrong bottom-left caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});

test("TEETH(HL): an un-advanced HL (the base dest) differs from the oracle's advanced HL", () => {
  // The module now SETS HL via the return-assignment bridge, so c.regs.hl already matches the
  // oracle (asserted in CRAFTED). The teeth here prove the *contract* is non-trivial: the
  // un-advanced base dest — the plausible "forgot to advance" bug — is genuinely rejected.
  let caught = false;
  for (const bytes of DATA) {
    const o = craft(bytes);
    const c = craft(bytes);
    oracle(o);
    blit2x2TileBlock(c);
    assert.equal(c.regs.hl, o.regs.hl, `${bytes}: sanity — module SET HL matches the oracle`);
    const unAdvanced = DEST & 0xffff; // the base dest, a plausible un-advanced-return bug
    if (unAdvanced !== o.regs.hl) { caught = true; break; }
  }
  assert.ok(caught, "the advanced-HL contract FAILED to reject the un-advanced base dest — it is worthless");
  console.log("  TEETH(HL): the advanced HL (dest+0x20) is required; the base dest is rejected");
});
