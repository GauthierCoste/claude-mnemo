import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lireVersion, versionMnemo } from '../../src/infra/version.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('version de Mnemo', () => {
	it('versionMnemo lit la version de packages/mnemo/package.json', async () => {
		const paquet = JSON.parse(await readFile(join(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string };
		expect(versionMnemo()).toBe(paquet.version);
	});

	it.each([
		['fichier absent', null],
		['JSON cassé', '{'],
		['sans champ version', '{"name":"mnemo"}'],
		['version vide', '{"version":""}'],
	])('%s : erreur qui nomme le fichier, aucun repli', async (_cas, contenu) => {
		const dossier = await dossierTemporaire();
		const chemin = join(dossier, 'package.json');
		if (contenu !== null) await writeFile(chemin, contenu);
		expect(() => lireVersion(pathToFileURL(chemin))).toThrow(`Version de Mnemo illisible dans ${chemin}.`);
	});
});
