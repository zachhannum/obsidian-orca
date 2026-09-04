/** Engine trouble. Only `ui` turns one into something an author sees. */
export class EngineError extends Error {
  override readonly name = "EngineError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
