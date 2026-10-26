// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for decrementShipsAndDrawReadout -- read the active player's ships count (DISSOLVED into
// readActivePlayerPageTopByte); when nonzero, write the reserve count (ships-1) back to that page cell,
// paint the reserve-ship icon row (DISSOLVED into drawReserveLifeIcons, entry Z = reserve==0), then plot
// the lives digit for the full count (DISSOLVED into drawLivesDigit). When the count is zero the routine
// bails untouched. Live-out is RAM only -- every caller reseats HL/A/flags, so no register is compared.
// The oracle push/pops PSW and delegates through call chains, so its stack residue sits below the entry
// SP and is excluded from the RAM diff. Each side runs on a fresh clone, interrupts off.
// Run: node --test games/invaders/idiomatic/test/equivalence-1a7f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a7f as oracleBody } from "../../translated/loc_1a7f.js";
import { decrementShipsAndDrawReadout } from "../decrementShipsAndDrawReadout.js";
import { readActivePlayerPageTopByte } from "../readActivePlayerPageTopByte.js";
import { drawReserveLifeIcons } from "../drawReserveLifeIcons.js";
import { drawLivesDigit } from "../drawLivesDigit.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1a7f;
const PAGE = 0x21;               // active-player page byte -> ships cell at 0x21ff
const SHIPS_CELL = (PAGE << 8) | 0xff;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1a7f dispatches -- decrementShipsAndDrawReadout == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's push psw + call-chain return-addr residue sits just below the ENTRY SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); decrementShipsAndDrawReadout(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: zero bails; nonzero stores ships-1 at the page cell, paints reserves, plots the digit", () => {
  for (const ships of [0x00, 0x01, 0x03, 0x06]) {
    const seed = (m) => {
      m.regs.sp = 0x2400;
      m.mem.write8(ACTIVE_PLAYER_PAGE, PAGE);
      m.mem.write8(SHIPS_CELL, ships);
    };
    const o = new Machine(ROM); seed(o); o.io.setInte(false);
    const c = new Machine(ROM); seed(c); c.io.setInte(false);
    oracle(o); decrementShipsAndDrawReadout(c);
    const tag = `ships=0x${ships.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    if (ships === 0) {
      assert.equal(c.mem.read8(SHIPS_CELL), 0, `zero count untouched: ${tag}`);
    } else {
      assert.equal(c.mem.read8(SHIPS_CELL), ships - 1, `reserve count stored: ${tag}`);
    }
  }
  // ships=3 -> reserve=2: first reserve column painted (0x2701 + row 8), lives digit '3' at 0x2501.
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.io.setInte(false);
  c.mem.write8(ACTIVE_PLAYER_PAGE, PAGE); c.mem.write8(SHIPS_CELL, 0x03);
  decrementShipsAndDrawReadout(c);
  assert.equal(c.mem.read8(0x2801), 0xff, "first reserve-ship column painted");
  let drew = 0;
  for (let i = 0; i < 8; i++) drew |= c.mem.read8(0x2501 + i * 0x20);
  assert.notEqual(drew, 0, "lives digit plotted");
});

test("TEETH: a module-mutating twin (stores/draws the full count, not ships-1) diverges in RAM", () => {
  // Broken twin: uses the full ships count instead of ships-1 for the stored reserve and the icon run.
  function loc_1a7f_broken(m) {
    const [hl, a] = readActivePlayerPageTopByte(m);
    if (a === 0) return;
    m.mem8[hl] = a;                          // BUG: should be ships-1
    drawReserveLifeIcons(m, a, a === 0);     // BUG: count/Z should be ships-1
    return drawLivesDigit(m, a);
  }
  const seed = (m) => {
    m.regs.sp = 0x2400;
    m.mem.write8(ACTIVE_PLAYER_PAGE, PAGE);
    m.mem.write8(SHIPS_CELL, 0x03);
  };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); loc_1a7f_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the off-by-one reserve count");
  assert.equal(d.addr, SHIPS_CELL & 0xffff, "first divergence is the stored reserve count");
});
