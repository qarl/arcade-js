// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0x96b7 fetchCoordListEntryByIndex
// also gates: 0x96c4 readCoordListEntry
// Memory-equivalence for fetchCoordListEntryByCounter + fetchCoordListEntryByIndex + readCoordListEntry (ROM 0x96ab-0x96c6) -- three vector-list dispatch
// entries reached via the computed-jmp tables. 0x96ab derives a running value from the $2b counter, 0x96b7
// reloads $2b raw; both stash the incoming Y at $29, combine the value with the delta two entries back
// through the ($2c) pointer, set Y to the result, and read the entry it points to into A. 0x96c4 is the bare
// final (($2c),Y) load. Live-outs: RAM ($29 for the first two) plus A and Y. Each side runs on a clone; the
// contract is RAM (dumpState, minus STACK_SCRATCH) plus A/Y. Leaves: the module omits the ROM ret and the
// seam completes it, so the arms compare RAM (-stack) + regs, NOT pc/SP. No POKEY read.
// Run: node --test games/tempest/idiomatic/test/equivalence-96ab.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_96ab as oracleAb, loc_96b7 as oracleB7, loc_96c4 as oracleC4 } from "../../translated/loc_96ab.js";
import { fetchCoordListEntryByCounter, fetchCoordListEntryByIndex, readCoordListEntry } from "../fetchCoordListEntryByCounter.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_29, loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(addr, oracleFn, K, maxFrames) {
  const caps = [];
  const snap = new Map([[addr, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracleFn(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS_AB = ROM_PRESENT ? captureDispatches(0x96ab, oracleAb, 16, 4000) : [];
const CAPS_B7 = ROM_PRESENT ? captureDispatches(0x96b7, oracleB7, 16, 4000) : [];
const CAPS_C4 = ROM_PRESENT ? captureDispatches(0x96c4, oracleC4, 16, 4000) : [];

// Point ($2c) at a work-RAM table seeded with a known ramp, and set the incoming Y.
const seedCraft = (m, { p2b, y, base = 0x0400 }) => {
  m.mem.write8(COORD_LIST_PTR_LO, base & 0xff);
  m.mem.write8(COORD_LIST_PTR_HI, (base >> 8) & 0xff);
  for (let i = 0; i < 0x100; i++) m.mem.write8((base + i) & 0xffff, i & 0xff);
  if (p2b !== undefined) m.mem.write8(loc_2b, p2b);
  m.regs.y = y;
};

test("CAPTURE: real dispatches -- 0x96ab/96b7/96c4 == oracle in RAM (-stack) and A/Y", () => {
  const arms = [[CAPS_AB, oracleAb, fetchCoordListEntryByCounter], [CAPS_B7, oracleB7, fetchCoordListEntryByIndex], [CAPS_C4, oracleC4, readCoordListEntry]];
  for (const [caps, oracleFn, fn] of arms) {
    for (const cap of caps) {
      const o = cap.clone(), c = cap.clone();
      oracleFn(o); fn(c);
      assert.equal(ramDiff(o, c), null);
      assert.equal(c.regs.a, o.regs.a, "A live-out diverged");
      assert.equal(c.regs.y, o.regs.y, "Y live-out diverged");
    }
  }
  console.log(`  CAPTURE: ${CAPS_AB.length}/${CAPS_B7.length}/${CAPS_C4.length} dispatch(es) checked`);
});

test("CRAFTED: 0x96ab derives from the counter, 0x96b7 reloads it raw, 0x96c4 is the bare load", () => {
  // 0x96ab: counter $2b=0x25 -> ((0x24 & 0x0f)+1)=5; y=0x10 -> stash 0x10, y-2=0x0e -> ramp[0x0e]=0x0e
  //         a = (5 - 0x0e + 0x10) & 0xff = 7 -> y=7 -> A = ramp[7] = 7
  {
    const o = new Machine(ROM, OPTS); seedCraft(o, { p2b: 0x25, y: 0x10 });
    const c = new Machine(ROM, OPTS); seedCraft(c, { p2b: 0x25, y: 0x10 });
    oracleAb(o); const [ra, ry] = fetchCoordListEntryByCounter(c);
    assert.equal(ramDiff(o, c), null, "96ab RAM diverged");
    assert.equal(c.regs.a, o.regs.a, "96ab A diverged");
    assert.equal(c.regs.y, o.regs.y, "96ab Y diverged");
    assert.equal(c.mem.read8(loc_29), 0x10, "96ab stashed incoming Y at $29");
    assert.equal(c.regs.y, 0x07, "96ab derived index");
    assert.equal(ra, o.regs.a, "96ab return[0] == A");
    assert.equal(ry, o.regs.y, "96ab return[1] == Y");
  }
  // 0x96b7: raw $2b=0x25; y=0x10 -> a = (0x25 - ramp[0x0e] + 0x10) & 0xff = (0x25-0x0e+0x10)=0x27 -> y=0x27
  {
    const o = new Machine(ROM, OPTS); seedCraft(o, { p2b: 0x25, y: 0x10 });
    const c = new Machine(ROM, OPTS); seedCraft(c, { p2b: 0x25, y: 0x10 });
    oracleB7(o); fetchCoordListEntryByIndex(c);
    assert.equal(ramDiff(o, c), null, "96b7 RAM diverged");
    assert.equal(c.regs.a, o.regs.a, "96b7 A diverged");
    assert.equal(c.regs.y, o.regs.y, "96b7 Y diverged");
    assert.equal(c.regs.y, 0x27, "96b7 derived index (raw counter)");
  }
  // 0x96c4: bare (($2c),Y) load; y=0x07 -> A = ramp[7] = 7, Y unchanged
  {
    const o = new Machine(ROM, OPTS); seedCraft(o, { y: 0x07 });
    const c = new Machine(ROM, OPTS); seedCraft(c, { y: 0x07 });
    oracleC4(o); const r = readCoordListEntry(c);
    assert.equal(ramDiff(o, c), null, "96c4 RAM diverged");
    assert.equal(c.regs.a, o.regs.a, "96c4 A diverged");
    assert.equal(c.regs.y, 0x07, "96c4 leaves Y untouched");
    assert.equal(c.regs.a, 0x07, "96c4 loaded (($2c),Y)");
    assert.equal(r, o.regs.a, "96c4 return == A");
  }
});

test("TEETH: a twin that skips the (($2c),Y-2) subtraction diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedCraft(o, { p2b: 0x25, y: 0x10 }); oracleAb(o);
  const c = new Machine(ROM, OPTS); seedCraft(c, { p2b: 0x25, y: 0x10 });
  const broken96ab = (m) => {
    const mem = m.mem8, mem16 = m.mem16;
    const yin = m.regs.y;
    mem[loc_29] = yin;
    let a = ((mem[loc_2b] - 1) & 0x0f) + 1;
    a = (a + mem[loc_29]) & 0xff; // BUG: never subtracts the delta two entries back
    m.regs.y = a;
    m.regs.a = mem[(mem16[COORD_LIST_PTR_LO] + a) & 0xffff];
  };
  broken96ab(c);
  const diverged = ramDiff(o, c) !== null || c.regs.a !== o.regs.a || c.regs.y !== o.regs.y;
  assert.equal(diverged, true, "the compare FAILED to catch the skipped subtraction");
});

test("SP-TOOTH: all three omitted-ret entries (moved 0) are seam-placeable", () => {
  for (const [fn, addr] of [[fetchCoordListEntryByCounter, 0x96ab], [fetchCoordListEntryByIndex, 0x96b7], [readCoordListEntry, 0x96c4]]) {
    const m = new Machine(ROM, OPTS); seedCraft(m, { p2b: 0x25, y: 0x10 });
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
    const r = seamPlaceable(withOmittedRet, fn, addr, m);
    assert.equal(r.placeable, true, `0x${addr.toString(16)} must be seam-placeable; got: ${r.error}`);
  }
  console.log("  SP-TOOTH: all three entries placeable");
});
