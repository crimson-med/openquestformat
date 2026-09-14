/** Error shapes shared by the condition parser, formatter and checker. */

export interface ConditionError {
  message: string
  /**
   * Zero-based character offset into the source string.
   *
   * Checks that run over a tree rather than over text have no source positions
   * to point at, so `checkCondition` always reports -1.
   */
  offset: number
}

export class ConditionSyntaxError extends Error {
  readonly offset: number
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`)
    this.name = 'ConditionSyntaxError'
    this.offset = offset
  }
}
