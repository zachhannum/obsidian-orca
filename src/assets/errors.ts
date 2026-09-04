/**
 * An error from `assets`: a file the vault does not have, or a path
 * outside it. Only `ui` turns one into something an author sees.
 */
export class AssetError extends Error {
  override readonly name = "AssetError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
