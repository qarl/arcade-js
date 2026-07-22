// SPDX-License-Identifier: GPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as RAM from '../ram.js';

// Donkey Kong work RAM occupies 0x6000-0x6BFF. No ROM needed: these tests only
// audit the constants module for shape, uniqueness, and the calibration anchors.
const WORK_RAM_LO = 0x6000;
const WORK_RAM_HI = 0x6bff;

// The two intentional aliases: the player and world verifiers independently
// covered the live player-context block, so each of these bytes carries two
// verbatim names. Any OTHER shared address is a real collision and must fail.
const INTENTIONAL_ALIASES = [
  ['PLAYER_LIVES', 'LIVES'],            // 0x6228
  ['EXTRA_LIFE_AWARDED', 'BONUS_LIFE_AWARDED'], // 0x622D
];

const entries = Object.entries(RAM);

test('module exports at least one constant', () => {
  assert.ok(entries.length > 0, 'ram.js exported nothing');
});

test('every export is a number within [0x6000, 0x6BFF]', () => {
  for (const [name, value] of entries) {
    assert.equal(typeof value, 'number', `${name} is not a number`);
    assert.ok(Number.isInteger(value), `${name} = ${value} is not an integer`);
    assert.ok(
      value >= WORK_RAM_LO && value <= WORK_RAM_HI,
      `${name} = 0x${value.toString(16)} is outside DK work RAM 0x6000-0x6BFF`,
    );
  }
});

test('every export name is UPPER_SNAKE_CASE', () => {
  const re = /^[A-Z][A-Z0-9_]*$/;
  for (const [name] of entries) {
    assert.match(name, re, `${name} is not UPPER_SNAKE_CASE`);
  }
});

test('every export name is unique', () => {
  const names = entries.map(([n]) => n);
  const seen = new Set(names);
  assert.equal(seen.size, names.length, 'duplicate export name(s) present');
});

test('no two exports share an address except the declared intentional aliases', () => {
  const byAddr = new Map(); // address -> [names]
  for (const [name, value] of entries) {
    if (!byAddr.has(value)) byAddr.set(value, []);
    byAddr.get(value).push(name);
  }

  const aliasGroups = INTENTIONAL_ALIASES.map((g) => new Set(g));
  for (const [value, names] of byAddr) {
    if (names.length === 1) continue;
    const asSet = new Set(names);
    const matches = aliasGroups.some(
      (g) => g.size === asSet.size && [...asSet].every((n) => g.has(n)),
    );
    assert.ok(
      matches,
      `0x${value.toString(16)} is shared by ${names.join(', ')} but is not a declared intentional alias`,
    );
  }
});

test('each declared alias pair resolves to the same address', () => {
  for (const [a, b] of INTENTIONAL_ALIASES) {
    assert.ok(a in RAM, `alias member ${a} is not exported`);
    assert.ok(b in RAM, `alias member ${b} is not exported`);
    assert.equal(
      RAM[a],
      RAM[b],
      `alias ${a} (0x${RAM[a].toString(16)}) != ${b} (0x${RAM[b].toString(16)})`,
    );
  }
  // Pin the alias addresses so a future rename can't quietly move them.
  assert.equal(RAM.PLAYER_LIVES, 0x6228, 'PLAYER_LIVES/LIVES must be 0x6228');
  assert.equal(RAM.EXTRA_LIFE_AWARDED, 0x622d, 'EXTRA_LIFE_AWARDED/BONUS_LIFE_AWARDED must be 0x622D');
});

test('calibration anchors: MARIO_X, MARIO_Y, GAME_STATE', () => {
  // If any of these three are wrong, the whole map is suspect.
  assert.equal(RAM.MARIO_X, 0x6203, 'MARIO_X must be 0x6203');
  assert.equal(RAM.MARIO_Y, 0x6205, 'MARIO_Y must be 0x6205');
  assert.equal(RAM.GAME_STATE, 0x6005, 'GAME_STATE must be 0x6005');
});
