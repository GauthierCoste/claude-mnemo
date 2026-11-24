import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { initialiser } from '../../src/application/initialiser.ts';
import { chargerRegles } from '../../src/application/regles-du-coffre.ts';
import { REGLES_PAR_DEFAUT } from '../../src/domaine/regles.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const schema = await readFile(new URL('../../modeles/SCHEMA.md', import.meta.url), 'utf8');

describe('initialiser', () => {
	it('crée SCHEMA.md, .gitattributes et le profil travail en un seul commit, sans aucun dossier imposé', async () => {
		const dep = fauxPorts();
		const resultat = await initialiser(dep, schema);
		expect(resultat.statut).toBe('cree');
		expect(dep.commits).toEqual([{ message: 'mnemo: initialisation', chemins: 'tout' }]);
		expect(dep.fichiers.get('.gitattributes')).toBe('* text=auto eol=lf\n');
		expect(dep.fichiers.get('.gitignore')).toBe('.mnemo-*.tmp\n');
		expect(dep.fichiers.get('SCHEMA.md')).toBe(schema);
		expect([...dep.fichiers.keys()].sort()).toEqual(['.gitattributes', '.gitignore', 'SCHEMA.md', 'profils/travail/travail.md']);
		expect(lireFiche('profils/travail/travail.md', dep.fichiers.get('profils/travail/travail.md')!).type).toBe('profil');
	});

	it('ne fait rien si la mémoire existe déjà', async () => {
		const dep = fauxPorts();
		await initialiser(dep, schema);
		const avant = new Map(dep.fichiers);
		expect(await initialiser(dep, schema)).toEqual({ statut: 'existante', profil: null });
		expect(dep.commits).toHaveLength(1);
		expect(dep.fichiers).toEqual(avant);
	});

	it('mémoire existante sans profil travail : le dépose dans son propre commit', async () => {
		const dep = fauxPorts();
		await initialiser(dep, schema);
		dep.fichiers.delete('profils/travail/travail.md');
		const r = await initialiser(dep, schema);
		expect(r).toEqual({ statut: 'existante', profil: expect.any(String) });
		expect(dep.commits.at(-1)).toEqual({ message: 'mnemo: profil travail', chemins: ['profils/travail/travail.md'] });
		expect(lireFiche('profils/travail/travail.md', dep.fichiers.get('profils/travail/travail.md')!).type).toBe('profil');
	});

	it('mémoire existante : un profil travail modifié à la main n\'est jamais réécrit', async () => {
		const dep = fauxPorts();
		await initialiser(dep, schema);
		const perso = '---\nid: 01PRO\ntype: profil\nupdated: 2026-11-01\n---\n# Profil travail\n\nMa consigne.\n';
		dep.fichiers.set('profils/travail/travail.md', perso);
		const n = dep.commits.length;
		expect(await initialiser(dep, schema)).toEqual({ statut: 'existante', profil: null });
		expect(dep.fichiers.get('profils/travail/travail.md')).toBe(perso);
		expect(dep.commits).toHaveLength(n);
	});

	it('produit un SCHEMA.md dont les règles sont les défauts, sans anomalie', async () => {
		const dep = fauxPorts();
		await initialiser(dep, schema);
		expect(await chargerRegles(dep)).toEqual(REGLES_PAR_DEFAUT);
	});

	it('prend en compte une fiabilité d\'inconnue modifiée à la main', async () => {
		const dep = fauxPorts();
		await initialiser(dep, schema);
		dep.fichiers.set('SCHEMA.md', schema.replace('  inconnue: 0.3', '  inconnue: 0.2'));
		const regles = await chargerRegles(dep);
		expect(regles.fiabilites.inconnue).toBe(0.2);
		expect(regles.anomalies).toEqual([]);
	});
});
