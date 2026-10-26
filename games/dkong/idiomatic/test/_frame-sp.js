// SPDX-License-Identifier: GPL-3.0-only
// Whole-run trace gates: the live stack floor at each sampled frame. Machine.tick/runFrames call
// applyPokes(n) immediately before taking frame n's state dump, so the guest SP read there is the
// SP the dump was taken at.

/** Record `m`'s guest SP at every sampled frame of a later m.runFrames(); returns the (filling) array. A
 * sample taken inside the vblank NMI records the SP the interrupted code had: the NMI's whole frame (its pushed
 * PC, its register saves, its own calls) sits below it, and that saved register file is not part of the contract. */
export function recordFrameSp(m) {
  const sps = [];
  const interrupted = [];
  const fireNmi = m.fireNmi.bind(m);
  m.fireNmi = (...args) => {
    interrupted.push(m.regs.sp);
    try { return fireNmi(...args); } finally { interrupted.pop(); }
  };
  const apply = m.applyPokes.bind(m);
  m.applyPokes = (n) => {
    sps[n] = interrupted.length ? interrupted[0] : m.regs.sp;
    return apply(n);
  };
  return sps;
}

/** Per-frame live floor of two runs: the shallower SP, so only what one side pushed below the other's
 * live frame (an oracle mid-routine, a dissolved call) is scratch; every cell live in both is compared. */
export function frameFloors(spA, spB) {
  return spA.map((sp, f) => Math.max(sp, spB[f] ?? sp));
}
