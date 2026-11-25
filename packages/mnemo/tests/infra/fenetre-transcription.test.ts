import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fenetreDeTranscription } from '../../src/infra/moteurs/claude-code/fenetre-transcription.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const reponse = (tokens: number): string => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: tokens } } });

describe('fenetreDeTranscription', () => {
	it('tire la fenêtre de la dernière réponse d’une transcription sous le dossier permis', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'projet'));
		const chemin = join(racine, 'projet', 's.jsonl');
		await writeFile(chemin, `${reponse(1000)}\n{"type":"user"}\n${reponse(2000)}\n`);
		expect(await fenetreDeTranscription(racine, undefined, await dossierTemporaire()).lire(chemin)).toEqual({ utilises: 2000, max: 200_000 });
	});

	it('ne lit que la fin d’un gros fichier, sans sa première ligne coupée', async () => {
		const racine = await dossierTemporaire();
		const chemin = join(racine, 's.jsonl');
		await writeFile(chemin, `${reponse(1000)}\n${'x'.repeat(100)}\n${reponse(3000)}\n`);
		expect(await fenetreDeTranscription(racine, 80, await dossierTemporaire()).lire(chemin)).toEqual({ utilises: 3000, max: 200_000 });
	});

	it('refuse un chemin hors du dossier permis, un autre format, un fichier absent', async () => {
		const racine = await dossierTemporaire();
		const ailleurs = await dossierTemporaire();
		await writeFile(join(ailleurs, 's.jsonl'), `${reponse(1000)}\n`);
		await writeFile(join(racine, 's.txt'), `${reponse(1000)}\n`);
		const t = fenetreDeTranscription(racine, undefined, await dossierTemporaire());
		expect(await t.lire(join(ailleurs, 's.jsonl'))).toBeNull();
		expect(await t.lire(join(racine, '..', 's.jsonl'))).toBeNull();
		expect(await t.lire(join(racine, 's.txt'))).toBeNull();
		expect(await t.lire(join(racine, 'absent.jsonl'))).toBeNull();
		// un lien sous la racine vers un fichier ou un dossier hors d'elle : refusé (liens résolus)
		await symlink(join(ailleurs, 's.jsonl'), join(racine, 'lien.jsonl'));
		await symlink(ailleurs, join(racine, 'dossier-lien'));
		expect(await t.lire(join(racine, 'lien.jsonl'))).toBeNull();
		expect(await t.lire(join(racine, 'dossier-lien', 's.jsonl'))).toBeNull();
	});

	it('prend le seuil de résumé automatique du projet comme maximum, même dépassé', async () => {
		const racine = await dossierTemporaire();
		const accueil = await dossierTemporaire();
		const projet = await dossierTemporaire();
		await mkdir(join(projet, '.claude'));
		await writeFile(join(projet, '.claude', 'settings.json'), '{"autoCompactWindow":400000}');
		const chemin = join(racine, 's.jsonl');
		const t = fenetreDeTranscription(racine, undefined, accueil);
		await writeFile(chemin, `${reponse(365_000)}\n`);
		expect(await t.lire(chemin, projet)).toEqual({ utilises: 365_000, max: 400_000, avantResume: true });
		expect(await t.lire(chemin)).toEqual({ utilises: 365_000, max: 1_000_000 });
		await writeFile(chemin, `${reponse(450_000)}\n`);
		expect(await t.lire(chemin, projet)).toEqual({ utilises: 450_000, max: 400_000, avantResume: true });
	});
});
