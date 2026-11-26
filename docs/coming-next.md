# Coming next

> **Next work item: measure Mistral Vibe with a real account.** It is connected (25/11/2026), but it was measured
> without an account, against a local fake model: each point below marked "not measured" needs a real session before it
> is called done. Then Windows, for the two optional engines.

## Done

- **Link an engine from the interface (26/11/2026, 1.8.0).** Settings › Système › Moteurs shows one card per engine,
  with its provider (Anthropic, OpenAI, Mistral), a one-word status and the link circuit (installed, version, memory,
  follow-up hooks, approval); « Lier à Mnemo » (`POST /api/moteurs/:id/lier`) declares the MCP server and installs or
  rewrites the hooks of that engine, and `mnemo declarer --moteur <id> --lier` does the same in a terminal, without any
  question. An engine installed after the service started is picked up by « Relire », without a restart. New session
  picks the agent like a character (provider, engine and version, model, equipment) and does not start an engine that
  is not linked, since Mnemo could not follow the session. `mnemo <command> --help` prints the usage of a command. See
  [usage.md](usage.md#engines).
- **Live ranking (25/11/2026).** Each meaningful message ranks every candidate note (the folder of the position, the
  neutral notes, the places named, the notes linked to a note injected by hand), refined by the reranker in the
  background. A confidence score, one small model per level of the models, is learned on your judgements (`mnemo banc
  contexte --extraire`, `--juger`, `--apprendre`; coefficients in `.mnemo/coefficients-note.json`). Accepted, it shows
  calibrated percentages, chooses the leads (`contexte.seuilPiste`, 10 %) and injects a note whole at the message itself
  (`contexte.seuilInjection`, 90 %, 2 at most per message); refused, it orders the ranking and chooses the leads without
  %. Automatic injection is watched over its last 100 injections and stops when the lower Wilson bound falls under 0.75;
  « Réactiver » starts it again. The history of your gestures gives each note a prior; ✗ offers « Pas pour cette
  session » and « Ne plus jamais suggérer », restored from the page of the note in Mémoire, and a note set aside in 3
  sessions brings a suggestion. Replaces the fixed cards of the folder at the first message (`contexte.cartesPerimetre`,
  removed). See [usage.md](usage.md#injected-context).
- **Open Mnemo to other coding agents (Codex first).** Each profile chooses its engine (Claude Code or Codex) and its
  model (empty: the engine's default); a session keeps both, resume included. A `Moteur` port holds what differs between
  engines. Codex 0.171 or later: memory over MCP in every Codex session (`mnemo init --codex`, `mnemo declarer --moteur
  codex --lier`), Mnemo hooks installed once in `~/.codex/hooks.json` and approved in Codex (`/hooks`), inert outside a Mnemo
  session; context and reminders, checked instructions (`Bash` commands, `apply_patch` paths); sessions started, resumed
  (`codex resume`), wrapped up and stopped (`/quit`) from the interface, skills listed in the instruction and read with
  `lire`; context gauge and ChatGPT quotas read from the transcript, shown next to the Claude ones. `verifier-poste` and
  Settings › Système › Moteurs show the state of each engine and what fixes it. See
  [installation.md](installation.md#codex) and [usage.md](usage.md#codex-sessions).
- **Mistral Vibe as an engine.** One more implementation of the `Moteur` port, next to Claude Code and Codex. Mistral
  Vibe 3.1.5 or later (`mnemo init --mistral`): MCP block and `mnemo-…` hooks in `~/.vibe`, instruction and skills in an
  agent profile of the session, resume with `vibe --resume`; context and reminders, checked instructions, context gauge,
  state in Settings › Système › Moteurs, profiles and sessions in the interface; no readable quotas. See
  [installation.md](installation.md#mistral-vibe) and [usage.md](usage.md#mistral-vibe-sessions).
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

- **Learn the confidence score on real judgements.** The defaults shipped with Mnemo have learned nothing, so the ranking
  stays in « ordre seul » and nothing is injected automatically. Judge real messages (`mnemo banc contexte --extraire`,
  then `--juger`) until `--apprendre` accepts a model for each level, then check on real sessions that the thresholds
  (90 % to inject, 10 % for leads) and the watch of automatic injection hold; adjust them with the report if they do not.
- **A confidence score that learns from use (later).** Today the weights of the score change only when `mnemo banc
  contexte --apprendre` is run by hand, and the prior of the gestures enters the model only if it is non-zero on enough
  pairs (30, from 5 sessions): the gestures of every day do not move the score. Relearn in the background (each night, or
  every N sessions) on the bench judgements plus the gestures taken as implicit judgements (➤ or a note read by the agent:
  relevant; ✗: not relevant; a note left at the top of the ranking: weakly not relevant), behind the same acceptance gate
  (a refused model leaves the current one in place). To design from the start: exposure bias (only what was shown gets a
  gesture: keep the notes drawn outside the pile, weight each gesture by the chance that its note was shown) and the
  rarity of gestures (the bench judgements stay the base, the gestures adjust it).
- **Mistral Vibe with a real account.** Measured so far against a local fake model, without an account. To measure
  with a real Mistral account: the real list of models and the default model, the real context window, the screens
  after sign-in, and the points still marked "not measured": `process.start`, `question_asked` and `turn_failed`, the
  `post_tool` of `file_system.edit`, the approval asked by a sub-agent and its `post_tool`, `/clear` (and `/clear` typed
  in a `vibe` started from a session); `VIBE_HOME` written with `~`. Also, with a real account:
  - **Vibe with a real Mistral model** (the decisive point): whether `search_tool_functions` and `run_typescript` show up
    and how Mnemo should treat them; `--agent` together with the approval policy and `enabled_agents`; the reasoning
    tokens in the context gauge.
  - **Windows**: a `%` in a command quoted by `citerCmd`.
- **Windows for the optional engines.** Not measured: `vibe.exe` and its hooks run by `cmd.exe` (or by PowerShell or Git
  Bash when Vibe is set so, where the `MNEMO_MOTEUR` guard is not read), the Codex hooks under a non-POSIX login shell.
- **A dialog that stays shown after its answer.** After an approved command, Codex keeps showing « Attend ta réponse »
  while the command runs, until its next hook (the next tool, a message or the end of the turn): its `PostToolUse` hook
  only covers patches and Mnemo tools, and changing it makes every user approve the hooks again.
- **A dialog closed by the wrong tool.** A dialog is closed only by the after-tool hook of the tool it names (Vibe
  `approval_requested`, Codex `PermissionRequest`). Not measured: whether both hooks give the same tool name (Codex
  `apply_patch`, Vibe tools of a sub-agent).
- **Quotas of Mistral.** Vibe does not write them where Mnemo can read them (outside its API); shown as « non
  communiqués » until it does.
- **The desktop app** may add the engine `mistral-vibe` and the `init` steps `mistral` and `mistral_hooks` at its next
  upgrade of the contract; nothing is required.
- **Archivist on any engine.** The archivist and its benches run on Claude Code (`claude -p`); make its engine a setting.
- **Import Codex's own memory**, as `mnemo amorce` imports Claude Code's.
- **Reasoning tokens in the Codex context gauge.** The gauge counts `input_tokens + output_tokens` of the last
  `token_count`; `reasoning_output_tokens` was 0 in every measured event, so whether it is included in `output_tokens` is
  unknown. Measure again on a session with reasoning.
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
