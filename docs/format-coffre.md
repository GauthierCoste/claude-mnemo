# Memory format

Grammar of the Markdown notes in `_mnemo/`. The reference code is `packages/mnemo/src/domaine/`. A line that does not follow the grammar is not rejected: it is kept as is when Mnemo rewrites the note.

Keywords stay in French in the files themselves (`declare`, `appris`, `valide`…): this page gives their meaning.

## Information line

```
- [category] statement | mention | mention … ^f-NNNN
  > « quote »
```

- The line starts with `- `. It is 500 characters at most.
- `[category]` is optional: `^[\p{Ll}\p{N}_-]{1,40}$` (lowercase letters, digits, `_`, `-`).
- The statement is not empty and contains no `~~`, except to strike it through: `~~statement~~` (the category stays outside the strike-through).
- Mentions are separated by ` | ` (space, bar, space). A `|` without surrounding spaces, as in `[[note|alias]]`, is part of the text.
- Each mention appears at most once. When writing, the order is the order of the table below; when reading, any order is accepted. An unknown or repeated mention makes the line malformed.
- The anchor ` ^f-NNNN` (`f-` and 4 to 9 digits) ends the line. A reference `^f-NNNN` at the end of the line that follows `invalidé AAAA-MM-JJ par` or `contredit` belongs to the mention, not to the anchor.

| Mention | Form | Meaning |
|---|---|---|
| nature | `declare`, `observe` or `infere` | origin of the information: declared, observed, inferred |
| source | `src: text` | document, thread or person it comes from (`[[…]]` links allowed) |
| learned | `appris AAAA-MM-JJ` | date the information was learned |
| validity | `valide [start,end)` or `valide [start,end]` | period during which the information is true; `start` or `end` can be empty (not both); `)` excludes the end, `]` includes it |
| confidence | `confiance N %` | integer from 0 to 100 |
| to confirm | `a confirmer` | the information waits for a confirmation |
| contradiction | `contredit ^f-NNNN` | the information contradicts the one anchored `f-NNNN` without deciding. Confirming it strikes the contradicted information (`invalidé AAAA-MM-JJ par ^…`, end of validity set to the day if it was open); rejecting it leaves it untouched. The mention stays after the decision |
| invalidation | `invalidé AAAA-MM-JJ` or `invalidé AAAA-MM-JJ par ^f-NNNN` | date, and the information that replaces it |

## Quote

Optional next line: two spaces, `> « `, the text (500 characters at most), ` »`.

## Corroborations

Further sources of the same information follow the quote, one line each (two spaces, `+ src: `, the source, ` | corroboré AAAA-MM-JJ`, the day it was added), each line 500 characters at most, each with its own optional quote line:

```
- [category] statement | declare | src: [[sources/a]] | confiance 79 % ^f-0001
  > « quote of the first source »
  + src: [[sources/b]] p. 4 | corroboré 2026-11-24
  > « quote of the second source »
```

The lines are read until the first one that is not a corroboration; a `  + src:` line with no information above it stays a raw line, kept as is. A source whose text contains ` | ` is refused. The `confiance` of the information is the cumulated confidence (see [usage.md](usage.md#maintaining-information)); the format keeps neither the type nor the confidence of each source. A struck-out information keeps its corroboration lines, but they are never injected. The quotes of corroborations are searched like the others, and their links count in the link graph; the `source` of a search result stays the first one.

## Same statement

Two pieces of information have the same statement when their category, text and validity are equal. Mentions, strike-through, repeated spaces and the target of `[[…]]` links do not count.

## Note

A UTF-8 Markdown file. Read with LF or CRLF, always written with LF, with a single final `\n`.

```
---
id: 01JD...
type: sujet
alias: [Stock spec]
updated: 2026-11-22
---
# Title

Summary (free text, optional).

## Informations
…information lines…

## Relations
- concerne [[path/to/the/note]]

## Other section
Free text kept as is.
```

### Frontmatter

YAML between two `---` lines. Keys are written in this order: `id`, `type`, `alias` (inline list `[a, b]`, omitted when empty), `updated` (`AAAA-MM-JJ`), `ancre_max` (omitted unless needed, see below), then the other keys in their original order (`portee`, `niveau`…: kept, never interpreted by the note parser). The frontmatter can be missing; a frontmatter that is not valid YAML is an error. A note without `id` that Mnemo rewrites (information, relation, decision, instruction, move, rewritten link) receives an `id` (ULID) in the same write.

`ancre_max` is the highest anchor number ever given in the note (`ancre_max: 12`), an integer from 1 to 999999998 (the next anchor still fits in 9 digits); any other value is malformed: kept as is among the other keys, and ignored. It is written when the highest anchor has left the note (information moved, deleted or merged), so that the number of an anchor is never given twice and no link ends up pointing at another information. Mnemo manages it: it is not among the other keys. It is reconsidered only when information leaves the note: dropped then if the highest anchor ever given is still present, kept otherwise. Between two departures it stays as written, harmless, even once a new anchor has been given above it.

`type` is free: a lowercase letter, then lowercase letters, digits, `_` or `-`, 40 characters at most (`personne`,
`organisation`, `module`…). Without `type`, the note is a `sujet` (topic); a malformed value is an error. Five types are
reserved, because a mechanism of Mnemo depends on them:

| Reserved `type` | Note |
|---|---|
| `consigne` | instruction (see "Instruction notes") |
| `profil` | profile of a kind of session (see "Profile notes") |
| `source` | document or imported note (see "Source notes of a document") |
| `episode` | episode of a session (see "Episode notes") |
| `dossier` | note of a folder (`d/d.md`): its summary says what the folder holds |

The types already used in the memory are listed to Claude in the description of `proposer`, so that it reuses them.

### Body

- The title is the first non-empty line of the body, if it starts with `# `. Otherwise the note has no title: all the text before the first section (a late `# ` and what precedes it included) is the summary, rewritten as is. The summary is the text between the title and the first `## ` section.
- A section starts with a `## Title` line outside a code block. A code block opens with ```` ``` ```` or `~~~` (three at least) and closes only with the same character, repeated at least as many times, alone on its line. `## Informations` and `## Relations` are interpreted; the former title `## Faits` is read as `## Informations` and rewritten under that title; any other section is kept as is (`autresSections`).
- When writing: title, summary, then the sections in the order they were read (a note edited by hand keeps its order); without an original order: `## Informations`, `## Relations`, other sections. A section that was absent when reading and is empty is not written. Blocks are separated by an empty line; empty lines at the start and end of a section are not kept.
- In `## Informations`, each line that the grammar above rejects (and the `  > …` line that follows it) is kept as is, in place. Empty lines between two lines are kept; those at the start and end of the section are not.
- A relation: `- verb [[target]]`. Any other line of `## Relations` (and any inner empty line) is kept as is, in place.
- Next anchor: highest anchor number of the note (lines kept as is included) + 1, on 4 digits at least; `f-0001` for a note without anchors.

## Paths

- Relative to `_mnemo/`, separated by `/`, ending with `.md`, without characters forbidden on Windows (`<>:"\|?*`, control characters), reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…, `LPT1`…), or a segment ending with `.` or a space.
- Mnemo never writes or moves: `SCHEMA.md` (edited by hand only), a path with a segment starting with `.` (`.git`, `.obsidian`…), a path containing `#`, `^`, `[`, `]` or `|` (link syntax).
- Two notes never differ only by case: a request aimed at a case variant of an existing note is refused and names the path to use.
- Name derived from a title: forbidden characters and link syntax replaced by ` - `, 120 code points at most, reserved name suffixed with `_`.
- Source link `[[sources/doc#Section]]`, `[[sources/doc^block]]` or `[[sources/doc|alias]]`: the source note is `sources/doc.md`.

## Folder tree and scope

The folder tree of `_mnemo/` belongs to the user: `mnemo init` creates no folder, and no code reads a note back at a
fixed place, except `profils/` and `skills/`. A note that Mnemo creates without a given path goes to a default folder:
`consignes/` (or `<place>/consignes/` for an instruction whose scope a place declares), `episodes/<project>/`, `sources/`,
`sources/claude-code/`. It can then be moved anywhere.

- **Moving** (`deplacer`, MCP tool): a note goes to another folder, optionally renamed (`nom`); the note of a folder
  (`d/d.md`) takes its whole folder with it, subfolders included. The links that point to the moved notes are rewritten,
  a renamed note keeps its old name as an alias, all in one commit; a failure puts every file back. Refused: a profile,
  anything into or out of `profils/` and `skills/`, a destination that exists or lies inside the moved folder.
- **Place**: any note whose type is not `consigne`, `profil`, `source` or `episode` (a folder note, or a simple note).
- **Scope of a place**: given only by the `portee` key of its note (`projet:name`, `client:name` or `stack:name`); the
  name of a folder never gives a scope. A position in the memory receives the scopes declared by the places that contain
  it, and those of the notes its place notes point to by a relation. The instructions of these scopes (and the `globale`
  ones) apply there; the `projet:` or `client:` scope also names the episodes folder of its sessions.
- **Project folder**: `dossier_projet` on a place note links it to a folder of the root (relative path); the sessions
  that run in that folder take this place as their position.

## Source notes of a document

A `source` note that references a document (written by `extraire_source` or `mnemo source`) carries, in its frontmatter:

| Key | Meaning |
|---|---|
| `chemin` | path of the document, relative to the root of the Mnemo folder (the document is never copied) |
| `empreinte` | hash of the document bytes at write time |
| `format` | extracted format (`markdown`, `texte`, `pdf`, `pdf-sans-texte` for a PDF without any text layer, `docx`, `eml`, `mbox`) |
| `type_source` | type of the document (`inconnue`, `contrat`, `email`…); also carried by the note of the folder of its threads and attachments |
| `version_de` | `[[sources/…]]`: the previous version; its passages (and those of its threads and attachments) become `ancienne_version` |
| `fils` | for a file with several threads (`.mbox`): their number; this note has no passages, each thread has its own note |
| `fil` | note of a thread: its stable key (Message-ID of the first message, otherwise `sujet-<hash>`); an integer (rank) is still read, for older notes |
| `source_parente` | `[[sources/…]]`: the note of the file, for a thread or an attachment |
| `piece` | note of an attachment: its name in the email (no `chemin`) |
| `piece_position` | note of an attachment: its position in the file (1 = the first), which tells it apart from another attachment with the same name |

A file dropped in the interface gets a `source` note with `origine: depot` and `a_traiter: true`, whatever its format;
a file that is not text and has no extractor (image, spreadsheet…) is kept but has no passages.

`date` and `auteur`, when the document gives them, are copied (secrets masked). A `## Pièces jointes non indexées` section lists the attachments that are not text and whose format has no extractor, that exceed 256 MB (attachment limit, see [document-limits.md](references/document-limits.md)), or that cannot be read.

## Imported Claude Code memory

"Importer la mémoire de Claude" (Memory view) and `mnemo amorce` run the same import, on demand only, in one commit `mnemo: amorçage (N fiches)`; nothing is ever written to the Claude Code configuration (`CLAUDE_CONFIG_DIR`, otherwise `~/.claude`), and no note is deleted when a file disappears.

- Each note `projects/<key>/memory/**/<note>.md` (subfolders and `MEMORY.md` included, extension matched without case) and the global `CLAUDE.md` become a `source` note, written by default to `sources/claude-code/<project>/<note>.md` (it can be moved: a new import finds it by its `origine`), with the text (secrets masked) in a `## Contenu` section; keys `type_source` (`note`, `utilisateur` for the global CLAUDE.md), `origine`, `empreinte_origine` (the note is rewritten only when it changes). `origines` lists every origin whose content a note holds (its own first): the same note found in several projects, or a note merged into it or redirected to it by the archivist (`entretenir`); `empreintes_origines` maps each origin received from the archivist to the fingerprint of its note, so that a new import skips it while it is unchanged and imports it again, as a note of its own, once it changes. Any note can hold them, not only a `source`. When the Claude Code folder key (`-home-…-projects-x`, the encoded project path) is the one of a folder inside the Mnemo folder, the note carries `projet: <folder>` (relative to the root).
- The `CLAUDE.md` (any case) of each detected project and the `.md` files under its `.claude/` (never `settings*.json` or another file, never a hidden folder or another git repository below) are referenced as documents: a `source` note `sources/claude-code/<project>/<name>.md` (`CLAUDE`, `claude-rules-x`…) with `chemin`, `empreinte`, `format`, `type_source: note`, `projet`; their passages are indexed. A file already referenced by another source keeps its note (`empreinte` and `projet` updated).
- New or changed notes carry `a_traiter: true` (in the same commit): this is the archivist's queue, durable and visible (`lister` shows them as "à traiter", to process). The archivist removes the marker of a processed note with `proposer`, genre `modification`, `traitee: true`. A single instruction, which names this marker (replayable), goes to the running archivist, in the background, at each import while notes remain to be processed; if it is not running, the instruction goes with its launch (objective of the session). It is never launched for this alone.
- A write or commit failure puts every file back as it was: no partial write, and running again finds everything to import. Two simultaneous imports by the service run one after the other. An instruction file over 1 MB is ignored; a Claude Code configuration placed inside a project is never read as its instructions; a truncated folder name (long path) receives a hash suffix.

## Instruction notes

A `consigne` note: its summary is the text of the instruction (one line); its frontmatter carries:

| Key | Values |
|---|---|
| `portee` | scope: `globale` (default), `stack:name`, `projet:name` or `client:name`; any other value makes the instruction invalid, never injected |
| `niveau` | level: `rappelee` (reminded, default), `toujours` (always) or `verifiee` (checked) |
| `repetitions` | list of the dates when the user repeated it |
| `regle` | `{ type, motifs }`: the rule applied at the `verifiee` level |
| `proposition` | `{ niveau, regle?, date, source }`: level raise or rule proposed by a session, to confirm; an incomplete or invalid value is ignored |

**Rule**: `type` `chemins_interdits` (forbidden paths) or `commandes_interdites` (forbidden commands); `motifs`: 1 to 20 patterns of 1 to 200 characters, not blank, without control characters. A `verifiee` instruction whose rule is missing or invalid cannot be checked: while it applies, actions are refused with a message that asks to repair it.

- `chemins_interdits`: tools `Write`, `Edit`, `MultiEdit`, `NotebookEdit` (`file_path`, `notebook_path`). The written path is resolved from the Claude Code working directory, made relative to the root of the Mnemo folder and separated by `/` (`\` becomes `/`, drive letter, `.` and `..` resolved). Whole-path glob: `*` (within a segment), `?` (one character), `**` (any depth); `**/.env` matches `.env` everywhere, root included; `vendor/**` matches `vendor` and everything inside it. A path outside the root only matches an absolute pattern (`/etc/**`, `C:/Windows/**`); an absolute pattern also matches paths under the root. A pattern never goes up: `../x` or `a/../b` are refused. Case-insensitive on macOS and Windows, root included (and always for a path with a drive letter).
- `commandes_interdites`: tool `Bash`. The command is split into simple commands (`;`, `&&`, `||`, `|`, background `&`, newline; outside quotes); a `#` outside quotes, at the start of a word and outside `${…}`, `$(…)` and backticks, opens a comment up to the end of the line; spaces are collapsed. Each simple command is compared in its raw form **and** in each form obtained by removing, one by one at the start, the assignments `VAR=val` and the prefixes `sudo`, `command`, `exec`, `nohup`, `time` (with the options that follow `sudo` or `time`, and the argument of `-u`, `-g`, `-h`, `-p`, `-C`, `-D` for `sudo`), `!`, `then`, `do`, `else` and `{` (separate words, as in bash) and `(` (even attached); 32 forms at most. So `sudo -u root git push --force` matches `git push --force*`, and `sudo *` still matches `sudo rm x`. A glob pattern (`*`: any sequence, `?`: one character) matches the **start** of a form: `git push --force*`, `rm -rf /*`.

Matching runs in O(pattern × text) time, without backtracking; a path over 4,096 characters or a command over 16,384 cannot be compared and the action is refused (it can be split or shortened).

This is a reminder, not a sandbox. These get through, among others: `$(…)` and backticks, `bash -c "…"`, `env git push --force`, a binary by its absolute path (`/usr/bin/git push --force`), moved options (`git push origin --force`), a short option (`git push -f`), a quoted option (`git push "--force"`), a line continuation that splits the option, a script, an MCP tool that writes. Conversely, the body of a heredoc is read line by line as commands: it can cause a wrong refusal (Claude can then write the file with `Write`). The `outil` hook reads the `verifiee` instructions of the position (the scopes that apply there) from the index as it is, without synchronizing it (it is synchronized at each message), then their rule from the note. When the check cannot finish (error, unreadable index or input, deadline of 2 s exceeded), the action is **refused** if the memory may contain verified instructions, and allowed only when the local state (`.mnemo/consignes-verifiees.json`, written at each synchronization) says that it contains none, or on a fresh installation without an index. When verified instructions may exist at the launch of a session, its `PreToolUse` hook is also declared with `onFailure: block`, so that Claude Code refuses the tool if the hook itself fails or times out. Refusal returned to Claude Code: `permissionDecision` `deny`, reason « Mnemo : consigne vérifiée « text » (motif « pattern »). », or a message that says why the action could not be checked.

**Genre `niveau` of `proposer`**: `{ fiche, niveau?, regle?, retirerProposition?, source }`, source `utilisateur` or `session`. From a session: level and rule are stored as a `proposition` (commit `mnemo: propose niveau <path>`), the level in force does not change. From the user through a trusted channel (command line, HTTP service): applied, the proposal cleared (`mnemo: niveau <path>`). Through MCP only an agent calls: any `niveau` request, whatever the declared source, stays a proposal, and `retirerProposition` is refused. `verifiee` requires a valid rule (given, or already carried). `retirerProposition` (user, trusted channel) rejects the proposal (`mnemo: rejette niveau <path>`).

**Genre `modification` of `proposer`**: `{ fiche, synthese?, sections?, type?, titre?, alias?, traitee?, dossier_projet?, portee?, appliquerProposition?, retirerProposition?, source }`, on an existing note. `synthese` replaces the text before the first section (without a `# ` or `## ` line outside a code block); `sections` is an object `{ "Title": "text" }`: the section is replaced, created if absent (at the end), removed if the text is empty; never `Informations` (nor `Faits`) or `Relations`, which have their own genres. `type`: a well-formed note type (free, except the reserved ones), never to or from `consigne` and `profil`; outside the user channel (so always through MCP), never to or from `source` and `episode`; `titre`: the `# ` line; `alias` replaces the list; `traitee: true` removes the `a_traiter` marker of a note (processed by the archivist); `dossier_projet` (on a place only) and `portee` (`projet:name`, `client:name` or `stack:name`; never on an instruction, whose scope changes through the genre `consigne`) set the project folder and the scope of a place, an empty text removes them. Nothing else in the frontmatter changes, except `updated`. Secrets masked. One commit `mnemo: fiche <path> (<targets>)` ("synthese, section Conventions, type…"); the answer says what changed (`changements`, old to new, shortened); nothing to change: `doublon`. On an instruction or a profile, a modification that does not come from the user through a trusted channel (so always through MCP) is stored in the `modification_proposee` frontmatter key (`{ targets…, date, source }`, commit `mnemo: propose fiche <path> (<targets>)`), validated as if it were applied, shown in the feed, and the note does not change (a new proposal replaces the previous one); `appliquerProposition` (applies it) and `retirerProposition` (`mnemo: rejette fiche <path>`) are reserved to the user. A document never changes an instruction or a profile.

**Genre `retirer_relation` of `proposer`**: `{ fiche, verbe, cible }`. Removes from `## Relations` of the note the relations `- verbe [[cible]]` whose target designates the same note as `cible` (by path, name or title). Refused if none matches (the answer lists the relations present). One commit `mnemo: retirer_relation <path>`.

**Genre `retirer_dossier` of `proposer`**: `{ dossier }`. Removes an empty folder from the memory (the path is first brought back to its case on disk): it contains only `.DS_Store` files and empty subfolders, removed with it. Refused: the root, a hidden folder, a path that crosses a symbolic link, a folder that contains a note or any other file. One commit `mnemo: retire dossier <folder>` only if a file tracked by git disappears (never an empty commit).

## Episode notes

One `episode` note per Mnemo session, written by default to `episodes/<project>/<AAAA-MM-JJ>-<title name>.md` (it can be moved; it is found by its `session` key wherever it is), where `<project>` is the episodes folder of the session (name of its `projet:` or `client:` scope; `divers` without a scope or for an unusable name) and the date is the date of its start (local time; the day of writing if the start is unknown); a name already taken in that folder receives `-2`, `-3`… The episode of a session is found by its `session` key, whatever its date. Secrets (tokens, keys) in the title, texts, objective, branch and files are masked (`[secret masqué]`) before the path, the note and the commit message are written; a title that was only a secret becomes "Session <profile>". Its summary says what happened; then `## Décisions` (one decision per `- …` line, with its reason) and `## Résultat`, omitted when empty. Its frontmatter carries:

| Key | Meaning |
|---|---|
| `session` | uuid of the session: a single note per session |
| `profil` | profile of the session (`travail`…) |
| `debut`, `fin` | `AAAA-MM-JJ HH:MM`, local time |
| `branche` | git branch of the session folder at the start (null: no repository, or detached head) |
| `objectif` | objective of the session (first message), or null |
| `fichiers` | files touched, relative to the repository root (50 at most) |
| `source` | `session <uuid>` |
| `minimal` | `true`: minimal episode, written without AI (absent from an episode written by Claude) |

**Genre `episode` of `proposer`**: `{ titre, synthese, decisions?, resultat?, fichiers? }`, only from a Mnemo session (its MCP server knows the session: otherwise refused). Project, start, profile, branch and objective come from the session state (unknown session: those of its episode already written, otherwise `debut: null`); `fin` is the time of writing; without `fichiers`, those of the replaced episode. If the session already has its episode, it is **replaced in place** (same path, same `id`); an identical text is not rewritten. Commit `mnemo: episode <path>`.

**Minimal episode** (without AI): written at the end of a session whose stop was not expected, that is abandoned, or whose wrap-up left no episode (never for a pause or for a service stop). Summary "Épisode minimal, écrit sans IA.", `minimal: true`, title: the objective (otherwise "Session <profile>"), files changed according to git (tracked files changed since the start commit, then untracked ones; git in error or beyond 2 s, 600 ms in a hook without the service: no files). An episode written by Claude is never replaced by a minimal episode; a minimal episode is replaced by the wrap-up one. The `fin` hook without the service has 1.4 s in total: it starts writing (lock taken) only if 450 ms remain; what it could not write is written at the end of the process if the service holds it (wrap-up, abandon), otherwise at the next start of the service, for each `a_relire` session, and each session finished after a launch, without an episode.

## Profile notes

A `profil` note (`profils/<name>/<name>.md`) describes a kind of session. Its summary is the instruction of the session; its frontmatter carries:

| Key | Values | `travail` | `archiviste` |
|---|---|---|---|
| `avatar` | `{ forme, couleur }`: a shape among `robot`, `chouette`, `renard`, `fantome`, `chat`, `goutte`, `lapin`, `grenouille`, `pingouin`, `escargot`, `champignon`, `nuage`, and a colour among `vert`, `violet`, `bleu`, `ambre`, `rouge` | `robot`, `vert` | `chouette`, `violet` |
| `plugins` | list of Claude Code plugin ids (`name@marketplace`) switched on in the session; every other installed plugin is switched off | `[]` | `[]` |
| `skills_memoire` | `tous` (all skills of `skills/`) or a list of their names | `tous` | `[]` |
| `hooks` | non-empty list among `debut`, `message`, `outil`, `apres_outil`, `arret`, `fin` | all six | `[debut, arret, fin]` |
| `lancement` | `projet` (the chosen project) or `memoire` (`_mnemo/`, the root added with `--add-dir`) | `projet` | `memoire` |
| `lanceur` | `dialogue` (chosen in New session) or `propre` (its own way of starting, shown apart) | `dialogue` | `propre` |

An empty summary means the default instruction of Mnemo, which follows Mnemo updates; a summary equal to a current or past default instruction is read the same way. The old key `skills` is still read when `skills_memoire` is missing: `projet` gives `tous`, `profil` gives `[]`; it is removed at the next save from Settings › Profiles, which rewrites these keys and keeps the rest of the note. The skills of `profils/<name>/skills/` are always given to the session, and win over a skill of `skills/` with the same name.

The hooks `debut`, `message`, `arret` and `fin` are always declared, because they keep the state of the session; the list decides what they do: `message` injects the context only when listed, `apres_outil` only notes the notes Claude reads or writes (nothing is injected after a tool), `outil` (action check) is declared only when listed. `debut` injects nothing. A missing or unreadable note, or a note of another type, gives the default profile of the package; a missing or invalid key (empty summary included) gives its default value, never an error. Another profile name starts from the values of `travail`.

A skill is a `<name>/` folder that contains a `SKILL.md` (Claude Code format). In `skills/`, a `projets` field (text or list) in the frontmatter of `SKILL.md` limits the skill to the sessions of these projects; without this field, it applies everywhere. The default skills of the archivist (`emails`, `specs`, `comptes-rendus`) are placed in `profils/archiviste/skills/` at its first launch if they are missing, then never rewritten. Only the `.md` files of a skill are copied into the session plugin.
