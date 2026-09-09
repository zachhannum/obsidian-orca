/**
 * An error from the engine. Only `ui` turns one into something an author
 * sees.
 */
export class EngineError extends Error {
  override readonly name: string = "EngineError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * The engine of one book, stopped for good: it died more times than
 * orca sets the book again. `ui` holds the pages it has and offers the
 * log, which is what each death said, in order.
 */
export class EngineDead extends EngineError {
  override readonly name = "EngineDead";

  constructor(
    message: string,
    readonly log: readonly string[],
  ) {
    super(message);
  }
}
