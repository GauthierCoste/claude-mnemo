# Installing Mnemo

Mnemo gives a folder a structured, versioned memory (Markdown files in a git repository) and injects it into coding
agent sessions: Claude Code, and Codex or Mistral Vibe if you want them. It runs entirely on your machine: a small local service (HTTP
API and web interface on `127.0.0.1`), a command line tool (`mnemo`), and optional local models for search by meaning.

The interface and the command line messages are in French; this guide is in English.

## Requirements

| What | Version / notes |
| --- | --- |
| Node.js | 24 or later (`node --version`). |
| git | Any recent version; the memory is a git repository. |
| Claude Code | The official `claude` command line tool, signed in with your own subscription. Mnemo never uses an API key. |
| Codex | Optional: 0.171 or later, signed in with your ChatGPT subscription. See [Codex](#codex). |
| Mistral Vibe | Optional: 3.1.5 or later, signed in by you. See [Mistral Vibe](#mistral-vibe). |
| pnpm | Only to install from the sources: `npm install -g pnpm` (Node.js 25 and later no longer ship corepack). |
| Build tools | None on macOS and Windows: the session terminals (`node-pty`) come prebuilt. On Linux, node-pty is compiled at install time (`python3`, `make`, a C++ compiler); without them, Mnemo still works in a degraded mode where you paste the `claude …` command into your own terminal. |
| Browser | Any recent browser for the interface. Chrome, Edge or Brave can open it as an app window. |

Operating systems: **macOS** (Apple silicon or Intel) is the platform used daily (Apple silicon). The continuous
integration runs the type check and the tests at each push on Linux and Windows with Node.js 24, and on macOS with
Node.js 26. **On Windows (x64), the desktop app is built, installed and run by the CI at each push, but has not been
tried in real use yet; Linux has not been tried either (only the tests run there).** On Windows, keep the folder under
your user profile (`C:\Users\<you>\…`): file permissions do not protect the local token there, the profile's access
rights do. The macOS launcher (`mnemo lanceur`) is macOS only, and Mnemo does not install the `mnemo` command on
Windows (a developer can still link it from `packages/mnemo` with `pnpm link --global`).

## How much disk and memory

| | Minimum | Recommended | Comfortable |
| --- | --- | --- | --- |
| RAM | 4 GB, without the local models | 8 GB, with the local models | 16 GB, several agent sessions at once with the local models |
| Disk | about 300 MB (program and dependencies) plus your memory | plus about 1.3 GB for the local models | |

Details:

- **Program**: about 270 MB once the dependencies are installed (measured: `node_modules` 268 MB, sources and built
  interface a few MB more).
- **Local models** (optional): about 1.3 GB in a cache outside the folder: llama.cpp engine 12 MB, meaning model
  bge-m3 about 605 MB, reranker bge-reranker-v2-m3 about 606 MB.
- **Service**: about 130 MB of RAM when idle on a fresh memory (measured on macOS); a larger memory and open sessions add
  to it (estimate: under 250 MB for the service itself). Each session is a separate `claude`, `codex` or `vibe` process with its
  own memory use.
- **Local models while running**: about 1.6 GB of RAM for both servers together once loaded (measured on macOS, about
  0.8 GB each, even when idle); about 1.7 GB measured under load. One set of servers serves the whole machine, however
  many Mnemo folders and sessions use it. They start on demand (first search from a tool, the command line or the
  interface) and stop by themselves after 15 minutes without a request, whether the service runs or not (setting
  `modeles.inactiviteMinutes`). They are available for macOS on Apple silicon (Metal) and on Intel (processor only,
  slower), Windows x64 and arm64 and Linux x64 (all three untested); elsewhere there is no search by meaning. Without the
  models, search works by words only, with no error.

### On a small machine

The level of the models sets how much memory they take. Choose it in the interface: the **Local models** button in the title
bar, then the level under « Everywhere ». It applies to the whole machine.

| Level | Models loaded | RAM | Bench (right source in the top 5) |
| --- | --- | --- | --- |
| « Full » (default) | meaning and reranker | about 1.6 GB | 30 of 42 |
| « Semantic only » | meaning | about 0.8 GB | 27 of 42 |
| « Off » | none | none | 20 of 42 |

With 8 GB of RAM or less, choose « Semantic only »: it keeps search by meaning for half the memory. If memory is still
short, choose « Off »: search works by words only and no longer finds an answer worded differently. You can also skip
the models at install time (the default).

## Install from the sources

```sh
git clone https://github.com/GauthierCoste/mnemo.git
cd mnemo
pnpm installer
```

From the downloaded ZIP: unzip it, move the folder to where it will stay (not your Downloads folder: the `mnemo` command,
the application and the MCP declaration point to it), then run `pnpm installer` inside it.

`pnpm installer` runs `pnpm install`, `pnpm construire` (builds the web interface, `packages/ui/dist`), then `mnemo init`
(below; no need to run it again). On macOS and Linux, `init` offers to install the `mnemo` command: `~/.local/bin/mnemo`, a small script that runs
this clone with the Node.js that installed it, whatever Node.js your terminal uses by default. Later, or after moving the
clone or upgrading Node.js: `mnemo commande` (from the clone: `node packages/mnemo/src/adaptateurs/cli/main.ts commande`).
If `~/.local/bin` is not in your `PATH`, it prints the line to add. After a Node.js upgrade, run `pnpm rebuild node-pty`.

### Updating

After an update (`git pull`, then `pnpm installer`), restart what was already running: stop the service (`mnemo arreter`,
from the Mnemo folder), then open Mnemo again, and restart the sessions opened before the update.
Until then, they run the old code, and only one set of models should run for the machine. If you use Codex, run
`mnemo verifier-poste`: when the update changed the Mnemo hooks, approve them again in Codex (`/hooks`). For Mistral
Vibe, `mnemo verifier-poste` says when the hooks are out of date, and « Link to Mnemo » in **Settings › Settings ›
Connections** (or `mnemo declarer --moteur mistral-vibe --lier`) rewrites them; Vibe does not ask for an approval.

## The questions of `mnemo init`

`pnpm installer` runs it for you. Run it yourself only to create another memory, or to give an existing one the MCP
declaration, the command or the application: go to the folder that holds your projects and run

```sh
mnemo init
```

In a terminal, `init` guides you step by step, with a default for each question:

1. the Mnemo folder (default: the current folder; `~/…` is accepted, a relative path starts from the current folder); the
   absolute path is shown and confirmed before anything is created. The memory goes into its `_mnemo/` subfolder, the
   local state into `.mnemo/` (never versioned);
2. declaring the Mnemo MCP server to Claude Code for all sessions (default: yes; `--sans-mcp` skips it);
3. installing the local models, about 1.3 GB to download (default: **no**; later: `mnemo modeles installer`);
4. on macOS and Linux, installing the `mnemo` command in `~/.local/bin` (default: yes; not asked when it is already
   there and up to date; later: `mnemo commande`);
5. on macOS, creating the Mnemo launcher `~/Applications/Mnemo.app` (default: yes; later: `mnemo lanceur`).

`mnemo init --oui` accepts the defaults without asking anything, the MCP declaration included (for scripts and CI), but
installs nothing outside the folder: no models, no command, no application. Without a terminal and without `--oui`,
`init` only creates the memory: nothing is declared, downloaded or installed outside the folder, and it prints the command
that declares the MCP server. Running `init` on a folder that already has a memory never rewrites it; it only asks about
the MCP declaration, the command and the application: this is also how an existing installation gets them, and how you
plug a new installation into a memory you already have (give its folder at the first question). If Claude Code already
declares a Mnemo MCP server pointing to another copy of Mnemo, `init` leaves it and prints the two commands that replace
it (`claude mcp remove mnemo --scope user`, then `claude mcp add …`); `mnemo declarer --lier` does both at once.
`--codex` also declares the MCP server to Codex and installs the Mnemo hooks there (see [Codex](#codex)); without it,
Codex is never touched. `--mistral` does the same for Mistral Vibe (see [Mistral
Vibe](#mistral-vibe)). To link one engine later, `init` is not needed: « Link to Mnemo » in **Settings › Settings ›
Connections**, or `mnemo declarer --moteur <claude-code|codex|mistral-vibe> --lier` from any folder, links it without any
question and touches nothing else. `--langue fr|en` writes the interface language (`interface.langue`) into `.mnemo/reglages.json` with the memory; without it, the interface follows the language of the system (see [usage.md](usage.md#language)). `mnemo init --help` (or `-h`) prints the options of `init`. Explicit options (`--mcp`, `--sans-modeles`…) decide a step without asking, and `--json` gives one JSON line per event,
for a program that drives the installation; `mnemo verifier-poste` checks git, Claude Code and the optional engines first (see
[usage.md](usage.md#command-line)).

## First opening

```sh
mnemo            # starts the service of the current Mnemo folder
```

The interface is at `http://127.0.0.1:4747/`. It is protected by a token stored in `.mnemo/jeton`: the first time, in each
browser, open the address given by

```sh
mnemo jeton
```

(the same address with `#jeton=…`). The browser keeps the token for this address; afterwards the plain address is enough.
`Ctrl-C` stops the service; sessions resume at the next start.

## Codex

Codex is optional. Mnemo needs **Codex 0.171 or later** (`codex --version`), signed in with your ChatGPT subscription; it
never uses an API key (`CODEX_API_KEY` is removed from the environment of the sessions). Mnemo looks for `codex` in
`MNEMO_CODEX`, then in the `PATH`, then, on macOS, in the copy that comes with the ChatGPT app.
Installed after the Mnemo service started? Click « Reload » in **Settings › Settings › Connections**: the service picks up
the command it finds now, without a restart.

1. **Link it to Mnemo.** In **Settings › Settings › Connections**, click « Link to Mnemo » on the Codex line, or, from any
   folder:

   ```sh
   mnemo declarer --moteur codex --lier
   ```

   (`mnemo init --codex`, from the Mnemo folder, does the same while installing Mnemo.) It declares the Mnemo MCP server to
   Codex at user level (`codex mcp add`), so every Codex session reads and writes the memory, even one started outside
   Mnemo. It also installs the Mnemo hooks in `~/.codex/hooks.json` (or `$CODEX_HOME/hooks.json`), keeping the other
   entries of that file. The hooks do nothing outside a session started by Mnemo.
2. **Approve the hooks once.** Codex runs a hook only after you have approved it: open Codex, type `/hooks` and approve
   the Mnemo hooks. Do it again after Mnemo rewrites them (a new link of an out-of-date installation, or an update that
   changes them).
3. **Trust each folder.** The first time Codex starts in a folder, it asks « Trust this folder? » in the terminal of the
   session. Answer it yourself: Mnemo shows the terminal but never answers for you. Until the first message of the
   session has reached the Mnemo hooks, the session can only be abandoned: no pause, wrap-up or resume.
4. **Check.** `mnemo verifier-poste` prints a Codex line: where it was found, its version, the MCP declaration, the hooks
   and whether they are approved. The interface shows the same in **Settings › Settings › Connections**, with « Link to
   Mnemo », the command to run, or the action to take in Codex, when something is missing.

A Mnemo declaration made for another Node.js or another copy of Mnemo is not rewritten by `init`: « Link to Mnemo » or
`mnemo declarer --moteur codex --lier` rewrites the declaration and the hooks for this installation. Your own
settings are never overwritten either: a Mnemo declaration turned off in Codex (`enabled = false`), or one that carries
settings Mnemo does not write (tool approvals, environment, enabled or disabled tools in `[mcp_servers.mnemo]` of
`config.toml`), is left as it is, and the command says what to change by hand. Sessions started by Mnemo still get the
memory, since they pass the server and its tool approvals on the command line; a `[Mnemo] …` line at the top of their
terminal says when your own settings may change what they get.

To remove both the declaration and the hooks: `mnemo declarer --moteur codex --retirer`. It removes only what runs this
Node.js and this Mnemo.

## Mistral Vibe

Mistral Vibe (Mistral's terminal coding agent) is optional. Mnemo needs **Mistral Vibe 3.1.5 or later** (`vibe
--version`). Mnemo looks for `vibe` in `MNEMO_VIBE`, then in the `PATH`, then in `~/.local/bin`.

1. **Install the `vibe` command** (with [uv](https://docs.astral.sh/uv/)):

   ```sh
   uv tool install --python 3.14 mistral-vibe
   ```

   This puts `vibe` in `~/.local/bin`. The Vibe desktop app does not provide this command: Mnemo needs the command
   line tool. If the Mnemo service was already running, click « Reload » in **Settings › Settings › Connections**: the
   service picks up the new command, no restart needed.

2. **Sign in yourself.** Run `vibe` once in a terminal: its setup asks how to sign in (browser or API key). Mnemo never
   signs in for you, never reads your key and never changes how Vibe signs in: a session started by Mnemo uses the same
   sign-in as your own `vibe`.
3. **Link it to Mnemo.** In **Settings › Settings › Connections**, click « Link to Mnemo » on the Mistral Vibe line, or, from
   any folder:

   ```sh
   mnemo declarer --moteur mistral-vibe --lier
   ```

   (`mnemo init --mistral`, from the Mnemo folder, does the same while installing Mnemo.) It writes one `[[mcp_servers]]`
   block named `mnemo` in `~/.vibe/config.toml` (or `$VIBE_HOME/config.toml`), so every Vibe session reads and writes
   the memory, even one started outside Mnemo, and one `[[hooks]]` block per event, named `mnemo-<event>`, in
   `~/.vibe/hooks.toml`. Everything else in these files is kept as it is, line endings included. The hooks do nothing
   outside a session started by Mnemo. Vibe runs them without an approval step. Without `vibe` on the computer, the
   button and `--lier` link nothing and say so; `init --mistral` installs the hooks anyway and prints the declaration as
   a command to paste later.
4. **Check.** `mnemo verifier-poste` prints a Mistral Vibe line (where it was found, its version, the MCP declaration,
   the hooks), and **Settings › Settings › Connections** shows the same, with « Link to Mnemo » when something is missing.

What Mnemo writes, and nothing else: the `mnemo` block of `config.toml` and the `mnemo-…` blocks of `hooks.toml`. For each
session, an agent profile with the instruction of the profile (`mnemo-<session>.toml`) goes into the session folder of
Mnemo (`.mnemo/plugins/<session>/`), never into `~/.vibe` or into your project; the session gets it, the memory server and
the Mnemo tools through environment variables (`VIBE_AGENT_PATHS`, `VIBE_MCP_SERVERS`, `VIBE_TOOLS`), merged with yours.
A `mnemo` block that carries your own settings (environment, working folder, disabled tools…) is left as it is, and
the command says what to change by hand; a block turned off with `disabled = true` stays off.

To remove both the declaration and the hooks: `mnemo declarer --moteur mistral-vibe --retirer`. It removes only what
runs this Node.js and this Mnemo (the `mnemo` block and the `mnemo-…` hooks), and leaves the rest of each file as it is.

**Trust.** Vibe asks « Trust this folder? » only for a project that has its own Vibe settings (a `.vibe/` folder, or
`.agents/skills/`). Answer it yourself in the terminal of the session: Mnemo never does.

**If you use `enabled_tools` or `enabled_agents`** in `config.toml`: they are allow-lists, so a session only gets the
Mnemo tools (`mnemo_*`) and its agent profile (`mnemo-<session>`) if they are listed there. Mnemo does not add them.

## Claude app (Claude Desktop)

To use the memory from the Claude app too, open the settings, **Settings › Connections**, turn on « Mnemo memory » under Claude app, then
restart the Claude app. It gets the memory's MCP tools, not the hooks of a Claude Code session: see
[usage.md](usage.md#connecting-the-claude-app).

## Launcher (macOS)

`mnemo lanceur`, run from the Mnemo folder, creates `~/Applications/Mnemo.app`. A click starts the service if needed
(detached, log in `.mnemo/service.log`) and opens the interface in an app window. `mnemo arreter` stops a service started
this way. Nothing is registered to run at login.

## Settings

Open the interface and click the gear at the bottom of the left rail (shortcut: ⌥, on macOS, Alt+, elsewhere; the key
next to M on a US keyboard). The settings have three tabs: **Agents** (session profiles, see
[usage.md](usage.md#managing-profiles)), **Settings** and **Documentation** (a technical reference on one page, see
[usage.md](usage.md#settings)). **Settings** has three sections,
listed on the left:

- **Connections**: the engines (Claude Code, Codex, Mistral Vibe) on this computer, linked to Mnemo with
  « Link to Mnemo » (see [usage.md](usage.md#engines)), and the MCP servers of the Claude app (see
  [usage.md](usage.md#connecting-the-claude-app)). An amber dot on the tab and on the section says that an engine waits
  for something from you.
- **Memory**: **Recall** (what Mnemo injects into your sessions and proposes as leads, the background
  learning of the confidence score, « Confidence score », and the project markers), **Search** (what the `chercher` tool and the search of the interface bring up, and in which order)
  and **Confidence** (reliability of sources, weight of a fact, what the archivist writes alone). The rarer
  settings are folded under « Fine-tuning ».
- **System**: the service (its state, launcher browser, port), the local models, the main colour, the interface language.

Each slider says in one sentence what its value does; a setting that differs from its default shows the default and
« Restore »; the full explanation is in its tooltip. Changes of Memory and System are saved together, only
when you click "Save" ( leaving the page with unsaved changes asks first).
They are stored in `.mnemo/reglages.json` (only the values that differ from the defaults). A missing or invalid value
falls back to its default with a warning, never a crash.

| Setting | Default | Takes effect |
| --- | --- | --- |
| Project markers, shown as ◆ in the folder tree (`projets.marqueurs`) | `.git`, `package.json`, `composer.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` | immediately |
| Minimum similarity of a search result by meaning, 0.1 to 0.95 (`contexte.similariteRecherche`) | 0.45 | immediately |
| Threshold of automatic injection: score a note needs to be injected whole at the message, 50 to 100 %, 100: never; only with an accepted confidence score (`contexte.seuilInjection`) | 90 % | immediately |
| Notes injected automatically per message, 0 to 5 (`contexte.injectionsParMessage`) | 2 | immediately |
| Threshold of leads: score a new note needs to be proposed as a lead, 0 to 100 %, never above the threshold of injection; acts as soon as a score is learned or shipped with Mnemo, even refused (`contexte.seuilPiste`) | 10 % | immediately |
| Leads per message, 0 to 10 (`contexte.pistesParMessage`) | 3 | immediately |
| Leads for the notes named in a message, 0 to 15, per message (`contexte.cartesNommees`) | 5 | immediately |
| Weight of a note you inject by hand on the notes linked to it, 0 to 1 (`contexte.poidsInjection`) | 0.25 | immediately |
| Half-life of that weight, in messages that are not mute, 1 to 20 (`contexte.demiVieInjection`) | 3 | immediately |
| Relearn the confidence score in the background from your gestures (➤, ✗, notes read), at most once a day; an accepted model is never replaced by a refused one (`entrainement.automatique`, see [usage.md](usage.md#training-the-confidence-score)) | on | immediately |
| Default number of results of `chercher`, 1 to 50 (`recherche.resultats`) | 10 | immediately |
| Default number of results of `chronologie`, 1 to 200 (`recherche.chronologie`) | 30 | immediately |
| First search results whose links are followed (one hop), 0 to 20 (`recherche.graphe`) | 5 | immediately |
| First candidates re-ranked by the reranker, 5 to 100 (`recherche.reranker`) | 40 | immediately |
| Weight added to a search result in the neighbourhood of the current project, 0 to 0.5 (`recherche.poidsPosition`) | 0.1 | immediately |
| Weight taken from a search result for what its confidence lacks, 0 to 0.5 (`recherche.poidsConfiance`) | 0.05 | immediately |
| Weight added to a search result that belongs to the memory rather than an imported source, 0 to 0.5 (`recherche.poidsMemoire`) | 0.05 | immediately |
| Weight added to a recent search result, halved after a year, 0 to 0.5 (`recherche.poidsFraicheur`) | 0.05 | immediately |
| Model shutdown after inactivity, with or without the service, 1 to 240 (`modeles.inactiviteMinutes`). The servers are shared by the machine: they keep the delay of the folder that started them | 15 minutes | next start of the models |
| Note types whose proposed information needs confirmation (`archiviste.typesAConfirmer`; in the interface, the types the archivist writes alone are switched on) | none (all switched on) | immediately |
| Service port (`service.port`) | 4747 | **service restart** |
| Launcher browser (`service.navigateur`) | automatic (Chrome, then Edge, then the default browser) | next opening |
| Interface language: `systeme` (the language of the system), `fr` or `en` (`interface.langue`, see [usage.md](usage.md#language)) | `systeme` | immediately |
| Main colour of the interface, `#rrggbb` (`interface.accent`): active items, links, titles, focus and the logo (title bar, browser tab, Dock icon of the desktop app). The text on it turns light on a dark colour | `#7df0c6` (green) | immediately |

Some settings of the **Memory** section are rules of the memory, which live in the header of `_mnemo/SCHEMA.md`
(versioned with the memory) rather than in `.mnemo/reglages.json`: in **Search**, the recall threshold (`seuil_rappel`,
0.4, under « Fine-tuning »); in **Confidence**, the reliability of each source type (`fiabilites`), the weight of a
declared, observed or inferred fact (`poids_*`) and the repetitions before an instruction is proposed one level up
(`repetitions_pour_monter`, 2). Saving them rewrites only those lines of the header, in one commit
(`mnemo: reglages SCHEMA.md`).

Changing the port changes the interface address: bookmarks, the installed app and the launcher follow the new address
once recreated. The `MNEMO_PORT` environment variable overrides the setting (the settings page then says so). If the
port is taken and the service cannot start, set another one without the interface: edit `.mnemo/reglages.json`
(`{ "service": { "port": 4748 } }`), or start once with `MNEMO_PORT=4748 mnemo`.

Saving rewrites only the settings you changed: entries the file has that this version does not know (written by a newer
version) are kept, and so are invalid entries you did not touch (they stay listed as warnings).

## Uninstall cleanly

1. If the memory is connected to the Claude app, turn off « Mnemo memory » under Claude app in **Settings › Settings ›
   Connections** (« Disconnect » when its entry is out of date), then restart the Claude app.
2. Stop what runs: `mnemo arreter` (service), from the Mnemo folder, and `mnemo modeles arreter` (model servers of the
   machine).
3. Remove the launcher and the command: `mnemo lanceur --retirer` and `mnemo commande --retirer` (each removes only
   what Mnemo created).
4. Remove the installed web app, if any: in its window menu, "Uninstall Mnemo".
5. Remove the MCP declaration: `claude mcp remove mnemo --scope user`; for Codex and Mistral Vibe, the declaration and
   the hooks: `mnemo declarer --moteur codex --retirer` (or `--moteur mistral-vibe`).
6. Delete the models cache (models, engine, and the state and level of the servers): `~/Library/Caches/mnemo` on macOS,
   `~/.cache/mnemo` (or `$XDG_CACHE_HOME/mnemo`) on Linux, or the folder named by `MNEMO_MODELES`.
7. Delete the local state of each Mnemo folder: its `.mnemo/` folder (index, settings, token, logs).
8. Delete the clone of the sources.

Your memory, `_mnemo/`, is plain Markdown in a git repository: keep it, or delete it only if you no longer need it.
