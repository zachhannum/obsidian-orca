declare module "brotli/decompress" {
  const decompress: (compressed: Uint8Array) => Uint8Array;
  export default decompress;
}
