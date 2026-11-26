import type { LigneInit } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { appliquerLigne, decoupeurLignes, fractionPiece, installationVide, lireLigneInit, LONGUEUR_MAX_LIGNE, peutTerminer, type EtatInstallation } from '../../src/domaine/assistant-lignes.ts';

const json = (o: unknown) => JSON.stringify(o);

describe('lecture d’une ligne de « mnemo init --json »', () => {
	it('événement, progression, fin : rendus sans les champs inconnus', () => {
		expect(lireLigneInit(json({ etape: 'memoire', etat: 'debut', message: 'Dossier Mnemo : /srv/exemple', autre: 1 }))).toEqual({ etape: 'memoire', etat: 'debut', message: 'Dossier Mnemo : /srv/exemple' });
		expect(lireLigneInit(`  ${json({ etape: 'modeles', etat: 'progression', piece: 'moteur', libelle: 'Moteur', recu: 10, total: null })}\r`)).toEqual({ etape: 'modeles', etat: 'progression', piece: 'moteur', libelle: 'Moteur', recu: 10, total: null });
		expect(lireLigneInit(json({ fin: true, racine: '/srv/exemple', ok: false }))).toEqual({ fin: true, racine: '/srv/exemple', ok: false });
	});

	it('ligne invalide : null, jamais d’exception', () => {
		const invalides = [
			'',
			'   ',
			'pas du JSON',
			'[1,2]',
			'null',
			'"texte"',
			json({ etape: 'inconnue', etat: 'fait', message: '' }),
			json({ etape: 'mcp', etat: 'progression', message: '' }),
			json({ etape: 'mcp', etat: 'fait' }),
			json({ etape: 'mcp', etat: 'fini', message: 'x' }),
			json({ etape: 'modeles', etat: 'progression', piece: '', libelle: 'x', recu: 1, total: 2 }),
			json({ etape: 'modeles', etat: 'progression', piece: 'p', libelle: 'x', recu: -1, total: 2 }),
			json({ etape: 'modeles', etat: 'progression', piece: 'p', libelle: 'x', recu: 1, total: '2' }),
			json({ etape: 'modeles', etat: 'progression', piece: 'p', libelle: 'x', recu: 1 }),
			json({ fin: true, racine: '', ok: true }),
			json({ fin: true, racine: '/r', ok: 'oui' }),
			json({ fin: 1, racine: '/r', ok: true }),
			json({ etape: 'mcp', etat: 'fait', message: 'x'.repeat(LONGUEUR_MAX_LIGNE) }),
		];
		for (const ligne of invalides) expect(lireLigneInit(ligne), ligne.slice(0, 80)).toBeNull();
	});
});

describe('découpage du flux en lignes', () => {
	it('morceaux coupés n’importe où, CRLF, dernière ligne sans fin de ligne', () => {
		const d = decoupeurLignes();
		expect(d.ajouter('{"a":')).toEqual([]);
		expect(d.ajouter('1}\r\n{"b"')).toEqual(['{"a":1}']);
		expect(d.ajouter(':2}\n\n')).toEqual(['{"b":2}', '']);
		expect(d.ajouter('fin')).toEqual([]);
		expect(d.finir()).toEqual(['fin']);
		expect(d.finir()).toEqual([]);
	});

	it('une ligne démesurée est jetée jusqu’à sa fin, la suivante est lue', () => {
		const d = decoupeurLignes();
		expect(d.ajouter('x'.repeat(LONGUEUR_MAX_LIGNE + 1))).toEqual([]);
		expect(d.ajouter('encore\nsuite\n')).toEqual(['suite']);
		d.ajouter('y'.repeat(LONGUEUR_MAX_LIGNE + 1));
		expect(d.finir()).toEqual([]);
	});
});

const appliquer = (lignes: LigneInit[], depart: EtatInstallation = installationVide()) => lignes.reduce(appliquerLigne, depart);
const progression = (piece: string, recu: number, total: number | null): LigneInit => ({ etape: 'modeles', etat: 'progression', piece, libelle: `Pièce ${piece}`, recu, total });

describe('suivi de l’installation', () => {
	it('quatre étapes en attente au départ ; chaque événement met son étape à jour ; le lanceur n’est pas montré', () => {
		const vide = installationVide();
		expect(vide.etapes.map((e) => [e.etape, e.etat])).toEqual([['memoire', 'attente'], ['mcp', 'attente'], ['modeles', 'attente'], ['commande', 'attente']]);
		const i = appliquer([
			{ etape: 'memoire', etat: 'debut', message: 'Dossier' },
			{ etape: 'memoire', etat: 'fait', message: 'Mémoire créée.' },
			{ etape: 'mcp', etat: 'echec', message: 'claude absent' },
			{ etape: 'lanceur', etat: 'saute', message: 'non' },
		]);
		expect(i.etapes.map((e) => [e.etape, e.etat, e.message])).toEqual([
			['memoire', 'fait', 'Mémoire créée.'],
			['mcp', 'echec', 'claude absent'],
			['modeles', 'attente', ''],
			['commande', 'attente', ''],
		]);
	});

	it('une barre par pièce : la suivante remplit la précédente ; modèles faits : toutes pleines', () => {
		let i = appliquer([progression('moteur', 10, 100), progression('moteur', 50, 100)]);
		expect(i.pieces).toEqual([{ piece: 'moteur', libelle: 'Pièce moteur', recu: 50, total: 100, finie: false }]);
		expect(fractionPiece(i.pieces[0]!)).toBe(0.5);
		// la dernière progression de « moteur » a manqué : sa barre est remplie quand « sens » commence
		i = appliquer([progression('sens', 5, null)], i);
		expect(i.pieces.map((p) => [p.piece, p.finie, fractionPiece(p)])).toEqual([['moteur', true, 1], ['sens', false, null]]);
		i = appliquer([progression('sens', 9, null), { etape: 'modeles', etat: 'fait', message: 'Modèles installés.' }], i);
		expect(i.pieces.map((p) => [p.piece, p.recu, fractionPiece(p)])).toEqual([['moteur', 50, 1], ['sens', 9, 1]]);
	});

	it('fraction : taille nulle indéterminée, dépassement borné à 1', () => {
		const p = { piece: 'p', libelle: 'P', recu: 10, total: 0, finie: false };
		expect(fractionPiece(p)).toBeNull();
		expect(fractionPiece({ ...p, total: 5 })).toBe(1);
	});

	it('modèles en échec : les barres restent où elles en sont', () => {
		const i = appliquer([progression('moteur', 10, 100), { etape: 'modeles', etat: 'echec', message: 'réseau' }]);
		expect(i.pieces[0]!.finie).toBe(false);
	});

	it('terminer : seulement fini, avec la ligne de fin et la mémoire faite', () => {
		const fin: LigneInit = { fin: true, racine: '/srv/exemple', ok: false };
		const memoire: LigneInit = { etape: 'memoire', etat: 'fait', message: 'ok' };
		expect(peutTerminer({ ...appliquer([memoire, fin]), enCours: false })).toBe(true);
		expect(peutTerminer(appliquer([memoire, fin]))).toBe(false);
		expect(peutTerminer({ ...appliquer([memoire]), enCours: false })).toBe(false);
		expect(peutTerminer({ ...appliquer([{ etape: 'memoire', etat: 'echec', message: 'non' }, fin]), enCours: false })).toBe(false);
	});
});
