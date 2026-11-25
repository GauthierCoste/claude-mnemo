# Coming next

> **Next work item: open Mnemo to other coding agents.** Each agent profile chooses its engine (Claude Code, Codex…) and
> its model; a session launched with that profile takes its engine. Codex comes first: memory over MCP, context and
> reminders through its hooks, then sessions launched from the interface. The work item of 24/11/2026 (one search score,
> deduplication, archivist tools) is built and its weights are tuned on the bench.

## Done

- **One score for search**: `score = base + Σ weights` (position + 0.10, confidence − 0.05 × (1 − c), memory + 0.05,
  freshness + 0.05 × 2^(−age/365); settings `recherche.poids…`, 0 to 0.5). The base spreads results (bm25 gap kept); the
  recall threshold (`seuil_rappel`, 0.4) applies to the relevance, so a weight never lets a result in. Each result shows
  its base and what sets it apart (current project, confidence, « récent » under a year); « servi » is shown as « actif ». See [usage.md](usage.md#how-a-result-is-ranked).
- **Right confidence**: a source note and its passages take the reliability of their source type; a declared fact that
  quotes the user takes the `utilisateur` reliability even when its source is a note imported from Claude Code (read from
  the `origine` of that note, wherever it is filed).
- **Deduplication**: one entry per document (a note and its passages) and per identical text of the same kind, the others
  listed as « + n copies »; the copy shown is the one near the current project, then the cited one, then the most recent;
  `proposer` still sees every copy. At import, a note already known under another origin gives no new note (it records its
  `origines`), and a note the archivist merged or redirected stays merged while it does not change in Claude Code.
- **Outdated facts**: a struck-through fact stays in its note and is no longer injected into a session; `lire` still
  returns the whole note. « Outdated » means struck through only.
- **Archivist tools**: the `entretenir` tool (delete, merge, fix a link; one commit per action) and a `menage` skill;
  renaming and moving stay with `deplacer`.
- **Bench**: the cases `saturation` and `doublons` and the measures « duplicates in the top 10 » (counted before
  deduplication), « extra copies » and « ties at the top » are in the bench and pass without models (see [banc.md](banc.md)).

## Left to do

- **Keep the reranker's gap in the base.** Weights tuned on 25/11/2026 with the real models (confidence 0.10 → 0.05,
  the others unchanged; default chain 45 of 56 in the top 5, MRR 0.718). No confidence weight passes both the
  `saturation` case (a relevant fact at 51 % must beat sure facts off topic) and the `confiance` case (a sure fact must
  beat an inferred one as relevant): the reranker sets the order of the top results, but their base keeps the nearly
  equal relevances from before it, so a tiny confidence gap reverses them. Give the base the reranker's margin, then
  sweep the confidence weight again.
- **Clean the real memory** with the new tools (duplicate copies, broken links, unreadable names, struck-through facts):
  the tools are delivered, the cleanup is done afterwards by the archivist or a session, under the user's control.
- **Show copies and reasons in the interface.** The search of the interface does not show the copies of an entry, its base
  or its reasons yet: `TrouveVue` (`packages/contrat`) carries none of `copies`, `base` and `apports`. Add them to the
  contract, then to the Memory view.
- Managing skills from the interface (see the README).
