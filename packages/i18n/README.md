# @oqf/i18n

String extraction and injection for Open Quest Format. Pure transformations over the model, no I/O and no dependencies beyond `@oqf/core` and `@oqf/dialogue`, so it runs in browsers and in Node.

A `text` field holds either a literal or a key reference such as `@harbormasters_ledger.trade.title`. Extraction moves literals into a table and leaves key references behind, injection writes them back. Keys come from structure, never from content, so they are stable across runs.

| Field | Key |
|-------|-----|
| Quest title, summary | `<questId>.title`, `<questId>.summary` |
| Step title, journal | `<questId>.<stepId>.title`, `<questId>.<stepId>.journal` |
| Outcome title | `<questId>.<stepId>.outcome.title` |
| Conversation title | `<conversationId>.title` |
| Node text | `<conversationId>.<nodeId>.text` |
| Choice text | `<conversationId>.<nodeId>.<choiceIndex>.text` |

```ts
import { createResolver, extractDocument, injectDocument, toCsv } from '@oqf/i18n'

const { document, table } = extractDocument(doc)
const csv = toCsv(table)
const back = injectDocument(document, table)

const resolve = createResolver({ en, fr }, { locale: 'fr', fallback: 'en' })
resolve(document.quests[0].title)
```

A field that already holds a key is left alone and is not added to the table. Two different literals under one key throw `I18nError`. Documents are never mutated, and any subtree with nothing to rewrite is returned by reference.

`injectDocument`, `injectDialogue` and `injectAll` take `{ missing: 'keep' | 'throw' | 'empty' }`, defaulting to `keep`, which leaves an unknown key reference in place.

Table adapters are symmetric pairs of `to<Format>` and `from<Format>`: JSON (a flat pretty map), CSV (`key,text`, RFC 4180 quoting), PO (the key is `msgctxt`, the source is `msgid`, the translation is `msgstr`) and XLIFF 1.2 (one `trans-unit` per key, written and parsed by hand). Reading PO or XLIFF takes the translation when it is filled in and the source string otherwise.
