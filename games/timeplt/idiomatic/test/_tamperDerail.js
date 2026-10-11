// SPDX-License-Identifier: GPL-3.0-only
/**
 * Test-only instruments for the two anti-tamper derails whose landings have no faithful routine form.
 *
 * On a failed guard the frozen oracle transfers into bytes that destroy the stack frame: the
 * copyright-colour walk jumps into a caption record decoded as code (0x49fa), and the wrong-glyph
 * checks jump into the warp/flash step's misaligned prologue (0x459b). The rewrites raise
 * NotImplemented at those transfers instead, naming the module that stands for the landing. What the
 * two sides then do is not comparable (the oracle faults somewhere inside the garbage, the rewrite
 * at the entry), so a gate compares them AT the transfer:
 *
 * stopAtDerails(m) — arm a clone so the ORACLE stops on entry to either landing. It gets its own
 *   routine map (a clone shares its parent's), with each landing replaced by a probe that throws
 *   `DerailReached`. Everything the oracle does before the transfer runs unchanged.
 *
 * derailOf(e) — which landing a fault names: the probe's address on the oracle side; on the rewrite
 *   side, the landing whose module a NotImplemented message names. null for any other fault, so a
 *   stray crash never passes for a derail.
 */

import { NotImplemented } from "../../../../boards/timeplt/io.js";

export const DERAILS = new Map([
  [0x459b, "derailIntoMotherShipWreckCountdown"],
  [0x49fa, "checkTheCopyrightLineColoursOrDerail"],
]);

export class DerailReached extends Error {
  constructor(addr) {
    super(`derail reached 0x${addr.toString(16).padStart(4, "0")}`);
    this.name = "DerailReached";
    this.addr = addr;
  }
}

export function stopAtDerails(m) {
  m.routines = new Map(m.routines);
  for (const addr of DERAILS.keys()) m.routines.set(addr, () => { throw new DerailReached(addr); });
  return m;
}

export function derailOf(e) {
  if (e instanceof DerailReached) return e.addr;
  if (e instanceof NotImplemented) {
    for (const [addr, name] of DERAILS) if (e.message.includes(`${name}:`)) return addr;
  }
  return null;
}

/** A fault's class for an outcome comparison: the landing for a derail, else the error's type. */
export function faultClass(e) {
  const at = derailOf(e);
  return at === null ? e.constructor.name : `derail@0x${at.toString(16)}`;
}
