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
  of Mnemo, the failure line also carries `"motif":"perime"` (`mnemo declarer --lier` then rewrites it). The
  types are `LigneInit` and `PosteVerifie` in `@mnemo/contrat`.
- `mnemo verifier-poste [--json]` (check this computer): `git` (runs `git --version`), Claude Code (the `claude` the
  sessions will run), Codex and Mistral Vibe (optional: where each is, its version, the MCP
  declaration, the Mnemo hooks and, for Codex, whether it has approved them) and the Node version. Nothing is changed.
  Without `--json`, one line each, exit code 1 if git or Claude Code is missing (never for an optional engine); with
  `--json`, one line, exit code 0 (the block `mistral` has the form of `codex`):
  `{"git":{"ok":true,"version":"2.50.1"},"claude":{"ok":false,"motif":"…"},"codex":{"ok":true,"chemin":"…","version":"…","mcp":{"etat":"deja"},"hooks":{"etat":"a_jour","approbation":{"etat":"a_approuver","motif":"…"}}},"node":{"version":"26.13.1"}}`.
- `mnemo declarer (--lier | --remplacer | --retirer) [--moteur claude-code|codex|mistral-vibe] [--json]` (declare):
  the MCP declaration of Mnemo to Claude Code (default) or another engine, of user scope, and, for Codex and Mistral
  Vibe, the Mnemo hooks installed for the whole machine (`~/.codex/hooks.json`, `~/.vibe/hooks.toml`).
  - `--lier` (link): links the engine to Mnemo without asking anything, from any folder, exactly like the « Lier à
    Mnemo » button (see [Engines](#engines)): a missing MCP declaration is made, a Mnemo declaration that runs another
    Node.js or another copy of Mnemo is made again with this one; missing hooks are installed, out-of-date ones
    rewritten. A declaration of yours (turned off, of another scope, or named `mnemo` but not running Mnemo) is left
    alone and the message says so. Nothing else is touched (no memory, models, command or launcher). It is the command
    `mnemo verifier-poste`, the interface and the session warnings give when an engine is not linked. Refused, with
    nothing changed, when the engine's command cannot be found or `MNEMO_SANS_MCP=1` is set.
  - `--remplacer` (replace): only an existing Mnemo declaration that runs another Node.js or another copy of Mnemo is
    removed and made again with this Node.js and this Mnemo; nothing new is declared. Existing Mnemo hooks follow the
    same way.
  - `--retirer` (remove): the declaration (and the hooks) are removed only if they run this Node.js and this Mnemo;
    those of another installation of Mnemo are left.

  A declaration named `mnemo` that does not run Mnemo, or of another scope, is never rewritten, nor one that is turned
  off or carries your own settings: the message says what to change by hand. Without `--json`, one line per step (and,
  with `--lier`, « <engine> lié à Mnemo. » when everything is linked). With `--json`, one line:
  - `--remplacer`, `--retirer`: `{"resultat":"…","message":"…"}` (plus `"hooks":{"resultat":"…","message":"…"}` for an
    engine with hooks), `resultat` being `absent` (nothing declared), `deja` (already up to date), `remplace`, `retire`,
    `autre` (left alone) or `echec` (type `SortieDeclarer` in `@mnemo/contrat`);
  - `--lier`: `{"lie":true,"resultat":"declare","message":"…","hooks":{"resultat":"installe","message":"…"}}`, with the
    steps of the route `POST /api/moteurs/:id/lier`: `declare`, `remplace`, `installe`, `deja`, `laisse` (a declaration
    of yours, left alone) or `echec`; `lie` is true only when the MCP server and the hooks are all Mnemo's (type
    `SortieDeclarerLier`).

  Exit code 1 when a step fails (`claude` not found, for example), 2 on a usage error.
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
`mnemo --help` (or `-h`, `--aide`) lists the commands; `mnemo <command> --help` (or `-h`) prints the usage of that
command only, for example `mnemo init --help` or `mnemo declarer --help`, with exit code 0 and nothing else done.

## Settings

The settings of a folder are in `.mnemo/reglages.json` (local state, never versioned) and can be changed in the
interface (gear at the bottom of the rail, ⌥,): project markers (◆ in the folder tree), the injected context (thresholds of automatic injection and of leads, notes injected and leads per message),
minimum similarity of search, model shutdown after inactivity, note types whose proposed information needs a
confirmation, service port, launcher browser and the main colour of the interface (green by default). The table of settings and defaults is in [installation.md](installation.md#settings).
The main colour is applied as soon as it is picked; below the picker, a warning appears when it is hard to read on the dark background (contrast under 3:1). The logo and the session state colours keep their own colours.
The **App Claude** tab connects the memory to the Claude app (Claude Desktop) and manages its other MCP servers: see
[Connecting the Claude app](#connecting-the-claude-app).

### Engines

**Settings › Système › Moteurs** (engines) shows one card per engine the service knows (Claude Code, Codex, Mistral
Vibe), each with its provider (Anthropic, OpenAI, Mistral), shown as a letter in the provider's colour (no brand logo),
and a one-word status:

- « Prêt » (ready): linked and usable;
- « À lier » (to link): the MCP declaration or the hooks are missing or out of date, « Lier à Mnemo » fixes it;
- « À approuver » (to approve): the hooks are installed but not yet approved in the engine (Codex);
- « À vérifier » (to check): whether the hooks are approved cannot be read;
- « À mettre à jour » (to update): the engine's version is too old for Mnemo;
- « À régler » (to set): a declaration of yours (turned off, of another scope, or not running Mnemo) or an unreadable
  file, to fix by hand;
- « Introuvable » (not found): the command the service started with has disappeared since;
- « Pas installé » (not installed): no command found on this computer.

Each card draws the **link circuit** of the engine on this computer: Installé (command found) → Version →
Mémoire (MCP declaration) → Suivi (Mnemo hooks) → Approbation (for an engine that asks for it, Codex). Steps already
done are lit in the provider's colour; the first broken one pulses, and a single action box below says what is wrong
and what to do:

- **« Lier à Mnemo »** (link to Mnemo) when the MCP declaration or the hooks are missing or out of date. It calls
  `POST /api/moteurs/:id/lier` (no body), which does for this engine only what `mnemo declarer --moteur <id> --lier`
  does, then reads the machine again; the steps light up and a toast says « <engine> lié à Mnemo. ». A failure is shown
  in the box. The same command is offered below, to copy, for a terminal. The route answers 404 for an engine the
  service does not know, 409 when the engine's command cannot be found, when `MNEMO_SANS_MCP=1` is set in the service's
  environment, or while a link of the same engine is already running; its answer carries the steps of the link and
  every engine read again (like `GET /api/moteurs?poste=1`), types `ReponseLiaisonMoteur` and `LiaisonMoteurVue` in
  `@mnemo/contrat`.
- **« Copier »** copies the command to type in the engine (`/hooks` in Codex) when the hooks wait for an approval.

Each card also lists its **team** (the profiles that run on this engine, with « Nouveau profil » to create one on it)
and its **models** (the list the engine gives).

**« Relire »** (read again, with the time of the last check) checks the machine again. An engine installed or moved
after the service started is picked up there: the service adopts the command it finds now, new sessions start it, and
its version is read again; running sessions keep their process. No restart of the service is needed. A command that has
disappeared is not adopted: the card says it can no longer be found. The light reading of the engines (Settings ›
Profiles, `GET /api/moteurs` without `poste=1`) looks for nothing new.

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
- **Injected context.** The confidence score has one model per level: « Complets » scores the notes the reranker saw,
  « Sens seul » the others. At « Coupés », without meaning, there is no score: no %, no automatic injection, the ranking
  follows the words (see "Injected context").
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

Each result of `chercher` (and of `mnemo cherche`) has one **score**: `score = base + weights`. The leads of a session
are ranked otherwise (see "Injected context").

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
message, or a Mistral Vibe session that never sent its first hook, stays "à relire").

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
  border (double-click: default width). In the session bar, left of the Dossier and Contexte switches, one small avatar
  per agent (profile) with a live session, the archivist included: its most urgent state (waiting for an answer: amber
  dot with a ring; working: pulsing dot; idle: hollow dot) and its number of sessions; a click goes to that session (the
  archivist: its drawer). The row hides when the bar gets narrow.
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

In the interface, **New session** (« + Nouvelle session » in the session bar, or « + session » on a folder) works like a
character select.
The chosen agent (a work profile started in a dialog) stands large in the middle, on a floor in its colour, its
neighbours smaller on each side; the arrows, ← and → (outside a text field), a click on a neighbour or on the row of
agents below choose another. Its sheet gives its name, whether it is the default, built-in or your own, its
description, its provider, engine and version, its model (the one the profile sets, or « par défaut du moteur », the
engine's default), where it starts, and its equipment (skills, plugins, hooks). Below, the state of its engine:
« Prêt » (ready), or what blocks it. An engine that is not linked to Mnemo blocks the launch (« Lancer » unavailable,
with the reason), since without its MCP server and hooks Mnemo cannot follow the session; « Lier à Mnemo » links it on
the spot, « Voir dans Réglages » opens Settings › Système. Hooks still to approve in the engine, or a state that cannot
be read, are only flagged. The folder is folded behind « Changer » (fixed for a profile that starts in the memory), the
objective is optional, and the footer sums up the choice and starts it with « Lancer <agent> » (Enter). Profiles started
outside a dialog, warnings and ignored profiles are listed under the sheet. Motion is turned off under « reduce
motion ».

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
Vibe; the token of GitHub's coding agent is never passed either. `GH_TOKEN` and `GITHUB_TOKEN` are passed to every
engine (`gh` and git use them).


Mnemo keeps a log of the gestures made on the notes it proposes: a note you inject by hand, set aside with ✗ (for the
session or for good) or restore, a note Mnemo injects by itself, a note Claude reads with `lire` after a lead proposed it,
and the reactivation of automatic injection. These gestures give the history used by the ranking and the watch of
automatic injection (see "Injected context"). Each gesture keeps the text of your last meaningful message
and, when the meaning model has already computed it, that message's vector. The log lives in `.mnemo/etat.sqlite` only
(never in the versioned memory), survives `/clear`, `/compact` and the end of the session, and is never purged on its
own. Deleting a session keeps its gestures but erases the text and the vectors of its messages from the file.

### Codex sessions

A profile whose engine is Codex starts `codex` (0.171 or later; `MNEMO_CODEX` names another binary) in the terminal of
the session, without a shell, with your ChatGPT subscription (`CODEX_API_KEY` is removed from its environment). The hooks
are those installed once for the machine (« Lier à Mnemo », `mnemo declarer --moteur codex --lier` or `mnemo init
--codex`) and approved in Codex (`/hooks`): see
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
of the session, without a shell, with the sign-in of your own `vibe`. The hooks are those installed once for the machine
(« Lier à Mnemo », `mnemo declarer --moteur mistral-vibe --lier` or `mnemo init --mistral`): see
[installation.md](installation.md#mistral-vibe). They act only in a session started by Mnemo, and follow the hooks of
the profile.

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

Mnemo's aim is to give each session what it should know from the memory. At each meaningful message it ranks the notes
that may help, injects whole the few it is sure of, and proposes others as **leads**: a card (title, path, one line) that
the agent reads with `lire` when it helps its task. The tools `chercher`, `lire`, `lister`, `voisins`, `chronologie` and
`contexte` stay available for the rest.

What a session receives, in this order:

1. **The instructions** that apply to the position of the session: `toujours` and `verifiee` at every message, `rappelee`
   all together in the first message.
2. **The note of the position**, whole, like a CLAUDE.md: the note of the project or client the session is started in.
   It comes at the first message that is not mute, again after `/clear` or `/compact`, and again if the note changes.
   Beyond 8000 characters it becomes a lead.
3. **The notes you inject by hand** (➤, below), whole, under `## Fiches injectées à la demande de l’utilisateur`.
4. **The notes injected by Mnemo**, whole, under `## Fiches injectées par Mnemo (très proches de ta demande)`: only with
   an accepted confidence score (below).
5. **The leads**, under the title `## Pistes de Mnemo (lis avec `lire` celles qui servent ta tâche)`. A lead shows the
   title, the path, the first sentence of the summary, the type and the reason.

Whatever cites documents is framed as `<donnees>`.

**A ranking at every message.** Each message that is not mute ranks all the candidates:

- the notes of the folder of the position and the notes linked to the position (one or two hops);
- the neutral notes, filed under no project or client (people, practices…);
- the notes stored under a place from elsewhere (another client, another project) that your message names;
- the notes linked to a note you inject by hand (one hop, a relation or a written link, either way), even from elsewhere.

At the root (no position), only the neutral notes and the linked ones are candidates. Never candidates: `source`,
`dossier`, `consigne`, `profil` and `episode` notes, outdated notes, and the notes you set aside. Each candidate gets
signals: the meaning of the message (compared with the other notes of the memory), its words, the weight of a note
injected by hand on its neighbours, and the history of your gestures (below). When the estimate of its duration fits in
the time left, the reranker also scores the first 5 to 8 candidates during the hook. The whole ranking is kept in the
journal of the session and shown in the Contexte panel.

**Refinement in the background.** Once the hook has answered, the service asks the reranker to score the first 30
candidates, plus those a signal designates (40 at most, within 3 seconds); if meaning did not answer in time, it computes
it too. The ranking of the panel is updated in place, and the models button of the session reads « affinage… »
(refining) meanwhile. Refinement changes nothing in the session: no injection, no lead, nothing kept for a later message.
A newer meaningful message makes it obsolete: it stops and writes nothing.

**The confidence score.** A small model, learned on your own judgements (`mnemo banc contexte --apprendre`, see
[Benchmarks](#benchmarks)), turns the signals of a note into the probability that it is useful for this message. There is
one model per level of the models: « Complets », for the notes the reranker scored, and « Sens seul » (meaning only), for
the others. The coefficients are in `.mnemo/coefficients-note.json`, written by the learning and read again when it
changes; without this file, Mnemo uses the defaults shipped with it, which have not learned anything yet. A model is
**accepted** only if it passes strict criteria on your judgements (enough injections in enough real sessions, a high
precision even at its pessimistic bound, a calibrated score, few injections on messages that need none), and only for the
model files it was learned with. Three cases:

- **Accepted**: the score is a calibrated percentage. It orders the ranking, chooses the leads and may inject a note.
- **Learned but refused** (criteria not met, or other model files installed since): its score still orders the ranking
  and chooses the leads at each message, but nothing is injected by Mnemo: « ordre seul » (order only). Its score is
  shown in grey with the sign « about », « ≈ 42 % », never as a calibrated percentage.
- **Nothing learned** (a new installation): a provisional rule, also « ordre seul ». The ranking follows the meaning and
  the words; the first new notes go out as leads only at the first message and at the message that carries a note you
  inject by hand, at most `contexte.pistesParMessage`. Without the meaning model, a lead must match the words of the
  message or be linked to an injected note (at the first message, the notes of the folder of the position still qualify).

**Leads.** With a learned score, each meaningful message sends as leads the new notes whose score reaches
`contexte.seuilPiste` (10 % by default), best first, at most `contexte.pistesParMessage` (3 by default). A note whose title
or alias is written in your message (whole words, at least 4 letters) is a lead at any message, with the reason *nommée*,
at most `contexte.cartesNommees` (5 by default), in the order of the message. Naming the place of a note from elsewhere
unlocks the notes stored under it, and only those that are named too are proposed.

**Automatic injection.** With an accepted model, Mnemo injects a note whole at the message itself when:

- its score reaches `contexte.seuilInjection` (90 % by default; 100 %: never);
- its score without the history of your gestures is still 70 % or more: the history alone never injects a note;
- the session has not already received or read it as it is now;
- it is 8000 characters or shorter, and there is still time to read it within the hook (otherwise it stays a lead).

At most `contexte.injectionsParMessage` notes per message (2 by default), best first. A named note injected whole is not
also a lead. Nothing is injected automatically after a tool call, at a mute message, by the refinement or by the
`contexte` tool.

**Watching automatic injection.** For each level, Mnemo follows the last 100 notes it injected automatically, since the
model was learned or since you last reactivated injection. An injection counts as wrong when you set the note aside (✗)
later in the same session without restoring it. When the lower bound of the Wilson interval (95 %) of these injections
falls below 0.75, automatic injection stops for that level (a window not full yet counts the missing injections as
right). The scores and the order stay; ➤ still injects by hand; if « Complets » is cut, « Sens seul » takes over when it is
accepted and not cut. The Contexte panel then says « Injection automatique coupée », with the reason (*N des M dernières
fiches injectées par Mnemo ont été écartées*) and a **Réactiver** button (reactivate), which starts a new window. A model
learned and accepted again also starts a new window. When the log of gestures cannot be read, automatic injection waits
for the next reading.

**The history of your gestures.** The gestures of past sessions on a note give it a prior: injected by hand, or read by
the agent after a lead, count for it (a read counts half, and the reads of a note are capped); set aside counts against
it. A gesture weighs less with age (half-life: 60 days), half as much when it was made elsewhere (another position or
folder), and more when its message looks like the current one. The prior is bounded, and only a learned score that
uses it takes it into account; a lead it pushed up reads *souvent injectée*.

What Mnemo does not do:

- A **mute message** is not ranked and gets neither lead nor automatic injection: a message that starts with a tag
  (`<task-notification>`, `<command-name>`…) or that has fewer than two meaningful words ("oui vas-y pousse"). Only the
  instructions come, and the note of the position if it was not injected yet.
- **Nothing after a tool call**: `PostToolUse` only records which notes the agent reads or writes.
- No note from another project or client unless your message names it, names its place, or it is linked to a note you
  injected by hand. Episodes stay findable with `chercher` and `chronologie`.
- A lead already proposed is not proposed again while the note is unchanged. A note you set aside for the session, and
  the note of the position if it was set aside, are never injected again in that session (unless you ask for it with ➤).
- After `/clear` or `/compact`, leads can be proposed again and the note of the position is injected again.

The `contexte(question)` MCP tool draws leads on demand: given a question, it returns up to 10 cards of the closest notes
by meaning, notes from elsewhere included (the agent asked), ordered by the same score, to read with `lire`. It leaves
out the notes you never want suggested, and never injects anything.

The profile `travail` does not tell the agent how to use its own native memory. It says that the Mnemo memory holds
information relevant to the work, that Mnemo proposes leads, and to write with `proposer` whatever is worth keeping. The
automatic memory of Claude Code, and the memory of Codex, stay off in the sessions started by Mnemo.

**Injecting a note by hand.** In the Contexte panel, ➤ "Injecter dans la session" (inject into the session) on a line
queues the whole note for the session's **next message** (never after a tool call): it is then injected whole, under
`## Fiches injectées à la demande de l’utilisateur`, even if it was set aside or already injected, and recorded as
injected. ➤ stays lit until then; a second click cancels it. The notes linked to it become candidates with the reason
*liée à …*: injecting a note adds `contexte.poidsInjection` (0.25 by default) to each note linked to it; the weight halves
every `contexte.demiVieInjection` messages (3 by default; mute messages do not count, time does not either), is dropped
below 0.02, and several injected notes add up to 0.40 at most on the same note. Injecting the note again restarts its
weight; `/clear` and `/compact` clear all weights. A weight still active also counts in the `contexte` tool.

**Setting a note aside.** On hover, ✗ opens a menu with two choices:

- « Pas pour cette session » (not for this session): the note is no longer proposed nor injected in this session. It is
  listed under « Écartées (N) », with « Rétablir » (restore).
- « Ne plus jamais suggérer » (never suggest again): the note leaves the candidates of every session and of the
  `contexte` tool. Its page in Mémoire says so, with « Rétablir ».

When you set the same note aside in 3 sessions, on at least 2 different days, the panel asks « écartée dans 3 sessions :
ne plus la suggérer ? », with « Ne plus suggérer » and « Garder » (keep: it stays aside for this session only). Setting
aside a note Mnemo injected counts as an error for the watch above.

**Contexte panel.** For the selected session, one list, "Injecté dans la session":

- At the top, ◆ the notes injected whole, oldest first, with on the right how: « du dossier » (the note of the position),
  « à la main » (➤), or « auto 94 % » (injected by Mnemo, with its score at that message; the tooltip gives the threshold
  and the time).
- One separator between what the session has seen (◆) and what it has not, as soon as a note was injected (none: nothing
  to separate, no line): a plain grey line; when
  automatic injection is active (accepted score, not cut), the same line becomes the dashed threshold of injection,
  « seuil d’injection 90 % »; when it is cut, grey again, « seuil 90 % – coupé ». Under it, when cut, the notice and
  « Réactiver ». A note above the threshold that was not injected (refined later, or the cap per message reached) stays
  under the line: the session has not seen it.
- Finding a note: the magnifier at the right of « Injecté dans la session » (or `/` in the panel) opens « Chercher une
  fiche… » (find a note) just under the separator (at the top of what the session has not seen when nothing is
  injected). From two characters, a targeted search of the memory (the same search as the palette, notes only) replaces
  the list below it (the ◆ stay above), one line per note, without %; ➤ injects it, a click on the title opens it, a note
  already injected is marked ◆, without ➤, and a note set aside says so. ↑/↓ move through the results; Escape empties
  the field, then closes it. The magnifier stays lit while a search has text.
- The ranking of the last meaningful message: on the left the calibrated score in %; in « ordre seul », the uncalibrated
  score in grey (« ≈ 42 % »: the refused model, the provisional rule, or an entry from before the live ranking), or ◇
  when there is none; the type dot and the title, with the reason under it and « piste » when the note was sent as a
  lead. At each ranking, then at the refinement, the lines slide to their new place, ▲/▼ shows a change of rank for a
  few seconds, and a newcomer fades in; a note that becomes injected appears at the top in a fade rather than sliding up
  through the list. When the last meaningful message predates the live ranking, the panel says the ranking comes at the
  next message.
- « Plus tôt dans la session » (earlier in the session): the leads of earlier messages and the notes the session read (◈,
  tools `lire` and `voisins`) that are not in the ranking, most recent first, without %. A note read that is already in
  the list keeps its line, and its tooltip adds « lue aussi à HH:MM ».
- Then the suggestion of the 3 sessions, « Sous le seuil (N) » (notes scored under 5 %) and « Écartées (N) ».

On hover, a line offers ➤ and ✗; a note that was only read has ➤ alone, since only what Mnemo proposed can be set aside.
A mute message shows its reason under the list. Clicking a title opens the note. The list scrolls on its own and stays
anchored where the injected notes and the ranking meet. The models button of the session, at the right of the panel
title, always shows a plain text at the left of its icon, which stays in place (no frame; the whole button opens the
menu). At rest, dimmed: the state of the ranking, « ordre seul » (no accepted score; the reason in its tooltip),
« calibré » (an accepted level injects) or « injection coupée ». During the computation that follows a meaningful
message, its current step, sent by the service as it starts (it never delays the hook): « recherche… », « reranker… »,
« note… », « lecture des fiches… », then in the background « sens… », « affinage 10/30… » (by batches of 10) and
« note… ». A step shows only if it lasts more than 150 ms, and stays at least 400 ms. An activity of the models for the
session comes first. While something is under way (a step, an activity, models loading in the title bar button too),
a slow highlight passes over the letters; with reduced motion, the text stays dimmed.

Above the list: the avatar of the profile, the state and the objective of the session, then its engine and model (the
**Moteur** line), its folder, start, duration, branch and, once known, the **Contexte** line: how full the agent's
context window is (read from the end of the session's transcript by the service, for this gauge only; the same gauge runs
under the title bar of the session). When Claude Code's `autoCompactWindow` setting is set (the project's
`.claude/settings.local.json`, then `.claude/settings.json`, then `~/.claude/settings.json`; read again at each reading),
the gauge fills up to that threshold instead of the size of the window, and its tooltip says "tokens avant résumé
automatique" (before the automatic summary).

The context settings (`contexte.seuilInjection`, `contexte.injectionsParMessage`, `contexte.seuilPiste`,
`contexte.pistesParMessage`, `contexte.cartesNommees`, `contexte.poidsInjection`, `contexte.demiVieInjection`) and the
minimum similarity of search are listed in [installation.md](installation.md#settings).

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
- **Engine**: Claude Code, Codex or Mistral Vibe, the coding agent that runs the sessions of the profile, shown with its
  provider (Anthropic, OpenAI, Mistral). Each line says whether the engine is ready on this computer; one that cannot be
  found is greyed out with the reason. The archivist stays on Claude Code. A profile on another engine shows a badge in
  the list.
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
paste into your own terminal (`claude …`, `codex …` or `vibe …`; a Codex or a Mistral Vibe that cannot be found is
refused instead, see [Codex sessions](#codex-sessions) and [Mistral Vibe sessions](#mistral-vibe-sessions)). The session is followed through its hooks, without a terminal in Mnemo. The meaning
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
- `mnemo banc contexte [--json]`: the leads proposed on messages labelled by hand, and the measures of the judged
  messages, from the file `.mnemo/banc-contexte.json` (private, never committed); `--recalculer` computes the signals
  again with the models. It ranks as the hook does, reading the index and the log of gestures as they are, without writing
  to them. The steps to learn the confidence score of your memory (see [Injected context](#injected-context)):
  1. `--extraire [<session>] [--nombre <n>]` adds real messages from your sessions (varied, deduplicated), each with the
     notes to judge: the union of the first ones by meaning, by words and by the reranker, plus two notes drawn outside
     that union, to measure what it misses. `--par-session <n>` (6 by default) caps the messages taken per session.
     `--completer` reruns the extraction on the messages already taken; their new notes are added.
  2. `--juger` shows the notes one at a time, without score or rank, one key per answer (`o` useful, `n` not useful, `i`
     undecided, `r` nothing useful for this message, `s` skip the message, `b` back, `q` quit), saves each answer and
     resumes where you stopped (a copy `banc-contexte.json.bak` is kept from before the session; only one of these
     commands may write the file at a time). After `--completer`, it asks only the new notes.
  3. `--apprendre [--module <path>]` learns one model per level (« Complets » and « Sens seul ») on the judgements,
     validated on sessions it did not learn from, and decides whether each one is accepted: at least 25 simulated
     injections in at least 10 real sessions, a pessimistic precision of 90 % or more (80 % or more at its lower Wilson
     bound and at the 2.5th percentile of a bootstrap by session), a calibration slope between 0.8 and 1.25, at least 20
     judged messages that need nothing (from 5 sessions) with an injection on at most 5 % of them, and at most 0.5
     injection per message. It writes the coefficients to `.mnemo/coefficients-note.json`, which the service reads again
     at once, and its report to `.mnemo/apprentissage-note.txt` (and `.json`): the reason of each refusal, and what each
     threshold would give. Neither file holds any text of a note or a message. `--module <path>` also writes the
     coefficients as the TypeScript module of defaults shipped with Mnemo (for development).

  A note changed since the extraction has its judgement left out (`--empreintes garder` to keep it). `--json` also gives
  the judged pairs with their raw signals. Nothing is written to `.mnemo` except these files.
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

`mnemo init --codex`, `mnemo declarer --moteur codex --lier` or « Lier à Mnemo » in Settings › Système › Moteurs
declares the same server to Codex at user level, so every Codex session reaches the memory, and installs the Mnemo hooks
for the sessions started by Mnemo. If `codex` cannot be found, `init --codex` prints the command to run yourself;
`--lier` and the button refuse, and link nothing:

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
context at the first message, no leads per message, no episode at the end. Claude searches and reads the memory when it
decides to, or when you ask it.

`mnemo mcp` finds its folder from `CLAUDE_PROJECT_DIR`, then from the current folder. The Claude app starts it outside any
Mnemo folder, so `mnemo mcp` then falls back to `MNEMO_RACINE` when that is a Mnemo folder; the position used by search is
then the root of the memory.
