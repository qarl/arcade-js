#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * The JS side of tools/long_golden.py: render one layer of a game for a long run and write frames.rgb,
 * frames.json (per-frame sha256) and state.bin in the MAME golden's layout. The machine is built by the
 * game's own pixel-render setup (games/<g>/tools/render-lib.js), the one its pixel suite renders through.
 *
 * The input tape is in ACTION terms: [[from, to, ["coin", "left", ...]], ...] over JS tape indices. Each
 * action is keyed through the RAW manifest.inputs.actions {port, bit} (reviewer-rules R42), so a wrong
 * manifest bit drives the JS side differently from MAME, whose side presses the named MAME field.
 *
 *   node tools/long_render.mjs --game G --layer idiomatic|oracle --frames N --out DIR
 *        [--tape tape.json] [--tape-origin N] [--edit-json edits.json]
 * --edit-json {"<idiomatic module>.js": [[from, to], ...]} renders a MUTANT (the null-mutant control).
 * Exits nonzero on a boot gap, a dropped frame or a short run: a short artifact must never be diffed.
 */
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

function parse(argv) {
  const a = { tape: null, edits: null, tapeOrigin: 0 };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    switch (argv[i]) {
      case "--game": a.game = v(); break;
      case "--layer": a.layer = v(); break;
      case "--frames": a.frames = Number(v()); break;
      case "--out": a.out = v(); break;
      case "--tape": a.tape = v(); break;
      case "--tape-origin": a.tapeOrigin = Number(v()); break;
      case "--edit-json": a.edits = v(); break;
      default: throw new Error(`long_render: unknown argument ${argv[i]}`);
    }
  }
  if (!a.game || !["idiomatic", "oracle"].includes(a.layer) || !(a.frames >= 2) || !a.out) {
    throw new Error("usage: long_render.mjs --game G --layer idiomatic|oracle --frames N --out DIR [...]");
  }
  return a;
}

/** Per-frame {port: pressedBits} from an action tape, keyed by the manifest's raw {port, bit}. */
export function tapeAsserts(segments, actions, frames) {
  const out = new Array(frames + 1).fill(null);
  for (const [from, to, names] of segments) {
    for (const name of names) {
      const act = actions[name];
      if (!act) throw new Error(`long_render: tape action "${name}" is not in manifest.inputs.actions`);
      for (let f = Math.max(0, from); f < Math.min(to, frames + 1); f++) {
        out[f] ??= {};
        out[f][act.port] = (out[f][act.port] ?? 0) | act.bit;
      }
    }
  }
  return out;
}

async function main() {
  const a = parse(process.argv.slice(2));
  const gdir = join(REPO, "games", a.game);
  const lib = await import(pathToFileURL(join(gdir, "tools", "render-lib.js")).href);
  const manifest = (await import(pathToFileURL(join(gdir, "manifest.js")).href)).default;
  const idiomatic = a.layer === "idiomatic";
  const args = lib.parseRenderArgs(["node", "long_render", "--frames", String(a.frames), "--frames-out", a.out,
    ...(idiomatic ? ["--idiomatic", "--tape-origin", String(a.tapeOrigin)] : [])]);
  let idiomaticEdits;
  if (a.edits) {
    idiomaticEdits = {};
    for (const [file, pairs] of Object.entries(JSON.parse(readFileSync(a.edits, "utf8")))) {
      idiomaticEdits[file] = (src) => pairs.reduce((s, [from, to]) => s.split(from).join(to), src);
    }
  }
  const { machine } = await lib.createRenderMachine(args, { idiomaticEdits });
  const segments = a.tape ? JSON.parse(readFileSync(a.tape, "utf8")).segments : [];
  const asserts = tapeAsserts(segments, manifest.inputs.actions, a.frames + a.tapeOrigin + 2);
  machine.applyInputs = function (f) { this.io.inputAssert = asserts[f] ?? {}; };

  mkdirSync(a.out, { recursive: true });
  const fd = openSync(join(a.out, "frames.rgb"), "w");
  const hashes = [];
  machine.captureVideo = true;
  machine.onVideoFrame = (buf) => {
    writeSync(fd, buf, 0, buf.length);
    hashes.push(createHash("sha256").update(buf).digest("hex"));
  };
  const states = idiomatic ? lib.runGeneratorFrames(machine, a.frames, a.tapeOrigin) : machine.runFrames(a.frames);
  closeSync(fd);
  const sfd = openSync(join(a.out, "state.bin"), "w");
  for (const s of states) writeSync(sfd, s, 0, s.length);
  closeSync(sfd);
  writeFileSync(join(a.out, "frames.json"), JSON.stringify({
    count: hashes.length, frames: hashes.map((sha256, i) => ({ i, sha256 })) }) + "\n");
  const why = machine.droppedFrames ? `dropped ${machine.droppedFrames} frame(s)`
    : machine.stoppedBy ? `stopped: ${machine.stoppedBy.message ?? machine.stoppedBy}`
    : states.length < a.frames - 1 ? `short run: ${states.length} of ${a.frames} states` : null;
  console.log(JSON.stringify({ layer: a.layer, painted: hashes.length, states: states.length,
    distinct: new Set(hashes).size, stop: why }));
  return why ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((rc) => process.exit(rc), (e) => { console.error(e.stack ?? String(e)); process.exit(2); });
}
