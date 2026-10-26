// SPDX-License-Identifier: GPL-3.0-only
//
// idiomatic — pooyan's generator seam gate. Runs the assembled game under the cycle-free coroutine
// engine (core/frame-stepped.js runIdiomaticGame, wired via resolveAllIdiomatic — the same override
// map web/worker.js ships) and compares it, frame for frame, against the pure-translated oracle run
// under runCycleFree at the SAME frame boundary (the worker/ring-idle point 0x021c, manifest.convergence).
// Both engines drain the display command ring within a frame and fire the vblank NMI once per worker
// iteration (as MAME does), so they agree on every LIVE cell — only stack scratch below the frame-boundary SP is excluded.
// ROM-guarded (skips without the BYO ROM).
//
// SCOPE: resolveAllIdiomatic wires the spine (mainLoop) AND the memory-only bare-dispatch leaves, so
// this exercises the translated->idiomatic SEAM — a frozen translated caller emits push16(RET) before
// its m.call and the idiomatic callee models the Z80 ret as a JS return. Beyond the oracle
// equivalence, it asserts SP stays inert — the register-free idiomatic layer never touches the guest
// stack (the vblank NMI is a direct JS call, not a Z80 push/seam) so SP never moves across a yield —
// and that the NMI subtree is stack-neutral on its own — the
// checks that catch a seam that leaks or over-pops a return word (dkong shipped a 12-14 byte/frame
// leak no per-routine gate saw). The register/flag-live-out leaves stay UNWIRED pending the
// return-assignment bridge (increment 2). COVERAGE IS ATTRACT ONLY: a leaf reached only in play (and
// clearBit2AcrossSixSlots 0x0e46, which has no static caller at all) is not exercised here — those
// seams need a coin/start/play tape (see registry-coverage.config.mjs + manifest.convergence).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runIdiomaticGame, runCycleFree } from "../../../../core/frame-stepped.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { Machine, resolveAllIdiomatic } from "../../machine.js";
import manifest from "../../manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROM_PATH = join(HERE, "..", "..", "rom", "maincpu.bin");
const HAVE_ROM = existsSync(ROM_PATH);
const ROM = HAVE_ROM ? new Uint8Array(readFileSync(ROM_PATH)) : null;

const FRAMES = 900;
const { pollPCs, stateExclude, idiomatic } = manifest.convergence;
const { nmiReturnPC } = idiomatic;
const [STACK_LO, STACK_HI] = stateExclude.stack; // stack scratch; only the part below the live SP is excluded
const hex = (v) => `0x${(v & 0xffff).toString(16).padStart(4, "0")}`;
const brief = (xs) => (xs.length <= 6 ? xs.join("; ") : `${xs.slice(0, 6).join("; ")} … (${xs.length} in all)`);

/** Byte offsets of the LIVE state cells — everything but stack scratch below the frame-boundary SP. */
function liveOffsets(bytesPerFrame, probe, liveFloor) {
  const dead = deadStackBelow({ lo: STACK_LO, hi: STACK_HI }, liveFloor);
  const keep = [];
  for (let o = 0; o < bytesPerFrame; o++) if (!dead(probe.stateOffsetToAddr(o))) keep.push(o);
  return keep;
}

test("the generator layer reproduces the oracle and keeps the guest stack balanced", { skip: !HAVE_ROM }, async () => {
  // Wire the whole idiomatic layer exactly as the worker does. resolveAllIdiomatic() reads
  // idiomatic/names.js ROUTINES (mainLoop + the wired leaves); machine.call(0x0000) runs the frozen
  // translated boot, whose tail call into the main loop returns the mainLoop GENERATOR, which
  // runIdiomaticGame drives frame by frame, dispatching each wired leaf through the seam.
  const overrides = await resolveAllIdiomatic();
  assert.ok(overrides.has(0x020f), "mainLoop must be wired at the main-loop entry");
  assert.ok(overrides.size > 1, "expected the leaf overrides wired alongside the spine");

  const mi = new Machine(ROM, { overrides });

  // The vblank NMI subtree must be stack-neutral on its own — localises a leak to the NMI chain
  // instead of only showing up as a frame-boundary delta.
  const nmiFaults = [];
  const realFire = mi.fireNmi.bind(mi);
  mi.fireNmi = function () {
    const before = mi.regs.sp;
    realFire();
    if (mi.regs.sp !== before) nmiFaults.push(`${hex(before)} -> ${hex(mi.regs.sp)}`);
  };

  const idi = [];
  let prevSp = null;
  const spFaults = [];
  const ri = runIdiomaticGame(mi, {
    bootAddr: 0x0000,
    nmiReturnPC,
    maxFrames: FRAMES,
    onFrame: (m, f) => {
      if (f === 0) return; // power-on sample, taken before the boot generator runs
      idi.push(Buffer.from(m.dumpState()));
      const sp = m.regs.sp;
      // The main-loop yield is a fixed point of the guest's stack discipline (the oracle holds SP
      // constant there), so an unbalanced push/pop anywhere in the frame — a seam that leaks or
      // over-pops a return word — shows as a non-zero delta on the first frame it happens.
      if (prevSp !== null && sp !== prevSp) spFaults.push(`frame ${f}: ${hex(prevSp)} -> ${hex(sp)}`);
      prevSp = sp;
    },
  });
  assert.equal(ri.stopError, null, `idiomatic run errored: ${ri.stop}`);
  assert.ok(ri.frames >= FRAMES, `idiomatic run covered only ${ri.frames}/${FRAMES} frames (${ri.stop})`);
  assert.equal(
    spFaults.length, 0,
    "SP moved across a frame boundary — the register-free idiomatic layer must never touch the guest " +
      `stack (a reintroduced unbalanced push/pop would show here): ${brief(spFaults)}`,
  );
  assert.equal(nmiFaults.length, 0, `the vblank NMI subtree changed SP: ${brief(nmiFaults)}`);

  // The pure-translated oracle under runCycleFree, sampled at the same main-loop top.
  const mt = new Machine(ROM, {});
  const tr = [];
  const trSp = [];
  const rt = runCycleFree(mt, {
    pollPCs, maxFrames: FRAMES, stepBudget: FRAMES * 200000,
    onFrame: (m, f) => { if (f !== 0) { tr.push(Buffer.from(m.dumpState())); trSp.push(m.regs.sp); } },
  });
  assert.equal(rt.stopError, null, `translated oracle run errored: ${rt.stop}`);
  assert.equal(idi.length, tr.length, "frame counts differ between the wired layer and the oracle");

  // Every LIVE cell must match byte-for-byte (both engines run the identical collapsed sequence, so
  // no entropy pin is needed), excluding only stack scratch below the oracle's frame-boundary SP (the
  // idiomatic engine never models the guest stack, so its SP stays 0 and is no floor).
  const keeps = new Map();
  for (let i = 0; i < idi.length; i++) {
    const floor = trSp[i];
    if (!keeps.has(floor)) keeps.set(floor, liveOffsets(tr[0].length, mt, floor));
    const keep = keeps.get(floor);
    assert.ok(keep.length > 0, "no live-state bytes selected to compare");
    for (const o of keep) {
      if (idi[i][o] !== tr[i][o]) {
        assert.fail(
          `frame ${i}: wired layer diverged from oracle at ${hex(mt.stateOffsetToAddr(o))} ` +
            `(idiomatic ${idi[i][o]} vs oracle ${tr[i][o]})`,
        );
      }
    }
  }
});
