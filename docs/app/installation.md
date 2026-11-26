# The macOS app: installation

Mnemo for macOS: an icon in the menu bar and the interface in its own window. This page covers installing, building and
removing the app; using it is in [usage.md](usage.md). Mnemo itself (memory, service, command line, settings) is
documented next to it: [installation](../installation.md), [usage](../usage.md).

Disk use: about 460 MB (measured: Electron 250 MB, its own Node.js 140 MB, Mnemo's code with its dependencies and the
interface 60 MB). The local models are not in it (about 1.3 GB, optional, in a cache outside the folder).

On macOS, Mnemo also comes as an application: an icon in the menu bar that shows what your sessions are doing, and the
interface in its own window, without a browser and without a token to paste. The app carries its own Node.js and its own
copy of Mnemo: with it, you need neither Node.js, pnpm nor a clone of the sources, only git and Claude Code. The service
is still a separate process, so the `mnemo` command, the hooks and the MCP server work as before. Using the app is
described in [usage.md](usage.md).

## Install from the `.dmg`

1. Download `Mnemo-<version>-arm64.dmg` from the [latest release](https://github.com/GauthierCoste/claude-mnemo/releases/latest)
   (free; or build it yourself, see [below](#build-the-app-from-the-sources)), open it and drag Mnemo onto the
   Applications folder. The released `.dmg` is for Apple silicon; on an Intel Mac, build the app yourself.
2. Open Mnemo from Applications (Finder, Launchpad or Spotlight), not from the disk image. The app is signed ad hoc, not by an identified Apple developer (the project has no Apple Developer
   account), so the first time macOS refuses to open it. Either Control-click (right-click) Mnemo in the Finder, choose
   Open (« Ouvrir »), then Open again in the dialog; or, on recent macOS versions where that dialog has no Open button,
   go to System Settings › Privacy & Security (« Réglages Système › Confidentialité et sécurité »), find the message
   about Mnemo and click « Ouvrir quand même » (Open Anyway). macOS remembers it: later openings are normal.
3. The installation assistant opens.

Opened from the disk image (`/Volumes/…`), or from the temporary copy macOS makes of a downloaded app that was never
moved (App Translocation, a random path erased when the app quits), the app installs nothing: the assistant only asks you
to drag Mnemo into Applications and open it again from there (the command, the MCP declaration and the configuration
would otherwise point to a path about to disappear). Quit it by closing its window.

## The installation assistant

The app shows it when it has no configuration yet (or an unreadable one), or when its folder no longer holds a memory
(`_mnemo/SCHEMA.md` is gone); from the disk image or a temporary copy, it shows only the request to move the app (see
above). It is a page of the app itself, with no network access; its links (installing git or Claude Code) open in your
browser. The steps are listed at the top of the window:

1. **Vérifications** (checks): git, Claude Code (the `claude` the sessions will run) and the Node.js version, through
   `mnemo verifier-poste --json`. Without git: `xcode-select --install` in a terminal, or the link to install it;
   without Claude Code: « Installer Claude Code ». « Vérifier à nouveau » checks again; « Continuer » is available once
   both are there.
2. **Dossier** (folder): « Choisir un dossier… » opens the macOS folder picker (a new folder can be created there).
   Choose the folder that holds your projects: the memory goes into its `_mnemo/`. A folder that already has a Mnemo
   memory is reused as is (« Mémoire existante, reprise telle quelle »); choosing the `_mnemo/` folder of a memory means
   its parent; a folder inside a memory is refused.
3. **Choix** (choices), one checkbox each:
   - « Déclarer Mnemo à Claude Code » (the MCP server, for all your Claude Code sessions): yes by default;
   - « Installer la commande « mnemo » » (`~/.local/bin/mnemo`): yes;
   - « Télécharger les modèles locaux » (search by meaning, about 1.3 GB): no;
   - « Ouvrir Mnemo à l'ouverture de session » (at login, in the menu bar only): yes.
4. **Installation**: « Installer » runs `mnemo init <folder> --json` with one explicit option per choice (see
   [the command line of Mnemo](../usage.md#command-line)), and shows each step as it goes (memory, declaration to Claude Code, models,
   command), with one progress bar per model download. A step that fails outside the memory does not stop the others:
   it is marked, and you can redo it later with `mnemo init` in that folder. If Claude Code already has a Mnemo
   declaration made for another installation (another copy of Mnemo, or the sources), the assistant rewrites it for
   this app right away (`mnemo declarer --remplacer`, user scope only) and shows the step as done; a declaration of
   another scope stays, and the step stays failed with the commands to run by hand. If the memory itself could not be
   created, « Revenir aux choix » lets you try again.
5. **Prêt** (ready): « Ouvrir Mnemo » writes the configuration of the app, applies the open-at-login choice, starts the
   service and opens the interface.

Closing the assistant before the end quits the app without writing its configuration (what `init` already did stays).

The configuration is `~/Library/Application Support/Mnemo/config.json`, readable by you only: the Mnemo folder, the
`PATH` given to the service (where it finds `git` and `claude`, and that the Claude Code sessions it starts receive) and
the port, if one is fixed (`MNEMO_PORT`). Opened from the Finder, the app only gets the minimal `PATH` of macOS, so the
assistant reads the `PATH` of your login shell (`$SHELL`, `/bin/zsh` by default, started as a login and interactive shell
with a 10-second limit), as your terminal sees it (nvm, Homebrew, `pnpm`…), and uses it for the checks, for `init` and in
the configuration. If the shell cannot be read, it falls back to `~/.local/bin`, Homebrew and the system folders, and
says so in `installation.log`. « Reprendre le PATH du terminal », in the menu bar menu, reads it again later (see
[usage.md](usage.md#menu)). The same
folder holds `preferences.json`, what the app remembers by itself (answer to the quit question, window size and position,
new versions).

## The app and the `mnemo` command

At each launch, in the background, the app checks that the `mnemo` command, the MCP declaration of Claude Code and the
`mnemo` entry of the Claude app, when they are Mnemo's, run its own Node.js and code, and rewrites them otherwise (after
an update or a move of the app, or over an installation from the sources): the command with `mnemo commande`, the
declaration with `mnemo declarer --remplacer` (user scope only), the entry of the Claude app through the service (only
while it runs, and only an entry for the same Mnemo folder with no other setting added by hand). What is absent, or is
not Mnemo's, is never touched; nothing is checked when the app runs from the disk image or a temporary copy. What was
rewritten, or could not be, goes to `~/Library/Application Support/Mnemo/installation.log`. Once the app is installed,
the `mnemo` command of your terminal therefore runs the copy of Mnemo inside the app.

## Build the app from the sources

```sh
git clone https://github.com/GauthierCoste/claude-mnemo.git
cd claude-mnemo
pnpm install
pnpm construire-app --dmg       # macOS only; without --dmg: the app only
pnpm installer-dev ~/Mnemo      # optional: installs it for that Mnemo folder, without the assistant
```

`pnpm construire-app` (macOS only) builds the interface (`packages/ui`) and the app (`packages/app`), then assembles
`packages/app/dist/Mnemo.app` with `@electron/packager`. It downloads the official Node.js
whose version is pinned in `packages/app/outils/version-node.txt` from nodejs.org, checks its SHA-256 sum and keeps it in
`packages/app/.cache/`, then copies Mnemo's code (`packages/{mnemo,commun,contrat}`) with its production dependencies and the
built interface into the app. The archive must match both the `SHASUMS256.txt` of nodejs.org and the sum pinned in the
repository (`packages/app/outils/sommes-node.txt`). The app is signed ad hoc (on Apple silicon, an unsigned app does not run), or
with a Developer ID when the environment gives one (`packages/app/outils/signature.ts`). `--dmg` also makes the disk image
`packages/app/dist/Mnemo-<version>-<arch>.dmg` (for example `Mnemo-1.5.0-arm64.dmg`), with a link to Applications.

`pnpm installer-dev [<Mnemo folder>]` (development tool, macOS only) copies the built app to `~/Applications/Mnemo.app`
and writes its configuration for that folder (by default the folder the command is run from, or its Mnemo parent), with
the `PATH` of your terminal and `MNEMO_PORT` if set, so the assistant is not shown. It replaces the launcher made by
`mnemo lanceur` or a previous app, never another application named Mnemo. If the app was running, quit it and open it
again. The app runs the copy of Mnemo built into it, not the sources: after updating the sources, run
both commands again. The `node` and `main` written in the configuration (this Node.js and the `main.ts` of
`packages/mnemo`) only serve an app run unpackaged from this repository. `pnpm installer-dev --retirer` removes the app and its
configuration, if they are Mnemo's.

## What the app does not do yet

- **Automatic updates.** They need a Developer ID signature, which needs an Apple Developer account. The app only says
  in its menu when a newer version is published; install it by replacing the app with the new one (your configuration
  and memory stay).
- **Notarization**, for the same reason: hence the first-launch step above.
- **Both processors in one app.** A build is for the processor of the machine that builds it (Apple silicon or Intel).
- **Other systems.** The app is macOS only; elsewhere, the interface runs in the browser.

## Uninstall cleanly

**With the macOS app**, « Désinstaller Mnemo… » in its menu bar menu says what it will remove, what will stay, and asks
for confirmation (« Annuler » by default). It removes the opening at login; the `mnemo` command, the MCP declaration of
Claude Code and the `mnemo` entry of the Claude app, each only if it runs this app (those of another Mnemo installation,
such as a clone of the sources, stay, and so does anything that is not Mnemo's: the dialog lists them); the files of the
app in `~/Library/Application Support/Mnemo/` (`config.json`, `preferences.json`, `installation.log`). It then stops the
service if it runs, moves the app to the Trash (only an app in its place, never one opened from the disk image or a
temporary copy, which you remove by hand) and quits, after listing what was done and what failed. Each removal is
independent: one failure does not stop the others. Your memory (`_mnemo/`) and the local state (`.mnemo/`) stay; so does
the models cache (see [installation.md](../installation.md#uninstall-cleanly) of Mnemo).

**By hand**, for the app: quit it (« Quitter Mnemo »), uncheck its opening at login first if you can (or remove it in
System Settings › General › Login Items), then `pnpm installer-dev --retirer` for an app installed by `pnpm installer-dev`, or drag
`/Applications/Mnemo.app` to the Trash for an app installed from the `.dmg`; delete
`~/Library/Application Support/Mnemo/`. Then the steps of [Uninstall cleanly](../installation.md#uninstall-cleanly) of Mnemo, as for an installation from the sources.
