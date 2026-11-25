import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lancerSession, remettreConsigne, traiterLesDossiers } from '../../src/application/archiviste.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { CONSIGNE_CHEMINS_MAX } from '@mnemo/commun';
import { consigneDesDossiers, dossiersNonRattaches } from '../../src/application/dossiers-non-rattaches.ts';
import { OBJECTIF_MAX } from '@mnemo/commun';
import type { ContexteArchiviste } from '../../src/application/archiviste.ts';
import { creerPilote } from '../../src/application/pilote.ts';
import type { Pilote } from '../../src/application/pilote.ts';
import type { EtatSessions, Pilotage } from '../../src/application/ports.ts';
import type { Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { DEPOT_ABSENT, fauxPorts } from '../aides/faux-ports.ts';
import { fauxTerminaux } from '../aides/faux-terminaux.ts';
import type { FauxTerminaux } from '../aides/faux-terminaux.ts';
import { jusqua } from '../aides/service-faux.ts';
import { moteursDeTest } from '../aides/moteurs.ts';

const RACINE = '/racine';
const CONSIGNE = 'Traite la fiche source « à traiter » (a_traiter) « sources/x.md »';

const ouverts: EtatSessions[] = [];
const pilotes: Pilote[] = [];
afterEach(async () => {
	while (pilotes.length > 0) await pilotes.pop()!.arreterTout();
	while (ouverts.length > 0) ouverts.pop()!.fermer();
});

type Contexte = ContexteArchiviste & { terminaux: FauxTerminaux; fond: Promise<unknown>[] };

async function contexte(): Promise<Contexte> {
	const dep = fauxPorts();
	const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
	ouverts.push(etat);
	const terminaux = fauxTerminaux();
	const pil: Pilotage = {
		etat,
		terminaux,
		depot: DEPOT_ABSENT,
		plugin: {
			ecrire: async (session) => `${RACINE}/.mnemo/plugins/${session}`,
			retirer: async () => {},
			appel: { node: '/usr/bin/node', main: '/opt/mnemo/main.ts', version: '0.0.0-essai' },
			racine: RACINE,
		},
		moteurs: moteursDeTest({ commande: '/usr/bin/node', avant: ['/aides/faux-claude.mjs'] }),
		hote: {
			env: { PATH: '/bin' },
			plateforme: 'darwin',
			dossier: async (relatif) => (['', '_mnemo'].includes(relatif) ? { absolu: relatif === '' ? RACINE : `${RACINE}/${relatif}`, reel: relatif } : null),
			processus: async () => 'mort',
			demarrageMachineMs: () => 1_700_000_000_000,
			nettoyerRestes: async () => {},
		},
	};
	const pilote = creerPilote(dep, pil);
	pilotes.push(pilote);
	const fond: Promise<unknown>[] = [];
	return { dep, pil, pilote, terminaux, fond, enFond: (t) => void fond.push(t.catch(() => {})), arrete: () => false };
}

async function archiviste(c: Contexte): Promise<Session> {
	const r = await c.pilote.lancer({ profil: 'archiviste', dossier: '' });
	if (!('session' in r)) throw new Error(`refus inattendu : ${r.refus}`);
	return r.session;
}

describe('remettreConsigne : où va la consigne de l’archiviste', () => {
	it('il tourne : confiée, tapée dans son terminal', async () => {
		const c = await contexte();
		await archiviste(c);
		expect(await remettreConsigne(c, CONSIGNE)).toEqual({ archiviste: 'confie' });
		expect(await jusqua(() => c.terminaux.lances[0]!.ecrits.includes(`${CONSIGNE}\r`), 2000)).toBe(true);
	});

	it('arrêté, terminaux disponibles : repris (la consigne suit en fond)', async () => {
		const c = await contexte();
		const s = await archiviste(c);
		await c.pilote.pause(s.id);
		expect(await remettreConsigne(c, CONSIGNE)).toEqual({ archiviste: 'repris' });
		expect(await jusqua(() => c.terminaux.lances.length === 2, 2000)).toBe(true);
		expect(c.terminaux.lances[1]!.options.args).toContain('--resume');
	});

	it('aucun archiviste : lancé avec la consigne pour objectif', async () => {
		const c = await contexte();
		expect(await remettreConsigne(c, CONSIGNE)).toEqual({ archiviste: 'lance' });
		expect(c.terminaux.lances).toHaveLength(1);
		expect(c.terminaux.lances[0]!.options.args.at(-1)).toBe(CONSIGNE);
	});

	it('arrêté, terminaux indisponibles : `manuel`, la commande qui le reprend avec la consigne (jamais `repris` silencieux)', async () => {
		const c = await contexte();
		const s = await archiviste(c);
		await c.pilote.pause(s.id);
		c.terminaux.indisponible = 'node-pty absent';
		const r = await remettreConsigne(c, CONSIGNE);
		if (!('archiviste' in r) || r.archiviste !== 'manuel') throw new Error(`manuel attendu : ${JSON.stringify(r)}`);
		expect(r.manuel).toContain(`'--resume' '${s.id}'`);
		expect(r.manuel).toContain(`MNEMO_SESSION='${s.id}'`);
		expect(r.manuel).toContain('Traite la fiche source');
		expect(c.terminaux.lances).toHaveLength(1);
	});

	it('aucun archiviste, terminaux indisponibles : `manuel`, la commande de lancement avec la consigne', async () => {
		const c = await contexte();
		c.terminaux.indisponible = 'node-pty absent';
		const r = await remettreConsigne(c, CONSIGNE);
		if (!('archiviste' in r) || r.archiviste !== 'manuel') throw new Error(`manuel attendu : ${JSON.stringify(r)}`);
		expect(r.manuel).toContain("'--session-id'");
		expect(r.manuel).toContain('Traite la fiche source');
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('course : l’archiviste arrêté se termine avant sa commande de reprise → relancé (`manuel` de lancement), jamais `repris`', async () => {
		const c = await contexte();
		const s = await archiviste(c);
		await c.pilote.pause(s.id);
		c.terminaux.indisponible = 'node-pty absent';
		const pilote = {
			...c.pilote,
			ligneDeReprise: async () => {
				await c.pil.etat.modifier(s.id, { etat: 'terminee' });
				return null;
			},
		};
		const r = await remettreConsigne({ ...c, pilote }, CONSIGNE);
		if (!('archiviste' in r) || r.archiviste !== 'manuel') throw new Error(`manuel attendu : ${JSON.stringify(r)}`);
		expect(r.manuel).toContain("'--session-id'");
		expect(r.manuel).not.toContain(s.id);
		expect(r.manuel).toContain('Traite la fiche source');
	});

	it('course : un archiviste lancé entre la liste et le lancement (`existant`), mode dégradé → `manuel` de reprise', async () => {
		const c = await contexte();
		const s = await archiviste(c);
		await c.pilote.pause(s.id);
		c.terminaux.indisponible = 'node-pty absent';
		// la liste vue par le cas d'usage est antérieure au lancement concurrent
		const etat = { ...c.pil.etat, lister: async () => [] };
		const r = await remettreConsigne({ ...c, pil: { ...c.pil, etat } }, CONSIGNE);
		if (!('archiviste' in r) || r.archiviste !== 'manuel') throw new Error(`manuel attendu : ${JSON.stringify(r)}`);
		expect(r.manuel).toContain(`'--resume' '${s.id}'`);
	});

	it('commande de reprise impossible (dossier introuvable) : refus explicite, journalisé', async () => {
		const c = await contexte();
		const s = await archiviste(c);
		await c.pilote.pause(s.id);
		c.terminaux.indisponible = 'node-pty absent';
		c.pil.hote.dossier = async () => null;
		const journal: string[] = [];
		const r = await remettreConsigne({ ...c, journal: (m) => void journal.push(m) }, CONSIGNE);
		expect(r).toEqual({ refus: expect.stringMatching(/^Commande de reprise de l’archiviste impossible : Dossier de session introuvable/u), arret: false, conflit: true });
		expect(journal).toEqual([expect.stringMatching(/^traiter : commande de reprise impossible/u)]);
	});

	it('service qui s’arrête : refus, rien de lancé', async () => {
		const c = await contexte();
		expect(await remettreConsigne({ ...c, arrete: () => true }, CONSIGNE)).toEqual({ refus: expect.any(String), arret: true });
		expect(c.terminaux.lances).toHaveLength(0);
	});
});

describe('dossiers non rattachés : remis à l’archiviste', () => {
	it('traiterLesDossiers : seuls les dossiers encore sans lien partent, dans une consigne qui les nomme', async () => {
		const c = await contexte();
		await c.pil.etat.noterRattachement('h1/d1', false, 1);
		await c.pil.etat.noterRattachement('h2', false, 2);
		await c.dep.coffre.ecrire('g1/d2/d2.md', '---\nid: 01D2\ntype: dossier\ndossier_projet: h2\nupdated: 2026-11-01\n---\n# D2\n');
		await synchroniser(c.dep);
		expect(await traiterLesDossiers(c, ['h2', 'h3'])).toBeNull();
		const r = await traiterLesDossiers(c, ['h1/d1', 'h2']);
		expect(r).toEqual({ chemins: ['h1/d1'], remise: { archiviste: 'lance' } });
		expect(c.terminaux.lances[0]!.options.args.at(-1)).toMatch(/^Rattache le dossier non rattaché « h1\/d1 » : .*`dossier_projet`.*`proposer` genre `modification`\. La position et les consignes du projet valent au hook suivant de ses sessions ; ses skills, à leur prochaine session\.$/u);
	});

	it('au-delà de CONSIGNE_CHEMINS_MAX : la consigne nomme le premier lot et dit combien restent ; liens posés, la suivante nomme le reste', async () => {
		const c = await contexte();
		const dossiers = Array.from({ length: CONSIGNE_CHEMINS_MAX + 5 }, (_, i) => `h${String(i).padStart(2, '0')}/${'x'.repeat(400)}`);
		for (const [i, d] of dossiers.entries()) await c.pil.etat.noterRattachement(d, false, i + 1);
		const premier = await traiterLesDossiers(c, dossiers);
		expect(premier?.chemins).toEqual(dossiers.slice(0, CONSIGNE_CHEMINS_MAX));
		const consigne = c.terminaux.lances[0]!.options.args.at(-1)!;
		for (const d of dossiers.slice(0, CONSIGNE_CHEMINS_MAX)) expect(consigne).toContain(`« ${d} »`);
		expect(consigne).not.toContain(dossiers[CONSIGNE_CHEMINS_MAX]!);
		expect(consigne).toContain('5 autres restent dans « À traiter »');
		expect(consigne).not.toContain('consigne suivante');
		expect(consigne.length).toBeLessThan(OBJECTIF_MAX);
		expect(consigne).toContain("l'ascendant le plus haut de ce chemin qui appartient encore au projet");
		expect(consigne).toContain('ses skills, à leur prochaine session');
		// l'archiviste pose les liens du premier lot
		for (const [i, d] of dossiers.slice(0, CONSIGNE_CHEMINS_MAX).entries()) {
			await c.dep.coffre.ecrire(`g1/l${i}/l${i}.md`, `---\nid: 01L${i}\ntype: dossier\ndossier_projet: ${d}\nupdated: 2026-11-01\n---\n# L${i}\n`);
		}
		await synchroniser(c.dep);
		const suivant = consigneDesDossiers((await dossiersNonRattaches(c.dep, c.pil.etat)).map((d) => d.dossier));
		for (const d of dossiers.slice(CONSIGNE_CHEMINS_MAX)) expect(suivant).toContain(`« ${d} »`);
		expect(suivant).not.toMatch(/restent?/u);
	});

	it('lancement de l’archiviste : les dossiers non rattachés suivent son objectif', async () => {
		const c = await contexte();
		await c.pil.etat.noterRattachement('h1/d1', false, 1);
		const r = await lancerSession(c, { profil: 'archiviste', dossier: '', objectif: 'Range' });
		if (!('session' in r)) throw new Error(r.refus);
		expect(c.terminaux.lances[0]!.options.args.at(-1)).toMatch(/^Range\n\nRattache le dossier non rattaché « h1\/d1 »/u);
	});
});

describe('lancerSession : profil archiviste', () => {
	it('course : l’archiviste existant se termine avant sa commande de reprise → un nouveau est lancé (`nouvelle`)', async () => {
		const c = await contexte();
		const s = await archiviste(c);
		await c.pilote.pause(s.id);
		c.terminaux.indisponible = 'node-pty absent';
		const pilote = {
			...c.pilote,
			ligneDeReprise: async () => {
				await c.pil.etat.modifier(s.id, { etat: 'terminee' });
				return null;
			},
		};
		const r = await lancerSession({ ...c, pilote }, { profil: 'archiviste', dossier: '' });
		if (!('session' in r)) throw new Error(r.refus);
		expect(r.nouvelle).toBe(true);
		expect(r.session.id).not.toBe(s.id);
		expect(r.manuel).toContain("'--session-id'");
	});

	it('des fiches attendent : la consigne est collée à l’objectif', async () => {
		const c = await contexte();
		await c.dep.coffre.ecrire('sources/x.md', '---\nid: 01X\ntype: source\na_traiter: true\nupdated: 2026-11-01\n---\n# X\n');
		const r = await lancerSession(c, { profil: 'archiviste', dossier: '', objectif: 'Range' });
		if (!('session' in r)) throw new Error(r.refus);
		expect(r.nouvelle).toBe(true);
		expect(c.terminaux.lances[0]!.options.args.at(-1)).toMatch(/^Range\n\nTraite la fiche source marquée « à traiter »/u);
	});

	it('existant arrêté, terminaux indisponibles : `manuel` (commande de reprise), jamais rien de silencieux', async () => {
		const c = await contexte();
		const s = await archiviste(c);
		await c.pilote.pause(s.id);
		c.terminaux.indisponible = 'node-pty absent';
		const r = await lancerSession(c, { profil: 'archiviste', dossier: '', objectif: 'Range les devis' });
		if (!('session' in r)) throw new Error(r.refus);
		expect(r).toMatchObject({ nouvelle: false, session: { id: s.id } });
		expect(r.manuel).toContain(`'--resume' '${s.id}'`);
		expect(r.manuel).toContain('Range les devis');
	});
});
