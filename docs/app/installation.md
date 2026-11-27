# The desktop app: installation

Mnemo for macOS and Windows: an icon in the menu bar (macOS) or in the notification area of the taskbar (Windows), and
the interface in its own window. This page covers installing, building and removing the app; using it is in
[usage.md](usage.md). Mnemo itself (memory, service, command line, settings) is documented next to it:
[installation](../installation.md), [usage](../usage.md).

Disk use on macOS: about 460 MB (measured: Electron 250 MB, its own Node.js 140 MB, Mnemo's code with its dependencies
and the interface 60 MB; not measured on Windows). The local models are not in it (about 1.3 GB, optional, in a
cache outside the folder).

Mnemo also comes as an application: an icon that shows what your sessions are doing, and the interface in its own
window, without a browser and without a token to paste. The app carries its own Node.js and its own copy of Mnemo: with
it, you need neither Node.js, pnpm nor a clone of the sources, only git and Claude Code. The service is still a separate
process, so the hooks and the MCP server work as before (and, on macOS, the `mnemo` command). Using the app is described
in [usage.md](usage.md).

## macOS: install from the `.dmg`

1. Download `Mnemo-<version>-arm64.dmg` from the [latest release](https://github.com/GauthierCoste/mnemo/releases/latest)
   (free; or build it yourself, see [below](#build-the-app-from-the-sources)), open it and drag Mnemo onto the
   Applications folder. The released `.dmg` is for Apple silicon; on an Intel Mac, build the app yourself.
2. Open Mnemo from Applications (Finder, Launchpad or Spotlight), not from the disk image. The app is signed ad hoc, not by an identified Apple developer (the project has no Apple Developer
   account), so the first time macOS refuses to open it. Either Control-click (right-click) Mnemo in the Finder, choose
   Open (« Ouvrir » on a French macOS), then Open again in the dialog; or, on recent macOS versions where that dialog has no Open button,
   go to System Settings › Privacy & Security (« Réglages Système › Confidentialité et sécurité » on a French macOS), find the message
   about Mnemo and click « Ouvrir quand même » (Open Anyway). macOS remembers it: later openings are normal.
3. The installation assistant opens.

Opened from the disk image (`/Volumes/…`), or from the temporary copy macOS makes of a downloaded app that was never
moved (App Translocation, a random path erased when the app quits), the app installs nothing: the assistant only asks you
to drag Mnemo into Applications and open it again from there (the command, the MCP declaration and the configuration
would otherwise point to a path about to disappear). Quit it by closing its window.

## Windows: install with `Mnemo-Setup-<version>-x64.exe`

1. Install the prerequisites, if they are not there yet: git ([Git for Windows](https://git-scm.com/downloads/win)) and
   [Claude Code](https://code.claude.com/docs/en/setup), signed in with your subscription. The installation assistant
   checks both and links to these pages.
2. Download `Mnemo-Setup-<version>-x64.exe` from the [latest release](https://github.com/GauthierCoste/mnemo/releases/latest)
   (free; or build it yourself, see [below](#build-the-app-from-the-sources)) and open it. The installer is not signed
   (the project has no code signing certificate), so Windows SmartScreen stops it the first time: click « More info »
   (« Informations complémentaires » on a French Windows), then « Run anyway » (« Exécuter quand même »).
3. The installer has steps: for you only (the default, no administrator rights) or for all users, then the folder (by
   default `%LOCALAPPDATA%\Programs\Mnemo`, for you only), then it installs. It adds Mnemo to the Start menu and to the
   desktop, and registers its uninstaller in Settings › Apps.
4. Open Mnemo (Start menu): the installation assistant opens.

The app is x64; on a Windows ARM computer, Windows runs it under emulation. Once set up, Mnemo lives in the notification
area of the taskbar (Windows may put its icon among the hidden icons, behind the « ^ » arrow: drag it onto the taskbar, or
turn it on in Settings › Personalization › Taskbar, to keep it in view). There is no `mnemo` command on Windows: the app
and its interface stand in for it in daily use (see [The app and the `mnemo` command](#the-app-and-the-mnemo-command)).

## The installation assistant

The app shows it when it has no configuration yet (or an unreadable one), or when its folder no longer holds a memory
(`_mnemo/SCHEMA.md` is gone); from the disk image or a temporary copy, it shows only the request to move the app (see
above). It is a page of the app itself, with no network access; its links (installing git or Claude Code) open in your
browser. The steps are listed at the top of the window:

1. **Language**: « Français » or « English », preselected on the language of the system. The choice is passed to
   `mnemo init --langue` at the installation step (see [the command line of Mnemo](../usage.md#command-line)) and sets the
   language of the assistant, of the menus and of the interface; it can be changed later in Settings (see
   [Language](../usage.md#language)).
2. **Checks**: git, Claude Code (the `claude` the sessions will run) and the Node.js version, through
   `mnemo verifier-poste --json`. Without git: on macOS `xcode-select --install` in a terminal, or the link to install
   it; on Windows « Install Git for Windows ». Without Claude Code: « Install Claude Code ». « Check again »
   reruns the checks (after installing git on Windows, quit Mnemo and open it again if git is still not found: the app keeps
   the `Path` it was opened with); « Continue » is available once both are there.
3. **Folder**: « Choose a folder… » opens the folder picker of the system (a new folder can be created there).
   Choose the folder that holds your projects: the memory goes into its `_mnemo/`. A folder that already has a Mnemo
   memory is reused as is (« Existing memory, reused as is »); choosing the `_mnemo/` folder of a memory means
   its parent; a folder inside a memory is refused.
4. **Choices**, one checkbox each:
   - « Declare Mnemo to Claude Code » (the MCP server, for all your Claude Code sessions): yes by default;
   - « Install the "mnemo" command » (`~/.local/bin/mnemo`): yes (macOS only: not offered on Windows);
   - « Download the local models » (search by meaning, about 1.3 GB): no;
   - « Open Mnemo at login » (at login, in the menu bar or the notification area only): yes.
5. **Installation**: « Install » runs `mnemo init <folder> --json` with one explicit option per choice (see
   [the command line of Mnemo](../usage.md#command-line)), and shows each step as it goes (memory, declaration to Claude Code, models,
   command), with one progress bar per model download. A step that fails outside the memory does not stop the others:
   it is marked, and you can redo it later with `mnemo init` in that folder (on macOS). If Claude Code already has a Mnemo
   declaration made for another installation (another copy of Mnemo, or the sources), the assistant rewrites it for
   this app right away (`mnemo declarer --remplacer`, user scope only) and shows the step as done; a declaration of
   another scope stays, and the step stays failed with the commands to run by hand. If the memory itself could not be
   created, « Back to the choices » lets you try again.
6. **Ready**: « Open Mnemo » writes the configuration of the app, applies the open-at-login choice, starts the
   service and opens the interface.

Closing the assistant before the end quits the app without writing its configuration (what `init` already did stays).

The configuration is `~/Library/Application Support/Mnemo/config.json` on macOS, `%APPDATA%\Mnemo\config.json` on
Windows, readable by you only: the Mnemo folder, the `PATH` given to the service (where it finds `git` and `claude`, and
that the Claude Code sessions it starts receive) and the port, if one is fixed (`MNEMO_PORT`). On Windows, the app
receives the full `Path` of your account and gives the service the one it was opened with, not the one written in the
configuration: after installing a tool, quit Mnemo and open it again. On macOS, opened from the Finder, the app only gets the minimal `PATH` of macOS, so the
assistant reads the `PATH` of your login shell (`$SHELL`, `/bin/zsh` by default, started as a login and interactive shell
with a 10-second limit), as your terminal sees it (nvm, Homebrew, `pnpm`…), and uses it for the checks, for `init` and in
the configuration. If the shell cannot be read, it falls back to `~/.local/bin`, Homebrew and the system folders, and
says so in `installation.log`. « Reload the terminal PATH », in the menu bar menu, reads it again later (see
[usage.md](usage.md#menu)). The same
folder holds `preferences.json`, what the app remembers by itself (answer to the quit question, window size and position,
new versions).

## The app and the `mnemo` command

On Windows there is no `mnemo` command: the app neither installs nor checks one, and its assistant never points to it.
The MCP declaration of Claude Code and the `mnemo` entry of the Claude app are handled as below. To declare Mnemo to
Claude Code by hand, the assistant or `init` give the full command to paste into PowerShell
(`claude mcp add --scope user mnemo -- '<node.exe>' '<main.ts>' mcp`, with the paths of the app's own Node.js and Mnemo).

At each launch, in the background, the app checks that the `mnemo` command, the MCP declaration of Claude Code and the
`mnemo` entry of the Claude app, when they are Mnemo's, run its own Node.js and code, and rewrites them otherwise (after
an update or a move of the app, or over an installation from the sources): the command with `mnemo commande`, the
declaration with `mnemo declarer --remplacer` (user scope only), the entry of the Claude app through the service (only
while it runs, and only an entry for the same Mnemo folder with no other setting added by hand). What is absent, or is
not Mnemo's, is never touched; nothing is checked when the app runs from the disk image or a temporary copy. What was
rewritten, or could not be, goes to `installation.log`, next to the configuration. Once the app is installed, the `mnemo`
command of your terminal (macOS) therefore runs the copy of Mnemo inside the app.

## Build the app from the sources

```sh
git clone https://github.com/GauthierCoste/mnemo.git
cd mnemo
pnpm install
pnpm construire-app --dmg       # on macOS; without --dmg: the app only
pnpm construire-app --installeur   # on Windows; without --installeur: the app only
pnpm installer-dev ~/Mnemo      # optional, macOS only: installs it for that Mnemo folder, without the assistant
```

`pnpm construire-app` builds the interface (`packages/ui`) and the app (`packages/app`), then assembles the app for the
system it runs on with `@electron/packager` (no cross-building): `packages/app/dist/Mnemo.app` on macOS (for the processor
of the Mac), `packages/app/dist/Mnemo-win32-x64/` (`Mnemo.exe`) on Windows (x64). It downloads the official Node.js
whose version is pinned in `packages/app/outils/version-node.txt` from nodejs.org (the macOS archive, or the Windows
`win-x64.zip`), checks its SHA-256 sum and keeps it in `packages/app/.cache/`. The archive must match both the
`SHASUMS256.txt` of nodejs.org and the sum pinned in the repository (`packages/app/outils/sommes-node.txt`).

The app's resources (`Contents/Resources` on macOS, `resources\` on Windows) then hold three folders, with no symbolic
link anywhere (the build checks it):

- `node/`: that Node.js (`node/bin/node`, or `node\node.exe` on Windows);
- `mnemo/`: `packages/mnemo` with its production dependencies in a flat `node_modules` (node-pty keeps only its
  prebuilt binaries for the target: `spawn-helper` on macOS, ConPTY on Windows), and `@mnemo/commun` and
  `@mnemo/contrat` translated to JavaScript in `mnemo/node_modules/@mnemo/`; the build checks that this code loads with
  the bundled Node.js;
- `ui/dist`: the built interface.

On macOS, the app is signed ad hoc (on Apple silicon, an unsigned app does not run), or with a Developer ID when the
environment gives one (`packages/app/outils/signature.ts`), and `--dmg` also makes the disk image
`packages/app/dist/Mnemo-<version>-<arch>.dmg` (for example `Mnemo-1.5.0-arm64.dmg`), with a link to Applications. On
Windows, the app is not signed, and `--installeur` also makes the installer `packages/app/dist/Mnemo-Setup-<version>-x64.exe`
with electron-builder (NSIS, with steps). Run the build through `pnpm construire-app`: on Windows it needs the pnpm that
starts it. The `app-windows` workflow of the repository builds the installer on a Windows machine of GitHub at each
change, installs it silently, starts the app, runs Mnemo from it and uninstalls it. On a version tag, the `release`
workflow runs the tests, builds the `.dmg` on a Mac of GitHub and the installer through `app-windows`, then publishes the
release with both (see [Releases](#releases)).

`pnpm installer-dev [<Mnemo folder>]` (development tool, macOS only) copies the built app to `~/Applications/Mnemo.app`
and writes its configuration for that folder (by default the folder the command is run from, or its Mnemo parent), with
the `PATH` of your terminal and `MNEMO_PORT` if set, so the assistant is not shown. It replaces the launcher made by
`mnemo lanceur` or a previous app, never another application named Mnemo. If the app was running, quit it and open it
again. The app runs the copy of Mnemo built into it, not the sources: after updating the sources, run
both commands again. The `node` and `main` written in the configuration (this Node.js and the `main.ts` of
`packages/mnemo`) only serve an app run unpackaged from this repository. `pnpm installer-dev --retirer` removes the app and its
configuration, if they are Mnemo's.

## What the app does not do yet

- **Automatic updates.** On macOS they need a Developer ID signature, which needs an Apple Developer account; on
  Windows, they are not done either. The app only says in its menu when a newer version is published; install it by
  replacing the app with the new one (on Windows, run the new installer over the old one): your configuration and
  memory stay.
- **Notarization** on macOS and **code signing** on Windows, for the same reason: hence the first-launch steps above.
- **Both processors in one app.** A macOS build is for the processor of the machine that builds it (Apple silicon or
  Intel); the Windows app is x64 only.
- **The `mnemo` command on Windows** (see [above](#the-app-and-the-mnemo-command)).
- **Linux.** There, the interface runs in the browser.

## Uninstall cleanly

Close your Claude Code sessions and the Claude app first: their Mnemo MCP server runs the Node.js of the app, and a
running copy keeps its files in use (on Windows, the uninstaller could then leave some of them behind).

**With the app**, « Uninstall Mnemo… » in its menu (menu bar, or notification area on Windows) says what it will remove, what will stay, and asks
for confirmation (« Cancel » by default). It removes the opening at login; the `mnemo` command, the MCP declaration of
Claude Code and the `mnemo` entry of the Claude app, each only if it runs this app (those of another Mnemo installation,
such as a clone of the sources, stay, and so does anything that is not Mnemo's: the dialog lists them); the files of the
app in `~/Library/Application Support/Mnemo/` or `%APPDATA%\Mnemo\` (`config.json`, `preferences.json`,
`installation.log`). It then stops the service if it runs and, on macOS, moves the app to the Trash (only an app in its
place, never one opened from the disk image or a temporary copy, which you remove by hand); it quits after listing what
was done and what failed. On Windows, the uninstaller of the app opens as Mnemo quits and removes the app itself, with its
Start menu and desktop shortcuts. Each removal is
independent: one failure does not stop the others. Your memory (`_mnemo/`) and the local state (`.mnemo/`) stay; so does
the models cache (see [installation.md](../installation.md#uninstall-cleanly) of Mnemo).

**By hand**, for the app on macOS: quit it (« Quit Mnemo »), uncheck its opening at login first if you can (or remove it in
System Settings › General › Login Items), then `pnpm installer-dev --retirer` for an app installed by `pnpm installer-dev`, or drag
`/Applications/Mnemo.app` to the Trash for an app installed from the `.dmg`; delete
`~/Library/Application Support/Mnemo/`. On Windows: quit it, uncheck its opening at login (or turn it off in Settings ›
Apps › Startup), uninstall it from Settings › Apps › Installed apps (« … » next to Mnemo › Uninstall), and delete `%APPDATA%\Mnemo\`;
the MCP declaration of Claude Code is removed with `claude mcp remove mnemo --scope user`. Then the steps of [Uninstall cleanly](../installation.md#uninstall-cleanly) of Mnemo, as for an installation from the sources.

## Releases

A release is published by one command, from an up-to-date `main` with a clean working copy:

```sh
pnpm publier patch      # 1.12.0 → 1.12.1: a fix, a small change
pnpm publier feature    # 1.12.0 → 1.13.0: a large feature
pnpm publier version    # 1.12.0 → 2.0.0: a breaking change, a redesign
```

Write the release notes first in `docs/releases/next.md`: in English, what changes for the user, without the
installation part. The command checks the starting point (branch, working copy, `origin/main`, versions, tag, notes;
`--essai` stops there), runs `pnpm verifier` and `pnpm test`, raises the version of the five packages and the
« Version » line of the README, renames the notes to `docs/releases/<version>.md`, commits `chore: version x.y.z`, tags
`x.y.z`, runs `pnpm verifier-publication` and pushes `main` with the tag. The tag starts the `release` workflow
(`.github/workflows/release.yml`): it checks the tag against the versions, runs the tests and builds the `.dmg` on
macOS, runs `app-windows` for the installer, then creates the release with both files. Its notes are
`docs/releases/<version>.md` followed by `.github/release-pied.md` (installation, SHA-256 of both files, licence). If a
step fails, no release is published; once fixed, run the workflow again (Re-run jobs), which also replaces the files and
the notes of an existing release.
