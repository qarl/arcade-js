// SPDX-License-Identifier: GPL-3.0-only
//
// games-boot — WEB-INTEGRATION smoke gate. Node gates + the §5 done-audit exercise the idiomatic layer
// directly; none construct the board `Inputs` or boot the worker loop, so a game can pass every gate and be
// UNPLAYABLE (invaders: no `Inputs` export; galaxian: input ports as hw addresses -> crash-loop; gfx1 key ->
// black screen; synth 404 -> silent). This replays web/worker.js's boot in node: worker-form construction +
// per-frame input keyed by the manifest port VALUES + sound tap armed, then asserts no throw, frames advance,
// a rendered frame is non-uniform, and an audio game drives the tap. ROM-guarded. Gates must mean "runs".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runIdiomaticGame, runIdiomaticIrqGame } from "../../core/frame-stepped.js";
import { buildGameMachine } from "../machine-factory.js";
import { GAMES } from "../../games/registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FRAMES = 400; // boot through attract into the main loop -- catches boot + early-run throws

for (const gameId of GAMES) {
  const manifest = (await import(`../../games/${gameId}/manifest.js`)).default;
  const names = Object.keys(manifest.rom.images);
  const romPath = (n) => join(ROOT, "games", gameId, "rom", `${n}.bin`);
  const haveRom = names.every((n) => existsSync(romPath(n)));

  // A §2 skeleton has no idiomatic engine entry yet (the worker itself refuses idiomatic without one) and
  // boots short of FRAMES -- SKIP until one lands. An NMI game declares convergence.idiomatic.nmiReturnPC;
  // an IRQ game (centiped, no vblank NMI) declares convergence.idiomatic.irq {bootAddr, irqVblank}. A
  // DONE-time "runs in the browser" gate, not a skeleton gate; it engages the moment either lands.
  const nmiReturnPC = manifest.convergence?.idiomatic?.nmiReturnPC;
  const irqCfg = manifest.convergence?.idiomatic?.irq;
  const notReady = nmiReturnPC === undefined && irqCfg === undefined;
  test(`${gameId}: boots the way the web worker constructs it`, { skip: !haveRom || notReady }, async () => {
    // The worker only runs runtime "idiomatic" games this way; all registered games are idiomatic.
    assert.equal(manifest.runtime, "idiomatic", `${gameId} runtime must be idiomatic for this boot path`);

    // web/player.html's keydown handler matches KeyboardEvent.CODE, so every manifest key must be a valid
    // e.code (Digit5/Space/ArrowLeft...), NOT an e.key character ("5"/" "). invaders shipped with e.key
    // chars, so coin/start/fire were dead in the browser while the arrows (identical in both) worked.
    const CODE = /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Backspace|Numpad[0-9]|(Shift|Control|Alt|Meta)(Left|Right))$/;
    for (const k of Object.keys(manifest.inputs.keys)) {
      assert.ok(CODE.test(k), `${gameId}: manifest.inputs.keys "${k}" is not a KeyboardEvent.code (player.html matches e.code) — use Digit5/Space/ArrowLeft, not e.key chars`);
    }

    // The board Inputs the worker constructs per Machine -- the exact thing whose absence made invaders
    // unplayable. It must be a real constructor.
    const { Inputs } = await import(`../../boards/${manifest.board}/io.js`);
    assert.equal(typeof Inputs, "function", `boards/${manifest.board}/io.js must export an Inputs class`);
    const inputs = new Inputs(); // must not throw

    const machineMod = await import(`../../games/${gameId}/machine.js`);
    const { Machine } = machineMod;
    const overrides = await machineMod.resolveAllIdiomatic();
    const bins = Object.fromEntries(names.map((n) => [n, new Uint8Array(readFileSync(romPath(n)))]));

    // Construct via the SHARED factory the worker uses (machine-factory.js), NOT a hand-rolled new Machine():
    // a manifest<->constructor divergence (a gfx image key, a port index) then cannot hide in a harness that
    // builds it differently -- the shared root of all four galaxian browser bugs.
    const m = buildGameMachine(Machine, inputs, bins, overrides);

    // Feed input the worker way (readInputsInto): keyed by the manifest PORT VALUES (addresses OR io indices,
    // per board), with a REAL coin pressed for a window -- not an all-zero {}. `action.port` is the port key in
    // every convention; polarity is the board's job, so assert the keyed input does NOT throw (galaxian's
    // ports-as-addresses crash-looped here), not that it banks a credit (that varies per game).
    const coin = manifest.inputs.actions.coin;
    // Trackball ports are analog (driven by applyTrackball, not digital inputAssert -- the board throws on a
    // digital assert to a trackball port, e.g. centiped IN2). Exclude them, exactly as the worker does.
    const tb = manifest.inputs.trackball;
    const trackPorts = new Set(tb ? [tb.xPort, tb.yPort] : []);
    const portKeys = Object.values(manifest.inputs.ports).filter((p) => !trackPorts.has(p));
    const frameInput = (f) => {
      const a = {};
      for (const k of portKeys) a[k] = 0;
      if (coin && f >= 90 && f < 130) a[coin.port] = (a[coin.port] || 0) | coin.bit;
      return a;
    };

    // Arm the sound tap as the worker does: an audio game must drive it during attract (a DEAD seam -> 0). This
    // proves the SEAM is live, NOT that the synth voices right -- per-voice fidelity is audio_gate's synth
    // null-mutant (test/synth-voices.test.js).
    let soundWrites = 0;
    m.io.onSoundWrite = () => { soundWrites++; };

    // An IRQ game boots via runIdiomaticIrqGame (bootAddr + the per-frame 32V IRQ pattern); an NMI game via
    // runIdiomaticGame (per-NMI PC reseat). Both call onFrame(mm, f) at the vblank yield, so the seam is the same.
    const r = irqCfg
      ? runIdiomaticIrqGame(m, {
          bootAddr: irqCfg.bootAddr, irqVblank: irqCfg.irqVblank, maxFrames: FRAMES,
          onFrame: (mm, f) => { mm.io.inputAssert = frameInput(f); },
        })
      : runIdiomaticGame(m, {
          bootAddr: 0x0000, nmiReturnPC, maxFrames: FRAMES,
          onFrame: (mm, f) => { mm.io.inputAssert = frameInput(f); },
        });
    assert.equal(r.stopError, null, `${gameId}: worker-form run threw: ${r.stop}`);
    assert.ok(r.frames >= FRAMES, `${gameId}: only advanced ${r.frames}/${FRAMES} frames (${r.stop})`);

    // Render the worker way and assert a NON-uniform buffer: the gfx1 key mismatch left this.video null -> an
    // all-black (uniform) frame that boots fine but shows nothing.
    const frame = m.renderFrame();
    assert.ok(frame && frame.length > 0, `${gameId}: renderFrame produced no buffer`);
    let uniform = true;
    for (let i = 1; i < frame.length; i++) if (frame[i] !== frame[0]) { uniform = false; break; }
    assert.ok(!uniform, `${gameId}: rendered attract frame is uniform (decoded graphics missing? black screen)`);

    if (manifest.audio) assert.ok(soundWrites > 0, `${gameId}: declares audio but wrote no sound in ${FRAMES} frames (dead sound seam?)`);
    // Node can't exercise the browser AUDIO RUNTIME (Web Audio/Safari) or the canvas -- the synth-404 + Safari
    // 0-input bugs were runtime-only. done_gate's browser subsystem runs tools/browser_runtime_gate.mjs for that
    // (BROWSER_GAMES); no human confirm (reviewer-rules R42).
  });
}
