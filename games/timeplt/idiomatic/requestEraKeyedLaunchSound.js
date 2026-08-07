// SPDX-License-Identifier: GPL-3.0-only
/** requestEraKeyedLaunchSound — ask for one of two sounds, picked by how far the era cell has climbed: below the
 * third era one request goes out, from the third on the other does. Choosing between them is the
 * whole content of this entry — it writes nothing itself and passes nothing on, so both requests
 * carry the code and the permission they carry anywhere. LIVE-OUT: memory, through the request. */

import { ERA_INDEX } from "./names.js";
import { loc_565f } from "./loc_565f.js";
import { loc_5669 } from "./loc_5669.js";

const FIRST_LATE_ERA = 3;

export function requestEraKeyedLaunchSound(m) {
  if (m.mem8[ERA_INDEX] < FIRST_LATE_ERA) {
    loc_565f(m);
    return;
  }
  loc_5669(m);
}
