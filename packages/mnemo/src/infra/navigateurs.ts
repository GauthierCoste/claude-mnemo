import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import type { Navigateur } from '../domaine/reglages.ts';
import { variable } from './environnement.ts';

export type NavigateurChoisi = Exclude<Navigateur, 'auto' | 'defaut'>;

/** Dossiers d'installation de Windows (variables d'environnement), sous lesquels `windows` est cherché. */
const DOSSIERS_WINDOWS = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'] as const;

/**
 * Où chaque navigateur du réglage `service.navigateur` s'installe : application macOS (`nom`), chemin sous `DOSSIERS_WINDOWS`,
 * chemins Linux. `app` : sait ouvrir une fenêtre d'application (`--app=`).
 */
const NAVIGATEURS: Record<NavigateurChoisi, { nom: string; app: boolean; windows: string | null; linux: string[] }> = {
	chrome: {
		nom: 'Google Chrome',
		app: true,
		windows: 'Google\\Chrome\\Application\\chrome.exe',
		linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
	},
	edge: {
		nom: 'Microsoft Edge',
		app: true,
		windows: 'Microsoft\\Edge\\Application\\msedge.exe',
		linux: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'],
	},
	brave: {
		nom: 'Brave Browser',
		app: true,
		windows: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
		linux: ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave', '/opt/brave.com/brave/brave'],
	},
	// Arc n'ouvre pas de fenêtre d'application : un onglet ordinaire ; il n'existe que sous macOS
	arc: { nom: 'Arc', app: false, windows: null, linux: [] },
};
/** `auto` : le premier présent, dans cet ordre. */
const ORDRE_AUTO = ['chrome', 'edge'] as const;

export type Poste = { plateforme: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv; existe: (chemin: string) => boolean };

/** Emplacements où chercher ce navigateur sur ce poste (macOS : le paquet d'application ; ailleurs : l'exécutable). */
function emplacements(n: (typeof NAVIGATEURS)[NavigateurChoisi], o: Poste): string[] {
	if (o.plateforme === 'darwin') return [posix.join('/Applications', `${n.nom}.app`), posix.join(o.home, 'Applications', `${n.nom}.app`)];
	if (o.plateforme === 'win32') {
		const relatif = n.windows;
		if (relatif === null) return [];
		return DOSSIERS_WINDOWS.flatMap((nom) => {
			const base = variable(o.env, nom, o.plateforme);
			return base ? [win32.join(base, relatif)] : [];
		});
	}
	return n.linux;
}

/** Le navigateur réglé, s'il est installé sur ce poste (`auto` : le premier de `ORDRE_AUTO`), avec son emplacement ; null sinon. */
export function navigateurInstalle(navigateur: Navigateur, o: Poste): { nom: string; app: boolean; emplacement: string } | null {
	if (navigateur === 'defaut') return null;
	for (const choisi of navigateur === 'auto' ? ORDRE_AUTO : [navigateur]) {
		const n = NAVIGATEURS[choisi];
		const emplacement = emplacements(n, o).find(o.existe);
		if (emplacement !== undefined) return { nom: n.nom, app: n.app, emplacement };
	}
	return null;
}

/**
 * Commande qui ouvre `adresse` avec le navigateur réglé (macOS : `/usr/bin/open` ; ailleurs : l'exécutable du navigateur ;
 * jamais de shell), ou null pour le navigateur par défaut (réglage `defaut`, ou navigateur absent).
 */
export function commandeFenetre(navigateur: Navigateur, adresse: string, o: Poste): { commande: string; args: string[] } | null {
	const n = navigateurInstalle(navigateur, o);
	if (n === null) return null;
	if (o.plateforme === 'darwin') return { commande: '/usr/bin/open', args: n.app ? ['-na', n.nom, '--args', `--app=${adresse}`] : ['-a', n.nom, adresse] };
	return { commande: n.emplacement, args: [n.app ? `--app=${adresse}` : adresse] };
}

/** Le poste courant, pour `navigateurInstalle` et `commandeFenetre`. */
export const posteCourant = (): Poste => ({ plateforme: process.platform, home: homedir(), env: process.env, existe: existsSync });

/** Nom affiché d'un navigateur du réglage. */
export const nomDuNavigateur = (choisi: NavigateurChoisi): string => NAVIGATEURS[choisi].nom;
