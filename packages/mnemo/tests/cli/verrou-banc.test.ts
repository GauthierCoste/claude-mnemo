import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prendreVerrouBanc } from '../../src/adaptateurs/cli/verrou-banc.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('verrou du fichier des jugements', () => {
	it('une seconde commande pendant --juger est refusée clairement ; rendu, il se reprend', async () => {
		const fichier = join(await dossierTemporaire(), 'banc-contexte.json');
		const rendre = prendreVerrouBanc(fichier, '--juger');
		// un processus vivant (le parent de ce test) tient le verrou
		writeFileSync(`${fichier}.verrou`, JSON.stringify({ pid: process.ppid, operation: '--juger', depuis: 'x' }));
		expect(() => prendreVerrouBanc(fichier, '--extraire')).toThrow(/ouvert par « mnemo banc contexte --juger »/u);
		rendre();
		expect(existsSync(`${fichier}.verrou`)).toBe(false);
		prendreVerrouBanc(fichier, '--extraire')();
	});

	it('un verrou laissé par un processus mort, ou illisible, est repris', async () => {
		const fichier = join(await dossierTemporaire(), 'banc-contexte.json');
		writeFileSync(`${fichier}.verrou`, JSON.stringify({ pid: 2 ** 22 + 12_345, operation: '--juger' }));
		prendreVerrouBanc(fichier, '--extraire')();
		writeFileSync(`${fichier}.verrou`, 'illisible');
		const rendre = prendreVerrouBanc(fichier, '--juger');
		expect(existsSync(`${fichier}.verrou`)).toBe(true);
		rendre();
	});
});
