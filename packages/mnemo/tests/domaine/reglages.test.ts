import { describe, expect, it } from 'vitest';
import { CHAMPS_REGLAGES, fusionnerFichier, lireReglages, modifierReglages, REGLAGES_PAR_DEFAUT, REGLAGES_RETIRES, reglagesEnFichier, valeurDuReglage } from '../../src/domaine/reglages.ts';

describe('réglages : valeurs par défaut', () => {
	it('reprennent le comportement actuel', () => {
		expect(REGLAGES_PAR_DEFAUT).toEqual({
			projets: { marqueurs: ['.git', 'package.json', 'composer.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'] },
			contexte: {
				similariteRecherche: 0.45,
				seuilInjection: 90,
				injectionsParMessage: 2,
				seuilPiste: 10,
				pistesParMessage: 3,
				cartesNommees: 5,
				poidsInjection: 0.25,
				demiVieInjection: 3,
			},
			entrainement: { automatique: true },
			// les réglages de la mémoire sont les règles de SCHEMA.md, jamais dans ce fichier : groupe vide
			memoire: {},
			recherche: { resultats: 10, chronologie: 30, graphe: 5, reranker: 40, poidsPosition: 0.1, poidsConfiance: 0.05, poidsMemoire: 0.05, poidsFraicheur: 0.05 },
			modeles: { inactiviteMinutes: 15 },
			archiviste: { typesAConfirmer: [] },
			service: { port: 4747, navigateur: 'auto' },
			interface: { accent: '#7df0c6' },
		});
	});

	it('chaque champ a un groupe, un libellé, une explication en une ligne et un défaut lisible', () => {
		for (const champ of CHAMPS_REGLAGES) {
			expect(champ.libelle).not.toBe('');
			expect(champ.explication).not.toMatch(/\n/u);
			expect(champ.explication.length).toBeGreaterThan(10);
			expect(valeurDuReglage(REGLAGES_PAR_DEFAUT, champ.cle)).toEqual(champ.defaut);
		}
		expect(new Set(CHAMPS_REGLAGES.map((c) => c.groupe))).toEqual(new Set(['projets', 'contexte', 'entrainement', 'recherche', 'modeles', 'archiviste', 'service', 'interface']));
		expect(CHAMPS_REGLAGES.filter((c) => c.effet === 'service').map((c) => c.cle)).toEqual(['service.port']);
	});
});

describe('lireReglages', () => {
	it('fichier vide ou absent : les défauts, sans avertissement', () => {
		expect(lireReglages({})).toEqual({ reglages: REGLAGES_PAR_DEFAUT, avertissements: [] });
		expect(lireReglages(undefined)).toEqual({ reglages: REGLAGES_PAR_DEFAUT, avertissements: [] });
	});

	it('lit les valeurs valides, garde le défaut des autres', () => {
		const { reglages, avertissements } = lireReglages({ modeles: { inactiviteMinutes: 30 }, service: { navigateur: 'brave' }, archiviste: { typesAConfirmer: ['entite'] } });
		expect(avertissements).toEqual([]);
		expect(reglages.modeles).toEqual({ inactiviteMinutes: 30 });
		expect(reglages.service).toEqual({ port: 4747, navigateur: 'brave' });
		expect(reglages.archiviste.typesAConfirmer).toEqual(['entite']);
	});

	it('valeur invalide : le défaut et un avertissement clair, jamais d’exception', () => {
		const { reglages, avertissements } = lireReglages({ projets: { marqueurs: 'git' }, modeles: { inactiviteMinutes: 999 }, contexte: { cartesNommees: 'haute' }, service: { port: 80 } });
		expect(reglages).toEqual(REGLAGES_PAR_DEFAUT);
		expect(avertissements).toHaveLength(4);
		// dans l'ordre des champs (CHAMPS_REGLAGES : le contexte d'abord)
		expect(avertissements[0]).toMatch(/contexte\.cartesNommees.*défaut : 5/u);
		expect(avertissements[1]).toMatch(/projets\.marqueurs.*défaut/u);
		expect(avertissements.join('\n')).toContain('modeles.inactiviteMinutes');
		expect(avertissements.join('\n')).toMatch(/service\.port.*1024 à 65535.*défaut : 4747/u);
	});

	it('réglage ou groupe inconnu : ignoré avec un avertissement ; contenu qui n’est pas un objet : défauts et avertissement', () => {
		expect(lireReglages({ projets: { couleur: 'bleu' }, autre: 1 }).avertissements).toEqual([
			'Réglage inconnu « projets.couleur » : ignoré.',
			'Réglage inconnu « autre » : ignoré.',
		]);
		// l'ancien réglage de profondeur des projets n'existe plus : un réglage inconnu comme un autre
		expect(lireReglages({ projets: { profondeur: 3 } }).avertissements).toEqual(['Réglage inconnu « projets.profondeur » : ignoré.']);
		for (const brut of [[], 'texte', 3, null]) {
			const r = lireReglages(brut);
			expect(r.reglages).toEqual(REGLAGES_PAR_DEFAUT);
			expect(r.avertissements).toHaveLength(1);
		}
	});

	it('marqueurs : ni vide, ni chemin, sans doublon (casse ignorée)', () => {
		expect(lireReglages({ projets: { marqueurs: [] } }).avertissements).toHaveLength(1);
		expect(lireReglages({ projets: { marqueurs: ['a/b'] } }).avertissements).toHaveLength(1);
		expect(lireReglages({ projets: { marqueurs: [' '] } }).avertissements).toHaveLength(1);
		for (const invisible of ['\u0007', '\u0085', '\u200e', '\u200f', '\u061c', '\u202e', '\u2066']) {
			expect(lireReglages({ projets: { marqueurs: [`Make${invisible}file`] } }).avertissements, invisible.codePointAt(0)!.toString(16)).toHaveLength(1);
		}
		expect(lireReglages({ projets: { marqueurs: ['Makefile', 'makefile', ' mix.exs '] } }).reglages.projets.marqueurs).toEqual(['Makefile', 'mix.exs']);
	});
});

describe('réglages retirés du contexte', () => {
	it('un fichier qui porte les anciennes clés se charge avec un avertissement par clé et les défauts', () => {
		const anciennes = ['fichesMax', 'fichesMin', 'caracteres', 'fichesListees', 'scoreMin', 'messages', 'reponses', 'reranker'];
		const { reglages, avertissements } = lireReglages({ contexte: Object.fromEntries(anciennes.map((k) => [k, 5])) });
		expect(reglages).toEqual(REGLAGES_PAR_DEFAUT);
		expect(avertissements).toHaveLength(anciennes.length);
		for (const k of anciennes) expect(avertissements.join('\n')).toContain(`contexte.${k}`);
	});

	it('cartesNommees : 5 (0 à 15)', () => {
		const champ = (cle: string) => CHAMPS_REGLAGES.find((c) => c.cle === cle)!;
		expect(champ('contexte.cartesNommees')).toMatchObject({ defaut: 5, min: 0, max: 15, libelle: 'Cartes des fiches nommées par message' });
	});

	it('poidsInjection : 0,25 (0 à 1, décimal) ; demiVieInjection : 3 messages (1 à 20, entier)', () => {
		const champ = (cle: string) => CHAMPS_REGLAGES.find((c) => c.cle === cle)!;
		expect(champ('contexte.poidsInjection')).toMatchObject({ genre: 'decimal', defaut: 0.25, min: 0, max: 1, libelle: 'Poids d’une fiche injectée à la main sur ses voisines' });
		expect(champ('contexte.demiVieInjection')).toMatchObject({ genre: 'entier', defaut: 3, min: 1, max: 20, libelle: 'Demi-vie de ce poids, en messages' });
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.poidsInjection': 1.5 }).ok).toBe(false);
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.demiVieInjection': 0 }).ok).toBe(false);
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.demiVieInjection': 2.5 }).ok).toBe(false);
		const r = modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.poidsInjection': 0, 'contexte.demiVieInjection': 20 });
		expect(r).toEqual({ ok: true, reglages: { ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, poidsInjection: 0, demiVieInjection: 20 } } });
	});
});

describe('injection automatique et pistes', () => {
	const champ = (cle: string) => CHAMPS_REGLAGES.find((c) => c.cle === cle)!;

	it('quatre entiers aux bornes et défauts de la spécification', () => {
		expect(champ('contexte.seuilInjection')).toMatchObject({ groupe: 'contexte', genre: 'entier', defaut: 90, min: 50, max: 100, unite: '%', effet: 'immediat', libelle: 'Seuil d’injection automatique' });
		expect(champ('contexte.injectionsParMessage')).toMatchObject({ groupe: 'contexte', genre: 'entier', defaut: 2, min: 0, max: 5, effet: 'immediat' });
		expect(champ('contexte.seuilPiste')).toMatchObject({ groupe: 'contexte', genre: 'entier', defaut: 10, min: 0, max: 100, unite: '%', effet: 'immediat', libelle: 'Seuil des pistes' });
		expect(champ('contexte.pistesParMessage')).toMatchObject({ groupe: 'contexte', genre: 'entier', defaut: 3, min: 0, max: 10, effet: 'immediat', libelle: 'Pistes par message' });
		for (const [cle, dehors] of [['contexte.seuilInjection', [49, 101, 90.5]], ['contexte.injectionsParMessage', [-1, 6]], ['contexte.seuilPiste', [-1, 101]], ['contexte.pistesParMessage', [-1, 11, 2.5]]] as const) {
			for (const v of dehors) expect(modifierReglages(REGLAGES_PAR_DEFAUT, { [cle]: v }).ok, `${cle} = ${v}`).toBe(false);
		}
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.injectionsParMessage': 0, 'contexte.pistesParMessage': 10 }).ok).toBe(true);
	});

	it('l’explication des seuils dit que 100 % veut dire jamais et qu’ils n’agissent qu’avec une note calibrée', () => {
		expect(champ('contexte.seuilInjection').explication).toContain('100 % : jamais');
		expect(champ('contexte.seuilInjection').explication).toContain('note calibrée');
		expect(champ('contexte.seuilPiste').explication).toContain('note est apprise');
		for (const c of CHAMPS_REGLAGES.filter((x) => x.groupe === 'contexte')) expect(`${c.libelle} ${c.explication}`).not.toMatch(/servi|nourri|·/u);
	});

	it('seuil des pistes au plus le seuil d’injection : le lot qui le dépasse est refusé, égal accepté', () => {
		const refus = modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.seuilPiste': 95 });
		expect(refus).toEqual({ ok: false, motifs: ['Seuil des pistes (contexte.seuilPiste) : 95 % dépasse le seuil d’injection automatique (90 %).'] });
		// baisser le seuil d'injection sous le seuil des pistes actuel est refusé aussi
		const pistesHautes = { ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, seuilPiste: 80 } };
		expect(modifierReglages(pistesHautes, { 'contexte.seuilInjection': 55 }).ok).toBe(false);
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.seuilInjection': 100, 'contexte.seuilPiste': 100 }).ok).toBe(true);
		const ensemble = modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.seuilInjection': 55, 'contexte.seuilPiste': 55 });
		expect(ensemble).toEqual({ ok: true, reglages: { ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, seuilInjection: 55, seuilPiste: 55 } } });
	});

	it('seuil des pistes à 10 par défaut (réglé au banc) : un fichier n’a jamais gardé un ancien défaut (60, 30), il prend le nouveau sans migration', () => {
		// le fichier ne garde que ce qui diffère du défaut : écrit quand 60 ou 30 l'était, il ne porte pas de seuil des pistes
		expect(reglagesEnFichier(REGLAGES_PAR_DEFAUT)).toEqual({});
		expect(REGLAGES_PAR_DEFAUT.contexte.seuilPiste).toBe(10);
		expect(lireReglages({ contexte: { pistesParMessage: 4 } }).reglages.contexte).toMatchObject({ seuilPiste: 10, pistesParMessage: 4 });
	});

	it('fichier où le seuil des pistes dépasse le seuil d’injection : ramené au seuil d’injection, avec un avertissement', () => {
		const { reglages, avertissements } = lireReglages({ contexte: { seuilInjection: 70, seuilPiste: 85 } });
		expect(reglages.contexte).toMatchObject({ seuilInjection: 70, seuilPiste: 70 });
		expect(avertissements).toEqual(['Réglage « contexte.seuilPiste » (Seuil des pistes) : 85 % dépasse le seuil d’injection automatique ; ramené à 70 %.']);
		// seuil d'injection invalide : son défaut (90) sert de borne
		expect(lireReglages({ contexte: { seuilInjection: 20, seuilPiste: 95 } }).reglages.contexte).toMatchObject({ seuilInjection: 90, seuilPiste: 90 });
		expect(lireReglages({ contexte: { seuilInjection: 70, seuilPiste: 70 } }).avertissements).toEqual([]);
	});

	it('cartesPerimetre retiré : ignoré sans avertissement à la lecture, refusé à la modification', () => {
		expect(REGLAGES_RETIRES).toContain('contexte.cartesPerimetre');
		expect(CHAMPS_REGLAGES.some((c) => c.cle === 'contexte.cartesPerimetre')).toBe(false);
		expect(lireReglages({ contexte: { cartesPerimetre: 12, pistesParMessage: 4 } })).toEqual({
			reglages: { ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, pistesParMessage: 4 } },
			avertissements: [],
		});
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.cartesPerimetre': 5 })).toEqual({ ok: false, motifs: ['Réglage retiré « contexte.cartesPerimetre ».'] });
		// l'ancienne clé reste telle quelle dans le fichier, comme toute entrée non touchée
		expect(fusionnerFichier({ contexte: { cartesPerimetre: 12 } }, REGLAGES_PAR_DEFAUT, ['contexte.pistesParMessage'])).toEqual({ contexte: { cartesPerimetre: 12 } });
	});
});

describe('poids de la recherche', () => {
	it('quatre poids décimaux de 0 à 0,5, aux défauts de la note unique, refusés au-delà des bornes', () => {
		const attendus = { poidsPosition: 0.1, poidsConfiance: 0.05, poidsMemoire: 0.05, poidsFraicheur: 0.05 };
		for (const [nom, defaut] of Object.entries(attendus)) {
			const champ = CHAMPS_REGLAGES.find((c) => c.cle === `recherche.${nom}`)!;
			expect(champ).toMatchObject({ groupe: 'recherche', genre: 'decimal', defaut, min: 0, max: 0.5, effet: 'immediat' });
			expect(modifierReglages(REGLAGES_PAR_DEFAUT, { [champ.cle]: 0.51 }).ok).toBe(false);
			expect(modifierReglages(REGLAGES_PAR_DEFAUT, { [champ.cle]: -0.01 }).ok).toBe(false);
			expect(modifierReglages(REGLAGES_PAR_DEFAUT, { [champ.cle]: 0.5 }).ok).toBe(true);
		}
		expect(REGLAGES_PAR_DEFAUT.recherche).toMatchObject(attendus);
	});
});

describe('interface.accent', () => {
	it('défaut #7df0c6 (genre couleur) ; une couleur #rrggbb est lue en minuscules', () => {
		expect(CHAMPS_REGLAGES.find((c) => c.cle === 'interface.accent')).toMatchObject({ genre: 'couleur', defaut: '#7df0c6', libelle: 'Couleur principale de l’interface' });
		const { reglages, avertissements } = lireReglages({ interface: { accent: '#FF8800' } });
		expect(avertissements).toEqual([]);
		expect(reglages.interface.accent).toBe('#ff8800');
	});

	it('format invalide : le défaut et un avertissement ; modification refusée', () => {
		for (const mauvais of ['rouge', '#fff', '#12345g', '7df0c6', 12, null]) {
			const { reglages, avertissements } = lireReglages({ interface: { accent: mauvais } });
			expect(reglages.interface.accent).toBe('#7df0c6');
			expect(avertissements).toHaveLength(1);
			expect(avertissements[0]).toMatch(/interface\.accent.*défaut : #7df0c6/u);
		}
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'interface.accent': 'bleu' }).ok).toBe(false);
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'interface.accent': '#336699' }).ok).toBe(true);
	});
});

describe('modifierReglages', () => {
	it('applique les valeurs données, null rétablit le défaut', () => {
		const depart = lireReglages({ modeles: { inactiviteMinutes: 30 } }).reglages;
		const r = modifierReglages(depart, { 'modeles.inactiviteMinutes': null, 'contexte.cartesNommees': 7 });
		expect(r).toEqual({ ok: true, reglages: { ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, cartesNommees: 7 } } });
	});

	it('refuse tout le lot si une valeur est invalide ou une clé inconnue', () => {
		const r = modifierReglages(REGLAGES_PAR_DEFAUT, { 'contexte.cartesNommees': 7, 'service.navigateur': 'netscape', 'x.y': 1 });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.motifs).toEqual([expect.stringContaining('service.navigateur'), 'Réglage inconnu « x.y ».']);
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, [] as unknown as Record<string, unknown>).ok).toBe(false);
	});
});

describe('reglagesEnFichier', () => {
	it('n’écrit que ce qui diffère du défaut, relu à l’identique', () => {
		expect(reglagesEnFichier(REGLAGES_PAR_DEFAUT)).toEqual({});
		const r = { ...REGLAGES_PAR_DEFAUT, modeles: { inactiviteMinutes: 30 } };
		expect(reglagesEnFichier(r)).toEqual({ modeles: { inactiviteMinutes: 30 } });
		expect(lireReglages(reglagesEnFichier(r)).reglages).toEqual(r);
	});
});

describe('fusionnerFichier', () => {
	it('ne réécrit que les champs nommés : inconnus (version plus récente) et invalides non touchés restent tels quels', () => {
		const brut = JSON.parse('{"contexte":{"cartesNommees":42,"futur":true},"nouveau":{"x":1},"service":{"port":4800},"__proto__":{"pollue":1}}');
		const r = { ...REGLAGES_PAR_DEFAUT, modeles: { inactiviteMinutes: 30 } };
		const sortie = fusionnerFichier(brut, { ...r, service: { ...r.service, port: 4747 } }, ['modeles.inactiviteMinutes', 'service.port']);
		expect(JSON.stringify(sortie)).toBe('{"contexte":{"cartesNommees":42,"futur":true},"nouveau":{"x":1},"__proto__":{"pollue":1},"modeles":{"inactiviteMinutes":30}}');
		expect(({} as Record<string, unknown>)['pollue']).toBeUndefined();
		// un champ nommé et invalide dans le fichier est remplacé ; le contenu lu n'est pas modifié
		expect(fusionnerFichier(brut, REGLAGES_PAR_DEFAUT, ['contexte.cartesNommees'])).toMatchObject({ contexte: { futur: true } });
		expect(brut.contexte.cartesNommees).toBe(42);
		expect(fusionnerFichier('pas un objet', r, ['modeles.inactiviteMinutes'])).toEqual({ modeles: { inactiviteMinutes: 30 } });
	});
});

describe('réglage oui ou non : entrainement.automatique', () => {
	it('oui par défaut ; lu, modifié et rétabli ; autre chose qu’un booléen refusé (lecture : le défaut et un avertissement)', () => {
		const champ = CHAMPS_REGLAGES.find((c) => c.cle === 'entrainement.automatique')!;
		expect(champ).toMatchObject({ genre: 'booleen', defaut: true, groupe: 'entrainement', effet: 'immediat' });
		expect(champ.explication).toContain('au plus une fois par jour');
		expect(lireReglages({ entrainement: { automatique: false } }).reglages.entrainement.automatique).toBe(false);
		const lu = lireReglages({ entrainement: { automatique: 'non' } });
		expect(lu.reglages.entrainement.automatique).toBe(true);
		expect(lu.avertissements).toEqual(['Réglage « entrainement.automatique » (Réapprentissage automatique de la note) invalide : vrai ou faux attendu ; défaut : oui.']);
		const coupe = modifierReglages(REGLAGES_PAR_DEFAUT, { 'entrainement.automatique': false });
		expect(coupe.ok && coupe.reglages.entrainement.automatique).toBe(false);
		expect(coupe.ok && reglagesEnFichier(coupe.reglages)).toEqual({ entrainement: { automatique: false } });
		expect(modifierReglages(REGLAGES_PAR_DEFAUT, { 'entrainement.automatique': 1 }).ok).toBe(false);
		const retabli = coupe.ok ? modifierReglages(coupe.reglages, { 'entrainement.automatique': null }) : null;
		expect(retabli?.ok && retabli.reglages.entrainement.automatique).toBe(true);
	});
});
