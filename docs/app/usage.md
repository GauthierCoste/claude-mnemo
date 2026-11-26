# The desktop app: usage

The app ([installation](installation.md)) puts Mnemo in the menu bar (macOS) or in the notification area of the taskbar
(Windows), and the interface in its own window. This page describes the macOS app; what changes on Windows is in
[On Windows](#on-windows).
It does not contain the service: it attaches to the service of its Mnemo folder, or starts it, and talks to it as the
interface does (HTTP and WebSocket, with the token).

## The app and the service

At launch, the app reads `.mnemo/service.json` of its folder: if that service answers with its token, the app attaches
to it; otherwise it starts it as [`mnemo ouvrir`](../usage.md) does (detached, log in `.mnemo/service.log`, no browser) and waits for
it. It then shows the window once the service answers, except when it was opened at login (menu bar icon only). Then
it follows the sessions through the WebSocket and checks every 5 seconds that the service answers.

- **Stopped from elsewhere** (`mnemo arreter`, Ctrl-C in the terminal that runs it): the app shows the service as
  stopped and does not start it again; « Démarrer le service » in the menu does.
- **Crashed** (its process is gone, or it did not answer twice in a row, while its `service.json` is still there): the
  app restarts it once. If it falls again within 10 minutes, the app stops there: the icon shows the error, the menu
  gives the reason and « Redémarrer le service », and « Journal du service » says why. Never a restart loop.
- **Restarted elsewhere** (`mnemo` in a terminal): the app attaches to the new service, and its window reloads.
- **Quitting the app** may leave the service running, with its sessions (see [Quitting](#quitting)); the app attaches
  to it again at its next opening.

## Menu bar icon

The icon is the "m" of Mnemo, drawn for the menu bar (it follows a light or dark menu bar). Hovering it says the state
in words (for example « Mnemo — 2 sessions attendent ta réponse »).

| State | When | Icon |
| --- | --- | --- |
| Idle | the service runs, no session is active | the m |
| Waiting | at least one session waits for your answer | the m with a filled dot |
| Working | at least one session works and none waits; also while the service starts or stops | the m, animated |
| Stopped | no service | the m, faded |
| Error | the service does not start, or fell again after its restart | the m, struck through |

The archivist counts as waiting only when it has a question open, as on the archivist button of the interface.

## Menu

A click on the icon opens its menu:

- « Ouvrir Mnemo »: shows the window (while the service runs).
- The active sessions, those waiting first, then those working, oldest first (10 at most, then « N autres sessions… »,
  which opens the window): the objective of each (« Archiviste » for the archivist) and, below, its state and folder.
  A click opens the window on that session. Otherwise a greyed line: « Aucune session active », « Service arrêté », or
  the reason of an error.
- « Démarrer le service », « Arrêter le service », or « Redémarrer le service » after an error. Stopping waits for the
  sessions to stop, like `mnemo arreter`.
- « Ouvrir à l'ouverture de session » (checkbox): Mnemo opens when you log in to macOS, showing only the menu bar icon,
  not the window.
- « Journal du service »: opens `.mnemo/service.log` (in Console).
- « Reprendre le PATH du terminal »: reads the `PATH` of your login shell again (after installing a tool, nvm or
  Homebrew for example), writes it into the configuration (only its `path` field) and, if the service runs, offers to
  restart it (« Redémarrer le service » / « Plus tard »): only sessions started after the restart get it, and the
  running ones stop with the service. If the shell cannot be read, nothing changes and an error box says why. The app
  never does this by itself: the `PATH` stays the one chosen.
- The version of the app (« Mnemo 1.5.0 »); « Version x.y.z disponible » when a newer one is published (see
  [New versions](#new-versions)); « Chercher les nouvelles versions » (checkbox); « Désinstaller Mnemo… » (see
  [installation.md](installation.md#uninstall-cleanly)).
- « Quitter Mnemo ».

## The window

The window shows the interface of the service, as a browser would, but with no address bar and no token to paste: the
app hands the token to the interface itself. It has no macOS title bar: the title bar of the interface takes its place,
with the three window buttons on its left, and dragging it moves the window. Size and position are kept from one opening
to the next (as long as they still fit on a screen). Links to other sites open in your default browser.

Closing the window (red button, ⌘W) does not quit: Mnemo stays in the menu bar, and its Dock icon goes away until the
window opens again. The window comes back with « Ouvrir Mnemo », a session of the menu, a notification, or by opening the app
again (Finder, Spotlight, Launchpad), which also starts a stopped service.

When the window is in front, the menu at the top of the screen has: « Mnemo » (« À propos de Mnemo », « Masquer Mnemo »,
« Quitter Mnemo » ⌘Q), « Édition » (copy and paste, terminals included), « Présentation » (« Recharger », zoom,
« Plein écran ») and « Fenêtre ».

## Dock and notifications

While the window is open, the Dock icon carries a badge: the number of sessions waiting for your answer.

When a session starts waiting for your answer while the window is not in front, macOS shows a notification
(« <objective> attend ta réponse »); a click opens the window on that session. One notification per change: none again
while the session keeps waiting, none for sessions already waiting when the app opens, and none while you are looking at
the window.

## Quitting

« Quitter Mnemo » (menu bar menu, or ⌘Q) asks, while the service runs: « Arrêter aussi le service Mnemo ? », with
« Arrêter le service et ses sessions », « Laisser tourner » (default) and « Annuler ». Left running, the service keeps
its sessions, and the app attaches to it at its next opening. « Ne plus demander » remembers the answer, in
`~/Library/Application Support/Mnemo/preferences.json` (remove its `quitter` entry to be asked again). If the service
does not stop, the app stays open and says why. Quitting from the Dock, or when you log out of macOS, asks nothing: the
service keeps running.

## On Windows

The app works as on macOS, with these differences:

- **Notification area.** The icon is in the notification area of the taskbar (perhaps among the hidden icons, behind
  the « ^ » arrow), white on a dark taskbar and black on a light one, following the theme of Windows. A left click opens
  the window (and starts a stopped service); a right click opens the menu. In the menu, each session takes one line: its
  objective, then its state and folder.
- **No « Reprendre le PATH du terminal ».** The app gives the service and the sessions the `Path` of Windows as it was
  when the app opened: after installing a tool (git, Claude Code…), quit Mnemo and open it again.
- **The window.** The buttons of Windows (minimize, maximize, close) sit at the right of the title bar of the interface;
  there is no menu bar (Alt shows it), but its shortcuts work: Ctrl+Q quits (as « Quitter Mnemo »), and those of the
  « Édition » and « Présentation » menus (copy, paste, reload, zoom) work as their Ctrl versions. Closing the window does not quit:
  Mnemo stays in the notification area.
- **No badge.** The count of waiting sessions is only in the menu and the tooltip of the icon; notifications are those
  of Windows, and a click on one opens the window on its session.
- **Opening at login** (« Ouvrir à l'ouverture de session ») is when you sign in to Windows; it also shows in Settings ›
  Apps › Startup.
- **« Journal du service »** opens `.mnemo\service.log` with the program Windows uses for `.log` files (Notepad by
  default).
- **« Désinstaller Mnemo… »** removes what Mnemo installed, then quits and opens the uninstaller of the app (see
  [installation.md](installation.md#uninstall-cleanly)).
- **Quitting** with Ctrl+Q or « Quitter Mnemo » asks about the service as on macOS. Signing out of Windows closes Mnemo
  without asking, and Windows also ends the service, like every program of your session. Preferences are in
  `%APPDATA%\Mnemo\preferences.json`.

## New versions

Once a day at most, the app asks GitHub Releases for the latest published version of Mnemo: one anonymous HTTPS
request, nothing else is sent. When that version is newer than the app, the menu shows « Version x.y.z disponible »; a
click opens its page. Nothing is downloaded or installed by itself (see
[installation.md](installation.md#what-the-app-does-not-do-yet)). Uncheck « Chercher les nouvelles versions » to stop
asking.
