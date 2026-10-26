// SPDX-License-Identifier: GPL-3.0-only
// The cycle-driven oracle keeps SP where the real ROM does. MAME (write-tap on 0x2000-0x3FFF reading the i8080
// SP) holds SP in 0x23DE-0x2400 over 60 s of attract and over the coin_start_move tape. The vblank ISR's
// 0x0abb arm pops its caller's return at 0x0057 and finishes the ISR itself; an oracle that resumed after that
// call ran the epilogue twice and drifted SP into VRAM. The gameplay frame loop (0x081f..0x0851) must also run
// without growing the JS stack, or the oracle dies a few hundred frames into play.
// Run: node --test games/invaders/test/oracle-stack.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Machine } from "../machine.js";
import { buildRoutines } from "../routines.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROM_PATH = join(HERE, "..", "rom", "maincpu.bin");
const HAVE_ROM = existsSync(ROM_PATH);
const MAME_SP = { lo: 0x23de, hi: 0x2400 };
const FRAMES = 1300;
const TAPE = join(HERE, "..", "tapes", "coin_start_move.json");
const MAME_TAPE_SP = { lo: 0x23e2, hi: 0x2400 };

test("attract: SP stays inside MAME's measured range at every RAM write, with the 0x0abb arm exercised", { skip: !HAVE_ROM }, () => {
  const m = new Machine(new Uint8Array(readFileSync(ROM_PATH)), buildRoutines());
  let lo = 0xffff, hi = 0, abb = 0;
  const write8 = m.mem.write8.bind(m.mem);
  m.mem.write8 = (a, v) => { lo = Math.min(lo, m.regs.sp); hi = Math.max(hi, m.regs.sp); return write8(a, v); };
  const call = m.call.bind(m);
  m.call = (a, ...r) => { if (a === 0x0abb) abb++; return call(a, ...r); };
  m.runFrames(FRAMES);
  assert.ok(abb > 0, "control: the ISR's 0x0abb arm never ran, so this run proves nothing");
  const hx = (v) => "0x" + v.toString(16);
  assert.ok(lo >= MAME_SP.lo && hi <= MAME_SP.hi, `SP ${hx(lo)}..${hx(hi)} left MAME's ${hx(MAME_SP.lo)}..${hx(MAME_SP.hi)}`);
});

test("coin_start_move tape: the gameplay frame loop runs 1500 frames with SP inside MAME's tape range", { skip: !HAVE_ROM }, () => {
  const m = new Machine(new Uint8Array(readFileSync(ROM_PATH)), buildRoutines());
  m.inputTape = JSON.parse(readFileSync(TAPE, "utf8"));
  let lo = 0xffff, hi = 0, loops = 0;
  const write8 = m.mem.write8.bind(m.mem);
  m.mem.write8 = (a, v) => { lo = Math.min(lo, m.regs.sp); hi = Math.max(hi, m.regs.sp); return write8(a, v); };
  const call = m.call.bind(m);
  m.call = (a, ...r) => { if (a === 0x0849) loops++; return call(a, ...r); };
  m.runFrames(1500);
  assert.equal(m.frames.length, 1500, "the oracle stopped early");
  assert.ok(loops > 500, `control: only ${loops} gameplay frame-loop passes, so play barely ran`);
  const hx = (v) => "0x" + v.toString(16);
  assert.ok(lo >= MAME_TAPE_SP.lo && hi <= MAME_TAPE_SP.hi, `SP ${hx(lo)}..${hx(hi)} left MAME's ${hx(MAME_TAPE_SP.lo)}..${hx(MAME_TAPE_SP.hi)}`);
});
