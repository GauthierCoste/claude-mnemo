import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { surveillerDossiers } from '../../src/infra/surveillance-dossiers.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const arrets: (() => void)[] = [];
afterEach(() => {
	while (arrets.length > 0) arrets.pop()!();
});

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function attendreQue(condition: () => boolean, delaiMs = 3000): Promise<void> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (condition()) return;
		await attendre(20);
	}
	throw new Error('condition jamais remplie');
}

describe('surveillerDossiers', () => {
	it('crée le dossier, appelle le rappel à chaque fichier changé, selon le filtre', async () => {
		const ici = join(await dossierTemporaire(), 'a', 'b');
		const vus: (string | null)[] = [];
		let rappels = 0;
		arrets.push(
			surveillerDossiers(
				[
					{
						chemin: ici,
						filtre: (nom) => {
							vus.push(nom);
							return nom !== 'bruit.log';
						},
					},
				],
				() => rappels++,
			),
		);
		await attendreQue(() => existsSync(ici));
		await attendre(100);
		// macOS peut signaler après coup la création du dossier lui-même : la référence est prise ensuite
		await writeFile(join(ici, 'amorce.json'), 'x');
		await attendreQue(() => vus.includes('amorce.json'));
		await attendre(100);
		rappels = 0;
		vus.length = 0;
		await writeFile(join(ici, 'bruit.log'), 'x');
		await attendreQue(() => vus.includes('bruit.log'));
		await attendre(100);
		expect(rappels).toBe(0);
		await writeFile(join(ici, 'etat.json'), '{}');
		await attendreQue(() => rappels > 0);
	});

	it('dossier impossible à créer : surveillé dès qu’il peut l’être, rappel à la reprise ; plus rien après l’arrêt', async () => {
		const parent = join(await dossierTemporaire(), 'parent');
		// un fichier à la place du parent : le dossier ne peut pas être créé
		await writeFile(parent, 'gêne');
		const ici = join(parent, 'serveurs');
		let rappels = 0;
		const arreter = surveillerDossiers([{ chemin: ici }], () => rappels++, { reessaiMs: 50 });
		arrets.push(arreter);
		await attendre(150);
		expect(existsSync(ici)).toBe(false);
		await rm(parent);
		await attendreQue(() => existsSync(ici) && rappels > 0);
		const avant = rappels;
		await writeFile(join(ici, 'modeles.json'), '{}');
		await attendreQue(() => rappels > avant);
		arreter();
		await attendre(50);
		const fige = rappels;
		await writeFile(join(ici, 'niveau.json'), '{}');
		await attendre(200);
		expect(rappels).toBe(fige);
	});
});
