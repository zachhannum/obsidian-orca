import encoded from "virtual:module";

let decoded: ArrayBuffer | undefined;

/**
 * The engine module, decoded from the bundle on the first call and kept
 * after that. A start transfers the bytes it is given, so a caller
 * passes the worker a copy.
 */
export function engineModule(): ArrayBuffer {
  if (decoded === undefined) {
    const text = atob(encoded);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    decoded = bytes.buffer;
  }
  return decoded;
}
