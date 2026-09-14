/**
 * Validation findings, recomputed whenever a document changes.
 *
 * Quest findings come from `validatePack`, dialogue findings from
 * `validateDialogue`. Both are normalized into one list the panel can render
 * and click through, tagged with the document they came from. A validator that
 * throws is reported as a finding rather than taking the editor down.
 */
import { type OqfDocument, validatePack } from '@oqf/core'
import { type DialogueDocument, validateDialogue } from '@oqf/dialogue'

export interface EditorFinding {
  level: 'error' | 'warning'
  code: string
  message: string
  source: 'quests' | 'dialogue'
  quest?: string
  step?: string
  conversation?: string
  node?: string
  path?: string
}

/** The shape both validators produce, loose enough to survive added fields. */
interface RawFinding {
  level: string
  code: string
  message: string
  quest?: string
  step?: string
  conversation?: string
  node?: string
  path?: string
}

/**
 * Dialogue findings carry an index path (`conversations[0].nodes[2].next`)
 * rather than ids, so the ids are looked up here and the panel can select what
 * a finding is about.
 */
const DIALOGUE_PATH = /conversations\[(\d+)\](?:\.nodes\[(\d+)\])?/

function locate(
  dialogues: DialogueDocument,
  path: string | undefined,
): { conversation?: string; node?: string } {
  if (path === undefined) return {}
  const match = DIALOGUE_PATH.exec(path)
  if (match === null) return {}
  const conversation = dialogues.conversations[Number(match[1])]
  if (conversation === undefined) return {}
  if (match[2] === undefined) return { conversation: conversation.id }
  return { conversation: conversation.id, node: conversation.nodes[Number(match[2])]?.id }
}

function normalize(
  raw: RawFinding,
  source: EditorFinding['source'],
  where: { conversation?: string; node?: string } = {},
): EditorFinding {
  return {
    level: raw.level === 'error' ? 'error' : 'warning',
    code: raw.code,
    message: raw.message,
    source,
    quest: raw.quest,
    step: raw.step,
    conversation: raw.conversation ?? where.conversation,
    node: raw.node ?? where.node,
    path: raw.path,
  }
}

function crashed(source: EditorFinding['source'], error: unknown): EditorFinding {
  return {
    level: 'error',
    code: 'validator-crashed',
    message: error instanceof Error ? error.message : String(error),
    source,
  }
}

export function computeFindings(quests: OqfDocument, dialogues: DialogueDocument): EditorFinding[] {
  const findings: EditorFinding[] = []
  try {
    const result = validatePack([quests]) as unknown as { findings: RawFinding[] }
    for (const raw of result.findings) findings.push(normalize(raw, 'quests'))
  } catch (error) {
    findings.push(crashed('quests', error))
  }
  try {
    const result = validateDialogue([dialogues], { quests: [quests] }) as unknown as {
      findings: RawFinding[]
    }
    for (const raw of result.findings) {
      findings.push(normalize(raw, 'dialogue', locate(dialogues, raw.path)))
    }
  } catch (error) {
    findings.push(crashed('dialogue', error))
  }
  return findings
}

export function countFindings(findings: EditorFinding[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const finding of findings) {
    if (finding.level === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}
