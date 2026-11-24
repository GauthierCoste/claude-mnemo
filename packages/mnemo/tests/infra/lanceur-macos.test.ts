import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ecrireLanceur } from '../../src/infra/lanceur-macos.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

/** Un `main` factice : écrit ses arguments dans `<racine>/.mnemo/appel.json` (racine = 3e argument, comme `ouvrir <racine>`). */
const MAIN_FACTICE = `const [, , commande, racine] = process.argv;
process.getBuiltinModule('node:fs').writeFileSync(racine + '/.mnemo/appel.json', JSON.stringify({ commande, racine }));
`;

const lanceur = (racine: string, node: string, main: string) => ({ racine, node, main, path: '/usr/bin:/bin', version: '1', icones: [] });

describe.skipIf(process.platform !== 'darwin')('lanceur macOS : chemins avec espaces et caractères spéciaux', () => {
	it('Node, main.ts et dossier sous des chemins à espace, apostrophe, $ et & : le lanceur s’exécute et ouvre ce dossier', async () => {
		const base = await dossierTemporaire();
		const node = join(base, 'Application Support', "n'œud $x", 'node');
		await mkdir(join(node, '..'), { recursive: true });
		await symlink(process.execPath, node);
		const main = join(base, 'dépôt avec espace', 'main.mjs');
		await mkdir(join(main, '..'));
		await writeFile(main, MAIN_FACTICE);
		const racine = join(base, 'Mes dossiers', 'Clients & "X"');
		await mkdir(join(racine, '.mnemo'), { recursive: true });
		const applications = join(await dossierTemporaire(), 'Applications');

		const r = ecrireLanceur(applications, lanceur(racine, node, main));
		if ('refus' in r) throw new Error(r.refus);
		const executable = join(r.app, 'Contents', 'MacOS', 'mnemo-lanceur');
		const script = readFileSync(executable, 'utf8');
		expect(script.split('\n')[0]).not.toMatch(/\s/u);
		// Node désigné une seule fois : par le lien de la ligne #!
		expect(script).not.toContain(JSON.stringify(node));
		expect(readlinkSync(join(r.app, 'Contents', 'MacOS', 'node'))).toBe(node);
		execFileSync(executable, { timeout: 20_000 });
		expect(JSON.parse(readFileSync(join(racine, '.mnemo', 'appel.json'), 'utf8'))).toEqual({ commande: 'ouvrir', racine });
	});

	it('dossier des applications avec une espace (dossier personnel « Jean Dupont ») : refus qui nomme le chemin, rien n’est écrit', async () => {
		const applications = join(await dossierTemporaire(), 'Jean Dupont', 'Applications');
		const r = ecrireLanceur(applications, lanceur('/r', process.execPath, '/m.ts'));
		expect(r).toEqual({ refus: expect.stringContaining(join(applications, 'Mnemo.app')) });
		expect(existsSync(applications)).toBe(false);
	});
});
