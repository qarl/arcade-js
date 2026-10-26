// SPDX-License-Identifier: GPL-3.0-only
/**
 * equivalence-0ff1 — crafted-entry gate: renderFrogAnimTileColumns vs the frozen render-loop oracle. Both
 * sides run one render invocation with the anim index seeded so the index-advance wraps WITHOUT recursing,
 * isolating a single loop's memory effect; an equal RAM diff (stack scratch masked) proves candidate and
 * oracle agree. Teeth: a no-op twin and a twin that suppresses the sprite store (both must diff). Positive
 * control: the render actually writes VRAM.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft } from "./_frogHop.js";
import { STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { renderFrogAnimTileColumns as cand } from "../renderFrogAnimTileColumns.js";
import { loc_0ff1 as oracle } from "../../translated/loc_0fd4.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ANIM_INDEX = 0x8000, PLOT_SUPPRESS = 0x825b, ROW_ADVANCE = 0x81b1, SRC_PTR = 0x8001, ROW_COUNT = 0x8003;
const DEST = 0xa843, SOURCE = 0x1403, SPR = 0x8100;
const ROWS = 3, COLS = 5, ADVANCE = 8;

// A fresh entry clone with the render-loop register interface armed exactly as an arm hands it over.
function seeded(suppress = 0) {
  return craft((mem, c) => {
    mem[ANIM_INDEX] = 0x0a; // advance wraps (0x0a -> 0x0b -> 0), no recursion into a further arm
    mem[PLOT_SUPPRESS] = suppress; // 0 => the (IX+1) sprite store runs
    mem[ROW_ADVANCE] = ADVANCE; // (0x81b1) row-advance the loop rereads between columns
    mem[SRC_PTR] = SOURCE & 0xff;
    mem[SRC_PTR + 1] = (SOURCE >> 8) & 0xff; // (0x8001) source reload
    mem[ROW_COUNT] = ROWS; // (0x8003) row-count reload
    c.regs.b = ROWS;
    c.regs.c = COLS;
    c.regs.hl = DEST;
    c.regs.de = SOURCE;
    c.regs.ix = SPR;
    c.regs.iy = SPR;
    c.regs.f = c.regs.f & 0xfe; // carry clear => first column's borrow is 0
  });
}

function diff(entry, candFn = cand) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const a = entry.clone(); oracle(a);
  const b = entry.clone(); candFn(b);
  const A = a.dumpState(), B = b.dumpState();
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (A[i] === B[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return `0x${addr.toString(16)}: ${A[i]} vs ${B[i]}`;
  }
  return null;
}

test("EQUAL (crafted): renderFrogAnimTileColumns == oracle, plotting enabled", { skip }, () => {
  assert.equal(diff(seeded(0)), null, "render loop diverged (plot enabled)");
});

test("EQUAL (crafted): renderFrogAnimTileColumns == oracle, plotting suppressed", { skip }, () => {
  assert.equal(diff(seeded(1)), null, "render loop diverged (plot suppressed)");
});

test("POSITIVE CONTROL: the render writes VRAM (EQUAL is not vacuous)", { skip }, () => {
  const e = seeded(0);
  const before = e.clone().dumpState();
  const after = e.clone(); oracle(after);
  const A = after.dumpState();
  let wrote = false;
  for (let i = 0; i < Math.min(before.length, A.length); i++) {
    const addr = after.stateOffsetToAddr(i);
    if (addr >= DEST && addr < DEST + 0x200 && before[i] !== A[i]) { wrote = true; break; }
  }
  assert.ok(wrote, "vacuous: the render wrote no VRAM in [DEST, DEST+0x200)");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const skipSpriteStore = (mm) => { mm.mem8[PLOT_SUPPRESS] = 1; return cand(mm); }; // omits the (IX+1) store
  assert.ok(diff(seeded(0), noOp), "no-op twin escaped");
  assert.ok(diff(seeded(0), skipSpriteStore), "suppressed-store twin escaped the plot-enabled oracle");
});
