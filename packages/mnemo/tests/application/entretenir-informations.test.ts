import { describe, expect, it } from 'vitest';
import { entretenir } from '../../src/application/entretenir.ts';
import { cleDeSource } from '../../src/application/entretien/sources-du-fait.ts';
import { demandeDEntretien } from '../../src/application/validation.ts';
import { lireFait } from '../../src/domaine/fait.ts';
import type { Fait } from '../../src/domaine/fait.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, corps = '', extra = '') =>
	`---\nid: 01${titre.toUpperCase().replace(/[^A-Z]/gu, '')}\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n# ${titre}\n${corps}`;

const INFORMATIONS = [
	'- [projet] Le client est Acme | declare | src: [[sources/a]] | appris 2026-11-01 | confiance 30 % ^f-0001',
	'  > « Acme, notre client »',
	'- Marie préfère les appels | observe | src: utilisateur | appris 2026-11-01 | confiance 85 % ^f-0002',
	'- Le siège est à Lyon | declare | src: [[sources/a]] ^f-0003',
	'- ~~Le siège est à Paris~~ | declare | src: [[sources/a]] | confiance 30 % | invalidé 2026-11-02 par ^f-0003 ^f-0004',
	'- [montant] Budget de 1200 € | declare | src: utilisateur | confiance 100 % ^f-0005',
	'- Le siège est à Lyon 3e | declare | src: [[sources/m]] | confiance 70 % | a confirmer | contredit ^f-0003 ^f-0007',
	'- Le contact s\'appelle Corbano | declare | src: [[sources/a]] | confiance 30 % ^f-0006',
].join('\n');

function memoire() {
	const dep = fauxPorts();
	dep.fichiers.set('sources/sources.md', fiche('dossier', 'Sources'));
	dep.fichiers.set('sources/a.md', fiche('source', 'Note A', '\nUn document.\n', 'type_source: inconnue\n'));
	dep.fichiers.set('sources/m.md', fiche('source', 'Mail M', '\nUn courriel.\n', 'type_source: email\n'));
	dep.fichiers.set('clients/acme.md', fiche('organisation', 'Acme', `\nLe client Acme.\n\n## Informations\n${INFORMATIONS}\n`));
	dep.fichiers.set('consignes/regle.md', fiche('consigne', 'Règle', '\n## Informations\n- Toujours vouvoyer | declare | src: utilisateur ^f-0001\n'));
	return dep;
}

function faitDe(texte: string, ancre: string): Fait {
	const f = lireFiche('clients/acme.md', texte);
	for (const ligne of f.faits) if ('fait' in ligne && ligne.fait.ancre === ancre) return ligne.fait;
	throw new Error(`pas de ^${ancre}`);
}

describe('entretenir : corroborer', () => {
	it('ajoute une corroboration datée sous la citation, confiance cumulée (0,3 et 0,3 → 51 %), un commit, fiche de source créée', async () => {
		const dep = memoire();
		const r = await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0001', source: { ref: '[[sources/b]]', type: 'inconnue' }, citation: 'Acme a signé' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'clients/acme.md', ancre: 'f-0001' });
		const texte = dep.fichiers.get('clients/acme.md')!;
		expect(texte).toContain([
			'- [projet] Le client est Acme | declare | src: [[sources/a]] | appris 2026-11-01 | confiance 51 % ^f-0001',
			'  > « Acme, notre client »',
			'  + src: [[sources/b]] | corroboré 2026-11-22',
			'  > « Acme a signé »',
			'- Marie préfère les appels',
		].join('\n'));
		const fait = faitDe(texte, 'f-0001');
		expect(fait.texte).toBe('Le client est Acme');
		expect(fait.corroborations).toEqual([{ source: '[[sources/b]]', citation: 'Acme a signé', le: '2026-11-22' }]);
		// les autres informations, barrée comprise, restent telles quelles
		for (const ligne of INFORMATIONS.split('\n').slice(2)) expect(texte).toContain(ligne);
		expect(lireFiche('sources/b.md', dep.fichiers.get('sources/b.md')!).donnees['type_source']).toBe('inconnue');
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: corrobore clients/acme.md#^f-0001']);
		expect(r.statut === 'ecrit' && r.changements).toEqual(['source ajoutée : [[sources/b]]', 'confiance 30 % → 51 %', 'fiche de source créée : sources/b.md']);
	});

	it('une deuxième corroboration s\'ajoute après la première ; la confiance monte encore', async () => {
		const dep = memoire();
		await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0001', source: { ref: '[[sources/b]]', type: 'inconnue' } });
		const r = await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: '^f-0001', source: { ref: '[[sources/m]]', type: 'email' } });
		expect(r.statut).toBe('ecrit');
		const fait = faitDe(dep.fichiers.get('clients/acme.md')!, 'f-0001');
		expect(fait.corroborations?.map((c) => c.source)).toEqual(['[[sources/b]]', '[[sources/m]]']);
		// 1 − 0,49 × 0,3 = 0,853
		expect(fait.confiance).toBe(85);
		expect(dep.commits).toHaveLength(2);
	});

	it('sans confiance écrite, part de celle de sa première source ; nature gardée pour la nouvelle source', async () => {
		const dep = memoire();
		// ^f-0003 : [[sources/a]] (inconnue, 30 %), plus une note (60 %) → 1 − 0,7 × 0,4 = 0,72
		const r = await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0003', source: { ref: '[[sources/n]]', type: 'note' } });
		expect(r.statut === 'ecrit' && r.changements).toContain('confiance 30 % (non écrite : celle de sa première source) → 72 %');
		expect(faitDe(dep.fichiers.get('clients/acme.md')!, 'f-0003').confiance).toBe(72);
	});

	it('une source utilisateur déjà là lève le plafond de 0,9', async () => {
		const dep = memoire();
		// ^f-0002 : utilisateur, observe, 85 % ; + email observe 0,595 → 1 − 0,15 × 0,405 = 0,939
		expect((await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0002', source: { ref: '[[sources/m]]', type: 'email' } })).statut).toBe('ecrit');
		expect(faitDe(dep.fichiers.get('clients/acme.md')!, 'f-0002').confiance).toBe(94);
	});

	it('refuse la même référence, liens résolus : source principale ou corroboration, avec ou sans .md, par son titre', async () => {
		const dep = memoire();
		for (const ref of ['[[sources/a]]', '[[sources/a.md]]', '[[Note A]]', '[[sources/a|A]] p. 3']) {
			const r = await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0001', source: { ref, type: 'inconnue' } });
			expect(r, ref).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('déjà') });
		}
		expect((await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0002', source: { ref: 'utilisateur', type: 'utilisateur' } })).statut).toBe('refuse');
		await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0001', source: { ref: '[[sources/m]]', type: 'email' } });
		const avant = new Map(dep.fichiers);
		expect((await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0001', source: { ref: '[[sources/m.md]]', type: 'email' } })).statut).toBe('refuse');
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(1);
	});

	it('refuse sans rien écrire : ancre absente, information barrée, consigne, référence ou citation trop longues, référence avec « | »', async () => {
		const dep = memoire();
		const avant = new Map(dep.fichiers);
		const b = { ref: '[[sources/b]]', type: 'inconnue' } as const;
		for (const demande of [
			{ id: 'clients/acme.md', ancre: 'f-0099', source: b },
			{ id: 'clients/acme.md', ancre: 'f-0004', source: b },
			{ id: 'consignes/regle.md', ancre: 'f-0001', source: { ref: 'utilisateur 2026-11-22', type: 'utilisateur' } as const },
			{ id: 'clients/acme.md', ancre: 'f-0001', source: { ref: `[[sources/b]] ${'x'.repeat(480)}`, type: 'inconnue' } as const },
			{ id: 'clients/acme.md', ancre: 'f-0001', source: b, citation: 'x'.repeat(501) },
			{ id: 'clients/acme.md', ancre: 'f-0001', source: b, citation: 'deux\nlignes' },
			{ id: 'clients/acme.md', ancre: 'f-0001', source: { ref: '[[sources/b]] | email', type: 'inconnue' } as const },
			{ id: 'clients/acme.md', ancre: 'f-0001', source: { ref: 'sans lien', type: 'email' } as const },
			{ id: 'clients/absente.md', ancre: 'f-0001', source: b },
		]) {
			expect((await entretenir(dep, { action: 'corroborer', ...demande })).statut, JSON.stringify(demande).slice(0, 120)).toBe('refuse');
		}
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(0);
	});

	it('la ligne de la source tient en 500 caractères : une référence à la limite passe', async () => {
		const dep = memoire();
		const suffixe = ' | corroboré 2026-11-22';
		const ref = `[[sources/b]] ${'x'.repeat(500 - '  + src: '.length - suffixe.length - '[[sources/b]] '.length)}`;
		expect((await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'f-0001', source: { ref, type: 'inconnue' } })).statut).toBe('ecrit');
		const ligne = dep.fichiers.get('clients/acme.md')!.split('\n').find((l) => l.startsWith('  + src: '))!;
		expect(ligne).toHaveLength(500);
		expect(lireFait('- x', ligne)?.corroborations).toEqual([{ source: ref, le: '2026-11-22' }]);
	});
});

describe('cleDeSource', () => {
	it('même clé pour un même document, liens résolus ; une source personnelle est sa mention', () => {
		const designee = (cible: string) => (['sources/a', 'sources/a.md', 'Note A'].includes(cible) ? 'sources/a.md' : null);
		const cles = ['[[sources/a]]', '[[sources/a.md]]', '[[Note A]]', '[[sources/a|A]] p. 3', '[[Sources/A]]'].map((m) => cleDeSource(m, designee));
		expect(new Set(cles).size).toBe(1);
		expect(cleDeSource('[[sources/b]]', designee)).not.toBe(cles[0]);
		expect(cleDeSource('utilisateur  2026-11-22')).toBe('utilisateur 2026-11-22');
		expect(cleDeSource('session [[sources/a]]', designee)).not.toBe(cles[0]);
	});
});

describe('entretenir : retoucher_information', () => {
	it('corrige une coquille en place : même ancre, sources, citation, confiance et dates gardées, un commit', async () => {
		const dep = memoire();
		const r = await entretenir(dep, { action: 'retoucher_information', id: 'clients/acme.md', ancre: 'clients/acme.md#^f-0006', texte: 'Le contact s\'appelle Cordano' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'clients/acme.md', ancre: 'f-0006' });
		const texte = dep.fichiers.get('clients/acme.md')!;
		expect(texte).toContain('- Le contact s\'appelle Cordano | declare | src: [[sources/a]] | confiance 30 % ^f-0006');
		expect(texte).not.toContain('Corbano');
		for (const ligne of INFORMATIONS.split('\n').slice(0, -1)) expect(texte).toContain(ligne);
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: retouche clients/acme.md#^f-0006']);
	});

	it('change une catégorie hors enjeu, et garde la citation et la catégorie quand seul le texte change', async () => {
		const dep = memoire();
		expect((await entretenir(dep, { action: 'retoucher_information', id: 'clients/acme.md', ancre: 'f-0001', categorie: 'client' })).statut).toBe('ecrit');
		expect((await entretenir(dep, { action: 'retoucher_information', id: 'clients/acme.md', ancre: 'f-0001', texte: 'Le client est Acme.' })).statut).toBe('ecrit');
		const fait = faitDe(dep.fichiers.get('clients/acme.md')!, 'f-0001');
		expect(fait).toMatchObject({ texte: 'Le client est Acme.', categorie: 'client', citation: 'Acme, notre client', confiance: 30, source: '[[sources/a]]', appris: '2026-11-01' });
		expect(dep.commits).toHaveLength(2);
	});

	it('garde « à confirmer » et « contredit » de l\'information retouchée, et le renvoi « invalidé … par » qui la vise', async () => {
		const dep = memoire();
		expect((await entretenir(dep, { action: 'retoucher_information', id: 'clients/acme.md', ancre: 'f-0007', texte: 'Le siège est à Lyon 3e.' })).statut).toBe('ecrit');
		expect((await entretenir(dep, { action: 'retoucher_information', id: 'clients/acme.md', ancre: 'f-0003', texte: 'Le siège est à Lyon.' })).statut).toBe('ecrit');
		const texte = dep.fichiers.get('clients/acme.md')!;
		expect(texte).toContain('- Le siège est à Lyon 3e. | declare | src: [[sources/m]] | confiance 70 % | a confirmer | contredit ^f-0003 ^f-0007');
		expect(texte).toContain('- Le siège est à Lyon. | declare | src: [[sources/a]] ^f-0003');
		expect(texte).toContain('- ~~Le siège est à Paris~~ | declare | src: [[sources/a]] | confiance 30 % | invalidé 2026-11-02 par ^f-0003 ^f-0004');
		expect(faitDe(texte, 'f-0007')).toMatchObject({ aConfirmer: true, contredit: 'f-0003' });
	});

	it('vise l\'information par « f-0001 », « ^f-0001 » ou « chemin#^f-0001 » ; un identifiant d\'une autre fiche est refusé', async () => {
		const dep = memoire();
		for (const [ancre, id] of [['f-0001', 'f-0001'], ['^f-0003', 'f-0003'], ['clients/acme.md#^f-0006', 'f-0006']] as const) {
			const r = await entretenir(dep, { action: 'retoucher_information', id: 'clients/acme.md', ancre, categorie: 'client' });
			expect(r, ancre).toMatchObject({ statut: 'ecrit', ancre: id });
			expect(faitDe(dep.fichiers.get('clients/acme.md')!, id).categorie).toBe('client');
		}
		expect((await entretenir(dep, { action: 'retoucher_information', id: 'clients/acme.md', ancre: 'clients/autre.md#^f-0001', categorie: 'projet' })).statut).toBe('refuse');
		expect((await entretenir(dep, { action: 'corroborer', id: 'clients/acme.md', ancre: 'clients/autre.md#^f-0001', source: { ref: 'utilisateur 2026-11-22', type: 'utilisateur' } })).statut).toBe('refuse');
		expect(dep.commits).toHaveLength(3);
	});

	it('refuse un changement de sens (nombre, montant, catégorie à fort enjeu, autre texte) en renvoyant à proposer avec remplace', async () => {
		const dep = memoire();
		const avant = new Map(dep.fichiers);
		for (const demande of [
			{ ancre: 'f-0005', texte: 'Budget de 1300 €' },
			{ ancre: 'f-0005', categorie: 'projet' },
			{ ancre: 'f-0001', categorie: 'echeance' },
			{ ancre: 'f-0003', texte: 'Le siège n\'est pas à Lyon' },
			{ ancre: 'f-0006', texte: 'Le contact s\'appelle Jean-Pierre Martin' },
		]) {
			const r = await entretenir(dep, { action: 'retoucher_information', id: 'clients/acme.md', ...demande });
			expect(r, JSON.stringify(demande)).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('remplace') });
		}
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(0);
	});

	it('refuse sans rien écrire : information barrée, ancre absente, rien de changé, consigne, texte invalide', async () => {
		const dep = memoire();
		const avant = new Map(dep.fichiers);
		for (const demande of [
			{ id: 'clients/acme.md', ancre: 'f-0004', texte: 'Le siège est à Paris.' },
			{ id: 'clients/acme.md', ancre: 'f-0099', texte: 'Autre' },
			{ id: 'clients/acme.md', ancre: 'f-0003', texte: 'Le siège est à Lyon' },
			{ id: 'clients/acme.md', ancre: 'f-0003' },
			{ id: 'consignes/regle.md', ancre: 'f-0001', texte: 'Toujours vouvoyer.' },
			{ id: 'clients/acme.md', ancre: 'f-0003', texte: 'Le siège | est à Lyon' },
			{ id: 'clients/acme.md', ancre: 'f-0003', categorie: 'Pas Valide' },
		]) {
			expect((await entretenir(dep, { action: 'retoucher_information', ...demande })).statut, JSON.stringify(demande)).toBe('refuse');
		}
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(0);
	});
});

describe('entretenir (outil) : champs de corroborer et retoucher_information', () => {
	it('champs requis et sans objet vérifiés par action', () => {
		const source = { ref: '[[sources/b]]', type: 'note' as const };
		expect(demandeDEntretien({ action: 'corroborer', id: 'a.md', ancre: 'f-0001', source, citation: 'c' })).toEqual({
			ok: true,
			valeur: { action: 'corroborer', id: 'a.md', ancre: 'f-0001', source, citation: 'c' },
		});
		expect(demandeDEntretien({ action: 'corroborer', id: 'a.md', ancre: 'f-0001' })).toMatchObject({ ok: false, motif: expect.stringContaining('« source »') });
		expect(demandeDEntretien({ action: 'corroborer', id: 'a.md', source })).toMatchObject({ ok: false, motif: expect.stringContaining('« ancre »') });
		expect(demandeDEntretien({ action: 'corroborer', id: 'a.md', ancre: 'f-0001', source, texte: 't' })).toMatchObject({ ok: false, motif: expect.stringContaining('sans objet') });
		expect(demandeDEntretien({ action: 'retoucher_information', id: 'a.md', ancre: 'f-0001' })).toMatchObject({ ok: false, motif: expect.stringContaining('au moins un') });
		expect(demandeDEntretien({ action: 'retoucher_information', id: 'a.md', ancre: 'f-0001', citation: 'c', texte: 't' })).toMatchObject({ ok: false, motif: expect.stringContaining('sans objet') });
		expect(demandeDEntretien({ action: 'retoucher_information', id: 'a.md', ancre: 'f-0001', categorie: 'client' })).toEqual({
			ok: true,
			valeur: { action: 'retoucher_information', id: 'a.md', ancre: 'f-0001', categorie: 'client' },
		});
		expect(demandeDEntretien({ action: 'retoucher_information', id: 'a.md#^f-0001', ancre: 'f-0001', texte: 't' })).toMatchObject({ ok: false, motif: expect.stringContaining('`ancre`') });
		expect(demandeDEntretien({ action: 'supprimer', id: 'a.md', ancre: 'f-0001' })).toMatchObject({ ok: false, motif: expect.stringContaining('sans objet') });
	});
});
