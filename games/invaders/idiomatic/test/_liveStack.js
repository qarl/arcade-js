// SPDX-License-Identifier: GPL-3.0-only
/**
 * RAM diff minus stack scratch below the entry SP. `entered(routine)` records SP the first time a machine
 * enters the routine (the compared span's start); `ramDiff` then skips only STACK_SCRATCH cells below that
 * floor, so a write into the caller's live frame (at/above the entry SP) is compared.
 */
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const FLOOR = new WeakMap();

export const entered = (routine) => (m, ...args) => {
  if (!FLOOR.has(m)) FLOOR.set(m, m.regs.sp);
  return routine(m, ...args);
};

/** The entry SP recorded on either side; both sides entering at different SPs is a harness fault. */
export function entryFloor(ma, mb) {
  const fa = FLOOR.get(ma), fb = FLOOR.get(mb);
  if (fa != null && fb != null && fa !== fb) throw new Error(`sides entered at SP 0x${fa.toString(16)} vs 0x${fb.toString(16)}`);
  const f = fa ?? fb;
  if (f == null) throw new Error("ramDiff: no side entered through entered(); pass the entry SP");
  return f;
}

export const ramDiff = (ma, mb, floor = entryFloor(ma, mb)) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackBelow(STACK_SCRATCH, floor));
