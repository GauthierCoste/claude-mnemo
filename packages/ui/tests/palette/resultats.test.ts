import type { FicheGraphe, SessionVue, TrouveRechercheVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { correspondNettement, demandeAuMoteur, motsDe, projetDeFiche, projetUtilisable, resultatsPalette, SESSIONS_MAX, TROUVES_MAX, type EntreePalette } from '../../src/palette/resultats.ts';

function session(id: string, objectif: string, e: Partial<SessionVue> = {}): SessionVue {
	return { id, profil: 'travail', dossier: 'erp-saas', position: 'projets/erp-saas', projet: 'erp-saas', objectif, etat: 'attend', creeeMs: 1, majMs: 1, bilanDemandeMs: null, commitDebut: null, branche: null, terminal: true, dialogueOuvert: false, dossierNonRattache: null, ...e };
}
function fiche(chemin: string, titre: string): FicheGraphe {
	return { chemin, titre, type: chemin.startsWith('sources/') ? 'source' : 'sujet', alias: [], etats: [], faitsActifs: 1, categories: {}, dates: [], branche: '', parent: null };
}
function trouve(id: string, e: Partial<TrouveRechercheVue> = {}): TrouveRechercheVue {
	const chemin = id.split('#')[0]!;
	return {
		id,
		chemin,
		genre: id.includes('#') ? 'fait' : 'fiche',
		typeFiche: chemin.startsWith('sources/') ? 'source' : 'sujet',
		texte: 'x',
		contexte: '',
		statut: 'servi',
		date: null,
		valideFin: null,
		finIncluse: false,
		categorie: null,
		portee: null,
		confiance: null,
		source: null,
		typeSource: null,
		score: 0.5,
		note: null,
		...e,
	};
}

const SESSIONS = [session('a', 'Refondre le module stocks'), session('b', "Corriger l'export CSV", { dossier: 'site', projet: 'site', position: 'projets/site' }), session('c', 'Relance facture Durand', { etat: 'terminee' })];
const FICHES = [fiche('projets/erp-saas/Module stocks.md', 'Module stocks'), fiche('sources/cdc-stocks.md', 'CDC stocks')];
const base = (e: Partial<EntreePalette>): EntreePalette => ({ q: 'stocks', sessions: SESSIONS, fiches: FICHES, moteur: null, filtre: 'tout', projet: null, tout: false, ...e });
const cles = (e: Partial<EntreePalette>) => resultatsPalette(base(e)).resultats.map((r) => r.cle);

describe('palette : correspondance nette des sessions', () => {
	it('mot entier ou début d’au moins 3 lettres, sans accents ni casse ; tous les mots', () => {
		const objectif = ['Refondre le module Stocks (lots)'];
		expect(correspondNettement(motsDe('stocks'), objectif)).toBe(true);
		expect(correspondNettement(motsDe('sto'), objectif)).toBe(true);
		expect(correspondNettement(motsDe('st'), objectif)).toBe(false);
		expect(correspondNettement(motsDe('ock'), objectif)).toBe(false);
		expect(correspondNettement(motsDe('le'), objectif)).toBe(true);
		expect(correspondNettement(motsDe('réfondre lots'), objectif)).toBe(true);
		expect(correspondNettement(motsDe('stocks csv'), objectif)).toBe(false);
		expect(correspondNettement([], objectif)).toBe(false);
	});
});

describe('palette : un seul classement, celui du moteur', () => {
	it('sans texte : les sessions vivantes ; avec : celles qui correspondent nettement, en tête, les terminées après les vivantes', () => {
		expect(cles({ q: '' })).toEqual(['s:a', 's:b']);
		expect(cles({ moteur: [] })).toEqual(['s:a']);
		const terminee = session('d', 'Ancienne refonte des stocks', { etat: 'terminee' });
		expect(cles({ moteur: [], sessions: [terminee, ...SESSIONS] })).toEqual(['s:a', 's:d']);
		expect(cles({ q: '', sessions: [terminee, ...SESSIONS] })).toEqual(['s:a', 's:b']);
	});

	it('avant la réponse du moteur : les fiches au titre correspondant (provisoires) ; après : l’ordre du moteur seul', () => {
		expect(cles({})).toEqual(['s:a', 'f:projets/erp-saas/Module stocks.md', 'f:sources/cdc-stocks.md']);
		const moteur = [trouve('notes/a.md#^f-0001'), trouve('projets/erp-saas/Module stocks.md'), trouve('notes/b.md')];
		expect(cles({ moteur })).toEqual(['s:a', 'f:notes/a.md', 'f:projets/erp-saas/Module stocks.md', 'f:notes/b.md']);
	});

	it('éléments d’une même fiche regroupés sous elle, au rang du premier ; la fiche en tête du groupe si le moteur l’a rendue', () => {
		const moteur = [trouve('notes/a.md#^f-0001'), trouve('notes/b.md'), trouve('notes/a.md'), trouve('notes/a.md#^f-0002'), trouve('notes/a.md#^f-0001')];
		const r = resultatsPalette(base({ moteur, filtre: 'fiches' })).resultats;
		expect(r.map((x) => x.cle)).toEqual(['f:notes/a.md', 'f:notes/b.md']);
		const a = r[0]!;
		if (a.genre !== 'trouve') throw new Error('trouve attendu');
		expect(a.trouve.id).toBe('notes/a.md');
		expect(a.rattaches.map((x) => x.id)).toEqual(['notes/a.md#^f-0001', 'notes/a.md#^f-0002']);
	});

	it('filtres : le moteur reçoit genre et dossier (il filtre lui-même) ; les provisoires sont filtrés ici', () => {
		const moteur = [trouve('projets/erp-saas/Module stocks.md'), trouve('projets/site/Accueil.md')];
		expect(cles({ moteur, filtre: 'sessions' })).toEqual(['s:a']);
		expect(cles({ moteur, filtre: 'fiches' })).toEqual(['f:projets/erp-saas/Module stocks.md', 'f:projets/site/Accueil.md']);
		expect(cles({ filtre: 'documents' })).toEqual(['f:sources/cdc-stocks.md']);
		expect(cles({ filtre: 'fiches' })).toEqual(['f:projets/erp-saas/Module stocks.md']);
		const projet = { projet: 'site', position: 'projets/site' };
		expect(cles({ q: '', projet })).toEqual(['s:b']);
		expect(cles({ projet })).toEqual([]);
		expect(demandeAuMoteur('tout', null)).toEqual({ dossier: null, genre: null });
		expect(demandeAuMoteur('fiches', projet)).toEqual({ dossier: 'projets/site', genre: 'fiche' });
		expect(demandeAuMoteur('documents', null)).toEqual({ dossier: null, genre: 'document' });
		expect(projetUtilisable('documents')).toBe(false);
		expect(projetUtilisable('fiches')).toBe(true);
	});

	it('projet d’une fiche ouverte : celui que le service rend avec la fiche, jamais tiré du chemin', () => {
		expect(projetDeFiche({ projet: { projet: 'Acme', position: 'travail/acme' } })).toEqual({ projet: 'Acme', position: 'travail/acme' });
		expect(projetDeFiche({ projet: null })).toBeNull();
		expect(projetDeFiche(undefined)).toBeNull();
	});

	it('« Ce projet » porté par une fiche simple (position en .md) : la fiche elle-même en fait partie', () => {
		const projet = { projet: 'transport', position: 'projets/transport.md' };
		const fiches = [{ ...FICHES[0]!, chemin: 'projets/transport.md', titre: 'Module stocks transport' }, { ...FICHES[0]!, chemin: 'projets/transportbis.md', titre: 'Module stocks bis' }];
		expect(resultatsPalette(base({ projet, fiches, sessions: [] })).resultats.map((r) => r.cle)).toEqual(['f:projets/transport.md']);
	});
});

describe('palette : listes coupées', () => {
	const vivantes = Array.from({ length: SESSIONS_MAX + 3 }, (_, i) => session(`v${i}`, `Stocks lot ${i}`));
	const fiches = Array.from({ length: TROUVES_MAX + 4 }, (_, i) => trouve(`notes/n${i}.md`));
	it('« enPlus » compte ce que les bornes cachent ; `tout` montre tout', () => {
		expect(resultatsPalette(base({ sessions: vivantes, moteur: fiches })).enPlus).toBe(3 + 4);
		const tout = resultatsPalette(base({ sessions: vivantes, moteur: fiches, tout: true }));
		expect(tout.enPlus).toBe(0);
		expect(tout.resultats).toHaveLength(SESSIONS_MAX + 3 + TROUVES_MAX + 4);
		expect(resultatsPalette(base({})).enPlus).toBe(0);
	});
});
