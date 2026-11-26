/**
 * Les commandes de `mnemo` lancées par l'app (`<node> <main> <args>`), sans shell : pour refaire ou retirer ce que Mnemo a
 * installé (`mnemo commande`, `mnemo declarer`). L'environnement est celui de l'app avec le `PATH` de la configuration (celui
 * du terminal : `claude`, `git`).
 */
import { execFile } from 'node:child_process';
import { avecVariable } from '@mnemo/commun';
import type { SortieDeclarer } from '@mnemo/contrat';
import type { Lancement } from '../domaine/configuration.ts';

/** `claude mcp get` vérifie aussi que le serveur répond : quelques secondes. */
export const DELAI_COMMANDE_MS = 60_000;

/** Sur un échec, `sortie` : la sortie standard quand même (`mnemo declarer --json` y écrit sa ligne). */
export type ResultatCommande = { ok: true; sortie: string } | { ok: false; raison: string; sortie: string };

const RESULTATS: readonly SortieDeclarer['resultat'][] = ['absent', 'deja', 'remplace', 'autre', 'retire', 'echec'];

const premiereLigne = (texte: string): string => texte.trim().split('\n').find((l) => l.trim() !== '')?.trim() ?? '';

export function lancerMnemo(lancement: Lancement, args: readonly string[], path: string, base: NodeJS.ProcessEnv = process.env): Promise<ResultatCommande> {
	return new Promise((resoudre) => {
		execFile(lancement.node, [lancement.main, ...args], { env: avecVariable(base, 'PATH', path, process.platform), timeout: DELAI_COMMANDE_MS, windowsHide: true }, (erreur, sortie, erreurs) => {
			if (erreur) resoudre({ ok: false, raison: premiereLigne(`${erreurs}`) || premiereLigne(`${sortie}`) || erreur.message, sortie: `${sortie}` });
			else resoudre({ ok: true, sortie: `${sortie}` });
		}).stdin?.end();
	});
}

/** Le résultat de `mnemo declarer --json` (`SortieDeclarer`), ou la raison de son échec. */
export async function declarer(lancement: Lancement, action: '--remplacer' | '--retirer', path: string, base?: NodeJS.ProcessEnv): Promise<{ ok: true; resultat: Exclude<SortieDeclarer['resultat'], 'echec'>; message: string } | { ok: false; raison: string }> {
	const r = await lancerMnemo(lancement, ['declarer', action, '--json'], path, base);
	// sur un échec, la ligne JSON est quand même écrite sur la sortie standard (code 1), quoi que dise la sortie d'erreur
	const texte = r.sortie;
	try {
		const ligne = JSON.parse(texte.trim().split('\n').at(-1) ?? '') as { resultat?: unknown; message?: unknown };
		if (typeof ligne.message === 'string' && RESULTATS.includes(ligne.resultat as SortieDeclarer['resultat'])) {
			const { resultat, message } = ligne as SortieDeclarer;
			return resultat === 'echec' ? { ok: false, raison: message } : { ok: true, resultat, message };
		}
	} catch {
		// pas de JSON : la raison brute
	}
	return r.ok ? { ok: false, raison: `Réponse inattendue de mnemo declarer : ${texte.trim().slice(0, 200)}` } : { ok: false, raison: r.raison };
}
