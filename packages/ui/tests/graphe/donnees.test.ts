// Les couleurs viennent des jetons (`couleurs.branches` pour les branches).
import { describe, expect, it } from 'vitest';
import { cibler, creerSimulation, placerAuDepart } from '../../src/graphe/disposition.ts';
import {
	construireLegende,
	correspondAuxFiltres,
	couleursDesBranches,
	dansLaBranche,
	dateMediane,
	filtrerParTitre,
	LIEN_CASSE,
	liensDesTypes,
	lienVisible,
	nuance,
	preparerGraphe,
	RELATION_DANS_UN_FAIT,
	retenueParLesChoix,
	voisinage,
	voisinsDirects,
	type EntreeGraphe,
	type Noeud,
} from '../../src/graphe/donnees.ts';
import { couleursDeTest } from '../aides/couleurs-graphe.ts';

const COULEURS = couleursDeTest();
const PALETTE = COULEURS.branches;

const DONNEES: EntreeGraphe = {
	coffre: 'memoire',
	fiches: [
		{ chemin: 'organisations/Acme.md', titre: 'Acme', alias: ['ACME SA'], etats: [], faitsActifs: 3, categories: { role: 2 }, dates: ['2024-01-01'] },
		{ chemin: 'personnes/Marie Dupont.md', titre: 'Marie Dupont', alias: ['Marie D.'], etats: ['a_confirmer'], faitsActifs: 1, categories: { contact: 1 }, dates: ['2020-01-01', '2022-01-01', '2026-01-01'] },
		{ chemin: 'projets/Atlas.md', titre: 'Atlas', alias: [], etats: [], faitsActifs: 0, categories: {}, dates: [] },
	],
	liens: [
		{ source: 'personnes/Marie Dupont.md', cible: 'organisations/Acme.md', cibleEcrite: 'Acme', relation: 'travaille_pour' },
		{ source: 'personnes/Marie Dupont.md', cible: null, cibleEcrite: 'Bob', relation: 'connait' },
		{ source: 'organisations/Acme.md', cible: 'projets/Atlas.md', cibleEcrite: 'Atlas', relation: null },
		{ source: 'projets/Atlas.md', cible: null, cibleEcrite: 'bob', relation: 'concerne' },
	],
};

const ARBRE: EntreeGraphe = {
	coffre: 'memoire',
	fiches: [
		{ chemin: 'developpement/developpement.md', titre: 'developpement', alias: [], etats: [], faitsActifs: 0, categories: {}, dates: [], branche: 'developpement', parent: null },
		{ chemin: 'developpement/technique/Règles.md', titre: 'Règles', alias: [], etats: [], faitsActifs: 0, categories: {}, dates: [], branche: 'developpement/technique', parent: 'developpement/developpement.md' },
		{ chemin: 'developpement/technique/Outils.md', titre: 'Outils', alias: [], etats: [], faitsActifs: 0, categories: {}, dates: [], branche: 'developpement/technique', parent: 'developpement/developpement.md' },
		{ chemin: 'personnes/Marie Dupont.md', titre: 'Marie Dupont', alias: [], etats: [], faitsActifs: 0, categories: {}, dates: [], branche: 'personnes', parent: null },
	],
	liens: [],
};

const NOTIONS: EntreeGraphe = {
	...DONNEES,
	fiches: DONNEES.fiches!.map((fiche) => ({ ...fiche, notions: (fiche.titre === 'Atlas' ? {} : fiche.titre === 'Acme' ? { n2: 1, n1: 2 } : { n1: 1 }) as Record<string, number> })),
	notions: [
		{ id: 'n1', nom: 'contrat · euros · mois', mots: ['contrat', 'euros', 'mois'], faits: 3, fiches: 2 },
		{ id: 'n2', nom: 'garage · vidange', mots: ['garage', 'vidange'], faits: 1, fiches: 1 },
	],
	sens: { disponible: true, etat: 'disponibles' },
};

const RANGEES: EntreeGraphe = { ...NOTIONS, fiches: NOTIONS.fiches!.map((fiche) => ({ ...fiche, branche: fiche.chemin.split('/')[0]! })) };

const titres = (noeuds: Iterable<Noeud>) => [...noeuds].map((noeud) => noeud.titre);

describe('graphe de la mémoire', () => {
	it('un lien cassé aboutit à un nœud par cible écrite ; un lien de fait reçoit sa relation par défaut', () => {
		const graphe = preparerGraphe(DONNEES, COULEURS);

		expect(graphe.noeuds.length).toBe(4);
		const fantome = graphe.noeuds[3]!;
		expect(fantome.fantome).toBe(true);
		expect(fantome.entrants.length).toBe(2);
		expect(graphe.liens[2]!.relation).toBe(RELATION_DANS_UN_FAIT);
		expect(graphe.compteurs).toEqual({ fiches: 3, liens: 2, liensCasses: 2, sansRelation: 0 });
		expect(graphe.typesDeRelation.map(([nom]) => nom)).toEqual([RELATION_DANS_UN_FAIT, 'concerne', 'connait', 'travaille_pour']);
	});

	it('la légende suit l’état mémoire ou la période de validité', () => {
		const graphe = preparerGraphe(DONNEES, COULEURS);
		const maintenant = Date.parse('2026-11-18T00:00:00Z');

		expect(construireLegende(graphe.noeuds, 'branche', maintenant, COULEURS).map((entree) => [entree.nom, entree.nombre])).toEqual([['Racine du coffre', 3]]);
		expect(construireLegende(graphe.noeuds, 'etat', maintenant, COULEURS).map((entree) => [entree.nom, entree.nombre])).toEqual([['À confirmer', 1], ['Sans remarque', 2]]);
		expect(construireLegende(graphe.noeuds, 'periode', maintenant, COULEURS).map((entree) => entree.nom)).toEqual(['1 à 3 ans', 'Plus de 3 ans', 'Sans date de validité']);
		expect(graphe.noeuds[3]!.legende).toBe(LIEN_CASSE);
		expect(dateMediane(graphe.noeuds[1]!)).toBe(Date.parse('2022-01-01T00:00:00Z'));
		expect(dateMediane(graphe.noeuds[2]!)).toBeNull();
	});

	it('le filtre instantané lit titres et alias sans accents ; les filtres lisent état, catégorie et liens', () => {
		const graphe = preparerGraphe(DONNEES, COULEURS);

		expect(titres(filtrerParTitre(graphe.noeuds, 'marie'))).toEqual(['Marie Dupont']);
		expect(titres(filtrerParTitre(graphe.noeuds, 'acme sa'))).toEqual(['Acme']);
		expect(filtrerParTitre(graphe.noeuds, 'BÔB')).toEqual([]);
		const [acme, marie, atlas, fantome] = graphe.noeuds as [Noeud, Noeud, Noeud, Noeud];
		expect(correspondAuxFiltres(marie, { etat: 'a_confirmer' })).toBe(true);
		expect(correspondAuxFiltres(acme, { etat: 'aucun', categorie: 'role' })).toBe(true);
		expect(correspondAuxFiltres(atlas, { liens: 'casses' })).toBe(true);
		expect(correspondAuxFiltres(acme, { liens: 'casses' })).toBe(false);
		expect(correspondAuxFiltres(fantome, {})).toBe(false);
	});

	it('le voisinage suit les liens visibles, jusqu’à la profondeur demandée', () => {
		const graphe = preparerGraphe(DONNEES, COULEURS);
		for (const noeud of graphe.noeuds) noeud.visible = true;
		const visibles = graphe.liens.filter((lien) => lienVisible(lien, new Set(['travaille_pour'])));
		const [acme, marie, atlas] = graphe.noeuds as [Noeud, Noeud, Noeud];

		expect(titres(voisinage(acme, 1, graphe.liens)).sort()).toEqual(['Acme', 'Atlas', 'Marie Dupont']);
		expect(voisinage(marie, 1, visibles).has(acme)).toBe(false);
		expect(voisinage(marie, 3, visibles).has(atlas)).toBe(true);
	});

	it('deux types de lien, un seul parcours : la fiche de lieu d’un dossier de 3 fiches sans [[…]] a 3 liens directs par la parenté, 0 par les liens personnalisés ; jusqu’à 2 atteint le lieu du dossier parent', () => {
		const lieu = (chemin: string, parent: string | null) => ({ chemin, titre: chemin.split('/').pop()!.replace(/\.md$/u, ''), branche: chemin.slice(0, chemin.lastIndexOf('/')), parent });
		const graphe = preparerGraphe(
			{
				fiches: [
					lieu('clients/clients.md', null),
					lieu('clients/acme/acme.md', 'clients/clients.md'),
					lieu('clients/acme/Contrat.md', 'clients/acme/acme.md'),
					lieu('clients/acme/Devis.md', 'clients/acme/acme.md'),
				],
				liens: [],
			},
			COULEURS,
		);
		const [clients, acme, contrat] = graphe.noeuds as [Noeud, Noeud, Noeud];
		const parente = liensDesTypes(graphe, new Set(['parente']));
		const personnalises = liensDesTypes(graphe, new Set(['personnalise']));

		expect(titres(voisinsDirects(acme, parente)).sort()).toEqual(['Contrat', 'Devis', 'clients']);
		expect(voisinsDirects(acme, personnalises)).toEqual([]);
		expect(voisinsDirects(acme, liensDesTypes(graphe, new Set()))).toEqual([]);
		expect(voisinage(contrat, 2, liensDesTypes(graphe, new Set(['parente', 'personnalise']))).has(clients)).toBe(true);
		expect(voisinage(contrat, 1, parente).has(clients)).toBe(false);
		expect(graphe.parentes.every((lien) => lien.type === 'parente') && graphe.liens.every((lien) => lien.type === 'personnalise')).toBe(true);
	});

	it('la disposition est la même à chaque calcul, et s’arrête', () => {
		const positions = () => {
			const graphe = preparerGraphe(DONNEES, COULEURS);
			placerAuDepart(graphe.noeuds);
			cibler(graphe.noeuds, 'forces');
			const simulation = creerSimulation(graphe.noeuds, graphe.liens, 'forces');
			simulation.terminer();
			return { noeuds: graphe.noeuds.map((noeud) => [noeud.x, noeud.y, noeud.z]), pas: simulation.pasFaits() };
		};
		const premier = positions();

		expect(positions()).toEqual(premier);
		expect(premier.pas > 100 && premier.pas < 400).toBe(true);
		expect(premier.noeuds.every((position) => position.every(Number.isFinite))).toBe(true);
	});

	it('l’axe du temps place une fiche par la date médiane de validité, et une fiche sans date sur un plan à part', () => {
		const graphe = preparerGraphe(DONNEES, COULEURS);
		const axe = cibler(graphe.noeuds, 'temps')!;
		const [acme, marie, atlas] = graphe.noeuds as [Noeud, Noeud, Noeud];

		expect(marie.tz < acme.tz).toBe(true);
		expect(acme.tz).toBe(axe.longueur);
		expect(atlas.tz).toBe(axe.planSansDate);
		expect(axe.graduations.length > 0).toBe(true);
		expect(cibler(graphe.noeuds, 'forces')).toBeNull();
	});

	it('les constellations rapprochent les fiches d’une même branche, chaque sous-branche autour de la sienne', () => {
		const graphe = preparerGraphe(ARBRE, COULEURS);
		cibler(graphe.noeuds, 'constellations', { racines: ['developpement', 'personnes'] });
		const [dossier, regles, outils, marie] = graphe.noeuds as [Noeud, Noeud, Noeud, Noeud];

		expect([dossier.tx, dossier.ty, dossier.tz]).not.toEqual([marie.tx, marie.ty, marie.tz]);
		expect(
			Math.hypot(regles.tx - dossier.tx, regles.ty - dossier.ty, regles.tz - dossier.tz) < Math.hypot(marie.tx - dossier.tx, marie.ty - dossier.ty, marie.tz - dossier.tz),
		).toBe(true);
		expect([regles.tx, regles.ty, regles.tz], 'même sous-branche, même cible').toEqual([outils.tx, outils.ty, outils.tz]);
	});

	it('la parenté vient de l’arbre, distincte des relations, et la branche filtre ses sous-branches', () => {
		const graphe = preparerGraphe(ARBRE, COULEURS);
		const [dossier, regles, outils, marie] = graphe.noeuds as [Noeud, Noeud, Noeud, Noeud];

		expect(graphe.parentes.map((lien) => [lien.source.titre, lien.cible.titre])).toEqual([['Règles', 'developpement'], ['Outils', 'developpement']]);
		expect(titres(dossier.enfants)).toEqual(['Règles', 'Outils']);
		expect(graphe.liens.length).toBe(0);
		expect(graphe.compteurs.sansRelation, 'la parenté ne compte pas comme relation').toBe(4);
		expect(graphe.branches).toEqual([['developpement', 3], ['developpement/technique', 2], ['personnes', 1]]);
		expect(regles.racine).toBe('developpement');
		expect(dansLaBranche(outils, 'developpement')).toBe(true);
		expect(dansLaBranche(marie, 'developpement')).toBe(false);
		expect(dansLaBranche({ branche: 'developpement2' }, 'developpement'), 'une branche voisine au nom plus long n’est pas une sous-branche').toBe(false);
		expect(correspondAuxFiltres(regles, { branche: 'developpement/technique' })).toBe(true);
		expect(correspondAuxFiltres(dossier, { branche: 'developpement/technique' })).toBe(false);
	});

	it('une notion devient un nœud relié à ses fiches par des liens de notion, hors relations', () => {
		const graphe = preparerGraphe(NOTIONS, COULEURS);
		const [n1, n2] = graphe.notions as [Noeud, Noeud];
		const acme = graphe.noeuds.find((noeud) => noeud.titre === 'Acme')!;

		expect(n1.notion).toBe(true);
		expect(titres(n1.fiches).sort()).toEqual(['Acme', 'Marie Dupont']);
		expect(graphe.liensDeNotion.length).toBe(3);
		expect(graphe.liens.length).toBe(4);
		expect(acme.notionPrincipale).toBe(n1);
		expect(graphe.noeuds.find((noeud) => noeud.titre === 'Atlas')!.notionPrincipale).toBeNull();
		expect(graphe.compteurs.fiches).toBe(3);
		expect(graphe.sens.disponible).toBe(true);
		expect(n1.couleurNotion).not.toBe(n2.couleurNotion);
	});

	it('la couleur par notion principale, le filtre par notion et les constellations par notion', () => {
		const graphe = preparerGraphe(NOTIONS, COULEURS);
		const legende = construireLegende(graphe.noeuds, 'notion', Date.now(), COULEURS);

		expect(legende.map((entree) => [entree.nom, entree.nombre])).toEqual([['contrat · euros · mois', 2], ['Sans notion', 1]]);
		expect(titres(graphe.noeuds.filter((noeud) => correspondAuxFiltres(noeud, { notion: 'n2' })))).toEqual(['Acme']);
		cibler(graphe.noeuds, 'notions', { notions: ['n1', 'n2'] });
		const acme = graphe.noeuds.find((noeud) => noeud.titre === 'Acme')!;
		const n1 = graphe.notions[0]!;
		expect([acme.tx, acme.ty, acme.tz]).toEqual([n1.tx, n1.ty, n1.tz]);
	});

	it('deux notions de même nom restent deux entrées de légende, chacune sa couleur', () => {
		const homonymes: EntreeGraphe = {
			...NOTIONS,
			fiches: DONNEES.fiches!.map((fiche) => ({ ...fiche, notions: (fiche.titre === 'Acme' ? { n2: 1 } : { n1: 1 }) as Record<string, number> })),
			notions: NOTIONS.notions!.map((notion) => ({ ...notion, nom: 'contrat · euros' })),
		};
		const graphe = preparerGraphe(homonymes, COULEURS);
		const legende = construireLegende(graphe.noeuds, 'notion', Date.now(), COULEURS);

		expect(legende.map((entree) => [entree.cle, entree.nom, entree.nombre])).toEqual([['notion:n1', 'contrat · euros', 2], ['notion:n2', 'contrat · euros', 1]]);
		expect(legende[0]!.couleur).not.toBe(legende[1]!.couleur);
		expect(graphe.noeuds.find((noeud) => noeud.titre === 'Acme')!.legende).toBe('notion:n2');
	});

	it('la légende et les notions se croisent : plusieurs choix d’un côté s’additionnent, les deux côtés se combinent', () => {
		const graphe = preparerGraphe(RANGEES, COULEURS);
		construireLegende(graphe.noeuds, 'branche', Date.now(), COULEURS);
		const fiches = graphe.noeuds.filter((noeud) => !noeud.notion && !noeud.fantome);
		const gardees = (choix: { legende: Set<string>; notions: Set<string> }) => titres(fiches.filter((noeud) => retenueParLesChoix(noeud, choix))).sort();
		const legendes = [...new Set(fiches.map((noeud) => noeud.legende))].sort();
		const acme = fiches.find((noeud) => noeud.titre === 'Acme')!;

		expect(gardees({ legende: new Set(), notions: new Set() })).toEqual(titres(fiches).sort());
		expect(gardees({ legende: new Set(), notions: new Set(['n2']) })).toEqual(['Acme']);
		expect(gardees({ legende: new Set(), notions: new Set(['n1', 'n2']) })).toEqual(['Acme', 'Marie Dupont']);
		expect(gardees({ legende: new Set([acme.legende]), notions: new Set(['n2']) })).toEqual(['Acme']);
		expect(gardees({ legende: new Set(legendes), notions: new Set() })).toEqual(titres(fiches).sort());
		expect(gardees({ legende: new Set(legendes.filter((legende) => legende !== acme.legende)), notions: new Set(['n2']) })).toEqual([]);
	});

	it('les nombres de la légende suivent le filtre courant, une catégorie sans fiche retenue reste à zéro', () => {
		const graphe = preparerGraphe(RANGEES, COULEURS);
		const toutes = construireLegende(graphe.noeuds, 'branche', Date.now(), COULEURS);
		const filtrees = construireLegende(graphe.noeuds, 'branche', Date.now(), COULEURS, (noeud) =>
			retenueParLesChoix(noeud, { legende: new Set(), notions: new Set(['n2']) }),
		);

		expect(filtrees.map((entree) => entree.cle)).toEqual(['organisations', 'personnes', 'projets']);
		expect(filtrees.map((entree) => entree.cle)).toEqual(toutes.map((entree) => entree.cle));
		expect(filtrees.reduce((total, entree) => total + entree.nombre, 0)).toBe(1);
		expect(filtrees.some((entree) => entree.nombre === 0)).toBe(true);
	});

	it('sans sens, le graphe reste celui des fiches', () => {
		const graphe = preparerGraphe(DONNEES, COULEURS);

		expect([graphe.notions, graphe.liensDeNotion, graphe.sens.disponible]).toEqual([[], [], false]);
		expect(graphe.noeuds[0]!.notionPrincipale).toBeNull();
	});

	it('la couleur par branche est lue dans l’arbre : une teinte par branche principale, des nuances pour ses sous-dossiers', () => {
		const graphe = preparerGraphe(ARBRE, COULEURS);
		const principales = couleursDesBranches(graphe.noeuds, COULEURS, 'branche');
		const sousDossiers = couleursDesBranches(graphe.noeuds, COULEURS, 'sousdossier');

		expect([...principales]).toEqual([['developpement', PALETTE[0]], ['personnes', PALETTE[1]]]);
		expect([...sousDossiers.keys()]).toEqual(['developpement', 'developpement/technique', 'personnes']);
		expect(sousDossiers.get('developpement')).toBe(PALETTE[0]);
		expect(sousDossiers.get('developpement/technique')).toBe(nuance(PALETTE[0]!, 1));
		expect(nuance(PALETTE[0]!, 1)).not.toBe(PALETTE[0]);
		expect(construireLegende(graphe.noeuds, 'sousdossier', Date.now(), COULEURS).map((entree) => [entree.nom, entree.nombre])).toEqual([
			['developpement', 1],
			['developpement/technique', 2],
			['personnes', 1],
		]);
		expect(construireLegende(graphe.noeuds, 'branche', Date.now(), COULEURS)[0]!.nombre).toBe(3);
	});
});
