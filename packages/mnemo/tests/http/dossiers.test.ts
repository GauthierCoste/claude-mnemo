import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FICHIERS_GIT_MAX, PARAMETRES_TOUT } from '@mnemo/commun';
import { ROUTES } from '@mnemo/contrat';
import type { DossierVue, GitDossierVue, NiveauDossiersVue } from '@mnemo/contrat';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import type { Session } from '../../src/domaine/session.ts';
import { depotGit } from '../../src/infra/depot-git.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { git } from '../aides/git.ts';
import { appeler, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';

const get = (c: ContexteService, route: string) => appeler(c.service.port, 'GET', route, { jeton: c.service.jeton });

function session(id: string, dossier: string, etat: Session['etat'] = 'attend'): Session {
	return {
		id, profil: 'travail', dossier, position: '', projet: 'p', objectif: null, etat, creeeMs: 1, majMs: 1,
		arretAttendu: etat === 'terminee' ? 'abandon' : null, bilanDemandeMs: null, commitDebut: null, branche: null, pid: null,
	};
}

describe('routes : dossiers de la racine', () => {
	it('GET dossiers : tous les sous-dossiers de la racine, cachés compris, triés par nom ; ni _mnemo/, ni .mnemo/, ni liens ; sessions non terminées comptées', async () => {
		const c = await serviceFaux({}, { pil: (p) => (p.depot = depotGit(p.plugin.racine)) });
		for (const d of ['beta', 'gamma/sous', 'mnemo', '.cache', 'node_modules', '_mnemo', 'Site/.git']) await mkdir(join(c.racine, d), { recursive: true });
		await writeFile(join(c.racine, 'fichier.txt'), 'x');
		await writeFile(join(c.racine, 'beta/Package.json'), '{}');
		await symlink(await dossierTemporaire(), join(c.racine, 'lien'));
		await c.etat.creer(session('11111111-2222-4333-8444-000000000001', 'alpha'));
		await c.etat.creer(session('11111111-2222-4333-8444-000000000002', 'alpha'));
		await c.etat.creer(session('11111111-2222-4333-8444-000000000003', 'alpha', 'terminee'));
		await c.etat.creer(session('11111111-2222-4333-8444-000000000004', 'gamma/sous'));

		const r = await get(c, ROUTES.dossiers);
		expect(r.statut).toBe(200);
		const vue = (chemin: string, o: Partial<DossierVue> = {}): DossierVue => ({ chemin, nom: chemin, git: false, marque: false, sessions: 0, erreur: null, ...o });
		expect((r.corps as NiveauDossiersVue).sousDossiers).toEqual([
			vue('.cache'),
			vue('alpha', { sessions: 2 }),
			vue('beta', { marque: true }),
			vue('gamma'),
			// un « mnemo » sans « _ » est un dossier ordinaire
			vue('mnemo'),
			vue('node_modules'),
			vue('Site', { git: true, marque: true }),
		]);
		// la racine est décrite comme tout dossier
		await mkdir(join(c.racine, '.git'));
		await writeFile(join(c.racine, 'package.json'), '{}');
		await c.etat.creer(session('11111111-2222-4333-8444-000000000005', ''));
		expect(((await get(c, ROUTES.dossiers)).corps as NiveauDossiersVue).dossier).toEqual({ chemin: '', nom: '', git: true, marque: true, sessions: 1, erreur: null });
		expect((await get(c, `${ROUTES.dossiers}?chemin=gamma`)).corps).toEqual({ dossier: vue('gamma'), sousDossiers: [{ chemin: 'gamma/sous', nom: 'sous', git: false, marque: false, sessions: 1, erreur: null }] });
	});

	it('un dossier de n\'importe quel nom, à n\'importe quelle profondeur, caché ou non, sans git ni marqueur : atteint par dépliages successifs, il reçoit une session', async () => {
		const c = await serviceFaux();
		await mkdir(join(c.racine, 'Documents/Paula/.archives/2026 « bilan »'), { recursive: true });
		const noms = async (chemin: string) => ((await get(c, `${ROUTES.dossiers}?chemin=${encodeURIComponent(chemin)}`)).corps as NiveauDossiersVue).sousDossiers.map((d) => d.chemin);
		expect(await noms('')).toContain('Documents');
		expect(await noms('Documents')).toEqual(['Documents/Paula']);
		expect(await noms('Documents/Paula')).toEqual(['Documents/Paula/.archives']);
		expect(await noms('Documents/Paula/.archives')).toEqual(['Documents/Paula/.archives/2026 « bilan »']);

		const dossier = 'Documents/Paula/.archives/2026 « bilan »';
		c.existants.add(dossier);
		const r = await appeler(c.service.port, 'POST', ROUTES.sessions, { jeton: c.service.jeton, corps: { profil: 'travail', dossier } });
		expect(r.statut).toBe(201);
		expect(r.corps).toMatchObject({ session: { dossier } });
		const parent = ((await get(c, `${ROUTES.dossiers}?chemin=${encodeURIComponent('Documents/Paula/.archives')}`)).corps as NiveauDossiersVue).sousDossiers;
		expect(parent).toEqual([{ chemin: dossier, nom: '2026 « bilan »', git: false, marque: false, sessions: 1, erreur: null }]);
	});

	// chmod 000 ne rend pas un dossier illisible sous Windows (ni pour root) : un dossier illisible ne s'y fabrique pas ainsi
	it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('un dossier illisible rend son erreur, ses voisins s\'affichent ; le déplier rend 404', async () => {
		const c = await serviceFaux();
		await mkdir(join(c.racine, 'Projets/A/.git'), { recursive: true });
		await mkdir(join(c.racine, 'Projets/Ferme'), { recursive: true });
		await chmod(join(c.racine, 'Projets/Ferme'), 0o000);
		try {
			const r = await get(c, `${ROUTES.dossiers}?chemin=Projets`);
			expect(r.statut).toBe(200);
			const liste = (r.corps as NiveauDossiersVue).sousDossiers;
			expect(liste.map((d) => [d.chemin, d.git, d.erreur === null])).toEqual([
				['Projets/A', true, true],
				['Projets/Ferme', false, false],
			]);
			expect(liste[1]!.erreur).toMatch(/lecture refusée/u);
			const ferme = await get(c, `${ROUTES.dossiers}?chemin=Projets/Ferme`);
			expect(ferme.statut).toBe(404);
			expect(ferme.corps).toEqual({ erreur: expect.stringMatching(/Projets\/Ferme.*lecture refusée/u) });
		} finally {
			await chmod(join(c.racine, 'Projets/Ferme'), 0o755);
		}
	});

	it('GET dossiers : chemin refusé (400) ou introuvable (404) ; un lien symbolique ne se déplie pas', async () => {
		const c = await serviceFaux();
		await mkdir(join(c.racine, '_mnemo'), { recursive: true });
		await symlink(await dossierTemporaire(), join(c.racine, 'lien'));
		for (const chemin of ['../x', '/etc', '_mnemo', '_MNEMO', '.mnemo', 'a//b']) expect((await get(c, `${ROUTES.dossiers}?chemin=${encodeURIComponent(chemin)}`)).statut, chemin).toBe(400);
		expect((await get(c, `${ROUTES.dossiers}?chemin=absent`)).statut).toBe(404);
		expect((await get(c, `${ROUTES.dossiers}?chemin=lien`)).statut).toBe(404);
	});

	it('GET dossiers : « marque » suit le réglage projets.marqueurs à chaque appel', async () => {
		const c = await serviceFaux();
		await writeFile(join(c.racine, 'alpha/Makefile'), 'tout:\n');
		const marque = async () => ((await get(c, ROUTES.dossiers)).corps as NiveauDossiersVue).sousDossiers.find((d) => d.chemin === 'alpha')?.marque;
		expect(await marque()).toBe(false);
		c.dep.reglages = () => ({ ...REGLAGES_PAR_DEFAUT, projets: { ...REGLAGES_PAR_DEFAUT.projets, marqueurs: ['makefile'] } });
		expect(await marque()).toBe(true);
	});

	it('POST sessions : un dossier caché ou profond est accepté ; « ../x », _mnemo/ et .mnemo/ refusés', async () => {
		const c = await serviceFaux();
		await mkdir(join(c.racine, 'Projets/A/.git'), { recursive: true });
		await mkdir(join(c.racine, '.cache'));
		c.existants.add('Projets/A');
		c.existants.add('.cache');
		c.existants.add('.mnemo');
		const post = (dossier: string) => appeler(c.service.port, 'POST', ROUTES.sessions, { jeton: c.service.jeton, corps: { profil: 'travail', dossier } });
		expect(await post('Projets/A')).toMatchObject({ statut: 201, corps: { session: { dossier: 'Projets/A' } } });
		expect(await post('.cache')).toMatchObject({ statut: 201, corps: { session: { dossier: '.cache' } } });
		for (const d of ['../x', '_mnemo', '_mnemo/fiches', '.mnemo', '.Mnemo/plugins']) expect((await post(d)).statut, d).toBe(400);
	});

	it('GET dossiers/git : `fichiers` bornés par FICHIERS_GIT_MAX, `modifies` est le vrai total (au-delà de 200 compris)', async () => {
		const c = await serviceFaux({}, { pil: (p) => (p.depot = depotGit(p.plugin.racine)) });
		const projet = join(c.racine, 'beta');
		await mkdir(projet);
		c.existants.add('beta');
		git(projet, 'init', '--initial-branch=travail');
		const nombre = 205;
		await Promise.all(Array.from({ length: nombre }, (_, i) => writeFile(join(projet, `f${i}.txt`), 'x\n')));
		const vue = (await get(c, `${ROUTES.dossierGit}?chemin=beta`)).corps as NonNullable<GitDossierVue>;
		expect(vue.fichiers).toHaveLength(FICHIERS_GIT_MAX);
		expect(vue.modifies).toBe(nombre);
		// PARAMETRES_TOUT : tous les fichiers, même total
		const tout = (await get(c, `${ROUTES.dossierGit}?chemin=beta&${new URLSearchParams(PARAMETRES_TOUT)}`)).corps as NonNullable<GitDossierVue>;
		expect(tout.fichiers).toHaveLength(nombre);
		expect(tout.modifies).toBe(nombre);
	});

	it('GET dossiers/git : branche et statuts M/A d\'un dépôt ; null hors dépôt ; chemins refusés', async () => {
		const c = await serviceFaux({}, { pil: (p) => (p.depot = depotGit(p.plugin.racine)) });
		const projet = join(c.racine, 'alpha');
		git(projet, 'init', '--initial-branch=travail');
		await writeFile(join(projet, 'suivi.txt'), 'un\n');
		git(projet, 'add', '-A');
		git(projet, 'commit', '-m', 'premier');
		await writeFile(join(projet, 'suivi.txt'), 'deux\n');
		await writeFile(join(projet, 'nouveau.txt'), 'n\n');

		const r = await get(c, `${ROUTES.dossierGit}?chemin=alpha`);
		expect(r.statut).toBe(200);
		const vue = r.corps as NonNullable<GitDossierVue>;
		expect(vue.branche).toBe('travail');
		expect(vue.modifies).toBe(2);
		expect([...vue.fichiers].sort((a, b) => a.chemin.localeCompare(b.chemin))).toEqual([
			{ chemin: 'nouveau.txt', statut: 'A' },
			{ chemin: 'suivi.txt', statut: 'M' },
		]);

		// gardé 10 s : un changement ne se voit pas tout de suite
		await writeFile(join(projet, 'encore.txt'), 'e\n');
		expect(((await get(c, `${ROUTES.dossierGit}?chemin=alpha`)).corps as NonNullable<GitDossierVue>).modifies).toBe(2);

		await mkdir(join(c.racine, 'libre'));
		c.existants.add('libre');
		const libre = await get(c, `${ROUTES.dossierGit}?chemin=libre`);
		expect(libre.statut).toBe(200);
		expect(libre.corps).toBeNull();

		for (const chemin of ['../x', '/etc', 'alpha/../..', '_mnemo', '_MNEMO', '.mnemo']) expect((await get(c, `${ROUTES.dossierGit}?chemin=${encodeURIComponent(chemin)}`)).statut, chemin).toBe(400);
		expect((await get(c, `${ROUTES.dossierGit}?chemin=absent`)).statut).toBe(404);
		expect((await get(c, ROUTES.dossierGit)).statut).toBe(400);
	});
});
