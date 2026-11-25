import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lectureTranscriptionCodex } from '../../src/infra/moteurs/codex/transcription.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const FIL = '019a0000-1111-7222-8333-444455556666';
const MAINTENANT = new Date(2026, 10, 25, 16, 0).getTime();

const tokenCount = (entree: number): string =>
	JSON.stringify({
		timestamp: '2026-11-25T15:00:00.000Z',
		type: 'event_msg',
		payload: { type: 'token_count', info: { last_token_usage: { input_tokens: entree, cached_input_tokens: 0, output_tokens: 0 }, model_context_window: 400_000 }, rate_limits: { limit_id: 'codex', primary: { used_percent: 7, window_minutes: 10_080, resets_at: 1_796_000_000 } } },
	});

/** Un `CODEX_HOME` jetable, avec une transcription du jour `jour` (25 novembre par défaut). */
async function codexHome(contenu: string, jour = '25'): Promise<{ home: string; accueil: string; chemin: string }> {
	const home = await dossierTemporaire();
	const accueil = await dossierTemporaire();
	const dossier = join(home, 'sessions', '2026', '11', jour);
	await mkdir(dossier, { recursive: true });
	const chemin = join(dossier, `rollout-2026-11-${jour}T15-00-00-${FIL}.jsonl`);
	await writeFile(chemin, contenu);
	return { home, accueil, chemin };
}

const lecture = (home: string, accueil: string, octetsLus?: number) => lectureTranscriptionCodex({ env: () => ({ CODEX_HOME: home }), accueil, maintenant: () => MAINTENANT, ...(octetsLus === undefined ? {} : { octetsLus }) });

describe('lectureTranscriptionCodex', () => {
	it('fenêtre et quotas du chemin donné par les hooks, sous $CODEX_HOME/sessions', async () => {
		const { home, accueil, chemin } = await codexHome(`${tokenCount(1_000)}\n${tokenCount(2_000)}\n`);
		expect(await lecture(home, accueil).lire({ chemin })).toEqual({
			fenetre: { utilises: 2_000, max: 400_000 },
			quotas: { semaine: { pourcentage: 7, remiseMs: 1_796_000_000_000 }, releveMs: Date.parse('2026-11-25T15:00:00.000Z') },
		});
	});

	it('accepte aussi ~/.codex/sessions', async () => {
		const { home: accueilCodex, chemin } = await codexHome(`${tokenCount(3_000)}\n`);
		const accueil = await dossierTemporaire();
		await symlink(accueilCodex, join(accueil, '.codex'));
		const autre = await dossierTemporaire();
		expect((await lecture(autre, accueil).lire({ chemin: join(accueil, '.codex', 'sessions', '2026', '11', '25', chemin.split(/[\\/]/u).at(-1)!) }))?.fenetre).toEqual({ utilises: 3_000, max: 400_000 });
	});

	it('ne lit que la fin d’un gros fichier et ignore une dernière ligne tronquée', async () => {
		const { home, accueil, chemin } = await codexHome(`${tokenCount(1_000)}\n${'x'.repeat(5_000)}\n${tokenCount(4_000)}\n${tokenCount(9_000).slice(0, 80)}`);
		expect((await lecture(home, accueil, 1_000).lire({ chemin }))?.fenetre).toEqual({ utilises: 4_000, max: 400_000 });
	});

	it('refuse un chemin hors du dossier permis, même par un lien, ou d’un autre format', async () => {
		const { home, accueil } = await codexHome(`${tokenCount(1_000)}\n`);
		const ailleurs = await dossierTemporaire();
		await writeFile(join(ailleurs, 'rollout.jsonl'), `${tokenCount(1_000)}\n`);
		await symlink(join(ailleurs, 'rollout.jsonl'), join(home, 'sessions', 'lien.jsonl'));
		await symlink(ailleurs, join(home, 'sessions', 'dossier-lien'));
		await writeFile(join(home, 'sessions', 'rollout.txt'), `${tokenCount(1_000)}\n`);
		const l = lecture(home, accueil);
		expect(await l.lire({ chemin: join(ailleurs, 'rollout.jsonl') })).toBeNull();
		expect(await l.lire({ chemin: join(home, 'sessions', '..', '..', ailleurs, 'rollout.jsonl') })).toBeNull();
		expect(await l.lire({ chemin: join(home, 'sessions', 'lien.jsonl') })).toBeNull();
		expect(await l.lire({ chemin: join(home, 'sessions', 'dossier-lien', 'rollout.jsonl') })).toBeNull();
		expect(await l.lire({ chemin: join(home, 'sessions', 'rollout.txt') })).toBeNull();
	});

	it('fichier absent : null ; sans chemin ni fil : null', async () => {
		const { home, accueil } = await codexHome(`${tokenCount(1_000)}\n`);
		expect(await lecture(home, accueil).lire({ chemin: join(home, 'sessions', 'absent.jsonl') })).toBeNull();
		expect(await lecture(home, accueil).lire({})).toBeNull();
	});

	it('à défaut de chemin (absent ou refusé), cherche par le fil dans les derniers jours', async () => {
		const { home, accueil } = await codexHome(`${tokenCount(5_000)}\n`, '22');
		const l = lecture(home, accueil);
		expect((await l.lire({ fil: FIL }))?.fenetre).toEqual({ utilises: 5_000, max: 400_000 });
		expect((await l.lire({ chemin: join(await dossierTemporaire(), 'x.jsonl'), fil: FIL }))?.fenetre).toEqual({ utilises: 5_000, max: 400_000 });
		expect(await l.lire({ fil: '019a0000-9999-7222-8333-444455556666' })).toBeNull();
		expect(await l.lire({ fil: '../x' })).toBeNull();
	});

	it('par le fil : rien au-delà des derniers jours', async () => {
		const { home, accueil } = await codexHome(`${tokenCount(5_000)}\n`, '10');
		expect(await lecture(home, accueil).lire({ fil: FIL })).toBeNull();
	});
});
