// SPDX-License-Identifier: GPL-3.0-only
/**
 * The live stack floor at each frame sample runFrames takes. A whole-run gate compares the state
 * dumped at frame boundaries, so only the stack BELOW the SP of that sample is dead; a cell that
 * differs at or above it is in a live frame and must be compared, not masked as scratch.
 */
import manifest from "../../manifest.js";

const [, STACK_TOP] = manifest.convergence.stateExclude.stack;

/** Install on a machine before runFrames; returns the SP at every sample, indexed like the frames. */
export function recordFrameFloors(m) {
  const floors = [];
  let frames;
  Object.defineProperty(m, "frames", {
    configurable: true,
    get: () => frames,
    set: (v) => {
      frames = v;
      floors.length = 0;
      floors.push(m.regs.sp);
      v.push = (...x) => {
        floors.push(m.regs.sp);
        return Array.prototype.push.apply(v, x);
      };
    },
  });
  return floors;
}

/** Stack cells that differ between two frame traces at or above that sample's SP: live frames, never scratch. */
export function liveStackDiffs(baseFrames, hostFrames, floors, toAddr) {
  const live = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = baseFrames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) {
      if (x[o] === y[o]) continue;
      const a = toAddr(o);
      if (a !== null && a >= floors[i] && a < STACK_TOP) live.add(a);
    }
  }
  return [...live].sort((p, q) => p - q);
}
