/**
 * Saisie d'un serveur MCP de l'app Claude (Réglages › Branchements › App Claude) : nom, commande, arguments (un par ligne), variables
 * (`NOM=valeur`, une par ligne). En modification, les valeurs existantes ne sont jamais montrées : `NOM` seul garde la
 * valeur actuelle (`null` dans la demande), une variable effacée est retirée. Le reste de la validation est au service.
 */
import { MOTIF_NOM_VARIABLE } from '@mnemo/commun';
import type { ServeurMcpEcriture, ServeurMcpVue } from '@mnemo/contrat';

export type SaisieServeur = { nom: string; commande: string; args: string; env: string };

export const SAISIE_VIDE: SaisieServeur = { nom: '', commande: '', args: '', env: '' };

/** Saisie de départ d'une modification : les noms des variables seuls (leurs valeurs restent au service). */
export const saisieDe = (serveur: ServeurMcpVue): SaisieServeur => ({ nom: serveur.nom, commande: serveur.commande, args: serveur.args.join('\n'), env: serveur.env.join('\n') });

const lignes = (texte: string): string[] =>
	texte
		.split(/\r?\n/u)
		.map((l) => l.trim())
		.filter((l) => l !== '');

/**
 * Demande à envoyer, ou le motif d'un refus. `existantes` : noms des variables du serveur modifié (vide pour un ajout) ;
 * seules elles peuvent être écrites sans valeur.
 */
export function demandeDe(saisie: SaisieServeur, existantes: readonly string[]): { ok: true; demande: ServeurMcpEcriture } | { ok: false; motif: string } {
	const env: Record<string, string | null> = {};
	for (const [i, ligne] of lignes(saisie.env).entries()) {
		const egal = ligne.indexOf('=');
		const nom = (egal < 0 ? ligne : ligne.slice(0, egal)).trim();
		// jamais la ligne dans le motif : elle porte une valeur, peut-être secrète ; ni un nom invalide (une valeur collée
		// seule, sans « NOM= », en serait un) : seulement le rang de la ligne
		if (nom === '') return { ok: false, motif: 'Variable sans nom : une ligne commence par « = ».' };
		if (!MOTIF_NOM_VARIABLE.test(nom))
			return { ok: false, motif: `Variables, ligne ${i + 1} : nom invalide (lettres, chiffres et « _ », sans chiffre au début), à écrire NOM=valeur.` };
		if (Object.hasOwn(env, nom)) return { ok: false, motif: `Variable « ${nom} » écrite deux fois.` };
		if (egal < 0) {
			if (!existantes.includes(nom)) return { ok: false, motif: `Variable « ${nom} » sans valeur : écrire ${nom}=valeur.` };
			env[nom] = null;
		} else env[nom] = ligne.slice(egal + 1);
	}
	return { ok: true, demande: { nom: saisie.nom.trim(), commande: saisie.commande.trim(), args: lignes(saisie.args), env } };
}

/** Ligne de la liste : la commande et ses arguments, ceux qui contiennent une espace entre guillemets. */
export const ligneDeCommande = (serveur: ServeurMcpVue): string =>
	[serveur.commande, ...serveur.args].map((x) => (/\s/u.test(x) || x === '' ? `"${x}"` : x)).join(' ');
