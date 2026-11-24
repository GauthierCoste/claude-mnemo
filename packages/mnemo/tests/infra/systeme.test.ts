import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avecSensMemorise } from '../../src/application/chercher.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { normaliser } from '../../src/domaine/sens.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('.mnemo/.gitignore', () => {
	it('écrit « * » à la création de .mnemo/ (ouverture de l’index)', async () => {
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		await dep.index.fiches();
		dep.index.fermer();
		expect(readFileSync(join(racine, '.mnemo', '.gitignore'), 'utf8')).toBe('*\n');
	});

	it('écrit « * » à la création de .mnemo/ (verrou d’une écriture)', async () => {
		const racine = await dossierTemporaire();
		await dependancesReelles(racine).verrou.avec(async () => {});
		expect(readFileSync(join(racine, '.mnemo', '.gitignore'), 'utf8')).toBe('*\n');
	});

	it('un .mnemo/ existant sans .gitignore le reçoit à la prochaine ouverture', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, '.mnemo'));
		expect(existsSync(join(racine, '.mnemo', '.gitignore'))).toBe(false);
		const dep = dependancesReelles(racine);
		await dep.index.fiches();
		dep.index.fermer();
		expect(readFileSync(join(racine, '.mnemo', '.gitignore'), 'utf8')).toBe('*\n');
	});
});

describe('index paresseux : toutes les options transmises', () => {
	it('plusProches parGenre atteint SQLite : un passage reste candidat quand les 50 plus proches de tous genres sont des fiches', async () => {
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		try {
			for (let i = 0; i < 60; i++) await dep.coffre.ecrire(`f/f${i}.md`, `---\nid: 01F${i}\ntype: sujet\nupdated: 2026-11-01\n---\n# Fiche ${i}\n`);
			await mkdir(join(racine, 'docs'));
			await writeFile(join(racine, 'docs', 'notice.md'), '# Notice\n\n## Tarifs\n\nLa remise du catalogue est négociée chaque année.\n');
			await dep.coffre.ecrire('sources/notice.md', '---\nid: 01SRC\ntype: source\nchemin: docs/notice.md\ntype_source: spec_validee\nupdated: 2026-11-01\n---\n# Notice\n');
			await synchroniser(dep);
			const M = 'm@1';
			const lot = await dep.index.aVectoriser(M, 1000);
			const passages = lot.filter((a) => a.id.includes('#p-'));
			expect(passages.length).toBeGreaterThan(0);
			// fiches tout près de la requête, passages plus loin
			const vecteur = (id: string) => normaliser(id.includes('#p-') ? new Float32Array([0.6, 0.8, 0, 0]) : new Float32Array([1, 0.01, 0, 0]));
			await dep.index.enregistrerVecteurs(M, 4, lot.map((a) => ({ id: a.id, empreinte: a.empreinte, vecteur: vecteur(a.id) })));
			const requete = new Float32Array([1, 0, 0, 0]);
			const filtre = { statuts: ['servi' as const] };
			expect((await dep.index.plusProches(M, requete, filtre, 50)).every((v) => v.genre !== 'passage')).toBe(true);
			const memo = avecSensMemorise(dep);
			const trouves = await memo.index.plusProches(M, requete, { ...filtre, genres: ['passage'] }, 50);
			expect(trouves.map((v) => v.id).sort()).toEqual(passages.map((p) => p.id).sort());
		} finally {
			dep.index.fermer();
		}
	});

	it('cacheVecteurs sans ouvrir l’index (froid) ; nombreVecteurs transmis', async () => {
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		try {
			expect(dep.index.cacheVecteurs('m@1')).toBe('froid');
			expect(existsSync(join(racine, '.mnemo'))).toBe(false);
			expect(await dep.index.nombreVecteurs('m@1')).toBe(0);
			expect(dep.index.cacheVecteurs('m@1')).toBe('froid');
			await dep.index.plusProches('m@1', new Float32Array([1, 0]), {}, 5);
			expect(dep.index.cacheVecteurs('m@1')).toBe('chaud');
		} finally {
			dep.index.fermer();
		}
	});
});
