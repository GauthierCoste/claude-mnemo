import { describe, expect, it } from 'vitest';
import type { FicheGraphe } from '@mnemo/contrat';
import { rangsDesFiches } from '../../src/graphe/branches.ts';
import { dossiersDe, lignesArbre } from '../../src/memoire/arbre.ts';

function fiche(chemin: string, alias: string[] = []): FicheGraphe {
	const morceaux = chemin.split('/');
	const titre = morceaux.at(-1)!.replace(/\.md$/, '');
	return { chemin, titre, type: 'sujet', alias, etats: [], faitsActifs: 0, categories: {}, dates: [], branche: morceaux.slice(0, -1).join('/'), parent: null };
}

const FICHES = [
	fiche('references/Référence API.md'),
	fiche('projets/erp/Module stocks.md', ['gestion des lots']),
	fiche('Accueil.md'),
	fiche('projets/erp/achats/Commandes.md'),
	fiche('projets/erp/erp.md'),
];

/** Lignes en texte : « D profondeur nom » / « F profondeur titre (branche) ». */
const texte = (lignes: ReturnType<typeof lignesArbre>) =>
	lignes.map((l) => (l.genre === 'dossier' ? `D${l.profondeur} ${l.nom}${l.replie ? ' ▸' : ''}` : `F${l.profondeur} ${l.titre} (${l.branche})`));

describe('lignesArbre', () => {
	it("dossiers par ordre alphabétique, fiche du dossier en tête, sous-dossiers puis fiches ; fiches de la racine à la fin", () => {
		expect(texte(lignesArbre(FICHES, '', new Set()))).toEqual([
			'D0 projets',
			'D1 erp',
			'F2 erp (projets)',
			'D2 achats',
			'F3 Commandes (projets)',
			'F2 Module stocks (projets)',
			'D0 references',
			'F1 Référence API (references)',
			'F0 Accueil ()',
		]);
	});

	it('clés des dossiers = chemin complet ; fiches portent leur chemin', () => {
		const lignes = lignesArbre(FICHES, '', new Set());
		expect(lignes.filter((l) => l.genre === 'dossier').map((l) => (l.genre === 'dossier' ? l.cle : ''))).toEqual(['projets', 'projets/erp', 'projets/erp/achats', 'references']);
		expect(lignes.find((l) => l.genre === 'fiche' && l.titre === 'Commandes')).toMatchObject({ chemin: 'projets/erp/achats/Commandes.md' });
	});

	it('filtre sans accents ni casse : « refere » trouve « Référence », avec ses dossiers', () => {
		expect(texte(lignesArbre(FICHES, 'refere', new Set()))).toEqual(['D0 references', 'F1 Référence API (references)']);
	});

	it('filtre sur les alias', () => {
		expect(texte(lignesArbre(FICHES, 'LOTS', new Set()))).toEqual(['D0 projets', 'D1 erp', 'F2 Module stocks (projets)']);
	});

	it('un dossier replié masque ses fiches et ses sous-dossiers', () => {
		expect(texte(lignesArbre(FICHES, '', new Set(['projets/erp'])))).toEqual([
			'D0 projets',
			'D1 erp ▸',
			'D0 references',
			'F1 Référence API (references)',
			'F0 Accueil ()',
		]);
	});
});

describe('rangsDesBranches', () => {
	it('branches de premier niveau dans l’ordre alphabétique (la racine d’abord), comme la couleur par branche du graphe', () => {
		expect([...rangsDesFiches(FICHES.map((f) => f.chemin))]).toEqual([
			['', 0],
			['projets', 1],
			['references', 2],
		]);
	});
});

describe('dossiersDe', () => {
	it('dossiers qui contiennent la fiche, du premier niveau au plus profond ; aucun à la racine', () => {
		expect(dossiersDe('projets/erp/achats/Commandes.md')).toEqual(['projets', 'projets/erp', 'projets/erp/achats']);
		expect(dossiersDe('Accueil.md')).toEqual([]);
	});
});
