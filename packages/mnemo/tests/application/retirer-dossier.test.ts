import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { proposer } from '../../src/application/proposer.ts';
import { reindexerApresEcriture } from '../../src/application/synchroniser.ts';
import { presenterResultat } from '../../src/application/presenter.ts';
import { validerDemande } from '../../src/application/validation.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { git } from '../aides/git.ts';

/** Mémoire réelle (fichiers et git) : un dossier vide n'existe que sur un vrai disque. */
async function memoireReelle() {
	const racine = await dossierTemporaire();
	const dep = dependancesReelles(racine);
	await dep.historique.initialiser();
	await dep.coffre.ecrire('projets/alpha/alpha.md', '---\ntype: dossier\n---\n# Alpha\n');
	await dep.historique.commit('init', 'tout');
	return { dep, memoire: join(racine, '_mnemo'), racine };
}

const nbCommits = (dossier: string) => Number(git(dossier, 'rev-list', '--count', 'HEAD'));

describe('proposer : genre retirer_dossier', () => {
	it('dossier vide (sous-dossiers vides compris) : retiré, sans commit vide', async () => {
		const { dep, memoire } = await memoireReelle();
		await mkdir(join(memoire, 'clients', 'vieux'), { recursive: true });
		const avant = nbCommits(memoire);
		const r = await proposer(dep, { genre: 'retirer_dossier', dossier: 'clients/' });
		expect(r).toEqual({ statut: 'retire', dossier: 'clients', commit: null });
		expect(await readdir(memoire)).not.toContain('clients');
		expect(nbCommits(memoire)).toBe(avant);
		expect(presenterResultat(r)).toContain('clients');
	});

	it('un .DS_Store suivi par git : retiré avec le dossier, en un commit', async () => {
		const { dep, memoire } = await memoireReelle();
		await mkdir(join(memoire, 'clients'));
		await writeFile(join(memoire, 'clients', '.DS_Store'), 'x');
		await dep.historique.commit('manuel', 'tout');
		const r = await proposer(dep, { genre: 'retirer_dossier', dossier: 'clients' });
		expect(r).toMatchObject({ statut: 'retire', dossier: 'clients', commit: expect.any(String) });
		expect(git(memoire, 'log', '-1', '--format=%s')).toBe('mnemo: retire dossier clients');
		expect(git(memoire, 'status', '--porcelain')).toBe('');
	});

	it('une autre casse (« Clients » pour clients/ avec un .DS_Store suivi) : le dossier réel est retiré et commité, dépôt propre', async () => {
		const { dep, memoire } = await memoireReelle();
		await mkdir(join(memoire, 'clients'));
		await writeFile(join(memoire, 'clients', '.DS_Store'), 'x');
		await dep.historique.commit('manuel', 'tout');
		const r = await proposer(dep, { genre: 'retirer_dossier', dossier: 'Clients' });
		expect(r).toMatchObject({ statut: 'retire', dossier: 'clients', commit: expect.any(String) });
		expect(await readdir(memoire)).not.toContain('clients');
		expect(git(memoire, 'log', '-1', '--format=%s')).toBe('mnemo: retire dossier clients');
		expect(git(memoire, 'status', '--porcelain')).toBe('');
	});

	it('un dossier qui ne contient plus que sa fiche de dossier : retiré avec elle, en un commit', async () => {
		const { dep, memoire } = await memoireReelle();
		const avant = nbCommits(memoire);
		const r = await proposer(dep, { genre: 'retirer_dossier', dossier: 'projets/alpha' });
		expect(r).toMatchObject({ statut: 'retire', dossier: 'projets/alpha', commit: expect.any(String) });
		expect(await dep.coffre.lire('projets/alpha/alpha.md')).toBeNull();
		expect(await readdir(join(memoire, 'projets'))).not.toContain('alpha');
		expect(nbCommits(memoire)).toBe(avant + 1);
		expect(git(memoire, 'log', '-1', '--format=%s')).toBe('mnemo: retire dossier projets/alpha');
		expect(git(memoire, 'status', '--porcelain')).toBe('');
	});

	it('la fiche retirée avec son dossier disparaît aussi de l’index', async () => {
		const { dep } = await memoireReelle();
		await reindexerApresEcriture(dep);
		const chemins = async () => (await dep.index.elements({ genres: ['fiche'] })).map((e) => e.chemin);
		expect(await chemins()).toContain('projets/alpha/alpha.md');
		expect(await proposer(dep, { genre: 'retirer_dossier', dossier: 'projets/alpha' })).toMatchObject({ statut: 'retire' });
		expect(await chemins()).not.toContain('projets/alpha/alpha.md');
		dep.index.fermer();
	});

	it('commit en échec : la fiche du dossier est remise, l’erreur remonte', async () => {
		const { dep, memoire } = await memoireReelle();
		const texte = await dep.coffre.lire('projets/alpha/alpha.md');
		dep.historique = { ...dep.historique, commit: async () => { throw new Error('commit en panne'); } };
		await expect(proposer(dep, { genre: 'retirer_dossier', dossier: 'projets/alpha' })).rejects.toThrow('commit en panne');
		expect(await dep.coffre.lire('projets/alpha/alpha.md')).toBe(texte);
		expect(git(memoire, 'status', '--porcelain')).toBe('');
	});

	it('la fiche du dossier reste si un autre fichier (pas une fiche) ou un sous-dossier est là', async () => {
		const { dep, memoire } = await memoireReelle();
		await writeFile(join(memoire, 'projets', 'alpha', 'plan.txt'), 'x');
		const r = await proposer(dep, { genre: 'retirer_dossier', dossier: 'projets/alpha' });
		expect(r).toMatchObject({ statut: 'refuse' });
		expect(await dep.coffre.lire('projets/alpha/alpha.md')).not.toBeNull();
		await mkdir(join(memoire, 'projets', 'beta'));
		await dep.coffre.ecrire('projets/beta/beta.md', '---\ntype: dossier\n---\n# Beta\n');
		await mkdir(join(memoire, 'projets', 'beta', 'sous'));
		expect(await proposer(dep, { genre: 'retirer_dossier', dossier: 'projets/beta' })).toMatchObject({ statut: 'refuse' });
		expect(await dep.coffre.lire('projets/beta/beta.md')).not.toBeNull();
	});

	it('refus : non vide (fiche ou autre fichier), racine, lien symbolique, absent, caché', async () => {
		const { dep, memoire, racine } = await memoireReelle();
		await mkdir(join(memoire, 'notes'));
		await writeFile(join(memoire, 'notes', 'a.txt'), 'x');
		await dep.coffre.ecrire('projets/alpha/autre.md', '---\ntype: sujet\n---\n# Autre\n');
		await mkdir(join(racine, 'ailleurs'));
		await symlink(join(racine, 'ailleurs'), join(memoire, 'lien'));
		const motif = async (dossier: string) => {
			const r = await proposer(dep, { genre: 'retirer_dossier', dossier });
			expect(r.statut, dossier).toBe('refuse');
			return r.statut === 'refuse' ? r.motif : '';
		};
		expect(await motif('projets/alpha')).toMatch(/pas vide.*alpha\.md/u);
		expect(await motif('notes')).toMatch(/pas vide/u);
		expect(await motif('')).toMatch(/racine/u);
		expect(await motif('lien')).toMatch(/lien symbolique/u);
		expect(await motif('absent')).toMatch(/n'existe pas/u);
		expect(await motif('.git')).toMatch(/caché/u);
		expect(await motif('../dehors')).toMatch(/invalide/u);
		expect(await readdir(memoire)).toEqual(expect.arrayContaining(['projets', 'notes', 'lien']));
		expect(await readdir(join(racine, 'ailleurs'))).toEqual([]);
	});

	it('forme validée (MCP, HTTP) ; faux port : non vide refusé', async () => {
		expect(validerDemande({ genre: 'retirer_dossier', dossier: 'clients' })).toEqual({ ok: true, valeur: { genre: 'retirer_dossier', dossier: 'clients' } });
		expect(validerDemande({ genre: 'retirer_dossier' }).ok).toBe(false);
		const dep = fauxPorts();
		await dep.coffre.ecrire('clients/c.md', '# C\n');
		expect(await proposer(dep, { genre: 'retirer_dossier', dossier: 'clients' })).toMatchObject({ statut: 'refuse' });
		expect(dep.commits).toEqual([]);
	});
});
