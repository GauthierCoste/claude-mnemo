import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chercherSansSynchro } from '../../src/application/chercher.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import type { Variante } from '../../src/application/chercher.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import { dossierModeles, dossierServeurs } from '../../src/infra/modeles/dossier.ts';
import { arreterServeurs, lireEtatServeurs, pidVivant } from '../../src/infra/modeles/serveurs.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';

/**
 * Avec les vrais modèles installés (`mnemo modeles installer`), facultatif : `MNEMO_MODELES_REELS=1 pnpm exec vitest run
 * tests/integration`. Lance de vrais `llama-server` (≈ 1,3 Go de mémoire), arrêtés à la fin. Les pièces sont lues dans le
 * dossier de modèles de l'utilisateur (vitest en désigne un vide pour tous les autres tests), ou dans
 * `MNEMO_MODELES_REELS_DOSSIER`. Son `serveurs/` est celui de la machine : le gardien de l'utilisateur, s'il tourne, est
 * réutilisé puis arrêté (le prochain usage le relance).
 */
const REELS = process.env['MNEMO_MODELES_REELS'] === '1';
const CORPUS = fileURLToPath(new URL('../../banc/corpus/', import.meta.url));
const MOTS: Variante = { sens: false, reranker: false, graphe: false, position: false };
const SENS: Variante = { ...MOTS, sens: true };

describe.skipIf(!REELS)('modèles réels (bge-m3, bge-reranker-v2-m3, llama.cpp)', () => {
	const modelesDeTest = process.env['MNEMO_MODELES'];
	let racine = '';
	const serveurs = () => dossierServeurs(process.env, process.platform, userInfo().homedir);

	beforeAll(async () => {
		const { MNEMO_MODELES: _, ...sansDossierDeTest } = process.env;
		// le vrai HOME (userInfo, pas $HOME, que la garde des tests remplace) : ce test, facultatif, lit les vrais modèles
		process.env['MNEMO_MODELES'] = process.env['MNEMO_MODELES_REELS_DOSSIER'] ?? dossierModeles(sansDossierDeTest, process.platform, userInfo().homedir);
		// un seul dossier pour toute la suite (dossierTemporaire le supprimerait après chaque test, gardien en marche)
		racine = await mkdtemp(join(tmpdir(), 'mnemo-modeles-reels-'));
		await cp(CORPUS, racine, { recursive: true });
	});

	afterAll(async () => {
		if (racine !== '') {
			await arreterServeurs(serveurs());
			await rm(racine, { recursive: true, force: true });
		}
		if (modelesDeTest === undefined) delete process.env['MNEMO_MODELES'];
		else process.env['MNEMO_MODELES'] = modelesDeTest;
	});

	it('sens : vecteurs de dimension 1024', async () => {
		const dep = dependancesReelles(racine);
		try {
			expect(dep.sens.modele()).toMatch(/^bge-m3@[0-9a-f]{12}$/u);
			const vecteurs = await dep.sens.vecteurs(['Le client paie à trente jours.'], { budgetMs: 120_000, demarrer: true });
			expect(vecteurs).toHaveLength(1);
			expect(vecteurs![0]!.length).toBe(1024);
		} finally {
			dep.index.fermer();
		}
	}, 180_000);

	it('une paraphrase du corpus (aucun mot commun) est trouvée par le sens, pas par les mots', async () => {
		const dep = dependancesReelles(racine);
		try {
			await synchroniser(dep);
			expect((await vectoriser(dep, { budgetMs: Infinity, demarrer: true })).restants).toBe(0);
			const requete = { texte: 'À quelle fréquence les véhicules signalent-ils où ils se trouvent ?', limite: 5 };
			const attendu = 'projets/suivi-tournees/suivi-tournees.md#^f-0002';
			const options = { fin: Date.now() + 60_000, sens: { demarrer: true, similariteMin: REGLAGES_PAR_DEFAUT.contexte.similariteRecherche }, reranker: null, sensMaxMs: 30_000 };
			const parLesMots = await chercherSansSynchro(dep, { ...requete, variante: MOTS }, options);
			expect(parLesMots.map((t) => t.id)).not.toContain(attendu);
			const parLeSens = await chercherSansSynchro(dep, { ...requete, variante: SENS }, options);
			expect(parLeSens.map((t) => t.id)).toContain(attendu);
		} finally {
			dep.index.fermer();
		}
	}, 180_000);

	it('reranker : le texte qui répond est noté le plus haut des trois', async () => {
		const dep = dependancesReelles(racine);
		try {
			const notes = await dep.reranker.noter(
				'Quel est le taux journalier convenu avec le client ?',
				['Le garage ferme le lundi.', 'Le taux journalier convenu est de 650 € HT.', 'La réunion de lancement a eu lieu en mars.'],
				{ budgetMs: 120_000, demarrer: true },
			);
			expect(notes).toHaveLength(3);
			expect(notes!.indexOf(Math.max(...notes!))).toBe(1);
		} finally {
			dep.index.fermer();
		}
	}, 180_000);

	// Dépend des tests précédents : ce sont eux qui ont lancé le gardien et les deux serveurs.
	it('mnemo modeles arreter : gardien et serveurs arrêtés', async () => {
		const etat = await lireEtatServeurs(serveurs());
		expect(etat).not.toBeNull();
		const pids = [etat!.gardien.pid, etat!.sens?.pid, etat!.reranker?.pid].filter((p): p is number => p !== undefined);
		expect(pids.length).toBe(3);
		expect(await arreterServeurs(serveurs())).toBe('arrete');
		for (const pid of pids) expect(pidVivant(pid)).toBe(false);
		expect(await lireEtatServeurs(serveurs())).toBeNull();
	}, 60_000);
});
