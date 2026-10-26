// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for validateOrResetHighScores (ROM 0x3a1d) -- copy the ROM template into zeropage 0x02..,
// probe the checksum (loc_3a08), and either keep the validated top entry or wipe the table to zero. Live-out
// is RAM only (loc_02.. scratch, loc_1a.. promoted entry, HIGH_SCORE_TABLE.. table, HIGH_SCORE_CONFIG_BYTE config, HIGH_SCORE_CHECKSUM fold
// via loc_3a08). We compare dumpState minus stack scratch below the entry SP; the oracle's balanced push/call/ret scratch lives
// below the entry SP, in that excluded window, while the idiomatic side calls foldHighScoreChecksum without touching the
// stack. Registers are dead (loc_3b04 jmps to 0x200e, which reloads).
// Run: node --test games/centiped/idiomatic/test/equivalence-3a1d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3a1d as oracleRom } from "../../translated/loc_3a1d.js";
import { validateOrResetHighScores } from "../validateOrResetHighScores.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_02, loc_1a, HIGH_SCORE_TABLE, loc_017a, loc_0181, HIGH_SCORE_CONFIG_BYTE, HIGH_SCORE_CHECKSUM, CONFIG_DIP_BYTE } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3a1d;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// The fold loc_3a08 computes over 0x0178..0x01b4 (offsets 0..0x3c), seeded 0xff. Setting HIGH_SCORE_CHECKSUM to this
// value makes the delta zero (checksum "unchanged" -> the validate path is taken).
const foldOf = (m) => {
  let f = 0xff;
  for (let i = 0; i <= 0x3c; i++) f ^= m.mem.read8(HIGH_SCORE_TABLE + i);
  return f & 0xff;
};
// delta == 0 <=> HIGH_SCORE_CHECKSUM already holds the fold; call AFTER all table/config bytes are seeded.
const makeChecksumMatch = (m) => m.mem.write8(HIGH_SCORE_CHECKSUM, foldOf(m));

function seedPair(seedFn) {
  const o = new Machine(ROM), c = new Machine(ROM);
  seedFn(o); seedFn(c);
  return [o, c];
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x3a1d dispatches -- validateOrResetHighScores == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); validateOrResetHighScores(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A valid table: primary entry (0x0178..0x0180) legal packed-BCD & nonzero, secondary (0x0181..0x0189) set,
// config byte unchanged, checksum matching -> the validate/promote path runs and the table is preserved.
const seedValid = (m) => {
  for (let x = 0; x <= 8; x++) m.mem.write8(HIGH_SCORE_TABLE + x, 0x11); // primary: valid BCD, nonzero
  for (let x = 0; x <= 8; x++) m.mem.write8(loc_0181 + x, 0x50 + x); // secondary entry
  m.mem.write8(CONFIG_DIP_BYTE, 0x54);
  m.mem.write8(HIGH_SCORE_CONFIG_BYTE, 0x54); // == CONFIG_DIP_BYTE & 0x7c -> config unchanged
  makeChecksumMatch(m);
};

test("CRAFTED: valid table -- entry validated & promoted into loc_1a.., table preserved", () => {
  const [o, c] = seedPair(seedValid);
  oracle(o); validateOrResetHighScores(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(HIGH_SCORE_TABLE + 0), 0x11, "table NOT zeroed on the valid path");
  assert.equal(c.mem.read8(HIGH_SCORE_CONFIG_BYTE), 0x54, "config snapshot stored");
  assert.equal(c.mem.read8(loc_1a + 2), c.mem.read8(loc_0181 + 2), "secondary entry promoted to loc_1a..");
  assert.equal(c.mem.read8(loc_017a), 0x11, "loc_017a (table+2) intact");
});

test("CRAFTED: checksum mismatch (nonzero delta) forces a zero-fill", () => {
  const [o, c] = seedPair((m) => {
    seedValid(m);
    m.mem.write8(HIGH_SCORE_CHECKSUM, (foldOf(m) ^ 0xff) & 0xff); // break the checksum -> delta != 0
  });
  oracle(o); validateOrResetHighScores(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(HIGH_SCORE_TABLE + 0), 0x00, "table zeroed on checksum mismatch");
  assert.equal(c.mem.read8(HIGH_SCORE_CONFIG_BYTE), 0x54, "config snapshot stored after the wipe");
});

test("CRAFTED: config change stores the new byte and returns without a wipe", () => {
  const [o, c] = seedPair((m) => {
    seedValid(m);
    m.mem.write8(HIGH_SCORE_CONFIG_BYTE, 0x00); // != CONFIG_DIP_BYTE & 0x7c -> config changed
    makeChecksumMatch(m);         // HIGH_SCORE_CONFIG_BYTE is inside the fold range -> re-match so the config-change arm is reached (not the mismatch wipe)
  });
  oracle(o); validateOrResetHighScores(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(HIGH_SCORE_TABLE + 0), 0x11, "table preserved on a config change (no wipe)");
  assert.equal(c.mem.read8(HIGH_SCORE_CONFIG_BYTE), 0x54, "new config byte recorded");
});

test("CRAFTED: an empty entry (loc_017a == 0) forces a zero-fill", () => {
  const [o, c] = seedPair((m) => {
    seedValid(m);
    m.mem.write8(loc_017a, 0x00); // table+2 == 0 -> reset
    makeChecksumMatch(m);         // re-match the fold after mutating the table
  });
  oracle(o); validateOrResetHighScores(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(HIGH_SCORE_TABLE + 0), 0x00, "table zeroed when the entry is empty");
});

test("CRAFTED: an out-of-range BCD byte forces a zero-fill", () => {
  const [o, c] = seedPair((m) => {
    seedValid(m);
    m.mem.write8(HIGH_SCORE_TABLE + 0, 0xa5); // >= 0x9a -> illegal -> reset
    makeChecksumMatch(m);
  });
  oracle(o); validateOrResetHighScores(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(HIGH_SCORE_TABLE + 0), 0x00, "table zeroed on an out-of-range entry");
});

test("TEETH: an off-by-one BCD bound (> instead of >=) diverges from the oracle", () => {
  // Broken twin: accepts a low nibble of exactly 0x0a, which the oracle rejects (bcs is >=). On a table
  // whose only flaw is a 0x0a byte, the oracle wipes and the twin keeps it -> the RAM diff must fire.
  function validate_broken(m) {
    const { mem8 } = m;
    const HIGHSCORE_INIT_TABLE = 0x3a69;
    for (let x = 0x2f; x >= 0; x--) mem8[loc_02 + x] = m.mem8[HIGHSCORE_INIT_TABLE + x];
    // inline foldHighScoreChecksum so the twin is self-contained
    let acc = 0xff;
    for (let i = 0x3c; i >= 0; i--) acc = (acc ^ mem8[HIGH_SCORE_TABLE + i]) & 0xff;
    const oldChecksum = mem8[HIGH_SCORE_CHECKSUM];
    mem8[HIGH_SCORE_CHECKSUM] = acc;
    if (((oldChecksum ^ acc) & 0xff) !== 0) return zeroFill(mem8);
    const cfg = mem8[CONFIG_DIP_BYTE] & 0x7c;
    const changed = cfg !== mem8[HIGH_SCORE_CONFIG_BYTE];
    mem8[HIGH_SCORE_CONFIG_BYTE] = cfg;
    if (changed) return;
    if (mem8[loc_017a] === 0) return zeroFill(mem8);
    for (let x = 0x08; x >= 0; x--) {
      const v = mem8[HIGH_SCORE_TABLE + x];
      mem8[loc_02 + x] = v;
      if (v >= 0x9a) return zeroFill(mem8);
      if ((v & 0x0f) > 0x0a) return zeroFill(mem8); // BUG: should be >=
      mem8[loc_1a + x] = mem8[loc_0181 + x];
    }
  }
  function zeroFill(mem8) {
    for (let x = 0x3e; x >= 0; x--) mem8[HIGH_SCORE_TABLE + x] = 0x00;
    mem8[HIGH_SCORE_CONFIG_BYTE] = mem8[CONFIG_DIP_BYTE] & 0x7c;
  }
  const [o, c] = seedPair((m) => {
    seedValid(m);
    m.mem.write8(HIGH_SCORE_TABLE + 0, 0x0a); // low nibble exactly 0x0a: oracle rejects, buggy twin accepts
    makeChecksumMatch(m);
  });
  oracle(o); validate_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the off-by-one BCD bound");
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + 0), 0x00, "oracle wiped the table");
  assert.notEqual(c.mem.read8(HIGH_SCORE_TABLE + 0), 0x00, "buggy twin kept the illegal entry");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write16(0x01fe, 0x3b46); // a real caller-return word (loc_3b04 push16 0x3b46) for the seam
  const r = seamPlaceable(withOmittedRet, validateOrResetHighScores, TARGET, m);
  assert.equal(r.placeable, true, `validateOrResetHighScores must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
