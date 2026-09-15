/**
 * Every way in and out of a file, shared by the toolbar and the command
 * palette so both do exactly the same thing. The hook owns the hidden file
 * inputs; the toolbar renders them and hands the refs back here.
 */
import { useRef, useState } from 'react'
import { downloadText } from '../lib/download'
import {
  type DialogueFormat,
  MIME_TYPES,
  type QuestFormat,
  downloadName,
  serializeDialogues,
  serializeQuests,
} from '../lib/files'
import { mergePack, packFileName, packMime, splitPack } from '../lib/pack'
import { loadReference } from '../lib/reference'
import { type QuestTemplate, loadTemplate } from '../lib/templates'
import { useDispatch, useEditorState } from '../store/context'

/** `onLoad` runs before any action that replaces the document: open, template, reference, reset. */
export function useFileActions(
  onNotice: (message: string | undefined) => void,
  onLoad?: () => void,
) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const base = state.quests.quests[0]?.id ?? 'quests'

  const open = async (files: FileList | null) => {
    if (files === null || files.length === 0) return
    setBusy(true)
    try {
      const entries = await Promise.all(
        Array.from(files).map(async (file) => ({
          name: file.webkitRelativePath || file.name,
          text: await file.text(),
        })),
      )
      const pack = mergePack(entries)
      const names = entries
        .map((entry) => packFileName(entry.name))
        .filter((name) => name !== undefined)
      const hasQuests = pack.quests.quests.length > 0
      const hasDialogues = pack.dialogues.conversations.length > 0
      if (!hasQuests && !hasDialogues) {
        onNotice(['Nothing to open.', ...pack.notices].join(' '))
        return
      }
      onLoad?.()
      dispatch({
        type: 'doc/load',
        quests: hasQuests ? pack.quests : state.quests,
        dialogues: hasDialogues ? pack.dialogues : state.dialogues,
      })
      const opened =
        names.length > 4 ? `Opened ${names.length} files.` : `Opened ${names.join(', ')}`
      onNotice([opened, ...pack.notices].join(' '))
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      if (fileInput.current !== null) fileInput.current.value = ''
      if (folderInput.current !== null) folderInput.current.value = ''
    }
  }

  const exportPack = () => {
    try {
      const files = splitPack(state.quests, state.dialogues)
      if (files.length === 0) {
        onNotice('Nothing to export.')
        return
      }
      for (const file of files) downloadText(file.name, file.text, packMime(file.name))
      dispatch({ type: 'doc/markSaved' })
      onNotice(`Exported ${files.map((file) => file.name).join(', ')}`)
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const fromTemplate = (template: QuestTemplate) => {
    try {
      const loaded = loadTemplate(template)
      onLoad?.()
      dispatch({
        type: 'doc/load',
        quests: loaded.quests,
        dialogues: loaded.dialogues,
        selection: { kind: 'quest', quest: loaded.quests.quests[0]?.id ?? '' },
      })
      onNotice(`Created from the template ${template.title}.`)
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const exportQuests = (format: QuestFormat) => {
    try {
      downloadText(
        downloadName(base, format),
        serializeQuests(state.quests, format),
        MIME_TYPES[format],
      )
      dispatch({ type: 'doc/markSaved' })
      onNotice(`Exported ${downloadName(base, format)}`)
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const exportDialogues = (format: DialogueFormat) => {
    try {
      downloadText(
        downloadName(base, format),
        serializeDialogues(state.dialogues, format),
        MIME_TYPES[format],
      )
      onNotice(`Exported ${downloadName(base, format)}`)
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const loadReferenceQuest = () => {
    try {
      const reference = loadReference()
      onLoad?.()
      dispatch({
        type: 'doc/load',
        quests: reference.quests,
        dialogues: reference.dialogues,
        selection: {
          kind: 'quest',
          quest: reference.quests.quests[0]?.id ?? '',
        },
      })
      onNotice('Loaded the reference quest, The Harbormaster’s Ledger.')
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const reset = () => {
    onLoad?.()
    dispatch({ type: 'doc/reset' })
    onNotice('Cleared. Nothing is loaded.')
  }

  return {
    fileInput,
    folderInput,
    busy,
    open,
    exportPack,
    exportQuests,
    exportDialogues,
    fromTemplate,
    loadReferenceQuest,
    reset,
  }
}

export type FileActions = ReturnType<typeof useFileActions>
