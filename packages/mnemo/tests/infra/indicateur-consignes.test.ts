import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ecrireIndicateur, FICHIER_CONSIGNES_VERIFIEES, FICHIER_INDEX, lireIndicateur, marquerIndicateurIllisible } from '../../src/infra/indicateur-consignes.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('indicateur des consignes vérifiées (.mnemo/)', () => {
	it('écrit puis relu : booléen et horodatage ; réécrit à chaque synchronisation', async () => {
		const local = await dossierTemporaire();
		ecrireIndicateur(local, true, 1000);
		expect(lireIndicateur(local)).toEqual({ genre: 'note', presentes: true, horodatageMs: 1000 });
		ecrireIndicateur(local, false, 2000);
		expect(lireIndicateur(local)).toEqual({ genre: 'note', presentes: false, horodatageMs: 2000 });
		expect(JSON.parse(await readFile(join(local, FICHIER_CONSIGNES_VERIFIEES), 'utf8'))).toEqual({ etat: 'a_jour', presentes: false, horodatageMs: 2000 });
	});

	it('marqué « pas à jour » (réindexation en échec) : relu illisible, donc strict', async () => {
		const local = await dossierTemporaire();
		ecrireIndicateur(local, false, 1);
		marquerIndicateurIllisible(local, 2);
		expect(JSON.parse(await readFile(join(local, FICHIER_CONSIGNES_VERIFIEES), 'utf8'))).toEqual({ etat: 'pas_a_jour', horodatageMs: 2 });
		expect(lireIndicateur(local)).toEqual({ genre: 'illisible' });
	});

	it('absent : dit si l\'index existe ; contenu cassé ou de mauvaise forme : illisible', async () => {
		const local = await dossierTemporaire();
		expect(lireIndicateur(local)).toEqual({ genre: 'absent', indexExiste: false });
		await writeFile(join(local, FICHIER_INDEX), '');
		expect(lireIndicateur(local)).toEqual({ genre: 'absent', indexExiste: true });
		const contenus = [
			'{ cassé',
			'[]',
			'{"etat": "a_jour", "presentes": "oui", "horodatageMs": 1}',
			'{"etat": "a_jour", "presentes": true}',
			// état explicite exigé : sans lui, ou inconnu, la note est refusée (strict)
			'{"presentes": false, "horodatageMs": 1}',
			'{"etat": "autre", "presentes": false, "horodatageMs": 1}',
		];
		for (const contenu of contenus) {
			await writeFile(join(local, FICHIER_CONSIGNES_VERIFIEES), contenu);
			expect(lireIndicateur(local), contenu).toEqual({ genre: 'illisible' });
		}
	});

	it('écriture impossible : l\'ancien indicateur ne reste pas (absent, donc strict si l\'index existe)', async () => {
		const local = await dossierTemporaire();
		ecrireIndicateur(local, false, 1);
		// un dossier à la place du fichier temporaire : l'écriture échoue
		await mkdir(join(local, `${FICHIER_CONSIGNES_VERIFIEES}.${process.pid}.tmp`));
		ecrireIndicateur(local, true, 2);
		expect(lireIndicateur(local)).toEqual({ genre: 'absent', indexExiste: false });
	});
});
