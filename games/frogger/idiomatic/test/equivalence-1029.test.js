// SPDX-License-Identifier: GPL-3.0-only
/**
 * equivalence-1029 — capture-clone-replay gate: advanceFrogAnimIndexAndRedispatch vs the frozen oracle
 * loc_1029. A 0x1029 hook clones every REAL dispatch over attract (none occur there) and one real oracle
 * cascade (loc_0942's anim path from index 0, on the crafted state equivalence-0942 uses), which reaches
 * 0x1029 at the tail of every arm, index 0..10. Index <10 replays the re-dispatch arm (the rest of the
 * cascade runs on both sides); index 10 is the wrap arm. Bounded by the cascade itself: it ends at the
 * wrap. Live-out memory-only (0x09a6 does xor a then falls into 0x09aa, which loads HL; 0x2338 loads A and
 * returns to 0x0356, which reloads A and HL); RAM diffed, stack masked.
 * Teeth: arm count 10 (arm 10's block poked so it must draw), arm count 12, no zero on wrap, no-op.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, isStackScratch } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { advanceFrogAnimIndexAndRedispatch as cand } from "../advanceFrogAnimIndexAndRedispatch.js";
import { dispatchFrogAnimationArm } from "../dispatchFrogAnimationArm.js";
import { loc_1029 as oracle } from "../../translated/loc_0fd4.js";
import { loc_0942 } from "../../translated/loc_0942.js";
import { firstStateDiff } from "../../../../core/equivalence.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const ANIM_INDEX = 0x8000, STRIDE = 0x81b1, ARM10_BLOCK = 0x828e;

let corpus = null;
function captures() {
  if (corpus) return corpus;
  const caps = [];
  let capturing = true, seed = null;
  const real1029 = TRANSLATED.get(0x1029), real0b1f = TRANSLATED.get(0x0b1f);
  const m = makeMachine(new Map([
    [0x0b1f, (mm) => { if (!seed) seed = mm.clone(); return real0b1f(mm); }],
    [0x1029, (mm) => { if (capturing) caps.push(mm.clone()); return real1029(mm); }],
  ]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `capture run stopped early: ${m.stoppedBy}`);
  assert.ok(seed, "vacuous: the seed neighbour 0x0b1f never dispatched");
  const natural = caps.length;
  const top = seed.clone();
  top.regs.hl = 0x8044; top.regs.de = 0x8047; // frog cursors, as _frogHop craft() arms them
  for (const [a, v] of [[0x83fe, 1], [0x83fd, 1], [0x83cd, 0], [0x825a, 1], [0x826c, 0], [ANIM_INDEX, 0]]) top.mem8[a] = v;
  loc_0942(top); // real oracle anim path: every arm tail dispatches 0x1029 through the hook
  capturing = false; // replays below pass through the hook untouched
  corpus = { caps, natural };
  return corpus;
}

const byIndex = (k) => captures().caps.find((c) => c.mem8[ANIM_INDEX] === k);

// null == RAM-equivalent (stack scratch masked). A throwing twin is still diffed on the state it left.
function diff(entry, candFn = cand) {
  const a = entry.clone(); oracle(a);
  const b = entry.clone();
  let threw = "";
  try { candFn(b); } catch (e) { threw = ` (candidate threw: ${e.message})`; }
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), isStackScratch);
  if (d) return `0x${(d.addr ?? 0).toString(16)}: ${d.a} vs ${d.b}${threw}`;
  return threw || null;
}

// Twins: the ROM shape with one defect each.
const withCount = (n) => (m) => {
  const i = (m.mem8[ANIM_INDEX] + 1) & 0xff;
  m.mem8[ANIM_INDEX] = i;
  if (i < n) return dispatchFrogAnimationArm(m);
  m.mem8[ANIM_INDEX] = 0;
};
const noZero = (m) => {
  const i = (m.mem8[ANIM_INDEX] + 1) & 0xff;
  m.mem8[ANIM_INDEX] = i;
  if (i < 0x0b) return dispatchFrogAnimationArm(m);
};

test("POSITIVE CONTROL: real dispatches of 0x1029 cover both arms", { skip }, () => {
  const { caps, natural } = captures();
  const seen = [...new Set(caps.map((c) => c.mem8[ANIM_INDEX]))].sort((x, y) => x - y);
  console.log(`  captured: ${caps.length} dispatches (${natural} from attract), indices ${seen.join(",")}`);
  for (let k = 0; k <= 10; k++) assert.ok(byIndex(k), `the cascade never dispatched 0x1029 at index ${k}`);
});

test("EQUAL (captured): advanceFrogAnimIndexAndRedispatch == oracle at every real dispatch", { skip }, () => {
  for (const e of captures().caps) {
    assert.equal(diff(e), null, `diverged at captured index ${e.mem8[ANIM_INDEX]}`);
  }
  const w = byIndex(10).clone(); oracle(w);
  assert.equal(w.mem8[ANIM_INDEX], 0, "vacuous: the wrap arm did not zero the index");
});

test("TEETH: broken twins are caught", { skip }, () => {
  // Index 9: the oracle re-dispatches arm 10; poke arm 10's block (both sides) so it stamps a new stride.
  const at9 = byIndex(9).clone();
  const stride = at9.mem8[STRIDE] === 0x11 ? 0x12 : 0x11;
  at9.mem8[ARM10_BLOCK] = stride; at9.mem8[ARM10_BLOCK + 1] = 3; at9.mem8[ARM10_BLOCK + 2] = 5;
  assert.equal(diff(at9), null, "poked index-9 entry diverged");
  assert.ok(diff(at9, withCount(10)), "arm-count-10 twin escaped");
  const at10 = byIndex(10);
  assert.ok(diff(at10, withCount(12)), "arm-count-12 twin escaped");
  assert.ok(diff(at10, noZero), "no-zero-on-wrap twin escaped");
  assert.ok(diff(at10, () => {}), "no-op twin escaped");
  console.log(`  TEETH: count10 ${diff(at9, withCount(10))}; count12 ${diff(at10, withCount(12))}; noZero ${diff(at10, noZero)}`);
});
