import { describe, expect, it } from 'vitest';
import { chercher } from '../../src/application/chercher.ts';
import { diagnostiquer } from '../../src/application/diagnostiquer.ts';
import { proposer } from '../../src/application/proposer.ts';
import { elementsDeFiche } from '../../src/domaine/elements.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { sansFaitsBarres } from '../../src/domaine/sans-faits-barres.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

// Le faux système est au 2026-11-22 : une fiche périmée le 2026-11-22 ne l'est plus ce jour-là (fin exclue).
const entete = (extra = '') => `---\nid: 01ABC\ntype: sujet\n${extra}updated: 2026-11-01\n---\n`;
const ligne = (texte: string, ancre: string, extra = '') => `- ${texte} | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 %${extra} ^${ancre}`;
const etat = (perimeLe: string) => `${entete(`perime_le: ${perimeLe}\n`)}# État du chantier\n\nOù en est le chantier zanzibar.\n\n## Informations\n${ligne('Zanzibar : lot 2 en recette', 'f-0001')}\n`;
const dit = { ref: 'dit', type: 'utilisateur' } as const;

describe('fiches temporaires et informations expirées', () => {
	it('les éléments d\'une fiche portent sa péremption ; un fait qui expire avant garde sa propre fin', () => {
		const texte = `${entete('perime_le: 2026-12-01\n')}# É\n\nSynthèse.\n\n## Informations\n${ligne('Tôt', 'f-0001', ' | valide [,2026-11-25]')}\n${ligne('Tard', 'f-0002', ' | valide [,2027-01-01)')}\n`;
		const fins = elementsDeFiche('e.md', texte).elements.map((e) => [e.genre, e.valideFin, e.finIncluse]);
		expect(fins).toEqual([
			['fiche', '2026-12-01', false],
			['fait', '2026-11-25', true],
			['fait', '2026-12-01', false],
			['passage', '2026-12-01', false],
		]);
	});

	it('chercher : une fiche périmée et ses informations sont écartées par défaut, rendues avec les invalides', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('etat.md', etat('2026-11-22'));
		expect(await chercher(dep, { texte: 'zanzibar' })).toEqual([]);
		expect((await chercher(dep, { texte: 'zanzibar', inclureInvalides: true })).map((t) => t.id)).toContain('etat.md#^f-0001');
		await dep.coffre.ecrire('etat.md', etat('2026-11-23'));
		expect((await chercher(dep, { texte: 'zanzibar' })).map((t) => t.id)).toContain('etat.md#^f-0001');
	});

	it('chercher : une information dont la validité est passée est écartée par défaut', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Informations\n${ligne('Zanzibar expiré', 'f-0001', ' | valide [,2026-11-21]')}\n${ligne('Zanzibar valable', 'f-0002', ' | valide [,2026-11-22]')}\n`);
		expect((await chercher(dep, { texte: 'zanzibar' })).map((t) => t.id)).toEqual(['a.md#^f-0002']);
	});

	it('injection : les informations expirées sont omises avec leur citation, les autres gardées', () => {
		const texte = `# A\n\n## Informations\n${ligne('Expirée', 'f-0001', ' | valide [,2026-11-22)')}\n  > « citée »\n${ligne('Gardée', 'f-0002', ' | valide [,2026-11-22]')}\n${ligne('Sans fin', 'f-0003')}\n`;
		const injecte = sansFaitsBarres(texte, '2026-11-22');
		expect(injecte).not.toContain('Expirée');
		expect(injecte).not.toContain('citée');
		expect(injecte).toContain('Gardée');
		expect(injecte).toContain('Sans fin');
		expect(sansFaitsBarres(texte)).toBe(texte);
	});

	it('proposer : perime_le se pose à la création (donnees) et par une modification ; une date invalide est refusée ; « » le retire', async () => {
		const dep = fauxPorts();
		expect(await proposer(dep, { genre: 'fiche', chemin: 'etats/Chantier.md', type: 'sujet', titre: 'Chantier', donnees: { perime_le: 'demain' } })).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, { genre: 'fiche', chemin: 'etats/Chantier.md', type: 'sujet', titre: 'Chantier', donnees: { perime_le: '2026-12-15' } })).toMatchObject({ statut: 'ecrit' });
		const lue = () => lireFiche('etats/Chantier.md', dep.fichiers.get('etats/Chantier.md')!).donnees['perime_le'];
		expect(lue()).toBe('2026-12-15');
		expect(await proposer(dep, { genre: 'modification', fiche: 'etats/Chantier.md', perime_le: '15/12/2026', source: dit })).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, { genre: 'modification', fiche: 'etats/Chantier.md', perime_le: '2027-01-10', source: dit })).toMatchObject({ statut: 'ecrit', changements: ['perime_le : 2026-12-15 → 2027-01-10'] });
		expect(lue()).toBe('2027-01-10');
		await proposer(dep, { genre: 'modification', fiche: 'etats/Chantier.md', perime_le: '', source: dit });
		expect(lue()).toBeUndefined();
	});

	it('diagnostiquer : la rubrique perimees liste les fiches temporaires périmées et les informations expirées non barrées', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('etat.md', etat('2026-11-20'));
		await dep.coffre.ecrire('vivant.md', etat('2026-12-20'));
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Informations\n${ligne('Expirée', 'f-0001', ' | valide [,2026-11-21]')}\n`);
		const texte = await diagnostiquer(dep, { rubriques: ['perimees'] });
		expect(texte).toContain('- perimees : 2');
		expect(texte).toContain('- etat.md : fiche temporaire, périmée depuis le 2026-11-20');
		expect(texte).toContain("- a.md#^f-0001 « Expirée » : valide jusqu'au 2026-11-21 inclus");
		expect(texte).not.toContain('vivant.md');
	});
});
