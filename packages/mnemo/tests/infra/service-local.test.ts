import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ecrireService, lireService, retirerService } from '../../src/infra/service-local.ts';
import { preparerDossierLocal } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('service.json', () => {
	it('retirerService ne retire que le fichier de ce service-là (le jeton, stable, ne suffit plus à le reconnaître)', async () => {
		const racine = await dossierTemporaire();
		preparerDossierLocal(racine);
		const jeton = 'e'.repeat(64);
		const ancien = { pid: process.pid, port: 4100, jeton, demarre: 1000 };
		const nouveau = { pid: process.pid, port: 4101, jeton, demarre: 2000 };
		ecrireService(racine, nouveau);
		retirerService(racine, ancien);
		expect(lireService(racine)).toEqual(nouveau);
		retirerService(racine, nouveau);
		expect(existsSync(join(racine, '.mnemo', 'service.json'))).toBe(false);
	});
});
