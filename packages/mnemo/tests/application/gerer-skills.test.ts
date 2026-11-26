import { describe, expect, it } from 'vitest';
import { detailProfil } from '../../src/application/gerer-profils.ts';
import { creerSkill, detailSkill, modifierSkill, revenirALOrigine, supprimerSkill } from '../../src/application/gerer-skills.ts';
import type { SkillEntree } from '../../src/application/gerer-skills.ts';
import { chargerProfil, cheminDeProfil } from '../../src/application/profil.ts';
import type { SkillParDefaut } from '../../src/application/profil.ts';
import { MOTIF_NOM_DE_SKILL, texteDeSkill } from '../../src/domaine/skill.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const DEVIS: SkillEntree = { nom: 'devis', description: 'Rédiger un devis au format de la maison.', icone: '📜', contenu: '# Devis\n\nPérimètre, lots, jours, total HT.' };
const CHEMIN = 'skills/devis/SKILL.md';
const profil = (nom: string, skills: string) => `---\ntype: profil\nskills_memoire: ${skills}\n---\n# Profil ${nom}\n\nRédige.\n`;

/** Mémoire de test : la skill `devis`, retenue par `redaction` (liste) et `travail` (tous), pas par `revue` (autre liste). */
async function memoire() {
	const dep = fauxPorts();
	await creerSkill(dep, DEVIS);
	dep.fichiers.set(cheminDeProfil('redaction'), profil('redaction', '[devis, relecture]'));
	dep.fichiers.set(cheminDeProfil('revue'), profil('revue', '[relecture]'));
	dep.fichiers.set('skills/relecture/SKILL.md', texteDeSkill({ nom: 'relecture', description: 'Relire.', icone: null, contenu: '' }));
	return dep;
}

describe('skills de la mémoire : créer et lire', () => {
	it('créer : skills/<nom>/SKILL.md, un commit « mnemo: cree » ; lue avec son icône, son contenu et les agents qui l\'équipent', async () => {
		const dep = await memoire();
		expect(dep.commits[0]).toMatchObject({ message: `mnemo: cree ${CHEMIN}`, chemins: [CHEMIN] });
		const detail = (await detailSkill(dep, 'devis'))!;
		expect(detail).toMatchObject({ nom: 'devis', description: DEVIS.description, icone: '📜', contenu: DEVIS.contenu, origine: 'memoire', modifiee: false, avertissements: [] });
		expect(detail.agents).toEqual(['redaction', 'travail']);
		expect(detail.empreinte).toMatch(/\S/u);
	});

	it('un profil qui a sa propre skill du même nom ne compte pas parmi les agents qui l\'équipent', async () => {
		const dep = await memoire();
		dep.fichiers.set('profils/travail/skills/devis/SKILL.md', '---\nname: devis\ndescription: x\n---\n');
		expect((await detailSkill(dep, 'devis'))!.agents).toEqual(['redaction']);
	});

	it('skill inconnue ou nom invalide : null', async () => {
		const dep = await memoire();
		expect(await detailSkill(dep, 'absente')).toBeNull();
		expect(await detailSkill(dep, '../profils')).toBeNull();
	});

	it('créer : refus motivés (nom invalide, nom pris, description vide), rien n\'est écrit', async () => {
		const dep = await memoire();
		const commits = dep.commits.length;
		expect(await creerSkill(dep, { ...DEVIS, nom: 'Devis' })).toEqual({ ok: false, motifs: { nom: MOTIF_NOM_DE_SKILL } });
		expect(await creerSkill(dep, DEVIS)).toEqual({ ok: false, motifs: { nom: 'la skill « devis » existe déjà' } });
		expect(await creerSkill(dep, { ...DEVIS, nom: 'autre', description: '' })).toMatchObject({ ok: false, motifs: { description: expect.any(String) } });
		expect(dep.commits).toHaveLength(commits);
	});

	it('créer sur un dossier existant sans SKILL.md : refusé, le nom est pris', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('skills/devis/notes.md', 'x');
		expect(await creerSkill(dep, DEVIS)).toEqual({ ok: false, motifs: { nom: 'la skill « devis » existe déjà' } });
	});

	it('le détail d\'un profil donne l\'icône des skills', async () => {
		const dep = await memoire();
		const detail = (await detailProfil(dep, 'redaction'))!;
		expect(detail.skillsMemoireDisponibles).toEqual([
			{ nom: 'devis', description: DEVIS.description, icone: '📜' },
			{ nom: 'relecture', description: 'Relire.' },
		]);
	});
});

describe('skills de la mémoire : modifier', () => {
	it('modifier : réécrit le SKILL.md (clés inconnues gardées), un commit « mnemo: modifie » ; rien à changer : aucun commit', async () => {
		const dep = await memoire();
		dep.fichiers.set(CHEMIN, '---\nname: devis\ndescription: Vieux.\nprojets: [alpha]\n---\n\nVieux.\n');
		const { empreinte } = (await detailSkill(dep, 'devis'))!;
		const r = await modifierSkill(dep, 'devis', DEVIS, empreinte);
		expect(r).toEqual({ ok: true, commit: expect.any(String), nom: 'devis' });
		expect(dep.commits.at(-1)).toMatchObject({ message: `mnemo: modifie ${CHEMIN}`, chemins: [CHEMIN] });
		expect(dep.fichiers.get(CHEMIN)).toMatch(/^projets:\n {2}- alpha$/mu);
		const commits = dep.commits.length;
		expect(await modifierSkill(dep, 'devis', DEVIS, (await detailSkill(dep, 'devis'))!.empreinte)).toEqual({ ok: true, commit: null, nom: 'devis' });
		expect(dep.commits).toHaveLength(commits);
	});

	it('modifier : conflit si le SKILL.md a changé depuis sa lecture ; inconnue : introuvable ; invalide : motifs', async () => {
		const dep = await memoire();
		expect(await modifierSkill(dep, 'devis', DEVIS, 'ancienne')).toEqual({ ok: false, conflit: true });
		expect(await modifierSkill(dep, 'absente', DEVIS, 'x')).toEqual({ ok: false, introuvable: true });
		const { empreinte } = (await detailSkill(dep, 'devis'))!;
		expect(await modifierSkill(dep, 'devis', { ...DEVIS, icone: 'deux mots' }, empreinte)).toMatchObject({ ok: false, motifs: { icone: expect.any(String) } });
	});

	it('renommer : déplace les .md du dossier, met à jour les profils qui la listent, un seul commit « mnemo: renomme a → b »', async () => {
		const dep = await memoire();
		dep.fichiers.set('skills/devis/exemples.md', '# Exemples\n');
		const { empreinte } = (await detailSkill(dep, 'devis'))!;
		const r = await modifierSkill(dep, 'devis', { ...DEVIS, nom: 'devis-maison' }, empreinte);
		expect(r).toEqual({ ok: true, commit: expect.any(String), nom: 'devis-maison' });
		const commit = dep.commits.at(-1)!;
		expect(commit.message).toBe('mnemo: renomme skills/devis → skills/devis-maison');
		expect([...commit.chemins].sort()).toEqual([cheminDeProfil('redaction'), 'skills/devis-maison/SKILL.md', 'skills/devis-maison/exemples.md', CHEMIN, 'skills/devis/exemples.md'].sort());
		expect([...dep.fichiers.keys()].filter((c) => c.startsWith('skills/devis/'))).toEqual([]);
		expect(dep.fichiers.get('skills/devis-maison/SKILL.md')).toMatch(/^name: devis-maison$/mu);
		expect(dep.fichiers.get('skills/devis-maison/exemples.md')).toBe('# Exemples\n');
		expect((await chargerProfil(dep, 'redaction')).skillsMemoire).toEqual(['devis-maison', 'relecture']);
		expect((await chargerProfil(dep, 'revue')).skillsMemoire).toEqual(['relecture']);
		expect((await detailSkill(dep, 'devis-maison'))!.agents).toEqual(['redaction', 'travail']);
	});

	it('renommer vers un nom pris : refusé, rien ne bouge', async () => {
		const dep = await memoire();
		const { empreinte } = (await detailSkill(dep, 'devis'))!;
		const commits = dep.commits.length;
		expect(await modifierSkill(dep, 'devis', { ...DEVIS, nom: 'relecture' }, empreinte)).toEqual({ ok: false, motifs: { nom: 'la skill « relecture » existe déjà' } });
		expect(dep.commits).toHaveLength(commits);
		expect(dep.fichiers.has(CHEMIN)).toBe(true);
	});
});

describe('skills de la mémoire : supprimer', () => {
	it('supprimer : retire le dossier et la skill des profils qui la listent, un commit « mnemo: supprime skills/<nom>/ »', async () => {
		const dep = await memoire();
		dep.fichiers.set('skills/devis/exemples.md', '# Exemples\n');
		expect(await supprimerSkill(dep, 'devis')).toEqual({ ok: true, commit: expect.any(String), nom: 'devis' });
		const commit = dep.commits.at(-1)!;
		expect(commit.message).toBe('mnemo: supprime skills/devis/');
		expect([...commit.chemins].sort()).toEqual([cheminDeProfil('redaction'), CHEMIN, 'skills/devis/exemples.md'].sort());
		expect([...dep.fichiers.keys()].filter((c) => c.startsWith('skills/devis/'))).toEqual([]);
		expect((await chargerProfil(dep, 'redaction')).skillsMemoire).toEqual(['relecture']);
		expect(await detailSkill(dep, 'devis')).toBeNull();
	});

	it('supprimer une skill inconnue : introuvable', async () => {
		expect(await supprimerSkill(fauxPorts(), 'absente')).toEqual({ ok: false, introuvable: true });
	});
});

describe('skills fournies par Mnemo', () => {
	const FOURNIES: SkillParDefaut[] = [{ nom: 'devis', texte: texteDeSkill(DEVIS) }];

	it('origine « mnemo » ; « modifiee » dès que le texte diffère de la version fournie', async () => {
		const dep = await memoire();
		expect(await detailSkill(dep, 'devis', FOURNIES)).toMatchObject({ origine: 'mnemo', modifiee: false });
		dep.fichiers.set(CHEMIN, texteDeSkill({ ...DEVIS, contenu: 'Autre.' }));
		expect(await detailSkill(dep, 'devis', FOURNIES)).toMatchObject({ origine: 'mnemo', modifiee: true });
	});

	it('revenir à l\'origine : réécrit la version fournie, un commit « mnemo: retablit » ; déjà d\'origine : aucun commit', async () => {
		const dep = await memoire();
		dep.fichiers.set(CHEMIN, texteDeSkill({ ...DEVIS, contenu: 'Autre.' }));
		expect(await revenirALOrigine(dep, 'devis', FOURNIES)).toEqual({ ok: true, commit: expect.any(String), nom: 'devis' });
		expect(dep.commits.at(-1)).toMatchObject({ message: `mnemo: retablit ${CHEMIN}`, chemins: [CHEMIN] });
		expect(dep.fichiers.get(CHEMIN)).toBe(FOURNIES[0]!.texte);
		expect(await revenirALOrigine(dep, 'devis', FOURNIES)).toEqual({ ok: true, commit: null, nom: 'devis' });
	});

	it('revenir à l\'origine : refusé pour une skill qui n\'est pas fournie par Mnemo ; inconnue : introuvable', async () => {
		const dep = await memoire();
		expect(await revenirALOrigine(dep, 'relecture', FOURNIES)).toEqual({ ok: false, motifs: { nom: 'la skill « relecture » n\'est pas fournie par Mnemo : pas de version d\'origine' } });
		expect(await revenirALOrigine(dep, 'absente', FOURNIES)).toEqual({ ok: false, introuvable: true });
	});
});
