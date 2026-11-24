import { describe, expect, it } from 'vitest';
import { entretenir } from '../../src/application/entretenir.ts';
import type { DemandeLot } from '../../src/application/entretenir.ts';
import { LOTS_EN_ATTENTE_MAX, lotsEnAttente, rejeterLot, validerLot } from '../../src/application/lots.ts';
import { proposer } from '../../src/application/proposer.ts';
import { presenterLotPropose } from '../../src/application/presenter.ts';
import { demandeDEntretien, validerArguments } from '../../src/application/validation.ts';
import { empreinte } from '../../src/domaine/empreinte.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { faitDe, fiche, ligne, remplir } from '../aides/memoire-lots.ts';

function memoire() {
	const dep = fauxPorts();
	remplir(dep);
	return dep;
}

const ACME = 'clients/acme.md';
const lot = (genre: DemandeLot['genre'], lignes: DemandeLot['lignes'], id = ACME): DemandeLot => ({ action: 'proposer_lot', id, genre, lignes, motif: 'Doublons de la note A' });

async function proposerLot(dep: ReturnType<typeof memoire>, demande: DemandeLot): Promise<string> {
	const r = await entretenir(dep, demande);
	if (r.statut !== 'lot_propose') throw new Error(`lot refusé : ${'motif' in r ? r.motif : r.statut}`);
	return r.lot;
}

describe('proposer_lot (archiviste) : enregistré, jamais appliqué', () => {
	it('rien n\'est écrit ni commité ; le lot attend avec ses ancres nues et l\'empreinte de la fiche', async () => {
		const dep = memoire();
		const avant = new Map(dep.fichiers);
		const r = await entretenir(dep, lot('fusionner', [{ garder: '^f-0001', absorber: ['clients/acme.md#^f-0002', 'f-0003'] }]));
		expect(r).toMatchObject({ statut: 'lot_propose', fiche: ACME, genre: 'fusionner', lignes: 1, decides: [] });
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toEqual([]);
		const [enAttente] = await dep.lots.enAttente();
		expect(enAttente).toMatchObject({ genre: 'fusionner', fiche: ACME, lignes: [{ garder: 'f-0001', absorber: ['f-0002', 'f-0003'] }], motif: 'Doublons de la note A', empreinte: empreinte(avant.get(ACME)!), session: null });
	});

	it('refuse : ancre absente, information barrée (fusion), pas à confirmer, ancre nommée deux fois, consigne, motif vide, information déjà dans un lot en attente', async () => {
		const dep = memoire();
		const motif = async (d: DemandeLot) => {
			const r = await entretenir(dep, d);
			return r.statut === 'refuse' ? r.motif : r.statut;
		};
		expect(await motif(lot('supprimer', [{ ancre: 'f-0099' }]))).toContain('^f-0099 n\'existe pas');
		expect(await motif(lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0004'] }]))).toContain('barrée');
		expect(await motif(lot('confirmer', [{ ancre: 'f-0001' }]))).toContain('n\'est pas à confirmer');
		expect(await motif(lot('supprimer', [{ ancre: 'f-0001' }, { ancre: 'f-0001' }]))).toContain('déjà nommée');
		expect(await motif(lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0002'] }, { garder: 'f-0003', absorber: ['f-0002'] }]))).toContain('déjà nommée');
		expect(await motif(lot('fusionner', [{ garder: 'f-0007', absorber: ['f-0006'] }]))).toContain('contradiction à confirmer');
		expect(await motif(lot('confirmer', [{ ancre: 'f-0001' }], 'consignes/regle.md'))).toContain('consigne');
		expect(await motif({ ...lot('supprimer', [{ ancre: 'f-0001' }]), motif: '  ' })).toContain('motif est vide');
		// une information à confirmer qui contredit une supprimée : la contradiction est à trancher d'abord
		expect(await motif(lot('supprimer', [{ ancre: 'f-0007' }]))).toContain('tranche d\'abord');
		expect(await dep.lots.enAttente()).toEqual([]);
		await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		expect(await motif(lot('confirmer', [{ ancre: 'f-0005' }]))).toContain('vise déjà ^f-0005');
		expect(dep.commits).toEqual([]);
	});

	it('forme de l\'outil : { garder, absorber } pour fusionner, { ancre } sinon ; « #… » refusé dans `id`', () => {
		const a = (brut: Record<string, unknown>) => {
			const v = validerArguments('entretenir', { action: 'proposer_lot', id: ACME, motif: 'm', ...brut });
			if (!v.ok) return v.motif;
			const d = demandeDEntretien(v.valeur);
			return d.ok ? d.valeur : d.motif;
		};
		expect(a({ genre: 'fusionner', lignes: [{ garder: 'f-0001', absorber: ['f-0002'] }] })).toEqual({ action: 'proposer_lot', id: ACME, genre: 'fusionner', lignes: [{ garder: 'f-0001', absorber: ['f-0002'] }], motif: 'm' });
		expect(a({ genre: 'supprimer', lignes: [{ ancre: 'f-0001' }] })).toEqual({ action: 'proposer_lot', id: ACME, genre: 'supprimer', lignes: [{ ancre: 'f-0001' }], motif: 'm' });
		expect(a({ genre: 'fusionner', lignes: [{ ancre: 'f-0001' }] })).toContain('{ garder, absorber } attendu');
		expect(a({ genre: 'confirmer', lignes: [{ garder: 'f-0001', absorber: ['f-0002'] }] })).toContain('{ ancre } attendu');
		expect(a({ genre: 'supprimer', lignes: [] })).toContain('de 1 à');
		expect(a({ genre: 'supprimer', lignes: [{ ancre: 'f-0001', autre: 1 }] })).toContain('champ inconnu « lignes[0].autre »');
		expect(a({ genre: 'supprimer', lignes: ['f-0001'] })).toContain('objet attendu');
		expect(a({ genre: 'supprimer' })).toContain('« lignes » : obligatoire');
		expect(a({ genre: 'supprimer', lignes: [{ ancre: 'f-0001' }], ancre: 'f-0001' })).toContain('sans objet');
	});

	it('« #… » dans `id` : le refus nomme le champ de l\'action (ancres, lignes, ancre)', () => {
		const motif = (d: Parameters<typeof demandeDEntretien>[0]) => {
			const r = demandeDEntretien(d);
			return r.ok ? '' : r.motif;
		};
		const id = `${ACME}#^f-0001`;
		expect(motif({ action: 'deplacer_informations', id, ancres: ['f-0001'], dans: 'clients/lyon.md' })).toContain('les informations dans `ancres`');
		expect(motif({ action: 'proposer_lot', id, genre: 'supprimer', lignes: [{ ancre: 'f-0001' }], motif: 'm' })).toContain('les informations dans `lignes`');
		expect(motif({ action: 'corroborer', id, ancre: 'f-0001', source: { ref: 'utilisateur', type: 'utilisateur' } })).toContain('l\'information dans `ancre`');
		expect(motif({ action: 'retoucher_information', id, ancre: 'f-0001', texte: 'x' })).toContain('l\'information dans `ancre`');
		expect(motif({ action: 'supprimer', id })).toContain('fiche entière');
	});
});

describe('valider un lot (utilisateur)', () => {
	it('fusionner : sources et citations des absorbées versées à la gardée, une même référence une fois, confiance recalculée ; renvois et liens vers la gardée ; un commit', async () => {
		const dep = memoire();
		const id = await proposerLot(dep, lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0002', 'f-0003'] }]));
		const r = await validerLot(dep, id, [0]);
		expect(r).toMatchObject({ statut: 'valide', lot: id, fiche: ACME, lignes: [0] });
		const acme = dep.fichiers.get(ACME)!;
		// f-0002 (email, 70 %) s'ajoute à f-0001 (inconnue, 30 %) : 1 − 0,7 × 0,3 = 79 % ; f-0003 cite le même document que f-0001
		expect(acme).toContain([
			'- Le client est Acme | declare | src: [[sources/a]] | appris 2026-11-01 | confiance 79 % ^f-0001',
			'  > « Acme, notre client »',
			'  + src: [[sources/m]] | corroboré 2026-11-22',
			'  > « Acme client »',
		].join('\n'));
		expect(acme).not.toContain('^f-0002\n');
		expect(acme).not.toContain('Le client est bien Acme');
		expect(acme).not.toContain('sources/a.md');
		// la barrée invalidée par une absorbée l'est désormais par la gardée
		expect(faitDe(acme, 'f-0004')).toMatchObject({ barre: true, invalideLe: '2026-11-02', invalidePar: 'f-0001' });
		for (const n of [5, 6, 7]) expect(acme).toContain(ligne(n));
		expect(dep.fichiers.get('clients/lyon.md')).toContain('Voir [[clients/acme#^f-0001]], [[Acme#^f-0006|budget]]');
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: fusionne 1 information clients/acme.md']);
		expect(await dep.lots.enAttente()).toEqual([]);
		expect(await dep.lots.decides(-1, 10)).toMatchObject([{ id, decision: { sort: 'valide', lignes: [0], commit: 'c000001' } }]);
	});

	it('fusionner : une absorbée dont une source est déjà là n\'ajoute que la nouvelle, avec sa confiance seule (pas la sienne cumulée)', async () => {
		const dep = memoire();
		const id = await proposerLot(dep, lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0008'] }]));
		expect((await validerLot(dep, id, [0])).statut).toBe('valide');
		const gardee = faitDe(dep.fichiers.get(ACME)!, 'f-0001')!;
		// [[sources/a]] déjà là ; [[sources/n]] (note, 60 %) : 1 − 0,7 × 0,4 = 72 % (et non 1 − 0,7 × 0,21 avec ses 79 %)
		expect(gardee.confiance).toBe(72);
		expect(gardee.corroborations).toEqual([{ source: '[[sources/n]]', le: '2026-11-10' }]);
		expect(faitDe(dep.fichiers.get(ACME)!, 'f-0008')).toBeUndefined();
	});

	it('validé en partie : seules les lignes cochées s\'appliquent, en un commit ; un lien vers une supprimée perd son ancre', async () => {
		const dep = memoire();
		const id = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }, { ancre: 'f-0006' }]));
		const r = await validerLot(dep, id, [1]);
		expect(r).toMatchObject({ statut: 'valide', lignes: [1] });
		const acme = dep.fichiers.get(ACME)!;
		expect(acme).toContain(ligne(5));
		expect(acme).not.toContain('Budget de 1200');
		// f-0007 reste telle quelle : seule f-0006 la contredisait
		expect(acme).toContain(ligne(7));
		const lyon = dep.fichiers.get('clients/lyon.md')!;
		expect(lyon).toContain('[[clients/acme|budget]]');
		expect(lyon).not.toContain('f-0006');
		expect(lyon).toContain('[[clients/acme.md#^f-0005]]');
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: supprime 1 information clients/acme.md']);
	});

	it('supprimer l\'information qui en a barré une autre : la barrée reste, sans renvoi vers rien', async () => {
		const dep = memoire();
		const id = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0002' }]));
		expect((await validerLot(dep, id, [0])).statut).toBe('valide');
		const acme = dep.fichiers.get(ACME)!;
		expect(faitDe(acme, 'f-0004')).toMatchObject({ barre: true, invalideLe: '2026-11-02' });
		expect(faitDe(acme, 'f-0004')!.invalidePar).toBeUndefined();
		expect(acme).not.toContain('^f-0002');
		expect(dep.fichiers.get('clients/lyon.md')).toContain('Voir [[clients/acme]], ');
	});

	it('confirmer : même effet que Confirmer (`proposer`, genre confirmer, par l\'utilisateur)', async () => {
		const parLot = memoire();
		const id = await proposerLot(parLot, lot('confirmer', [{ ancre: 'f-0006' }]));
		expect((await validerLot(parLot, id, [0])).statut).toBe('valide');
		const direct = memoire();
		expect((await proposer(direct, { genre: 'confirmer', fiche: ACME, ancre: 'f-0006' }, { appliquerDirectement: true })).statut).toBe('ecrit');
		expect(parLot.fichiers.get(ACME)).toBe(direct.fichiers.get(ACME));
		expect(faitDe(parLot.fichiers.get(ACME)!, 'f-0007')).toMatchObject({ barre: true, invalidePar: 'f-0006' });
		expect(parLot.commits.map((c) => c.message)).toEqual(['mnemo: confirme 1 information clients/acme.md']);
	});

	it('la fiche a changé depuis la proposition : refusé, rien n\'écrit, le lot est écarté (périmé)', async () => {
		const dep = memoire();
		const id = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		dep.fichiers.set(ACME, `${dep.fichiers.get(ACME)!}- Une nouvelle | declare | src: utilisateur ^f-0009\n`);
		const avant = dep.fichiers.get(ACME);
		expect(await validerLot(dep, id, [0])).toMatchObject({ statut: 'perime' });
		expect(dep.fichiers.get(ACME)).toBe(avant);
		expect(dep.commits).toEqual([]);
		expect(await dep.lots.enAttente()).toEqual([]);
		expect(await validerLot(dep, id, [0])).toMatchObject({ statut: 'inconnu' });
	});

	it('la plus haute ancre retirée par un lot (suppression ou fusion) n\'est jamais redonnée', async () => {
		for (const genre of ['supprimer', 'fusionner'] as const) {
			const dep = memoire();
			const id = await proposerLot(dep, genre === 'supprimer' ? lot('supprimer', [{ ancre: 'f-0008' }]) : lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0008'] }]));
			expect((await validerLot(dep, id, [0])).statut).toBe('valide');
			expect(dep.fichiers.get(ACME)).toContain('ancre_max: 8');
			const r = await proposer(dep, { genre: 'fait', fiche: ACME, texte: 'Acme a un nouveau directeur', nature: 'declare', source: { ref: 'utilisateur', type: 'utilisateur' }, apresProches: true });
			expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0009' });
		}
	});

	it('une information au texte long (450 caractères) et à mentions se confirme, se garde dans une fusion et se supprime : seules les lignes versées sont bornées', async () => {
		const dep = memoire();
		const long = (n: number) => `${'Texte long '.repeat(41)}${n}`;
		const LONG = 'clients/long.md';
		dep.fichiers.set(LONG, fiche('organisation', 'Long', `\nUne fiche aux informations longues.\n\n## Informations\n${[
			`- ${long(1)} | declare | src: [[sources/a]] | appris 2026-11-01 | a confirmer ^f-0001`,
			`- ${long(2)} | declare | src: [[sources/a]] | appris 2026-11-01 ^f-0002`,
			'- Doublon court | declare | src: [[sources/m]] ^f-0003',
			`- ${long(4)} | declare | src: [[sources/a]] | appris 2026-11-01 ^f-0004`,
		].join('\n')}\n`));
		expect(long(1).length).toBeLessThanOrEqual(500);
		const valider = async (demande: DemandeLot) => (await validerLot(dep, await proposerLot(dep, demande), [0])).statut;
		expect(await valider(lot('confirmer', [{ ancre: 'f-0001' }], LONG))).toBe('valide');
		expect(faitDe(dep.fichiers.get(LONG)!, 'f-0001')).toMatchObject({ texte: long(1), aConfirmer: false });
		expect(await valider(lot('fusionner', [{ garder: 'f-0002', absorber: ['f-0003'] }], LONG))).toBe('valide');
		expect(faitDe(dep.fichiers.get(LONG)!, 'f-0002')).toMatchObject({ texte: long(2), corroborations: [{ source: '[[sources/m]]', le: '2026-11-22' }] });
		expect(faitDe(dep.fichiers.get(LONG)!, 'f-0003')).toBeUndefined();
		expect(await valider(lot('supprimer', [{ ancre: 'f-0004' }], LONG))).toBe('valide');
		expect(faitDe(dep.fichiers.get(LONG)!, 'f-0004')).toBeUndefined();
	});

	it('fusionner : deux relations vers l\'absorbée et la gardée n\'en font plus qu\'une', async () => {
		const dep = memoire();
		dep.fichiers.set('clients/paris.md', fiche('organisation', 'Site de Paris', '\nLe site parisien.\n\n## Relations\n- concerne [[clients/acme#^f-0002]]\n- concerne [[clients/acme#^f-0001]]\n'));
		const id = await proposerLot(dep, lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0002'] }]));
		expect((await validerLot(dep, id, [0])).statut).toBe('valide');
		const paris = dep.fichiers.get('clients/paris.md')!;
		expect(lireFiche('clients/paris.md', paris).relations).toEqual([{ verbe: 'concerne', cible: 'clients/acme#^f-0001' }]);
		expect(paris).not.toContain('f-0002');
	});

	it('choix invalide (vide, en double, hors du lot) : refusé, le lot reste en attente', async () => {
		const dep = memoire();
		const id = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		for (const choix of [[], [0, 0], [1], [-1], [0.5]]) expect((await validerLot(dep, id, choix)).statut).toBe('refuse');
		expect(dep.commits).toEqual([]);
		expect(await dep.lots.enAttente()).toHaveLength(1);
	});
});

describe('lots en attente, rejet, sort rendu à l\'archiviste', () => {
	it('chaque ligne se revoit : avant (telles qu\'écrites), après (la gardée avec ses sources, la confirmée) ; périmé si la fiche a changé', async () => {
		const dep = memoire();
		const fusion = await proposerLot(dep, lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0002'] }]));
		await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		const [l1, l2] = await lotsEnAttente(dep);
		expect(l1).toMatchObject({ id: fusion, genre: 'fusionner', fiche: ACME, titre: 'Acme', motif: 'Doublons de la note A', perime: false, session: null });
		expect(l1!.lignes).toEqual([
			{
				indice: 0,
				ligne: { garder: 'f-0001', absorber: ['f-0002'] },
				avant: [
					{ ancre: 'f-0001', lignes: [ligne(1), '  > « Acme, notre client »'] },
					{ ancre: 'f-0002', lignes: [ligne(2), '  > « Acme client »'] },
				],
				apres: {
					ancre: 'f-0001',
					lignes: ['- Le client est Acme | declare | src: [[sources/a]] | appris 2026-11-01 | confiance 79 % ^f-0001', '  > « Acme, notre client »', '  + src: [[sources/m]] | corroboré 2026-11-22', '  > « Acme client »'],
				},
				motif: null,
			},
		]);
		expect(l2!.lignes).toEqual([{ indice: 0, ligne: { ancre: 'f-0005' }, avant: [{ ancre: 'f-0005', lignes: [ligne(5)] }], apres: null, motif: null }]);
		dep.fichiers.set(ACME, `${dep.fichiers.get(ACME)!}\n`);
		expect((await lotsEnAttente(dep)).map((l) => l.perime)).toEqual([true, true]);
	});

	it('rejeter : le lot disparaît, rien n\'est écrit ; l\'archiviste voit le sort de ses lots à sa proposition suivante', async () => {
		const dep = memoire();
		const rejete = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		const valide = await proposerLot(dep, lot('confirmer', [{ ancre: 'f-0006' }]));
		expect(await rejeterLot(dep, rejete)).toBe(true);
		expect(await rejeterLot(dep, rejete)).toBe(false);
		expect(dep.commits).toEqual([]);
		expect((await validerLot(dep, valide, [0])).statut).toBe('valide');
		const r = await entretenir(dep, lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0002'] }]));
		expect(r).toMatchObject({ statut: 'lot_propose' });
		if (r.statut !== 'lot_propose') return;
		expect(r.decides.map((l) => [l.id, l.decision.sort])).toEqual([
			[valide, 'valide'],
			[rejete, 'rejete'],
		]);
		const texte = presenterLotPropose(r);
		expect(texte).toContain(`lot ${rejete} (supprimer, clients/acme.md) : rejeté`);
		expect(texte).toContain(`lot ${valide} (confirmer, clients/acme.md) : validé, 1/1 ligne(s), commit c000001`);
	});
});

describe('revue : lots périmés, plafonds, contradictions, avertissements', () => {
	it('un lot en attente proposé sur un autre texte de la fiche ne bloque plus : il est écarté à la proposition suivante', async () => {
		const dep = memoire();
		const ancien = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		dep.fichiers.set(ACME, `${dep.fichiers.get(ACME)!}\n`);
		const r = await entretenir(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		expect(r).toMatchObject({ statut: 'lot_propose' });
		if (r.statut !== 'lot_propose') return;
		expect(r.decides.map((l) => [l.id, l.decision.sort])).toEqual([[ancien, 'perime']]);
		expect((await dep.lots.enAttente()).map((l) => l.id)).toEqual([r.lot]);
	});

	it(`au plus ${LOTS_EN_ATTENTE_MAX} lots en attente : au-delà, la proposition est refusée`, async () => {
		const dep = memoire();
		for (let i = 0; i < LOTS_EN_ATTENTE_MAX; i++) {
			await dep.lots.enregistrer({ id: `L${i}`, genre: 'supprimer', fiche: 'clients/lyon.md', lignes: [{ ancre: 'f-0001' }], motif: 'm', empreinte: empreinte(dep.fichiers.get('clients/lyon.md')!), proposeMs: i, session: null });
		}
		const r = await entretenir(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		expect(r).toMatchObject({ statut: 'refuse' });
		expect('motif' in r ? r.motif : '').toContain(`${LOTS_EN_ATTENTE_MAX} au plus`);
	});

	it('validé en partie : refusé si une information vivante à confirmer contredirait une supprimée ; le lot reste', async () => {
		const dep = memoire();
		const id = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0007' }, { ancre: 'f-0006' }]));
		const r = await validerLot(dep, id, [0]);
		expect(r).toMatchObject({ statut: 'refuse' });
		expect('motif' in r ? r.motif : '').toContain('tranche d\'abord');
		expect(dep.commits).toEqual([]);
		expect(await dep.lots.enAttente()).toHaveLength(1);
		expect((await validerLot(dep, id, [0, 1])).statut).toBe('valide');
	});

	it('deux lots sur une fiche : valider l\'un rend l\'autre périmé', async () => {
		const dep = memoire();
		const a = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		const b = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0002' }]));
		expect((await validerLot(dep, a, [0])).statut).toBe('valide');
		expect(await validerLot(dep, b, [0])).toMatchObject({ statut: 'perime' });
		expect(dep.commits).toHaveLength(1);
		expect(await dep.lots.enAttente()).toEqual([]);
	});

	it('fiche supprimée depuis la proposition : périmé, rien n\'écrit', async () => {
		const dep = memoire();
		const id = await proposerLot(dep, lot('supprimer', [{ ancre: 'f-0005' }]));
		dep.fichiers.delete(ACME);
		expect(await validerLot(dep, id, [0])).toMatchObject({ statut: 'perime' });
		expect(dep.commits).toEqual([]);
	});

	it('confirmer deux informations qui se contredisent : refusé (une seule se confirme) ; fusion d\'une confirmée dans une à confirmer : refusée', async () => {
		const dep = memoire();
		dep.fichiers.set('clients/budget.md', fiche('sujet', 'Budget', `\nLe budget.\n\n## Informations\n${[
			'- Budget A | declare | src: utilisateur | a confirmer | contredit ^f-0002 ^f-0001',
			'- Budget B | declare | src: utilisateur | a confirmer | contredit ^f-0001 ^f-0002',
		].join('\n')}\n`));
		const r = await entretenir(dep, lot('confirmer', [{ ancre: 'f-0001' }, { ancre: 'f-0002' }], 'clients/budget.md'));
		expect(r).toMatchObject({ statut: 'refuse' });
		expect('motif' in r ? r.motif : '').toContain('ne confirme que l\'une des deux');
		const f = await entretenir(dep, lot('fusionner', [{ garder: 'f-0005', absorber: ['f-0001'] }]));
		expect('motif' in f ? f.motif : '').toContain('garde plutôt la confirmée');
		expect(await dep.lots.enAttente()).toEqual([]);
	});

	it('liens réécrits dans une consigne : signalés en avertissement', async () => {
		const dep = memoire();
		dep.fichiers.set('consignes/regle.md', fiche('consigne', 'Règle', '\nVoir [[clients/acme#^f-0002]].\n'));
		const id = await proposerLot(dep, lot('fusionner', [{ garder: 'f-0001', absorber: ['f-0002'] }]));
		const r = await validerLot(dep, id, [0]);
		expect(r).toMatchObject({ statut: 'valide', avertissements: ['à signaler à l\'utilisateur : liens réécrits dans consignes/regle.md'] });
		expect(dep.fichiers.get('consignes/regle.md')).toContain('[[clients/acme#^f-0001]]');
	});
});
