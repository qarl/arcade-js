// SPDX-License-Identifier: GPL-3.0-only
//
// Equivalence gate for the declarative input contract (manifest.inputs).
//
// web/player.html and web/worker.js now READ their ports/keys/bits from
// games/dkong/manifest.js instead of hardcoding Donkey Kong's values. This test
// pins that manifest data to the ORIGINAL hardcoded literals the web layer used
// to carry, using the SAME reconstruction the web player does (split the key
// bindings into per-port key->bit maps). If the manifest ever drifts from the
// historical runtime behavior, this fails. Needs no ROM, so it runs on any clone.

import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../manifest.js";

const { ports, actions, keys } = manifest.inputs;

// Reconstruct a per-port key->bit map exactly like web/player.html does.
function keymapForPort(portAddr) {
  const out = {};
  for (const [code, action] of Object.entries(keys)) {
    const a = actions[action];
    if (a && a.port === portAddr) out[code] = a.bit;
  }
  return out;
}

test("manifest.inputs reconstructs the original hardcoded web-input values", () => {
  // Ports match the three IN0/IN1/IN2 addresses from boards/dkong/io.js.
  assert.equal(ports.in0, 0x7c00);
  assert.equal(ports.in1, 0x7c80);
  assert.equal(ports.in2, 0x7d00);

  // IN0 key->bit map == the original player.html K0.
  assert.deepEqual(keymapForPort(ports.in0), {
    ArrowRight: 0x01, KeyD: 0x01, ArrowLeft: 0x02, KeyA: 0x02,
    ArrowUp: 0x04, KeyW: 0x04, ArrowDown: 0x08, KeyS: 0x08,
    Space: 0x10, KeyZ: 0x10, KeyX: 0x10,
  });

  // IN2 key->bit map == the original player.html K2.
  assert.deepEqual(keymapForPort(ports.in2), {
    Digit5: 0x80, KeyC: 0x80, Digit1: 0x04, Digit2: 0x08,
  });

  // coin/start buttons pulse these exact IN2 bits.
  assert.equal(actions.coin.port, 0x7d00);
  assert.equal(actions.coin.bit, 0x80);
  assert.equal(actions.start1.port, 0x7d00);
  assert.equal(actions.start1.bit, 0x04);
});
