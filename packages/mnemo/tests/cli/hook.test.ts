import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { initialiser } from '../../src/application/initialiser.ts';
import { servirQuestion } from '../aides/servir.ts';
import { ECHEANCES_MS } from '../../src/adaptateurs/cli/hook.ts';
import { assemblerPlugin } from '../../src/application/plugin.ts';
import { EVENEMENTS_HOOK, PROFILS_PAR_DEFAUT } from '../../src/domaine/profil.ts';
import { refusSurErreur, reponseDe, texteDuRefus } from '../../src/domaine/refus-outil.ts';
import { FICHIER_CONSIGNES_VERIFIEES } from '../../src/infra/indicateur-consignes.ts';
import type { CauseNonVerifiee } from '../../src/domaine/refus-outil.ts';
import type { EvenementHook, Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { verrouFichier } from '../../src/infra/verrou-fichier.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { ENV_TEST } from '../aides/env-test.ts';
import { git } from '../aides/git.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');
const ID = '11111111-2222-4333-8444-555555555555';
const LIMITE_MS = process.env.CI ? 2000 : 1000;
const AUTRE = '99999999-2222-4333-8444-555555555555';

const entete = (type: string, extra = '') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n`;
const consigne = (texte: string) => `${entete('consigne', 'portee: globale\nniveau: toujours\n')}# C\n\n${texte}\n`;

const aFermer: (() => void)[] = [];
afterEach(() => {
	while (aFermer.length > 0) aFermer.pop()!();
});

type Resultat = { code: number | null; out: string; err: string; ms: number; erreurStdin?: string };

function hook(cwd: string, evenement: string, stdin: string, env: Record<string, string | undefined> = {}, delaiStdinMs = 0): Promise<Resultat> {
	return new Promise((resoudre) => {
		const debut = Date.now();
		const enfant = spawn(process.execPath, [MAIN, 'hook', ...evenement.split(' ')], { cwd, env: { ...ENV_TEST, MNEMO_SESSION: '', MNEMO_RACINE: '', ...env } });
		let out = '';
		let err = '';
		enfant.stdout.on('data', (m: Buffer) => (out += m.toString('utf8')));
		enfant.stderr.on('data', (m: Buffer) => (err += m.toString('utf8')));
		let erreurStdin: string | undefined;
		enfant.stdin.on('error', (e: NodeJS.ErrnoException) => (erreurStdin = e.code ?? e.message));
		enfant.on('close', (code) => resoudre({ code, out, err, ms: Date.now() - debut, ...(erreurStdin === undefined ? {} : { erreurStdin }) }));
		if (delaiStdinMs === 0) enfant.stdin.end(stdin);
		else setTimeout(() => enfant.stdin.end(stdin), delaiStdinMs);
	});
}

function session(champs: Partial<Session> = {}): Session {
	return {
		id: ID,
		profil: 'travail',
		dossier: '',
		position: '',
		projet: 'divers',
		objectif: null,
		etat: 'attend',
		creeeMs: 1,
		majMs: 1,
		arretAttendu: null,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: null,
		pid: null,
		...champs,
	};
}

/** Dossier Mnemo minimal (pas de git : `servir` ne lit que les fiches), une consigne globale, une session connue. */
async function dossierMnemo(): Promise<string> {
	const racine = await dossierTemporaire();
	await mkdir(join(racine, '_mnemo', 'consignes'), { recursive: true });
	await mkdir(join(racine, '.mnemo'));
	await writeFile(join(racine, '_mnemo', 'SCHEMA.md'), '# Schéma\n');
	await writeFile(join(racine, '_mnemo', 'consignes', 'g.md'), consigne('Réponds en français.'));
	const etat = ouvrirEtat(join(racine, '.mnemo', 'etat.sqlite'));
	await etat.creer(session());
	etat.fermer();
	return racine;
}

async function lireSession(racine: string): Promise<Session | null> {
	const etat = ouvrirEtat(join(racine, '.mnemo', 'etat.sqlite'));
	try {
		return await etat.lire(ID);
	} finally {
		etat.fermer();
	}
}

async function attendu(racine: string, question: string): Promise<string> {
	const dep = dependancesReelles(racine);
	try {
		return (await servirQuestion(dep, '', question)).texte;
	} finally {
		dep.index.fermer();
	}
}

const entreeMessage = (racine: string, prompt = 'Bonjour, le catalogue') =>
	JSON.stringify({ session_id: ID, cwd: racine, hook_event_name: 'UserPromptSubmit', prompt, transcript_path: '/x' });

/** Faux service HTTP sur 127.0.0.1 ; `service.json` écrit dans le dossier. */
/** Pid d'un processus terminé. */
function pidMort(): Promise<number> {
	return new Promise((resoudre) => {
		const enfant = spawn(process.execPath, ['-e', '0']);
		enfant.on('close', () => resoudre(enfant.pid!));
	});
}

async function fauxService(racine: string, repondre: ((req: IncomingMessage, corps: string) => unknown) | null, pid = process.pid): Promise<{ requetes: { auth: string | undefined; chemin: string | undefined; corps: string }[] }> {
	const requetes: { auth: string | undefined; chemin: string | undefined; corps: string }[] = [];
	const serveur: Server = createServer((req, res) => {
		let corps = '';
		req.on('data', (m: Buffer) => (corps += m.toString('utf8')));
		req.on('end', () => {
			requetes.push({ auth: req.headers.authorization, chemin: req.url, corps });
			if (repondre === null) return; // muet : ne répond jamais
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(repondre(req, corps)));
		});
	});
	await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
	aFermer.push(() => {
		serveur.closeAllConnections();
		serveur.close();
	});
	const { port } = serveur.address() as AddressInfo;
	await writeFile(join(racine, '.mnemo', 'service.json'), JSON.stringify({ pid, port, jeton: 'a'.repeat(64), demarre: Date.now() }));
	return { requetes };
}

describe('mnemo hook (bout en bout, sans service)', () => {
	it('message : sortie JSON exacte, code 0, état et journal mis à jour', async () => {
		const racine = await dossierMnemo();
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		const texte = await attendu(racine, 'Bonjour, le catalogue');
		expect(texte).toContain('Réponds en français.');
		expect(r.out).toBe(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: texte } })}\n`);
		const s = await lireSession(racine);
		expect(s?.etat).toBe('travaille');
		expect(s?.objectif).toBe('Bonjour, le catalogue');
		const etat = ouvrirEtat(join(racine, '.mnemo', 'etat.sqlite'));
		aFermer.push(() => etat.fermer());
		expect((await etat.servis(ID, 5)).map((e) => e.moment)).toEqual(['message']);
	});

	it('debut : rien servi à l\'ouverture ; racine trouvée depuis le cwd, session depuis MNEMO_SESSION', async () => {
		const racine = await dossierMnemo();
		await mkdir(join(racine, 'code'));
		const r = await hook(racine, 'debut', JSON.stringify({ cwd: join(racine, 'code'), hook_event_name: 'SessionStart', source: 'startup' }), { MNEMO_SESSION: ID });
		expect(r.code).toBe(0);
		expect(r.out).toBe('');
		expect((await lireSession(racine))?.majMs).toBeGreaterThan(1);
	});

	it('arret, outil, fin : état appliqué, aucune sortie', async () => {
		const racine = await dossierMnemo();
		for (const [e, etatAttendu] of [['outil', 'travaille'], ['arret', 'attend'], ['fin', 'a_relire']] as const) {
			const r = await hook(racine, e, JSON.stringify({ session_id: ID, cwd: racine, tool_name: 'Bash', tool_input: { command: 'ls' } }), { MNEMO_RACINE: racine });
			expect(r.code, e).toBe(0);
			expect(r.out, e).toBe('');
			expect((await lireSession(racine))?.etat, e).toBe(etatAttendu);
		}
	});

	it('arret --notification (ou Notification) : dernier arrêt notification ; arret seul ou notification idle_prompt : stop ; état attend', async () => {
		const racine = await dossierMnemo();
		const entree = (champs: Record<string, unknown> = {}) => JSON.stringify({ session_id: ID, cwd: racine, ...champs });
		for (const [e, champs, cause] of [
			['arret --notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, 'notification'],
			['arret', {}, 'stop'],
			['Notification', {}, 'notification'],
			['arret --notification', { notification_type: 'idle_prompt' }, 'stop'],
			['arret --notification', {}, 'notification'],
		] as const) {
			const r = await hook(racine, e, entree(champs), { MNEMO_RACINE: racine });
			expect(r.code, e).toBe(0);
			expect(r.out, e).toBe('');
			expect(await lireSession(racine), `${e} ${JSON.stringify(champs)}`).toMatchObject({ etat: 'attend', dernierArret: cause });
		}
	});

	it('message --sans-contexte : état et objectif tenus, rien servi ni journalisé ; option inconnue : rien', async () => {
		const racine = await dossierMnemo();
		const r = await hook(racine, 'message --sans-contexte', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.out).toBe('');
		expect(await lireSession(racine)).toMatchObject({ etat: 'travaille', objectif: 'Bonjour, le catalogue' });
		const etat = ouvrirEtat(join(racine, '.mnemo', 'etat.sqlite'));
		aFermer.push(() => etat.fermer());
		expect(await etat.servis(ID, 5)).toEqual([]);
		const debut = await hook(racine, 'debut --sans-contexte', JSON.stringify({ session_id: ID, cwd: racine, source: 'startup' }), { MNEMO_RACINE: racine });
		expect(debut.out).toBe('');
		expect((await lireSession(racine))?.etat).toBe('attend');
		for (const e of ['arret --pirouette', 'message --sans-contexte --sans-contexte x']) {
			const avant = (await lireSession(racine))?.majMs;
			const x = await hook(racine, e, entreeMessage(racine), { MNEMO_RACINE: racine });
			expect(x.code, e).toBe(0);
			expect(x.out, e).toBe('');
			expect((await lireSession(racine))?.majMs, e).toBe(avant);
		}
	});

	it('stdin vide, JSON cassé, événement inconnu, hors de toute mémoire : code 0, aucune sortie', async () => {
		const racine = await dossierMnemo();
		const ailleurs = await dossierTemporaire();
		for (const [cwd, e, stdin, env] of [
			[racine, 'message', '', { MNEMO_RACINE: racine }],
			[racine, 'message', '{"session_id": ', { MNEMO_RACINE: racine }],
			[racine, 'message', '[1, 2]', { MNEMO_RACINE: racine }],
			[racine, 'inconnu', entreeMessage(racine), { MNEMO_RACINE: racine }],
			[ailleurs, 'message', JSON.stringify({ session_id: ID, cwd: ailleurs, prompt: 'catalogue' }), {}],
		] as const) {
			const r = await hook(cwd, e, stdin, env);
			expect(r.code, stdin).toBe(0);
			expect(r.out, stdin).toBe('');
		}
		expect((await lireSession(racine))?.etat).toBe('attend');
	});

	it('etat.sqlite verrouillé par un autre processus : contexte servi dans le budget, code 0, état perdu', async () => {
		const racine = await dossierMnemo();
		const autre = new DatabaseSync(join(racine, '.mnemo', 'etat.sqlite'));
		autre.exec('BEGIN IMMEDIATE');
		aFermer.push(() => {
			autre.exec('ROLLBACK');
			autre.close();
		});
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.ms).toBeLessThan(LIMITE_MS);
		expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('Réponds en français.');
		aFermer.pop()!();
		expect((await lireSession(racine))?.etat).toBe('attend');
	});
});

const REFUS_PUSH = 'Mnemo : consigne vérifiée « Jamais de push forcé. » (motif « git push --force* »).';
const refusAttendu = (motif: string) => `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motif }, systemMessage: motif })}\n`;

/** Dossier Mnemo avec une consigne vérifiée globale, index synchronisé (le hook `outil` ne synchronise pas). */
async function dossierVerifie(): Promise<string> {
	const racine = await dossierMnemo();
	await writeFile(join(racine, '_mnemo', 'consignes', 'push.md'), `${entete('consigne', 'portee: globale\nniveau: verifiee\nregle: { type: commandes_interdites, motifs: ["git push --force*"] }\n')}# P\n\nJamais de push forcé.\n`);
	await attendu(racine, '');
	return racine;
}
const entreeOutil = (racine: string, command: string) => JSON.stringify({ session_id: ID, cwd: racine, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

describe('mnemo hook outil : consignes vérifiées', () => {
	it('action contraire : refus PreToolUse en JSON, code 0, sous la limite ; sinon aucune sortie', async () => {
		const racine = await dossierVerifie();
		const r = await hook(racine, 'outil', entreeOutil(racine, 'git status && git push --force origin main'), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.out).toBe(refusAttendu(REFUS_PUSH));
		expect(r.ms).toBeLessThan(LIMITE_MS);
		expect((await lireSession(racine))?.etat).toBe('travaille');
		const permis = await hook(racine, 'outil', entreeOutil(racine, 'git push origin main'), { MNEMO_RACINE: racine });
		expect(permis.code).toBe(0);
		expect(permis.out).toBe('');
	});

	it('service qui refuse : son refus est rendu, quelle que soit sa longueur', async () => {
		const racine = await dossierVerifie();
		await fauxService(racine, () => ({ refus: 'Refus du service.' }));
		const r = await hook(racine, 'outil', entreeOutil(racine, 'ls'), { MNEMO_RACINE: racine });
		expect(r.out).toBe(refusAttendu('Refus du service.'));
		const autre = await dossierVerifie();
		await fauxService(autre, () => ({ refus: 'x'.repeat(5000) }));
		const long = await hook(autre, 'outil', entreeOutil(autre, 'ls'), { MNEMO_RACINE: autre });
		expect(long.out).toBe(refusAttendu('x'.repeat(5000)));
	});
});

/** Dossier Mnemo avec une consigne vérifiée globale « jamais contrats/** », index synchronisé. */
async function dossierContrats(): Promise<string> {
	const racine = await dossierMnemo();
	await writeFile(join(racine, '_mnemo', 'consignes', 'contrats.md'), `${entete('consigne', 'portee: globale\nniveau: verifiee\nregle: { type: chemins_interdits, motifs: ["contrats/**"] }\n')}# K\n\nNe modifie jamais les contrats.\n`);
	await attendu(racine, '');
	return racine;
}
/** Dossier Mnemo synchronisé (index et indicateur écrits), sans consigne vérifiée. */
async function dossierSansVerifiee(): Promise<string> {
	const racine = await dossierMnemo();
	await attendu(racine, '');
	return racine;
}
const ecritureContrat = (racine: string, taille: number, fichier = 'annexe.md') =>
	JSON.stringify({ session_id: ID, cwd: racine, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(racine, 'contrats', fichier), content: 'x'.repeat(taille) } });
const refusNonVerifie = (cause: CauseNonVerifiee) => refusAttendu(texteDuRefus({ refus: true, cause, detail: null }));
/** Délai de Claude Code pour le hook `PreToolUse` du plugin : au-delà, il laisse passer l'action. */
const DELAI_CLAUDE_OUTIL_MS = 3000;

describe('mnemo hook outil : action qui n\'a pas pu être vérifiée', () => {
	it('entrée de plus d\'1 Mo, consigne chemins_interdits applicable : refus dit à Claude et à l\'utilisateur, journalisé, état tenu', async () => {
		const racine = await dossierContrats();
		const r = await hook(racine, 'outil', ecritureContrat(racine, 1.2 * 1024 * 1024), { MNEMO_RACINE: racine, MNEMO_SESSION: ID });
		expect(r.code).toBe(0);
		expect(r.out).toBe(refusNonVerifie('entree_trop_grosse'));
		expect(r.err).toContain(`mnemo hook : action refusée : ${texteDuRefus({ refus: true, cause: 'entree_trop_grosse', detail: null })}`);
		expect(r.erreurStdin).toBeUndefined();
		expect(r.ms).toBeLessThan(LIMITE_MS);
		expect((await lireSession(racine))?.etat).toBe('travaille');
	});

	it('même entrée sans consigne vérifiée à la position : accord', async () => {
		const racine = await dossierMnemo();
		const r = await hook(racine, 'outil', ecritureContrat(racine, 1.2 * 1024 * 1024), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.out).toBe('');
	});

	it('JSON illisible ou sans outil : refus là où une consigne vérifiée s\'applique, accord sinon', async () => {
		const racine = await dossierContrats();
		const sans = await dossierMnemo();
		for (const stdin of ['{"session_id": ', '[1, 2]', JSON.stringify({ session_id: ID, cwd: racine })]) {
			expect((await hook(racine, 'outil', stdin, { MNEMO_RACINE: racine })).out, stdin).toBe(refusNonVerifie('entree_illisible'));
			expect((await hook(sans, 'outil', stdin, { MNEMO_RACINE: sans })).out, stdin).toBe('');
		}
	});

	it('hook lent (entrée après le délai), mémoire avec une consigne vérifiée ou indicateur illisible : refus, avant que Claude Code ne laisse passer', async () => {
		const illisible = await dossierSansVerifiee();
		await writeFile(join(illisible, '.mnemo', FICHIER_CONSIGNES_VERIFIEES), '{ cassé');
		for (const racine of [await dossierContrats(), illisible]) {
			const r = await hook(racine, 'outil', ecritureContrat(racine, 10), { MNEMO_RACINE: racine }, ECHEANCES_MS.outil + 100);
			expect(r.code).toBe(0);
			expect(r.out).toBe(refusNonVerifie('delai_depasse'));
			expect(r.ms).toBeLessThan(DELAI_CLAUDE_OUTIL_MS);
		}
	}, 3 * DELAI_CLAUDE_OUTIL_MS);

	it('hook lent, mémoire sans consigne vérifiée (notée par la synchronisation) ou installation neuve : accord, journalisé', async () => {
		for (const racine of [await dossierSansVerifiee(), await dossierMnemo()]) {
			const r = await hook(racine, 'outil', ecritureContrat(racine, 10), { MNEMO_RACINE: racine }, ECHEANCES_MS.outil + 100);
			expect(r.code).toBe(0);
			expect(r.out).toBe('');
			expect(r.err).toContain(`mnemo hook : ${reponseDe({ refus: false, cause: 'delai_depasse', detail: null }).avis}`);
			expect(r.ms).toBeLessThan(DELAI_CLAUDE_OUTIL_MS);
		}
	}, 3 * DELAI_CLAUDE_OUTIL_MS);

	it('verrou d\'écriture de l\'index tenu par un autre processus : vérifié quand même, sous la limite', async () => {
		const racine = await dossierContrats();
		const autre = new DatabaseSync(join(racine, '.mnemo', 'index.sqlite'));
		autre.exec('BEGIN IMMEDIATE');
		aFermer.push(() => autre.close());
		const r = await hook(racine, 'outil', ecritureContrat(racine, 10), { MNEMO_RACINE: racine });
		autre.exec('ROLLBACK');
		expect(r.out).toBe(refusAttendu('Mnemo : consigne vérifiée « Ne modifie jamais les contrats. » (motif « contrats/** »).'));
		expect(r.ms).toBeLessThan(LIMITE_MS);
	});

	it('index verrouillé en exclusif par un autre processus : refus « non vérifiable », rendu avant l\'échéance', async () => {
		const racine = await dossierContrats();
		const autre = new DatabaseSync(join(racine, '.mnemo', 'index.sqlite'));
		autre.exec('PRAGMA locking_mode = EXCLUSIVE');
		autre.exec('BEGIN EXCLUSIVE');
		autre.exec('UPDATE fiches SET taille = taille');
		autre.exec('COMMIT');
		aFermer.push(() => autre.close());
		const r = await hook(racine, 'outil', ecritureContrat(racine, 10), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.out).toBe(refusAttendu(texteDuRefus(refusSurErreur(new Error('database is locked')))));
		expect(r.ms).toBeLessThan(DELAI_CLAUDE_OUTIL_MS);
	});

	it('action conforme sous la limite : accord ; contraire : refus de la consigne', async () => {
		const racine = await dossierContrats();
		const conforme = JSON.stringify({ session_id: ID, cwd: racine, tool_name: 'Write', tool_input: { file_path: join(racine, 'notes', 'a.md'), content: 'x' } });
		expect((await hook(racine, 'outil', conforme, { MNEMO_RACINE: racine })).out).toBe('');
		const contraire = await hook(racine, 'outil', ecritureContrat(racine, 10), { MNEMO_RACINE: racine });
		expect(contraire.out).toBe(refusAttendu('Mnemo : consigne vérifiée « Ne modifie jamais les contrats. » (motif « contrats/** »).'));
	});

	it('chaque échéance du hook tient sous le délai que le plugin déclare à Claude Code pour son événement', async () => {
		const profil = { ...PROFILS_PAR_DEFAUT.travail, hooks: [...EVENEMENTS_HOOK], consigne: '' };
		const fichiers = await assemblerPlugin(fauxPorts(), session(), profil, { node: '/n', main: '/m', version: '0.0.0-essai' });
		const { hooks } = JSON.parse(fichiers.find((f) => f.chemin === 'hooks/hooks.json')!.texte) as { hooks: Record<string, { hooks: { args: string[]; timeout: number }[] }[]> };
		const vus = new Set<string>();
		for (const groupes of Object.values(hooks)) {
			for (const { args, timeout } of groupes.flatMap((g) => g.hooks)) {
				const evenement = args[2] as EvenementHook;
				vus.add(evenement);
				expect(ECHEANCES_MS[evenement], evenement).toBeLessThan(timeout * 1000);
			}
		}
		expect([...vus].sort()).toEqual([...EVENEMENTS_HOOK].sort());
	});
});

describe('mnemo hook : identité de session et /clear', () => {
	it('MNEMO_SESSION l’emporte sur session_id (id de conversation changé par /clear)', async () => {
		const racine = await dossierMnemo();
		const stdin = JSON.stringify({ session_id: AUTRE, cwd: racine, hook_event_name: 'UserPromptSubmit', prompt: 'catalogue' });
		const r = await hook(racine, 'message', stdin, { MNEMO_RACINE: racine, MNEMO_SESSION: ID });
		expect(r.code).toBe(0);
		expect((await lireSession(racine))?.etat).toBe('travaille');
	});

	it('MNEMO_SESSION invalide : session_id sert de repli', async () => {
		const racine = await dossierMnemo();
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine, MNEMO_SESSION: 'pas-un-uuid' });
		expect(r.code).toBe(0);
		expect((await lireSession(racine))?.etat).toBe('travaille');
	});

	it('SessionEnd de /clear ou /resume : ignoré (pas de fin) ; SessionStart source clear : un debut normal, sans contexte', async () => {
		const racine = await dossierMnemo();
		const env = { MNEMO_RACINE: racine, MNEMO_SESSION: ID };
		const fin = await hook(racine, 'fin', JSON.stringify({ session_id: AUTRE, cwd: racine, hook_event_name: 'SessionEnd', reason: 'clear' }), env);
		expect(fin.code).toBe(0);
		expect(fin.out).toBe('');
		expect((await lireSession(racine))?.etat).toBe('attend');
		expect((await lireSession(racine))?.majMs).toBe(1);
		const debut = await hook(racine, 'debut', JSON.stringify({ session_id: AUTRE, cwd: racine, hook_event_name: 'SessionStart', source: 'clear' }), env);
		expect(debut.code).toBe(0);
		// rien n'est servi à l'ouverture, même après /clear : les fiches redeviennent à servir au message suivant
		expect(debut.out).toBe('');
		expect((await lireSession(racine))?.majMs).toBeGreaterThan(1);
		// /resume interactif : la session Mnemo continue
		const reprise = await hook(racine, 'fin', JSON.stringify({ session_id: AUTRE, cwd: racine, hook_event_name: 'SessionEnd', reason: 'resume' }), env);
		expect(reprise.code).toBe(0);
		expect(reprise.out).toBe('');
		expect((await lireSession(racine))?.etat).toBe('attend');
		// une autre raison de fin s'applique
		await hook(racine, 'fin', JSON.stringify({ session_id: AUTRE, cwd: racine, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }), env);
		expect((await lireSession(racine))?.etat).toBe('a_relire');
	});

	it('stdin de plus d’1 Mo : lu jusqu’au bout (pas d’EPIPE chez l’écrivain), code 0, aucune sortie', async () => {
		const racine = await dossierMnemo();
		const r = await hook(racine, 'message', JSON.stringify({ session_id: ID, cwd: racine, prompt: 'x'.repeat(2 * 1024 * 1024) }), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.out).toBe('');
		expect(r.erreurStdin).toBeUndefined();
	});
});

describe('mnemo hook (avec le service)', () => {
	it('service muet et etat.sqlite verrouillé : réponse locale sous la limite, code 0', async () => {
		const racine = await dossierMnemo();
		await fauxService(racine, null);
		const autre = new DatabaseSync(join(racine, '.mnemo', 'etat.sqlite'));
		autre.exec('BEGIN IMMEDIATE');
		try {
			const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
			expect(r.code).toBe(0);
			expect(r.ms).toBeLessThan(LIMITE_MS);
			// une machine de CI lente peut dépasser l'échéance du hook (900 ms depuis le démarrage de Node) : réponse vide voulue
			if (process.env.CI && r.out === '') return;
			expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('Réponds en français.');
		} finally {
			autre.exec('ROLLBACK');
			autre.close();
		}
	});

	it('service.json d’un processus mort : le service n’est pas appelé', async () => {
		const racine = await dossierMnemo();
		const { requetes } = await fauxService(racine, () => ({ contexte: 'Contexte du service.' }), await pidMort());
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(requetes).toHaveLength(0);
		expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('Réponds en français.');
	});

	it('contexte du service de plus de 100 000 caractères : écarté, calcul local', async () => {
		const racine = await dossierMnemo();
		await fauxService(racine, () => ({ contexte: 'y'.repeat(100_001) }));
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('Réponds en français.');
	});

	it('service muet : réponse locale, processus sous la limite', async () => {
		const racine = await dossierMnemo();
		const { requetes } = await fauxService(racine, null);
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.ms).toBeLessThan(LIMITE_MS);
		expect(requetes.length).toBe(1);
		expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('Réponds en français.');
		expect((await lireSession(racine))?.etat).toBe('travaille');
	});

	it('service qui répond : sa réponse est rendue (jeton, route, entrée transmis), rien de calculé en local', async () => {
		const racine = await dossierMnemo();
		const { requetes } = await fauxService(racine, () => ({ contexte: 'Contexte du service.' }));
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.out).toBe(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Contexte du service.' } })}\n`);
		expect(requetes[0]?.auth).toBe(`Bearer ${'a'.repeat(64)}`);
		expect(requetes[0]?.chemin).toBe('/api/hook');
		expect(JSON.parse(requetes[0]!.corps)).toMatchObject({ evenement: 'message', session: ID, cwd: racine, prompt: 'Bonjour, le catalogue' });
		// l'instant où le hook cessera d'attendre : le service ne note rien de servi au-delà
		const { echeanceMs, horodatageMs } = JSON.parse(requetes[0]!.corps) as { echeanceMs: number; horodatageMs: number };
		expect(echeanceMs - horodatageMs).toBeGreaterThan(0);
		expect(echeanceMs - horodatageMs).toBeLessThanOrEqual(ECHEANCES_MS.message);
		// le service tient l'état : le hook n'y a pas touché
		expect((await lireSession(racine))?.etat).toBe('attend');
	});

	it('service : la cause de l’arrêt et --sans-contexte lui sont transmis', async () => {
		const racine = await dossierMnemo();
		const { requetes } = await fauxService(racine, () => ({}));
		await hook(racine, 'arret --notification', JSON.stringify({ session_id: ID, cwd: racine, notification_type: 'permission_prompt' }), { MNEMO_RACINE: racine });
		await hook(racine, 'arret', JSON.stringify({ session_id: ID, cwd: racine }), { MNEMO_RACINE: racine });
		await hook(racine, 'message --sans-contexte', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(requetes.map((q) => JSON.parse(q.corps) as Record<string, unknown>)).toEqual([
			expect.objectContaining({ evenement: 'arret', arret: 'notification' }),
			expect.objectContaining({ evenement: 'arret', arret: 'stop' }),
			expect.objectContaining({ evenement: 'message', sansContexte: true }),
		]);
	});

	it('service : la transcription (pour la jauge), la source de SessionStart et PostToolUse (apres_outil) lui sont transmis', async () => {
		const racine = await dossierMnemo();
		const { requetes } = await fauxService(racine, () => ({}));
		await hook(racine, 'SessionStart', JSON.stringify({ session_id: ID, cwd: racine, source: 'compact', transcript_path: '/t.jsonl' }), { MNEMO_RACINE: racine });
		await hook(racine, 'PostToolUse', JSON.stringify({ session_id: ID, cwd: racine, tool_name: 'Read', tool_input: { file_path: '/a.php' }, transcript_path: '/t.jsonl' }), { MNEMO_RACINE: racine });
		await hook(racine, 'SessionStart', JSON.stringify({ session_id: ID, cwd: racine, source: 'inconnue' }), { MNEMO_RACINE: racine });
		const corps = requetes.map((q) => JSON.parse(q.corps) as Record<string, unknown>);
		expect(corps[0]).toMatchObject({ evenement: 'debut', source: 'compact', transcription: '/t.jsonl' });
		expect(corps[1]).toMatchObject({ evenement: 'apres_outil', outil: { nom: 'Read', entree: { file_path: '/a.php' } }, transcription: '/t.jsonl' });
		expect(corps[2]).not.toHaveProperty('transcription');
		expect(corps[2]).not.toHaveProperty('source');
	});

	it('service qui répond sans contexte : aucune sortie', async () => {
		const racine = await dossierMnemo();
		await fauxService(racine, () => ({}));
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.out).toBe('');
	});

	it('réponse invalide du service : calcul local', async () => {
		const racine = await dossierMnemo();
		await fauxService(racine, () => ({ contexte: 42 }));
		const r = await hook(racine, 'message', entreeMessage(racine), { MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('Réponds en français.');
	});
});

describe('mnemo hook fin : épisode minimal', () => {
	/** Dossier Mnemo réel (mémoire git), projet `alpha/` sous git, session de ce projet. */
	async function dossierAvecMemoire(): Promise<string> {
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		try {
			await initialiser(dep, await readFile(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8'));
		} finally {
			dep.index.fermer();
		}
		const alpha = join(racine, 'alpha');
		await mkdir(alpha);
		git(alpha, 'init', '--initial-branch=travail');
		await writeFile(join(alpha, 'a.txt'), 'a\n');
		git(alpha, 'add', '-A');
		git(alpha, 'commit', '-m', 'premier');
		await writeFile(join(alpha, 'b.txt'), 'b\n');
		const etat = ouvrirEtat(join(racine, '.mnemo', 'etat.sqlite'));
		await etat.creer(session({ dossier: 'alpha', projet: 'alpha', objectif: 'Écrire b', creeeMs: Date.now() - 60_000, majMs: Date.now() - 60_000 }));
		etat.fermer();
		return racine;
	}
	const entreeFin = (racine: string) => JSON.stringify({ session_id: ID, cwd: join(racine, 'alpha'), hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
	/** Claude Code laisse 1,5 s aux hooks `SessionEnd` ; marge sous charge (CI). */
	const LIMITE_FIN_MS = process.env.CI ? 3000 : 1500;

	it('sans service : écrit par le hook (fichiers d’après git), commité, dans le budget de SessionEnd', async () => {
		const racine = await dossierAvecMemoire();
		const r = await hook(join(racine, 'alpha'), 'fin', entreeFin(racine), { MNEMO_SESSION: ID, MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(r.out).toBe('');
		expect(r.ms).toBeLessThan(LIMITE_FIN_MS);
		expect((await lireSession(racine))?.etat).toBe('a_relire');
		const fichiers = await readdir(join(racine, '_mnemo', 'episodes', 'alpha'));
		const episode = fichiers.find((f) => f.endsWith('-Écrire b.md'));
		expect(episode, fichiers.join(', ')).toBeDefined();
		const texte = await readFile(join(racine, '_mnemo', 'episodes', 'alpha', episode!), 'utf8');
		expect(texte).toContain('branche: travail');
		expect(texte).toContain('- b.txt');
		expect(git(join(racine, '_mnemo'), 'log', '-1', '--format=%s')).toBe(`mnemo: episode episodes/alpha/${episode!}`);
	});

	it('git lent et verrou de la mémoire tenu : le hook abandonne l’écriture et finit dans son échéance (1 400 ms) ; session a_relire', async () => {
		const racine = await dossierAvecMemoire();
		// un faux `git` (script Node, en tête du PATH) qui ne répond pas avant 5 s
		const bin = join(racine, 'faux-bin');
		await mkdir(bin);
		await writeFile(join(bin, 'git'), `#!${process.execPath}\nsetTimeout(() => {}, 5000);\n`, { mode: 0o755 });
		let liberer: () => void = () => {};
		const tenu = new Promise<void>((r) => (liberer = r));
		const verrou = verrouFichier(join(racine, '.mnemo', 'verrou')).avec(() => tenu);
		try {
			const r = await hook(join(racine, 'alpha'), 'fin', entreeFin(racine), { MNEMO_SESSION: ID, MNEMO_RACINE: racine, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` });
			expect(r.code).toBe(0);
			// échéance du processus (1 400 ms depuis son démarrage) ; la mesure d'ici compte aussi le lancement de Node
			expect(r.ms).toBeLessThan(process.env.CI ? 3000 : 1500);
		} finally {
			liberer();
			await verrou;
		}
		expect((await lireSession(racine))?.etat).toBe('a_relire');
		expect(await readdir(join(racine, '_mnemo', 'episodes')).catch(() => [])).toEqual([]);
	});

	it('service vivant : fin lui est envoyé, le hook n’écrit rien lui-même', async () => {
		const racine = await dossierAvecMemoire();
		const { requetes } = await fauxService(racine, () => ({}));
		const r = await hook(join(racine, 'alpha'), 'fin', entreeFin(racine), { MNEMO_SESSION: ID, MNEMO_RACINE: racine });
		expect(r.code).toBe(0);
		expect(JSON.parse(requetes[0]!.corps)).toMatchObject({ evenement: 'fin', session: ID });
		expect(await readdir(join(racine, '_mnemo', 'episodes')).catch(() => [])).toEqual([]);
	});
});
