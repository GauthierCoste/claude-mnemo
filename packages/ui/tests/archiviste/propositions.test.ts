import { describe, expect, it } from 'vitest';
import type { ElementIndexeVue, FilVue } from '@mnemo/contrat';
import { demandePour, propositionsDuFil, type Proposition } from '../../src/archiviste/propositions.ts';

/** Fait `infere` écrit par une session, à confirmer (forme d'`ElementIndexe` du jalon 6). */
const FAIT: ElementIndexeVue = {
	id: 'projets/erp-saas/Module stocks.md#^f-0003',
	chemin: 'projets/erp-saas/Module stocks.md',
	genre: 'fait',
	typeFiche: 'sujet',
	texte: 'La table stock_mouvement passe en lecture seule après la refonte.\n« citation du mail »',
	contexte: 'Projets › Erp saas › Module stocks',
	statut: 'a_confirmer',
	date: '2026-11-21',
	valideFin: null,
	finIncluse: false,
	confiance: null,
	source: 'session 7f3a',
	typeSource: 'session',
	categorie: 'decision',
	niveau: null,
	portee: null,
	dossierProjet: null,
};

const FIL: FilVue = {
	commits: [],
	tronque: false,
	aConfirmer: [FAIT],
	montees: [
		// Consigne répétée : montée suggérée par les répétitions, sans proposition.
		{ fiche: 'consignes/Migrations réversibles.md', texte: 'Toute migration a un down() testé.', niveau: 'toujours', proposition: null },
		// Proposition d'une session : niveau vérifié avec une règle.
		{
			fiche: 'consignes/Pas de mise en production le vendredi.md',
			texte: 'Jamais de mise en production le vendredi.',
			niveau: 'verifiee',
			proposition: { niveau: 'verifiee', regle: { type: 'commandes_interdites', motifs: ['bin/deployer prod*'] }, date: '2026-11-22', source: 'session 7f3a' },
		},
	],
	modifications: [],
};

describe('propositionsDuFil', () => {
	it('fait `infere` d’une session : clé, fiche, texte (première ligne), ancre, détail avec la source', () => {
		const [p] = propositionsDuFil(FIL);
		expect(p).toMatchObject({
			cle: FAIT.id,
			genre: 'a_confirmer',
			fiche: 'projets/erp-saas/Module stocks.md',
			texte: 'La table stock_mouvement passe en lecture seule après la refonte.',
			ancre: 'f-0003',
			categorie: 'decision',
			vise: null,
		});
		expect(p!.detail).toContain('session 7f3a');
		expect(p!.detail).toContain('2026-11-21');
	});

	it('consigne répétée : montée vers « toujours », non rejetable (aucune proposition)', () => {
		const p = propositionsDuFil(FIL)[1]!;
		expect(p).toMatchObject({ genre: 'montee', fiche: 'consignes/Migrations réversibles.md', texte: 'Toute migration a un down() testé.', ancre: null, vise: { niveau: 'toujours', proposee: false } });
		expect(p.detail).toMatch(/[Rr]épétée/);
		expect(p.detail).toContain('toujours');
	});

	it('proposition de session : niveau et règle visés, source et date dans le détail', () => {
		const p = propositionsDuFil(FIL)[2]!;
		expect(p).toMatchObject({
			genre: 'montee',
			vise: { niveau: 'verifiee', regle: { type: 'commandes_interdites', motifs: ['bin/deployer prod*'] }, proposee: true },
		});
		expect(p.detail).toContain('session 7f3a');
		expect(p.detail).toContain('vérifiée');
		expect(p.detail).toContain('bin/deployer prod*');
	});

	it('un ancien identifiant sans « ^ » donne la même ancre ; fil vide → aucune proposition', () => {
		const fil: FilVue = { ...FIL, aConfirmer: [{ ...FAIT, id: 'a.md#f-0007' }], montees: [] };
		expect(propositionsDuFil(fil)[0]!.ancre).toBe('f-0007');
		expect(propositionsDuFil({ commits: [], tronque: false, aConfirmer: [], montees: [], modifications: [] })).toEqual([]);
	});
});

describe('demandePour', () => {
	const [fait, repetee, proposee] = propositionsDuFil(FIL) as [Proposition, Proposition, Proposition];
	const UTILISATEUR = { type: 'utilisateur', ref: 'utilisateur' };

	it('fait : confirmer et rejeter → décisions sur l’ancre (le genre de décision ne prend pas de source)', () => {
		expect(demandePour(fait, 'confirmer')).toEqual({ genre: 'confirmer', fiche: 'projets/erp-saas/Module stocks.md', ancre: 'f-0003' });
		expect(demandePour(fait, 'rejeter')).toEqual({ genre: 'rejeter', fiche: 'projets/erp-saas/Module stocks.md', ancre: 'f-0003' });
	});

	it('fait : corriger → un fait déclaré par l’utilisateur qui remplace l’ancien, catégorie gardée', () => {
		expect(demandePour(fait, { corriger: '  La table passe en lecture seule en janvier.  ' })).toEqual({
			genre: 'fait',
			fiche: 'projets/erp-saas/Module stocks.md',
			texte: 'La table passe en lecture seule en janvier.',
			categorie: 'decision',
			nature: 'declare',
			source: UTILISATEUR,
			remplace: 'f-0003',
		});
	});

	it('montée : confirmer → niveau appliqué (avec la règle proposée), source utilisateur', () => {
		expect(demandePour(repetee, 'confirmer')).toEqual({ genre: 'niveau', fiche: 'consignes/Migrations réversibles.md', niveau: 'toujours', source: UTILISATEUR });
		expect(demandePour(proposee, 'confirmer')).toEqual({
			genre: 'niveau',
			fiche: 'consignes/Pas de mise en production le vendredi.md',
			niveau: 'verifiee',
			regle: { type: 'commandes_interdites', motifs: ['bin/deployer prod*'] },
			source: UTILISATEUR,
		});
	});

	it('montée : rejeter → retirerProposition ; impossible sans proposition ; corriger une montée → refusé', () => {
		expect(demandePour(proposee, 'rejeter')).toEqual({ genre: 'niveau', fiche: 'consignes/Pas de mise en production le vendredi.md', retirerProposition: true, source: UTILISATEUR });
		expect(() => demandePour(repetee, 'rejeter')).toThrow(/proposition/);
		expect(() => demandePour(proposee, { corriger: 'x' })).toThrow();
	});

	it('corriger garde la fin de validité (exclue ; une fin incluse passe au lendemain), jamais la citation', () => {
		const exclue = propositionsDuFil({ ...FIL, aConfirmer: [{ ...FAIT, valideFin: '2026-12-31', finIncluse: false }], montees: [] })[0]!;
		expect(demandePour(exclue, { corriger: 'x' })).toMatchObject({ valideFin: '2026-12-31' });
		const incluse = propositionsDuFil({ ...FIL, aConfirmer: [{ ...FAIT, valideFin: '2026-12-31', finIncluse: true }], montees: [] })[0]!;
		expect(demandePour(incluse, { corriger: 'x' })).toMatchObject({ valideFin: '2027-01-01' });
		expect(demandePour(fait, { corriger: 'x' })).not.toHaveProperty('valideFin');
		expect(demandePour(exclue, { corriger: 'x' })).not.toHaveProperty('citation');
	});

	it('corriger avec un texte vide → refusé', () => {
		expect(() => demandePour(fait, { corriger: '   ' })).toThrow();
	});
});

describe('modifications proposées (genre `modification`)', () => {
	const MODIF: NonNullable<FilVue['modifications']>[number] = {
		fiche: 'consignes/env.md',
		titre: 'Env',
		cibles: ['synthese', 'section Exemples'],
		changements: ['synthèse : « Ne touche jamais aux .env. » → « Jamais de .env ni de clés. »', 'section « Exemples » : créée'],
		date: '2026-11-22',
		source: 'session 7f3a',
	};
	const UTILISATEUR = { type: 'utilisateur', ref: 'utilisateur' };

	it('une carte par modification : cibles en texte, source, date et changements dans le détail', () => {
		const p = propositionsDuFil({ ...FIL, aConfirmer: [], montees: [], modifications: [MODIF] })[0]!;
		expect(p).toMatchObject({ cle: 'modification:consignes/env.md', genre: 'modification', fiche: 'consignes/env.md', texte: 'Modifier synthese, section Exemples', ancre: null, vise: null });
		expect(p.detail).toContain('session 7f3a');
		expect(p.detail).toContain('2026-11-22');
		expect(p.detail).toContain('section « Exemples » : créée');
		// un service plus ancien n'envoie pas `modifications`
		expect(propositionsDuFil(FIL).some((x) => x.genre === 'modification')).toBe(false);
	});

	it('confirmer → appliquerProposition, rejeter → retirerProposition (source utilisateur) ; corriger → refusé', () => {
		const p = propositionsDuFil({ ...FIL, aConfirmer: [], montees: [], modifications: [MODIF] })[0]!;
		expect(demandePour(p, 'confirmer')).toEqual({ genre: 'modification', fiche: 'consignes/env.md', appliquerProposition: true, source: UTILISATEUR });
		expect(demandePour(p, 'rejeter')).toEqual({ genre: 'modification', fiche: 'consignes/env.md', retirerProposition: true, source: UTILISATEUR });
		expect(() => demandePour(p, { corriger: 'x' })).toThrow();
	});
});
