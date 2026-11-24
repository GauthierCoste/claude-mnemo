import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transmettreQuotas } from '../../src/adaptateurs/cli/ligne-etat.ts';
import type { ServiceLocal } from '../../src/infra/service-local.ts';

const SERVICE: ServiceLocal = { pid: 1, port: 4000, jeton: 'a'.repeat(64), demarre: 0 };
const LIMITES = { five_hour: { used_percentage: 42, resets_at: 1_795_600_000 } };

describe('transmettreQuotas', () => {
	let racine: string;
	let envois: unknown[];
	const envoyer = async (_s: ServiceLocal, corps: unknown) => void envois.push(corps);
	const service = (r: string) => (r === racine ? SERVICE : null);

	beforeEach(() => {
		racine = mkdtempSync(join(tmpdir(), 'mnemo-ligne-etat-'));
		mkdirSync(join(racine, '_mnemo'));
		writeFileSync(join(racine, '_mnemo', 'SCHEMA.md'), '');
		envois = [];
	});
	afterEach(() => rmSync(racine, { recursive: true, force: true }));

	it("n'envoie que rate_limits, au service de MNEMO_RACINE", async () => {
		const entree = JSON.stringify({ session_id: 'x', transcript_path: '/t.jsonl', cwd: '/ailleurs', rate_limits: LIMITES, cost: { total_cost_usd: 1 } });
		expect(await transmettreQuotas(entree, { MNEMO_RACINE: racine }, '/', envoyer, service)).toBe(true);
		expect(envois).toEqual([{ rate_limits: LIMITES }]);
	});

	it('sans MNEMO_RACINE : le dossier Mnemo au-dessus du cwd de l’entrée', async () => {
		const sous = join(racine, 'projets', 'a');
		mkdirSync(sous, { recursive: true });
		expect(await transmettreQuotas(JSON.stringify({ cwd: sous, rate_limits: LIMITES }), {}, '/', envoyer, service)).toBe(true);
		expect(envois).toHaveLength(1);
	});

	it('rien sans rate_limits, sur une entrée illisible, ou sans service', async () => {
		expect(await transmettreQuotas(JSON.stringify({ cwd: racine }), { MNEMO_RACINE: racine }, '/', envoyer, service)).toBe(false);
		expect(await transmettreQuotas('pas du json', { MNEMO_RACINE: racine }, '/', envoyer, service)).toBe(false);
		expect(await transmettreQuotas(JSON.stringify({ rate_limits: LIMITES }), { MNEMO_RACINE: racine }, '/', envoyer, () => null)).toBe(false);
		expect(envois).toEqual([]);
	});
});
