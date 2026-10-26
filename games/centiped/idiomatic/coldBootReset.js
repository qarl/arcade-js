// SPDX-License-Identifier: GPL-3.0-only
import {
  loc_00, loc_0100, loc_0400, loc_0500, loc_0600, loc_0700, loc_64,
  loc_86, loc_8a, loc_8b, loc_8c, loc_c1, loc_c2, loc_ff, CONFIG_DIP_BYTE,
  DSW1, IN0, IN1,
  AUDF1, AUDC1, AUDC2, AUDC3, AUDC4, AUDCTL, SKCTL, WATCHDOG, loc_2400,
  PALETTE_COLOR_04, PALETTE_COLOR_05, PALETTE_COLOR_06, PALETTE_COLOR_07,
  PALETTE_COLOR_0D, PALETTE_COLOR_0E, PALETTE_COLOR_0F, FLIP_SCREEN,
} from "./names.js";
import { loadHighScoreTableFromEarom } from "./loadHighScoreTableFromEarom.js";
import { validateOrResetHighScores } from "./validateOrResetHighScores.js";
import { loc_200e } from "./loc_200e.js";
import { loc_3c97 } from "./loc_3c97.js";

// Service-port bit masks for input port IN0. The board wires two operator/timing signals into this one
// byte: bit 6 (0x40) is the beam's vertical-blank edge, which toggles once per displayed frame and is the
// only clock the self-test can pace against; bit 5 (0x20) is the operator service switch, which idles HIGH
// and is pulled LOW only while a technician physically holds it. Reading these two bits is how the boot
// decides "normal game" vs "run diagnostics" and how the beep timing stays in step with the display. [code]
const VBLANK = 0x40;
const SERVICE = 0x20;

/**
 * coldBootReset — the power-on reset entry (reset-vector target). Clears all work/stack/video/object RAM,
 * quiets the sound and flip latches, then splits on the service switch:
 *   - switch idle (normal boot): snapshot the option switches, seed a few flags, load and validate the
 *     high-score mirror from NVRAM, then hand off to the game entry.
 *   - switch held (operator self-test): march RAM and the memory pages, beeping any failure, and otherwise
 *     draw the test screens or hand off to the checksum display.
 * The self-test marches poll the beam and the service switch, so they are inherently clock-coupled. [code]
 *
 * A generator: the normal path delegates into the main-loop spine, whose vblank yields propagate up to the
 * clock-free engine. Isolated capture-replay can't drive a forever-yielding boot, so this spine entry is
 * engine-validated (whole-machine convergence) rather than by an isolated capture test.
 */
export function* coldBootReset(m) {
  const { mem8 } = m;

  // Wipe all of work RAM to zero before anything reads it. One descending index x (0xff..0x00) sweeps six
  // planes at once — zeropage (loc_00), the stack page (loc_0100), and the four video/object pages
  // (loc_0400/0500/0600/0700) — so every cell of every plane starts from a known-blank state. The 6502
  // original does exactly this with one X register counting down, which is why a single loop touches all six.
  // Clear zeropage, page 1 (stack), and the video/object pages with 0.
  let x = 0;
  do {
    mem8[(loc_00 + x) & 0xff] = 0;
    mem8[loc_0100 + x] = 0;
    mem8[loc_0400 + x] = 0;
    mem8[loc_0500 + x] = 0;
    mem8[loc_0600 + x] = 0;
    mem8[loc_0700 + x] = 0;
    x = (x - 1) & 0xff;
  } while (x !== 0);

  // Quiet the hardware latches that could otherwise carry stale state across the reset. SKCTL and AUDCTL are
  // the POKEY sound-chip control ports (zeroed so no tone leaks); the write to loc_2400 is a dead store into a
  // ROM-space address the machine ignores — it is kept only so this mirror matches the original byte-for-byte;
  // FLIP_SCREEN drops the cabinet-orientation latch so the display starts in a defined orientation.
  // Quiet the sound-status/coin regs and drop the flip-screen latch.
  mem8[SKCTL] = 0;
  mem8[AUDCTL] = 0;
  mem8[loc_2400] = 0;
  mem8[FLIP_SCREEN] = 0;

  // With RAM and latches settled, read the service switch to pick the boot destination. Bit 5 of IN0 idles
  // high, so a nonzero result means the switch is NOT held: this is an ordinary power-on.
  if ((mem8[IN0] & SERVICE) !== 0) {
    // Normal boot: the service switch is idle.
    // Snapshot the option DIP bank DSW1 into the config byte $fd; its upper bits later select a ROM table
    // variant, so the whole game reads its cabinet options from this one cached copy.
    mem8[CONFIG_DIP_BYTE] = mem8[DSW1];
    // Seed a handful of flags to their power-on values ($86/$c1/$c2 to 0xff, $ff to 1) — the defaults the
    // game logic expects on a fresh boot.
    mem8[loc_86] = 0xff;
    mem8[loc_c1] = 0xff;
    mem8[loc_c2] = 0xff;
    mem8[loc_ff] = 1;
    // Pull the high-score table out of the EAROM (battery-less NVRAM) mirror and sanity-check it, resetting it
    // to defaults if the stored image is corrupt.
    loadHighScoreTableFromEarom(m, 1); // A live-in is a don't-care; the NVRAM read overwrites it
    validateOrResetHighScores(m);
    // Hand control to the game entry. loc_200e is the main-loop generator; it never returns, so this yield*
    // is the last thing the normal boot ever does — everything below is diagnostic-only.
    yield* loc_200e(m); // hand off to the game entry — the main-loop generator runs forever
    return;
  }

  // Service switch held: divert into the operator self-test instead of the game.
  return runSelfTest(m);
}

// ---- operator self-test (service switch held) -------------------------------------------------------

function runSelfTest(m) {
  const { mem8, mem16 } = m;

  // Give the test screen a defined look and no sound: paint a small four-step colour ramp into the palette
  // cells (04..07 and their mirror 0D..0F get values 0,1,2,3) and silence all four POKEY voices (AUDC1..4).
  // Seed a colour ramp and quiet the four sound channels.
  mem8[PALETTE_COLOR_04] = 0;
  mem8[AUDC1] = 0; mem8[AUDC2] = 0; mem8[AUDC3] = 0; mem8[AUDC4] = 0;
  mem8[PALETTE_COLOR_05] = 1; mem8[PALETTE_COLOR_0D] = 1;
  mem8[PALETTE_COLOR_06] = 2; mem8[PALETTE_COLOR_0E] = 2;
  mem8[PALETTE_COLOR_07] = 3; mem8[PALETTE_COLOR_0F] = 3;

  // Zeropage RAM march. Visit every one of the 256 zeropage cells. Each cell must FIRST read back zero (proof
  // the earlier wipe actually held); then a single set bit is walked upward through the byte (0x11 shifted
  // left each pass). After every write the cell is immediately read back and compared, so a stuck-at or
  // shorted data line surfaces the instant the readback fails to echo what was written. Any mismatch aborts
  // straight into the error reporter, whose argument is the failing pattern (used to pick the beep count).
  // Zeropage march: each cell must read back 0, then walk a 1-bit pattern up through it.
  for (let cell = 0; ; cell = (cell + 1) & 0xff) {
    if (mem8[(loc_00 + cell) & 0xff] !== 0) return selfTestErrorFromRam(m, mem8[(loc_00 + cell) & 0xff]);
    let a = 0x11;
    for (;;) {
      mem8[(loc_00 + cell) & 0xff] = a;
      const readback = mem8[(loc_00 + cell) & 0xff];
      if ((a ^ readback) !== 0) return selfTestErrorFromRam(m, a ^ readback);
      a = a << 1;
      if ((a & 0x100) === 0) { a &= 0xff; continue; } // walking bit still in range
      break;
    }
    if (((cell + 1) & 0xff) === 0) break;
  }

  // Whole-page RAM march. Same walking-bit test as above, but now addressed through a 16-bit pointer built
  // from loc_8b (low, held at 0) and loc_8c (high, the page number), so it can sweep a full 256-byte page at
  // a time. It tests page 1, then pages 4 through 7, deliberately SKIPPING pages 2-3 because they are unmapped
  // on this board (nothing to test there). Note loc_8c is a live page counter driving the march here, not the
  // sign/blank cell it plays elsewhere. Any mismatch aborts into the page error reporter (which also gets Y,
  // the failing offset, to fold into its beep count).
  // Page march over the ($8b) pointer: page 1, then 4..7 (pages 2-3 are skipped). Pointer low is 0.
  mem8[loc_8b] = 0;
  mem8[loc_8c] = 1;
  let page = 1;
  for (;;) {
    mem8[loc_8c] = page;
    for (let y = 0; ; y = (y + 1) & 0xff) {
      const at = mem16[loc_8b] + y;
      if (mem8[at] !== 0) return selfTestErrorFromPage(m, mem8[at], y);
      let a = 0x11;
      for (;;) {
        mem8[(mem16[loc_8b] + y)] = a;
        const readback = mem8[(mem16[loc_8b] + y)];
        if ((a ^ readback) !== 0) return selfTestErrorFromPage(m, a ^ readback, y);
        a = a << 1;
        if ((a & 0x100) === 0) { a &= 0xff; continue; }
        break;
      }
      if (((y + 1) & 0xff) === 0) break;
    }
    // Advance to the next page, remapping 2 -> 4 so the unmapped pages are jumped, and stop once past page 7.
    let next = (page + 1) & 0xff;
    if (next === 2) next = 4; // remap: skip the unmapped pages
    if (next >= 8) break;
    page = next;
  }

  // Both marches passed. Branch on the coin/self-test option bit (bit 4 of IN1): when set, hand off to the
  // ROM-checksum display screen, which runs the rest of the diagnostic and never returns here.
  // Marches passed. Branch on the coin/self-test option bit into the checksum-display screen.
  if ((mem8[IN1] & 0x10) !== 0) return loc_3c97(m); // into the checksum screen (non-returning self-test)

  // No checksum option: build the on-screen diagnostic ourselves. Re-clear zeropage (the marches dirtied it),
  // then seed the 16-cell row at loc_64 with the fill glyph 0xf8 before painting the descending glyph grid.
  // Re-clear zeropage, seed the $64.. row, and paint the self-test glyph grid.
  for (let cell = 0; ; cell = (cell + 1) & 0xff) {
    mem8[(loc_00 + cell) & 0xff] = 0;
    if (((cell + 1) & 0xff) === 0) break;
  }
  for (let i = 0x0f; i >= 0; i--) mem8[(loc_64 + i) & 0xff] = 0xf8;

  // Paint the glyph grid down through the ($8b) video pointer, page 7 down to page 4. For each page the inner
  // loop lays runs of 8 identical cells, stepping the glyph code down from 0x2d each run and wrapping the row
  // when the write cursor y underflows past 0. This fills the screen with the characteristic self-test grid.
  mem8[loc_8c] = 7;
  let y = 0xbf;
  for (;;) {
    let glyph = 0x2d;
    for (;;) {
      // Lay 8 descending cells of this glyph through the ($8b) pointer, then step the glyph code down.
      let n = 8;
      do {
        mem8[(mem16[loc_8b] + y)] = glyph;
        y = (y - 1) & 0xff;
        n = (n - 1) & 0xff;
      } while (n !== 0);
      glyph = (glyph - 1) & 0xff;
      if (glyph < 0x2a) break; // wrapped below the printable base
    }
    // Keep painting the same page until the cursor wraps (y hits 0xff); then step to the next lower page and
    // stop once we drop below page 4.
    if (y !== 0xff) continue;
    mem8[loc_8c] = (mem8[loc_8c] - 1);
    if (mem8[loc_8c] >= 4) continue;
    break;
  }

  // Input-response screen: prove the controls work. Spin until the operator releases the service switch, shift
  // the pacing value in loc_8a, kick the watchdog each pass (so the board is not reset out from under the test
  // while we wait), and break out the moment any of the top three IN1 control bits changes from idle-high
  // (i.e. a control was actuated).
  // Input-response screen: wait for the service switch, kick the dog, wait for a control.
  for (;;) {
    while ((mem8[IN0] & SERVICE) !== 0) { /* wait for the service switch to clear */ }
    mem8[loc_8a] = mem8[loc_8a] >> 1;
    mem8[WATCHDOG] = 0; // watchdog
    if ((((mem8[IN1] & 0xe0) ^ 0xe0)) !== 0) break; // a control was actuated
  }

  // A control was seen: flood the three full video/object pages (0400/0500/0600) plus the partial page 0700
  // (only 0xc0 cells are mapped there) with the response colour 0x1d, then brighten two palette cells so the
  // whole screen changes to acknowledge the input. This is the visible "yes, the controls register" feedback.
  // Paint the response colour into the play/object pages, then hold in the review loop.
  const fill = 0x1d;
  for (let cell = 0; ; cell = (cell + 1) & 0xff) {
    mem8[loc_0400 + cell] = fill;
    mem8[loc_0500 + cell] = fill;
    mem8[loc_0600 + cell] = fill;
    if (((cell + 1) & 0xff) === 0) break;
  }
  for (let cell = 0; cell < 0xc0; cell++) mem8[loc_0700 + cell] = fill;
  mem8[PALETTE_COLOR_05] = 8;
  mem8[PALETTE_COLOR_04] = 0x0f;

  // Review loop: kick the dog and pace on $8a while the service switch is held clear (holds here). [code]
  for (;;) {
    while ((mem8[IN0] & SERVICE) !== 0) { /* wait for service clear */ }
    mem8[WATCHDOG] = 0;
    mem8[loc_8a] = mem8[loc_8a] >> 1;
  }
}

// Zeropage-march failure reporter. The number of beeps encodes the fault. For a zeropage failure there is no
// position to report, so the beep count derives only from the single fail-flag bit (bit 4 of the failing
// value) passed on as the low bit of the count.
function selfTestErrorFromRam(m, fail) {
  return selfTestBeepAndHalt(m, 0, fail >= 0x10 ? 1 : 0);
}

// Page-march failure reporter. A low page ($8c < 4) is reported in the simpler zeropage style; otherwise the
// beep count also folds in the position of the failing byte — bits 5-4 of the offset Y become the seed — so
// the operator can hear roughly where in the page the fault landed.
function selfTestErrorFromPage(m, fail, y) {
  if (m.mem8[loc_8c] < 4) return selfTestErrorFromRam(m, fail);
  const seed = ((y & 0x30) >> 4) + 1;
  return selfTestBeepAndHalt(m, seed, fail >= 0x10 ? 1 : 0);
}

// Audible beep-and-halt. Drives a tone on POKEY channel 1 a fixed number of times, then stops the board. The
// count is packed as (seed << 1 | carry); the loop plays until that counter underflows (its bit 7 sets).
function selfTestBeepAndHalt(m, seed, carry) {
  const { mem8 } = m;
  let count = ((seed << 1) | carry) & 0xff;
  // Arm the tone: AUDF1 sets channel-1 frequency, SKCTL=3 enables the serial/keyboard control that gates it.
  mem8[AUDF1] = 0x40;
  mem8[SKCTL] = 3;
  do {
    // Tone ON half of one beep: set channel-1 volume/distortion, then spin 0x10 beam frames. Each frame waits
    // for the vblank edge to rise and fall (that beam poll is the ONLY clock here), kicking the watchdog each
    // frame so the count can play out without the board resetting itself.
    mem8[AUDC1] = 0xaf;
    for (let x = 0x10; x > 0; x--) {
      while ((mem8[IN0] & VBLANK) === 0) { /* wait for vblank */ }
      while ((mem8[IN0] & VBLANK) !== 0) { /* wait for active video */ }
      mem8[WATCHDOG] = 0;
    }
    // Tone OFF half: silence channel 1 and spin another 0x10 beam frames the same way, giving the gap between
    // beeps. Toggling on/off in step with the beam is what makes the beeps audibly countable.
    mem8[AUDC1] = 0;
    for (let x = 0x10; x > 0; x--) {
      while ((mem8[IN0] & VBLANK) === 0) { /* wait for vblank */ }
      while ((mem8[IN0] & VBLANK) !== 0) { /* wait for active video */ }
      mem8[WATCHDOG] = 0;
    }
    count = (count - 1) & 0xff;
  } while ((count & 0x80) === 0);

  // All beeps played. Wait (kicking the dog) while the service switch is still held, then spin WITHOUT
  // kicking it: on the board the watchdog resets the machine, and with the switch released it boots normally.
  while ((mem8[IN0] & SERVICE) === 0) { mem8[WATCHDOG] = 0; } // wait for service release, kicking the dog
  for (;;) { /* halt: the machine hangs here until the watchdog resets it */ }
}
