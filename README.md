# TypesMem

[![TypeScript](https://img.shields.io/badge/implementation-native%20TypeScript-3178c6)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-EPL--1.0-blue)](LICENSE)

TypesMem is a TypeScript translation memory engine backed by SQLite. It stores translation units (TUs) with full TMX 1.4 fidelity, imports and exports TMX files, and provides fuzzy and concordance search over the stored content.

## Why TypesMem

- **No native bindings.** Storage is built on `node:sqlite`, which ships with Node.js itself — no native module to compile, no ABI mismatches under Electron or across platforms.
- **CJK-friendly fuzzy matching.** Matching uses a custom 3-character sliding-window (trigram) index instead of SQLite's FTS5, since FTS5's tokenizers don't segment Chinese, Japanese, or Korean text well. The index is language-scoped, so each language's trigrams are matched independently.
- **Synchronous API.** Every operation is backed by `node:sqlite`'s synchronous `DatabaseSync`, so there's no `Promise`/`async` ceremony for what are, in practice, sub-millisecond local calls.
- **Full attribute fidelity.** Every optional attribute TMX 1.4 allows on `<tu>` and `<tuv>` (`creationdate`, `creationid`, `changedate`, `changeid`, `usagecount`, `o-encoding`, `o-tmf`, and the rest) round-trips exactly — nothing is fabricated on import, and nothing is silently dropped on export.
- **Internationalized.** Error messages are localized (English and Spanish included) via a small resource-bundle-based `I18n` class.

## Installation

```bash
npm install typesmem
```

## Quick Start

### Import a TMX file, search it, export it back out

```ts
import { TranslationMemory } from "typesmem";

const tm = new TranslationMemory("myMemory", "/path/to/memories");

const count = tm.storeTMX("/path/to/file.tmx", undefined, (imported) => {
    console.log("Imported " + imported + " translation units so far");
});
console.log("Import finished: " + count + " translation units");

const matches = tm.searchTranslation("Hello world", "en-US", "es-ES", 70, 10);
for (const match of matches) {
    console.log(match.similarity + "% - " + match.target.toString());
}

tm.exportMemory("/path/to/export.tmx", ["en-US", "es-ES"], "en-US");

tm.close();
```

### Store and retrieve a single translation unit

```ts
import { TranslationMemory } from "typesmem";
import { XMLAttribute, XMLElement } from "typesxml";

const tm = new TranslationMemory("myMemory", "/path/to/memories");

const tu = new XMLElement("tu");

const sourceTuv = new XMLElement("tuv");
sourceTuv.setAttribute(new XMLAttribute("xml:lang", "en-US"));
const sourceSeg = new XMLElement("seg");
sourceSeg.addString("Hello world");
sourceTuv.addElement(sourceSeg);
tu.addElement(sourceTuv);

const targetTuv = new XMLElement("tuv");
targetTuv.setAttribute(new XMLAttribute("xml:lang", "es-ES"));
const targetSeg = new XMLElement("seg");
targetSeg.addString("Hola mundo");
targetTuv.addElement(targetSeg);
tu.addElement(targetTuv);

const tuid = tm.storeTu(tu, { project: "demo" });

const stored = tm.getTu(tuid);
console.log(stored?.toString());

tm.removeTu(tuid);
tm.close();
```

## API Overview

### Lifecycle

| Method | Description |
| --- | --- |
| `new TranslationMemory(name, workFolder, lang?)` | Opens (or creates) a memory named `name` under `workFolder`. `lang` selects the language for TypesMem's own error messages (`"en"` or `"es"`, default `"en"`) — it has nothing to do with the languages stored in the memory. |
| `getName()` / `getType()` | Returns the memory's name, and `"Local"` as its engine type. |
| `close()` | Closes the underlying database connection. |
| `deleteDatabase()` | Closes the connection and deletes the memory's folder. Don't call `close()` first — this already closes it. |

### Storage

| Method | Description |
| --- | --- |
| `storeTu(tu, metadata?)` | Stores a `<tu>` element (a `typesxml` `XMLElement`), returning its `tuid`. If the element already has a `tuid` matching an existing entry, that entry is fully replaced (including all its `<tuv>`s, properties, and notes); otherwise a new entry is created, generating a `tuid` if the element doesn't have one. `metadata` supplies default `<prop>` values for keys not already present on the TU. |
| `getTu(tuid)` | Returns the full `<tu>` element for a given `tuid`, or `undefined`. |
| `removeTu(tuid)` | Deletes a translation unit and all of its associated data. |

### Search

| Method | Description |
| --- | --- |
| `searchTranslation(text, srcLang, tgtLang, similarity, limit?, caseSensitive?)` | Fuzzy-matches `text` against `srcLang` segments (`similarity` is 0-100) and returns `Match[]` — each with `source`/`target` `<tuv>` elements, a `similarity` score, `origin`, and `properties` — for translation units that also have a `tgtLang` variant. |
| `searchAll(text, srcLang, similarity, limit?, caseSensitive?)` | Same fuzzy matching as `searchTranslation`, but only requires a `srcLang` match; returns the full `<tu>` element for each hit regardless of what other languages it has. |
| `concordanceSearch(text, srcLang, limit?, caseSensitive?)` | Plain substring search (not fuzzy) against stored `srcLang` text, returning full `<tu>` elements. |
| `getMetadataValues(field)` | Returns the distinct values stored for a given metadata/property field name, across the whole memory. |

### TMX import/export

| Method | Description |
| --- | --- |
| `storeTMX(tmxFile, metadata?, onProgress?)` | Imports a TMX file, returning the number of translation units stored. `onProgress` is called periodically (every 500 TUs) with the running count. |
| `exportMemory(tmxFile, langs, srcLang)` | Writes a TMX 1.4 file containing only the given `langs`, skipping any translation unit left with fewer than two language variants after filtering. |

## Design notes

A memory is a single SQLite database file (`database.db`) under its own folder. Fuzzy matching is powered by a per-language trigram index: while importing, ngram occurrences are written to a fast `(ngram, id)` table and periodically compacted into a compact packed form, so bulk imports stay fast without leaving the index bloated; a single `storeTu` call outside of a bulk import writes directly into the compact form, since there's no bulk-write pressure to justify the temporary structure.

## License

Eclipse Public License 1.0 — see [LICENSE](LICENSE).
