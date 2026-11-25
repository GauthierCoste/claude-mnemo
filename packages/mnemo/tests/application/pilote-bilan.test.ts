import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ecrireEpisodeMinimal, trouverEpisode } from '../../src/application/episode.ts';
import { initialiser } from '../../src/application/initialiser.ts';
import { creerPilote } from '../../src/application/pilote.ts';
import type { Pilote } from '../../src/application/pilote.ts';
import { traiterEvenement } from '../../src/application/evenements.ts';
import type { Dependances, Depot, EtatSessions, Pilotage } from '../../src/application/ports.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import type { Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { signalerGroupe } from '../../src/infra/processus.ts';
import { dependancesReelles, pilotageReel } from '../../src/infra/systeme.ts';
import { terminauxPty } from '../../src/infra/terminaux-pty.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { DEPOT_ABSENT, fauxPorts } from '../aides/faux-ports.ts';
import { fauxTerminaux } from '../aides/faux-terminaux.ts';
import type { FauxTerminaux } from '../aides/faux-terminaux.ts';
import { git } from '../aides/git.ts';
import { commandeClaude, moteursDeTest } from '../aides/moteurs.ts';

const RACINE = '/racine';
const FAUX_CLAUDE = resolve(import.meta.dirname, '../aides/faux-claude.mjs');
const SCRIPT_BILAN = resolve(import.meta.dirname, '../aides/bilan-episode.ts');

const ouverts: EtatSessions[] = [];
const pilotes: Pilote[] = [];
const deps: Dependances[] = [];
/** pids des processus de session lancés : tués en fin de test, même en cas d'échec. */
const pids = new Set<number>();
afterEach(async () => {
	while (pilotes.length > 0) await pilotes.pop()!.arreterTout().catch(() => {});
	for (const pid of pids) signalerGroupe(pid, 'SIGKILL', process.platform);
	pids.clear();
	while (ouverts.length > 0) ouverts.pop()!.fermer();
	while (deps.length > 0) deps.pop()!.index.fermer();
});

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function jusqua(condition: () => Promise<boolean> | boolean, delaiMs: number): Promise<boolean> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (await condition()) return true;
		await attendre(25);
	}
	return condition();
}

function session(id: string, champs: Partial<Session> = {}): Session {
	return {
		id,
		profil: 'travail',
		dossier: 'alpha',
		position: '',
		projet: 'alpha',
		objectif: 'Refaire le catalogue',
		etat: 'attend',
		creeeMs: Date.now() - 60_000,
		majMs: Date.now() - 60_000,
		arretAttendu: null,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: null,
		pid: null,
		...champs,
	};
}

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const ID_C = 'cccccccc-0000-4000-8000-000000000003';

type Contexte = { pilote: Pilote; etat: EtatSessions; terminaux: FauxTerminaux; dep: ReturnType<typeof fauxPorts>; pil: Pilotage };

async function contexte(sessions: Session[] = []): Promise<Contexte> {
	const dep = fauxPorts();
	const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
	ouverts.push(etat);
	for (const s of sessions) await etat.creer(s);
	const terminaux = fauxTerminaux();
	const pil: Pilotage = {
		etat,
		terminaux,
		depot: DEPOT_ABSENT,
		plugin: { ecrire: async (s) => `${RACINE}/.mnemo/plugins/${s}`, retirer: async () => {}, appel: { node: '/usr/bin/node', main: '/main.ts', version: '0.0.0-essai' }, racine: RACINE }, moteurs: moteursDeTest({ commande: '/usr/bin/node', avant: ['/faux.mjs'] }),
		hote: {
			env: {},
			plateforme: 'darwin',
			dossier: async (r) => ({ absolu: `${RACINE}/${r}`, reel: r }),
			processus: async () => 'mort',
			demarrageMachineMs: () => 0,
			nettoyerRestes: async () => {},
		},
	};
	const pilote = creerPilote(dep, pil);
	pilotes.push(pilote);
	return { pilote, etat, terminaux, dep, pil };
}

async function lancee(c: Contexte): Promise<Session> {
	const r = await c.pilote.lancer({ profil: 'travail', dossier: 'alpha', objectif: 'Refaire le catalogue' });
	if (!('session' in r) || 'manuel' in r) throw new Error('lancement attendu');
	// les événements simulés sont horodatés jusqu'à 20 ms dans le passé : le lancement noté une seconde avant, ils le suivent
	// comme de vrais hooks (un dialogue d'avant le lancement est fermé, `dialogueOuvert`)
	return (await c.etat.modifier(r.session.id, { lanceMs: Date.now() - 1000 })) ?? r.session;
}

describe('Pilote.terminer (terminaux simulés)', () => {
	it('bilan : arretAttendu bilan, consigne tapée (une ligne + \\r) ; un arret sans message après la demande n’arrête rien ; message puis arret : arrêtée', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		const avant = Date.now();
		const apres = await c.pilote.terminer(s.id, { bilan: true });
		expect(apres).toMatchObject({ arretAttendu: 'bilan', bilanLuMs: null });
		expect(apres!.bilanDemandeMs).toBeGreaterThanOrEqual(avant);
		const tape = t.ecrits.at(-1)!;
		expect(tape).toMatch(/^Mnemo : bilan[^\r\n]*\r$/u);
		// arret antérieur à la demande, puis arret postérieur sans message (fin du tour en cours) : rien
		await c.etat.appliquer(s.id, 'arret', apres!.bilanDemandeMs! - 1);
		await c.etat.appliquer(s.id, 'arret', apres!.bilanDemandeMs! + 1);
		await attendre(600);
		expect(t.arrets).toHaveLength(0);
		// la consigne du bilan soumise (message), puis Claude s'arrête : arrêtée
		await c.etat.appliquer(s.id, 'message', apres!.bilanDemandeMs! + 2);
		await attendre(300);
		expect(t.arrets).toHaveLength(0);
		await c.etat.appliquer(s.id, 'arret', apres!.bilanDemandeMs! + 3);
		expect(await jusqua(() => t.arrets.length === 1, 3000)).toBe(true);
		// le hook fin termine la session (bilan), puis le processus sort
		await c.etat.appliquer(s.id, 'fin', apres!.bilanDemandeMs! + 4);
		t.finir(0);
		expect(await jusqua(async () => (await c.etat.lire(s.id))?.pid === null, 3000)).toBe(true);
		expect(await c.etat.lire(s.id)).toMatchObject({ etat: 'terminee', arretAttendu: 'bilan' });
	});

	it('bilan : un arret Notification (permission) après la consigne lue n’arrête rien ; le Stop suivant arrête', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		const d = (await c.pilote.terminer(s.id, { bilan: true }))!;
		await c.etat.appliquer(s.id, 'message', d.bilanDemandeMs! + 1);
		await c.etat.appliquer(s.id, 'outil', d.bilanDemandeMs! + 2);
		await c.etat.appliquer(s.id, 'arret', d.bilanDemandeMs! + 3, { arret: 'notification' });
		await attendre(600);
		expect(t.arrets).toHaveLength(0);
		await c.etat.appliquer(s.id, 'arret', d.bilanDemandeMs! + 4, { arret: 'stop' });
		expect(await jusqua(() => t.arrets.length === 1, 3000)).toBe(true);
		t.finir(0);
	});

	it('bilan pendant un dialogue de permission (dernier arrêt Notification) : Échap, 150 ms, puis la consigne ; sinon jamais d’Échap', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		await c.etat.appliquer(s.id, 'outil', Date.now() - 20);
		await c.etat.appliquer(s.id, 'arret', Date.now() - 10, { arret: 'notification' });
		await c.pilote.terminer(s.id, { bilan: true });
		expect(t.ecrits[0]).toBe('\x1b');
		expect(t.ecrits[1]).toMatch(/^Mnemo : bilan[^\r\n]*\r$/u);
		expect(t.ecrits).toHaveLength(2);
		expect(t.instants[1]! - t.instants[0]!).toBeGreaterThanOrEqual(145);
		t.finir(0);

		// après un Stop, au début (debut), ou pendant le travail : aucun Échap (un double Échap ouvrirait le retour arrière)
		for (const [evenement, cause] of [['arret', 'stop'], ['debut', undefined], ['message', undefined]] as const) {
			const c2 = await contexte();
			const s2 = await lancee(c2);
			await c2.etat.appliquer(s2.id, evenement, Date.now() - 5, cause === undefined ? undefined : { arret: cause });
			await c2.pilote.terminer(s2.id, { bilan: true });
			const t2 = c2.terminaux.lances[0]!;
			expect(t2.ecrits, evenement).toHaveLength(1);
			expect(t2.ecrits[0], evenement).toMatch(/^Mnemo : bilan/u);
		}
	});

	it('arrêt (pause, abandon) pendant un dialogue de permission : arreter avec Échap ; sinon sans', async () => {
		const c = await contexte();
		const s = await lancee(c);
		await c.etat.appliquer(s.id, 'arret', Date.now() - 5, { arret: 'notification' });
		await c.pilote.pause(s.id);
		expect(c.terminaux.lances[0]!.optionsArret).toEqual([{ echap: true }]);
		const s2 = await lancee(c);
		await c.etat.appliquer(s2.id, 'arret', Date.now() - 5, { arret: 'stop' });
		await c.pilote.terminer(s2.id, { bilan: false });
		expect(c.terminaux.lances[1]!.optionsArret).toEqual([{ echap: false }]);
	});

	it('taper (dépôt de document) : Échap d’abord si un dialogue est ouvert, puis la ligne + \\r ; session qui ne tourne pas : rien', async () => {
		const c = await contexte();
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		await c.pilote.taper(s.id, 'Traite le document docs/a.pdf');
		expect(t.ecrits).toEqual(['Traite le document docs/a.pdf\r']);
		await c.etat.appliquer(s.id, 'arret', Date.now() - 5, { arret: 'notification' });
		await c.pilote.taper(s.id, 'Traite le document docs/b.pdf');
		expect(t.ecrits.slice(1)).toEqual(['\x1b', 'Traite le document docs/b.pdf\r']);
		await c.pilote.taper(ID_C, 'rien');
	});

	// deux Échap de suite ouvrent le retour arrière de Claude Code : ce qui suit (ligne, `/exit`, `\r`) irait dans ce menu
	it('un seul Échap : deux taper concurrents pendant un dialogue → Échap, A, B dans cet ordre', async () => {
		const c = await contexte();
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		await c.etat.appliquer(s.id, 'arret', Date.now() - 10, { arret: 'notification' });
		await Promise.all([c.pilote.taper(s.id, 'A'), c.pilote.taper(s.id, 'B')]);
		expect(t.ecrits).toEqual(['\x1b', 'A\r', 'B\r']);
	});

	it('un seul Échap : bilan puis pause 200 ms après, dialogue ouvert → l’arrêt suit la consigne, sans 2e Échap', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		await c.etat.appliquer(s.id, 'arret', Date.now() - 10, { arret: 'notification' });
		const b = c.pilote.terminer(s.id, { bilan: true });
		await attendre(200);
		const p = c.pilote.pause(s.id);
		await b;
		expect(await jusqua(() => t.arrets.length === 1, 3000)).toBe(true);
		expect(t.ecrits).toHaveLength(2);
		expect(t.ecrits[0]).toBe('\x1b');
		expect(t.ecrits[1]).toMatch(/^Mnemo : bilan[^\r\n]*\r$/u);
		expect(t.optionsArret).toEqual([{ echap: false }]);
		expect(t.ecritsAvantArret).toEqual([2]);
		t.finir(0);
		await p;
	});

	it('un seul Échap : ligne tapée, aucun hook encore → ni un 2e taper ni un abandon ne renvoient Échap', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		await c.etat.appliquer(s.id, 'arret', Date.now() - 10, { arret: 'notification' });
		await c.pilote.taper(s.id, 'A');
		await c.pilote.taper(s.id, 'B');
		expect(t.ecrits).toEqual(['\x1b', 'A\r', 'B\r']);
		const p = c.pilote.terminer(s.id, { bilan: false });
		expect(await jusqua(() => t.arrets.length === 1, 3000)).toBe(true);
		expect(t.optionsArret).toEqual([{ echap: false }]);
		t.finir(0);
		await p;
	});

	it('nouveau dialogue (Notification après la ligne, majMs avance) : le taper suivant renvoie Échap', async () => {
		const c = await contexte();
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		await c.etat.appliquer(s.id, 'arret', Date.now() - 10, { arret: 'notification' });
		await c.pilote.taper(s.id, 'A');
		await c.etat.appliquer(s.id, 'message', Date.now() - 5);
		await c.etat.appliquer(s.id, 'arret', Date.now() - 1, { arret: 'notification' });
		await c.pilote.taper(s.id, 'B');
		expect(t.ecrits).toEqual(['\x1b', 'A\r', '\x1b', 'B\r']);
		await c.etat.appliquer(s.id, 'arret', Date.now() + 1, { arret: 'notification' });
		await c.pilote.pause(s.id);
		expect(t.optionsArret).toEqual([{ echap: true }]);
	});

	it('sans dialogue : aucun Échap, aucune attente, l’ordre gardé (taper, entree)', async () => {
		const c = await contexte();
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		await c.etat.appliquer(s.id, 'arret', Date.now() - 10, { arret: 'stop' });
		const debut = Date.now();
		await Promise.all([c.pilote.taper(s.id, 'A'), c.pilote.taper(s.id, 'B')]);
		expect(Date.now() - debut).toBeLessThan(100);
		expect(t.ecrits).toEqual(['A\r', 'B\r']);
		c.pilote.entree(s.id, 'x');
		expect(t.ecrits).toEqual(['A\r', 'B\r', 'x']);
	});

	it('dialogue ouvert : une frappe (entree) pendant l’attente du Stop arrive après la ligne', async () => {
		const c = await contexte();
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		await c.etat.appliquer(s.id, 'arret', Date.now() - 10, { arret: 'notification' });
		const a = c.pilote.taper(s.id, 'A');
		await attendre(50);
		c.pilote.entree(s.id, 'x');
		await a;
		expect(await jusqua(() => t.ecrits.length === 3, 1000)).toBe(true);
		expect(t.ecrits).toEqual(['\x1b', 'A\r', 'x']);
	});

	it('une action qui lève une erreur n’empêche pas la suivante', async () => {
		const c = await contexte();
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		const ecrire = t.ecrire;
		let echecs = 1;
		t.ecrire = (d) => {
			if (echecs-- > 0) throw new Error('pty fermé');
			ecrire(d);
		};
		const [a, b] = await Promise.allSettled([c.pilote.taper(s.id, 'A'), c.pilote.taper(s.id, 'B')]);
		expect(a.status).toBe('rejected');
		expect(b.status).toBe('fulfilled');
		expect(t.ecrits).toEqual(['B\r']);
	});

	it('fin du processus : la session est signalée une dernière fois sans terminal (enCours faux)', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s = await lancee(c);
		const vus: { etat: string; terminal: boolean }[] = [];
		c.pilote.surChangement((x) => {
			if (x.id === s.id) vus.push({ etat: x.etat, terminal: c.pilote.enCours(x.id) });
		});
		c.terminaux.lances[0]!.finir(0);
		expect(await jusqua(() => vus.length > 0 && vus.at(-1)!.terminal === false, 3000)).toBe(true);
		expect(c.pilote.enCours(s.id)).toBe(false);
	});

	it('arrêt du service pendant un bilan : arrêt « service », bilan gardé ; au redémarrage, reprise puis le bilan redemandé', async () => {
		const c = await contexte();
		const s = await lancee(c);
		const d = (await c.pilote.terminer(s.id, { bilan: true }))!;
		await c.pilote.arreterTout();
		pilotes.splice(pilotes.indexOf(c.pilote), 1);
		// le hook fin de l'arrêt du service : l'état est gardé
		await c.etat.appliquer(s.id, 'fin', d.bilanDemandeMs! + 1);
		expect(await c.etat.lire(s.id)).toMatchObject({ arretAttendu: 'service', bilanDemandeMs: d.bilanDemandeMs, pid: null });
		expect((await c.etat.lire(s.id))!.etat).not.toBe('terminee');
		await attendre(20);

		const suivant = creerPilote(c.dep, c.pil);
		pilotes.push(suivant);
		expect(await suivant.reprendreAuDemarrage()).toEqual([s.id]);
		const t = c.terminaux.lances[1]!;
		expect(t.options.args).toContain('--resume');
		await attendre(300);
		expect(t.ecrits).toEqual([]);
		await c.etat.appliquer(s.id, 'debut', Date.now());
		expect(await jusqua(() => t.ecrits.some((e) => /^Mnemo : bilan/u.test(e)), 3000)).toBe(true);
		const apres = (await c.etat.lire(s.id))!;
		expect(apres).toMatchObject({ arretAttendu: 'bilan', bilanLuMs: null });
		expect(apres.bilanDemandeMs).toBeGreaterThan(d.bilanDemandeMs!);
	});

	it('plantage du service pendant un bilan (arretAttendu bilan, pid mort) : reprise puis le bilan redemandé', async () => {
		const c = await contexte([session(ID, { arretAttendu: 'bilan', bilanDemandeMs: Date.now() - 30_000, pid: 999_999 })]);
		expect(await c.pilote.reprendreAuDemarrage()).toEqual([ID]);
		const t = c.terminaux.lances[0]!;
		await attendre(20);
		await c.etat.appliquer(ID, 'debut', Date.now());
		expect(await jusqua(() => t.ecrits.some((e) => /^Mnemo : bilan/u.test(e)), 3000)).toBe(true);
		expect(await c.etat.lire(ID)).toMatchObject({ arretAttendu: 'bilan' });
	});

	it('reprise ordinaire : le bilan d’avant (pause pendant le bilan) est oublié, jamais redemandé au redémarrage', async () => {
		const c = await contexte();
		const s = await lancee(c);
		await c.pilote.terminer(s.id, { bilan: true });
		await c.pilote.pause(s.id);
		await c.pilote.reprendre(s.id);
		expect(await c.etat.lire(s.id)).toMatchObject({ arretAttendu: null, bilanDemandeMs: null, bilanLuMs: null });
		await c.pilote.arreterTout();
		pilotes.splice(pilotes.indexOf(c.pilote), 1);
		const suivant = creerPilote(c.dep, c.pil);
		pilotes.push(suivant);
		await suivant.reprendreAuDemarrage();
		await c.etat.appliquer(s.id, 'debut', Date.now());
		await attendre(500);
		expect(c.terminaux.lances.at(-1)!.ecrits).toEqual([]);
	});

	it('rattrapage borné : épisode écrit ou constaté noté (episodeMs) ; effacé ensuite, jamais recréé ; activité nouvelle : revérifié', async () => {
		const c = await contexte([session(ID, { etat: 'a_relire' }), session(ID_B, { etat: 'terminee', arretAttendu: 'bilan', lanceMs: 5, objectif: 'Bilan fait' })]);
		await ecrireEpisodeMinimal(c.dep, c.pil, (await c.etat.lire(ID_B))!, Date.now());
		await c.pilote.reprendreAuDemarrage();
		await c.pilote.arreterTout();
		pilotes.splice(pilotes.indexOf(c.pilote), 1);
		for (const id of [ID, ID_B]) expect((await c.etat.lire(id))!.episodeMs, id).toBeGreaterThan(0);
		// les épisodes disparaissent (effacés à la main) : le démarrage suivant ne les recrée pas
		for (const id of [ID, ID_B]) c.dep.fichiers.delete((await trouverEpisode(c.dep, id, 'alpha'))!.chemin);
		await c.etat.modifier(ID, { etat: 'a_relire' });
		const commits = c.dep.commits.length;
		const suivant = creerPilote(c.dep, c.pil);
		pilotes.push(suivant);
		await suivant.reprendreAuDemarrage();
		await suivant.arreterTout();
		expect(c.dep.commits).toHaveLength(commits);
		for (const id of [ID, ID_B]) expect(await trouverEpisode(c.dep, id, 'alpha'), id).toBeNull();
		// la session a encore servi depuis (événement plus récent que l'épisode noté) : revérifiée, épisode recréé
		await c.etat.appliquer(ID, 'message', Date.now() + 10);
		await c.etat.modifier(ID, { etat: 'a_relire' });
		const encore = creerPilote(c.dep, c.pil);
		pilotes.push(encore);
		await encore.reprendreAuDemarrage();
		expect(await trouverEpisode(c.dep, ID, 'alpha')).not.toBeNull();
	});

	it('bilan sans message ni arret : arrêtée au bout de 10 minutes (filet), épisode minimal', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
		try {
			const c = await contexte();
			const s = await lancee(c);
			const t = c.terminaux.lances[0]!;
			await c.pilote.terminer(s.id, { bilan: true });
			await vi.advanceTimersByTimeAsync(9 * 60_000);
			expect(t.arrets).toHaveLength(0);
			await vi.advanceTimersByTimeAsync(61_000);
			expect(t.arrets).toHaveLength(1);
			await vi.advanceTimersByTimeAsync(1000);
			expect(await c.etat.lire(s.id)).toMatchObject({ etat: 'terminee', pid: null });
			expect((await trouverEpisode(c.dep, s.id, s.projet))?.fiche.donnees.minimal).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('bilan dont le processus meurt sans fin : terminée, épisode minimal écrit', async () => {
		const c = await contexte();
		const s = await lancee(c);
		const d = await c.pilote.terminer(s.id, { bilan: true });
		await c.etat.appliquer(s.id, 'message', d!.bilanDemandeMs! + 1);
		await c.etat.appliquer(s.id, 'arret', d!.bilanDemandeMs! + 2);
		expect(await jusqua(async () => (await c.etat.lire(s.id))?.etat === 'terminee', 3000)).toBe(true);
		const episode = await trouverEpisode(c.dep, s.id, s.projet);
		expect(episode?.fiche.donnees.minimal).toBe(true);
	});

	it('bilan dont le hook fin n’a plus que 300 ms : terminée sans épisode par le hook, rattrapée à la fin du processus', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s = await lancee(c);
		const t = c.terminaux.lances[0]!;
		const d = await c.pilote.terminer(s.id, { bilan: true });
		const lent: Depot = { etat: () => new Promise(() => {}), fichiersModifies: () => new Promise(() => {}), statuts: () => new Promise(() => {}) };
		await traiterEvenement(c.dep, { etat: c.etat, depot: lent }, { evenement: 'fin', session: s.id, horodatageMs: d!.bilanDemandeMs! + 1, cwd: null }, { froid: 'si-budget', echeance: Date.now() + 300, delaiGitMs: 600 });
		expect(await c.etat.lire(s.id)).toMatchObject({ etat: 'terminee' });
		expect(await trouverEpisode(c.dep, s.id, s.projet)).toBeNull();
		t.finir(0);
		expect(await jusqua(async () => (await trouverEpisode(c.dep, s.id, s.projet)) !== null, 3000)).toBe(true);
	});

	it('sans bilan : abandon, arrêtée, terminée avec un épisode minimal ; session qui ne tourne pas : terminée aussitôt', async () => {
		const c = await contexte([session(ID_B, { etat: 'en_pause' })]);
		const s = await lancee(c);
		expect(await c.pilote.terminer(s.id, { bilan: false })).toMatchObject({ etat: 'terminee', arretAttendu: 'abandon', pid: null });
		expect(c.terminaux.lances[0]!.arrets).toHaveLength(1);
		expect(c.pilote.enCours(s.id)).toBe(false);
		expect(await trouverEpisode(c.dep, s.id, s.projet)).not.toBeNull();

		expect(await c.pilote.terminer(ID_B, { bilan: false })).toMatchObject({ etat: 'terminee', arretAttendu: 'abandon' });
		expect(c.terminaux.lances).toHaveLength(1);
		expect(await trouverEpisode(c.dep, ID_B, 'alpha')).not.toBeNull();
	});

	it('bilan d’une session a_relire : reprise (--resume), son debut attendu, puis la consigne tapée', async () => {
		const c = await contexte([session(ID, { etat: 'a_relire' })]);
		const promesse = c.pilote.terminer(ID, { bilan: true });
		expect(await jusqua(() => c.terminaux.lances.length === 1, 3000)).toBe(true);
		const t = c.terminaux.lances[0]!;
		expect(t.options.args).toContain('--resume');
		await attendre(300);
		expect(t.ecrits).toEqual([]);
		await c.etat.appliquer(ID, 'debut', Date.now());
		const s = await promesse;
		expect(s).toMatchObject({ arretAttendu: 'bilan' });
		expect(t.ecrits.at(-1)).toMatch(/^Mnemo : bilan/u);
	});

	it('session terminée ou inconnue : rendue telle quelle', async () => {
		const c = await contexte([session(ID, { etat: 'terminee' })]);
		expect(await c.pilote.terminer(ID, { bilan: true })).toMatchObject({ etat: 'terminee' });
		expect(await c.pilote.terminer(ID_C, { bilan: false })).toBeNull();
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('reprendreAuDemarrage : épisode minimal des sessions a_relire qui n’en ont pas (pas des autres), puis relance', async () => {
		const c = await contexte([session(ID, { etat: 'a_relire' }), session(ID_B, { etat: 'a_relire', objectif: 'Déjà écrit' }), session(ID_C, { etat: 'attend', objectif: 'Active' })]);
		await ecrireEpisodeMinimal(c.dep, c.pil, (await c.etat.lire(ID_B))!, Date.now());
		const commits = c.dep.commits.length;
		expect((await c.pilote.reprendreAuDemarrage()).sort()).toEqual([ID, ID_B, ID_C].sort());
		expect(await trouverEpisode(c.dep, ID, 'alpha')).not.toBeNull();
		expect(await trouverEpisode(c.dep, ID_C, 'alpha')).toBeNull();
		expect(c.dep.commits).toHaveLength(commits + 1);
	});

	it('reprendreAuDemarrage : rattrape les sessions terminées (lancées) sans épisode ; pas un lancement raté', async () => {
		const c = await contexte([
			session(ID, { etat: 'terminee', arretAttendu: 'bilan', lanceMs: 5 }),
			session(ID_B, { etat: 'terminee', arretAttendu: 'abandon', lanceMs: null, objectif: 'Raté' }),
		]);
		await c.pilote.reprendreAuDemarrage();
		expect(await trouverEpisode(c.dep, ID, 'alpha')).not.toBeNull();
		expect(await trouverEpisode(c.dep, ID_B, 'alpha')).toBeNull();
		expect(c.terminaux.lances).toHaveLength(0);
	});

});

const terminaux = await terminauxPty({ delaiArretMs: 2000 });
const sauter = !terminaux.disponibles().ok && process.env.CI === undefined;

/** Dossier Mnemo réel (mémoire git initialisée), un projet `alpha/` sous git (branche `travail`). */
async function dossierMnemo(): Promise<string> {
	const racine = await dossierTemporaire();
	const schema = await readFile(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8');
	const dep = dependancesReelles(racine);
	deps.push(dep);
	await initialiser(dep, schema);
	const alpha = join(racine, 'alpha');
	await mkdir(alpha);
	git(alpha, 'init', '--initial-branch=travail');
	await writeFile(join(alpha, 'a.txt'), 'a\n');
	git(alpha, 'add', '-A');
	git(alpha, 'commit', '-m', 'premier');
	return racine;
}

/** Pilote réel : faux-claude sous un vrai pseudo-terminal, vrais hooks `mnemo hook` (sans service), script de bilan. */
async function piloteReel(racine: string): Promise<{ pilote: Pilote; pil: Pilotage; dep: Dependances }> {
	const pil = await pilotageReel(racine, { env: { ...process.env, FAUX_CLAUDE_BILAN: SCRIPT_BILAN }, terminaux });
	commandeClaude(pil, { commande: process.execPath, avant: [FAUX_CLAUDE] });
	ouverts.push(pil.etat);
	const dep = dependancesReelles(racine);
	deps.push(dep);
	const pilote = creerPilote(dep, pil);
	pilotes.push(pilote);
	return { pilote, pil, dep };
}

function suivre(pilote: Pilote, id: string): { sortie: () => string } {
	let texte = '';
	const a = pilote.abonner(id, (d) => {
		texte += d;
	});
	texte = (a?.relecture ?? '') + texte;
	return { sortie: () => texte };
}

describe.skipIf(sauter)('bilan de bout en bout (faux-claude, vrais hooks)', () => {
	it('bilan : Claude écrit l’épisode (proposer genre episode, origine), puis arret → fin → terminee', async () => {
		const racine = await dossierMnemo();
		const { pilote, pil, dep } = await piloteReel(racine);
		const r = await pilote.lancer({ profil: 'travail', dossier: 'alpha', objectif: 'Refaire le catalogue' });
		if (!('session' in r) || 'manuel' in r) throw new Error(`lancement attendu : ${JSON.stringify(r)}`);
		const id = r.session.id;
		pids.add((await pil.etat.lire(id))!.pid!);
		const { sortie } = suivre(pilote, id);
		expect(await jusqua(() => /prêt/u.test(sortie()), 15_000)).toBe(true);
		// debut a noté branche et commit de départ
		expect(await jusqua(async () => (await pil.etat.lire(id))?.commitDebut !== null, 5000)).toBe(true);
		expect(await pil.etat.lire(id)).toMatchObject({ branche: 'travail' });

		await pilote.terminer(id, { bilan: true });
		expect(await jusqua(async () => (await pil.etat.lire(id))?.etat === 'terminee' && !pilote.enCours(id), 30_000)).toBe(true);
		expect(sortie()).toMatch(/bilan: ecrit/u);
		expect(await pil.etat.lire(id)).toMatchObject({ etat: 'terminee', arretAttendu: 'bilan', pid: null });
		const chemin = (await trouverEpisode(dep, id, 'divers'))!.chemin;
		const fiche = lireFiche(chemin, await readFile(join(racine, '_mnemo', chemin), 'utf8'));
		expect(fiche).toMatchObject({ titre: 'Bilan rédigé par Claude', donnees: { session: id, branche: 'travail', objectif: 'Refaire le catalogue', fichiers: ['a.txt'] } });
		// un seul épisode : fin (bilan) n'a rien ajouté
		expect(git(join(racine, '_mnemo'), 'log', '--format=%s').split('\n').filter((l) => l.startsWith('mnemo: episode'))).toHaveLength(1);
	}, 60_000);

	it('a_relire : le bilan relance la session ; l’épisode minimal est remplacé par celui de Claude, renommé d’après son titre', async () => {
		const racine = await dossierMnemo();
		const { pilote, pil, dep } = await piloteReel(racine);
		const id = 'dddddddd-0000-4000-8000-000000000004';
		const s = session(id, { projet: 'divers', etat: 'a_relire', creeeMs: Date.now() - 1000, majMs: Date.now() - 1000 });
		await pil.etat.creer(s);
		const minimal = await ecrireEpisodeMinimal(dep, pil, s, Date.now());
		expect(minimal).not.toBeNull();

		const promesse = pilote.terminer(id, { bilan: true });
		expect(await jusqua(async () => (await pil.etat.lire(id))?.pid != null, 10_000)).toBe(true);
		pids.add((await pil.etat.lire(id))!.pid!);
		const { sortie } = suivre(pilote, id);
		expect(await promesse).toMatchObject({ arretAttendu: 'bilan' });
		expect(await jusqua(async () => (await pil.etat.lire(id))?.etat === 'terminee' && !pilote.enCours(id), 30_000)).toBe(true);
		expect(sortie()).toMatch(/--resume/u);
		const chemin = (await trouverEpisode(dep, id, 'divers'))!.chemin;
		expect(chemin).toMatch(/-Bilan rédigé par Claude\.md$/u);
		expect(chemin).not.toBe(minimal);
		const fiche = lireFiche(chemin, await readFile(join(racine, '_mnemo', chemin), 'utf8'));
		expect(fiche).toMatchObject({ titre: 'Bilan rédigé par Claude', synthese: 'La session a écrit le fichier a.txt.' });
	}, 60_000);
});
