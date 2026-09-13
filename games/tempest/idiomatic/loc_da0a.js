// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_38, loc_3b, loc_3c, loc_7a, loc_7b, loc_7d,
  loc_5000, loc_60c4, loc_60c5, loc_60ca, loc_60da,
} from "./names.js";
import { loc_da62 } from "./loc_da62.js";

// Power-on checksum + entropy settle. Walks 12 banks (8 pages each), XORing every byte into a per-bank
// checksum seeded with the bank index; the pointer high byte starts at 0x30, then jumps to the high
// window at bank 2. Each page strobes the watchdog cell. The 12 checksums land in consecutive cells from
// loc_7d; if bank 0's is nonzero it arms the error tone. Then it settles each entropy register: sample
// once, and store it only if six consecutive re-reads all match. Tail-delegates to the self-test loop.
export function loc_da0a(m) {
  const { mem8 } = m;

  mem8[loc_3b] = 0;      // bank pointer low byte (stays 0 -- pages are 256-aligned)
  mem8[loc_3c] = 0x30;   // bank pointer high byte -> first bank

  let offset = 0;        // byte offset within a page, shared across banks (always 0 at bank entry)
  let bank = 0;
  do {
    mem8[loc_38] = 8;    // pages remaining in this bank
    let checksum = bank; // seed the running checksum with the bank index
    do {
      do {
        const base = mem8[loc_3b] | (mem8[loc_3c] << 8);
        checksum ^= mem8[u16(base + offset)];
        offset = u8(offset + 1);
      } while (offset !== 0);
      mem8[loc_3c] = mem8[loc_3c] + 1; // advance to the next page
      mem8[loc_5000] = checksum;       // watchdog strobe (value ignored by the device)
      mem8[loc_38] = mem8[loc_38] - 1;
    } while (mem8[loc_38] !== 0);

    mem8[loc_7d + bank] = checksum;    // store this bank's checksum
    bank = bank + 1;
    if (bank === 2) mem8[loc_3c] = 0x90; // banks 2..11 live in the high window
  } while (bank < 12);

  if (mem8[loc_7d] !== 0) {            // bank-0 checksum bad -> arm the error tone
    mem8[loc_60c4] = 0x40;
    mem8[loc_60c5] = 0xa4;
  }

  settleRandom(mem8, loc_60ca, loc_7a);
  settleRandom(mem8, loc_60da, loc_7b);

  return loc_da62(m);
}

// Sample an entropy register once, then re-read it up to six times; store the sample only if every
// re-read still matches (a bail on the first mismatch leaves the destination untouched).
function settleRandom(mem8, srcCell, destCell) {
  const sample = mem8[srcCell];
  let retries = 5;
  let stable = true;
  do {
    if (sample !== mem8[srcCell]) { stable = false; break; }
    retries = retries - 1;
  } while (retries >= 0);
  if (stable) mem8[destCell] = sample;
}
