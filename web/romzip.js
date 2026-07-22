// SPDX-License-Identifier: GPL-3.0-only
//
// Client-side ROM-zip reader + image assembler.
//
// A visitor should not need a checkout and a Makefile to play: they drop their
// own romset zip onto the page and it is unzipped, concatenated, sized and
// sha256-verified entirely in the browser. Nothing is uploaded — the zip never
// leaves the machine — and no copyrighted byte ever ships from this repo.
//
// PORTABILITY IS THE POINT: this module uses only APIs that exist in BOTH modern
// browsers and Node 18+ (DecompressionStream, ReadableStream, crypto.subtle,
// TextDecoder). No DOM, no Node built-ins, no dependencies. That is what lets
// web/test/romzip.test.js run this exact code under node:test against the real
// dkong.zip and prove it reproduces `make rom`'s output byte-for-byte.
//
// The ZIP support is deliberately minimal — enough for MAME romsets, which are
// flat archives of small stored/deflated members: no ZIP64, no encryption, no
// multi-disk, no CRC check (the sha256 over the assembled image is a strictly
// stronger check and is the one that gates loading).

const EOCD_SIG = 0x06054b50; // end of central directory
const CEN_SIG = 0x02014b50;  // central directory file header
const LOC_SIG = 0x04034b50;  // local file header
const EOCD_MIN = 22;         // EOCD size with an empty archive comment
const MAX_COMMENT = 0xffff;  // archive comment length is a u16

const DEC = new TextDecoder();
const u16 = (dv, p) => dv.getUint16(p, true);
const u32 = (dv, p) => dv.getUint32(p, true);

/** The last path component of a zip entry name ("dkongj/5g.cpu" -> "5g.cpu"). */
export function basename(name) {
  const i = name.lastIndexOf("/");
  return i < 0 ? name : name.slice(i + 1);
}

/**
 * Look a part up in a readZip() map. Exact full-path match wins; otherwise match
 * by basename so a flat romset zip and one with the parts in a subdirectory
 * (merged/"parent" sets put clones under dkongj/, dkongpe/, ...) both work. When
 * several entries share a basename the shallowest wins, so a root-level part is
 * never shadowed by a clone's copy.
 */
export function findEntry(entries, wanted) {
  if (entries.has(wanted)) return entries.get(wanted);
  const want = basename(wanted).toLowerCase();
  let best = null;
  let bestDepth = Infinity;
  for (const [name, data] of entries) {
    if (basename(name).toLowerCase() !== want) continue;
    const depth = name.split("/").length;
    if (depth < bestDepth) { best = data; bestDepth = depth; }
  }
  return best;
}

async function inflateRaw(raw, name) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(`cannot inflate "${name}": this browser has no DecompressionStream`);
  }
  const src = new ReadableStream({
    start(c) { c.enqueue(raw); c.close(); },
  });
  const reader = src.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/**
 * Minimal ZIP reader.
 *
 * @param {Uint8Array|ArrayBuffer} bytes the whole archive
 * @returns {Promise<Map<string, Uint8Array>>} entry name -> decompressed bytes
 */
export async function readZip(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length < EOCD_MIN) throw new Error("not a zip file (too short)");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // The EOCD sits at the very end, but a variable-length archive comment may
  // follow it, so scan backwards for the signature.
  let eocd = -1;
  const floor = Math.max(0, buf.length - EOCD_MIN - MAX_COMMENT);
  for (let p = buf.length - EOCD_MIN; p >= floor; p--) {
    if (u32(dv, p) === EOCD_SIG) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");

  const count = u16(dv, eocd + 10);
  const cdOffset = u32(dv, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported");
  }

  const out = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || u32(dv, p) !== CEN_SIG) {
      throw new Error(`corrupt zip: bad central-directory header at offset ${p}`);
    }
    const method = u16(dv, p + 10);
    const compSize = u32(dv, p + 20);
    const uncompSize = u32(dv, p + 24);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    const localOff = u32(dv, p + 42);
    const name = DEC.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/")) continue; // directory entry, no data

    // The LOCAL header's own name/extra lengths decide where the data starts.
    // They legitimately differ from the central directory's (writers routinely
    // put an extra field in one and not the other), so reading the central
    // directory's extraLen here would land mid-file on real archives.
    if (localOff + 30 > buf.length || u32(dv, localOff) !== LOC_SIG) {
      throw new Error(`corrupt zip: bad local header for "${name}"`);
    }
    const dataStart = localOff + 30 + u16(dv, localOff + 26) + u16(dv, localOff + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (raw.length !== compSize) throw new Error(`corrupt zip: truncated data for "${name}"`);

    let data;
    if (method === 0) data = raw.slice();            // stored — copy out
    else if (method === 8) data = await inflateRaw(raw, name);
    else throw new Error(`unsupported compression method ${method} for "${name}"`);
    if (data.length !== uncompSize) {
      throw new Error(`corrupt zip: "${name}" inflated to ${data.length}B, expected ${uncompSize}B`);
    }
    out.set(name, data);
  }
  return out;
}

/** Lowercase hex sha-256 of `bytes`. */
export async function sha256Hex(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error("crypto.subtle is unavailable (needs a secure context: https:// or localhost)");
  }
  const digest = new Uint8Array(await subtle.digest("SHA-256", view));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Assemble the flat ROM images the engine loads, straight from a romset zip.
 *
 * Same contract as tools/build-rom.mjs, same single source of truth: the part
 * list, concatenation order, size and sha256 all come from `manifest.rom`.
 *
 * @param {Uint8Array|ArrayBuffer} zipBytes
 * @param {object} manifestRom `manifest.rom` — {zip, images:{name:{parts,size,sha256}}}
 * @returns {Promise<{ok:boolean, images:Object<string,Uint8Array>|null, report:Array}>}
 *   `report` always has one entry per declared image, even on failure, so the UI
 *   can show exactly which image is wrong and what the visitor's zip produced.
 *   `images` is null unless EVERY image verified — never a partial success.
 */
export async function assembleImages(zipBytes, manifestRom) {
  const entries = await readZip(zipBytes);
  const images = {};
  const report = [];

  for (const [name, spec] of Object.entries(manifestRom.images)) {
    const missingParts = [];
    const parts = [];
    for (const p of spec.parts) {
      const data = findEntry(entries, p);
      if (data) parts.push(data);
      else missingParts.push(p);
    }
    if (missingParts.length) {
      report.push({
        name, expectedSize: spec.size, actualSize: 0,
        expectedSha256: spec.sha256, actualSha256: null, ok: false, missingParts,
      });
      continue;
    }

    // Concatenate in the manifest's exact order — this is the address order the
    // engine's flat image expects; a shuffled order verifies as a hash mismatch.
    let total = 0;
    for (const p of parts) total += p.length;
    const buf = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }

    const actualSha256 = await sha256Hex(buf);
    const ok = buf.length === spec.size && actualSha256 === spec.sha256;
    report.push({
      name, expectedSize: spec.size, actualSize: buf.length,
      expectedSha256: spec.sha256, actualSha256, ok, missingParts: [],
    });
    if (ok) images[name] = buf;
  }

  const ok = report.length > 0 && report.every((r) => r.ok);
  return { ok, images: ok ? images : null, report };
}
