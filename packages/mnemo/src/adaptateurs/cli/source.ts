import { isAbsolute, relative, resolve, sep } from 'node:path';
import { extraireSource } from '../../application/extraire-source.ts';
import type { DemandeSource } from '../../application/extraire-source.ts';
import { presenterSource } from '../../application/presenter.ts';
import { validerDemandeSource } from '../../application/validation.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { racineDeSession } from './racine.ts';

const USAGE = 'Usage : mnemo source <chemin> [--type <type>] [--version-de <fiche>] [--apres-proches]';

/** Codes de sortie : 0 écrit ou déjà référencé, 1 refus, 2 quasi-copie existante (rien n'est écrit). */
const CODE_PROCHES = 2;

/**
 * Chemin donné (relatif au dossier courant, ou absolu) → chemin relatif à la racine Mnemo, en « / ». Hors de la racine,
 * il est rendu tel quel : `extraireSource` le refuse avec son motif.
 */
function cheminDeRacine(racine: string, dossierCourant: string, donne: string): string {
	const relatif = relative(racine, resolve(dossierCourant, donne));
	if (relatif === '' || relatif.startsWith(`..${sep}`) || relatif === '..' || isAbsolute(relatif)) return donne.replace(/\\/gu, '/');
	return relatif.split(sep).join('/');
}

/** `mnemo source <chemin>` : référence un document du dossier par une fiche source (jamais copié) et indexe ses passages. */
export async function commandeSource(args: string[]): Promise<void> {
	let chemin: string | undefined;
	const demande: Record<string, unknown> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === '--type' || arg === '--version-de') {
			const valeur = args[++i];
			if (valeur === undefined || valeur === '') throw new ErreurCli(USAGE, 2);
			demande[arg === '--type' ? 'type' : 'version_de'] = valeur;
		} else if (arg === '--apres-proches') demande['apresProches'] = true;
		else if (arg.startsWith('--')) throw new ErreurCli(`Option inconnue : « ${arg} ».\n${USAGE}`, 2);
		else if (chemin === undefined && arg.trim() !== '') chemin = arg;
		else throw new ErreurCli(USAGE, 2);
	}
	if (chemin === undefined) throw new ErreurCli(USAGE, 2);
	const { racine } = racineDeSession(process.env.CLAUDE_PROJECT_DIR, process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);

	demande['chemin'] = cheminDeRacine(racine, process.cwd(), chemin);
	const valide = validerDemandeSource(demande);
	if (!valide.ok) throw new ErreurCli(`Refusé : ${valide.motif}`, 2);

	const dependances = dependancesReelles(racine);
	let resultat;
	try {
		resultat = await extraireSource(dependances, valide.valeur satisfies DemandeSource);
	} finally {
		dependances.index.fermer();
	}
	console.log(presenterSource(resultat, { syntaxe: 'cli' }));
	if (resultat.statut === 'refuse') process.exitCode = 1;
	else if (resultat.statut === 'proches') process.exitCode = CODE_PROCHES;
}
