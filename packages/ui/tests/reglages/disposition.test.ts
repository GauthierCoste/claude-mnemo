import { describe, expect, it } from 'vitest';
import type { ChampReglageVue } from '@mnemo/contrat';
import { REGLAGES_DEMO } from '../../src/client/demo-donnees.ts';
import { CARTES_REGLAGES, champsNonDisposes, sectionDuChamp } from '../../src/reglages/disposition.ts';
import { phraseEffet } from '../../src/reglages/phrases-effet.ts';

const cles = [...CARTES_REGLAGES.memoire, ...CARTES_REGLAGES.systeme].flatMap((c) => c.groupes.flatMap((g) => g.champs.map((x) => x.cle)));

describe('disposition des réglages', () => {
	it('chaque réglage du service (celui de la démo, à son image) a sa place, une seule fois ; chaque place a son réglage', () => {
		expect(champsNonDisposes(REGLAGES_DEMO)).toEqual([]);
		expect(new Set(cles).size).toBe(cles.length);
		expect(cles.filter((c) => !REGLAGES_DEMO.some((x) => x.cle === c))).toEqual([]);
	});

	it('Mémoire : Rappel, Recherche puis Confiance ; Système : service, modèles locaux, couleur', () => {
		expect(CARTES_REGLAGES.memoire.map((c) => [c.titre, c.groupes.map((g) => g.titre)])).toEqual([
			['Rappel', [null, 'Un projet, c’est un dossier avec…', 'Réglages fins']],
			['Recherche', ['Ce qui passe devant', 'Réglages fins']],
			['Confiance', ['Fiabilité des sources', 'Un fait vaut…', 'L’archiviste écrit seul…']],
		]);
		const champs = (titre: string) => CARTES_REGLAGES.memoire.find((c) => c.titre === titre)!.groupes.flatMap((g) => g.champs.map((x) => x.cle));
		// Recherche : seulement ce qui joue sur la recherche (outil chercher, recherche de l'interface)
		expect(champs('Recherche')).toEqual([
			'recherche.poidsPosition',
			'recherche.poidsConfiance',
			'recherche.poidsMemoire',
			'recherche.poidsFraicheur',
			'recherche.resultats',
			'memoire.seuilRappel',
			'recherche.chronologie',
			'recherche.graphe',
			'recherche.reranker',
		]);
		expect(champs('Rappel').filter((c) => !c.startsWith('contexte.'))).toEqual(['projets.marqueurs']);
		expect(CARTES_REGLAGES.systeme.map((c) => c.groupes.map((g) => g.titre))).toEqual([['Service', 'Modèles locaux', 'Couleur']]);
		expect(sectionDuChamp('service.port')).toBe('systeme');
		expect(sectionDuChamp('memoire.fiabilite_email')).toBe('memoire');
	});

	it('un réglage inconnu de l’écran : sous son libellé du service, dans une forme selon son genre', () => {
		const champ = (cle: string, genre: ChampReglageVue['genre']): ChampReglageVue => ({ cle, groupe: 'contexte', libelle: `Libellé ${cle}`, explication: '', genre, defaut: 0, valeur: 0, effet: 'immediat' });
		expect(champsNonDisposes([champ('contexte.seuilInjection', 'entier'), champ('x.nombre', 'decimal'), champ('x.liste', 'liste'), champ('x.choix', 'choix-multiple')])).toEqual([
			{ cle: 'x.nombre', libelle: 'Libellé x.nombre', forme: 'barre' },
			{ cle: 'x.liste', libelle: 'Libellé x.liste', forme: 'puces' },
			{ cle: 'x.choix', libelle: 'Libellé x.choix', forme: 'interrupteurs' },
		]);
	});
});

describe('phrases d’effet', () => {
	const aucune = () => undefined;
	it('seuil d’injection, fiches injectées, pistes : ce que fait la valeur', () => {
		expect([100, 96, 90, 60].map((n) => phraseEffet('contexte.seuilInjection', n, aucune))).toEqual([
			'Jamais d’injection automatique.',
			'Seulement les fiches presque certaines.',
			'Les fiches très sûres entrent seules.',
			'Mnemo injecte généreusement.',
		]);
		expect([0, 1, 4].map((n) => phraseEffet('contexte.injectionsParMessage', n, aucune))).toEqual(['Rien n’entre sans ton geste.', 'Jusqu’à 1 fiche par message.', 'Jusqu’à 4 fiches par message.']);
		expect([0, 1, 3].map((n) => phraseEffet('contexte.pistesParMessage', n, aucune))).toEqual(['Aucune piste.', '1 carte à injecter d’un geste.', '3 cartes à injecter d’un geste.']);
		expect([5, 20, 50].map((n) => phraseEffet('contexte.seuilPiste', n, aucune))).toEqual([
			'Presque tout peut devenir une piste.',
			'Les pistes plausibles sont proposées.',
			'Seules les pistes solides sont proposées.',
		]);
		expect(phraseEffet('contexte.seuilPiste', 80, (cle) => (cle === 'contexte.seuilInjection' ? 70 : undefined))).toBe('Au-dessus du seuil d’injection (70 %) : refusé à l’enregistrement.');
	});

	it('mise en veille des modèles ; un champ sans phrase : null', () => {
		expect([2, 15, 60].map((n) => phraseEffet('modeles.inactiviteMinutes', n, aucune))).toEqual([
			'Économes : ils redémarrent souvent, et la recherche attend alors leur réveil.',
			'Un bon équilibre.',
			'Toujours prêts, mais environ 1,6 Go de mémoire vive occupés longtemps.',
		]);
		expect(phraseEffet('service.port', 4747, aucune)).toBeNull();
	});
});
