import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelesLocaux } from '../../src/infra/modeles/client-llama.ts';
import { cheminsModeles } from '../../src/infra/modeles/serveurs.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('modelesLocaux', () => {
	it('rien d’installé : « absent », et demarrer ne lance rien', async () => {
		const racine = await dossierTemporaire();
		const vide = await dossierTemporaire();
		const modeles = modelesLocaux(racine, { env: { MNEMO_MODELES: join(vide, 'cache') } });
		expect(await modeles.etatReranker()).toBe('absent');
		await modeles.demarrer();
		// aucun gardien n'a été lancé : pas d'état des serveurs écrit
		expect(existsSync(cheminsModeles(racine).etat)).toBe(false);
	});
});
