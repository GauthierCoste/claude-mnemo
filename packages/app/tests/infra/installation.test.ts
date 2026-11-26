// Ce que Mnemo a installé hors de l'app : lu, refait, retiré — toujours sous un dossier personnel temporaire (jamais le vrai
// ~/.local/bin, ~/.claude.json, ni la configuration de l'app Claude). La commande est refaite par le vrai `mnemo commande`
// (HOME temporaire) ; `claude` est introuvable (MNEMO_CLAUDE des tests) : la déclaration MCP échoue, sans arrêter le reste.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { declarer, lancerMnemo } from '../../src/infra/commande-mnemo.ts';
import { actionsFichiers, executerEtapes } from '../../src/infra/desinstallation.ts';
import { cheminsInstallation, lireEtatInstallation, retirerEntreeAppClaude, retirerFichiers } from '../../src/infra/installation-fichiers.ts';
import { journalFichier } from '../../src/infra/journal-app.ts';
import { verifierInstallation } from '../../src/infra/verification-installation.ts';

const MAIN_DEPOT = join(import.meta.dirname, '..', '..', '..', 'mnemo', 'src', 'adaptateurs', 'cli', 'main.ts');
/** Mnemo du dépôt lancé par ce Node : « le paquet » des tests. */
const NOUS = { node: process.execPath, main: MAIN_DEPOT };
const ANCIEN = { node: '/ancien/node', main: '/ancien/depot/packages/mnemo/src/adaptateurs/cli/main.ts' };

const dossiers: string[] = [];
function maison(): string {
	const d = mkdtempSync(join(tmpdir(), 'mnemo-app-installation-'));
	dossiers.push(d);
	return d;
}
afterEach(() => {
	for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

const script = (l: { node: string; main: string }) => `#!${l.node}\n// Commande « mnemo », écrite par Mnemo (local.mnemo.commande) : …\nimport(${JSON.stringify(pathToFileURL(l.main).href)});\n`;
const entree = (l: { node: string; main: string }) => ({ command: l.node, args: [l.main, 'mcp'], env: { MNEMO_RACINE: '/x' } });

function installer(home: string, o: { commande?: string; claudeCode?: unknown; appClaude?: unknown }): void {
	const c = cheminsInstallation(home);
	if (o.commande !== undefined) {
		mkdirSync(join(home, '.local', 'bin'), { recursive: true });
		writeFileSync(c.commande, o.commande, { mode: 0o755 });
	}
	if (o.claudeCode !== undefined) writeFileSync(c.claudeCode, JSON.stringify({ autre: 1, mcpServers: { mnemo: o.claudeCode } }));
	if (o.appClaude !== undefined) {
		mkdirSync(dirname(c.appClaude), { recursive: true });
		writeFileSync(c.appClaude, JSON.stringify({ preferences: { x: true }, mcpServers: { avant: { command: 'a' }, mnemo: o.appClaude } }, null, 2));
	}
}

/** Environnement des commandes de `mnemo` : HOME temporaire (la commande s'écrit dessous). */
const envDe = (home: string): NodeJS.ProcessEnv => ({ ...process.env, HOME: home });

describe('lecture de ce qui est installé', () => {
	it('rien d’installé : tout absent ; fichiers illisibles ou étrangers : autre', () => {
		const home = maison();
		expect(lireEtatInstallation(home, NOUS)).toEqual({ commande: 'absent', claudeCode: 'absent', appClaude: 'absent' });
		installer(home, { commande: '#!/bin/sh\necho autre\n' });
		writeFileSync(cheminsInstallation(home).claudeCode, '{ abîmé');
		expect(lireEtatInstallation(home, NOUS)).toMatchObject({ commande: 'autre', claudeCode: 'autre' });
	});

	it('à nous, ou de Mnemo ailleurs', () => {
		const home = maison();
		installer(home, { commande: script(NOUS), claudeCode: entree(NOUS), appClaude: entree(ANCIEN) });
		expect(lireEtatInstallation(home, NOUS)).toEqual({ commande: 'nous', claudeCode: 'nous', appClaude: 'ailleurs' });
	});
});

describe('vérification au lancement', () => {
	it('rien d’installé : rien n’est touché ni journalisé', async () => {
		const home = maison();
		const lignes: string[] = [];
		expect(await verifierInstallation({ home, lancement: NOUS, racine: '/x', path: process.env['PATH'] ?? '', service: null, journal: (l) => lignes.push(l), base: envDe(home) })).toEqual([]);
		expect(lignes).toEqual([]);
		expect(existsSync(join(home, '.local'))).toBe(false);
	});

	// la commande « mnemo » (script à shebang de ~/.local/bin) n'existe pas sous Windows : `mnemo commande` y refuse
	it.skipIf(process.platform === 'win32')('refait la commande par « mnemo commande » ; chaque élément indépendant, tout au journal', async () => {
		const home = maison();
		installer(home, { commande: script(ANCIEN), claudeCode: entree(ANCIEN), appClaude: entree(ANCIEN) });
		const avantAppClaude = readFileSync(cheminsInstallation(home).appClaude, 'utf8');
		const lignes: string[] = [];
		const refaits = await verifierInstallation({ home, lancement: NOUS, racine: '/x', path: process.env['PATH'] ?? '', service: null, journal: (l) => lignes.push(l), base: envDe(home) });
		expect(refaits).toEqual(['commande']);
		expect(readFileSync(cheminsInstallation(home).commande, 'utf8')).toContain(`#!${process.execPath}\n`);
		expect(lireEtatInstallation(home, NOUS).commande).toBe('nous');
		// claude introuvable : la déclaration reste, l'échec est dit ; service arrêté : l'app Claude attend le prochain lancement
		expect(lignes.some((l) => l.startsWith('déclaration MCP de Claude Code : non refaite'))).toBe(true);
		expect(lignes.some((l) => l.startsWith('entrée mnemo de l’app Claude : non refaite : service arrêté'))).toBe(true);
		expect(lignes.at(-1)).toContain('pointe encore ailleurs');
		expect(readFileSync(cheminsInstallation(home).appClaude, 'utf8')).toBe(avantAppClaude);
	}, 60_000);

	it('entrée de l’app Claude pour une autre racine, ou avec d’autres réglages : laissée, jamais réécrite', async () => {
		for (const appClaude of [{ ...entree(ANCIEN), env: { MNEMO_RACINE: '/autre' } }, { ...entree(ANCIEN), env: { MNEMO_RACINE: '/x', AUTRE: '1' } }]) {
			const home = maison();
			installer(home, { appClaude });
			const avant = readFileSync(cheminsInstallation(home).appClaude, 'utf8');
			const lignes: string[] = [];
			// service « vivant » jamais joint : l'entrée est laissée avant toute requête
			const service = { pid: 1, port: 1, jeton: 'j', demarre: 0 };
			expect(await verifierInstallation({ home, lancement: NOUS, racine: '/x', path: '', service, journal: (l) => lignes.push(l), base: envDe(home) })).toEqual([]);
			expect(lignes.some((l) => l.startsWith('entrée mnemo de l’app Claude : non refaite : laissée'))).toBe(true);
			expect(readFileSync(cheminsInstallation(home).appClaude, 'utf8')).toBe(avant);
		}
	});
});

describe('commandes de mnemo lancées par l’app', () => {
	it('mnemo declarer --json : l’échec (claude introuvable) lu dans sa ligne JSON', async () => {
		const home = maison();
		const r = await declarer(NOUS, '--retirer', process.env['PATH'] ?? '', envDe(home));
		expect(r).toMatchObject({ ok: false, raison: expect.stringContaining('claude') });
	}, 30_000);

	it('Node introuvable : la raison, jamais d’exception', async () => {
		const r = await lancerMnemo({ node: join(tmpdir(), 'mnemo-aucun-node'), main: MAIN_DEPOT }, ['commande'], '/bin');
		expect(r).toMatchObject({ ok: false });
	});
});

describe('désinstallation', () => {
	it('entrée de l’app Claude : retirée seulement si elle lance cette app, le reste gardé (0600)', () => {
		const home = maison();
		const fichier = cheminsInstallation(home).appClaude;
		expect(retirerEntreeAppClaude(fichier, NOUS)).toBe('absent');
		installer(home, { appClaude: entree(ANCIEN) });
		expect(retirerEntreeAppClaude(fichier, NOUS)).toBe('absent');
		installer(home, { appClaude: entree(NOUS) });
		expect(retirerEntreeAppClaude(fichier, NOUS)).toBe('retire');
		expect(JSON.parse(readFileSync(fichier, 'utf8'))).toEqual({ preferences: { x: true }, mcpServers: { avant: { command: 'a' } } });
		if (process.platform !== 'win32') expect(statSync(fichier).mode & 0o777).toBe(0o600);
	});

	it('étapes indépendantes : un échec n’arrête pas les suivantes ; commande et configuration retirées', async () => {
		const home = maison();
		// sous Windows, Mnemo n'installe jamais de commande (`mnemo commande` y refuse, même --retirer) : aucune à retirer,
		// l'étape la dit déjà absente
		installer(home, { ...(process.platform === 'win32' ? {} : { commande: script(NOUS) }), appClaude: entree(NOUS) });
		const config = join(home, 'config.json');
		writeFileSync(config, '{}');
		const fichiers = actionsFichiers({ home, lancement: NOUS, path: process.env['PATH'] ?? '', fichiersApp: [config, join(home, 'absent.json')], base: envDe(home) });
		const faits: string[] = [];
		const resultats = await executerEtapes(['ouvertureSession', 'commande', 'claudeCode', 'appClaude', 'configuration', 'service', 'corbeille'], {
			...fichiers,
			ouvertureSession: async () => void faits.push('ouvertureSession'),
			service: async () => {
				throw new Error('le service ne répond pas');
			},
			corbeille: async () => void faits.push('corbeille'),
			desinstalleur: async () => void faits.push('desinstalleur'),
		});
		expect(resultats.map((r) => [r.etape, r.ok])).toEqual([
			['ouvertureSession', true],
			['commande', true],
			['claudeCode', false],
			['appClaude', true],
			['configuration', true],
			['service', false],
			['corbeille', true],
		]);
		expect(resultats.find((r) => r.etape === 'service')).toMatchObject({ raison: 'le service ne répond pas' });
		expect(faits).toEqual(['ouvertureSession', 'corbeille']);
		expect(existsSync(cheminsInstallation(home).commande)).toBe(false);
		expect(existsSync(config)).toBe(false);
		expect(lireEtatInstallation(home, NOUS)).toEqual({ commande: 'absent', claudeCode: 'absent', appClaude: 'absent' });
		expect(retirerFichiers([config])).toEqual([]);
	}, 60_000);

	it('commande relue avant d’être retirée : celle d’une autre installation de Mnemo reste', async () => {
		const home = maison();
		installer(home, { commande: script(ANCIEN) });
		const fichiers = actionsFichiers({ home, lancement: NOUS, path: process.env['PATH'] ?? '', fichiersApp: [], base: envDe(home) });
		expect(await fichiers.commande()).toBe('laissée : elle ne lance plus cette app');
		expect(readFileSync(cheminsInstallation(home).commande, 'utf8')).toBe(script(ANCIEN));
		rmSync(cheminsInstallation(home).commande);
		expect(await fichiers.commande()).toBe('déjà absente');
	});
});

describe('journal de l’app', () => {
	it('une ligne horodatée par événement, dossier créé ; jamais d’exception', () => {
		const home = maison();
		const chemin = join(home, 'Mnemo', 'installation.log');
		const journal = journalFichier(chemin, () => new Date('2026-11-24T10:00:00.000Z'));
		journal('un');
		journal('deux\nlignes');
		expect(readFileSync(chemin, 'utf8')).toBe('2026-11-24T10:00:00.000Z un\n2026-11-24T10:00:00.000Z deux lignes\n');
		// dossier impossible à créer (sous un fichier), sur tout système
		const fichier = join(home, 'fichier');
		writeFileSync(fichier, '');
		expect(() => journalFichier(join(fichier, 'x', 'y.log'))('rien')).not.toThrow();
	});
});
