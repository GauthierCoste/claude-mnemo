import { synchroniser } from '../../application/synchroniser.ts';
import { vectoriser } from '../../application/vectoriser.ts';
import type { Dependances } from '../../application/ports.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

/**
 * Tous les vecteurs de sens manquants, sans limite de temps (le modèle est lancé au besoin) ; progression sur stderr
 * (tous les 5 %) quand c'est un terminal.
 */
async function vectoriserTout(dependances: Dependances): Promise<void> {
	const modele = dependances.sens.modele();
	if (modele === null) {
		console.log('modèle de sens absent : recherche par les mots');
		return;
	}
	const terminal = process.stderr.isTTY === true;
	let palier = -1;
	const progression = (faits: number, total: number): void => {
		const pourcent = Math.floor((faits * 100) / total / 5) * 5;
		if (pourcent <= palier) return;
		palier = pourcent;
		process.stderr.write(`\rvecteurs de sens : ${faits} / ${total} (${pourcent} %)`);
	};
	const { faits, restants } = await vectoriser(dependances, { budgetMs: Infinity, demarrer: true, ...(terminal ? { progression } : {}) });
	if (palier >= 0) process.stderr.write('\n');
	console.log(`${faits} vecteurs calculés (${modele})`);
	if (restants !== null && restants > 0) console.log(`${restants} vecteurs restants : modèle de sens indisponible, recherche par les mots pour ceux-là`);
}

/** `mnemo index` : met l'index à jour ; `--reconstruire` le vide d'abord, sur place (les autres processus gardent leur connexion). */
export async function commandeIndex(args: string[]): Promise<void> {
	const reconstruire = args.includes('--reconstruire');
	if (args.length > (reconstruire ? 1 : 0)) throw new ErreurCli('Usage : mnemo index [--reconstruire]', 2);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const dependances = dependancesReelles(racine);
	try {
		if (reconstruire) await dependances.index.vider();
		const { ajoutees, modifiees, retirees, illisibles, motifs, avis, incompletes } = await synchroniser(dependances);
		const fiches = await dependances.index.fiches();
		console.log(`${fiches.length} fiches indexées (${ajoutees} ajoutées, ${modifiees} modifiées, ${retirees} retirées).`);
		// toutes celles de l'index, pas seulement les réindexées : une anomalie reste dite tant que la fiche n'est pas réparée
		const aVerifier = fiches.filter((f) => f.anomalies.length > 0);
		if (aVerifier.length > 0) {
			console.log(`${aVerifier.length} ${aVerifier.length === 1 ? 'fiche à vérifier (indexée comme texte)' : 'fiches à vérifier (indexées comme texte)'} :`);
			for (const f of aVerifier) console.log(`- ${f.chemin} : ${f.anomalies.join(' ; ')}`);
		}
		if (illisibles.length > 0) {
			const libelle = illisibles.length === 1 ? 'fiche illisible' : 'fiches illisibles';
			console.log(`${illisibles.length} ${libelle} :`);
			for (const chemin of illisibles) console.log(`- ${chemin}${motifs?.[chemin] === undefined ? '' : ` : ${motifs[chemin]}`}`);
		}
		const aCompleter = Object.entries(avis ?? {});
		if (aCompleter.length > 0) {
			console.log(`${aCompleter.length} ${aCompleter.length === 1 ? 'document à compléter' : 'documents à compléter'} :`);
			for (const [chemin, motif] of aCompleter) console.log(`- ${chemin} : ${motif.replace('extraire_source', 'mnemo source')}`);
		}
		const enPartie = Object.entries(incompletes ?? {});
		if (enPartie.length > 0) {
			console.log(`${enPartie.length} ${enPartie.length === 1 ? 'document indexé en partie' : 'documents indexés en partie'} :`);
			for (const [chemin, motif] of enPartie) console.log(`- ${chemin} : ${motif}`);
		}
		await vectoriserTout(dependances);
	} finally {
		dependances.index.fermer();
	}
}
