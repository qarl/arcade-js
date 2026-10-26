// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitVectorWordAtOffset (ROM 0xdf59) -- store {A,X} at ($74/$75)+Y and +(Y+1), then advance the
// ($74/$75) cursor by Y+2 (tail into advanceDisplayCursor). A/X/Y are register-bridge inputs. The oracle m.call(0xdf5f)s
// the translated tail; the idiomatic calls the idiomatic advanceDisplayCursor -- both memory-equivalent, so the contract
// is RAM (dumpState, minus stack scratch below the entry SP). Registers are scratch for this display-builder family (the landed
// advanceDisplayCursor tail preserves none), so no register live-out is asserted. Plain (non-dispatching) caller -- no SP
// tooth. No POKEY read, so the CRAFTED seeds are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-df59.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df59 } from "../../translated/loc_df59.js";
import { emitVectorWordAtOffset } from "../emitVectorWordAtOffset.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf59;
const oracle = atEntry(loc_df59);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function seed(m, s) {
  for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v);
}

// A/X/Y are the register-bridge inputs; the clone carries them.
function diffFrom(cap) {
  const o = cap.clone(), c = cap.clone();
  oracle(o); emitVectorWordAtOffset(c, c.regs.a, c.regs.x, c.regs.y);
  return ramDiff(o, c);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdf59 dispatches -- emitVectorWordAtOffset == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) assert.equal(diffFrom(cap), null);
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: pair stored at Y/Y+1 and cursor advanced by Y+2 == oracle (RAM -stack)", () => {
  // ($74/$75) is the AVG display-list cursor; it points into vector RAM (0x2000-0x2FFF), the only
  // writable region the pair-stores can land in and be diffed. Writes to 0x3000+ are silently
  // discarded by the bus (ROM space), so a pointer outside vector RAM makes the stores invisible.
  const cases = [
    { tag: "y=0: store at ptr+0,+1; advance 2", a: 0x11, x: 0x22, y: 0x00, lo: 0x00, hi: 0x20 },
    { tag: "y=3: store at ptr+3,+4; advance 5", a: 0xab, x: 0xcd, y: 0x03, lo: 0x10, hi: 0x20 },
    { tag: "y=0xff: inc wraps to 0x00, second store at ptr+0", a: 0x7e, x: 0x3c, y: 0xff, lo: 0x00, hi: 0x20 },
    { tag: "carry: $74 near top so Y+2 carries into $75", a: 0x01, x: 0x02, y: 0x10, lo: 0xf0, hi: 0x20 },
  ];
  for (const t of cases) {
    const o = new Machine(ROM, OPTS); seed(o, { [DRAW_CURSOR_LO]: t.lo, [DRAW_CURSOR_HI]: t.hi }); o.regs.a = t.a; o.regs.x = t.x; o.regs.y = t.y;
    const c = new Machine(ROM, OPTS); seed(c, { [DRAW_CURSOR_LO]: t.lo, [DRAW_CURSOR_HI]: t.hi }); c.regs.a = t.a; c.regs.x = t.x; c.regs.y = t.y;
    oracle(o); emitVectorWordAtOffset(c, c.regs.a, c.regs.x, c.regs.y);
    assert.equal(ramDiff(o, c), null, `RAM: ${t.tag}`);
  }
  // Explicit content/advance check.
  const m = new Machine(ROM, OPTS); seed(m, { [DRAW_CURSOR_LO]: 0x10, [DRAW_CURSOR_HI]: 0x20 }); m.regs.a = 0xab; m.regs.x = 0xcd; m.regs.y = 0x03;
  emitVectorWordAtOffset(m, m.regs.a, m.regs.x, m.regs.y);
  assert.equal(m.mem.read8(0x2013), 0xab, "A at ptr+3");
  assert.equal(m.mem.read8(0x2014), 0xcd, "X at ptr+4");
  assert.equal(m.mem.read8(DRAW_CURSOR_LO) | (m.mem.read8(DRAW_CURSOR_HI) << 8), 0x2015, "cursor += Y+2");
});

test("TEETH: a non-default-seed twin that stores X before A (swapped pair) diverges from the oracle", () => {
  // Non-default A != X and Y != 0 so a swap and an off-by-one are both observable.
  const s = { [DRAW_CURSOR_LO]: 0x20, [DRAW_CURSOR_HI]: 0x21 }; // cursor in vector RAM (0x2120) so the stores are diffable
  const A = 0x5a, X = 0xa5, Y = 0x07;
  const o = new Machine(ROM, OPTS); seed(o, s); o.regs.a = A; o.regs.x = X; o.regs.y = Y;
  const c = new Machine(ROM, OPTS); seed(c, s); c.regs.a = A; c.regs.x = X; c.regs.y = Y;
  oracle(o);
  const brokenSwap = (mm, a, x, y) => {
    const ptr = mm.mem16[DRAW_CURSOR_LO];
    const next = (y + 1) & 0xff;
    mm.mem8[(ptr + y) & 0xffff] = x;      // BUG: A and X swapped
    mm.mem8[(ptr + next) & 0xffff] = a;
    mm.mem8[DRAW_CURSOR_LO] = ptr + next + 1;     // low-byte advance (matches on this case)
  };
  brokenSwap(c, A, X, Y);
  assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the swapped pair");
});

test("MUTATION: Y matters -- a twin that ignores Y (stores at ptr+0/+1) diverges when Y != 0", () => {
  const s = { [DRAW_CURSOR_LO]: 0x20, [DRAW_CURSOR_HI]: 0x21 }; // cursor in vector RAM (0x2120) so the stores are diffable
  const A = 0x5a, X = 0xa5, Y = 0x07;
  const o = new Machine(ROM, OPTS); seed(o, s); o.regs.a = A; o.regs.x = X; o.regs.y = Y;
  const c = new Machine(ROM, OPTS); seed(c, s); c.regs.a = A; c.regs.x = X; c.regs.y = Y;
  oracle(o);
  const brokenIgnoreY = (mm, a, x) => {
    const ptr = mm.mem16[DRAW_CURSOR_LO];
    mm.mem8[ptr] = a;                 // BUG: ignores Y offset
    mm.mem8[(ptr + 1) & 0xffff] = x;
    mm.mem8[DRAW_CURSOR_LO] = ptr + 2;
  };
  brokenIgnoreY(c, A, X);
  assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the ignored Y offset");
});
