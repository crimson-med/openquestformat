/** Rendering of validator findings for the human readable output of `oqf validate`. */
import type { Finding } from '@oqf/core'

/** A finding plus the file it was raised against. */
export interface FileFinding extends Finding {
  file: string
}

/**
 * The parenthesised location. Quest and step when the validator knows them,
 * the dotted path or source line otherwise, nothing at all for a pack-wide
 * finding that carries neither.
 */
function location(finding: Finding): string {
  const parts: string[] = []
  if (finding.quest !== undefined) parts.push(`quest ${finding.quest}`)
  if (finding.step !== undefined) parts.push(`step ${finding.step}`)
  if (parts.length === 0 && finding.path !== undefined) parts.push(finding.path)
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`
}

export function formatFinding(finding: FileFinding): string {
  return `${finding.file}: ${finding.level} ${finding.code}: ${finding.message}${location(finding)}`
}

/** Errors first, warnings after. Order inside each group is the order found. */
export function sortFindings(findings: FileFinding[]): FileFinding[] {
  const errors = findings.filter((finding) => finding.level === 'error')
  const warnings = findings.filter((finding) => finding.level !== 'error')
  return [...errors, ...warnings]
}

export function countErrors(findings: FileFinding[]): number {
  return findings.filter((finding) => finding.level === 'error').length
}

export function summaryLine(findings: FileFinding[]): string {
  const errors = countErrors(findings)
  return `${errors} errors, ${findings.length - errors} warnings`
}

/** The whole human readable report: one line per finding, then the summary. */
export function formatReport(findings: FileFinding[]): string {
  const sorted = sortFindings(findings)
  return `${[...sorted.map(formatFinding), summaryLine(sorted)].join('\n')}\n`
}
