import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import { PARAMETRES_TOUT, SESSIONS_DE_FICHE_MAX } from '@mnemo/commun';
import type { DonneesGraphe, FicheVue, ResultatEcriture, SanteVue } from '@mnemo/contrat';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { empreinte } from '../../src/domaine/empreinte.ts';
import type { Session } from '../../src/domaine/session.ts';
import { racineAffichee } from '../../src/adaptateurs/http/vues.ts';
import { appeler, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';

const S1 = '11111111-2222-4333-8444-555555555555';
const S2 = '22222222-2222-4333-8444-555555555555';
const STOCKS = 'projets/alpha/Module stocks.md';
const TEXTE_STOCKS =
	'---\nid: 01STK\ntype: sujet\nalias:\n  - Stocks\nupdated: 2026-11-01\nportee: projet:alpha\n---\n# Module stocks\n\nVoir [[projets/alpha/alpha]] et [[Inexistante]].\n\n## Relations\n- concerne [[clients/acme]]\n';

function api(c: ContexteService) {
	const { port, jeton } = c.service;
	return {
		get: (route: string, params: Record<string, string> = {}) => appeler(port, 'GET', `${route}${Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : ''}`, { jeton }),
		post: (route: string, corps?: unknown) => appeler(port, 'POST', route, { jeton, corps: corps ?? {} }),
	};
}

function session(id: string, surcharge: Partial<Session> = {}): Session {
	return {
		id, profil: 'travail', dossier: 'alpha', position: 'projets/alpha', projet: 'alpha', objectif: 'Objectif', etat: 'attend', creeeMs: 1000, majMs: 1000,
		arretAttendu: null, bilanDemandeMs: null, commitDebut: null, branche: null, pid: null, ...surcharge,
	};
}

async function avecMemoire(): Promise<ContexteService> {
	const c = await serviceFaux();
	await c.dep.coffre.ecrire(STOCKS, TEXTE_STOCKS);
	await c.dep.coffre.ecrire('clients/acme.md', '---\nid: 01ACM\ntype: entite\nupdated: 2026-11-01\n---\n# Acme\n\nClient du [[Stocks]].\n\n## Relations\n- utilise [[projets/alpha/Module stocks]]\n');
	await synchroniser(c.dep);
	return c;
}

describe('routes : vues de la mémoire', () => {
	it('GET sante : racine (abrégée et absolue), terminaux, version', async () => {
		const c = await serviceFaux();
		const r = await api(c).get(ROUTES.sante);
		expect(r.statut).toBe(200);
		const sante = r.corps as SanteVue;
		expect(sante).toMatchObject({ ok: true, pid: process.pid, racineAbsolue: c.racine, terminaux: { ok: true } });
		expect(typeof sante.version).toBe('string');
		expect(sante.version).toMatch(/^\d+\.\d+\.\d+/u);
		expect(sante.racine.endsWith(c.racine.split(/[\\/]/u).pop()!)).toBe(true);
	});

	it('racine affichée : `~` pour le dossier personnel, seulement à une frontière de segment', () => {
		expect(racineAffichee('/Users/ana/Projets/erp', '/Users/ana')).toBe('~/Projets/erp');
		expect(racineAffichee('/Users/ana', '/Users/ana')).toBe('~');
		expect(racineAffichee('/Users/anabelle/x', '/Users/ana')).toBe('/Users/anabelle/x');
		expect(racineAffichee('C:\\Users\\ana\\erp', 'C:\\Users\\ana')).toBe('~\\erp');
		expect(racineAffichee('/srv/x', '/')).toBe('/srv/x');
	});

	it('GET graphe : fiches et liens de l\'index', async () => {
		const c = await avecMemoire();
		const r = await api(c).get(ROUTES.graphe);
		expect(r.statut).toBe(200);
		const g = r.corps as DonneesGraphe;
		expect(g.fiches.map((f) => f.chemin).sort()).toEqual(['clients/acme.md', STOCKS, 'projets/alpha/alpha.md']);
		expect(g.fiches.find((f) => f.chemin === STOCKS)).toMatchObject({ parent: 'projets/alpha/alpha.md', alias: ['Stocks'] });
		expect(g.liens).toContainEqual({ source: STOCKS, cible: null, cibleEcrite: 'Inexistante', relation: null });
	});

	it('GET fiche : propriétés, corps, brut et empreinte, liens sortants et entrants, sessions qui l\'ont servie', async () => {
		const c = await avecMemoire();
		await c.etat.creer(session(S1, { objectif: 'Inventaire' }));
		await c.etat.creer(session(S2, { objectif: null, etat: 'travaille' }));
		await c.etat.journaliser({ session: S1, moment: 'debut', horodatageMs: 5000, ids: [STOCKS], texte: 't', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		await c.etat.journaliser({ session: S2, moment: 'message', horodatageMs: 9000, ids: [`${STOCKS}#^f-0001`], texte: 't', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		await c.etat.journaliser({ session: S2, moment: 'message', horodatageMs: 9500, ids: ['clients/acme.md'], texte: 't', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });

		const r = await api(c).get(ROUTES.fiche, { chemin: STOCKS });
		expect(r.statut).toBe(200);
		const f = r.corps as FicheVue;
		expect(f).toMatchObject({ chemin: STOCKS, titre: 'Module stocks', type: 'sujet', brut: TEXTE_STOCKS, empreinte: empreinte(TEXTE_STOCKS) });
		expect(f.proprietes).toEqual([
			['type', 'sujet'],
			['alias', 'Stocks'],
			['portee', 'projet:alpha'],
			['updated', '2026-11-01'],
		]);
		expect(f.corps.startsWith('# Module stocks\n')).toBe(true);
		expect(f.corps).not.toContain('id: 01STK');
		expect(f.liens.sortants).toEqual([
			{ ecrit: 'clients/acme', chemin: 'clients/acme.md', verbe: 'concerne' },
			{ ecrit: 'projets/alpha/alpha', chemin: 'projets/alpha/alpha.md', verbe: null },
			{ ecrit: 'Inexistante', chemin: null, verbe: null },
		]);
		// entrants : par chemin (relation) et par alias (lien du texte)
		expect(f.liens.entrants).toEqual([
			{ chemin: 'clients/acme.md', titre: 'Acme', verbe: 'utilise' },
			{ chemin: 'clients/acme.md', titre: 'Acme', verbe: null },
		]);
		expect(f.sessions).toEqual([
			{ id: S2, objectif: null, etat: 'travaille', horodatageMs: 9000 },
			{ id: S1, objectif: 'Inventaire', etat: 'attend', horodatageMs: 5000 },
		]);
	});

	it('GET fiche : avertissements de lecture (type mal formé, ligne hors grammaire) ; aucun pour une fiche bien formée', async () => {
		const c = await avecMemoire();
		await c.dep.coffre.ecrire('notes/r.md', '---\ntype: Réunion\n---\n# Réunion\n\n## Informations\n- Tarif journalier | 650 € HT\n');
		const f = (await api(c).get(ROUTES.fiche, { chemin: 'notes/r.md' })).corps as FicheVue;
		expect(f.avertissements).toEqual([
			expect.stringMatching(/^type de fiche mal formé « Réunion ».* : lue comme un sujet$/u),
			'une ligne de « Informations » hors de la forme attendue (« - Tarif journalier | 650 € HT ») : indexée comme texte',
		]);
		expect(f.titre).toBe('Réunion');
		expect(((await api(c).get(ROUTES.fiche, { chemin: STOCKS })).corps as FicheVue).avertissements).toEqual([]);
	});

	it('GET fiche : sessions coupées à SESSIONS_DE_FICHE_MAX, `sessionsTotal` les compte toutes ; `tout` les rend', async () => {
		const c = await avecMemoire();
		const n = SESSIONS_DE_FICHE_MAX + 5;
		for (let i = 0; i < n; i++) {
			const id = `${String(i).padStart(8, '0')}-2222-4333-8444-555555555555`;
			await c.etat.creer(session(id));
			await c.etat.journaliser({ session: id, moment: 'debut', horodatageMs: 1000 + i, ids: [STOCKS], texte: 't', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		}
		// une session retirée de l'historique (introuvable) n'est ni listée ni comptée
		await c.etat.journaliser({ session: '99999999-2222-4333-8444-555555555555', moment: 'debut', horodatageMs: 99, ids: [STOCKS], texte: 't', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		// liste et total viennent de la requête des sessions servies : aucune session n'est relue une à une
		const lire = c.etat.lire.bind(c.etat);
		let lues = 0;
		c.etat.lire = async (id) => (lues++, lire(id));
		const coupee = (await api(c).get(ROUTES.fiche, { chemin: STOCKS })).corps as FicheVue;
		expect(lues).toBe(0);
		expect(coupee.sessions).toHaveLength(SESSIONS_DE_FICHE_MAX);
		expect(coupee.sessionsTotal).toBe(n);
		const toute = (await api(c).get(ROUTES.fiche, { chemin: STOCKS, ...PARAMETRES_TOUT })).corps as FicheVue;
		expect(toute.sessions).toHaveLength(n);
	});

	it('GET fiche : projet de la fiche, par la portée déclarée (même règle que le service), null hors projet', async () => {
		const c = await avecMemoire();
		await c.dep.coffre.ecrire('travail/acme/acme.md', '---\nid: 01ACW\ntype: dossier\nportee: client:Acme\nupdated: 2026-11-01\n---\n# Acme\n');
		await c.dep.coffre.ecrire('travail/acme/devis.md', '---\nid: 01DEV\ntype: sujet\nupdated: 2026-11-01\n---\n# Devis\n');
		await c.dep.coffre.ecrire('notes/n.md', '---\nid: 01NOT\ntype: sujet\nupdated: 2026-11-01\n---\n# N\n');
		const projet = async (chemin: string) => ((await api(c).get(ROUTES.fiche, { chemin })).corps as FicheVue).projet;
		expect(await projet(STOCKS)).toEqual({ projet: 'alpha', position: 'projets/alpha' });
		expect(await projet('travail/acme/devis.md')).toEqual({ projet: 'Acme', position: 'travail/acme' });
		expect(await projet('notes/n.md')).toBeNull();
	});

	it('GET fiche : chemin qui sort de la mémoire, absolu ou dans .git → 400 ; inconnue → 404 ; sans chemin → 400', async () => {
		const c = await avecMemoire();
		for (const chemin of ['../secret.md', 'projets/../../secret.md', '/etc/passwd', 'C:\\x.md', '.git/config', 'projets/.cache/x.md', 'projets/alpha'])
			expect((await api(c).get(ROUTES.fiche, { chemin })).statut, chemin).toBe(400);
		expect((await api(c).get(ROUTES.fiche, { chemin: 'absente.md' })).statut).toBe(404);
		expect((await api(c).get(ROUTES.fiche)).statut).toBe(400);
	});

	it('POST brut : empreinte périmée → 409, fichier inchangé ; type changé → 400 ; valide → commit « mnemo: brut », fiche relue à jour', async () => {
		const c = await avecMemoire();
		const perimee = await api(c).post(ROUTES.brut, { chemin: STOCKS, texte: TEXTE_STOCKS.replace('Voir', 'Lire'), empreinte: 'perimee' });
		expect(perimee.statut).toBe(409);
		expect((perimee.corps as { erreur: string }).erreur).toMatch(/changé/u);
		expect(await c.dep.coffre.lire(STOCKS)).toBe(TEXTE_STOCKS);

		const type = await api(c).post(ROUTES.brut, { chemin: STOCKS, texte: TEXTE_STOCKS.replace('type: sujet', 'type: entite'), empreinte: empreinte(TEXTE_STOCKS) });
		expect(type.statut).toBe(400);
		expect((type.corps as { erreur: string }).erreur).toMatch(/type/u);

		expect((await api(c).post(ROUTES.brut, { chemin: '../x.md', texte: 'x', empreinte: 'e' })).statut).toBe(400);
		expect((await api(c).post(ROUTES.brut, { chemin: STOCKS, texte: 3, empreinte: 'e' })).statut).toBe(400);
		expect((await api(c).post(ROUTES.brut, { chemin: STOCKS, texte: 'x' })).statut).toBe(400);

		const texte = TEXTE_STOCKS.replace('Voir', 'Lire');
		const ok = await api(c).post(ROUTES.brut, { chemin: STOCKS, texte, empreinte: empreinte(TEXTE_STOCKS) });
		expect(ok.statut).toBe(200);
		expect(ok.corps).toMatchObject({ statut: 'ecrit', fiche: STOCKS });
		expect(c.dep.commits.map((x) => x.message)).toEqual([`mnemo: brut ${STOCKS}`]);
		const relue = (await api(c).get(ROUTES.fiche, { chemin: STOCKS })).corps as FicheVue;
		expect(relue).toMatchObject({ brut: texte, empreinte: empreinte(texte) });
		expect((await c.dep.index.element(STOCKS))!.texte).toContain('Lire');
	});

	it('POST deplacer : rend le nouveau chemin, `<dossier>/<nom>` (racine : `<nom>`), comme l\'interface le calcule', async () => {
		const c = await avecMemoire();
		// une fiche qui déclare « portee » ne se déplace pas par l'outil : celle-ci n'en déclare pas
		await c.dep.coffre.ecrire(STOCKS, TEXTE_STOCKS.replace('portee: projet:alpha\n', ''));
		const dans = await api(c).post(ROUTES.deplacer, { id: STOCKS, dossier: 'archives/2026' });
		expect(dans.statut).toBe(200);
		expect((dans.corps as ResultatEcriture & { fiche: string }).fiche).toBe('archives/2026/Module stocks.md');
		const racine = await api(c).post(ROUTES.deplacer, { id: 'archives/2026/Module stocks.md', dossier: '' });
		expect((racine.corps as { fiche: string }).fiche).toBe('Module stocks.md');
		expect((await api(c).post(ROUTES.deplacer, { id: 'Module stocks.md', dossier: '../hors' })).statut).toBe(400);
	});
});
