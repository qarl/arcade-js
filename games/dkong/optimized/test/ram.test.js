// SPDX-License-Identifier: GPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as RAM from '../ram.js';

// Donkey Kong work RAM occupies 0x6000-0x6BFF. No ROM needed: these tests only
// audit the constants module for shape, uniqueness, and the calibration anchors.
const WORK_RAM_LO = 0x6000;
const WORK_RAM_HI = 0x6bff;

const entries = Object.entries(RAM);
// Structural (non-address-constant) exports: the complete read/write FOOTPRINT
// catalog and the STACK_SCRATCH region, added for the convergence gate. The
// address-range/uniqueness guards below apply only to the address-CONSTANT
// exports (the curated names); these two are validated separately.
const STRUCTURAL = new Set(['FOOTPRINT', 'STACK_SCRATCH']);
const addrEntries = entries.filter(([n, v]) => typeof v === 'number' && !STRUCTURAL.has(n));

test('module exports at least one constant', () => {
  assert.ok(entries.length > 0, 'ram.js exported nothing');
});

test('every address-constant export is a number within [0x6000, 0x6BFF]', () => {
  for (const [name, value] of addrEntries) {
    assert.equal(typeof value, 'number', `${name} is not a number`);
    assert.ok(Number.isInteger(value), `${name} = ${value} is not an integer`);
    assert.ok(
      value >= WORK_RAM_LO && value <= WORK_RAM_HI,
      `${name} = 0x${value.toString(16)} is outside DK work RAM 0x6000-0x6BFF`,
    );
  }
});

test('the FOOTPRINT catalog and STACK_SCRATCH region are well-formed', () => {
  assert.equal(typeof RAM.STACK_SCRATCH, 'object', 'STACK_SCRATCH must be an object');
  assert.ok(RAM.STACK_SCRATCH.lo < RAM.STACK_SCRATCH.hi && RAM.STACK_SCRATCH.hi <= 0x6c00, 'STACK_SCRATCH bounds');
  assert.equal(typeof RAM.FOOTPRINT, 'object', 'FOOTPRINT must be an object');
  const keys = Object.keys(RAM.FOOTPRINT).map(Number);
  assert.ok(keys.length > 0, 'FOOTPRINT is empty');
  for (const a of keys) {
    const ok = (a >= 0x6000 && a <= 0x6bff) || (a >= 0x7000 && a <= 0x77ff); // work | sprite | video
    assert.ok(ok, `FOOTPRINT address 0x${a.toString(16)} is outside the RAM regions`);
    assert.equal(typeof RAM.FOOTPRINT[a], 'string', `FOOTPRINT[0x${a.toString(16)}] must be a name string`);
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

test('no two exports share an address', () => {
  const byAddr = new Map(); // address -> [names]
  for (const [name, value] of addrEntries) {
    if (!byAddr.has(value)) byAddr.set(value, []);
    byAddr.get(value).push(name);
  }
  for (const [value, names] of byAddr) {
    assert.equal(
      names.length,
      1,
      `0x${value.toString(16)} is shared by ${names.join(', ')} — each address must have one canonical name`,
    );
  }
});

test('the retired alias names are gone (one canonical name per byte)', () => {
  assert.ok(!('PLAYER_LIVES' in RAM), 'PLAYER_LIVES should be retired in favour of LIVES');
  assert.ok(!('EXTRA_LIFE_AWARDED' in RAM), 'EXTRA_LIFE_AWARDED should be retired in favour of BONUS_LIFE_AWARDED');
  assert.equal(RAM.LIVES, 0x6228, 'LIVES must be 0x6228');
  assert.equal(RAM.BONUS_LIFE_AWARDED, 0x622d, 'BONUS_LIFE_AWARDED must be 0x622D');
});

test('calibration anchors: MARIO_X, MARIO_Y, GAME_STATE', () => {
  // If any of these three are wrong, the whole map is suspect.
  assert.equal(RAM.MARIO_X, 0x6203, 'MARIO_X must be 0x6203');
  assert.equal(RAM.MARIO_Y, 0x6205, 'MARIO_Y must be 0x6205');
  assert.equal(RAM.GAME_STATE, 0x6005, 'GAME_STATE must be 0x6005');
});
