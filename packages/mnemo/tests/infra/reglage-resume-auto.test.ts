import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seuilDeResumeAuto } from '../../src/infra/reglage-resume-auto.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

async function reglage(dossier: string, nom: string, contenu: string): Promise<void> {
	await mkdir(join(dossier, '.claude'), { recursive: true });
	await writeFile(join(dossier, '.claude', nom), contenu);
}

describe('seuilDeResumeAuto', () => {
	it('lit les réglages de l’utilisateur', async () => {
		const accueil = await dossierTemporaire();
		await reglage(accueil, 'settings.json', '{"autoCompactWindow":400000}');
		expect(await seuilDeResumeAuto(null, accueil)).toBe(400_000);
	});

	it('préfère le local du projet, puis le projet, puis l’utilisateur', async () => {
		const accueil = await dossierTemporaire();
		const projet = await dossierTemporaire();
		await reglage(accueil, 'settings.json', '{"autoCompactWindow":400000}');
		expect(await seuilDeResumeAuto(projet, accueil)).toBe(400_000);
		await reglage(projet, 'settings.json', '{"autoCompactWindow":300000}');
		expect(await seuilDeResumeAuto(projet, accueil)).toBe(300_000);
		await reglage(projet, 'settings.local.json', '{"autoCompactWindow":250000}');
		expect(await seuilDeResumeAuto(projet, accueil)).toBe(250_000);
	});

	it('ignore un fichier absent, un JSON invalide et une valeur qui n’est pas un nombre > 0', async () => {
		const accueil = await dossierTemporaire();
		const projet = await dossierTemporaire();
		await reglage(projet, 'settings.local.json', '{pas du json');
		await reglage(projet, 'settings.json', '{"autoCompactWindow":"400000"}');
		await reglage(accueil, 'settings.json', '{"autoCompactWindow":0}');
		expect(await seuilDeResumeAuto(projet, accueil)).toBeUndefined();
		expect(await seuilDeResumeAuto(await dossierTemporaire(), await dossierTemporaire())).toBeUndefined();
	});

	it('passe au suivant quand le premier n’a pas le réglage', async () => {
		const accueil = await dossierTemporaire();
		const projet = await dossierTemporaire();
		await reglage(projet, 'settings.local.json', '{"autres":1}');
		await reglage(accueil, 'settings.json', '{"autoCompactWindow":123456}');
		expect(await seuilDeResumeAuto(projet, accueil)).toBe(123_456);
	});
});
