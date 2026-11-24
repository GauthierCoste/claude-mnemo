/** Chaque réglage applicatif est lu là où sa valeur codée en dur l'était : budgets, similarités, types à confirmer. */
import { describe, expect, it } from 'vitest';
import { chercherAvecAvis, optionsOutils } from '../../src/application/chercher.ts';
import type { Sens } from '../../src/application/ports.ts';
import { proposer } from '../../src/application/proposer.ts';
import type { DemandeFait } from '../../src/application/proposer.ts';
import { servir } from '../../src/application/servir.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import type { Reglages } from '../../src/domaine/reglages.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { vecteurFaux } from '../aides/faux-sens.ts';

const entete = (type = 'sujet') => `---\nid: 01ABC\ntype: ${type}\nupdated: 2026-11-01\n---\n`;
const ligne = (texte: string, i: number) => `- ${texte} | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 % ^f-${String(i).padStart(4, '0')}`;

const avec = (modif: (r: Reglages) => Reglages) => () => modif(structuredClone(REGLAGES_PAR_DEFAUT));

/** Sens : « voiture » = le concept ; un texte avec « automobile » = concept + 0,5 × aléa (cosinus ≈ 0,89). */
function sensProche(): Sens {
	const concept = vecteurFaux('CONCEPT');
	return {
		modele: () => 'proche@000000000001',
		async vecteurs(textes) {
			return textes.map((t) => {
				if (t.trim().toLowerCase() === 'voiture') return concept;
				if (!t.toLowerCase().includes('automobile')) return vecteurFaux(t);
				const alea = vecteurFaux(t);
				return Float32Array.from(concept, (c, i) => c + 0.5 * alea[i]!);
			});
		},
	};
}

describe('réglages branchés', () => {

	it('contexte.similariteRecherche filtre les voisins du sens de la recherche', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n${ligne("L'automobile du directeur est neuve", 1)}\n${ligne('Le tamanoir mange des termites', 2)}\n`);
		dep.sens = sensProche();
		await synchroniser(dep);
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const ids = async () => (await chercherAvecAvis(dep, { texte: 'voiture' })).trouves.map((t) => t.id);
		expect(await ids()).toContain('a.md#^f-0001');
		dep.reglages = avec((r) => ({ ...r, contexte: { ...r.contexte, similariteRecherche: 0.95 } }));
		expect(await ids()).not.toContain('a.md#^f-0001');
	});

	it('options par défaut : la similarité de la recherche des réglages par défaut', () => {
		expect(optionsOutils(0).sens?.similariteMin).toBe(0.45);
	});

	it('archiviste.typesAConfirmer : une information proposée dans une fiche de ces types est à confirmer', async () => {
		const dep = fauxPorts();
		const demande = (fiche: string, typeSiNouvelle: DemandeFait['typeSiNouvelle']): DemandeFait => ({
			genre: 'fait',
			fiche,
			typeSiNouvelle,
			texte: 'Le client paie à 30 jours',
			nature: 'declare',
			source: { ref: 'réunion', type: 'utilisateur' },
		});
		expect(await proposer(dep, demande('clients/c/c.md', 'entite'))).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		dep.reglages = avec((r) => ({ ...r, archiviste: { typesAConfirmer: ['entite'] } }));
		expect(await proposer(dep, demande('clients/d/d.md', 'entite'))).toMatchObject({ statut: 'ecrit', aConfirmer: true });
		expect(await proposer(dep, demande('projets/p/p.md', 'sujet'))).toMatchObject({ statut: 'ecrit', aConfirmer: false });
	});
});
