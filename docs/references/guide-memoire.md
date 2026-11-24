# Mnemo: memory implementation guide

Written on 2026-11-22, before the implementation; it records the direction taken. The value of the memory comes from the documents given to it (specifications, emails, meeting notes, shared folders), so that an agent answers and codes with knowledge of the company or the project.

The tool names and orders of magnitude below come from general knowledge, without recent verification. They are marked "to verify".

**Not everything here is in v1.** Absent from v1: OCR of scanned PDFs (pages without text are reported, not read),
spreadsheets, image descriptions, the external conversion tools named in section 2 (v1 has its own extractors for PDF,
Word, emails and text), sqlite-vec (vectors are stored in the SQLite index and compared by Mnemo), access rights per
source (section 10), confidence ageing and folder watching (a changed document is reindexed after a search or by
`mnemo index`). The tools given to the agent are named differently in v1 (`chercher`, `lire`, `lister`, `voisins`,
`chronologie`, `contexte`, `proposer`, `deplacer`, `extraire_source`, `entretenir`, `diagnostiquer`). What v1 does is described in
[usage.md](../usage.md) and [format-coffre.md](../format-coffre.md).

## 1. Three layers, not two

| Layer | Content | Status |
|---|---|---|
| Sources | The original files, never copied. Path, hash, date and access rights are kept. | Authoritative for the text |
| Passages | The extracted text, split, indexed by words and by meaning. | Derived, rebuildable, outside the memory |
| Notes and facts | What is true today, dated, sourced, linked. | The memory, authoritative for the truth |

The passage layer is essential in this direction. A one-line fact does not replace a business rule with its conditions. The fact is used to find and to decide, the passage is used to read. Each fact points to its passage, and the agent has a tool to read it.

## 2. Text extraction

- **Convert everything to Markdown while keeping the structure**: headings, lists, tables. The structure drives splitting and locating.
- **Keep an anchor for each piece**: file hash, page, heading path, position. Without an anchor, no verifiable quote.
- **By format**:
  - PDF with text: direct extraction. Scanned PDF: OCR, with the passage marked as "from OCR" and a lower confidence.
  - Word: conversion to Markdown (pandoc does this well).
  - Spreadsheets: one unit per sheet, headers repeated in each block of rows, formulas ignored in favour of values.
  - Images and diagrams: description by Claude, marked as such.
  - Emails: see section 3.
- **Tools to evaluate** (to verify): Docling and MarkItDown for multi-format conversion, poppler for PDF, tesseract for OCR.
- **Deduplicate before indexing**: exact hash for copies, strong similarity for near copies. A shared folder often holds the same file five times.
- **Detect version chains**: close names (`spec-v1`, `spec-v2`, `spec-final`) and very similar content. Record "version of" between sources. Only the latest version feeds the facts; the others stay available.

## 3. Emails

The richest and dirtiest source.

- **The unit is the thread**, not the message. Rebuild threads from the reply headers.
- **Remove quoted text and signatures** from each message. Otherwise each reply reindexes the whole thread and duplicates explode.
- **Each message keeps its author and date**: this is what tells who decided what, and when.
- **Attachments are child sources**, linked to the message.
- **Resolve relative dates** when extracting facts: "next Thursday" becomes an absolute date, computed from the date of the message.

## 4. Splitting into passages

- **Split along the structure**: by section, never cutting a table or a numbered list.
- **Target size**: 200 to 500 tokens. Too small, the passage loses its meaning. Too large, search becomes blurry.
- **Prefix each passage with its context** before indexing: document title, heading path, date, author, project. The prefix serves both the word index and the embeddings. It is the most profitable gain of the whole chain.
- **Small to search, large to read**: the passage is indexed, but the reading tool returns the whole parent section.

## 5. Fact extraction

Done by Claude at ingestion, never by a small local model.

- **A fact is atomic and self-contained**: a single statement, no pronouns, full names, absolute dates. It must be understandable without its document.
- **Extract only what lasts**: decisions, requirements, constraints, commitments, deadlines, roles of people, definitions of business vocabulary. Not a line-by-line summary.
- **Search before writing**: for each candidate fact, fetch the existing neighbouring facts and choose between adding, completing, replacing or doing nothing. This is the pattern used by mem0 (to verify). Without this step, the memory fills with duplicates.
- **Two times per fact**: the period during which it is true, and the date it was recorded. This is the Graphiti model, and it answers "what did we know in September?".
- **Resolve entities**: one note per person, organisation, project, with its aliases. "Mr. Smith", "John" and "JS" must lead to the same note. This is the first cause of an unusable graph.
- **Business glossary**: one vocabulary note per project. It improves every later search.

## 6. Arbitration between sources

The core of the value. Written in `SCHEMA.md`, applied by rules.

1. An explicit replacement always wins ("cancels and replaces", new version of the same document).
2. Otherwise, the most reliable source wins: signed contract, then validated specification, then meeting notes, then email, then note.
3. At equal reliability, the most recent wins.
4. If a less reliable but more recent source contradicts a more reliable one, decide nothing: create a contradiction to confirm.

Confirmation by exception: only the cases of point 4 and high-stakes facts (amounts, commitment dates, scope) need a human. The rest is accepted with the confidence of its source.

## 7. Index and search

- **By words**: SQLite FTS5, without accents. FTS5 has no stemming for French: compensate with prefix search, or index a column passed through a French stemmer.
- **By meaning**: sqlite-vec. It compares all vectors one by one (to verify), which holds up to a few hundred thousand passages. Beyond that, reduce the dimension or quantize the vectors.
- **Store the model with each vector**: name, version, dimension. A model change requires recomputing everything.
- **Respect the model prefixes**: many embedding models expect a different instruction for the query and for the document. Forgetting it degrades everything without any error message.
- **Fusion**: combine both rankings by rank (reciprocal rank fusion). No score calibration needed.
- **Filter before ranking**: project or client, user rights, invalidated facts, confirmation status.
- **Reranker** on the first 30 to 50, with the model kept loaded in memory.
- **Graph**: start from the notes found and follow links one hop, to bring back the client, the project and the people involved.
- **Threshold**: below a minimal score, return nothing. "I found nothing" is better than an off-topic passage.

## 8. Tools given to the agent

| Tool | Returns |
|---|---|
| `chercher(query, scope)` | Facts and passages, each with identifier, source, date, status. Short results. |
| `lire_fiche(id)` | A whole note. |
| `lire_passage(id)` | The original text with its section. |
| `lister(folder)` | The notes of a folder and its summary. |
| `proposer(...)` | Submits a write, returns the neighbouring facts to qualify. |

- Compact results with identifiers: the agent digs by itself.
- Always the source, the date and the status. An unconfirmed fact is marked.
- Broad questions ("where is project X?") are served by folder notes, not by a search.

## 9. Maintenance

- **Incremental**: watch the folder, compare hashes, reprocess only what changed.
- **Deleting a source**: its passages disappear, its facts are flagged "source gone", not erased.
- **Folder summaries**: rewritten by Claude when the hash of the child notes changes, with the date and the number of notes taken into account.
- **Ageing**: some categories lose confidence over time (contacts, roles, past deadlines).
- **Rebuild everything**: one command rebuilds the index from the memory and the sources. The index is disposable.

## 10. Security

To set from the start, especially for an installation at a client's.

- **Rights**: each source carries its rights. A passage inherits from its source. A fact inherits the most restrictive rights of its sources. The filter applies in the query, not afterwards.
- **Ingested content is data, never an instruction.** An email that contains "ignore your instructions" must trigger nothing. Wrap every source text in a tag that signals it to the agent, and never let a fact drawn from a document change the agent's behaviour.
- **Secrets**: detect passwords, keys and bank details at extraction, and do not index them.
- **Log**: who asked what, which passages were served.

## 11. Measure

- **Extraction quality**: on 5 documents, draw 50 facts at random and check each against its source (faithfulness), then list the 20 key decisions by hand and count those found (coverage).
- **Search**: 50 to 100 real questions with the right source known. Measure the presence of the right source in the first 5 results, variant by variant (words, plus meaning, plus reranker, plus graph).
- **Contradictions**: a set of 20 pairs of contradicting documents. Count those the system brings up.
- **Baseline to beat**: the same documents in Markdown in a folder, with an index, without an engine.

## 12. The most frequent mistakes

1. Indexing before deduplicating and handling versions.
2. Splitting at a fixed size without regard to headings and tables.
3. Embeddings alone, without word search: references, codes and proper names are missed.
4. Facts without an anchor to the passage.
5. Extracting too much: the memory becomes a second shared folder.
6. No entity resolution.
7. Having the human confirm everything.
8. Always returning five results, even when none is good.
9. Adding rights afterwards.
10. No test set, so no way to know whether a change improves things.

## 13. Build order

1. Extraction and anchors, on three formats (PDF, Word, emails).
2. Passages with prefix, word index, `chercher` and `lire_passage` tools. Already usable.
3. Search test set.
4. Embeddings and fusion, measured against step 2.
5. Fact extraction with neighbour search, arbitration by rules.
6. Entity resolution and links.
7. Reranker and graph, only if the measurement justifies it.
8. Incremental maintenance, rights, log.
