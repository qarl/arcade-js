// SPDX-License-Identifier: GPL-3.0-only
/**
 * renderFrogAndArmObjects — memory-equivalent to the frozen oracle at ROM 0x1952.
 * GATE: crafted-entry (attract-state capture). Plain attract never dispatches this frog render within
 * ENTRY_FRAMES (probe: 0), so coherent states are harvested at the high-frequency neighbour 0x230f and
 * driven directly — valid because renderFrogAndArmObjects takes no register live-in and reads no control-flow RAM
 * (it is a straight-line render), so any coherent state exercises the whole body. The routine issues a
 * blit (0x19e2) and tail-chains object-anim init (0x1a02); both run on each side's own clone, so their
 * writes are part of the compared live-out. The oracle's inner loops push BC transiently, so the diff
 * masks the dead Z80 stack scratch below the entry SP. Live-out is memory-only; registers/SP not compared.
 * Teeth: four broken twins (no-op, wrong banner tile, skip the blit, skip the tail chain).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { renderFrogAndArmObjects } from "../renderFrogAndArmObjects.js";
import { loc_1952 as oracle } from "../../translated/loc_1952.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const HARVEST = 0x230f; // once-per-life setup, dispatched every attract frame; rets early -> coherent state
const CAP = 30;
const BLIT = 0x19e2;
const TAIL = 0x1a02;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

let captured = null;
function capture() {
  if (captured) return captured;
  const entries = [];
  const real = TRANSLATED.get(HARVEST);
  const m = makeMachine(new Map([[HARVEST, (mm) => {
    if (entries.length < CAP) entries.push(mm.clone());
    return real(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  captured = entries;
  return captured;
}

// RAM diff that neutralizes the dead stack window in both dumps, so the first-diff helper reports the
// first REAL divergence rather than the transient push residue.
function ramDiff(cand, machine) {
  const dead = deadStackBelow(STACK_SCRATCH, machine.regs.sp);
  const a = machine.clone(); oracle(a);
  const b = machine.clone(); cand(b);
  const da = a.dumpState(), db = b.dumpState();
  for (let off = 0; off < db.length; off++) {
    const addr = a.stateOffsetToAddr(off);
    if (dead(addr)) db[off] = da[off];
  }
  const d = firstStateDiff(da, db, (o) => a.stateOffsetToAddr(o));
  return d ? `0x${(d.addr ?? 0).toString(16)}: ${d.a} vs ${d.b}` : null;
}

// broken twins — each reproduces enough of the render to leave a real divergence outside the stack.
function copyCols(m, base, src, cols) {
  const { mem8 } = m;
  let hl = base;
  for (let c = 0; c < cols; c++) {
    let de = src;
    for (let row = 0; row < 4; row++) { mem8[hl] = mem8[de]; de = (de + 1) & 0xffff; hl = (hl + 32) & 0xffff; }
    hl = (hl + 64) & 0xffff;
  }
}
function paintCorners(m) {
  const { mem8 } = m;
  mem8[0xa844] = 65; mem8[0xa845] = 66;
  const bottom = (0xa844 + 864) & 0xffff;
  mem8[bottom] = 69; mem8[(bottom + 1) & 0xffff] = 70;
}
function banner(m, tile) {
  const { mem8 } = m;
  let hl = 0xa8c3;
  for (let i = 0; i < 4; i++) { mem8[hl] = tile; hl = (hl + 32) & 0xffff; mem8[hl] = tile; hl = (hl + 160) & 0xffff; }
}
function brokenNoOp() {}
function brokenWrongBanner(m) {
  copyCols(m, 0xa843, 0x19f6, 5); copyCols(m, 0xa8a4, 0x19fa, 4); copyCols(m, 0xa8a5, 0x19fe, 4);
  banner(m, 72); paintCorners(m); // BUG: banner tile 72, not 71
  m.regs.hl = 0xa85c; m.push16(0x19d3); m.call(BLIT);
  m.mem8[0x8007] = 1; m.mem8[0x8009] = 1; m.mem8[0x800b] = 1;
  return m.call(TAIL);
}
function brokenSkipBlit(m) {
  copyCols(m, 0xa843, 0x19f6, 5); copyCols(m, 0xa8a4, 0x19fa, 4); copyCols(m, 0xa8a5, 0x19fe, 4);
  banner(m, 71); paintCorners(m); // BUG: never blits the 0x19e2 tile string
  m.mem8[0x8007] = 1; m.mem8[0x8009] = 1; m.mem8[0x800b] = 1;
  return m.call(TAIL);
}
function brokenSkipTail(m) {
  copyCols(m, 0xa843, 0x19f6, 5); copyCols(m, 0xa8a4, 0x19fa, 4); copyCols(m, 0xa8a5, 0x19fe, 4);
  banner(m, 71); paintCorners(m);
  m.regs.hl = 0xa85c; m.push16(0x19d3); m.call(BLIT);
  m.mem8[0x8007] = 1; m.mem8[0x8009] = 1; m.mem8[0x800b] = 1; // BUG: never chains 0x1a02
}

test("CAPTURE: renderFrogAndArmObjects == oracle on every harvested attract state", { skip }, () => {
  const entries = capture();
  assert.ok(entries.length > 0, "vacuous: no attract states harvested");
  for (const e of entries) assert.equal(ramDiff(renderFrogAndArmObjects, e), null, "a captured machine diverged");
  // non-vacuous: the no-op twin diverging proves the oracle actually writes on the sample entry.
  assert.ok(ramDiff(brokenNoOp, entries[0]), "vacuous: oracle wrote nothing");
  console.log(`  CAPTURE: ${entries.length} attract states, renderFrogAndArmObjects == oracle`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const e = capture()[0];
  assert.ok(ramDiff(brokenNoOp, e), "the no-op twin escaped");
  assert.ok(ramDiff(brokenWrongBanner, e), "the wrong-banner twin escaped");
  assert.ok(ramDiff(brokenSkipBlit, e), "the skip-blit twin escaped");
  assert.ok(ramDiff(brokenSkipTail, e), "the skip-tail twin escaped");
  console.log("  TEETH: no-op, wrong-banner, skip-blit, skip-tail all caught");
});
