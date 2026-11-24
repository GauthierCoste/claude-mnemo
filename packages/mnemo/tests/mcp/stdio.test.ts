import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdir, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { NOMS_OUTILS } from '../../src/adaptateurs/mcp/outils.ts';
import { proposer } from '../../src/application/proposer.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

function init(cwd: string): Promise<void> {
	return new Promise((resoudre, rejeter) => {
		execFile(process.execPath, [MAIN, 'init'], { cwd, env: ENV_TEST }, (erreur) => (erreur ? rejeter(erreur) : resoudre()));
	});
}

/** Lance `mnemo mcp` dans `cwd` ; l'environnement hérité est purgé de CLAUDE_PROJECT_DIR (les tests peuvent tourner sous Claude Code). */
async function lancer(cwd: string, env: Record<string, string>): Promise<Client> {
	const { CLAUDE_PROJECT_DIR: _ignore, ...herite } = process.env as Record<string, string>;
	const transport = new StdioClientTransport({ command: process.execPath, args: [MAIN, 'mcp'], cwd, env: { ...herite, ...env }, stderr: 'pipe' });
	const client = new Client({ name: 'test', version: '0' });
	await client.connect(transport);
	return client;
}

describe('mnemo mcp sur stdio', () => {
	it('répond au protocole, cherche, et se termine avec le code 0 quand stdin se ferme', async () => {
		const racine = await dossierTemporaire();
		await init(racine);
		const dep = dependancesReelles(racine);
		try {
			const r = await proposer(dep, { genre: 'fait', fiche: 'projets/alpha/alpha.md', typeSiNouvelle: 'dossier', titreSiNouvelle: 'Projet Alpha', texte: "L'inventaire des machines est fait chaque mois", nature: 'declare', source: { ref: 'dit en séance', type: 'utilisateur' } });
			expect(r.statut).toBe('ecrit');
			expect(await proposer(dep, { genre: 'modification', fiche: 'projets/alpha/alpha.md', dossier_projet: 'alpha', source: { ref: 'dit en séance', type: 'utilisateur' } })).toMatchObject({ statut: 'ecrit' });
		} finally {
			dep.index.fermer();
		}
		const projet = join(racine, 'alpha');
		await mkdir(projet);

		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [MAIN, 'mcp'],
			// dossier courant ailleurs : seul CLAUDE_PROJECT_DIR désigne le projet
			cwd: await dossierTemporaire(),
			env: { ...(process.env as Record<string, string>), CLAUDE_PROJECT_DIR: projet },
			stderr: 'pipe',
		});
		const client = new Client({ name: 'test', version: '0' });
		const erreursProtocole: Error[] = [];
		client.onerror = (e) => erreursProtocole.push(e);
		await client.connect(transport);
		// le processus enfant n'est pas exposé par le transport : on le prend pour lire son code de sortie
		const enfant = (transport as unknown as { _process: ChildProcess })._process;
		const sortie = new Promise<number | null>((resoudre) => enfant.once('exit', (code) => resoudre(code)));

		expect(client.getInstructions()).toContain('projets/alpha');
		const r = (await client.callTool({ name: 'chercher', arguments: { requete: 'inventaire' } })) as { content: { text: string }[]; isError?: boolean };
		expect(r.isError).not.toBe(true);
		expect(r.content[0]!.text).toContain("L'inventaire des machines est fait chaque mois");

		await client.close();
		expect(await sortie).toBe(0);
		expect(erreursProtocole).toEqual([]);
	}, 20_000);

	it('CLAUDE_PROJECT_DIR inexistant : racine cherchée depuis le dossier courant', async () => {
		const racine = await dossierTemporaire();
		await init(racine);
		const ailleurs = await dossierTemporaire();
		const client = await lancer(racine, { CLAUDE_PROJECT_DIR: join(ailleurs, 'inexistant') });
		expect((await client.listTools()).tools).toHaveLength(NOMS_OUTILS.length);
		await client.close();
	}, 20_000);

	it('sans CLAUDE_PROJECT_DIR, dossier courant hors de toute mémoire : aucun outil', async () => {
		const client = await lancer(await dossierTemporaire(), {});
		expect((await client.listTools()).tools).toEqual([]);
		expect(client.getInstructions()).toBe('Aucune mémoire Mnemo ne couvre ce dossier.');
		await client.close();
	}, 20_000);

	it('stdin fermé pendant une extraction en arrière-plan : le processus sort aussitôt (code 0), sans attendre le fil isolé', async () => {
		const racine = await dossierTemporaire();
		await init(racine);
		await mkdir(join(racine, 'docs'));
		await writeFile(join(racine, 'docs', 'lourd.md'), '# Lourd\n\nLe tapir dort.\n');
		await new Promise<void>((resoudre, rejeter) =>
			execFile(process.execPath, [MAIN, 'source', 'docs/lourd.md'], { cwd: racine, env: ENV_TEST }, (erreur) => (erreur ? rejeter(erreur) : resoudre())),
		);
		// le document change et grossit (fichier creux de 3 Go : rien n'est écrit sur le disque) : sa relecture en
		// arrière-plan prend plusieurs secondes
		await truncate(join(racine, 'docs', 'lourd.md'), 3 * 1024 ** 3);
		const { CLAUDE_PROJECT_DIR: _ignore, ...herite } = process.env as Record<string, string>;
		const transport = new StdioClientTransport({ command: process.execPath, args: [MAIN, 'mcp'], cwd: racine, env: herite, stderr: 'pipe' });
		const client = new Client({ name: 'test', version: '0' });
		await client.connect(transport);
		const enfant = (transport as unknown as { _process: ChildProcess })._process;
		const sortie = new Promise<number | null>((resoudre) => enfant.once('exit', (code) => resoudre(code)));
		// la recherche répond sans attendre, et réveille l'extraction
		const r = (await client.callTool({ name: 'chercher', arguments: { requete: 'tapir' } })) as { isError?: boolean };
		expect(r.isError).not.toBe(true);
		await new Promise((r) => setTimeout(r, 300));
		const debut = Date.now();
		await client.close();
		expect(await sortie).toBe(0);
		expect(Date.now() - debut).toBeLessThan(1500);
	}, 60_000);
});
