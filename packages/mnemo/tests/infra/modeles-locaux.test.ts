import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelesLocaux } from '../../src/infra/modeles/client-llama.ts';
import { dossierServeurs } from '../../src/infra/modeles/dossier.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('modelesLocaux', () => {
	it('rien d’installé : « absent », et demarrer ne lance rien', async () => {
		const racine = await dossierTemporaire();
		const vide = await dossierTemporaire();
		const env = { MNEMO_MODELES: join(vide, 'cache') };
		const modeles = modelesLocaux(racine, { env });
		expect(await modeles.etatReranker()).toBe('absent');
		await modeles.demarrer();
		// aucun gardien n'a été lancé : pas même le dossier des serveurs
		expect(existsSync(dossierServeurs(env, process.platform, homedir()))).toBe(false);
	});
});
