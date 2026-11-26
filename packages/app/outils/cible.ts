/**
 * La cible d'une construction de l'app : celle de la machine qui construit (pas de construction croisée). macOS : arm64 ou
 * x64, selon la machine ; Windows : x64 seulement (un Windows ARM fait tourner l'app x64 émulée).
 */
import { NOM_APP } from '../src/domaine/identite-app.ts';
import { ErreurConstruction } from './erreur.ts';

export type Arch = 'arm64' | 'x64';
export type Cible = { readonly plateforme: 'darwin'; readonly arch: Arch } | { readonly plateforme: 'win32'; readonly arch: 'x64' };

/** Cible de la machine, ou arrêt de la construction (Linux : pas d'app de bureau). */
export function cibleDeLaMachine(plateforme: NodeJS.Platform, arch: string): Cible {
	if (plateforme === 'darwin') return { plateforme, arch: arch === 'arm64' ? 'arm64' : 'x64' };
	if (plateforme === 'win32') return { plateforme, arch: 'x64' };
	throw new ErreurConstruction('L’app Mnemo se construit sur macOS ou Windows.');
}

/** Ce que `@electron/packager` produit dans son dossier de sortie : le paquet `Mnemo.app`, ou le dossier `Mnemo-win32-x64`. */
export function nomProduit(cible: Cible): string {
	return cible.plateforme === 'darwin' ? `${NOM_APP}.app` : `${NOM_APP}-win32-${cible.arch}`;
}
