// Côté processus principal de l'assistant, sans Electron : un faux `mnemo` (script Node écrit dans un dossier temporaire)
// tient lieu de `verifier-poste` et d'`init` ; la configuration est écrite sous un HOME temporaire, jamais le vrai.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LigneInit } from '@mnemo/contrat';
import { afterEach, describe, expect, it } from 'vitest';
import { CHOIX_PAR_DEFAUT, type ExecutableMnemo } from '../../src/domaine/assistant.ts';
import { cheminConfiguration, ecrireConfiguration, lireConfiguration, remplacerPathConfiguration } from '../../src/infra/configuration-fichier.ts';
import { MESSAGE_PROVISOIRE } from '../../src/domaine/assistant-demarrage.ts';
import { MESSAGE_REPRISE } from '../../src/domaine/assistant-reprise.ts';
import { controleurAssistant, decisionAuLancement, examinerDossier, MESSAGE_SANS_MNEMO, verifierPoste, type DependancesAssistant, type FinAssistant } from '../../src/infra/assistant.ts';

const dossiers: string[] = [];
afterEach(() => {
	for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temporaire = () => {
	const d = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-app-assistant-')));
	dossiers.push(d);
	return d;
};

const POSTE = { git: { ok: true, version: '2.50.1' }, claude: { ok: true, chemin: '/usr/local/bin/claude' }, node: { version: '24.1.0' } };

/**
 * Faux `mnemo` : `verifier-poste --json` rend POSTE ; `init <racine> --json …` crée `_mnemo/SCHEMA.md`, écrit ses lignes par
 * morceaux (une invalide au milieu, ses arguments et le PATH dans le message de la mémoire) et la fin. `FAUX_MODE` :
 * `usage` (erreur d'usage, code 2), `sans-memoire` (échec de la mémoire), `attente` (ne finit jamais), `illisible`.
 */
const FAUX = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [commande, racine, ...options] = process.argv.slice(2);
const mode = process.env.FAUX_MODE ?? '';
const ecrire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
if (commande === 'declarer') {
	// FAUX_DECLARER : le résultat de « declarer --remplacer --json » (code 1 sur echec)
	const resultat = process.env.FAUX_DECLARER ?? 'remplace';
	ecrire({ resultat, message: resultat === 'echec' ? 'claude ne répond pas' : 'Déclaration refaite.', args: [racine, ...options], path: process.env.PATH });
	process.exit(resultat === 'echec' ? 1 : 0);
}
if (commande === 'verifier-poste') {
	if (mode === 'illisible') process.stdout.write('pas du JSON\\n');
	else ecrire(${JSON.stringify(POSTE)});
	process.exit(0);
}
if (mode === 'usage') { process.stderr.write('Option inconnue : « --x ».\\nUsage : mnemo init\\n'); process.exit(2); }
ecrire({ etape: 'memoire', etat: 'debut', message: JSON.stringify({ options, path: process.env.PATH, cwd: process.cwd() }) });
if (mode === 'sans-memoire') { ecrire({ etape: 'memoire', etat: 'echec', message: 'disque plein' }); ecrire({ fin: true, racine, ok: false }); process.stderr.write('disque plein\\n'); process.exit(1); }
if (mode === 'attente') setInterval(() => {}, 1000);
else {
	mkdirSync(join(racine, '_mnemo'), { recursive: true });
	writeFileSync(join(racine, '_mnemo', 'SCHEMA.md'), '# Schéma\\n');
	const fait = JSON.stringify({ etape: 'memoire', etat: 'fait', message: 'Mémoire créée.' });
	process.stdout.write(fait.slice(0, 10));
	setTimeout(() => {
		process.stdout.write(fait.slice(10) + '\\n{ invalide\\n');
		ecrire({ etape: 'modeles', etat: 'progression', piece: 'moteur', libelle: 'Moteur', recu: 5, total: 10 });
		if (mode === 'perime' || mode === 'perime-et-commande') ecrire({ etape: 'mcp', etat: 'echec', message: 'Serveur MCP déclaré avec un autre chemin : lancez…', motif: 'perime' });
		else ecrire({ etape: 'mcp', etat: 'echec', message: 'claude absent' });
		if (mode === 'perime-et-commande') ecrire({ etape: 'commande', etat: 'echec', message: 'disque plein' });
		process.stdout.write(JSON.stringify({ fin: true, racine, ok: false }));
		process.exit(1);
	}, 20);
}
`;

function fauxMnemo(): ExecutableMnemo {
	const d = temporaire();
	const main = join(d, 'faux-mnemo.mjs');
	writeFileSync(main, FAUX);
	return { node: process.execPath, main, path: '/chemin/du/terminal:/usr/bin:/bin' };
}

type Essai = { home: string; projets: string; executable: ExecutableMnemo; lignes: LigneInit[]; termines: FinAssistant[]; d: DependancesAssistant };

function essai(o: { mode?: string; declarer?: string; choisi?: string | null; executable?: ExecutableMnemo | null; port?: number } = {}): Essai {
	const home = temporaire();
	const projets = temporaire();
	const executable = fauxMnemo();
	const lignes: LigneInit[] = [];
	const termines: FinAssistant[] = [];
	const d: DependancesAssistant = {
		executable: o.executable === undefined ? executable : o.executable,
		home,
		base: { ...process.env, FAUX_MODE: o.mode ?? '', FAUX_DECLARER: o.declarer ?? 'remplace' },
		choisirDossierNatif: async () => (o.choisi === undefined ? projets : o.choisi),
		envoyerLigne: (ligne) => void lignes.push(ligne),
		surTermine: (fin) => void termines.push(fin),
	};
	if (o.port !== undefined) d.port = o.port;
	return { home, projets, executable, lignes, termines, d };
}

describe('vérification du poste', () => {
	it('sans Mnemo à lancer : dit comment installer l’app', async () => {
		expect(await verifierPoste(null)).toEqual({ ok: false, erreur: MESSAGE_SANS_MNEMO, cause: 'sansMnemo' });
	});

	it('depuis un emplacement provisoire : rien n’est lancé, la page demande de déplacer l’app', async () => {
		expect(await verifierPoste(fauxMnemo(), process.env, true)).toEqual({ ok: false, erreur: MESSAGE_PROVISOIRE, cause: 'provisoire' });
	});

	it('lit la sortie de « mnemo verifier-poste --json » ; illisible ou introuvable : l’erreur', async () => {
		const executable = fauxMnemo();
		expect(await verifierPoste(executable, { ...process.env, FAUX_MODE: '' })).toEqual({ ok: true, poste: POSTE });
		const illisible = await verifierPoste(executable, { ...process.env, FAUX_MODE: 'illisible' });
		expect(illisible).toMatchObject({ ok: false, cause: 'echec' });
		const absent = await verifierPoste({ ...executable, node: join(temporaire(), 'pas-de-node') });
		expect(absent).toMatchObject({ ok: false, cause: 'echec' });
	});
});

describe('dossier choisi', () => {
	it('absolu et existant ; le dossier _mnemo d’une mémoire désigne sa racine', async () => {
		const racine = temporaire();
		expect(await examinerDossier(racine)).toEqual({ ok: true, dossier: { racine, memoireExistante: false } });
		mkdirSync(join(racine, '_mnemo'));
		writeFileSync(join(racine, '_mnemo', 'SCHEMA.md'), '#');
		expect(await examinerDossier(join(racine, '_mnemo'))).toEqual({ ok: true, dossier: { racine, memoireExistante: true } });
		expect(await examinerDossier(`${racine}/./`)).toEqual({ ok: true, dossier: { racine, memoireExistante: true } });
	});

	it('refusé : relatif, vide, autre chose qu’un texte, absent, fichier', async () => {
		const racine = temporaire();
		writeFileSync(join(racine, 'fichier'), '');
		for (const chemin of ['relatif', '', 3, null, `${racine}\0x`]) expect((await examinerDossier(chemin)).ok, String(chemin)).toBe(false);
		expect(await examinerDossier(join(racine, 'absent'))).toEqual({ ok: false, erreur: `Dossier introuvable : ${join(racine, 'absent')}` });
		expect(await examinerDossier(join(racine, 'fichier'))).toEqual({ ok: false, erreur: `Ce n’est pas un dossier : ${join(racine, 'fichier')}` });
	});

	it('refusé : un dossier dans une mémoire, ou un _mnemo sans SCHEMA.md (la mémoire irait dans une autre)', async () => {
		const racine = temporaire();
		mkdirSync(join(racine, '_mnemo', 'pages'), { recursive: true });
		expect((await examinerDossier(join(racine, '_mnemo'))).ok).toBe(false);
		writeFileSync(join(racine, '_mnemo', 'SCHEMA.md'), '#');
		expect((await examinerDossier(join(racine, '_mnemo', 'pages'))).ok).toBe(false);
	});
});

describe('contrôleur de l’assistant', () => {
	it('parcours complet : init lancé avec les choix et le PATH, lignes valides transmises, configuration écrite (0600), fin', async () => {
		const e = essai({ port: 4747 });
		expect(await e.d.choisirDossierNatif()).toBe(e.projets);
		const c = controleurAssistant(e.d);
		expect(await c.choisirDossier()).toEqual({ ok: true, dossier: { racine: e.projets, memoireExistante: false } });
		const resultat = await c.installer({ ...CHOIX_PAR_DEFAUT, modeles: true });
		expect(resultat).toEqual({ fin: { fin: true, racine: e.projets, ok: false }, erreur: null });
		expect(e.lignes.map((l) => ('fin' in l ? 'fin' : `${l.etape}:${l.etat}`))).toEqual(['memoire:debut', 'memoire:fait', 'modeles:progression', 'mcp:echec', 'fin']);
		const lance = JSON.parse((e.lignes[0] as { message: string }).message) as { options: string[]; path: string; cwd: string };
		// sous Windows, jamais de commande « mnemo » (test suivant)
		const commande = process.platform === 'win32' ? '--sans-commande' : '--commande';
		expect(lance).toEqual({ options: ['--json', '--mcp', '--modeles', commande, '--sans-lanceur'], path: e.executable.path, cwd: e.projets });

		expect(await c.terminer()).toEqual({ ok: true });
		const configuration = { racine: e.projets, node: e.executable.node, main: e.executable.main, path: e.executable.path, port: 4747 };
		expect(e.termines).toEqual([{ configuration, ouvrirALaSession: true }]);
		const chemin = cheminConfiguration(e.home);
		if (process.platform !== 'win32') expect(statSync(chemin).mode & 0o777).toBe(0o600);
		expect(readFileSync(chemin, 'utf8')).toBe(`${JSON.stringify(configuration, null, '\t')}\n`);
		expect(await lireConfiguration(e.home)).toEqual({ ok: true, configuration });

		// fini : plus rien ne se relance
		expect(await c.terminer()).toEqual({ ok: false, erreur: 'Déjà terminé.' });
		expect((await c.installer(CHOIX_PAR_DEFAUT)).erreur).toBe('L’installation est déjà lancée.');
		expect(await c.choisirDossier()).toMatchObject({ ok: false, annule: false });
	});

	it('sous Windows : la commande « mnemo » n’est jamais demandée à init, même cochée', async () => {
		const e = essai();
		const c = controleurAssistant({ ...e.d, plateforme: 'win32' });
		await c.choisirDossier();
		await c.installer(CHOIX_PAR_DEFAUT);
		const lance = JSON.parse((e.lignes[0] as { message: string }).message) as { options: string[] };
		expect(lance.options).toEqual(['--json', '--mcp', '--sans-modeles', '--sans-commande', '--sans-lanceur']);
	});

	it('entrées refusées : choix invalides, aucun dossier, aucun Mnemo ; terminer avant la fin', async () => {
		const e = essai();
		const c = controleurAssistant(e.d);
		expect(await c.terminer()).toEqual({ ok: false, erreur: 'L’installation n’est pas finie.' });
		expect(await c.installer(CHOIX_PAR_DEFAUT)).toEqual({ fin: null, erreur: 'Aucun dossier choisi.' });
		await c.choisirDossier();
		for (const brut of [null, { ...CHOIX_PAR_DEFAUT, racine: '/etc' }, { ...CHOIX_PAR_DEFAUT, mcp: 1 }]) expect(await c.installer(brut)).toEqual({ fin: null, erreur: 'Choix invalides.' });
		expect(e.lignes).toEqual([]);
		const sans = controleurAssistant(essai({ executable: null }).d);
		await sans.choisirDossier();
		expect(await sans.installer(CHOIX_PAR_DEFAUT)).toEqual({ fin: null, erreur: MESSAGE_SANS_MNEMO });
		// depuis l'image disque ou une translocation : jamais d'installation, même avec un Mnemo à lancer
		const provisoire = essai();
		const p = controleurAssistant({ ...provisoire.d, provisoire: true });
		await p.choisirDossier();
		expect(await p.installer(CHOIX_PAR_DEFAUT)).toEqual({ fin: null, erreur: MESSAGE_PROVISOIRE });
		expect(provisoire.lignes).toEqual([]);
	});

	it('sélecteur fermé : annulé, le dossier précédent gardé ; dossier invalide : l’erreur', async () => {
		let choisi: string | null = null;
		const e = essai();
		const c = controleurAssistant({ ...e.d, choisirDossierNatif: async () => choisi });
		expect(await c.choisirDossier()).toEqual({ ok: false, annule: true });
		choisi = 'relatif';
		expect(await c.choisirDossier()).toEqual({ ok: false, annule: false, erreur: 'Chemin de dossier invalide.' });
	});

	it('erreur d’usage (code 2, pas de fin) : la sortie d’erreur dite ; rien n’est écrit', async () => {
		const e = essai({ mode: 'usage' });
		const c = controleurAssistant(e.d);
		await c.choisirDossier();
		expect(await c.installer(CHOIX_PAR_DEFAUT)).toEqual({ fin: null, erreur: 'L’installation a échoué : Option inconnue : « --x ».\nUsage : mnemo init' });
		expect(await c.terminer()).toEqual({ ok: false, erreur: 'L’installation n’est pas finie.' });
		expect(await lireConfiguration(e.home)).toMatchObject({ ok: false });
	});

	it('mémoire en échec : une fin, mais pas de quoi terminer ; on peut relancer', async () => {
		const e = essai({ mode: 'sans-memoire' });
		const c = controleurAssistant(e.d);
		await c.choisirDossier();
		expect((await c.installer(CHOIX_PAR_DEFAUT)).fin).toEqual({ fin: true, racine: e.projets, ok: false });
		expect(await c.terminer()).toEqual({ ok: false, erreur: 'L’installation n’est pas finie.' });
		expect((await c.installer(CHOIX_PAR_DEFAUT)).fin).not.toBeNull();
	});

	it('ouverture de l’interface en échec : retentée sans réécrire ; deux demandes ne se croisent pas', async () => {
		const e = essai();
		let essais = 0;
		let liberer = (): void => undefined;
		const c = controleurAssistant({
			...e.d,
			surTermine: async (fin) => {
				essais++;
				if (essais === 1) throw new Error('service muet');
				await new Promise<void>((r) => (liberer = r));
				e.termines.push(fin);
			},
		});
		await c.choisirDossier();
		await c.installer(CHOIX_PAR_DEFAUT);
		expect(await c.terminer()).toEqual({ ok: false, erreur: 'Mnemo ne s’ouvre pas : service muet' });
		expect((await c.installer(CHOIX_PAR_DEFAUT)).erreur).toBe('L’installation est déjà lancée.');
		const second = c.terminer();
		expect(await c.terminer()).toEqual({ ok: false, erreur: 'Ouverture déjà en cours.' });
		liberer();
		expect(await second).toEqual({ ok: true });
		expect(e.termines).toHaveLength(1);
		expect(await c.terminer()).toEqual({ ok: false, erreur: 'Déjà terminé.' });
	});

	it('installation lancée pendant que le sélecteur est ouvert : le dossier n’est pas changé', async () => {
		const e = essai({ mode: 'attente' });
		let repondre = (_chemin: string | null): void => undefined;
		let premier = true;
		const c = controleurAssistant({
			...e.d,
			choisirDossierNatif: () => {
				if (premier) {
					premier = false;
					return Promise.resolve(e.projets);
				}
				return new Promise((r) => (repondre = r));
			},
		});
		await c.choisirDossier();
		const choix = c.choisirDossier();
		const enCours = c.installer(CHOIX_PAR_DEFAUT);
		repondre(temporaire());
		expect(await choix).toEqual({ ok: false, annule: false, erreur: 'L’installation est en cours.' });
		c.abandonner();
		await enCours;
	});

	it('fenêtre fermée en cours : init arrêté', async () => {
		const e = essai({ mode: 'attente' });
		const c = controleurAssistant(e.d);
		await c.choisirDossier();
		const enCours = c.installer(CHOIX_PAR_DEFAUT);
		while (e.lignes.length === 0) await new Promise((r) => setTimeout(r, 10));
		c.abandonner();
		expect(await enCours).toEqual({ fin: null, erreur: 'L’installation a échoué : arrêté (SIGTERM).' });
	});
});

describe('déclaration faite pour une autre installation de Mnemo', () => {
	const etapes = (lignes: LigneInit[]) => lignes.map((l) => ('fin' in l ? `fin:${l.ok}` : `${l.etape}:${l.etat}`));

	it('reprise par « mnemo declarer --remplacer --json » (même Node, même PATH) : étape faite, fin ok, rien d’un échec montré', async () => {
		const e = essai({ mode: 'perime' });
		const c = controleurAssistant(e.d);
		await c.choisirDossier();
		const resultat = await c.installer(CHOIX_PAR_DEFAUT);
		expect(etapes(e.lignes)).toEqual(['memoire:debut', 'memoire:fait', 'modeles:progression', 'mcp:fait', 'fin:true']);
		expect(e.lignes).toContainEqual({ etape: 'mcp', etat: 'fait', message: MESSAGE_REPRISE });
		expect(resultat).toEqual({ fin: { fin: true, racine: e.projets, ok: true }, erreur: null });
		expect(await c.terminer()).toEqual({ ok: true });
	});

	it('reprise lancée avec l’exécutable et le PATH de l’assistant', async () => {
		const e = essai({ mode: 'perime' });
		const vus: ExecutableMnemo[] = [];
		const c = controleurAssistant({
			...e.d,
			async reprendreDeclaration(executable) {
				vus.push(executable);
				return { ok: true, resultat: 'deja', message: 'déjà' };
			},
		});
		await c.choisirDossier();
		expect((await c.installer(CHOIX_PAR_DEFAUT)).fin?.ok).toBe(true);
		expect(vus).toEqual([e.executable]);
		expect(e.lignes).toContainEqual({ etape: 'mcp', etat: 'fait', message: 'Serveur MCP déjà déclaré.' });
	});

	it('reprise en échec : l’échec d’origine (sans motif) et la raison ; fin non ok', async () => {
		const e = essai({ mode: 'perime', declarer: 'echec' });
		const c = controleurAssistant(e.d);
		await c.choisirDossier();
		const resultat = await c.installer(CHOIX_PAR_DEFAUT);
		expect(etapes(e.lignes)).toEqual(['memoire:debut', 'memoire:fait', 'modeles:progression', 'mcp:echec', 'fin:false']);
		expect(e.lignes).toContainEqual({ etape: 'mcp', etat: 'echec', message: 'Serveur MCP déclaré avec un autre chemin : lancez… (reprise impossible : claude ne répond pas)' });
		expect(resultat.fin?.ok).toBe(false);
	});

	it('une autre étape en échec : la déclaration reprise, la fin reste non ok', async () => {
		const e = essai({ mode: 'perime-et-commande' });
		const c = controleurAssistant(e.d);
		await c.choisirDossier();
		const resultat = await c.installer(CHOIX_PAR_DEFAUT);
		expect(etapes(e.lignes)).toEqual(['memoire:debut', 'memoire:fait', 'modeles:progression', 'commande:echec', 'mcp:fait', 'fin:false']);
		expect(resultat.fin?.ok).toBe(false);
	});

	it('vrai échec (claude introuvable) : aucune reprise, son message gardé', async () => {
		const e = essai();
		let reprises = 0;
		const c = controleurAssistant({ ...e.d, reprendreDeclaration: async () => (reprises++, { ok: true, resultat: 'remplace', message: '' }) });
		await c.choisirDossier();
		await c.installer(CHOIX_PAR_DEFAUT);
		expect(reprises).toBe(0);
		expect(e.lignes).toContainEqual({ etape: 'mcp', etat: 'echec', message: 'claude absent' });
	});
});

describe('configuration écrite', () => {
	it('refusée si l’app ne la relirait pas ; remplace la précédente', async () => {
		const home = temporaire();
		await expect(ecrireConfiguration(home, { racine: 'relatif', node: '/n', main: '/m', path: '/bin' })).rejects.toThrow('Configuration refusée');
		await ecrireConfiguration(home, { racine: '/a', node: '/n', main: '/m', path: '/bin' });
		await ecrireConfiguration(home, { racine: '/b', node: '/n', main: '/m', path: '/bin' });
		expect(await lireConfiguration(home)).toEqual({ ok: true, configuration: { racine: '/b', node: '/n', main: '/m', path: '/bin' } });
	});

	it('« Reprendre le PATH du terminal » : seul « path » change, les autres clés restent (0600) ; refusé sans fichier ou vide', async () => {
		const home = temporaire();
		await expect(remplacerPathConfiguration(home, '/bin')).rejects.toThrow();
		const chemin = cheminConfiguration(home);
		mkdirSync(dirname(chemin), { recursive: true });
		// configuration de l'app empaquetée : sans node ni main, et une clé inconnue
		writeFileSync(chemin, JSON.stringify({ racine: '/a', path: '/bin', port: 4747, autre: 'gardée' }));
		const paquet = { node: '/App/node', main: '/App/main.ts' };
		await expect(remplacerPathConfiguration(home, '/x')).rejects.toThrow('Configuration refusée');
		await expect(remplacerPathConfiguration(home, '', paquet)).rejects.toThrow('Configuration refusée');
		await remplacerPathConfiguration(home, '/maison/.nvm/versions/node/v26/bin:/usr/bin:/bin', paquet);
		expect(JSON.parse(readFileSync(chemin, 'utf8'))).toEqual({ racine: '/a', path: '/maison/.nvm/versions/node/v26/bin:/usr/bin:/bin', port: 4747, autre: 'gardée' });
		if (process.platform !== 'win32') expect(statSync(chemin).mode & 0o777).toBe(0o600);
		writeFileSync(chemin, '[1]');
		await expect(remplacerPathConfiguration(home, '/bin', paquet)).rejects.toThrow('n’est pas un objet JSON');
	});

	it('au lancement : l’interface si la mémoire est là, sinon l’assistant', async () => {
		const home = temporaire();
		expect(await decisionAuLancement(home, undefined, '/bin')).toMatchObject({ assistant: true, executable: null });
		const racine = temporaire();
		await ecrireConfiguration(home, { racine, node: '/n', main: '/m', path: '/bin' });
		expect(await decisionAuLancement(home, undefined, '/bin')).toEqual({ assistant: true, raison: `Plus de mémoire Mnemo dans ${racine}.`, executable: { node: '/n', main: '/m', path: '/bin' } });
		mkdirSync(join(racine, '_mnemo'));
		writeFileSync(join(racine, '_mnemo', 'SCHEMA.md'), '#');
		expect(await decisionAuLancement(home, undefined, '/bin')).toMatchObject({ assistant: false });
	});

	it('app empaquetée : son Node et son main.ts, avec ou sans configuration', async () => {
		const home = temporaire();
		const paquet = { node: '/App/node', main: '/App/main.ts' };
		expect(await decisionAuLancement(home, paquet, '/usr/bin:/bin')).toMatchObject({ assistant: true, executable: { ...paquet, path: '/usr/bin:/bin' } });
		expect(await decisionAuLancement(home, paquet, '/usr/bin:/bin', true)).toMatchObject({ assistant: true, executable: null, provisoire: true });
		const racine = temporaire();
		// configuration sans node ni main (ou avec ceux d'une autre installation) : ceux du paquet
		mkdirSync(dirname(cheminConfiguration(home)), { recursive: true });
		writeFileSync(cheminConfiguration(home), JSON.stringify({ racine, path: '/bin' }));
		expect(await decisionAuLancement(home, paquet, '/x')).toMatchObject({ assistant: true, executable: { ...paquet, path: '/bin' } });
		mkdirSync(join(racine, '_mnemo'));
		writeFileSync(join(racine, '_mnemo', 'SCHEMA.md'), '#');
		expect(await decisionAuLancement(home, paquet, '/x')).toEqual({ assistant: false, configuration: { racine, ...paquet, path: '/bin' } });
	});

	it('PATH du terminal : lu (fonction appelée) seulement sans configuration, app empaquetée hors emplacement provisoire', async () => {
		const home = temporaire();
		const paquet = { node: '/App/node', main: '/App/main.ts' };
		let lectures = 0;
		const lire = async () => {
			lectures++;
			return '/maison/.nvm/versions/node/v26/bin:/usr/bin:/bin';
		};
		expect(await decisionAuLancement(home, paquet, lire)).toMatchObject({ assistant: true, executable: { ...paquet, path: '/maison/.nvm/versions/node/v26/bin:/usr/bin:/bin' } });
		expect(lectures).toBe(1);
		await decisionAuLancement(home, paquet, lire, true);
		await decisionAuLancement(home, undefined, lire);
		const racine = temporaire();
		await ecrireConfiguration(home, { racine, node: '/n', main: '/m', path: '/bin' });
		expect(await decisionAuLancement(home, paquet, lire)).toMatchObject({ assistant: true, executable: { ...paquet, path: '/bin' } });
		expect(lectures).toBe(1);
	});
});
