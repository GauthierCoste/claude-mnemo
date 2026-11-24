import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { ClaudeDesktopVue, ServeurMcpEcriture } from '@mnemo/contrat';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { appeler, serviceFaux } from '../aides/service-faux.ts';

const NODE = '/opt/node/bin/node';
const MAIN = '/opt/mnemo/main.ts';
const serveur = (nom: string) => ROUTES.claudeDesktopServeur.replace(':id', encodeURIComponent(nom));

/** Service dont l'app Claude a son dossier dans une maison temporaire (`installee` : le dossier existe). */
async function contexte(options: { installee?: boolean; contenu?: string } = {}) {
	const maison = await dossierTemporaire();
	const dossier = join(maison, 'Claude');
	const fichier = join(dossier, 'claude_desktop_config.json');
	const service = await serviceFaux({}, { appClaude: { fichier, maison, node: NODE, main: MAIN } });
	if (options.installee !== false) mkdirSync(dossier, { recursive: true });
	if (options.contenu !== undefined) writeFileSync(fichier, options.contenu);
	const appel = (methode: string, chemin: string, corps?: unknown) => appeler(service.service.port, methode, chemin, { jeton: service.service.jeton, ...(corps === undefined ? {} : { corps }) });
	const lu = () => JSON.parse(readFileSync(fichier, 'utf8')) as Record<string, unknown>;
	return { racine: service.racine, fichier, appel, lu, affiche: `~${sep}Claude${sep}claude_desktop_config.json` };
}

const FICHIER = JSON.stringify({
	globalShortcut: 'Alt+Space',
	mcpServers: { notes: { command: 'npx', args: ['-y', 'serveur-notes'], env: { CLE_API: 'secret-123' } }, distant: { url: 'https://exemple.test/mcp' } },
});

describe('routes : app Claude', () => {
	it('app absente : installee faux, aucune écriture', async () => {
		const c = await contexte({ installee: false });
		const r = await c.appel('GET', ROUTES.claudeDesktop);
		expect(r.statut).toBe(200);
		expect(r.corps).toMatchObject({ installee: false, mnemo: 'absent', serveurs: [] });
		expect((await c.appel('PUT', ROUTES.claudeDesktopMnemo)).statut).toBe(409);
		expect(existsSync(c.fichier)).toBe(false);
	});

	it('GET : vue sans valeur de variable, chemin abrégé en ~', async () => {
		const c = await contexte({ contenu: FICHIER });
		const r = await c.appel('GET', ROUTES.claudeDesktop);
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({
			installee: true,
			fichier: c.affiche,
			mnemo: 'absent',
			serveurs: [
				{ nom: 'notes', commande: 'npx', args: ['-y', 'serveur-notes'], env: ['CLE_API'], modifiable: true },
				{ nom: 'distant', commande: 'https://exemple.test/mcp', args: [], env: [], modifiable: false },
			],
		} satisfies ClaudeDesktopVue);
		expect(r.texte).not.toContain('secret-123');
	});

	it('brancher, mettre à jour, débrancher Mnemo : autres clés et serveurs gardés', async () => {
		const c = await contexte({ contenu: FICHIER });
		const r = await c.appel('PUT', ROUTES.claudeDesktopMnemo);
		expect(r.statut).toBe(200);
		expect((r.corps as ClaudeDesktopVue).mnemo).toBe('branche');
		const attendu = { command: NODE, args: [MAIN, 'mcp'], env: { MNEMO_RACINE: c.racine } };
		expect(c.lu()).toEqual({ ...(JSON.parse(FICHIER) as object), mcpServers: { ...(JSON.parse(FICHIER) as { mcpServers: object }).mcpServers, mnemo: attendu } });
		expect(readFileSync(c.fichier, 'utf8')).toMatch(/^\{\n {2}"globalShortcut"[\s\S]*\}\n$/u);
		// périmée (autre Node) : signalée, puis réécrite
		writeFileSync(c.fichier, JSON.stringify({ ...c.lu(), mcpServers: { ...(c.lu()['mcpServers'] as object), mnemo: { ...attendu, command: '/autre/node' } } }));
		expect(((await c.appel('GET', ROUTES.claudeDesktop)).corps as ClaudeDesktopVue).mnemo).toBe('perime');
		expect(((await c.appel('PUT', ROUTES.claudeDesktopMnemo)).corps as ClaudeDesktopVue).mnemo).toBe('branche');
		const debranche = await c.appel('DELETE', ROUTES.claudeDesktopMnemo);
		expect((debranche.corps as ClaudeDesktopVue).mnemo).toBe('absent');
		expect(c.lu()).toEqual(JSON.parse(FICHIER));
	});

	it('fichier absent, dossier présent : créé à la première écriture', async () => {
		const c = await contexte();
		expect(((await c.appel('GET', ROUTES.claudeDesktop)).corps as ClaudeDesktopVue)).toMatchObject({ installee: true, mnemo: 'absent', serveurs: [] });
		expect((await c.appel('PUT', ROUTES.claudeDesktopMnemo)).statut).toBe(200);
		expect(c.lu()).toEqual({ mcpServers: { mnemo: { command: NODE, args: [MAIN, 'mcp'], env: { MNEMO_RACINE: c.racine } } } });
	});

	it('fichier illisible : erreur montrée, jamais réécrit', async () => {
		for (const contenu of ['{ pas du json', '{"mcpServers": []}']) {
			const c = await contexte({ contenu });
			const vue = (await c.appel('GET', ROUTES.claudeDesktop)).corps as ClaudeDesktopVue;
			expect(vue).toMatchObject({ installee: true, erreur: expect.any(String), serveurs: [] });
			for (const [methode, chemin, corps] of [
				['PUT', ROUTES.claudeDesktopMnemo, undefined],
				['DELETE', ROUTES.claudeDesktopMnemo, undefined],
				['POST', ROUTES.claudeDesktopServeurs, { nom: 'a', commande: 'a', args: [], env: {} }],
				['DELETE', serveur('notes'), undefined],
			] as const) {
				const r = await c.appel(methode, chemin, corps);
				expect(r.statut, `${methode} ${chemin}`).toBe(409);
			}
			expect(readFileSync(c.fichier, 'utf8')).toBe(contenu);
		}
	});

	it('ajouter, modifier (null garde la valeur), renommer, retirer un serveur', async () => {
		const c = await contexte({ contenu: FICHIER });
		const ajout: ServeurMcpEcriture = { nom: 'outil', commande: 'uvx', args: ['outil-mcp'], env: { JETON: 'abc' } };
		const r = await c.appel('POST', ROUTES.claudeDesktopServeurs, ajout);
		expect(r.statut).toBe(201);
		expect((r.corps as ClaudeDesktopVue).serveurs.map((s) => s.nom)).toEqual(['notes', 'distant', 'outil']);
		expect(r.texte).not.toContain('abc');
		expect((await c.appel('POST', ROUTES.claudeDesktopServeurs, ajout)).statut).toBe(409);

		const modif = await c.appel('PUT', serveur('notes'), { nom: 'carnet', commande: 'npx', args: ['-y', 'serveur-notes@2'], env: { CLE_API: null, MODE: 'x' } } satisfies ServeurMcpEcriture);
		expect(modif.statut).toBe(200);
		expect(modif.texte).not.toContain('secret-123');
		expect((c.lu()['mcpServers'] as Record<string, unknown>)['carnet']).toEqual({ command: 'npx', args: ['-y', 'serveur-notes@2'], env: { CLE_API: 'secret-123', MODE: 'x' } });
		expect(Object.keys(c.lu()['mcpServers'] as object)).toEqual(['carnet', 'distant', 'outil']);
		expect(c.lu()['globalShortcut']).toBe('Alt+Space');

		expect((await c.appel('PUT', serveur('absent'), ajout)).statut).toBe(404);
		expect((await c.appel('PUT', serveur('distant'), { ...ajout, nom: 'distant' })).statut).toBe(400);
		const retrait = await c.appel('DELETE', serveur('distant'));
		expect(retrait.statut).toBe(200);
		expect((retrait.corps as ClaudeDesktopVue).serveurs.map((s) => s.nom)).toEqual(['carnet', 'outil']);
		expect((await c.appel('DELETE', serveur('distant'))).statut).toBe(404);
	});

	it('nom mnemo réservé, corps invalides refusés (400), rien n’est écrit', async () => {
		const c = await contexte({ contenu: FICHIER });
		for (const corps of [
			{ nom: 'mnemo', commande: 'x', args: [], env: {} },
			{ nom: 'a', commande: 'x', args: [], env: {}, autre: 1 },
			{ nom: 'a', commande: 'x', args: 'y', env: {} },
			{ nom: 'a', commande: 'x', args: [], env: { A: 1 } },
			{ nom: 'a', commande: '', args: [], env: {} },
			{ nom: 'a', commande: 'x', args: [], env: { NEUVE: null } },
			[],
		])
			expect((await c.appel('POST', ROUTES.claudeDesktopServeurs, corps)).statut, JSON.stringify(corps)).toBe(400);
		expect((await c.appel('DELETE', serveur('mnemo'))).statut).toBe(400);
		expect((await c.appel('PUT', serveur('mnemo'), { nom: 'x', commande: 'x', args: [], env: {} })).statut).toBe(400);
		expect(readFileSync(c.fichier, 'utf8')).toBe(FICHIER);
	});

	it('jeton exigé', async () => {
		const c = await serviceFaux();
		expect((await appeler(c.service.port, 'GET', ROUTES.claudeDesktop, { jeton: null })).statut).toBe(401);
	});
});
