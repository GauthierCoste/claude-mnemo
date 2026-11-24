import { describe, expect, it } from 'vitest';
import { avertissementIndex } from '../../src/application/synchroniser.ts';
import { ROUTES } from '@mnemo/contrat';
import type { ReponseDocuments, ReponseMarquerTraite, ReponseTraiter, SessionVue } from '@mnemo/contrat';
import { CHEMINS_LOT_MAX, DOCUMENTS_MAX, PARAMETRES_TOUT, SAUF_MAX } from '@mnemo/commun';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';

function api(c: ContexteService) {
	const { port, jeton } = c.service;
	return {
		get: (route: string) => appeler(port, 'GET', route, { jeton }),
		post: (route: string, corps?: unknown) => appeler(port, 'POST', route, { jeton, corps: corps ?? {} }),
	};
}

const source = (id: string, updated: string, plus: string, titre: string) => `---\nid: ${id}\ntype: source\nupdated: ${updated}\n${plus}---\n# ${titre}\n`;

/** Service avec deux fiches sources « à traiter » et une déjà traitée. */
async function avecSources(): Promise<ContexteService> {
	const c = await serviceFaux();
	await c.dep.coffre.ecrire('sources/claude-code/x/tests.md', source('S1', '2026-11-21', 'a_traiter: true\n', 'Tests'));
	await c.dep.coffre.ecrire('sources/claude-code/x/style.md', source('S2', '2026-11-20', 'a_traiter: true\n', 'Style'));
	await c.dep.coffre.ecrire('sources/devis.md', source('S3', '2026-11-10', 'chemin: alpha/devis.pdf\n', 'Devis'));
	return c;
}

const lue = (c: ContexteService, chemin: string) => lireFiche(chemin, c.dep.fichiers.get(chemin)!);

async function lancerArchiviste(c: ContexteService): Promise<SessionVue> {
	const r = await api(c).post(ROUTES.sessions, { profil: 'archiviste', dossier: '' });
	expect(r.statut).toBe(201);
	return (r.corps as { session: SessionVue }).session;
}

describe('POST memoire/sources/traiter et memoire/sources/marquer-traite : chemins validés', () => {
	it('corps mal formé, `..`, chemin absolu, pas une fiche : 400, rien d’écrit ni de tapé', async () => {
		const c = await avecSources();
		for (const route of [ROUTES.sourcesTraiter, ROUTES.sourcesMarquerTraite]) {
			for (const corps of [
				{},
				{ chemins: [] },
				{ chemins: 'sources/devis.md' },
				{ chemins: [3] },
				{ chemins: ['sources/devis.md'], autre: 1 },
				{ chemins: ['../secret.md'] },
				{ chemins: ['sources/../projets/alpha/alpha.md'] },
				{ chemins: ['/etc/passwd.md'] },
				{ chemins: ['sources\\..\\x.md'] },
				{ chemins: ['sources/devis.pdf'] },
				{ chemins: ['sources/x\u0007.md'] },
			]) {
				const r = await api(c).post(route, corps);
				expect(r.statut, `${route} ${JSON.stringify(corps)}`).toBe(400);
			}
		}
		expect(c.dep.commits).toHaveLength(0);
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('une fiche source rangée hors de sources/ se marque traitée ; une fiche qui n’est pas une source est ignorée', async () => {
		const c = await avecSources();
		await c.dep.coffre.ecrire('projets/alpha/devis.md', source('S4', '2026-11-22', 'a_traiter: true\n', 'Devis Alpha'));
		await c.dep.coffre.ecrire('projets/alpha/alpha.md', '---\nid: 01ALP\ntype: dossier\na_traiter: true\nupdated: 2026-11-01\n---\n# Alpha\n');
		const r = await api(c).post(ROUTES.sourcesMarquerTraite, { chemins: ['projets/alpha/devis.md', 'projets/alpha/alpha.md'] });
		expect(r.statut).toBe(200);
		expect((r.corps as ReponseMarquerTraite).traites).toEqual(['projets/alpha/devis.md']);
		expect(lue(c, 'projets/alpha/devis.md').donnees['a_traiter']).toBeUndefined();
	});
});

describe('POST memoire/sources/traiter-toutes', () => {
	it('toutes les fiches à traiter, sans liste du client (au-delà de ce que l’interface affiche) : une seule consigne', async () => {
		const c = await avecSources();
		await lancerArchiviste(c);
		const terminal = c.terminaux.lances[0]!;
		const r = await api(c).post(ROUTES.sourcesTraiterToutes, { sauf: [] });
		expect(r.statut).toBe(200);
		expect((r.corps as ReponseTraiter).chemins.sort()).toEqual(['sources/claude-code/x/style.md', 'sources/claude-code/x/tests.md']);
		expect((r.corps as ReponseTraiter).archiviste).toBe('confie');
		expect(await jusqua(() => terminal.ecrits.some((e) => e.startsWith('Traite les 2 fiches sources')), 2000)).toBe(true);
	});

	it('les fiches déjà confiées (`sauf`) ne sont ni rendues ni nommées dans la consigne', async () => {
		const c = await avecSources();
		await lancerArchiviste(c);
		const terminal = c.terminaux.lances[0]!;
		const r = await api(c).post(ROUTES.sourcesTraiterToutes, { sauf: ['sources/claude-code/x/style.md'] });
		expect(r.statut).toBe(200);
		expect((r.corps as ReponseTraiter).chemins).toEqual(['sources/claude-code/x/tests.md']);
		expect(await jusqua(() => terminal.ecrits.some((e) => e.startsWith('Traite la fiche source « à traiter » (a_traiter) « sources/claude-code/x/tests.md »')), 2000)).toBe(true);
		expect(terminal.ecrits.some((e) => e.includes('style.md'))).toBe(false);
	});

	it('aucune fiche à traiter hors des déjà confiées : 409 ; `sauf` mal formé : 400', async () => {
		const c = await avecSources();
		expect((await api(c).post(ROUTES.sourcesTraiterToutes, { sauf: ['sources/claude-code/x/style.md', 'sources/claude-code/x/tests.md'] })).statut).toBe(409);
		const tropNombreuses = Array.from({ length: SAUF_MAX + 1 }, (_, i) => `sources/f${i}.md`);
		for (const corps of [{}, { sauf: 'sources/devis.md' }, { sauf: ['../secret.md'] }, { sauf: [], autre: 1 }, { sauf: tropNombreuses }]) {
			expect((await api(c).post(ROUTES.sourcesTraiterToutes, corps)).statut, JSON.stringify(corps).slice(0, 80)).toBe(400);
		}
		await api(c).post(ROUTES.sourcesMarquerTraite, { chemins: ['sources/claude-code/x/style.md', 'sources/claude-code/x/tests.md'] });
		expect((await api(c).post(ROUTES.sourcesTraiterToutes, { sauf: [] })).statut).toBe(409);
	});
});

describe('POST memoire/sources/traiter', () => {
	it('archiviste qui tourne : une seule consigne (celle de l’import, qui nomme les fiches) tapée en fond ; rien n’est écrit', async () => {
		const c = await avecSources();
		await lancerArchiviste(c);
		const terminal = c.terminaux.lances[0]!;
		const commits = c.dep.commits.length;
		const r = await api(c).post(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/x/tests.md', 'sources/claude-code/x/style.md', 'sources/claude-code/x/tests.md'] });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ chemins: ['sources/claude-code/x/tests.md', 'sources/claude-code/x/style.md'], archiviste: 'confie' } satisfies ReponseTraiter);
		expect(await jusqua(() => terminal.ecrits.some((e) => e.startsWith('Traite les 2 fiches sources')), 2000)).toBe(true);
		const consignes = terminal.ecrits.filter((e) => e.startsWith('Traite '));
		expect(consignes).toHaveLength(1);
		expect(consignes[0]).toContain('« sources/claude-code/x/tests.md »');
		expect(consignes[0]).toContain('« sources/claude-code/x/style.md »');
		expect(consignes[0]).toContain('`traitee: true`');
		// une seule ligne : jamais un retour à la ligne au milieu de la consigne
		expect(consignes[0]!.replace(/\r$/u, '')).not.toMatch(/[\r\n]/u);
		expect(c.dep.commits).toHaveLength(commits);
	});

	it('sans archiviste : il est lancé avec la consigne pour objectif', async () => {
		const c = await avecSources();
		const r = await api(c).post(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/x/tests.md'] });
		expect(r.statut).toBe(200);
		expect(r.corps).toMatchObject({ chemins: ['sources/claude-code/x/tests.md'], archiviste: 'lance' });
		const sessions = ((await api(c).get(ROUTES.sessions)).corps as { sessions: SessionVue[] }).sessions;
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({ profil: 'archiviste' });
		expect(sessions[0]!.objectif).toMatch(/^Traite la fiche source « à traiter » \(a_traiter\) « sources\/claude-code\/x\/tests\.md »/u);
	});

	it('archiviste en pause : repris, puis la consigne tapée ; jamais un second archiviste', async () => {
		const c = await avecSources();
		const archiviste = await lancerArchiviste(c);
		expect((await api(c).post(ROUTES.pause.replace(':id', archiviste.id))).statut).toBe(200);
		const r = await api(c).post(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/x/style.md'] });
		expect(r.statut).toBe(200);
		expect(r.corps).toMatchObject({ archiviste: 'repris' });
		expect(await jusqua(() => c.terminaux.lances.length === 2, 2000)).toBe(true);
		// la consigne attend le `debut` de la session reprise (son hook), jamais tapée avant
		expect(c.terminaux.lances[1]!.ecrits.some((e) => e.startsWith('Traite '))).toBe(false);
		await api(c).post(ROUTES.hook, { evenement: 'debut', session: archiviste.id, horodatageMs: Date.now(), cwd: null });
		expect(await jusqua(() => c.terminaux.lances[1]!.ecrits.some((e) => e.startsWith('Traite la fiche source')), 3000)).toBe(true);
		expect(c.terminaux.lances[1]!.options.args).toContain('--resume');
		const sessions = ((await api(c).get(ROUTES.sessions)).corps as { sessions: SessionVue[] }).sessions;
		expect(sessions.filter((s) => s.profil === 'archiviste')).toHaveLength(1);
	});

	it('archiviste en pause, terminaux indisponibles : `manuel` avec la commande qui le reprend et la consigne', async () => {
		const c = await avecSources();
		const archiviste = await lancerArchiviste(c);
		expect((await api(c).post(ROUTES.pause.replace(':id', archiviste.id))).statut).toBe(200);
		c.terminaux.indisponible = 'node-pty absent';
		const r = await api(c).post(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/x/style.md'] });
		expect(r.statut).toBe(200);
		const corps = r.corps as ReponseTraiter;
		expect(corps).toMatchObject({ chemins: ['sources/claude-code/x/style.md'], archiviste: 'manuel' });
		expect(corps.manuel).toContain(`'--resume' '${archiviste.id}'`);
		expect(corps.manuel).toContain('Traite la fiche source');
		expect(c.terminaux.lances).toHaveLength(1);
	});

	it('archiviste en pause, terminaux indisponibles, dossier de l’archiviste introuvable : 409 avec le motif, rien de lancé', async () => {
		const c = await avecSources();
		const archiviste = await lancerArchiviste(c);
		expect((await api(c).post(ROUTES.pause.replace(':id', archiviste.id))).statut).toBe(200);
		c.terminaux.indisponible = 'node-pty absent';
		c.pil.hote.dossier = async () => null;
		const r = await api(c).post(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/x/style.md'] });
		expect(r.statut).toBe(409);
		expect(r.corps).toEqual({ erreur: expect.stringMatching(/^Commande de reprise de l’archiviste impossible : Dossier de session introuvable/u) });
		expect(c.terminaux.lances).toHaveLength(1);
	});

	it('lancements concurrents (« Traiter », « Lancer l’archiviste ») : un seul archiviste, les autres réutilisent celui-là', async () => {
		const c = await avecSources();
		const reponses = await Promise.all([
			api(c).post(ROUTES.sessions, { profil: 'archiviste', dossier: '' }),
			api(c).post(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/x/tests.md'] }),
			api(c).post(ROUTES.sessions, { profil: 'archiviste', dossier: '' }),
			api(c).post(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/x/style.md'] }),
			api(c).post(ROUTES.sessions, { profil: 'archiviste', dossier: '' }),
		]);
		expect(reponses.map((r) => r.statut).every((s) => s === 200 || s === 201)).toBe(true);
		const sessions = ((await api(c).get(ROUTES.sessions)).corps as { sessions: SessionVue[] }).sessions;
		expect(sessions.filter((s) => s.profil === 'archiviste')).toHaveLength(1);
		expect(c.terminaux.lances).toHaveLength(1);
		const id = sessions[0]!.id;
		for (const r of reponses.filter((x) => (x.corps as { session?: SessionVue }).session !== undefined)) expect((r.corps as { session: SessionVue }).session.id).toBe(id);
	});

	it('fiche déjà traitée ou absente : 409, rien de tapé', async () => {
		const c = await avecSources();
		await lancerArchiviste(c);
		const r = await api(c).post(ROUTES.sourcesTraiter, { chemins: ['sources/devis.md', 'sources/absente.md'] });
		expect(r.statut).toBe(409);
		expect(c.terminaux.lances[0]!.ecrits.filter((e) => e.startsWith('Traite '))).toHaveLength(0);
	});
});

describe('POST memoire/sources/marquer-traite', () => {
	it('retire la marque (un commit par fiche), ne crée rien d’autre ; les fiches déjà traitées sont ignorées ; `memoire` diffusé', async () => {
		const c = await avecSources();
		const r = await api(c).post(ROUTES.sourcesMarquerTraite, { chemins: ['sources/claude-code/x/tests.md', 'sources/devis.md'] });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ traites: ['sources/claude-code/x/tests.md'] } satisfies ReponseMarquerTraite);
		expect(lue(c, 'sources/claude-code/x/tests.md').donnees['a_traiter']).toBeUndefined();
		expect(lue(c, 'sources/claude-code/x/style.md').donnees['a_traiter']).toBe(true);
		expect(c.dep.commits).toHaveLength(1);
		expect([...c.dep.fichiers.keys()].filter((f) => f.startsWith('sources/')).sort()).toEqual(['sources/claude-code/x/style.md', 'sources/claude-code/x/tests.md', 'sources/devis.md']);
		const documents = (await api(c).get(ROUTES.documents)).corps as { aTraiter: { chemin: string }[] };
		expect(documents.aTraiter.map((d) => d.chemin)).toEqual(['sources/claude-code/x/style.md']);
		// rien à faire : aucune écriture
		expect((await api(c).post(ROUTES.sourcesMarquerTraite, { chemins: ['sources/devis.md'] })).corps).toEqual({ traites: [] });
		expect(c.dep.commits).toHaveLength(1);
	});
});

describe('POST memoire/sources/marquer-traite : index en panne après l\'écriture', () => {
	it('marque retirée, succès avec l\'avertissement', async () => {
		const c = await avecSources();
		c.dep.index.fiches = async () => {
			throw new Error('index cassé');
		};
		const r = await api(c).post(ROUTES.sourcesMarquerTraite, { chemins: ['sources/claude-code/x/tests.md'] });
		expect(r.statut, r.texte).toBe(200);
		expect(r.corps).toEqual({ traites: ['sources/claude-code/x/tests.md'], avertissements: [avertissementIndex('index cassé')] } satisfies ReponseMarquerTraite);
		expect(lue(c, 'sources/claude-code/x/tests.md').donnees['a_traiter']).toBeUndefined();
	});
});

describe('POST memoire/sources/marquer-traite : un lot, tout ou rien', () => {
	it('plusieurs fiches : un seul commit pour le lot ; les déjà traitées ignorées', async () => {
		const c = await avecSources();
		const r = await api(c).post(ROUTES.sourcesMarquerTraite, { chemins: ['sources/claude-code/x/tests.md', 'sources/devis.md', 'sources/claude-code/x/style.md'] });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ traites: ['sources/claude-code/x/tests.md', 'sources/claude-code/x/style.md'] } satisfies ReponseMarquerTraite);
		expect(c.dep.commits).toHaveLength(1);
		expect(lue(c, 'sources/claude-code/x/tests.md').donnees['a_traiter']).toBeUndefined();
		expect(lue(c, 'sources/claude-code/x/style.md').donnees['a_traiter']).toBeUndefined();
	});

	it('échec d’écriture : aucune fiche modifiée (tout ou rien), erreur rendue', async () => {
		const c = await avecSources();
		const avant = new Map(c.dep.fichiers);
		c.dep.historique.commit = async () => {
			throw new Error('dépôt verrouillé');
		};
		const r = await api(c).post(ROUTES.sourcesMarquerTraite, { chemins: ['sources/claude-code/x/tests.md', 'sources/claude-code/x/style.md'] });
		expect(r.statut).toBeGreaterThanOrEqual(400);
		expect(new Map(c.dep.fichiers)).toEqual(avant);
	});

	it(`au-delà de ${CHEMINS_LOT_MAX} chemins : 400, motif clair, rien d’écrit`, async () => {
		const c = await avecSources();
		const chemins = Array.from({ length: CHEMINS_LOT_MAX + 1 }, (_, i) => `sources/x${i}.md`);
		const r = await api(c).post(ROUTES.sourcesMarquerTraite, { chemins });
		expect(r.statut).toBe(400);
		expect(JSON.stringify(r.corps)).toContain(`${CHEMINS_LOT_MAX} fiches au plus`);
		expect(c.dep.commits).toHaveLength(0);
	});
});

describe('GET memoire/documents : toutes les fiches à traiter', () => {
	it('`aTraiter` : toutes les sources marquées, même au-delà des documents récents', async () => {
		const c = await avecSources();
		for (let i = 0; i < 55; i++) await c.dep.coffre.ecrire(`sources/recents/r${String(i).padStart(2, '0')}.md`, source(`R${i}`, '2026-11-22', '', `Récent ${i}`));
		const r = (await api(c).get(ROUTES.documents)).corps as ReponseDocuments;
		expect(r.documents).toHaveLength(DOCUMENTS_MAX);
		expect(r.documents.some((d) => d.chemin.startsWith('sources/claude-code/'))).toBe(false);
		expect(r.aTraiter.map((d) => [d.chemin, d.aTraiter])).toEqual([
			['sources/claude-code/x/tests.md', true],
			['sources/claude-code/x/style.md', true],
		]);
	});

	it('les totaux disent ce que la liste coupée ne montre pas ; `tout` rend tout', async () => {
		const c = await avecSources();
		for (let i = 0; i < 55; i++) await c.dep.coffre.ecrire(`sources/recents/r${String(i).padStart(2, '0')}.md`, source(`R${i}`, '2026-11-22', '', `Récent ${i}`));
		const coupee = (await api(c).get(ROUTES.documents)).corps as ReponseDocuments;
		expect(coupee.totalDocuments).toBeGreaterThan(DOCUMENTS_MAX);
		expect(coupee.totalATraiter).toBe(2);
		const toute = (await api(c).get(`${ROUTES.documents}?${new URLSearchParams(PARAMETRES_TOUT)}`)).corps as ReponseDocuments;
		expect(toute.documents).toHaveLength(coupee.totalDocuments);
		expect(toute.totalDocuments).toBe(coupee.totalDocuments);
	});
});
