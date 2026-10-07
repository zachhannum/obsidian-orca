import decompress from "brotli/decompress";
import encoded from "virtual:module";

let decoded: ArrayBuffer | undefined;

/**
 * The engine module, inflated from the bundle on the first call and
 * kept after that. A start transfers the bytes it is given, so a caller
 * passes the worker a copy.
 */
export function engineModule(): ArrayBuffer {
  if (decoded === undefined) {
    const text = atob(encoded);
    const packed = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) packed[i] = text.charCodeAt(i);
    // The decoder's array can sit inside a larger buffer, and the
    // engine reads the whole buffer.
    decoded = new Uint8Array(decompress(packed)).buffer;
  }
  return decoded;
}
