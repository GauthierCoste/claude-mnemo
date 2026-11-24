import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dateLocale, dossierEpisodes, ecrireEpisodeMinimal, FICHIERS_EPISODE_MAX, RESERVE_ECRITURE_MS, SYNTHESE_MINIMALE, texteDuBilan, trouverEpisode } from '../../src/application/episode.ts';
import { traiterEvenement } from '../../src/application/evenements.ts';
import type { EntreeHook } from '../../src/application/evenements.ts';
import { initialiser } from '../../src/application/initialiser.ts';
import type { Depot, EtatSessions } from '../../src/application/ports.ts';
import { proposer } from '../../src/application/proposer.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import type { ArretAttendu, Session } from '../../src/domaine/session.ts';
import { depotGit } from '../../src/infra/depot-git.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { DEPOT_ABSENT, fauxPorts } from '../aides/faux-ports.ts';
import { git } from '../aides/git.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const DEBUT = new Date(2026, 10, 22, 9, 30).getTime();
const FIN = new Date(2026, 10, 22, 11, 45).getTime();
const CHEMIN = 'episodes/alpha/2026-11-22-Refaire le catalogue.md';
const BILAN = 'episodes/alpha/2026-11-22-Bilan.md';

const ouverts: EtatSessions[] = [];
afterEach(() => {
	while (ouverts.length > 0) ouverts.pop()!.fermer();
});

function session(champs: Partial<Session> = {}): Session {
	return {
		id: ID,
		profil: 'travail',
		dossier: 'alpha',
		position: 'projets/alpha',
		projet: 'alpha',
		objectif: 'Refaire le catalogue',
		etat: 'attend',
		creeeMs: DEBUT,
		majMs: DEBUT,
		arretAttendu: null,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: null,
		pid: null,
		...champs,
	};
}

/** Une racine temporaire avec un dépôt `alpha/` (branche `travail`) : un commit, puis une modification, un nouveau commit, un fichier non suivi. */
async function racineAvecDepot(): Promise<{ racine: string; commitDebut: string }> {
	const racine = await dossierTemporaire();
	const alpha = join(racine, 'alpha');
	await mkdir(alpha);
	git(alpha, 'init', '--initial-branch=travail');
	await writeFile(join(alpha, 'catalogue.txt'), 'v1\n');
	git(alpha, 'add', '-A');
	git(alpha, 'commit', '-m', 'premier');
	const commitDebut = git(alpha, 'rev-parse', 'HEAD');
	await writeFile(join(alpha, 'catalogue.txt'), 'v2\n');
	await writeFile(join(alpha, 'prix.txt'), 'p\n');
	git(alpha, 'add', 'prix.txt');
	git(alpha, 'commit', '-m', 'prix');
	await writeFile(join(alpha, 'brouillon.md'), 'b\n');
	return { racine, commitDebut };
}

const lire = (dep: ReturnType<typeof fauxPorts>, chemin: string) => lireFiche(chemin, dep.fichiers.get(chemin)!);
/** Dépôt qui ne répond jamais. */
const DEPOT_MUET: Depot = { etat: () => new Promise(() => {}), fichiersModifies: () => new Promise(() => {}), statuts: () => new Promise(() => {}) };

async function etatAvec(...sessions: Session[]): Promise<EtatSessions> {
	const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
	ouverts.push(etat);
	for (const s of sessions) await etat.creer(s);
	return etat;
}
const fin = (horodatageMs: number, id = ID): EntreeHook => ({ evenement: 'fin', session: id, horodatageMs, cwd: null });

describe('épisode minimal', () => {
	it('dépôt git : branche, fichiers modifiés depuis le début (commit compris) et non suivis ; fiche, données, commit', async () => {
		const { racine, commitDebut } = await racineAvecDepot();
		const dep = fauxPorts();
		const chemin = await ecrireEpisodeMinimal(dep, { depot: depotGit(racine) }, session({ commitDebut }), FIN);
		expect(chemin).toBe(CHEMIN);
		const fiche = lire(dep, CHEMIN);
		expect(fiche.type).toBe('episode');
		expect(fiche.titre).toBe('Refaire le catalogue');
		expect(fiche.synthese).toBe(SYNTHESE_MINIMALE);
		expect(fiche.donnees).toEqual({
			session: ID,
			projet: 'alpha',
			profil: 'travail',
			debut: '2026-11-22 09:30',
			fin: '2026-11-22 11:45',
			branche: 'travail',
			objectif: 'Refaire le catalogue',
			fichiers: ['catalogue.txt', 'prix.txt', 'brouillon.md'],
			source: `session ${ID}`,
			minimal: true,
		});
		// un seul commit, fiche de l'épisode et fiches de dossier manquantes
		expect(dep.commits).toEqual([{ message: `mnemo: episode ${CHEMIN}`, chemins: [CHEMIN, 'episodes/episodes.md', 'episodes/alpha/alpha.md'] }]);
	});

	it('liste coupée : les FICHIERS_EPISODE_MAX premiers dans le frontmatter, une seule fois ; le résultat dit « N fichiers modifiés, dont les M premiers : »', async () => {
		const tous = Array.from({ length: 73 }, (_, i) => `fichier-${i}-fin.txt`);
		const demandes: number[] = [];
		const depot: Depot = { etat: async () => null, statuts: async () => null, fichiersModifies: async (_d, _depuis, limite) => (demandes.push(limite), { fichiers: tous.slice(0, limite), total: tous.length }) };
		const dep = fauxPorts();
		await ecrireEpisodeMinimal(dep, { depot }, session(), FIN);
		const fiche = lire(dep, CHEMIN);
		expect(demandes).toEqual([FICHIERS_EPISODE_MAX]);
		expect(fiche.donnees.fichiers).toEqual(tous.slice(0, FICHIERS_EPISODE_MAX));
		expect(fiche.autresSections).toContainEqual({ titre: 'Résultat', corps: `73 fichiers modifiés, dont les ${FICHIERS_EPISODE_MAX} premiers :` });
		const texte = dep.fichiers.get(CHEMIN)!;
		for (const f of tous.slice(0, FICHIERS_EPISODE_MAX)) expect(texte.split(f).length - 1, f).toBe(1);
	});

	it('liste entière : aucune phrase de coupure', async () => {
		const depot: Depot = { etat: async () => null, statuts: async () => null, fichiersModifies: async () => ({ fichiers: ['a.txt'], total: 1 }) };
		const dep = fauxPorts();
		await ecrireEpisodeMinimal(dep, { depot }, session(), FIN);
		expect(lire(dep, CHEMIN).autresSections.some((s) => s.titre === 'Résultat')).toBe(false);
	});

	it('dossier sans git : épisode sans fichiers ni branche ; sans objectif : titré d’après le profil', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'alpha'));
		const dep = fauxPorts();
		const chemin = await ecrireEpisodeMinimal(dep, { depot: depotGit(racine) }, session({ objectif: null }), FIN);
		expect(chemin).toBe('episodes/alpha/2026-11-22-Session travail.md');
		expect(lire(dep, chemin!).donnees).toMatchObject({ branche: null, fichiers: [], objectif: null });
	});

	it('faux Depot lent : git abandonné à 2 s, épisode sans fichiers', async () => {
		const dep = fauxPorts();
		const debut = Date.now();
		const chemin = await ecrireEpisodeMinimal(dep, { depot: DEPOT_MUET }, session({ branche: 'notee' }), FIN);
		const duree = Date.now() - debut;
		expect(duree).toBeGreaterThanOrEqual(1900);
		expect(duree).toBeLessThan(4000);
		expect(lire(dep, chemin!).donnees).toMatchObject({ branche: 'notee', fichiers: [] });
	}, 10_000);

	it('épisode minimal déjà là : mis à jour sur place, rien si identique ; épisode de Claude : jamais remplacé', async () => {
		const dep = fauxPorts();
		const pil = { depot: DEPOT_ABSENT };
		expect(await ecrireEpisodeMinimal(dep, pil, session(), FIN)).toBe(CHEMIN);
		expect(await ecrireEpisodeMinimal(dep, pil, session(), FIN)).toBeNull();
		const plusTard = FIN + 3_600_000;
		expect(await ecrireEpisodeMinimal(dep, pil, session({ objectif: 'Autre titre' }), plusTard)).toBe(CHEMIN);
		expect(lire(dep, CHEMIN).donnees.fin).toBe('2026-11-22 12:45');
		expect(await ecrireEpisodeMinimal(dep, pil, session(), FIN, { siAbsent: true })).toBeNull();
		expect(dep.commits).toHaveLength(2);

		dep.origine = { session: ID, projet: 'alpha' };
		const etat = await etatAvec(session());
		dep.sessions = etat;
		// le titre de Claude donne le nom : l'épisode minimal, nommé d'après l'objectif, est renommé
		expect(await proposer(dep, { genre: 'episode', titre: 'Bilan', synthese: 'Écrit par Claude.' })).toMatchObject({ statut: 'ecrit', fiche: BILAN });
		expect(dep.fichiers.has(CHEMIN)).toBe(false);
		expect(await ecrireEpisodeMinimal(dep, pil, session(), plusTard + 60_000)).toBeNull();
		expect(lire(dep, BILAN).synthese).toBe('Écrit par Claude.');
	});

	it('nom déjà pris par une autre session : suffixé', async () => {
		const dep = fauxPorts();
		const pil = { depot: DEPOT_ABSENT };
		await ecrireEpisodeMinimal(dep, pil, session(), FIN);
		const autre = '22222222-2222-4333-8444-555555555555';
		expect(await ecrireEpisodeMinimal(dep, pil, session({ id: autre }), FIN)).toBe('episodes/alpha/2026-11-22-Refaire le catalogue-2.md');
	});
});

describe('traiterEvenement : fin et debut', () => {
	for (const [arret, attendu] of [
		[null, true],
		['abandon', true],
		['bilan', true],
		['pause', false],
		['service', false],
	] as [ArretAttendu, boolean][]) {
		it(`fin, arrêt attendu ${String(arret)} : ${attendu ? 'épisode minimal' : 'aucun épisode'}`, async () => {
			const dep = fauxPorts();
			const etat = await etatAvec(session({ arretAttendu: arret }));
			expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, fin(FIN), { froid: 'si-budget' })).toEqual({});
			expect(dep.fichiers.has(CHEMIN)).toBe(attendu);
		});
	}

	it('fin, bilan avec l’épisode de Claude déjà écrit : gardé, aucun commit', async () => {
		const dep = fauxPorts();
		const etat = await etatAvec(session({ arretAttendu: 'bilan' }));
		Object.assign(dep, { origine: { session: ID, projet: 'alpha' }, sessions: etat });
		await proposer(dep, { genre: 'episode', titre: 'Bilan', synthese: 'Écrit par Claude.' });
		const commits = dep.commits.length;
		await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, fin(FIN), { froid: 'si-budget' });
		expect(dep.commits).toHaveLength(commits);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'terminee' });
	});

	it('hook sans service, faux Depot lent : git abandonné à 600 ms, épisode écrit dans l’échéance', async () => {
		const dep = fauxPorts();
		const etat = await etatAvec(session());
		const echeance = Date.now() + 1400;
		await traiterEvenement(dep, { etat, depot: DEPOT_MUET }, fin(FIN), { froid: 'si-budget', echeance, delaiGitMs: 600 });
		expect(Date.now()).toBeLessThan(echeance);
		expect(lire(dep, CHEMIN).donnees).toMatchObject({ fichiers: [] });
		expect(await etat.lire(ID)).toMatchObject({ etat: 'a_relire' });
	}, 10_000);

	it('hook à court de temps : rien d’écrit, la session reste a_relire (le service rattrapera)', async () => {
		const dep = fauxPorts();
		const etat = await etatAvec(session());
		const echeance = Date.now() + 300;
		await traiterEvenement(dep, { etat, depot: DEPOT_MUET }, fin(FIN), { froid: 'si-budget', echeance, delaiGitMs: 600 });
		expect(Date.now()).toBeLessThan(echeance);
		expect(dep.fichiers.has(CHEMIN)).toBe(false);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'a_relire' });
	});

	it('service (enFond) : la réponse n’attend pas l’épisode, écrit ensuite', async () => {
		const dep = fauxPorts();
		const etat = await etatAvec(session());
		let liberer: ((f: { fichiers: string[]; total: number }) => void) | null = null;
		const depot: Depot = { etat: async () => null, fichiersModifies: () => new Promise((r) => (liberer = r)), statuts: async () => null };
		const taches: Promise<unknown>[] = [];
		expect(await traiterEvenement(dep, { etat, depot }, fin(FIN), { froid: 'permis', enFond: (t) => taches.push(t) })).toEqual({});
		expect(taches).toHaveLength(1);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'a_relire' });
		expect(dep.fichiers.has(CHEMIN)).toBe(false);
		while (liberer === null) await new Promise((r) => setTimeout(r, 5));
		(liberer as (f: { fichiers: string[]; total: number }) => void)({ fichiers: ['a.txt'], total: 1 });
		await Promise.all(taches);
		expect(lire(dep, CHEMIN).donnees).toMatchObject({ fichiers: ['a.txt'] });
	});

	it('debut : branche et commit de départ notés une fois (pas à la reprise) ; en fond pour le service', async () => {
		const { racine } = await racineAvecDepot();
		const dep = fauxPorts();
		const etat = await etatAvec(session());
		const depot = depotGit(racine);
		const debut = (t: number): EntreeHook => ({ evenement: 'debut', session: ID, horodatageMs: t, cwd: null });
		await traiterEvenement(dep, { etat, depot }, debut(DEBUT + 1), { froid: 'si-budget', echeance: Date.now() + 2000 });
		const tete = git(join(racine, 'alpha'), 'rev-parse', 'HEAD');
		expect(await etat.lire(ID)).toMatchObject({ commitDebut: tete, branche: 'travail' });
		git(join(racine, 'alpha'), 'checkout', '-b', 'autre');
		await traiterEvenement(dep, { etat, depot }, debut(DEBUT + 2), { froid: 'si-budget' });
		expect(await etat.lire(ID)).toMatchObject({ commitDebut: tete, branche: 'travail' });

		const etat2 = await etatAvec(session());
		const taches: Promise<unknown>[] = [];
		await traiterEvenement(dep, { etat: etat2, depot }, debut(DEBUT + 1), { froid: 'permis', enFond: (t) => taches.push(t) });
		expect(taches).toHaveLength(1);
		await Promise.all(taches);
		expect(await etat2.lire(ID)).toMatchObject({ commitDebut: tete, branche: 'autre' });
	});

	it('debut : git trop lent → rien de noté, réponse dans l’échéance', async () => {
		const dep = fauxPorts();
		const etat = await etatAvec(session());
		const echeance = Date.now() + 900;
		await traiterEvenement(dep, { etat, depot: DEPOT_MUET }, { evenement: 'debut', session: ID, horodatageMs: DEBUT + 1, cwd: null }, { froid: 'si-budget', echeance });
		expect(Date.now()).toBeLessThan(echeance);
		expect(await etat.lire(ID)).toMatchObject({ commitDebut: null, branche: null });
	});
});

describe('genre episode de proposer', () => {
	it('hors session Mnemo : refusé', async () => {
		const r = await proposer(fauxPorts(), { genre: 'episode', titre: 'X', synthese: 'Y' });
		expect(r).toMatchObject({ statut: 'refuse' });
		expect((r as { motif: string }).motif).toMatch(/seulement dans une session Mnemo/u);
	});

	it('deux appels : une seule fiche, remplacée sur place ; données de la session ; corps synthèse, Décisions, Résultat', async () => {
		const dep = fauxPorts();
		const etat = await etatAvec(session({ branche: 'travail' }));
		Object.assign(dep, { origine: { session: ID, projet: 'alpha' }, sessions: etat });
		const premier = await proposer(dep, { genre: 'episode', titre: 'Catalogue refait', synthese: 'Première version.' });
		expect(premier).toMatchObject({ statut: 'ecrit', fiche: 'episodes/alpha/2026-11-22-Catalogue refait.md' });
		const second = await proposer(dep, {
			genre: 'episode',
			titre: 'Catalogue refait, prix compris',
			synthese: 'Le catalogue est refait.',
			decisions: ['Prix en centimes : pas d’arrondi.'],
			resultat: 'Livré.',
			fichiers: ['catalogue.txt'],
		});
		expect(second).toMatchObject({ statut: 'ecrit', fiche: 'episodes/alpha/2026-11-22-Catalogue refait.md' });
		const episodes = [...dep.fichiers.keys()].filter((c) => c.startsWith('episodes/alpha/2026'));
		expect(episodes).toEqual(['episodes/alpha/2026-11-22-Catalogue refait.md']);
		const texte = dep.fichiers.get(episodes[0]!)!;
		expect(texte).toContain('# Catalogue refait, prix compris\n\nLe catalogue est refait.\n\n## Décisions\n- Prix en centimes : pas d’arrondi.\n\n## Résultat\nLivré.\n');
		const fiche = lireFiche(episodes[0]!, texte);
		expect(fiche.donnees).toMatchObject({ session: ID, profil: 'travail', debut: '2026-11-22 09:30', fin: '2026-11-22 12:00', branche: 'travail', objectif: 'Refaire le catalogue', fichiers: ['catalogue.txt'], source: `session ${ID}` });
		// même demande : rien à réécrire
		expect(await proposer(dep, { genre: 'episode', titre: 'Catalogue refait, prix compris', synthese: 'Le catalogue est refait.', decisions: ['Prix en centimes : pas d’arrondi.'], resultat: 'Livré.', fichiers: ['catalogue.txt'] })).toMatchObject({ statut: 'doublon' });
	});

	it('remplace l’épisode minimal (renommé d’après le titre de Claude, un seul commit), garde ses fichiers si Claude n’en donne pas', async () => {
		const dep = fauxPorts();
		const etat = await etatAvec(session());
		await ecrireEpisodeMinimal(dep, { depot: { etat: async () => null, fichiersModifies: async () => ({ fichiers: ['vu.txt'], total: 1 }), statuts: async () => null } }, session(), FIN);
		Object.assign(dep, { origine: { session: ID, projet: 'alpha' }, sessions: etat });
		const commits = dep.commits.length;
		expect(await proposer(dep, { genre: 'episode', titre: 'Bilan', synthese: 'Fait.' })).toMatchObject({ statut: 'ecrit', fiche: BILAN });
		expect(lire(dep, BILAN)).toMatchObject({ titre: 'Bilan', synthese: 'Fait.', donnees: { fichiers: ['vu.txt'] } });
		expect(dep.fichiers.has(CHEMIN)).toBe(false);
		expect(dep.commits).toHaveLength(commits + 1);
		expect(dep.commits.at(-1)).toMatchObject({ message: `mnemo: episode ${BILAN}` });
		expect(dep.commits.at(-1)!.chemins).toContain(CHEMIN);
	});

	it('nom du titre : l’objectif de la session ne nomme pas l’épisode de Claude écrit sans épisode minimal', async () => {
		const dep = fauxPorts();
		dep.origine = { session: ID, projet: 'alpha' };
		dep.sessions = await etatAvec(session({ objectif: 'Premier message très long de la session' }));
		expect(await proposer(dep, { genre: 'episode', titre: 'Catalogue refait', synthese: 'Fait.' })).toMatchObject({ fiche: 'episodes/alpha/2026-11-22-Catalogue refait.md' });
	});

	it('formes refusées : titre vide, synthèse vide ou avec un titre, décision sur deux lignes, plus de 50 fichiers', async () => {
		const dep = fauxPorts();
		dep.origine = { session: ID, projet: 'alpha' };
		for (const demande of [
			{ titre: ' ', synthese: 'x' },
			{ titre: 'T', synthese: ' ' },
			{ titre: 'T', synthese: 'a\n## Faits\nb' },
			{ titre: 'T', synthese: 'x', decisions: ['a\nb'] },
			{ titre: 'T', synthese: 'x', fichiers: Array.from({ length: 51 }, (_, i) => `f${i}`) },
		]) {
			expect(await proposer(dep, { genre: 'episode', ...demande })).toMatchObject({ statut: 'refuse' });
		}
		expect(dep.commits).toEqual([]);
	});
});

describe('épisodes : correctifs (bilan, budget, secrets, session)', () => {
	const GHP = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
	const AKIA = 'AKIAIOSFODNN7EXAMPLE';

	it('épisode minimal : secrets masqués dans le chemin, le contenu et le commit (objectif, branche, fichiers)', async () => {
		const dep = fauxPorts();
		const depot: Depot = { etat: async () => ({ branche: `fix-${AKIA}`, commit: 'abc' }), fichiersModifies: async () => ({ fichiers: ['a.txt', `cle-${GHP}.txt`], total: 2 }), statuts: async () => null };
		const chemin = await ecrireEpisodeMinimal(dep, { depot }, session({ objectif: `Pousser avec ${GHP}` }), FIN);
		const tout = [chemin!, dep.fichiers.get(chemin!)!, ...dep.commits.map((c) => c.message)].join('\n');
		expect(tout).not.toContain(GHP);
		expect(tout).not.toContain(AKIA);
		expect(dep.fichiers.get(chemin!)).toContain('[secret masqué]');
		// un titre qui n'est qu'un secret : « Session <profil> »
		const autre = '22222222-2222-4333-8444-555555555555';
		expect(await ecrireEpisodeMinimal(dep, { depot: DEPOT_ABSENT }, session({ id: autre, objectif: GHP }), FIN)).toBe('episodes/alpha/2026-11-22-Session travail.md');
	});

	it('proposer genre episode : secrets masqués (titre, fichiers, synthèse)', async () => {
		const dep = fauxPorts();
		dep.origine = { session: ID, projet: 'alpha' };
		dep.sessions = await etatAvec(session({ branche: AKIA }));
		const r = await proposer(dep, { genre: 'episode', titre: `Jeton ${GHP}`, synthese: `Clé ${AKIA}.`, fichiers: [`${GHP}.env`] });
		expect(r).toMatchObject({ statut: 'ecrit' });
		const chemin = (r as { fiche: string }).fiche;
		const tout = [chemin, dep.fichiers.get(chemin)!, ...dep.commits.map((c) => c.message)].join('\n');
		expect(tout).not.toContain(GHP);
		expect(tout).not.toContain(AKIA);
	});

	it('minimal reconnu par « minimal: true » dans le frontmatter, pas par la synthèse', async () => {
		const dep = fauxPorts();
		dep.origine = { session: ID, projet: 'alpha' };
		dep.sessions = await etatAvec(session());
		// Claude écrit un épisode dont la synthèse ressemble à celle du minimal : il n'est jamais remplacé
		await proposer(dep, { genre: 'episode', titre: 'Bilan', synthese: SYNTHESE_MINIMALE });
		expect(await ecrireEpisodeMinimal(dep, { depot: DEPOT_ABSENT }, session(), FIN)).toBeNull();
		expect(lire(dep, 'episodes/alpha/2026-11-22-Bilan.md').donnees.minimal).toBeUndefined();
	});

	it('session inconnue de l’état : l’épisode est retrouvé par son id (date indifférente), début jamais inventé', async () => {
		const dep = fauxPorts();
		const veille = session({ creeeMs: new Date(2026, 10, 20, 8, 0).getTime() });
		const chemin = await ecrireEpisodeMinimal(dep, { depot: DEPOT_ABSENT }, veille, FIN);
		expect(chemin).toBe('episodes/alpha/2026-11-20-Refaire le catalogue.md');
		dep.origine = { session: ID, projet: 'alpha' };
		expect(await proposer(dep, { genre: 'episode', titre: 'Bilan', synthese: 'Fait.' })).toMatchObject({ statut: 'ecrit', fiche: 'episodes/alpha/2026-11-20-Bilan.md' });
		expect(lire(dep, 'episodes/alpha/2026-11-20-Bilan.md').donnees.debut).toBe('2026-11-20 08:00');
		// sans épisode ni session : pas de début
		const dep2 = fauxPorts();
		dep2.origine = { session: ID, projet: 'alpha' };
		const r = await proposer(dep2, { genre: 'episode', titre: 'Bilan', synthese: 'Fait.' });
		expect(lire(dep2, (r as { fiche: string }).fiche).donnees.debut).toBeNull();
		expect(await trouverEpisode(dep2, ID, 'alpha')).not.toBeNull();
	});

	it('projet tiré de la session connue (pas de l’origine) ; dossier de repli « divers »', async () => {
		const dep = fauxPorts();
		dep.origine = { session: ID, projet: 'autre' };
		dep.sessions = await etatAvec(session());
		expect(await proposer(dep, { genre: 'episode', titre: 'Bilan', synthese: 'Fait.' })).toMatchObject({ fiche: 'episodes/alpha/2026-11-22-Bilan.md' });
		expect(dossierEpisodes('')).toBe('episodes/divers');
		expect(dossierEpisodes('  ')).toBe('episodes/divers');
	});

	it('collisions vérifiées sur le seul dossier du projet, jamais sur toute la mémoire', async () => {
		const dep = fauxPorts();
		dep.coffre.toutesLesFiches = async () => {
			throw new Error('toute la mémoire parcourue');
		};
		expect(await ecrireEpisodeMinimal(dep, { depot: DEPOT_ABSENT }, session(), FIN)).toBe(CHEMIN);
	});

	it(`réserve d’écriture ≥ 450 ms ; verrou tenu : abandon avant l’échéance, rien d’écrit`, async () => {
		expect(RESERVE_ECRITURE_MS).toBeGreaterThanOrEqual(450);
		const dep = fauxPorts();
		dep.verrou = { avec: () => new Promise(() => {}) };
		const echeance = Date.now() + 1400;
		expect(await ecrireEpisodeMinimal(dep, { depot: DEPOT_MUET }, session(), FIN, { echeance, delaiGitMs: 600 })).toBeNull();
		expect(Date.now()).toBeLessThanOrEqual(echeance);
		expect(dep.fichiers.has(CHEMIN)).toBe(false);
	});
});

describe('5 sessions qui finissent en même temps', () => {
	it('5 épisodes, 5 commits, aucune perte (vraie mémoire git, un verrou)', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'alpha'));
		const schema = await readFile(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8');
		const base = dependancesReelles(racine);
		await initialiser(base, schema);
		base.index.fermer();
		const ids = [1, 2, 3, 4, 5].map((n) => `${n}${n}${n}${n}${n}${n}${n}${n}-2222-4333-8444-555555555555`);
		const etat = ouvrirEtat(join(racine, '.mnemo', 'etat.sqlite'));
		ouverts.push(etat);
		for (const [i, id] of ids.entries()) await etat.creer(session({ id, objectif: `Tâche ${i + 1}` }));
		// chaque hook a ses propres dépendances, comme des processus distincts
		const deps = ids.map(() => dependancesReelles(racine));
		try {
			await Promise.all(ids.map((id, i) => traiterEvenement(deps[i]!, { etat, depot: depotGit(racine) }, fin(FIN, id), { froid: 'permis' })));
		} finally {
			for (const d of deps) d.index.fermer();
		}
		const fiches = (await readdir(join(racine, '_mnemo', 'episodes', 'alpha'))).filter((f) => f.startsWith(dateLocale(DEBUT)));
		expect(fiches.sort()).toEqual([1, 2, 3, 4, 5].map((n) => `2026-11-22-Tâche ${n}.md`));
		const log = git(join(racine, '_mnemo'), 'log', '--format=%s');
		expect(log.split('\n').filter((l) => l.startsWith('mnemo: episode '))).toHaveLength(5);
		expect(git(join(racine, '_mnemo'), 'status', '--porcelain')).toBe('');
	}, 30_000);
});

describe('texteDuBilan', () => {
	it('une seule ligne, sans caractère de contrôle, avec l’objectif', () => {
		const texte = texteDuBilan(session({ objectif: 'Refaire\u001b[2J le\u0007 catalogue' }));
		expect(texte).not.toMatch(/[\u0000-\u001f\u007f]/u);
		expect(texte).toMatch(/^Mnemo : bilan/u);
		expect(texte).toContain('genre « episode »');
		expect(texte).toContain('Refaire [2J le  catalogue');
	});
});
