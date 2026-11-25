import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { ReponseFenetres, ReponseQuotas } from '@mnemo/contrat';
import type { Session } from '../../src/domaine/session.ts';
import { MOTEUR_CODEX } from '../../src/infra/moteurs/codex.ts';
import { lectureTranscriptionCodex } from '../../src/infra/moteurs/codex/transcription.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';

const UUID = '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FIL = '019a0000-1111-7222-8333-444455556666';

describe('routes : quotas du compte', () => {
	it('GET : null avant tout relevé ; POST garde le dernier relevé, que GET rend ensuite, avec son instant', async () => {
		const c = await serviceFaux();
		const jeton = c.service.jeton;
		expect((await appeler(c.service.port, 'GET', ROUTES.quotas, { jeton })).corps).toEqual({ quotas: null, moteurs: {} });
		const limites = { five_hour: { used_percentage: 42, resets_at: 1_795_600_000 }, seven_day: { used_percentage: 61, resets_at: 1_796_000_000 } };
		const fenetres = { cinqHeures: { pourcentage: 42, remiseMs: 1_795_600_000_000 }, semaine: { pourcentage: 61, remiseMs: 1_796_000_000_000 } };
		const avant = Date.now();
		const r = await appeler(c.service.port, 'POST', ROUTES.quotas, { jeton, corps: { rate_limits: limites } });
		expect(r.statut).toBe(200);
		const corps = r.corps as ReponseQuotas;
		expect(corps.quotas).toMatchObject(fenetres);
		expect(corps.quotas?.releveMs).toBeGreaterThanOrEqual(avant);
		expect(corps.moteurs).toEqual({ 'claude-code': corps.quotas });
		expect((await appeler(c.service.port, 'GET', ROUTES.quotas, { jeton })).corps).toEqual(corps);
	});

	it('POST sans fenêtre lisible : 400, le relevé précédent reste', async () => {
		const c = await serviceFaux();
		const jeton = c.service.jeton;
		const r = await appeler(c.service.port, 'POST', ROUTES.quotas, { jeton, corps: { rate_limits: {} } });
		expect(r.statut).toBe(400);
		expect((await appeler(c.service.port, 'GET', ROUTES.quotas, { jeton })).corps).toEqual({ quotas: null, moteurs: {} });
	});

	it('jeton exigé', async () => {
		const c = await serviceFaux();
		expect((await appeler(c.service.port, 'GET', ROUTES.quotas, {})).statut).toBe(401);
	});

	it('Codex : fenêtre et quotas relevés dans la transcription à chaque hook, à côté de ceux de Claude Code', async () => {
		const home = await dossierTemporaire();
		const dossier = join(home, 'sessions', '2026', '11', '25');
		await mkdir(dossier, { recursive: true });
		const transcription = join(dossier, `rollout-2026-11-25T15-00-00-${FIL}.jsonl`);
		const tokenCount = { timestamp: '2026-11-25T15:00:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 21_000, cached_input_tokens: 20_000, output_tokens: 300 }, model_context_window: 475_000 }, rate_limits: { limit_id: 'codex', primary: { used_percent: 2, window_minutes: 10_080, resets_at: 1_796_000_000 }, secondary: null } } };
		await writeFile(transcription, `${JSON.stringify(tokenCount)}\n`);
		const codex = { ...MOTEUR_CODEX, telemetrie: { fenetre: lectureTranscriptionCodex({ env: () => ({ CODEX_HOME: home }), accueil: await dossierTemporaire() }), quotas: () => null } };
		const c = await serviceFaux({}, { pil: (pil) => void (pil.moteurs = { ...pil.moteurs, codex: { moteur: codex, commande: null } }) });
		await c.etat.creer({ id: UUID, profil: 'travail', dossier: 'alpha', position: 'projets/alpha', projet: 'alpha', objectif: 'Objectif', etat: 'travaille', creeeMs: 1000, majMs: 1000, arretAttendu: null, bilanDemandeMs: null, commitDebut: null, branche: null, pid: null, moteur: 'codex', modele: '', fil: FIL } satisfies Session);
		const jeton = c.service.jeton;
		await appeler(c.service.port, 'POST', ROUTES.quotas, { jeton, corps: { rate_limits: { five_hour: { used_percentage: 10, resets_at: 1_795_600_000 } } } });
		const r = await appeler(c.service.port, 'POST', ROUTES.hook, { jeton, corps: { evenement: 'arret', session: UUID, horodatageMs: Date.now(), cwd: null, moteur: 'codex', fil: FIL, transcription } });
		expect(r.statut).toBe(200);
		const lus = async () => (await appeler(c.service.port, 'GET', ROUTES.quotas, { jeton })).corps as ReponseQuotas;
		expect(await jusqua(async () => (await lus()).moteurs?.codex !== undefined, 2000)).toBe(true);
		const quotas = await lus();
		expect(quotas.moteurs?.codex).toEqual({ semaine: { pourcentage: 2, remiseMs: 1_796_000_000_000 }, releveMs: Date.parse('2026-11-25T15:00:00.000Z') });
		expect(quotas.moteurs?.['claude-code']).toMatchObject({ cinqHeures: { pourcentage: 10 } });
		expect(quotas.quotas).toEqual(quotas.moteurs?.['claude-code']);
		const fenetres = (await appeler(c.service.port, 'GET', ROUTES.fenetres, { jeton })).corps as ReponseFenetres;
		expect(fenetres.fenetres[UUID]).toEqual({ utilises: 21_300, max: 475_000 });
	});
});
