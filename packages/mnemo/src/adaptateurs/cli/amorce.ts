import { ligneAvertissement } from '@mnemo/commun';
import { amorcer, fichesATraiter } from '../../application/amorcer.ts';
import { dossiersAAmorcer } from '../../application/dossiers.ts';
import { dossiersRacine } from '../../infra/dossiers.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { dossierClaudeParDefaut, memoireClaude, projetsClaude } from '../../infra/memoire-claude.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

const USAGE = 'Usage : mnemo amorce [--dossier-claude <chemin>]';

/**
 * `mnemo amorce` : comme le bouton « Importer la mémoire de Claude » — importe la mémoire native de Claude Code (notes des
 * projets, CLAUDE.md global) comme fiches de source, et référence les CLAUDE.md et `.claude/*.md` des dossiers des premiers niveaux (`NIVEAUX_AMORCE`).
 */
export async function commandeAmorce(args: string[]): Promise<void> {
	let dossierClaude = dossierClaudeParDefaut();
	for (let i = 0; i < args.length; i++) {
		if (args[i] !== '--dossier-claude' || args[i + 1] === undefined || args[i + 1] === '') throw new ErreurCli(USAGE, 2);
		dossierClaude = args[++i]!;
	}
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const dependances = dependancesReelles(racine);
	try {
		const bilan = await amorcer(dependances, memoireClaude(dossierClaude), projetsClaude(racine, () => dossiersAAmorcer(dossiersRacine(racine)), { dossierClaude }));
		const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
		const { instructions: i } = bilan;
		const lignes = [
			`Amorçage : ${pluriel(bilan.ajoutees, 'fiche ajoutée', 'fiches ajoutées')}, ${pluriel(bilan.mises_a_jour, 'fiche mise à jour', 'fiches mises à jour')}, ` +
				`${pluriel(bilan.inchangees, 'fiche inchangée', 'fiches inchangées')}, ${pluriel(bilan.ignorees, 'fichier ignoré', 'fichiers ignorés')}.`,
			`Instructions des projets (CLAUDE.md, .claude/) : ${pluriel(i.ajoutees, 'ajoutée', 'ajoutées')}, ${pluriel(i.mises_a_jour, 'mise à jour', 'mises à jour')}, ` +
				`${pluriel(i.inchangees, 'inchangée', 'inchangées')}.`,
		];
		if (bilan.rattachees > 0) lignes.push(`${pluriel(bilan.rattachees, 'note rattachée', 'notes rattachées')} à un projet.`);
		if (bilan.regroupees > 0) lignes.push(`${pluriel(bilan.regroupees, 'note identique regroupée', 'notes identiques regroupées')} avec une fiche existante (une seule fiche pour une note vue dans plusieurs projets).`);
		if (bilan.secrets > 0) lignes.push(`${pluriel(bilan.secrets, 'secret masqué', 'secrets masqués')}.`);
		for (const a of bilan.avertissements ?? []) lignes.push(ligneAvertissement(a));
		const enAttente = (await fichesATraiter(dependances)).length;
		if (enAttente > 0) lignes.push(`${pluriel(enAttente, 'fiche à traiter', 'fiches à traiter')} : confiées à l'archiviste à son lancement (ou par le bouton de la vue Mémoire).`);
		for (const ignore of bilan.ignores) lignes.push(`Ignoré : ${ignore.chemin} (${ignore.raison})`);
		console.log(lignes.join('\n'));
	} finally {
		dependances.index.fermer();
	}
}
