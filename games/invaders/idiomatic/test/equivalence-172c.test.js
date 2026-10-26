// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for updatePlayerShotSound (ROM 0x172c) -- mode-gated sound step. Reads PLAYER_SHOT_STATUS: nonzero ->
// startSound(B=0x02) (OR the sound bit into SOUND_PORT3_SHADOW), zero -> clearSoundPort3Bit(B=0xfd) (mask the
// shot bit off). Both callees are dissolved direct calls. Live-out: memory (SOUND_PORT3_SHADOW) + A.
// Run: node --test games/invaders/idiomatic/test/equivalence-172c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_172c as oracleBody } from "../../translated/loc_172c.js";
import { updatePlayerShotSound } from "../updatePlayerShotSound.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { PLAYER_SHOT_STATUS, SOUND_PORT3_SHADOW } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x172c;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x172c dispatches -- updatePlayerShotSound == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); updatePlayerShotSound(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: mode nonzero raises the sound bit, zero masks the shot bit", () => {
  // {mode, shadow} covering both branches for several shadow bytes.
  const cases = [
    { mode: 0x02, shadow: 0x00 }, // players -> startSound(0x02): shadow | 0x02
    { mode: 0x01, shadow: 0x30 }, // any nonzero -> startSound(0x02)
    { mode: 0xff, shadow: 0x0d },
    { mode: 0x00, shadow: 0xff }, // no players -> clearSoundPort3Bit(0xfd): shadow & 0xfd
    { mode: 0x00, shadow: 0x02 },
    { mode: 0x00, shadow: 0xa7 },
  ];
  for (const { mode, shadow } of cases) {
    const seed = (m) => { m.regs.sp = 0x2400; m.mem.write8(PLAYER_SHOT_STATUS, mode); m.mem.write8(SOUND_PORT3_SHADOW, shadow); };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); updatePlayerShotSound(c);
    const tag = `mode=0x${mode.toString(16)} shadow=0x${shadow.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    const want = mode !== 0 ? (shadow | 0x02) : (shadow & 0xfd);
    assert.equal(c.mem.read8(SOUND_PORT3_SHADOW), want, `shadow ${tag}`);
    assert.equal(c.regs.a, want, `A ${tag}`);
  }
});

test("TEETH: a broken twin that swaps the branch masks diverges in RAM", () => {
  // Full-strength mutant: takes the wrong callee on each branch.
  function updatePlayerShotSound_broken(m) {
    if (m.mem8[PLAYER_SHOT_STATUS] !== 0) { const v = m.mem.read8(SOUND_PORT3_SHADOW) & 0xfd; m.mem.write8(SOUND_PORT3_SHADOW, v); return (m.regs.a = v); }
    const v = m.mem.read8(SOUND_PORT3_SHADOW) | 0x02; m.mem.write8(SOUND_PORT3_SHADOW, v); return (m.regs.a = v);
  }
  const seed = (m) => { m.regs.sp = 0x2400; m.mem.write8(PLAYER_SHOT_STATUS, 0x01); m.mem.write8(SOUND_PORT3_SHADOW, 0x00); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  updatePlayerShotSound_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a swapped branch mask");
  assert.equal(d.addr, SOUND_PORT3_SHADOW & 0xffff);
});
