// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_01c6 — memory-equivalent to the frozen oracle at ROM 0x01c6.
 * A sub-state setup with no register live-in; every live-out is a work-RAM cell, so RAM equivalence is the
 * whole story. The oracle reaches its block-fill through rst 0x10; the candidate inlines that fill (the fill
 * primitive is not a batch-1 idiomatic module). We pre-dirty every cell it touches with a sentinel so each
 * write is observable, then assert ramDiff==null with non-vacuous positive controls. Teeth: no-op, no-fill,
 * short-fill, wrong-pointer and no-increment twins each diverge. The return-stack window is masked.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_01c6 as cand } from "../loc_01c6.js";
import { loc_01c6 as oracle } from "../../translated/loc_01c6.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const BLOCK = 0x4100, BLOCK_LEN = 128;
const S1 = 0x425f, S2 = 0x4224;   // status bytes cleared
const PTR = 0x400b;               // VRAM write cursor (word)
const PAGE = 0x4009;              // page counter
const SEQ = 0x400a;               // sequence-step index (incremented)
const SENT = 0xaa;

const entry = () => craft((mem, mm) => {
  mm.push16(0x9999);
  for (let i = 0; i < BLOCK_LEN; i++) mem[BLOCK + i] = SENT;
  mem[S1] = SENT; mem[S2] = SENT;
  mem[PTR] = SENT; mem[PTR + 1] = SENT;
  mem[PAGE] = SENT;
  mem[SEQ] = 5;
});

function ramAfter(fn, e) { const m = e.clone(); m.routines = STUBS; fn(m); return m; }

// Twins.
const noOp = () => {};
const noFill = (m) => { // does everything but clear the block
  m.mem8[S1] = 0; m.mem8[S2] = 0; m.mem16[PTR] = 0x5002; m.mem8[PAGE] = 32; m.mem8[SEQ]++;
};
const shortFill = (m) => { cand(m); m.mem8[BLOCK + BLOCK_LEN - 1] = SENT; }; // misses the last byte
const wrongPtr = (m) => { cand(m); m.mem16[PTR] = 0x5000; };                 // wrong cursor value
const noInc = (m) => { cand(m); m.mem8[SEQ] = (m.mem8[SEQ] - 1) & 0xff; };   // skips the sequence bump

test("EQUAL (crafted): loc_01c6 == oracle", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_01c6 diverged");

  // Positive controls: the oracle really moves every live-out off its sentinel.
  const a = ramAfter(oracle, entry());
  assert.equal(a.mem8[BLOCK], 0, "block start cleared");
  assert.equal(a.mem8[BLOCK + BLOCK_LEN - 1], 0, "block end cleared");
  assert.equal(a.mem8[S1], 0, "status byte 1 cleared");
  assert.equal(a.mem8[S2], 0, "status byte 2 cleared");
  assert.equal(a.mem16[PTR], 0x5002, "VRAM write cursor seeded");
  assert.equal(a.mem8[PAGE], 32, "page counter armed");
  assert.equal(a.mem8[SEQ], 6, "sequence step 5->6");
  console.log("  EQUAL: loc_01c6 == oracle, block cleared + cursor/counters set");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, noFill, entry()), "the no-fill twin escaped");
  assert.ok(ramDiff(oracle, shortFill, entry()), "the short-fill twin escaped");
  assert.ok(ramDiff(oracle, wrongPtr, entry()), "the wrong-pointer twin escaped");
  assert.ok(ramDiff(oracle, noInc, entry()), "the no-increment twin escaped");
  console.log("  TEETH: no-op, no-fill, short-fill, wrong-pointer, no-increment all caught");
});
