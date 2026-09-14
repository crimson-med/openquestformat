/** Failures raised by extraction, injection and the table adapters. */
export class I18nError extends Error {
  /** The key the failure is about, when the failure is about one key. */
  readonly key?: string

  constructor(message: string, key?: string) {
    super(message)
    this.name = 'I18nError'
    this.key = key
  }
}
