import { describe, expect, it } from 'vitest';
import type { Demande } from '../../src/application/proposer.ts';
import { LONGUEUR_MAX_ENTREE, LONGUEUR_MAX_TABLEAU, TABLES_ARGUMENTS, validerArguments, validerDemande, validerRequete } from '../../src/application/validation.ts';

const source = { ref: 'dit en séance', type: 'utilisateur' } as const;
const valides: Demande[] = [
	{ genre: 'fait', fiche: 'clients/acme', texte: 'Budget : 12000 €', nature: 'declare', source },
	{ genre: 'fait', fiche: 'clients/acme', titreSiNouvelle: 'Acme', typeSiNouvelle: 'entite', texte: 'x', categorie: 'montant', nature: 'observe', source, citation: 'c', valideDebut: '2026-01-01', valideFin: '2026-12-31', remplace: 'abc', annuleEtRemplace: true, apresProches: true },
	{ genre: 'fiche', chemin: 'sujets/x', type: 'sujet', titre: 'X' },
	{ genre: 'fiche', chemin: 'sujets/x', type: 'sujet', titre: 'X', synthese: 's', donnees: { a: [1, 'b', { c: null }] } },
	{ genre: 'relation', fiche: 'a', verbe: 'depend_de', cible: 'b' },
	{ genre: 'consigne', texte: 'Ne jamais pousser', portee: { genre: 'globale' }, source },
	{ genre: 'consigne', fiche: 'consignes/x', texte: 'Tester', portee: { genre: 'projet', nom: 'mnemo' }, source, apresProches: true },
	{ genre: 'confirmer', fiche: 'a', ancre: 'x1' },
	{ genre: 'rejeter', fiche: 'a', ancre: 'x1' },
	{ genre: 'supprimer', fiche: 'a', ancre: 'x1' },
];

const refus = (brut: unknown) => {
	const r = validerDemande(brut);
	if (r.ok) throw new Error('refus attendu');
	return r.motif;
};

describe('validerDemande', () => {
	it.each(valides)('accepte une demande valide « $genre » telle quelle', (demande) => {
		const r = validerDemande(structuredClone(demande));
		expect(r).toEqual({ ok: true, valeur: demande });
	});

	it('refuse ce qui n\'est pas un objet', () => {
		expect(refus(null)).toBe('un objet est attendu, reçu null.');
		expect(refus([])).toBe('un objet est attendu, reçu tableau.');
		expect(refus('fait')).toBe('un objet est attendu, reçu chaîne.');
	});

	it('refuse un objet vide et un genre inconnu', () => {
		expect(refus({})).toBe('champ « genre » : obligatoire.');
		expect(refus({ genre: 'effacer' })).toContain('champ « genre » : valeur inconnue');
		expect(refus({ genre: 'toString' })).toContain('valeur inconnue');
		expect(refus({ genre: 3 })).toContain('valeur inconnue');
	});

	it('refuse un champ du mauvais type, en nommant le champ', () => {
		expect(refus({ ...valides[0], texte: 42 })).toBe('champ « texte » : chaîne attendue, reçu nombre.');
		expect(refus({ ...valides[0], apresProches: 'oui' })).toBe('champ « apresProches » : booléen attendu, reçu chaîne.');
		expect(refus({ ...valides[0], source: { ref: 1, type: 'utilisateur' } })).toBe('champ « source.ref » : chaîne attendue, reçu nombre.');
		expect(refus({ ...valides[0], source: null })).toBe('champ « source » : objet attendu, reçu null.');
		expect(refus({ ...valides[0], nature: 'sur' })).toContain('champ « nature » : valeur « sur » inconnue');
		expect(refus({ ...valides[2], donnees: [] })).toBe('champ « donnees » : objet attendu, reçu tableau.');
	});

	it('refuse un champ obligatoire absent', () => {
		expect(refus({ genre: 'relation', fiche: 'a', verbe: 'v' })).toBe('champ « cible » : obligatoire pour le genre « relation ».');
		expect(refus({ ...valides[5], portee: { genre: 'projet', nom: 3 } })).toBe('champ « portee.nom » : chaîne attendue, reçu nombre.');
	});

	it('refuse une chaîne trop longue (1 Mo), y compris dans les données', () => {
		const enorme = 'a'.repeat(1_000_000);
		expect(refus({ ...valides[0], texte: enorme })).toBe(`champ « texte » : 1000000 caractères, ${LONGUEUR_MAX_ENTREE} au plus.`);
		expect(refus({ ...valides[2], donnees: { liste: [enorme] } })).toContain('champ « donnees.liste[0] »');
		expect(validerDemande({ ...valides[0], texte: 'a'.repeat(LONGUEUR_MAX_ENTREE) }).ok).toBe(true);
	});

	it('refuse un champ en trop en le nommant, et ne laisse pas passer __proto__', () => {
		expect(refus({ ...valides[0], mechant: 1 })).toBe('champ inconnu « mechant » pour le genre « fait ».');
		expect(refus({ ...valides[0], source: { ...source, extra: 1 } })).toContain('champ inconnu « source.extra »');
		expect(refus(JSON.parse('{"genre":"relation","fiche":"a","verbe":"v","cible":"b","__proto__":{"x":1}}'))).toContain('« __proto__ »');
	});

	it('refuse des données trop profondes', () => {
		let d: unknown = 'x';
		for (let i = 0; i < 20; i++) d = { d };
		expect(refus({ ...valides[2], donnees: d })).toContain('imbrication');
	});
});

describe('bornes des tableaux et clés réservées', () => {
	it('borne les tableaux et le nombre de clés des données', () => {
		const trop = Array.from({ length: LONGUEUR_MAX_TABLEAU + 1 }, () => 1);
		expect(refus({ ...valides[2], donnees: { a: trop } })).toBe(`champ « donnees.a » : 1001 éléments, ${LONGUEUR_MAX_TABLEAU} au plus.`);
		const cles = Object.fromEntries(trop.map((_, i) => [`k${i}`, 1]));
		expect(refus({ ...valides[2], donnees: cles })).toBe(`champ « donnees » : 1001 clés, ${LONGUEUR_MAX_TABLEAU} au plus.`);
		expect(validerDemande({ ...valides[2], donnees: { a: trop.slice(1) } }).ok).toBe(true);
	});

	it('borne le nombre total d\'éléments des données', () => {
		const donnees = { a: Array.from({ length: 11 }, () => Array.from({ length: 1000 }, () => 1)) };
		expect(refus({ ...valides[2], donnees })).toContain('au total dans les données');
	});

	it('refuse les clés réservées dans les données, à tout niveau', () => {
		expect(refus({ ...valides[2], donnees: JSON.parse('{"__proto__":1}') })).toBe('champ « donnees.__proto__ » : clé réservée interdite.');
		expect(refus({ ...valides[2], donnees: { x: { constructor: 1 } } })).toContain('donnees.x.constructor');
		expect(refus({ ...valides[2], donnees: { prototype: 1 } })).toContain('clé réservée');
	});

	it('n\'accepte que des objets simples', () => {
		expect(refus({ ...valides[2], donnees: new Map() })).toBe('champ « donnees » : objet attendu, reçu objet.');
		expect(refus(new Date())).toBe('un objet est attendu, reçu objet.');
		expect(validerDemande(Object.assign(Object.create(null), valides[4])).ok).toBe(true);
	});
});

describe('validerRequete', () => {
	const requeteRefusee = (brut: unknown) => {
		const r = validerRequete(brut);
		if (r.ok) throw new Error('refus attendu');
		return r.motif;
	};

	it('accepte une requête minimale et complète', () => {
		expect(validerRequete({ texte: 'inventaire' })).toEqual({ ok: true, valeur: { texte: 'inventaire' } });
		const complete = { texte: 'x', perimetre: 'clients/', position: 'p', inclureInvalides: true, inclureAConfirmer: false, genres: ['fiche', 'fait', 'consigne'], limite: 50, sansSeuil: true };
		expect(validerRequete({ ...complete })).toEqual({ ok: true, valeur: complete });
	});

	it('refuse limite hors bornes ou non entière', () => {
		expect(requeteRefusee({ texte: 'x', limite: -3 })).toBe('champ « limite » : entier de 1 à 50 attendu, reçu -3.');
		expect(requeteRefusee({ texte: 'x', limite: 1.5 })).toContain('reçu 1.5');
		expect(requeteRefusee({ texte: 'x', limite: 51 })).toContain('de 1 à 50');
		expect(requeteRefusee({ texte: 'x', limite: '5' })).toBe('champ « limite » : entier attendu, reçu chaîne.');
	});

	it('borne et dédoublonne genres', () => {
		expect(requeteRefusee({ texte: 'x', genres: ['fait', 'fait'] })).toBe('champ « genres » : valeurs en double.');
		expect(requeteRefusee({ texte: 'x', genres: Array.from({ length: 5_000_000 }, () => 'fait') })).toContain('5000000 éléments');
	});

	it('refuse genres inconnus, mal formés, texte absent, champ en trop, non-objet', () => {
		expect(requeteRefusee({ texte: 'x', genres: ['relation'] })).toContain('champ « genres[0] »');
		expect(requeteRefusee({ texte: 'x', genres: 'fait' })).toBe('champ « genres » : tableau attendu, reçu chaîne.');
		expect(requeteRefusee({})).toBe('champ « texte » : obligatoire pour une recherche.');
		expect(requeteRefusee({ texte: 'x', sansSeuil: 1 })).toBe('champ « sansSeuil » : booléen attendu, reçu nombre.');
		expect(requeteRefusee({ texte: 'x', ordre: 'asc' })).toBe('champ inconnu « ordre » pour une recherche.');
		expect(requeteRefusee([])).toBe('un objet est attendu, reçu tableau.');
		expect(requeteRefusee(null)).toBe('un objet est attendu, reçu null.');
		expect(requeteRefusee({ texte: 'a'.repeat(LONGUEUR_MAX_ENTREE + 1) })).toContain('au plus');
	});

	it('noms publics : les motifs nomment le champ comme l\'appelant l\'expose', () => {
		const sans = validerRequete({}, { texte: 'requete' });
		expect(sans.ok ? '' : sans.motif).toBe('champ « requete » : obligatoire pour une recherche.');
		const limite = validerRequete({ texte: 'x', perimetre: 3 }, { perimetre: 'dossier' });
		expect(limite.ok ? '' : limite.motif).toContain('champ « dossier » : chaîne attendue');
	});
});

describe('validerArguments (outils hors proposer)', () => {
	it('accepte les arguments attendus et normalise les dossiers', () => {
		expect(validerArguments('chercher', { requete: 'x', dossier: 'projets/', tout: true, limite: 5 })).toEqual({ ok: true, valeur: { requete: 'x', dossier: 'projets', tout: true, limite: 5 } });
		expect(validerArguments('lister', {})).toEqual({ ok: true, valeur: {} });
		expect(validerArguments('lister', { dossier: '' })).toEqual({ ok: true, valeur: { dossier: '' } });
		expect(validerArguments('lire', { id: 'a.md#^f-0001' })).toEqual({ ok: true, valeur: { id: 'a.md#^f-0001' } });
		expect(validerArguments('voisins', { id: 'a.md' }).ok).toBe(true);
		expect(validerArguments('chronologie', { sujet: 's', limite: 50 }).ok).toBe(true);
		expect(validerArguments('contexte', { question: 'q' }).ok).toBe(true);
		expect(validerArguments('deplacer', { id: 'a.md', dossier: 'projets/alpha/' })).toEqual({ ok: true, valeur: { id: 'a.md', dossier: 'projets/alpha' } });
	});

	const refus: [Parameters<typeof validerArguments>[0], unknown, string][] = [
		['lire', {}, 'champ « id » : obligatoire'],
		['lire', { id: 3 }, 'champ « id » : chaîne attendue'],
		['lire', { id: 'a.md', pirate: true }, 'champ inconnu « pirate »'],
		['voisins', { id: 'x'.repeat(LONGUEUR_MAX_ENTREE + 1) }, `${LONGUEUR_MAX_ENTREE} au plus`],
		['lister', { dossier: '../dehors' }, 'dossier invalide'],
		['chercher', { requete: 'x', dossier: '/etc' }, 'dossier invalide'],
		['chercher', { dossier: 'projets' }, 'champ « requete » : obligatoire'],
		['chercher', { requete: 'x', limite: 'beaucoup' }, 'champ « limite »'],
		['chercher', { requete: 'x', tout: 'oui' }, 'champ « tout » : booléen attendu'],
		['chronologie', { sujet: 's', limite: 0 }, 'champ « limite » : entier de 1 à 50'],
		['contexte', { question: 1 }, 'champ « question »'],
		['deplacer', { id: 'a.md' }, 'champ « dossier » : obligatoire'],
		['deplacer', { id: 'a.md#^f-0001', dossier: 'x' }, 'fiche entière'],
		['deplacer', { id: 'a.md', dossier: '/etc' }, 'dossier invalide'],
		['lire', null, 'un objet est attendu'],
	];
	for (const [outil, brut, motif] of refus) {
		it(`${outil} ${JSON.stringify(brut)?.slice(0, 60)} → refus`, () => {
			const r = validerArguments(outil, brut);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.motif).toContain(motif);
		});
	}

	it('chaque argument porte une description (reprise dans le schéma des outils)', () => {
		for (const [outil, table] of Object.entries(TABLES_ARGUMENTS)) {
			for (const [nom, champ] of Object.entries(table)) expect((champ as { description?: string }).description, `${outil}.${nom}`).toMatch(/\S/u);
		}
	});
});
