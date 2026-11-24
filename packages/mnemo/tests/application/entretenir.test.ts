import { describe, expect, it } from 'vitest';
import { entretenir } from '../../src/application/entretenir.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, corps = '', extra = '') =>
	`---\nid: 01${titre.toUpperCase().replace(/[^A-Z]/gu, '')}\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n# ${titre}\n${corps}`;

function memoireASupprimer() {
	const dep = fauxPorts();
	dep.fichiers.set('notes/vieille.md', fiche('sujet', 'Vieille', '\nUne note dépassée.\n\n## Informations\n- Une information | declare | src: utilisateur ^f-0001\n'));
	dep.fichiers.set('notes/a.md', fiche('sujet', 'A', '\nVoir [[notes/vieille]] et [[notes/vieille#^f-0001]].\n'));
	dep.fichiers.set('notes/b.md', fiche('sujet', 'B', '\nPar son titre : [[Vieille|l\'ancienne]].\n'));
	dep.fichiers.set('notes/c.md', fiche('sujet', 'C', '\n```\n[[notes/vieille]]\n```\n'));
	dep.fichiers.set('notes/neuve.md', fiche('sujet', 'Neuve', '\nLa note à jour.\n\n## Relations\n- remplace [[notes/vieille]]\n'));
	return dep;
}

describe('entretenir : supprimer', () => {
	it('refusé tant que d\'autres fiches la citent (par chemin ou par titre) : citeePar, rien d\'écrit', async () => {
		const dep = memoireASupprimer();
		const avant = new Map(dep.fichiers);
		const r = await entretenir(dep, { action: 'supprimer', id: 'notes/vieille.md' });
		// un lien dans un bloc de code ne cite pas
		expect(r).toMatchObject({ statut: 'refuse', citeePar: ['notes/a.md', 'notes/b.md', 'notes/neuve.md'] });
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(0);
	});

	it('avec redirection : liens réécrits vers elle, plus aucun lien vers l\'ancienne, fiche supprimée, un commit', async () => {
		const dep = memoireASupprimer();
		const r = await entretenir(dep, { action: 'supprimer', id: 'notes/vieille.md', redirection: 'notes/neuve.md' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'notes/vieille.md' });
		expect(dep.fichiers.has('notes/vieille.md')).toBe(false);
		expect(dep.fichiers.get('notes/a.md')).toContain('Voir [[notes/neuve]] et [[notes/neuve]].');
		expect(dep.fichiers.get('notes/b.md')).toContain('[[notes/neuve|l\'ancienne]]');
		// la relation de la redirection vers l'ancienne deviendrait une relation vers elle-même : retirée
		expect(lireFiche('notes/neuve.md', dep.fichiers.get('notes/neuve.md')!).relations).toEqual([]);
		for (const chemin of ['notes/a.md', 'notes/b.md', 'notes/neuve.md']) expect(dep.fichiers.get(chemin), chemin).not.toMatch(/\[\[(notes\/)?vieille/iu);
		expect(dep.fichiers.get('notes/c.md')).toContain('[[notes/vieille]]');
		expect(dep.commits).toHaveLength(1);
		expect(dep.commits[0]!.message).toBe('mnemo: supprime notes/vieille.md');
		expect(dep.commits[0]!.chemins).toEqual(expect.arrayContaining(['notes/vieille.md', 'notes/a.md', 'notes/b.md', 'notes/neuve.md']));
	});

	it('une fiche que personne ne cite est supprimée sans redirection', async () => {
		const dep = memoireASupprimer();
		expect((await entretenir(dep, { action: 'supprimer', id: 'notes/c.md' })).statut).toBe('ecrit');
		expect(dep.fichiers.has('notes/c.md')).toBe(false);
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: supprime notes/c.md']);
	});

	it('refuse : profil, fiche d\'un dossier qui contient d\'autres fiches, redirection absente ou identique', async () => {
		const dep = memoireASupprimer();
		dep.fichiers.set('profils/travail/travail.md', fiche('profil', 'Travail'));
		dep.fichiers.set('clients/acme/acme.md', fiche('dossier', 'Acme'));
		dep.fichiers.set('clients/acme/contrat.md', fiche('sujet', 'Contrat'));
		const avant = new Map(dep.fichiers);
		for (const demande of [
			{ id: 'profils/travail/travail.md' },
			{ id: 'clients/acme/acme.md' },
			{ id: 'notes/vieille.md', redirection: 'notes/absente.md' },
			{ id: 'notes/vieille.md', redirection: 'notes/vieille.md' },
			{ id: 'notes/absente.md' },
		]) {
			expect((await entretenir(dep, { action: 'supprimer', ...demande })).statut, JSON.stringify(demande)).toBe('refuse');
		}
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(0);
	});
});

describe('entretenir : fusionner', () => {
	function memoireAFusionner() {
		const dep = fauxPorts();
		dep.fichiers.set('personnes/marie.md', fiche('personne', 'Marie'));
		dep.fichiers.set(
			'clients/acme.md',
			fiche('organisation', 'Acme', '\nLe client Acme.\n\n## Informations\n- Acme est un client | declare | src: utilisateur ^f-0001\n- Siège à Lyon | observe | src: utilisateur ^f-0002\n\n## Notes\nClient historique.\n', 'alias: [ACME SA]\n'),
		);
		dep.fichiers.set(
			'notes/acme-doublon.md',
			fiche(
				'organisation',
				'Acme Corporation',
				[
					'',
					'Fiche créée en double.',
					'',
					'## Informations',
					'- Le contrat court jusqu\'en 2027 | declare | src: utilisateur ^f-0001',
					'- ~~Siège à Paris~~ | observe | src: utilisateur | invalidé 2026-11-10 par ^f-0003 ^f-0002',
					'- Siège à Lyon depuis 2025 | observe | src: utilisateur ^f-0003',
					'',
					'## Relations',
					'- travaille avec [[personnes/marie]]',
					'- doublon de [[clients/acme]]',
					'',
					'## Notes',
					'Rencontré au salon.',
					'',
				].join('\n'),
				'alias: [Acme Corp]\n',
			),
		);
		dep.fichiers.set('notes/r.md', fiche('sujet', 'R', '\nLe contrat : [[notes/acme-doublon#^f-0003]] ; voir [[Acme Corporation]].\n'));
		return dep;
	}

	it('verse informations, sections, relations et alias ; ancres sans doublon, renvois suivis ; liens réécrits ; un commit', async () => {
		const dep = memoireAFusionner();
		const r = await entretenir(dep, { action: 'fusionner', id: 'notes/acme-doublon.md', dans: 'clients/acme.md' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'clients/acme.md' });
		expect(dep.fichiers.has('notes/acme-doublon.md')).toBe(false);

		const fusion = lireFiche('clients/acme.md', dep.fichiers.get('clients/acme.md')!);
		const faits = fusion.faits.flatMap((l) => ('fait' in l ? [l.fait] : []));
		expect(faits.map((f) => [f.ancre, f.texte])).toEqual([
			['f-0001', 'Acme est un client'],
			['f-0002', 'Siège à Lyon'],
			['f-0003', 'Le contrat court jusqu\'en 2027'],
			['f-0004', 'Siège à Paris'],
			['f-0005', 'Siège à Lyon depuis 2025'],
		]);
		expect(new Set(faits.map((f) => f.ancre)).size).toBe(faits.length);
		expect(faits[3]).toMatchObject({ barre: true, invalidePar: 'f-0005' });
		expect(fusion.synthese).toBe('Le client Acme.\n\nFiche créée en double.');
		expect(fusion.autresSections).toEqual([{ titre: 'Notes', corps: 'Client historique.\n\nRencontré au salon.' }]);
		// la relation de l'absorbée vers la fiche qui la reçoit deviendrait une relation vers elle-même : retirée
		expect(fusion.relations).toEqual([{ verbe: 'travaille avec', cible: 'personnes/marie' }]);
		expect(fusion.alias).toEqual(['ACME SA', 'Acme Corporation', 'acme-doublon', 'Acme Corp']);
		expect(fusion.id).toBe('01ACME');

		const r2 = dep.fichiers.get('notes/r.md')!;
		expect(r2).toContain('[[clients/acme#^f-0005]]');
		// écrit par le titre : le texte affiché reste le même
		expect(r2).toContain('voir [[clients/acme|Acme Corporation]].');
		expect(dep.commits).toHaveLength(1);
		expect(dep.commits[0]!.message).toBe('mnemo: fusionne notes/acme-doublon.md → clients/acme.md');
		expect(dep.commits[0]!.chemins).toEqual(expect.arrayContaining(['clients/acme.md', 'notes/r.md', 'notes/acme-doublon.md']));
	});

	it('refuse sans rien écrire : dans elle-même, fiche absente, profil', async () => {
		const dep = memoireAFusionner();
		dep.fichiers.set('profils/travail/travail.md', fiche('profil', 'Travail'));
		const avant = new Map(dep.fichiers);
		for (const [id, dans] of [
			['clients/acme.md', 'clients/acme.md'],
			['notes/absente.md', 'clients/acme.md'],
			['notes/acme-doublon.md', 'notes/absente.md'],
			['profils/travail/travail.md', 'clients/acme.md'],
			['notes/acme-doublon.md', 'profils/travail/travail.md'],
		] as const) {
			expect((await entretenir(dep, { action: 'fusionner', id, dans })).statut, `${id} → ${dans}`).toBe('refuse');
		}
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(0);
	});
});

describe('entretenir : corriger_lien', () => {
	function memoireACorriger() {
		const dep = fauxPorts();
		dep.fichiers.set('notes/bonne.md', fiche('sujet', 'Bonne'));
		dep.fichiers.set('sources/doc.md', fiche('source', 'Doc', '\nVoir [[Fausse note]] et [[notes/ancienne|l\'ancienne]].\n', 'type_source: note\n'));
		return dep;
	}

	it('avec une cible : le lien pointe vers elle, alias gardé ; sans cible : le texte perd ses crochets ; un commit chacun', async () => {
		const dep = memoireACorriger();
		const r = await entretenir(dep, { action: 'corriger_lien', id: 'sources/doc.md', ancien: 'notes/ancienne', nouveau: 'notes/bonne' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'sources/doc.md' });
		expect(dep.fichiers.get('sources/doc.md')).toContain('[[notes/bonne|l\'ancienne]]');
		expect((await entretenir(dep, { action: 'corriger_lien', id: 'sources/doc.md', ancien: '[[Fausse note]]', nouveau: null })).statut).toBe('ecrit');
		expect(dep.fichiers.get('sources/doc.md')).toContain('Voir Fausse note et [[notes/bonne|l\'ancienne]].');
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: corrige_lien sources/doc.md', 'mnemo: corrige_lien sources/doc.md']);
	});

	it('refuse : lien absent (liens présents listés), nouvelle cible qui ne désigne aucune fiche', async () => {
		const dep = memoireACorriger();
		const absent = await entretenir(dep, { action: 'corriger_lien', id: 'sources/doc.md', ancien: 'autre', nouveau: null });
		expect(absent).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('[[Fausse note]]') });
		const nulle = await entretenir(dep, { action: 'corriger_lien', id: 'sources/doc.md', ancien: 'Fausse note', nouveau: 'nulle/part' });
		expect(nulle.statut).toBe('refuse');
		expect(dep.commits).toHaveLength(0);
	});
});

describe('entretenir : liens et relations réécrits', () => {
	it('fusionner : un renvoi brut vers une autre fiche est gardé, une ancre absente de l\'absorbée est retirée du lien et du fait', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('clients/acme.md', fiche('organisation', 'Acme', '\n## Informations\n- Acme est un client | declare | src: utilisateur ^f-0001\n- Siège à Lyon | observe | src: utilisateur ^f-0002\n'));
		dep.fichiers.set(
			'notes/doublon.md',
			fiche(
				'organisation',
				'Doublon',
				[
					'',
					'## Informations',
					'- Le contrat court | declare | src: utilisateur | contredit ^f-0009 ^f-0001',
					'- Remarque, voir [[notes/r#^f-0002]] et [[notes/doublon#^f-0001]] | mention inconnue ^f-0002',
					'',
				].join('\n'),
			),
		);
		dep.fichiers.set('notes/r.md', fiche('sujet', 'R', '\nVoir [[notes/doublon#^f-0009]] et [[notes/doublon#^f-0002|la remarque]].\n'));
		expect((await entretenir(dep, { action: 'fusionner', id: 'notes/doublon.md', dans: 'clients/acme.md' })).statut).toBe('ecrit');

		const acme = dep.fichiers.get('clients/acme.md')!;
		// f-0001 → f-0003, f-0002 → f-0004 : le lien vers notes/r garde son ancre, le lien vers elle-même n'est suivi qu'une fois
		expect(acme).toContain('- Remarque, voir [[notes/r#^f-0002]] et [[clients/acme#^f-0003]] | mention inconnue ^f-0004');
		const contrat = lireFiche('clients/acme.md', acme).faits.flatMap((l) => ('fait' in l ? [l.fait] : [])).find((f) => f.texte === 'Le contrat court')!;
		expect(contrat.ancre).toBe('f-0003');
		expect(contrat.contredit).toBeUndefined();
		expect(dep.fichiers.get('notes/r.md')).toContain('Voir [[clients/acme]] et [[clients/acme#^f-0004|la remarque]].');
	});

	it('supprimer : texte affiché gardé pour un lien par titre, relations devenues identiques dédoublonnées', async () => {
		const dep = memoireASupprimer();
		dep.fichiers.set('notes/d.md', fiche('sujet', 'D', '\nPar son titre : [[Vieille]].\n\n## Relations\n- lié à [[notes/vieille]]\n- lié à [[notes/neuve]]\n- cite [[notes/a]]\n'));
		expect((await entretenir(dep, { action: 'supprimer', id: 'notes/vieille.md', redirection: 'notes/neuve.md' })).statut).toBe('ecrit');
		const d = dep.fichiers.get('notes/d.md')!;
		expect(d).toContain('Par son titre : [[notes/neuve|Vieille]].');
		expect(lireFiche('notes/d.md', d).relations).toEqual([
			{ verbe: 'lié à', cible: 'notes/neuve' },
			{ verbe: 'cite', cible: 'notes/a' },
		]);
	});

	it('fusionner : relations d\'une fiche tierce devenues identiques dédoublonnées', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('notes/garde.md', fiche('sujet', 'Garde'));
		dep.fichiers.set('notes/part.md', fiche('sujet', 'Part'));
		dep.fichiers.set('notes/t.md', fiche('sujet', 'T', '\n## Relations\n- lié à [[notes/part]]\n- lié à [[notes/garde]]\n'));
		expect((await entretenir(dep, { action: 'fusionner', id: 'notes/part.md', dans: 'notes/garde.md' })).statut).toBe('ecrit');
		expect(lireFiche('notes/t.md', dep.fichiers.get('notes/t.md')!).relations).toEqual([{ verbe: 'lié à', cible: 'notes/garde' }]);
	});

	it('corriger_lien refusé dans une consigne ; une consigne réécrite par une suppression est signalée', async () => {
		const dep = memoireASupprimer();
		dep.fichiers.set('consignes/regle.md', fiche('consigne', 'Règle', '\nVoir [[notes/vieille]].\n'));
		const avant = new Map(dep.fichiers);
		const refus = await entretenir(dep, { action: 'corriger_lien', id: 'consignes/regle.md', ancien: 'notes/vieille', nouveau: 'notes/neuve' });
		expect(refus).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('consigne') });
		expect(dep.fichiers).toEqual(avant);

		const r = await entretenir(dep, { action: 'supprimer', id: 'notes/vieille.md', redirection: 'notes/neuve.md' });
		expect(r.statut).toBe('ecrit');
		expect(dep.fichiers.get('consignes/regle.md')).toContain('Voir [[notes/neuve]].');
		expect('changements' in r ? r.changements : []).toContain('à signaler à l\'utilisateur : liens réécrits dans consignes/regle.md');
	});
});
