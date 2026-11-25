# Using Mnemo

Reference for the command line, the service, sessions and the interface. Installation, requirements and uninstalling are
in [installation.md](installation.md); the file format of the memory is in [format-coffre.md](format-coffre.md).

Commands, messages and the interface are in French; this page gives their meaning in English.

## Command line

Node 24 or later is required. The `mnemo` command (see [installation.md](installation.md) to make it available):

- `mnemo init [folder] [--oui] [--json] [--mcp | --sans-mcp] [--codex] [--mistral] [--modeles | --sans-modeles]
  [--commande | --sans-commande] [--lanceur | --sans-lanceur]`: creates the memory (`_mnemo/`, with `SCHEMA.md`, the note of the `travail`
  profile and a first git commit; no folder is imposed); does nothing if it already exists. In a terminal, on a fresh folder, it guides you step by step:
  folder (`~/…` accepted; absolute path shown and confirmed before creation), declaration to Claude Code, local models
  (no by default), the `mnemo` command and the macOS launcher (yes by default). `--oui` (yes): no question, MCP
  declaration included, but nothing else outside the folder (no models, command or launcher). Without a terminal and
  without `--oui`: the memory only, nothing outside the folder (the declaration command is printed). On an existing
  memory, only the MCP declaration, the command and the launcher are asked.

  Explicit options decide a step without any question, with or without a terminal, and override the defaults:
  `--mcp` / `--sans-mcp` (declare to Claude Code or not; `MNEMO_SANS_MCP=1` wins over `--mcp`), `--modeles` /
  `--sans-modeles` (install the local models or not; `--modeles` also applies to an existing memory), `--commande` /
  `--sans-commande` (the `mnemo` command in `~/.local/bin`), `--lanceur` / `--sans-lanceur` (the macOS launcher). Giving
  both options of a pair is a usage error (exit code 2). `--codex` also declares the MCP server to Codex and installs
  the Mnemo hooks in `~/.codex/hooks.json` (or `$CODEX_HOME`); without it Codex is never touched, and
  `MNEMO_SANS_MCP=1` skips both (see [installation.md](installation.md#codex)). `--mistral` does the same
  for Mistral Vibe (`~/.vibe/config.toml` and `hooks.toml`, or `$VIBE_HOME`): see
  [installation.md](installation.md#mistral-vibe). A failing step outside the memory (MCP, models, command,
  launcher) does not stop the next ones: it is reported, and the exit code is 1.

  `--json` (for a program that drives the installation): no question, and standard output carries only JSON lines,
  one per event (errors before the memory step, such as usage errors, go to standard error only):

  ```
  {"etape":"memoire","etat":"debut","message":"Dossier Mnemo : /path"}
  {"etape":"memoire","etat":"fait","message":"Mémoire créée dans /path/_mnemo (commit …)."}
  {"etape":"mcp","etat":"saute","message":"…"}
  {"etape":"modeles","etat":"debut","message":"…"}
  {"etape":"modeles","etat":"progression","piece":"sens","libelle":"…","recu":1048576,"total":639152416}
  {"etape":"modeles","etat":"fait","message":"…"}
  {"etape":"commande","etat":"echec","message":"…"}
  {"etape":"lanceur","etat":"saute","message":"…"}
  {"fin":true,"racine":"/path","ok":false}
  ```

  `etape` is `memoire`, `mcp`, `codex`, `codex_hooks`, `mistral`, `mistral_hooks`, `modeles`, `commande` or
  `lanceur` (the steps of an engine only with its option). A step that runs gives `debut` then `fait` or `echec`, or `laisse` when it deliberately leaves
  things as they are (a declaration turned off in Codex with `enabled = false`: not a failure, no exit code 1);
  a step left aside gives a single `saute` line. Download progress (`piece`: `moteur`, `sens` or `reranker`; `total` is
  `null` when the size is unknown) comes at most once per second and per piece. The last line is `fin`; `ok` is false
  when a step failed (exit code 1). In JSON, a declaration that must be done by hand (Claude Code not found, declared
  with another path) is a failure; when a user-scope declaration of Mnemo already runs another Node.js or another copy
  of Mnemo, the failure line also carries `"motif":"perime"` (`mnemo declarer --remplacer` then rewrites it). The
  types are `LigneInit` and `PosteVerifie` in `@mnemo/contrat`.
- `mnemo verifier-poste [--json]` (check this computer): `git` (runs `git --version`), Claude Code (the `claude` the
  sessions will run), Codex and Mistral Vibe (optional: where each is, its version, the MCP
  declaration, the Mnemo hooks and, for Codex, whether it has approved them) and the Node version. Nothing is changed.
  Without `--json`, one line each, exit code 1 if git or Claude Code is missing (never for an optional engine); with
  `--json`, one line, exit code 0 (the block `mistral` has the form of `codex`):
  `{"git":{"ok":true,"version":"2.50.1"},"claude":{"ok":false,"motif":"…"},"codex":{"ok":true,"chemin":"…","version":"…","mcp":{"etat":"deja"},"hooks":{"etat":"a_jour","approbation":{"etat":"a_approuver","motif":"…"}}},"node":{"version":"26.13.1"}}`.
- `mnemo declarer (--remplacer | --retirer) [--moteur claude-code|codex|mistral-vibe] [--json]` (declare):
  looks after an existing MCP declaration of Mnemo to Claude Code (default) or another engine, of user scope; it never
  declares anew, which is `mnemo init --mcp` (or `--codex`, `--mistral`). `--remplacer` (replace): a Mnemo declaration that runs another Node.js or another copy of Mnemo is
  removed and made again with this Node.js and this Mnemo; `--retirer` (remove): the declaration is removed only if it
  runs this Node.js and this Mnemo. A declaration named `mnemo` that does not run Mnemo, or of another scope, is left
  alone. With another engine, its Mnemo hooks follow the same way (`~/.codex/hooks.json`, `~/.vibe/hooks.toml`; those
  of another installation of Mnemo are left by `--retirer`), and a declaration that
  is turned off or carries your own settings is never rewritten: the message says what to change by hand. With `--json`,
  one line `{"resultat":"…","message":"…"}` (plus `"hooks":{"resultat":"…","message":"…"}` for an engine with hooks), `resultat` being `absent` (nothing declared), `deja`
  (already up to date), `remplace`, `retire`, `autre` (left alone) or `echec` (type `SortieDeclarer` in
  `@mnemo/contrat`). Exit code 1 on a failure (`claude` not found, for example), 2 on a usage error.
- `mnemo lit <path>` (read): prints a note (path relative to `_mnemo/`, for example `clients/acme/acme.md`).
- `mnemo liste [folder]` (list): prints the note of the folder, its notes, then its subfolders.
- `mnemo cherche <text…> [--dossier <path>] [--tout] [--limite N] [--contexte]` (search): searches the memory (the index
  is updated before each search); one line per result. `--tout` includes information waiting for confirmation and
  invalidated information; `--contexte` returns each result in full, a passage with its section or its neighbours (like
  the hooks and the `chercher` tool).
- `mnemo index [--reconstruire]`: updates the search index, or deletes and rebuilds it.
- `mnemo amorce [--dossier-claude <path>]` (or the "Importer la mémoire de Claude Code" button of Mémoire › Archiviste): imports
  the native memory of Claude Code (all `.md` files of `projects/*/memory/`, subfolders and `MEMORY.md` included, and the
  global `CLAUDE.md`, in `CLAUDE_CONFIG_DIR` or `~/.claude`) as source notes under `sources/claude-code/`, attached to
  their project when it is inside the folder, and references the `CLAUDE.md`, `CLAUDE.local.md` and `.claude/*.md` files
  of the folders of the first 3 levels. The report names everything left out, with the reason; run again, it only
  rewrites changed files. A note whose content is identical to one already imported under another origin (the same note found in several projects) gives no new note: the existing note (that of the first origin in alphabetical order) records its `origines`, and the report counts it as
grouped the first time. A copy that later changes gets its own note and leaves the `origines` of the shared one. An
  origin that the archivist merged into another note or redirected to it (`entretenir`, see "Profiles") is known as long
  as the note does not change in Claude Code: it is not imported again; once it changes, it is new content, imported as a
  note of its own. No information is extracted: the archivist does that. An imported note is never deleted when
  the original disappears from `~/.claude`. Recognised secrets are masked before writing.
- `mnemo source <path> [--type <type>] [--version-de <note>] [--apres-proches]`: references a document of the folder
  (see "Documents"). Exit code: 0 written or already referenced, 1 refused, 2 near copy exists (nothing written).

`lit`, `liste`, `cherche`, `index` and `source` look for the memory in the current folder, then in its parents.
`mnemo --aide` lists the commands.

## Settings

The settings of a folder are in `.mnemo/reglages.json` (local state, never versioned) and can be changed in the
interface (gear at the bottom of the rail, ⌥,): project markers (◆ in the folder tree), the injected context (number of cards proposed at the first message and per message),
minimum similarity of search, model shutdown after inactivity, note types whose proposed information needs a
confirmation, service port, launcher browser and the main colour of the interface (green by default). The table of settings and defaults is in [installation.md](installation.md#settings).
The main colour is applied as soon as it is picked; below the picker, a warning appears when it is hard to read on the dark background (contrast under 3:1). The logo and the session state colours keep their own colours.
The **App Claude** tab connects the memory to the Claude app (Claude Desktop) and manages its other MCP servers: see
[Connecting the Claude app](#connecting-the-claude-app).

## Documents

A document of the folder (text `.pdf`, `.docx`, `.eml`, `.mbox`, and any text file: `.md`, `.txt`, `.csv`, `.yaml`…;
UTF-8, UTF-16 only with a byte order mark, otherwise Windows-1252) is referenced, never copied: `mnemo source docs/specification.pdf` (or the
`extraire_source` tool in a session) writes a `source` note under `_mnemo/sources/` (path, hash, format) and indexes
its passages, which `cherche` and `chercher` find with the document title, the heading path and the page. The path is
relative to the root of the Mnemo folder (outside `_mnemo/` and `.mnemo/`; a hidden folder or file is a document like
any other); recognised secrets are masked before indexing. A near copy of an existing source is not written, unless
`--apres-proches` is given; `--version-de sources/<note>.md` links a new version to the previous one. The answer also
names the existing notes whose title or alias the document mentions (people, organisations, projects, notions): the
places where its information is likely to belong, beyond the project it is about.

Once a source is processed, `proposer` genre `modification` with `traitee: true` on its note (with or without the
"à traiter" marker) lists the notes that cite it. A source of at least 8 passages cited by one note, or none, is
flagged: a meeting or a thread usually teaches something about the client's trade, its organisation, the people, the
product or the practices too.

A file dropped in the drop zone of the interface (Mémoire › Archiviste) is written into the folder and gets a `source`
note marked "à traiter" (to process) for the archivist, whatever its format. A scanned PDF (pages without text), an
image, a spreadsheet or any other binary file without an extractor is kept, but it is not searchable: Mnemo does no
text recognition and has no spreadsheet extractor, and says so when the file is dropped or referenced.

A document can weigh up to 10 GB: it is dropped, hashed and read as a stream, never loaded in one block. Each format
then has its extraction limit (PDF 256 MB, Word 100 MB, email 256 MB per message, indexed text 32 Mi characters per
document): see [references/document-limits.md](references/document-limits.md).

A referenced document that changes, or disappears, is reindexed in the background by the service and the MCP server after
a search (the search itself never waits: it serves the index as it is), or by `mnemo index`; never by the session
hooks. An `.mbox` gives one note per thread, identified by a stable key (the Message-ID of its first message): when the
mailbox grows, its known threads keep their passages, and `mnemo index` lists "Documents à compléter" (documents to
complete). Running `mnemo source` (or `extraire_source`) again on the same path references the new threads, without
touching anything else.

## Temporary notes

A progress status (where a piece of work stands) belongs in a temporary note, never in a durable one: its frontmatter
key `perime_le` gives the day it stops being true (`proposer`, genre `fiche` with `donnees: { perime_le }`, or genre
`modification`). From that day on, the note, its information and its passages are no longer injected into sessions nor
returned by `chercher` (they come back with `tout`, like struck-through facts), and `diagnostiquer` lists them in the
`perimees` rubric, with the information whose validity (`valide [début,fin)`) has passed: the archivist deletes them,
or moves the date if they are still true.

## Search by meaning

Search first finds by words. With local models, it also finds an answer worded differently: "How often do the vehicles
report where they are?" finds "Each truck sends its GPS position every 30 seconds". These models are **optional**.
Without them, or if they are slow, failing or loading, search works by words, without error and without waiting beyond
its budget (3.5 s for a tool, 400 ms for a hook). They exist for macOS on Apple silicon and on Intel (processor only, slower:
the budget may cut them short), Windows x64 and arm64 and Linux x64 (Intel, Windows and Linux untested); on another
platform there is no search by meaning, and search works by words.

- `mnemo modeles installer [--depuis <folder>]`: installs what is missing in the user cache: `MNEMO_MODELES` if set,
  otherwise `~/Library/Caches/mnemo` on macOS, `$XDG_CACHE_HOME/mnemo` or
  `~/.cache/mnemo` on Linux. The pieces: the llama.cpp engine b11671 (12 MB), the meaning model bge-m3 (about 605 MB), the
  reranker bge-reranker-v2-m3 (about 606 MB), in the units of the interface. Each piece has a fixed address and SHA-256 hash, checked before installing.
  `--depuis` copies a piece already present on the machine instead of downloading it, if its hash matches.
- `mnemo modeles etat`: installed pieces and running servers of the machine.
- `mnemo modeles arreter`: stops the servers of the machine. Run from a Mnemo folder, it also stops the servers that an
  older version started for that folder.
- `mnemo index` computes the vectors of the whole memory. `mnemo cherche` and the `chercher` tool compute the missing
  ones, within their budget.

The `llama-server` processes listen on `127.0.0.1`, with a random key. One guardian process watches them for the whole
machine: every Mnemo folder and every session share the same servers. Their state lives in the models cache
(`serveurs/`), not in the Mnemo folder. When the service starts, it stops the servers an older version started for its
folder.

- **Start.** The first search of a tool or of the command line starts the servers and waits for them, within its budget.
  A hook, or a search of the interface, that finds them stopped answers by words that time and starts them in the
  background, so the next one has them.
- **Stop.** The servers stop by themselves after 15 minutes without a request, whether the service runs or not
  (setting `modeles.inactiviteMinutes`). They keep the delay of the folder that started them.

The reranker sets the order of the first 40 merged candidates without changing the scale of their scores, so the recall
threshold keeps its meaning.

### Levels of the models

Three levels set which models run. The bench counts the questions whose right source is in the first 5 results.

| Level | Words | Meaning | Reranker | RAM | Bench |
| --- | --- | --- | --- | --- | --- |
| « Complets » (default) | yes | yes | yes | about 1.6 GB | 30 of 42, the best search |
| « Sens seul » (meaning only) | yes | yes | no | about 0.8 GB | 27 of 42 |
| « Coupés » (off) | yes | no | no | none | 20 of 42: no answer worded differently |

- **Everywhere.** The level of the machine is kept in the models cache (`serveurs/niveau.json`) and applies to every
  folder. A model it excludes is never started nor called. A change that removes a model stops the servers at once; a
  change that adds one starts nothing at once: the running guardian stops within 30 seconds, and the next use starts
  the servers again with every allowed model. « Démarrer maintenant » restarts them at once.
- **For one session.** A session can have its own level. It is kept when the session is resumed. The more restrictive of
  the two levels applies: a session cannot use a model the machine excludes. Its tools and hooks then neither call nor
  start the excluded models. This frees no memory: the servers are shared and keep running for the other sessions.
- **Vectors.** At « Coupés », new notes are not vectorised. When meaning comes back, the missing vectors are computed
  again (`mnemo index`, or a search, within its budget).

### The Modèles button

The **Modèles** button sits in the title bar, between the quotas and the Archiviste button. It is absent while the
models are not installed. Its text follows the state live: « Modèles en veille » (stopped), « Chargement… » (loading),
« Modèles prêts » (ready; « Sens seul prêt » and « Sens seul en veille » at that level), « Vectorisation n/N », « Recherche… », « Injection… »
(work in progress, the latest one, « +1 » if there are others), « Modèles coupés » (off) or « Modèles en échec »
(failed).

A click opens a menu and changes nothing by itself. It shows:

- each piece with its state: the meaning model bge-m3 and the reranker bge-reranker-v2-m3, both from BAAI in Q8_0, with
  their size and the start of their SHA-256 hash; the engine llama.cpp b11671, local on `127.0.0.1`;
- the work in progress, with « – cette session » for the session selected in Sessions, or « – autre dossier » for
  another folder;
- the level under « Partout » (everywhere): « Complets », « Sens seul », « Coupés »;
- « Démarrer maintenant » (start now) or « Arrêter maintenant » (stop now), which keeps the level: the next use (a
  search or a hook) starts the models again;
- the shutdown delay after inactivity.

In the Contexte panel, a small button at the right of « Injecté dans la session » shows the level of the selected
session. Its menu offers « Comme partout » (follow the level of the machine), « Complets », « Sens seul » and
« Coupés ». A level wider than the level of the machine is greyed out.

### How a result is ranked

Each result of `chercher` (and of `mnemo cherche`) has one **score**: `score = base + weights`, the same model as the
cards (see "Injected context").

- The **base**, from 0 to 1, is how well the result matches the query: words, meaning, graph and reranker. Among words
  matches, a fact that carries the precise words ranks above one that only shares the words of its note's title.
- Four **weights** add to or subtract from it, each a setting from 0 to 0.5 (`recherche.poidsPosition`,
  `poidsConfiance`, `poidsMemoire`, `poidsFraicheur`; see [installation.md](installation.md#settings)): the result is
  in the neighbourhood of the current project (+ 0.10), its confidence (− 0.05 × (1 − confidence)), it belongs to the
  memory rather than being an imported source (+ 0.05), its date (+ 0.05, halved after a year).
- The **recall threshold** (`seuil_rappel`, 0.4) applies to the relevance of the match, never to the score: a weight
  moves a result up or down, it never lets one in.

Results are listed by score. The number shown on the line of a result is its base, not its score; after the status and
date come the reasons that set it apart: `- 0,82 <id> (actif, 2026-11-20) · projet courant, confiance 60 %`. The reasons
are « projet courant », a confidence below 100 %, and « récent » for a dated result less than a year old. The memory
weight and the freshness of an undated or older result touch almost every result: they count in the score but are not
written. The status « actif » is the former « servi ».

Confidence is that of the information: a source note and its passages count with the reliability of their source type
(`note` 0.6, `email` 0.7…). A declared fact that quotes the user, filed from a note imported from Claude Code (linked by
path, name, title or alias to a note whose `origine` starts with `claude-code/`, wherever it is filed), counts with the
`utilisateur` reliability: the imported note only carries what the user said.

**Copies.** A search returns one entry per document (a note and its passages: the best passage when one is in the
results, otherwise the note; the facts of a note stay separate entries) and one entry per identical text of the same
kind (two facts, or two documents; a fact and a passage stay apart, and so do two instructions). The copy shown is one in
the neighbourhood of the current project if there is one, then the one a fact of the results cites (by path, name, title
or alias), otherwise the most recent one; the others are listed after it: `(+ 2 copies : <path>, <path>)`. An entry takes
its place from the score of its group (its best-ranked member), but shows the base and reasons of the copy shown. A
source note cited by a fact comes after that fact. `chronologie` keeps one entry per document but groups an identical
text only at the same date: two dates are two moments. `proposer` checks near duplicates against every copy.

Struck-out facts are not injected into a session (position note, note injected by hand); they stay in their note, and
`lire` still shows the whole note.

## Service

`mnemo` starts the local service of the Mnemo folder: `mnemo ~/Sites/client` (a folder inside a memory, found by going
up), or `mnemo` alone from a folder that contains one. The service always listens at the same address,
`http://127.0.0.1:4747/` (`MNEMO_PORT` chooses another port; `MNEMO_PORT=0`, a free port, and the address then changes
at each start). If the port is taken by another program (or by Mnemo for another folder), `mnemo` says so and stops:
never another port silently. In a terminal it prints the first-opening address, `http://127.0.0.1:4747/#jeton=<token>`,
and opens it in the browser when the interface is built (`MNEMO_SANS_NAVIGATEUR=1` prevents that). Ctrl-C (or SIGTERM,
or closing the terminal, or `mnemo arreter [folder]` for a service without a terminal) stops the sessions cleanly; they
resume at the next start (`claude --resume`, `codex resume`, `vibe --resume`). After a crash of the service, its sessions become
"à relire" (to review, minimal episode written), then are relaunched (a Codex session that never reached its first
message stays "à relire").

**Token and browser.** The service token is created once and kept in `.mnemo/jeton` (readable by you only). At the first
opening of the address with the token in a browser, the interface stores the token in the `localStorage` of its origin,
`http://127.0.0.1:4747` (specific to this port, never sent by the browser on its own), removes it from the address bar,
then presents it at each request (`Authorization`, and a subprotocol for the WebSocket, never in an address). Afterwards
`http://127.0.0.1:4747/` is enough in that browser. `mnemo jeton` prints the first-opening address again;
`mnemo jeton --renouveler` creates a new token, valid after a restart of the service.

The first-opening address stays in the browser history, and browser sync (Chrome, Edge) can carry it off the machine.
Open it once, then use `mnemo ouvrir` or the launcher, which only open the plain address; delete it from the history if
needed, and renew the token if it may have been seen.

The service listens on `127.0.0.1` only and requires its token at each request (`Authorization: Bearer`; for the
WebSocket, the subprotocol `mnemo.jeton.<token>`, or `?jeton=` for the command line and the hooks); it sets no cookie.
It refuses a `Host` header other than `127.0.0.1:<port>` or `localhost:<port>`, and any request whose `Origin` header,
when present, is not exactly the address it was reached at. Its address and token are in `.mnemo/service.json`
(readable by you only), removed when it stops. Session hooks go through it first, and compute by themselves otherwise.

### Opening Mnemo in one click

- **Installed app (Chrome, Edge).** Once the interface is open (token kept), the browser menu offers "Install Mnemo": its
  own window, an icon in the Dock. It opens `http://127.0.0.1:4747/`; the service must be running. Its service worker
  caches nothing.
- **macOS launcher.** `mnemo lanceur`, run from the Mnemo folder, creates `~/Applications/Mnemo.app`. A click starts the
  service of this folder if it is not running (detached, log in `.mnemo/service.log`), then opens
  `http://127.0.0.1:4747/` in an app window (Chrome, otherwise Edge, otherwise the default browser): this is
  `mnemo ouvrir`. The launcher calls the Node and `main.ts` present when it was created: if they move, run
  `mnemo lanceur` again. Nothing runs at login. Remove it with `mnemo lanceur --retirer`.

### What the web version protects, and what it does not

Protected: a web page open in the same browser (from another site, or served by another port of `127.0.0.1`) can
neither read nor command Mnemo: it does not have the token (local storage is specific to each origin, port included, and
the browser never sends it on its own, unlike a cookie), there is no CORS, `Origin` is checked, `Host` is checked against
DNS rebinding; the interface loads nothing from elsewhere and only runs its own scripts (strict CSP, no `eval`); the
content of the memory, documents and terminals is displayed as text, never as HTML; a note link never navigates.

Not protected: a **script injected into the interface itself** would read the stored token; **browser extensions** with
access to `127.0.0.1` see and command the interface as you do; **local programs** running under your account can read
`.mnemo/jeton`; the first-opening address stays in the history; agent sessions have your permissions.

## Interface

The interface is built once, at the root of the repository: `pnpm construire` (into `packages/ui/dist`, served by the
service; to redo after an update). To work on the interface: `MNEMO_DOSSIER=<Mnemo folder> pnpm --filter @mnemo/ui dev`
(service running in that folder), then the printed address.

The title bar shows, left of the Archiviste button, the **Modèles** button (the local models: see
[The Modèles button](#the-modèles-button)) and, left of it, the **quotas of the subscriptions** (5-hour window and
week), common to all sessions: one group per subscription seen, « Claude » and « ChatGPT », side by side. Each is a small
circle with two rings (inner: 5 hours; outer: week), green, amber from 50 %, red from 80 %. A click unfolds them into
bars with the reset time; another click folds them.

- **Claude** quotas come from Claude Code's status line in the sessions launched by Mnemo (`mnemo ligne-etat`, which
  shows nothing there), so they appear after a first answer, and only for a Pro, Max or Ultra subscription.
- **ChatGPT** quotas come from the transcript of the Codex sessions launched by Mnemo, read by the service after a hook
  (Codex has no status line). A window Codex does not report is not shown (some plans report the week only). A reading
  older than an hour is ignored.
- Mistral Vibe reports no quotas Mnemo can read: the Contexte panel of its sessions says
  « Quotas : non communiqués par … » (not reported) instead.

The left rail has two views: **Sessions** (its badge: sessions waiting for your answer) and **Mémoire** (its badge: items
to process).

- **Sessions**: the grid of sessions, the Dossier panel (tree of all the folders of the root, two levels unfolded at
  start, with session status dots, git status and "+ session" on each folder) and the Contexte panel ("Injecté dans
  la session": one list for the selected session, see "Injected context"). The side panels are resized by dragging their
  border (double-click: default width).
- **Mémoire › Archiviste**: one page to enrich the memory and decide, in three columns: to decide (facts to confirm,
  level raises and modifications proposed by a session) and to process (imported sources); the archivist terminal in the
  centre; on the right, the drop zone, the recent documents and "Appris aujourd'hui" (learned today: the commits of the
  memory of the day).
- **Mémoire › Fichiers**: the tree, the note (reading, Markdown editing), its links and the sessions that used it. The side panels
  (tree, links) and the side columns of Archiviste are resized like those of Sessions: drag the border (double-click:
  default width).
- **Mémoire › Graph 3D**: the memory as a graph (`/` search, `L` next label density, Alt+click releases a node).

Shortcuts (read from the physical key, ⌥ = Alt): ⌥1…⌥9 opens session n full size, ⌥0 returns to the grid; ⌥A opens or
closes the archivist drawer, ⌥⇧A maximises or reduces it; ⌥M opens the last note injected into the chosen session; ⌥L
locates the open note; ⌥, opens the settings; ⌘K (Ctrl+K outside macOS) opens the palette; Escape outside a terminal
closes the palette, reduces then closes the drawer, or returns to the grid. The ⌥ shortcuts do not apply while typing or
inside a terminal.

## Sessions

Without the interface, sessions are driven from the command line, with the service running:

- `mnemo sessions`: running sessions (id, state, profile, folder, objective);
- `mnemo session lancer <folder> [--profil p] [--objectif t]`: starts the engine of the profile (`claude`, `codex`
  or `vibe`) in this folder (relative to the root);
- `mnemo session terminer <id> [--sans-bilan]`: wrap-up (the agent writes the episode, then the session stops), or
  abandon;
- `mnemo session voir <id>`: the terminal of the session inside yours; Ctrl-] to quit.

`<id>` can be shortened to its start (8 characters are enough).

A session follows a simple cycle: "travaille" (working) during a turn of the agent, "attend" (waiting) when it is done or asks
for a permission, "en pause" (paused) when you stopped it, "à relire" (to review) when it stopped by itself, "terminée"
(finished) after the wrap-up or the abandon. The **wrap-up** types an instruction into the session: the agent writes the
episode of the session (`_mnemo/episodes/<project>/`) and 0 to 3 lessons, then the session stops. A session stopped
without a wrap-up receives a minimal episode, written without AI (objective, dates, branch, files changed according to
git).

A session keeps the engine and model it was started with, also when it is resumed: changing the profile afterwards
changes neither (see [Managing profiles](#managing-profiles)).

Each Claude Code session started by Mnemo receives a plugin (`.mnemo/plugins/<session>/`): the instruction of its profile, its
skills, its hooks (`mnemo hook …`), Claude Code auto-memory turned off, and the Mnemo tools needed for the wrap-up allowed
in advance. Depending on the profile, the hooks inject the instructions and a few leads at each message
(see "Injected context"), and refuse an action that breaks a checked instruction. They never hold the session up (under one
second, 2 s for the action check, 1.4 s for the end; exit code 0 even on failure). When the memory may contain checked
instructions, the action check is declared so that Claude Code refuses the action if the hook itself fails or times out. `claude` is started without a shell, with your subscription only: `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the `CLAUDE_CODE_USE_*` provider selectors are removed from its
environment. `MNEMO_CLAUDE` names another `claude` binary.

Whatever its engine, a session never receives the keys and tokens of another provider: `CLAUDECODE`, `CLAUDE_CODE_*` and
`ANTHROPIC_*` outside Claude Code, `CODEX_API_KEY` and `OPENAI_API_KEY` outside Codex, `MISTRAL_API_KEY` outside Mistral
Vibe; `COPILOT_GITHUB_TOKEN` (GitHub's coding agent, not an engine of Mnemo) is never passed. `GH_TOKEN` and
`GITHUB_TOKEN` are passed to every engine (`gh` and git use them).

Mnemo keeps a log of the gestures made on the notes it proposes: a note you inject by hand, set aside with ✗ or restore,
and a note Claude reads with `lire` after a lead proposed it. Each gesture keeps the text of your last meaningful message
and, when the meaning model has already computed it, that message's vector. The log lives in `.mnemo/etat.sqlite` only
(never in the versioned memory), survives `/clear`, `/compact` and the end of the session, and is never purged on its
own. Deleting a session keeps its gestures but erases the text and the vectors of its messages from the file.

### Codex sessions

A profile whose engine is Codex starts `codex` (0.171 or later; `MNEMO_CODEX` names another binary) in the terminal of
the session, without a shell, with your ChatGPT subscription (`CODEX_API_KEY` is removed from its environment). The hooks
are those installed once for the machine by `mnemo init --codex` and approved in Codex (`/hooks`): see
[installation.md](installation.md#codex). They act only in a session started by Mnemo, and follow the hooks of the
profile.

- **What it receives.** The instruction of the profile is passed on the command line, followed by the list of its skills
  (profile and memory: name, description, path of `SKILL.md`), which Codex reads with `lire` when they apply. Nothing is
  written into the project folder. Codex's own memory is turned off. The Mnemo MCP server is passed on the command line
  too, with the reading tools and `proposer` approved in advance; if your own Codex settings may change what the session
  gets, a `[Mnemo] …` line at the top of the terminal says so, as it does when the hooks are missing, belong to another
  installation or are not approved.
- **First message.** Codex sends its first hook at the first message, not when it opens, and the first time it runs in
  a folder it asks « Trust this folder? » in the terminal: answer it yourself, Mnemo never does. Until the first hook
  arrives, Mnemo types nothing into the session.
- **Resume.** Mnemo learns the identity of the Codex session from that first hook, and resumes it with `codex resume`.
  A session whose hooks are not approved never sends it: it can be neither paused nor resumed, and neither wrapped up;
  only abandoned. The interface greys these actions out and says why.
- **Permissions.** When Codex asks you to approve a tool, the session shows « Attend ta réponse » (waiting for your
  answer). After you approve a patch or a Mnemo tool, it goes back to work; after you approve a command, it keeps
  showing the question while the command runs, until the next hook arrives (the next tool, your next message, or the end
  of the turn): changing the installed hooks to see it sooner would make you approve them again.
- **Stop.** Mnemo stops a Codex session by typing `/quit` (before the first hook, it stops the process without typing
  anything).
- **One conversation per session.** Do not use `/new` or `/resume` inside a session started by Mnemo: the session keeps
  following the conversation it started with, so what comes after is neither tracked nor resumed. The session ends when
  Codex exits. Commands run in another conversation, such as a nested `codex exec`, are still checked against your
  verified instructions.
- **Context gauge and quotas.** They are read from the session's transcript (`~/.codex/sessions/`, or under
  `$CODEX_HOME`) after a hook: how full the context window is, and the ChatGPT quotas of the title bar.
- **Not found.** Without `codex`, or with a version older than 0.171, a Codex session is not started (there is no command
  line to paste, unlike Claude Code); the launch says why, and so does the engine's line in Settings › Profiles.

### Mistral Vibe sessions

A profile whose engine is Mistral Vibe starts `vibe` (3.1.5 or later; `MNEMO_VIBE` names another binary) in the terminal
of the session, without a shell, with the sign-in of your own `vibe`. The hooks are those installed once for the
machine by `mnemo init --mistral`: see [installation.md](installation.md#mistral-vibe). They act only in a session
started by Mnemo, and follow the hooks of the profile.

- **What it receives.** The instruction of the profile, followed by the list of its skills, goes into an agent profile
  of the session (`--agent mnemo-<session>`), kept in the session folder of Mnemo; the Mnemo MCP server and its tools,
  allowed in advance, are passed through the environment. Nothing is written into the project folder or into `~/.vibe`.
  Vibe still reads its own `AGENTS.md` and skills.
- **Resume.** Vibe sends its first hook when it opens the session; Mnemo learns the identity of the Vibe session from it
  and resumes it with `vibe --resume=<id>`.
- **Stop.** Mnemo stops a Vibe session by typing `/exit`.
- **Permissions.** When Vibe asks you to approve a tool, the session shows « Attend ta réponse » (waiting for your
  answer) until the tool has run.
- **`/clear`** starts a new conversation in the same session; Mnemo follows the new one (not measured yet).
- **Context gauge.** Read from the session log of Vibe (`~/.vibe/logs/session/`) after a hook. No quotas.
- **Not found.** Without `vibe`, or with a version older than 3.1.5, a session is not started; the launch says why.

### Injected context

Mnemo proposes, it never forces. It does not push notes into the session: it hands the agent a few **cards** (title, path,
one line) and the agent reads with `lire` the ones useful to its task. The tools `chercher`, `lire`, `lister`, `voisins`,
`chronologie` and `contexte` stay available for the rest.

What a session receives, in this order:

1. **The instructions** that apply to the position of the session: `toujours` and `verifiee` at every message, `rappelee`
   all together in the first message.
2. **The note of the position**, whole, like a CLAUDE.md: the note of the project or client the session is started in.
   It comes at the first message that is not mute, again after `/clear` or `/compact`, and again if the note changes.
   Beyond 8000 characters it becomes a card.
3. **The cards**, under the title `## Pistes de Mnemo (lis avec `lire` celles qui servent ta tâche)`. A card shows the
   title, the path, the first sentence of the summary, the type and the reason.

Cards come from three places:

- **At the first message**: the notes of the folder of the position and the notes linked to the position (one or two
  hops), ordered by meaning against that first message alone, at most `contexte.cartesPerimetre` (10 by default). Without
  a position (session at the root), there are none.
- **At any message that names a note**: a note whose title or alias is written in your message (whole words, at least 4
  letters) becomes a card, at most `contexte.cartesNommees` per message (5 by default). Naming the place of a note from
  elsewhere (another client, another project) unlocks the notes stored under it, and only those that are named too are
  proposed.
- **At the message that carries a note you inject by hand** (➤, below): the notes linked to it (one hop, a relation or a
  written link, either way) are ranked with what is left of the folder of the position, at most
  `contexte.cartesPerimetre`, even if they belong elsewhere; their reason reads *liée à <title of the injected note>*.

Notes named in your message keep the order of the message. The others are ranked by one score: the meaning of the
message (0 to 1, 0 without the model) plus weights. Injecting a note by hand adds `contexte.poidsInjection` (0.25 by
default) to each note linked to it; the weight halves every `contexte.demiVieInjection` messages (3 by default; mute
messages do not count, time does not either), is dropped below 0.02, and several injected notes add up to 0.40 at most on
the same note. Injecting the note again restarts its weight; `/clear` and `/compact` clear all weights. A weight still
active also counts in the `contexte` tool.

What Mnemo does not do:

- A **mute message** gets no card: a message that starts with a tag (`<task-notification>`, `<command-name>`…) or that
  has fewer than two meaningful words ("oui vas-y pousse"). Only the instructions come, and the note of the position if
  it was not injected yet.
- **Nothing after a tool call**, and no computation in the background: `PostToolUse` only records which notes the agent
  reads or writes.
- No `source`, `dossier`, `consigne`, `profil` or `episode` note is proposed, and no note from another project or client
  unless your message names it or it is linked to a note you injected by hand. Episodes stay findable with `chercher` and `chronologie`.
- A card already proposed is not proposed again while the note is unchanged. A note you dismiss in the Contexte panel
  (✗), and the note of the position if it was dismissed, are never injected again in that session (unless you ask for it with ➤).
- After `/clear` or `/compact`, the cards can be proposed again and the note of the position is injected again.

The `contexte(question)` MCP tool draws leads on demand: given a question, it returns up to 10 cards of the closest notes
by meaning, notes from elsewhere included (the agent asked), to read with `lire`.

The profile `travail` does not tell the agent how to use its own native memory. It says that the Mnemo memory holds
information relevant to the work, that Mnemo proposes leads, and to write with `proposer` whatever is worth keeping. The
automatic memory of Claude Code, and the memory of Codex, stay off in the sessions started by Mnemo.

**Injecting a note by hand.** In the Contexte panel, ➤ "Injecter dans la session" (inject into the session) on a line
queues the whole note for the session's **next message** (never after a tool call): it is then injected whole, under
`## Fiches injectées à la demande de l’utilisateur`, framed as `<donnees>` if it cites documents, even if it was dismissed
or already injected, and recorded as injected. ➤ stays lit until then; a second click cancels it. The notes linked to it
are proposed with it as cards (*liée à …*), and keep a weight for the next few messages, used in the `contexte` tool or
at a new injection.

**Contexte panel.** For the selected session, one list, "Injecté dans la session", one line per note: on the left ◆
for a note injected whole, or the score of a proposed card as a percentage (the meaning of the message plus the weights).
Every proposed card has a score, a note named in the message and the oversized note of the position included: they are
scored the same way but keep their place (named notes in the order of the message, the position note first). Without the
meaning model, when it did not answer in time, or when the notes are not indexed yet, there is no score (« — »), and a
discreet « sans note de sens » next to the panel title says so (not after a mute message, whose text is never scored).
A note the session read (tools `lire`, `voisins`) is a line of the same list, placed at the time it was read, with ◈ on
the left (tooltip: when it was read); it appears as soon as it is read, without reloading. A note already in the list
(injected or proposed) keeps its line and its tooltip adds « lue aussi à HH:MM ». Then the type dot and the title on one line. The notes injected whole come first (the note of the position and the notes you
asked for, oldest first), then the cards proposed to the agent, most recent first. The reason of a card is written on the
right only when it tells something (*nommée*, *question*, *liée à <title>*); *du périmètre*, the default, is in the tooltip
with the time the card was proposed and its path. The list scrolls on its own and stays anchored where the two meet. On
hover, the reason gives way to ➤ (inject at the next message) and ✗ "ne plus suggérer" (dismiss the note for the
session; dismissed notes stay under "Écartées (N)" with "Rétablir"); a note that was only read has ➤ alone, since only
what Mnemo proposed can be dismissed. A mute message shows its reason under the list.
Clicking a title opens the note. Above the list: the avatar of the profile, the state and the objective of the session,
then its engine and model (the **Moteur** line), its folder, start, duration, branch and, once known, the **Contexte**
line: how full the agent's context window is (read from the end of the session's transcript by the service, for this
gauge only; the same gauge runs under the title bar of the session). When Claude Code's `autoCompactWindow` setting is set (the project's `.claude/settings.local.json`,
then `.claude/settings.json`, then `~/.claude/settings.json`; read again at each reading), the gauge fills up to that
threshold instead of the size of the window, and its tooltip says "tokens avant résumé automatique" (before the automatic summary).

The context settings (`contexte.cartesPerimetre`, `contexte.cartesNommees`, `contexte.poidsInjection`,
`contexte.demiVieInjection`) and the minimum similarity of search are listed in [installation.md](installation.md#settings).

**Permissions.** A Mnemo session runs with your own Claude Code or Codex permissions: Mnemo is not a sandbox. Checked
instructions are reminders: they refuse the actions they recognise, without guaranteeing that no other one gets through.
The archivist receives `--add-dir` on the whole root of the Mnemo folder.

## Profiles

A profile decides what a session receives. Two are shipped:

- `travail` (work, default): started in the project folder; all hooks; the skills of `_mnemo/skills/` active for the
  project;
- `archiviste` (archivist, always on Claude Code): started in `_mnemo/`, with the root of the folder added by `--add-dir`; it files what you
  give it (documents, emails, imported memory) through the Mnemo MCP tools; no context injected by the hooks (it reads the
  memory with the tools), no action check; its own skills, placed at first launch in
  `_mnemo/profils/archiviste/skills/`. Its instruction lets it organise the folder tree freely, reuse or create note
  types, declare the scope of a place (`portee`) and move a note or a whole folder with `deplacer`.

A default skill already placed in a memory is never rewritten, even when a newer Mnemo changes it (a memory created
earlier keeps its old `menage` skill; delete its folder and the current one is placed at the next launch), whereas the
default instruction of a profile, unless you replaced it, follows Mnemo updates.

The archivist cleans the memory with the `entretenir` MCP tool (also a `menage` skill, and the memory's own « Ménage de la
mémoire » note if there is one). Each action is one commit under the lock (`mnemo: supprime <path>`, `mnemo: fusionne
<path> → <path>`, `mnemo: corrige_lien <path>`, like `mnemo: déplace <path> → <path>`), followed by a reindex. The MCP
server offers `entretenir` to every profile, the work profile included; the only guard is the agent's permission
prompt: Mnemo does not pre-allow it (it is not among the tools Mnemo approves in advance, for Claude Code or Codex), so
the agent asks you before each call unless your own settings allow it:

- `supprimer` (delete a note): refused while other notes link to it (by path, name, title or alias), and the refusal lists
  them; with `redirection`, their links are rewritten to that note (section or anchor dropped, displayed text kept), then
  the note is deleted. No placeholder note or alias is left behind. A note imported from Claude Code (its `origine`
  starts with `claude-code/`) that still exists in Claude Code comes back at the next import if it is deleted without
  `redirection`; with one, its origins go to the redirection note (see `mnemo amorce`). Prefer a redirection or a merge.
- `fusionner` (merge `id` into `dans`): facts (anchors renumbered after the highest one of `dans`, `contredit` and
  `invalidé … par` references followed), summary, sections, relations, aliases, title and file name (as aliases) and missing
  properties go into `dans`; the import origins of `id` (`origine`, `origines`) are added to the `origines` of `dans`
  with the fingerprint of each note, so a new import does not bring `id` back; every link to `id`, `#^anchor` included,
  is rewritten to `dans`; `id` is deleted. An anchor or
  a `contredit` / `invalidé … par` reference that does not exist in `id` is dropped rather than pointed at an unrelated fact
  of `dans`.
- `corriger_lien` (fix a link in a note, a source note included): `ancien` becomes `nouveau` (an existing note), or, without
  `nouveau`, loses its brackets.

When `supprimer` or `fusionner` rewrites a link written by title, alias or name without a display alias (`[[Acme Corp]]`),
the old text becomes the display alias (`[[clients/acme|Acme Corp]]`). Relations of a rewritten note that become identical
(same verb, same target) are kept once.

Renaming or moving stays `deplacer`. Refused: profiles, instructions (`consigne`, changed only with the user's consent),
`profils/` and `skills/`, the note of a folder that still holds other notes; `corriger_lien` is refused in those notes
too, and so is a `redirection` to one of them when the deleted note carries import origins. Links to a deleted or merged note that sit in one of them are still rewritten (otherwise they would break), and the
result lists those notes for the user. Struck-out facts are never purged.

To find what to clean, the archivist calls `diagnostiquer` (read-only, pre-allowed like the other reading tools): counts
first, then for each section the paths (and anchors) to act on: broken links (missing note, missing `#^anchor`, internal
`contredit` / `invalidé … par` reference to nothing), isolated notes (no link in or out), notes without a summary, folders
without a note or with an empty one, facts of low confidence (under the value of `seuil_rappel`, which only ranks them
lower in a search), to confirm, struck out, probable duplicates (same note,
close wording, same numbers; a pair noted as `contredit` is left out), notes over 40 facts (struck-out ones counted), sources
with the same document or never cited, rare categories (used twice at most, high-stake ones aside), file name different
from the title (folder notes aside) and **lots en attente** (pending batches: note, batch, kind, number of lines, reason, and
"périmé" when the note changed since the proposal). `rubriques` picks sections, `limite` the entries shown per section (20
by default, 1 to 200); profiles, instructions, `profils/` and `skills/` are only checked for broken links. Nothing is
written, synchronised or extracted.

### Maintaining information

Besides notes, `entretenir` acts on the information lines of a note (the `ancre` is `f-0001`, `^f-0001` or
`path#^f-0001`; `id` is the note). Each action is one commit under the lock, except `proposer_lot`, which writes nothing.

- `corroborer` (`id`, `ancre`, `source`, optional `citation`): adds a second source to an information, written as a
  `  + src: … | corroboré AAAA-MM-JJ` line (see [format-coffre.md](format-coffre.md#corroborations)); the source note is
  created if it does not exist, as `proposer` does. Refused: a struck-out information, a source already on it (the same
  document counts once, whatever the way the link is written or its precision such as a page), a protected note.
  The answer gives the confidence before and after.
- `retoucher_information` (`id`, `ancre`, `texte` and/or `categorie`): corrects the form of an information (typo, wording,
  a category) and keeps everything else (anchor, sources, quotes, dates, confidence, status). Refused when the meaning
  would change: any other number, date, amount or month, a currency or unit, a negation or a word such as « avant » or
  « maximum », a change to or from a high-stake category (`montant`, `echeance`, `perimetre`), or a rewriting beyond a few
  characters (at most 20 % of the text and 8 characters; accents and case do not count). The refusal says to use
  `proposer` with `remplace` instead. Limits: the check is a guard, not a judge. A short name swapped for another one in a
  long text (« Paul » → « Marc ») or an antonym outside the word list (« accepté » → « refusé ») can pass, and a harmless
  change is sometimes refused (a number moved in the sentence, « livre », « plus »). No duplicate check after a retouch.
- `deplacer_informations` (`id`, `ancres`, `dans`, optional `titreSiNouvelle`): moves informations to another note,
  created with `titreSiNouvelle` if it does not exist (otherwise refused). Nothing is left at the origin: git is the
  history. The informations get new anchors in the target and keep everything else. Informations linked by an
  `invalidé … par` or `contredit` reference move together, in both directions, so no reference crosses two notes (they are
  listed in the answer). Every `[[origin#^f-…]]` link in the memory is rewritten to the new anchor. This is how a note over
  40 informations is split.
- `proposer_lot` (`id`, `genre`, `lignes`, `motif`): proposes a batch of `fusionner` (`{ garder, absorber }`: duplicates
  merged into the information kept, whose sources are added as corroborations and whose confidence is cumulated),
  `supprimer` or `confirmer` (`{ ancre }`) on one note. The whole batch is tried on the note, then only recorded: the
  archivist never deletes or confirms an information itself. At most 50 batches wait; an information can be in only one
  pending batch.

**Validating a batch.** Pending batches appear in Mémoire › Archiviste, under « À arbitrer » (they count in the badges).
**Tout valider** applies every line; **Revoir** shows each line before and after, with a checkbox: **Valider N lignes**
applies the checked lines only; **Rejeter** drops the batch. A validation is one commit (`mnemo: fusionne|supprime|confirme
<n> informations <path>`). A batch whose note changed since the proposal is stale: validating it is refused ("la fiche a
changé"), it leaves the list, and the archivist sees it at its next proposal. Deleting a fact: the links to it lose their
anchor, and a fact it struck out keeps its date without the reference; a live fact still to confirm that contradicts it
makes the batch refused until that contradiction is decided.

**Several sources and confidence.** An information can have several sources (first `src:` mention, then corroboration
lines). Its `confiance` cumulates them: 1 − Π(1 − cᵢ), where cᵢ is the reliability of each distinct source, capped at 0.9
unless one source is a `utilisateur` or `contrat` (then at 1). A source that was already counted is not counted again.
Corroborating never lowers a confidence. Mnemo adds each source to the confidence already written (the format keeps
neither the type nor the confidence of each source), so a confidence is not recomputed from scratch; one capped at 0.9
before a user source was added can end a little below the full cumulation (0.97 against 0.982 in the worst case). The
recall threshold applies to the relevance of a search match, not to the confidence of a fact: an information of low
confidence is ranked lower, never hidden.

**Anchors.** A note keeps `ancre_max` in its header ([format-coffre.md](format-coffre.md#frontmatter)) when its highest
anchor leaves (moved, deleted, merged): an anchor number is never given twice.

**Old format.** `mnemo migrer` rewrites notes written before this format (the `type_origine` key and the « Synthèse : »
prefix of the first line) in one commit, `mnemo: migre format ancien (<n> fiches)`, then reindexes; nothing to migrate,
no commit. Run it once per memory.

Other fixes: links written with the full path or the `.md` extension are rewritten when a note moves; `retirer_dossier`
removes a folder that holds only its own note; an episode that the agent writes over the minimal one takes a file name from
its title, not from the objective.

A profile is a note of the memory, `_mnemo/profils/<name>/<name>.md`: see [format-coffre.md](format-coffre.md#profile-notes).

### Managing profiles

**Settings › Profiles** lists the profiles in two groups: **Memory**, the archivist, always there, which files and keeps the memory (started from the Archivist drawer); and **Work profiles**, the sessions on your projects, started from New session, `travail` first (the default one, always there). Each line shows the avatar, the name and the first line of the instruction; the chosen profile is edited on the right:

- **Avatar**: a small creature (12 shapes) and a colour, chosen separately; shown in New session and in the session lists.
- **Engine**: Claude Code or Codex, the coding agent that runs the sessions of the profile. Each line says whether the
  engine is ready on this computer; one that cannot be found is greyed out with the reason. The archivist stays on Claude
  Code. A profile on Codex shows a badge in the list and in New session.
- **Model**: a model of the engine, chosen among the proposed ones (Claude Code: `opus`, `sonnet`, `haiku`; Codex: the
  list given by `codex debug models`) or typed freely. **Empty: the engine's default model.** It is passed as `--model`
  (Claude Code) or `-m` (Codex). Changing the engine empties the model and the plugins; going back to the saved engine
  restores them.
- **Instruction**: Mnemo's default instruction (which follows Mnemo updates) or your own text. « Restore the default
  instruction » goes back to the default.
- **Start**: in the chosen project folder, or in the memory (`_mnemo/`, the root added with `--add-dir`). The
  archivist's cannot be changed.
- **Mnemo hooks**: at least one of the six events.
- **Memory skills**: all those of `_mnemo/skills/` (future ones included), or only the ticked ones. The skills of the
  profile itself (`profils/<name>/skills/`) are always active and win over a memory skill of the same name.
- **Claude Code plugins** (Claude Code only): the installed plugins (read from `~/.claude/plugins/installed_plugins.json`, or
  `CLAUDE_CONFIG_DIR`). The ticked ones are switched on in the session, every other installed plugin is switched off,
  even one switched on in your Claude Code settings (`enabledPlugins` of the session settings). A profile with no plugin
  ticked gets none.

« New profile » starts from the default values of `travail`; « Duplicate » copies a profile (its effective values and its
own skills); « Delete » removes `profils/<name>/` (not possible for `travail` and `archiviste`; the sessions of a deleted
profile resume with the defaults of `travail`). Each save is one commit. If the note changed elsewhere since it was
opened, the save is refused until you reload it.

Below the editor, **What a session receives** previews, read-only and as saved: the profile instruction, the Mnemo MCP
server instructions, the hooks, the memory skills (and why one is left out), the Claude Code plugins, what comes from
Claude Code outside Mnemo (personal skills, `CLAUDE.md`), and the system instructions (wrap-up, import sent to the
archivist). For a Codex profile, the instruction is shown with the list of skills it carries, and what comes from
outside Mnemo is Codex's own (`AGENTS.md`, `.agents/skills`); there are no plugins.

A session takes the engine and model of its profile when it starts and keeps them, resume included: changing the profile
later only affects new sessions.

Mnemo creates no profile and switches no plugin on by itself: until you tick a plugin in a profile, sessions started by
Mnemo get no Claude Code plugin.

## Degraded mode

Without node-pty, Mnemo cannot open a terminal; nor can it for a Claude Code session when `claude` cannot be found.
Everything else works: service, API, hooks, memory, search. Starting a session then returns a complete command line to
paste into your own terminal (`claude …` or `codex …`; a Codex that cannot be found is refused instead, see
[Codex sessions](#codex-sessions)). The session is followed through its hooks, without a terminal in Mnemo. The meaning
models are another, independent option: without them, search works by words.

node-pty is an optional dependency. On macOS and Windows it comes prebuilt (Node-API: it survives Node.js upgrades),
with no build tools. On Linux it is compiled at install time (`pnpm install`: `python3`, `make`, a C++ compiler);
`pnpm rebuild node-pty` compiles it again.

## Benchmarks

Benchmarks measure Mnemo on fictitious corpora shipped with it (`packages/mnemo/banc/`, never drawn from real data).

- `mnemo banc [questions.yaml] [--json]`: search quality, step by step (words, meaning, reranker, graph, position), on the
  test memory; with a file, your questions on the memory of the folder.
- `mnemo banc consignes [--json]`: checked instructions (actions refused or allowed by the `outil` hook) and reminded
  ones (injected at the right message). Without `claude`, in a few seconds.
- `mnemo banc contexte [--json]`: the cards proposed on messages labelled by hand, and the measures of the judged
  messages, from the file `.mnemo/banc-contexte.json` (private, never committed); see
  [banc.md](banc.md#banc-du-contexte-sobre). `--extraire [<session>] [--nombre <n>]` adds real messages from your
  sessions (varied, deduplicated), each with the notes to judge: the union of the first ones by meaning, by words and by
  the reranker. `--juger` shows them one at a time, without score or rank, one key per answer (`o` useful, `n` not
  useful, `i` undecided, `r` nothing useful for this message, `s` skip the message, `b` back, `q` quit), saves each
  answer and resumes where you stopped (a copy `banc-contexte.json.bak` is kept from before the session; only one of
  these commands may write the file at a time). `--par-session <n>` (6 by default) caps the messages taken per session;
  `--completer` reruns the extraction on the messages already taken, and `--juger` then asks only the new notes. Two
  notes drawn outside the union are added to each message, to measure what the union misses. A note changed since the
  extraction has its judgement left out of the measures (`--empreintes garder` to keep it). `--json` also gives the
  judged pairs with their raw signals. Nothing is written to `.mnemo` except this file.
  `mnemo banc contexte --gestes [--json]`: counts of the logged gestures, by kind and by note (no message text).
- `mnemo banc extraction --reel` and `mnemo banc contradictions --reel`: the archivist run by the real `claude -p` on
  test documents, then scored. **They consume your Claude subscription**: without `--reel`, the command refuses.

Each benchmark works in a temporary folder, deleted afterwards.

## Connecting Claude Code

`mnemo init` declares the `mnemo mcp` server to Claude Code at user level (all sessions); `--sans-mcp` skips this step.
If `claude` cannot be found, `init` prints the command to run yourself:

```
claude mcp add --scope user mnemo -- '<path to node>' '<path to main.ts>' mcp
```

To undo: `claude mcp remove mnemo --scope user`. `MNEMO_SANS_MCP=1` is the same as `--sans-mcp`.

## Connecting Codex

`mnemo init --codex` declares the same server to Codex at user level, so every Codex session reaches the memory, and
installs the Mnemo hooks for the sessions started by Mnemo. If `codex` cannot be found, it prints the command to run
yourself:

```
codex mcp add mnemo -- '<path to node>' '<path to main.ts>' mcp
```
 To undo both: `mnemo declarer --moteur codex --retirer`. The steps, the approval of the hooks and the
case of your own settings are in [installation.md](installation.md#codex).

## Connecting the Claude app

The Claude app (Claude Desktop) has its own list of MCP servers, in `claude_desktop_config.json`. **Settings › App Claude**
(the third tab of the settings) edits it from the interface; the path of the file is shown at the top of the tab:

| Platform | File |
| --- | --- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `$XDG_CONFIG_HOME/Claude/claude_desktop_config.json` (by default `~/.config/Claude/`) |

When the Claude app is not installed (its folder does not exist), the tab only says so. When the file cannot be read
(invalid JSON, `mcpServers` not an object, no permission), the tab shows the error and the path and changes nothing: Mnemo
never rewrites a file it cannot read. Fix it by hand, then open the tab again.

- **Mémoire Mnemo** connects the memory of this folder: « Brancher la mémoire » adds a `mnemo` entry that runs
  `mnemo mcp` with the Node and the copy of Mnemo of this installation, and the folder in `MNEMO_RACINE`; « Débrancher »
  removes it. When the entry no longer matches this installation (another Node, Mnemo moved, another folder), the tab
  says so and « Mettre à jour » rewrites it. The name `mnemo` is reserved: the other servers can never take it, in any
  case.
- **Autres serveurs MCP** lists the other servers of the file, in its order: name, command and arguments, and the names of
  their environment variables. « Ajouter un serveur… » and « Modifier » open a form (name, command, arguments one per line,
  variables as `NOM=valeur` one per line); « Retirer… » asks for a confirmation in the page. Only servers run by a command
  (stdio: `command`, with optional `args` and `env`) can be changed; a server described otherwise (a remote `url`, other
  fields) is marked « lecture seule » and can only be removed. A remote address is shown without credentials, query or
  fragment.

The values of environment variables (often API keys) are never shown: the service never sends them to the interface. When
you change a server, its variables are listed by name only: a line with the name alone (`NOM`) keeps the current value, a
line `NOM=valeur` replaces it, and a deleted line removes the variable. A new variable needs a value. Error messages never
quote a value either, not even from an invalid file.

Every other key of the file, and every server you do not touch, is kept as it is. Each change rereads the file and
rewrites it in one go (a temporary file next to it, then renamed, readable by you only). Leaving the tab or the settings
with a server form not saved asks first, as the other tabs do.

**Restart the Claude app** after a change: it reads its MCP servers only at startup (the tab reminds you after each
change).

What the Claude app receives is the memory's MCP tools (`chercher`, `lire`, `contexte`, `proposer`, …) and the
instructions of the MCP server. It does not get the hooks of a Claude Code session: nothing is injected automatically, no
context at the first message, no cards per message, no episode at the end. Claude searches and reads the memory when it
decides to, or when you ask it.

`mnemo mcp` finds its folder from `CLAUDE_PROJECT_DIR`, then from the current folder. The Claude app starts it outside any
Mnemo folder, so `mnemo mcp` then falls back to `MNEMO_RACINE` when that is a Mnemo folder; the position used by search is
then the root of the memory.
