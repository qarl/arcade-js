// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearScreenRegion (ROM 0x19fa-0x1a05) -- blank 16-row screen strips from HL, advancing
// one strip (HL += 0x200) per pass, until the strip base's high byte reaches 0x35. The inner
// m.call(0x14cb) is DISSOLVED into a direct clearScreenStrip(m, 0x10, cur). Input HL (the first strip
// base; its high byte must be odd and below 0x35 so the +2-per-pass walk lands on 0x35). Live-out: the
// cleared cells (RAM) plus HL (end), A (= final high byte, from `mov a,h`) and B (= 0, the djnz counter
// run down inside the last fill). Each side runs on a fresh clone; the contract is RAM (dumpState, minus
// the oracle's transient push/pop scratch) plus the HL/A/B live-outs. Interrupts are disabled so the
// oracle's per-instruction tick cannot fire a handler that writes RAM only on its side.
// Run: node --test games/invaders/idiomatic/test/equivalence-19fa.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19fa as oracleBody } from "../../translated/loc_19fa.js";
import { clearScreenRegion } from "../clearScreenRegion.js";
import { clearScreenStrip } from "../clearScreenStrip.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x19fa;

// End pointer left in HL: advance 0x200 per pass until the high byte is 0x35.
const endHl = (hl) => { let c = hl & 0xffff; do { c = (c + 0x200) & 0xffff; } while (((c >> 8) & 0xff) !== 0x35); return c; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x19fa dispatches -- clearScreenRegion == oracle in RAM (-stack) and HL/A/B", () => {
  for (const cap of CAPS) {
    // The oracle's per-call `push 0x19ff` + loc_14cc's `push b` residue sits just below the ENTRY SP;
    // exclude relative to that SP. The module drops the machine stack entirely.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); clearScreenRegion(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
    assert.equal(c.regs.b, o.regs.b, "B live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: strips clear to 0 up to the terminator row; HL/A/B match; neighbours survive", () => {
  // High byte must be odd and < 0x35 so the +2-per-pass walk lands exactly on 0x35.
  for (const hl of [0x2701, 0x2b01, 0x3301]) {
    const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.regs.hl = hl; o.regs.b = 0x77;
    const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.regs.hl = hl; c.regs.b = 0x77;
    // Poison the region so a wrong fill count / stride shows up, and a sentinel just before the base.
    for (let a = (hl - 1) & 0xffff; a <= 0x35ff; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
    oracle(o); clearScreenRegion(c);
    const tag = `HL=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, endHl(hl), `HL advanced: ${tag}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.regs.a, (endHl(hl) >> 8) & 0xff, `A = final high byte: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
    assert.equal(c.regs.b, 0, `B run down to 0: ${tag}`);
    assert.equal(c.regs.b, o.regs.b, `B matches oracle: ${tag}`);
    // First strip's first and last cell are zeroed; the byte before the base is untouched.
    assert.equal(c.mem.read8(hl), 0x00, `first cell zeroed: ${tag}`);
    assert.equal(c.mem.read8((hl + 0x0f * 0x20) & 0xffff), 0x00, `last cell of first strip zeroed: ${tag}`);
    assert.equal(c.mem.read8((hl - 1) & 0xffff), 0xaa, `sentinel before the base survives: ${tag}`);
    // The terminator strip (base 0x35xx) is NOT cleared -- the loop stops before filling it.
    assert.equal(c.mem.read8(endHl(hl)), 0xaa, `terminator strip base untouched: ${tag}`);
  }
});

test("TEETH: a twin that walks one strip too far (terminator 0x37) diverges in RAM", () => {
  // Module-mutating twin: same dissolved clearScreenStrip loop, wrong terminator row -> clears the
  // 0x35xx strip the real routine stops before.
  function clearScreenStripRun_broken(m, hl = m.regs.hl) {
    let cur = hl;
    do {
      cur = clearScreenStrip(m, 0x10, cur);
    } while (((cur >> 8) & 0xff) !== 0x37); // BUG: 0x37, not 0x35
    return [(m.regs.hl = cur), (m.regs.a = (cur >> 8) & 0xff), (m.regs.b = 0)];
  }
  const hl = 0x2701;
  const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.regs.hl = hl;
  const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.regs.hl = hl;
  for (let a = hl; a <= 0x36ff; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
  oracle(o); clearScreenStripRun_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the diff FAILED to catch the over-clear");
  assert.equal(d.addr, 0x3501, "first divergence is the extra strip the real routine leaves alone");
});
