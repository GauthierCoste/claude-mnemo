import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import lockfile from 'proper-lockfile';
import { ATTENTE_PAR_DEFAUT, verrouFichier } from '../../src/infra/verrou-fichier.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('verrouFichier', () => {
	it('sérialise 20 actions concurrentes : aucune écriture perdue', async () => {
		const racine = await dossierTemporaire();
		const compteur = join(racine, 'compteur.txt');
		await writeFile(compteur, '0');
		const verrou = verrouFichier(join(racine, '.mnemo', 'verrou'));
		await Promise.all(
			Array.from({ length: 20 }, () =>
				verrou.avec(async () => {
					const valeur = Number(await readFile(compteur, 'utf8'));
					await new Promise((resolve) => setTimeout(resolve, 5));
					await writeFile(compteur, String(valeur + 1));
				}),
			),
		);
		expect(await readFile(compteur, 'utf8')).toBe('20');
	});

	it('signale en français une mémoire occupée trop longtemps', async () => {
		const racine = await dossierTemporaire();
		const fichier = join(racine, 'verrou');
		await writeFile(fichier, '');
		const liberer = await lockfile.lock(fichier);
		try {
			await expect(verrouFichier(fichier, { essais: 1 }).avec(async () => 'ok')).rejects.toThrow('Mémoire occupée par une autre écriture : réessayer dans un instant');
		} finally {
			await liberer();
		}
	});

	it('attend jusqu\'à une trentaine de secondes par défaut, avec des délais croissants', () => {
		const { essais, delaiMin, facteur, delaiMax } = ATTENTE_PAR_DEFAUT;
		let total = 0;
		for (let i = 0; i < essais; i++) total += Math.min(delaiMax, delaiMin * facteur ** i);
		expect(facteur).toBeGreaterThan(1);
		expect(total).toBeGreaterThanOrEqual(25_000);
		expect(total).toBeLessThanOrEqual(35_000);
	});

	it('libère le verrou même si l’action échoue', async () => {
		const racine = await dossierTemporaire();
		const verrou = verrouFichier(join(racine, 'verrou'));
		await expect(verrou.avec(async () => { throw new Error('boum'); })).rejects.toThrow('boum');
		expect(await verrou.avec(async () => 'ok')).toBe('ok');
	});
});
