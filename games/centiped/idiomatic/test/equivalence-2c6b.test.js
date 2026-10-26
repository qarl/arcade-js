// SPDX-License-Identifier: GPL-3.0-only
// Memory+carry equivalence for detectColumnCollision (ROM 0x2c6b) -- scans slots Y=0x0c..0 for a live
// object sharing object X's column (loc_64) within a row band, reporting the answer in carry. The
// callers (0x22e4/0x29fe) BCC on that carry, so the carry is a LIVE-OUT the RAM diff cannot see; every
// arm asserts BOTH the RAM diff (-stack, only loc_8b/loc_8c are written) AND the carry. It is a leaf
// (omits the ROM ret; the seam completes it).
// Run: node --test games/centiped/idiomatic/test/equivalence-2c6b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c6b as oracleRom } from "../../translated/loc_2c6b.js";
import { detectColumnCollision } from "../detectColumnCollision.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { u8 } from "../../../../core/int.js";
import { loc_34, loc_44, loc_54, loc_64, loc_8b, loc_8c } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2c6b;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// Seed a fresh machine and run one seed(m) over it; SP left at the reset default (page-1 stack scratch,
// which the diff excludes) since the routine is a leaf.
function make(seed) {
  const m = new Machine(ROM);
  m.push16(0x1233); // a real caller-return word (the oracle's ret pops it; compared as the entry frame)
  seed(m);
  return m;
}

test("CAPTURE: real 0x2c6b dispatches -- detectColumnCollision == oracle in RAM (-stack) and carry", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); detectColumnCollision(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(o.regs.fC, c.regs.fC, "carry (collision) must match the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: each branch leaves identical RAM (-stack) and identical carry", () => {
  const cases = [
    {
      tag: "collision found on slot 0x0c -> carry SET",
      x: 0x01,
      carry: true,
      seed: (m) => {
        m.mem.write8(loc_64 + 0x0c, 0x50); // loc_64,Y(0x0c) column
        m.mem.write8(loc_64 + 0x01, 0x50); // loc_64,X(1) column -> equal
        m.mem.write8(loc_34 + 0x0c, 0x10); // loc_34,Y < 0xf4 -> active
        m.mem.write8(loc_54 + 0x01, 0x30); // loc_54,X
        m.mem.write8(loc_54 + 0x0c, 0x20); // loc_54,Y -> delta 0x10
        m.mem.write8(loc_44 + 0x01, 0xe5); // loc_44,X -> 0x10 ^ 0xe5 = 0xf5 >= 0xf4
      },
    },
    {
      tag: "no candidate matches (all-zero) -> carry CLEAR",
      x: 0x00,
      carry: false,
      seed: () => {}, // every slot shares column 0 and is active, but the row delta is 0 (< 0xf4)
    },
    {
      tag: "the only column-mate is INACTIVE (loc_34,Y >= 0xf4) -> carry CLEAR",
      x: 0x01,
      carry: false,
      seed: (m) => {
        m.mem.write8(loc_64 + 0x0c, 0x50);
        m.mem.write8(loc_64 + 0x01, 0x50);
        m.mem.write8(loc_34 + 0x0c, 0xff); // retired -> the active guard skips it
        m.mem.write8(loc_54 + 0x01, 0x30);
        m.mem.write8(loc_54 + 0x0c, 0x20);
        m.mem.write8(loc_44 + 0x01, 0xe5); // would collide were it active
      },
    },
    {
      tag: "the only column-mate is object X's OWN slot -> carry CLEAR",
      x: 0x05,
      carry: false,
      seed: (m) => {
        // X=5 is itself in Y's scan range (0..0x0c). Give slot 5 a self-collision setup; the self-skip
        // (Y == loc_8b) must reject it, and no other slot shares the column.
        m.mem.write8(loc_64 + 0x05, 0x77);
        m.mem.write8(loc_34 + 0x05, 0x10); // active
        m.mem.write8(loc_54 + 0x05, 0x00);
        m.mem.write8(loc_44 + 0x05, 0xf6); // 0x00 ^ 0xf6 = 0xf6 >= 0xf4 (would self-collide)
      },
    },
  ];
  for (const { tag, x, carry, seed } of cases) {
    const o = make((m) => { m.regs.x = x; seed(m); });
    const c = make((m) => { m.regs.x = x; seed(m); });
    oracle(o); detectColumnCollision(c);
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(o.regs.fC, c.regs.fC, `${tag}: oracle vs idiomatic carry`);
    assert.equal(c.regs.fC, carry, `${tag}: expected carry`);
    assert.equal(c.mem.read8(loc_8b), u8(x), `${tag}: loc_8b = X`);
    assert.equal(c.mem.read8(loc_8c), u8(x + 1), `${tag}: loc_8c = X+1`);
  }
});

test("TEETH: a twin that drops the active guard reports a phantom collision (carry diverges)", () => {
  // Broken twin: the real scan minus the `loc_34,Y >= 0xf4` inactive guard.
  function detectColumnCollision_noActiveGuard(m, x = m.regs.x) {
    const { mem8 } = m;
    mem8[loc_8b] = x;
    mem8[loc_8c] = u8(x + 1);
    const columnX = mem8[(loc_64 + x) & 0xff];
    const rowFineX = mem8[(loc_54 + x) & 0xff];
    const deltaKeyX = mem8[(loc_44 + x) & 0xff];
    let found = false;
    for (let y = 0x0c; y >= 0; y--) {
      if (mem8[(loc_64 + y) & 0xffff] !== columnX) continue;
      // BUG: no `if (mem8[(loc_34 + y) & 0xffff] >= 0xf4) continue;`
      if (y === mem8[loc_8b]) continue;
      const rowDelta = u8(rowFineX - mem8[(loc_54 + y) & 0xffff]) ^ deltaKeyX;
      if (rowDelta >= 0xf4) { found = true; break; }
    }
    return (m.regs.fC = found);
  }
  // A column-mate that WOULD collide but is retired: real => clear, broken => set.
  const seed = (m) => {
    m.regs.x = 0x01;
    m.mem.write8(loc_64 + 0x0c, 0x50);
    m.mem.write8(loc_64 + 0x01, 0x50);
    m.mem.write8(loc_34 + 0x0c, 0xff);
    m.mem.write8(loc_54 + 0x01, 0x30);
    m.mem.write8(loc_54 + 0x0c, 0x20);
    m.mem.write8(loc_44 + 0x01, 0xe5);
  };
  const o = make(seed); const c = make(seed);
  oracle(o); detectColumnCollision_noActiveGuard(c);
  assert.notEqual(o.regs.fC, c.regs.fC, "the carry check FAILED to catch the dropped active guard");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  // A leaf with no stack work: the seam completes the ret (SP unmoved). No path is a +2 tail-dispatch.
  const m = make((mm) => { mm.regs.x = 0x00; }); // all-zero -> no collision, still exercises the scan
  const r = seamPlaceable(withOmittedRet, detectColumnCollision, TARGET, m);
  assert.equal(r.placeable, true, `detectColumnCollision must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
