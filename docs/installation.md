# Installing Mnemo

Mnemo gives a folder a structured, versioned memory (Markdown files in a git repository) and injects it into Claude Code
sessions. It runs entirely on your machine: a small local service (HTTP API and web interface on `127.0.0.1`), a command
line tool (`mnemo`), and optional local models for search by meaning.

The interface and the command line messages are in French; this guide is in English.

## Requirements

| What | Version / notes |
| --- | --- |
| Node.js | 24 or later (`node --version`). |
| git | Any recent version; the memory is a git repository. |
| Claude Code | The official `claude` command line tool, signed in with your own subscription. Mnemo never uses an API key. |
| pnpm | Only to install from the sources: `npm install -g pnpm` (Node.js 25 and later no longer ship corepack). |
| Build tools | None on macOS and Windows: the session terminals (`node-pty`) come prebuilt. On Linux, node-pty is compiled at install time (`python3`, `make`, a C++ compiler); without them, Mnemo still works in a degraded mode where you paste the `claude …` command into your own terminal. |
| Browser | Any recent browser for the interface. Chrome, Edge or Brave can open it as an app window. |

Operating systems: **macOS** (Apple silicon or Intel) is the platform used daily (Apple silicon). The continuous
integration runs the type check and the tests at each push on Linux and Windows with Node.js 24, and on macOS with
Node.js 26. **Windows is being adapted and has not been tried in real use yet; Linux has not been
tried either (only the tests run there).** On Windows, keep the folder under your user profile (`C:\Users\<you>\…`):
file permissions do not protect the local token there, the profile's access rights do. The macOS launcher
(`mnemo lanceur`) is macOS only; on Windows, the `mnemo` command is installed with `pnpm link --global` from
`packages/mnemo`.

## How much disk and memory

| | Minimum | Recommended | Comfortable |
| --- | --- | --- | --- |
| RAM | 4 GB, without the local models | 8 GB, with the local models | 16 GB, several Claude Code sessions at once with the local models |
| Disk | about 300 MB (program and dependencies) plus your memory | plus about 1.3 GB for the local models | |

Details:

- **Program**: about 270 MB once the dependencies are installed (measured: `node_modules` 268 MB, sources and built
  interface a few MB more).
- **Local models** (optional): about 1.3 GB in a cache outside the folder: llama.cpp engine 12 MB, meaning model
  bge-m3 635 MB, reranker bge-reranker-v2-m3 636 MB.
- **Service**: about 130 MB of RAM when idle on a fresh memory (measured on macOS); a larger memory and open sessions add
  to it (estimate: under 250 MB for the service itself). Each Claude Code session is a separate `claude` process with its
  own memory use.
- **Local models while running**: about 1.8 GB of RAM for both servers together once loaded (measured on macOS, about
  0.9 GB each); estimate 2 to 3 GB under load. They start on demand (first search from a tool or the command line). While
  the service runs, they stay started and stop with it; without the service, they stop by themselves after 15 minutes
  without a request (setting `modeles.inactiviteMinutes`). They are available for macOS on Apple silicon (Metal) and on
  Intel (processor only, slower), Windows x64 and arm64 and Linux x64 (all three untested); elsewhere there is no search by meaning. Without the models, search works by words only, with no
  error.

## Install from the sources

```sh
git clone https://github.com/GauthierCoste/claude-mnemo.git
cd claude-mnemo
pnpm installer
```

From the downloaded ZIP: unzip it, move the folder to where it will stay (not your Downloads folder: the `mnemo` command,
the application and the MCP declaration point to it), then run `pnpm installer` inside it.

`pnpm installer` runs `pnpm install`, `pnpm construire` (builds the web interface, `packages/ui/dist`), then `mnemo init`
(below; no need to run it again). On macOS and Linux, `init` offers to install the `mnemo` command: `~/.local/bin/mnemo`, a small script that runs
this clone with the Node.js that installed it, whatever Node.js your terminal uses by default. Later, or after moving the
clone or upgrading Node.js: `mnemo commande` (from the clone: `node packages/mnemo/src/adaptateurs/cli/main.ts commande`).
If `~/.local/bin` is not in your `PATH`, it prints the line to add. After a Node.js upgrade, run `pnpm rebuild node-pty`.

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
5. on macOS, creating the Mnemo application `~/Applications/Mnemo.app` (default: yes; later: `mnemo lanceur`).

`mnemo init --oui` accepts the defaults without asking anything, the MCP declaration included (for scripts and CI), but
installs nothing outside the folder: no models, no command, no application. Without a terminal and without `--oui`,
`init` only creates the memory: nothing is declared, downloaded or installed outside the folder, and it prints the command
that declares the MCP server. Running `init` on a folder that already has a memory never rewrites it; it only asks about
the MCP declaration, the command and the application: this is also how an existing installation gets them, and how you
plug a new installation into a memory you already have (give its folder at the first question). If Claude Code already
declares a Mnemo MCP server pointing to another copy of Mnemo, `init` leaves it and prints the two commands that replace
it (`claude mcp remove mnemo --scope user`, then `claude mcp add …`).

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

## Claude app (Claude Desktop)

To use the memory from the Claude app too, open the settings, **App Claude** tab, click « Brancher la mémoire », then
restart the Claude app. It gets the memory's MCP tools, not the hooks of a Claude Code session: see
[usage.md](usage.md#connecting-the-claude-app).

## Launcher (macOS)

`mnemo lanceur`, run from the Mnemo folder, creates `~/Applications/Mnemo.app`. A click starts the service if needed
(detached, log in `.mnemo/service.log`) and opens the interface in an app window. `mnemo arreter` stops a service started
this way. Nothing is registered to run at login.

## Settings

Open the interface and click the gear at the bottom of the left rail (shortcut: ⌥, on macOS, Alt+, elsewhere; the key
next to M on a US keyboard), then the **Système** tab (the **Profils** tab manages session profiles, see
[usage.md](usage.md#managing-profiles); the **App Claude** tab, the MCP servers of the Claude app, see
[usage.md](usage.md#connecting-the-claude-app)). The groups are listed on the left, by how often you will use them: injected
context, memory, archivist, search, projects, models, service, interface. Each setting shows a one-line explanation, its default, and "Rétablir le défaut" (reset to
default); changes are saved only when you click "Enregistrer" (save; leaving the page with unsaved changes asks first).
They are stored in `.mnemo/reglages.json` (only the values that differ from the defaults). A missing or invalid value
falls back to its default with a warning, never a crash.

| Setting | Default | Takes effect |
| --- | --- | --- |
| Project markers, shown as ◆ in the folder tree (`projets.marqueurs`) | `.git`, `package.json`, `composer.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` | immediately |
| Minimum similarity of a search result by meaning, 0.1 to 0.95 (`contexte.similariteRecherche`) | 0.45 | immediately |
| Cards of the folder of the session at its first message, 0 to 30 (`contexte.cartesPerimetre`) | 10 | immediately |
| Cards of the notes named in a message, 0 to 15, per message (`contexte.cartesNommees`) | 5 | immediately |
| Weight of a note you inject by hand on the notes linked to it, 0 to 1 (`contexte.poidsInjection`) | 0.25 | immediately |
| Half-life of that weight, in messages that are not mute, 1 to 20 (`contexte.demiVieInjection`) | 3 | immediately |
| Default number of results of `chercher`, 1 to 50 (`recherche.resultats`) | 10 | immediately |
| Default number of results of `chronologie`, 1 to 200 (`recherche.chronologie`) | 30 | immediately |
| First search results whose links are followed (one hop), 0 to 20 (`recherche.graphe`) | 5 | immediately |
| First candidates re-ranked by the reranker, 5 to 100 (`recherche.reranker`) | 40 | immediately |
| Weight added to a search result in the neighbourhood of the current project, 0 to 0.5 (`recherche.poidsPosition`) | 0.1 | immediately |
| Weight taken from a search result for what its confidence lacks, 0 to 0.5 (`recherche.poidsConfiance`) | 0.1 | immediately |
| Weight added to a search result that belongs to the memory rather than an imported source, 0 to 0.5 (`recherche.poidsMemoire`) | 0.05 | immediately |
| Weight added to a recent search result, halved after a year, 0 to 0.5 (`recherche.poidsFraicheur`) | 0.05 | immediately |
| Model shutdown after inactivity when the service is not running, 1 to 240 (`modeles.inactiviteMinutes`) | 15 minutes | next start of the models |
| Note types whose proposed information needs confirmation (`archiviste.typesAConfirmer`) | none | immediately |
| Service port (`service.port`) | 4747 | **service restart** |
| Launcher browser (`service.navigateur`) | automatic (Chrome, then Edge, then the default browser) | next opening |
| Main colour of the interface, `#rrggbb` (`interface.accent`): active items, links, titles, focus; the logo does not change. The text on it turns light on a dark colour | `#7df0c6` (green) | immediately |

The **Mémoire** group shows the rules of the memory, which live in the header of `_mnemo/SCHEMA.md` (versioned with the
memory) rather than in `.mnemo/reglages.json`: recall threshold (`seuil_rappel`, 0.4), repetitions before an instruction is
proposed one level up (`repetitions_pour_monter`, 2), weight of a declared, observed or inferred fact (`poids_*`), and
reliability of each source type (`fiabilites`). Saving them rewrites only those lines of the header, in one commit
(`mnemo: reglages SCHEMA.md`).

Changing the port changes the interface address: bookmarks, the installed app and the launcher follow the new address
once recreated. The `MNEMO_PORT` environment variable overrides the setting (the settings page then says so). If the
port is taken and the service cannot start, set another one without the interface: edit `.mnemo/reglages.json`
(`{ "service": { "port": 4748 } }`), or start once with `MNEMO_PORT=4748 mnemo`.

Saving rewrites only the settings you changed: entries the file has that this version does not know (written by a newer
version) are kept, and so are invalid entries you did not touch (they stay listed as warnings).

## Uninstall cleanly

1. If the memory is connected to the Claude app, click « Débrancher » in **Settings › App Claude**, then restart the
   Claude app.
2. Stop what runs: `mnemo arreter` (service) and `mnemo modeles arreter` (model servers), from the Mnemo folder.
3. Remove the launcher and the command: `mnemo lanceur --retirer` and `mnemo commande --retirer` (each removes only
   what Mnemo created).
4. Remove the installed web app, if any: in its window menu, "Uninstall Mnemo".
5. Remove the MCP declaration: `claude mcp remove mnemo --scope user`.
6. Delete the models cache: `~/Library/Caches/mnemo` on macOS, `~/.cache/mnemo` (or `$XDG_CACHE_HOME/mnemo`) on Linux,
   or the folder named by `MNEMO_MODELES`.
7. Delete the local state of each Mnemo folder: its `.mnemo/` folder (index, settings, token, logs).
8. Delete the clone of the sources.

Your memory, `_mnemo/`, is plain Markdown in a git repository: keep it, or delete it only if you no longer need it.
