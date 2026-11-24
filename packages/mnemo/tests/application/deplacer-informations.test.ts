import { describe, expect, it } from 'vitest';
import { entretenir } from '../../src/application/entretenir.ts';
import { proposer } from '../../src/application/proposer.ts';
import { demandeDEntretien } from '../../src/application/validation.ts';
import type { Fait } from '../../src/domaine/fait.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { ficheTouchee } from '../../src/domaine/outil-de-session.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, corps = '', extra = '') =>
	`---\nid: 01${titre.toUpperCase().replace(/[^A-Z]/gu, '')}\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n# ${titre}\n${corps}`;

const ACME = [
	'- [projet] Le client est Acme | declare | src: [[sources/a]] | appris 2026-11-01 | confiance 51 % ^f-0001',
	'  > « Acme, notre client »',
	'  + src: [[sources/m]] | corroboré 2026-11-10',
	'  > « Acme confirmé »',
	'- Marie préfère les appels | observe | src: utilisateur | appris 2026-11-01 | valide [2026-01-01,2026-12-31] | confiance 85 % ^f-0002',
	'- Le siège est à Lyon | declare | src: [[sources/a]] ^f-0003',
	'- ~~Le siège est à Paris~~ | declare | src: [[sources/a]] | confiance 30 % | invalidé 2026-11-02 par ^f-0003 ^f-0004',
	'- Le contact s\'appelle Corbano | infere | src: [[sources/a]] | confiance 21 % | a confirmer ^f-0005',
	'- [montant] Budget de 1200 € | declare | src: utilisateur | confiance 100 % | a confirmer | contredit ^f-0007 ^f-0006',
	'- [montant] Budget de 1500 € | declare | src: utilisateur | confiance 100 % ^f-0007',
].join('\n');

const LYON = [
	'- Bureau ouvert en 2020 | declare | src: utilisateur ^f-0002',
	'- Douze personnes sur place | declare | src: utilisateur ^f-0010',
].join('\n');

function memoire() {
	const dep = fauxPorts();
	dep.fichiers.set('sources/sources.md', fiche('dossier', 'Sources'));
	dep.fichiers.set('sources/a.md', fiche('source', 'Note A', '\nUn document.\n', 'type_source: inconnue\n'));
	dep.fichiers.set('sources/m.md', fiche('source', 'Mail M', '\nUn courriel.\n', 'type_source: email\n'));
	dep.fichiers.set('clients/acme.md', fiche('organisation', 'Acme', `\nLe client Acme ; son siège : [[clients/acme#^f-0003]].\n\n## Informations\n${ACME}\n`));
	dep.fichiers.set('clients/lyon.md', fiche('organisation', 'Site de Lyon', `\nLe site lyonnais.\n\n## Informations\n${LYON}\n`));
	dep.fichiers.set('consignes/regle.md', fiche('consigne', 'Règle', '\n## Informations\n- Toujours vouvoyer | declare | src: utilisateur ^f-0001\n'));
	return dep;
}

const ligne = (n: number): string => ACME.split('\n').find((l) => l.endsWith(`^f-000${n}`))!;
const reancree = (texte: string, ancre: string): string => texte.replace(/ \^f-\d{4}$/u, ` ^${ancre}`);

function faitDe(chemin: string, texte: string, ancre: string): Fait | undefined {
	for (const l of lireFiche(chemin, texte).faits) if ('fait' in l && l.fait.ancre === ancre) return l.fait;
	return undefined;
}

describe('entretenir : deplacer_informations', () => {
	it('déplace une information avec tout ce qu\'elle porte (citation, corroboration, dates, confiance) ; ancre après la plus haute ; un commit', async () => {
		const dep = memoire();
		const avant = faitDe('clients/acme.md', dep.fichiers.get('clients/acme.md')!, 'f-0001')!;
		const r = await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0001'], dans: 'clients/lyon.md' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'clients/lyon.md' });
		const lyon = dep.fichiers.get('clients/lyon.md')!;
		expect(lyon).toContain([
			'- Douze personnes sur place | declare | src: utilisateur ^f-0010',
			'- [projet] Le client est Acme | declare | src: [[sources/a]] | appris 2026-11-01 | confiance 51 % ^f-0011',
			'  > « Acme, notre client »',
			'  + src: [[sources/m]] | corroboré 2026-11-10',
			'  > « Acme confirmé »',
		].join('\n'));
		expect(faitDe('clients/lyon.md', lyon, 'f-0011')).toEqual({ ...avant, ancre: 'f-0011' });
		const acme = dep.fichiers.get('clients/acme.md')!;
		// rien n'est laissé à l'origine
		expect(acme).not.toContain('Le client est Acme');
		expect(acme).not.toContain('Acme, notre client');
		expect(acme).not.toContain('corroboré');
		expect(faitDe('clients/acme.md', acme, 'f-0001')).toBeUndefined();
		for (const n of [2, 3, 4, 5, 6, 7]) expect(acme).toContain(ligne(n));
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: deplace_informations clients/acme.md → clients/lyon.md']);
	});

	it('une information sans corroboration est réécrite octet pour octet, seule son ancre change ; « chemin#^f-X » accepté', async () => {
		const dep = memoire();
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['clients/acme.md#^f-0002', '^f-0005'], dans: 'clients/lyon.md' })).statut).toBe('ecrit');
		const lyon = dep.fichiers.get('clients/lyon.md')!;
		expect(lyon).toContain(`${reancree(ligne(2), 'f-0011')}\n${reancree(ligne(5), 'f-0012')}\n`);
		const acme = dep.fichiers.get('clients/acme.md')!;
		expect(acme).not.toContain('Marie préfère');
		expect(acme).not.toContain('Corbano');
	});

	it('la barrée invalidée par une information déplacée la suit, son renvoi remappé', async () => {
		const dep = memoire();
		const r = await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0003'], dans: 'clients/lyon.md' });
		expect(r.statut).toBe('ecrit');
		const lyon = dep.fichiers.get('clients/lyon.md')!;
		expect(lyon).toContain([
			'- Le siège est à Lyon | declare | src: [[sources/a]] ^f-0011',
			'- ~~Le siège est à Paris~~ | declare | src: [[sources/a]] | confiance 30 % | invalidé 2026-11-02 par ^f-0011 ^f-0012',
		].join('\n'));
		const acme = dep.fichiers.get('clients/acme.md')!;
		expect(acme).not.toContain('Le siège est à');
		expect(r.statut === 'ecrit' && r.changements?.some((c) => c.includes('^f-0004'))).toBe(true);
	});

	it('une information barrée déplacée emmène celle qui l\'invalide : aucun renvoi ne traverse deux fiches', async () => {
		const dep = memoire();
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0004'], dans: 'clients/lyon.md' })).statut).toBe('ecrit');
		const lyon = dep.fichiers.get('clients/lyon.md')!;
		expect(faitDe('clients/lyon.md', lyon, 'f-0012')).toMatchObject({ texte: 'Le siège est à Paris', barre: true, invalidePar: 'f-0011' });
		expect(faitDe('clients/lyon.md', lyon, 'f-0011')).toMatchObject({ texte: 'Le siège est à Lyon' });
		expect(dep.fichiers.get('clients/acme.md')!).not.toContain('Le siège est à');
	});

	it('une contradiction suit dans un sens comme dans l\'autre', async () => {
		const dep = memoire();
		// ^f-0007 est contredite par ^f-0006, qui reste à l'origine sans cela
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0007'], dans: 'clients/lyon.md' })).statut).toBe('ecrit');
		const lyon = dep.fichiers.get('clients/lyon.md')!;
		expect(lyon).toContain([
			'- [montant] Budget de 1200 € | declare | src: utilisateur | confiance 100 % | a confirmer | contredit ^f-0012 ^f-0011',
			'- [montant] Budget de 1500 € | declare | src: utilisateur | confiance 100 % ^f-0012',
		].join('\n'));
		expect(dep.fichiers.get('clients/acme.md')!).not.toContain('Budget');
	});

	it('tout lien vers une information déplacée est réécrit vers la cible et sa nouvelle ancre (chemin, chemin.md, titre, alias gardé), partout ; les autres liens restent', async () => {
		const dep = memoire();
		const liens = [
			'Siège : [[clients/acme#^f-0003]].',
			'Siège encore : [[clients/acme.md#^f-0003|le siège]].',
			'Par le titre : [[Acme#^f-0003]].',
			'Préférence : [[clients/acme#^f-0002]], fiche : [[clients/acme]].',
			'```',
			'[[clients/acme#^f-0003]]',
			'```',
		].join('\n');
		dep.fichiers.set('notes/n.md', fiche('sujet', 'Note', `\n${liens}\n`));
		const r = await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0003'], dans: 'clients/lyon.md' });
		expect(r.statut).toBe('ecrit');
		const note = dep.fichiers.get('notes/n.md')!;
		expect(note).toBe(fiche('sujet', 'Note', `\n${[
			'Siège : [[clients/lyon#^f-0011]].',
			'Siège encore : [[clients/lyon#^f-0011|le siège]].',
			'Par le titre : [[clients/lyon#^f-0011|Acme]].',
			'Préférence : [[clients/acme#^f-0002]], fiche : [[clients/acme]].',
			'```',
			'[[clients/acme#^f-0003]]',
			'```',
		].join('\n')}\n`));
		// dans l'origine aussi (synthèse)
		expect(dep.fichiers.get('clients/acme.md')!).toContain('son siège : [[clients/lyon#^f-0011]].');
		expect(dep.commits).toHaveLength(1);
		expect(dep.commits[0]!.chemins).toContain('notes/n.md');
	});

	it('crée la cible absente avec titreSiNouvelle (type de l\'origine, dossier créé) ; sans titre, refus', async () => {
		const dep = memoire();
		const sans = await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0003'], dans: 'lieux/sieges.md' });
		expect(sans.statut).toBe('refuse');
		expect(dep.fichiers.has('lieux/sieges.md')).toBe(false);
		const r = await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0003'], dans: 'lieux/sieges.md', titreSiNouvelle: 'Sièges' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'lieux/sieges.md' });
		const sieges = lireFiche('lieux/sieges.md', dep.fichiers.get('lieux/sieges.md')!);
		expect(sieges).toMatchObject({ type: 'organisation', titre: 'Sièges' });
		expect(sieges.faits.map((l) => ('fait' in l ? l.fait.ancre : null))).toEqual(['f-0001', 'f-0002']);
		expect(dep.fichiers.get('lieux/sieges.md')!).toContain('invalidé 2026-11-02 par ^f-0001 ^f-0002');
		expect(dep.fichiers.has('lieux/lieux.md')).toBe(true);
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: deplace_informations clients/acme.md → lieux/sieges.md']);
	});

	it('refus : cible = origine, ancre absente, consigne (origine ou cible) ; rien n\'est écrit', async () => {
		const dep = memoire();
		const avant = new Map(dep.fichiers);
		const refus = [
			{ id: 'clients/acme.md', ancres: ['f-0001'], dans: 'clients/acme.md' },
			{ id: 'clients/acme.md', ancres: ['f-0099'], dans: 'clients/lyon.md' },
			{ id: 'clients/acme.md', ancres: ['f-0001', 'f-0099'], dans: 'clients/lyon.md' },
			{ id: 'clients/acme.md', ancres: ['clients/lyon.md#^f-0002'], dans: 'clients/lyon.md' },
			{ id: 'consignes/regle.md', ancres: ['f-0001'], dans: 'clients/lyon.md' },
			{ id: 'clients/acme.md', ancres: ['f-0001'], dans: 'consignes/regle.md' },
			{ id: 'clients/inconnue.md', ancres: ['f-0001'], dans: 'clients/lyon.md' },
		];
		for (const d of refus) {
			expect((await entretenir(dep, { action: 'deplacer_informations', ...d })).statut, JSON.stringify(d)).toBe('refuse');
		}
		expect(dep.commits).toEqual([]);
		expect(dep.fichiers).toEqual(avant);
	});

	it('une ligne illisible qui renvoie à une information qui partirait : refus', async () => {
		const dep = memoire();
		const texte = dep.fichiers.get('clients/acme.md')!.replace('\n- [montant] Budget de 1500 €', '\n- Ligne libre, voir ^f-0003 | inconnu\n- [montant] Budget de 1500 €');
		dep.fichiers.set('clients/acme.md', texte);
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0003'], dans: 'clients/lyon.md' })).statut).toBe('refuse');
		expect(dep.commits).toEqual([]);
	});
});

describe('deplacer_informations : numéros d\'ancre jamais réutilisés, relations', () => {
	it('la plus haute ancre partie, une information sans ancre restée en reçoit une au-dessus ; ancre_max retenu dans l\'entête', async () => {
		const dep = memoire();
		dep.fichiers.set('clients/acme.md', dep.fichiers.get('clients/acme.md')!.replace(`${ligne(5)}\n`, `${ligne(5)}\n- Sans ancre ici | declare | src: utilisateur\n`));
		// ^f-0007 (la plus haute) part, et ^f-0006 qui la contredit avec elle
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0007'], dans: 'clients/lyon.md' })).statut).toBe('ecrit');
		const acme = dep.fichiers.get('clients/acme.md')!;
		expect(acme).toContain('- Sans ancre ici | declare | src: utilisateur ^f-0008');
		expect(acme).toMatch(/\nancre_max: 7\n/u);
		const lue = lireFiche('clients/acme.md', acme);
		expect(lue.ancreMax).toBe(7);
		expect(lue.donnees).not.toHaveProperty('ancre_max');
		const r = await proposer(dep, { genre: 'fait', fiche: 'clients/acme.md', texte: 'Réunion trimestrielle prévue en mars', nature: 'declare', source: { ref: 'dit en séance', type: 'utilisateur' } });
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0009' });
	});

	it('la plus haute ancre partie sans information sans ancre : la suivante prend le numéro au-dessus de la partie', async () => {
		const dep = memoire();
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0007'], dans: 'clients/lyon.md' })).statut).toBe('ecrit');
		const r = await proposer(dep, { genre: 'fait', fiche: 'clients/acme.md', texte: 'Réunion trimestrielle prévue en mars', nature: 'declare', source: { ref: 'dit en séance', type: 'utilisateur' } });
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0008' });
	});

	it('supprimer (décision de l\'utilisateur) l\'information de plus haute ancre : son numéro n\'est pas redonné', async () => {
		const dep = memoire();
		expect((await proposer(dep, { genre: 'supprimer', fiche: 'clients/acme.md', ancre: 'f-0007' }, { appliquerDirectement: true })).statut).toBe('ecrit');
		expect(dep.fichiers.get('clients/acme.md')!).toMatch(/\nancre_max: 7\n/u);
		const r = await proposer(dep, { genre: 'fait', fiche: 'clients/acme.md', texte: 'Réunion trimestrielle prévue en mars', nature: 'declare', source: { ref: 'dit en séance', type: 'utilisateur' } });
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0008' });
	});

	it('une information qui n\'a pas la plus haute ancre part : pas d\'ancre_max', async () => {
		const dep = memoire();
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0002'], dans: 'clients/lyon.md' })).statut).toBe('ecrit');
		expect(dep.fichiers.get('clients/acme.md')!).not.toContain('ancre_max');
	});

	it('une relation de la cible vers une information déplacée ne devient pas une relation vers elle-même ; les autres restent', async () => {
		const dep = memoire();
		dep.fichiers.set('clients/lyon.md', fiche('organisation', 'Site de Lyon', `\nLe site lyonnais.\n\n## Informations\n${LYON}\n\n## Relations\n- dépend de [[clients/acme#^f-0003]]\n- lié à [[clients/acme]]\n`));
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0003'], dans: 'clients/lyon.md' })).statut).toBe('ecrit');
		const lyon = dep.fichiers.get('clients/lyon.md')!;
		expect(lyon).not.toContain('dépend de');
		expect(lyon).toContain('- lié à [[clients/acme]]');
		expect(lireFiche('clients/lyon.md', lyon).relations).toEqual([{ verbe: 'lié à', cible: 'clients/acme' }]);
	});

	it('refus : profil en origine, cible sous skills/ ; rien n\'est écrit', async () => {
		const dep = memoire();
		dep.fichiers.set('profils/moi.md', fiche('profil', 'Moi', '\n## Informations\n- Je préfère le matin | declare | src: utilisateur ^f-0001\n'));
		const avant = new Map(dep.fichiers);
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'profils/moi.md', ancres: ['f-0001'], dans: 'clients/lyon.md' })).statut).toBe('refuse');
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0001'], dans: 'skills/outil.md', titreSiNouvelle: 'Outil' })).statut).toBe('refuse');
		dep.fichiers.set('skills/outil/outil.md', fiche('sujet', 'Outil', '\n'));
		const avantExistante = new Map(dep.fichiers);
		expect((await entretenir(dep, { action: 'deplacer_informations', id: 'clients/acme.md', ancres: ['f-0001'], dans: 'skills/outil/outil.md' })).statut).toBe('refuse');
		expect(dep.fichiers).toEqual(avantExistante);
		avantExistante.delete('skills/outil/outil.md');
		expect(avantExistante).toEqual(avant);
		expect(dep.commits).toEqual([]);
	});
});

describe('deplacer_informations : outil', () => {
	it('demandeDEntretien : ancres et dans obligatoires, titreSiNouvelle permis, ancre sans objet', () => {
		expect(demandeDEntretien({ action: 'deplacer_informations', id: 'a.md', ancres: ['f-0001'], dans: 'b.md', titreSiNouvelle: 'B' })).toEqual({
			ok: true,
			valeur: { action: 'deplacer_informations', id: 'a.md', ancres: ['f-0001'], dans: 'b.md', titreSiNouvelle: 'B' },
		});
		expect(demandeDEntretien({ action: 'deplacer_informations', id: 'a.md', dans: 'b.md' }).ok).toBe(false);
		expect(demandeDEntretien({ action: 'deplacer_informations', id: 'a.md', ancres: ['f-0001'] }).ok).toBe(false);
		expect(demandeDEntretien({ action: 'deplacer_informations', id: 'a.md', ancres: ['f-0001'], dans: 'b.md', ancre: 'f-0001' }).ok).toBe(false);
		expect(demandeDEntretien({ action: 'fusionner', id: 'a.md', dans: 'b.md', ancres: ['f-0001'] }).ok).toBe(false);
	});

	it('ficheTouchee : la fiche qui reçoit les informations', () => {
		expect(ficheTouchee({ nom: 'mcp__mnemo__entretenir', entree: { action: 'deplacer_informations', id: 'notes/a.md', ancres: ['f-0001'], dans: 'notes/b.md' } })).toEqual({ chemin: 'notes/b.md', action: 'ecrite' });
	});
});
