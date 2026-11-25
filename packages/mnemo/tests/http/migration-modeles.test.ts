import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ecrireEtatServeurs } from '../../src/infra/modeles/serveurs.ts';
import { serviceFaux } from '../aides/service-faux.ts';

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('service : migration de l’ancien gardien des modèles du dossier', () => {
	it('au démarrage, l’ancien état de .mnemo/ est retiré ; un processus étranger qu’il nomme reste en vie', async () => {
		const etranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
		let local = '';
		const lignes: string[] = [];
		try {
			const c = await serviceFaux(
				{ journal: (m) => lignes.push(m) },
				{
					avant: async (_etat, racine) => {
						local = join(racine, '.mnemo');
						const depuis = new Date().toISOString();
						await ecrireEtatServeurs(local, {
							gardien: { pid: etranger.pid!, depuis, etat: 'pret' },
							sens: { port: 1, cle: 'a'.repeat(64), modele: 'bge-m3-q8_0.gguf', pid: etranger.pid!, depuis },
						});
						await writeFile(join(local, 'modeles.log'), 'ancien journal\n');
					},
				},
			);
			try {
				const fin = Date.now() + 10_000;
				while ((await readdir(local)).some((f) => f.startsWith('modeles')) && Date.now() < fin) await attendre(50);
				expect((await readdir(local)).filter((f) => f.startsWith('modeles'))).toEqual([]);
				expect(lignes.join('\n')).toContain('ancien gardien des modèles de ce dossier : état périmé retiré.');
				expect(etranger.exitCode).toBeNull();
			} finally {
				await c.service.arreter();
			}
		} finally {
			etranger.kill('SIGKILL');
		}
	});
});
