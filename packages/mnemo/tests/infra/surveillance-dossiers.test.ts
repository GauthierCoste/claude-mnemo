import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
	it('appelle le rappel à chaque fichier changé, selon le filtre', async () => {
		const ici = await dossierTemporaire();
		const vus: (string | null)[] = [];
		let rappels = 0;
		const filtre = (nom: string | null) => {
			vus.push(nom);
			return nom !== 'bruit.log';
		};
		arrets.push(surveillerDossiers([{ chemin: ici, filtre }], () => rappels++));
		// macOS peut signaler après coup des événements d'avant l'armement : la référence est prise ensuite
		await attendre(100);
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

	it('dossier absent : jamais créé, surveillé dès qu’il apparaît (rappel à l’armement) ; plus rien après l’arrêt', async () => {
		const ici = join(await dossierTemporaire(), 'serveurs', 'activite');
		let rappels = 0;
		const arreter = surveillerDossiers([{ chemin: ici }], () => rappels++, { reessaiMs: 50 });
		arrets.push(arreter);
		await attendre(150);
		expect(existsSync(ici)).toBe(false);
		expect(rappels).toBe(0);
		await mkdir(ici, { recursive: true });
		await attendreQue(() => rappels > 0);
		await attendre(100);
		const avant = rappels;
		await writeFile(join(ici, '1-1.json'), '{}');
		await attendreQue(() => rappels > avant);
		arreter();
		await attendre(50);
		const fige = rappels;
		await writeFile(join(ici, '1-2.json'), '{}');
		await attendre(200);
		expect(rappels).toBe(fige);
	});

	it('dossier retiré puis recréé : un fichier écrit ensuite appelle le rappel', async () => {
		const ici = join(await dossierTemporaire(), 'activite');
		await mkdir(ici);
		let rappels = 0;
		arrets.push(surveillerDossiers([{ chemin: ici }], () => rappels++, { reessaiMs: 50 }));
		await attendreQue(() => rappels > 0);
		await rm(ici, { recursive: true });
		await mkdir(ici);
		// réarmé sur le nouveau dossier (autre inode)
		await attendre(300);
		rappels = 0;
		await writeFile(join(ici, '1-1.json'), '{}');
		await attendreQue(() => rappels > 0);
	});
});
