import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { creerSkill, detailSkill, modifierSkill, supprimerSkill } from '../../src/application/gerer-skills.ts';
import { chargerProfil } from '../../src/application/profil.ts';
import { coffreFichiers } from '../../src/infra/coffre-fichiers.ts';
import { historiqueGit } from '../../src/infra/historique-git.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { git } from '../aides/git.ts';

/** Ports de test sur une vraie mémoire : fichiers et git dans un dossier temporaire. */
async function surDisque() {
	const racine = await dossierTemporaire();
	const historique = historiqueGit(racine);
	await historique.initialiser();
	return { racine, dep: { ...fauxPorts(), coffre: coffreFichiers(racine), historique } };
}

const DEVIS = { nom: 'devis', description: 'Rédiger un devis au format de la maison.', icone: '📜', contenu: '# Devis\n\nPérimètre, lots, jours, total HT.' };

describe('skills de la mémoire, sur disque', () => {
	it('créer, renommer puis supprimer : un commit git par écriture, l\'ancien dossier retiré, le profil suivi', async () => {
		const { racine, dep } = await surDisque();
		await dep.coffre.ecrire('profils/redaction/redaction.md', '---\ntype: profil\nskills_memoire: [devis]\n---\n# Profil redaction\n\nRédige.\n');
		await dep.historique.commit('profil', 'tout');

		expect((await creerSkill(dep, DEVIS)).ok).toBe(true);
		expect(await readFile(join(racine, 'skills', 'devis', 'SKILL.md'), 'utf8')).toMatch(/^metadata:\n {2}icone: 📜$/mu);

		const { empreinte } = (await detailSkill(dep, 'devis'))!;
		expect(await modifierSkill(dep, 'devis', { ...DEVIS, nom: 'devis-maison' }, empreinte)).toMatchObject({ ok: true, nom: 'devis-maison' });
		expect(existsSync(join(racine, 'skills', 'devis'))).toBe(false);
		expect(existsSync(join(racine, 'skills', 'devis-maison', 'SKILL.md'))).toBe(true);
		expect((await chargerProfil(dep, 'redaction')).skillsMemoire).toEqual(['devis-maison']);

		expect(await supprimerSkill(dep, 'devis-maison')).toMatchObject({ ok: true, nom: 'devis-maison' });
		expect(existsSync(join(racine, 'skills', 'devis-maison'))).toBe(false);
		expect((await chargerProfil(dep, 'redaction')).skillsMemoire).toEqual([]);

		expect(git(racine, 'log', '--format=%s', '-4').split('\n')).toEqual([
			'mnemo: supprime skills/devis-maison/',
			'mnemo: renomme skills/devis → skills/devis-maison',
			'mnemo: cree skills/devis/SKILL.md',
			'profil',
		]);
		expect(git(racine, 'status', '--porcelain')).toBe('');
	});

	it('une retouche à la main en cours est versionnée à part, avant l\'écriture de la skill', async () => {
		const { racine, dep } = await surDisque();
		await creerSkill(dep, DEVIS);
		await writeFile(join(racine, 'skills', 'devis', 'SKILL.md'), '---\nname: devis\ndescription: À la main.\n---\n');
		const { empreinte } = (await detailSkill(dep, 'devis'))!;
		await modifierSkill(dep, 'devis', DEVIS, empreinte);
		expect(git(racine, 'log', '--format=%s', '-2').split('\n')).toEqual(['mnemo: modifie skills/devis/SKILL.md', 'mnemo: modification manuelle']);
	});
});
