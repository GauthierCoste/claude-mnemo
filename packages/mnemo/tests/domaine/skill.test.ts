import { describe, expect, it } from 'vitest';
import { CONTENU_SKILL_MAX, DESCRIPTION_SKILL_MAX, estNomDeSkill, lireSkill, MOTIF_NOM_DE_SKILL, motifsDeSkill, texteDeSkill } from '../../src/domaine/skill.ts';
import type { SkillEditee } from '../../src/domaine/skill.ts';

const DEVIS: SkillEditee = { nom: 'devis', description: 'Rédiger un devis au format de la maison.', icone: '📜', contenu: '# Devis\n\nPérimètre, lots, jours, total HT.' };

describe('skill : validation', () => {
	it('nom : minuscules, chiffres et tirets, 40 caractères au plus, sans tiret au début', () => {
		for (const nom of ['devis', 'compte-rendu-client', 'a', '9-vies', 'a'.repeat(40)]) expect(estNomDeSkill(nom)).toBe(true);
		for (const nom of ['', '-devis', 'Devis', 'devis client', 'devis_client', 'dévis', '../x', 'a'.repeat(41)]) expect(estNomDeSkill(nom)).toBe(false);
	});

	it('une skill valide : aucun motif', () => {
		expect(motifsDeSkill(DEVIS)).toEqual({});
		expect(motifsDeSkill({ ...DEVIS, icone: null, contenu: '' })).toEqual({});
	});

	it('refus motivés, par champ : nom, description vide ou sur plusieurs lignes ou trop longue, icône, contenu trop long', () => {
		expect(motifsDeSkill({ ...DEVIS, nom: 'Devis' })).toEqual({ nom: MOTIF_NOM_DE_SKILL });
		expect(Object.keys(motifsDeSkill({ ...DEVIS, description: '  ' }))).toEqual(['description']);
		expect(motifsDeSkill({ ...DEVIS, description: '' }).description).toMatch(/obligatoire/u);
		expect(Object.keys(motifsDeSkill({ ...DEVIS, description: 'une\nautre' }))).toEqual(['description']);
		expect(Object.keys(motifsDeSkill({ ...DEVIS, description: 'x'.repeat(DESCRIPTION_SKILL_MAX + 1) }))).toEqual(['description']);
		for (const icone of ['', ' ', '🎨 x', 'x'.repeat(17), '\u0007']) expect(Object.keys(motifsDeSkill({ ...DEVIS, icone }))).toEqual(['icone']);
		expect(motifsDeSkill({ ...DEVIS, icone: '👩‍💻' })).toEqual({});
		expect(Object.keys(motifsDeSkill({ ...DEVIS, contenu: 'x'.repeat(CONTENU_SKILL_MAX + 1) }))).toEqual(['contenu']);
	});
});

describe('skill : lecture et écriture du SKILL.md', () => {
	it('écrit name, description, metadata.icone et le contenu ; relu à l\'identique', () => {
		const texte = texteDeSkill(DEVIS);
		expect(texte).toBe('---\nname: devis\ndescription: Rédiger un devis au format de la maison.\nmetadata:\n  icone: 📜\n---\n\n# Devis\n\nPérimètre, lots, jours, total HT.\n');
		expect(lireSkill(texte)).toMatchObject({ description: DEVIS.description, icone: '📜', contenu: DEVIS.contenu, illisible: false });
	});

	it('sans icône : pas de metadata ; une description à caractères spéciaux reste lisible', () => {
		const texte = texteDeSkill({ ...DEVIS, icone: null, description: 'Devis : # lots, « jours » - total' });
		expect(texte).not.toMatch(/metadata/u);
		expect(lireSkill(texte).description).toBe('Devis : # lots, « jours » - total');
	});

	it('garde les clés inconnues (projets, license, autres metadata) ; remplace name, description et metadata.icone', () => {
		const ancien = '---\nname: ancien\ndescription: Vieux.\nprojets: [alpha]\nlicense: MIT\nmetadata:\n  auteur: Lou\n  icone: 🧹\n---\n\nVieux corps.\n';
		const lu = lireSkill(ancien);
		expect(lu).toMatchObject({ description: 'Vieux.', icone: '🧹', contenu: 'Vieux corps.' });
		const texte = texteDeSkill({ ...DEVIS, icone: null }, lu.entete);
		expect(texte).toBe('---\nname: devis\ndescription: Rédiger un devis au format de la maison.\nprojets:\n  - alpha\nlicense: MIT\nmetadata:\n  auteur: Lou\n---\n\n# Devis\n\nPérimètre, lots, jours, total HT.\n');
	});

	it('contenu vide : le frontmatter seul ; un SKILL.md sans frontmatter : tout est contenu', () => {
		expect(texteDeSkill({ ...DEVIS, icone: null, contenu: '\n\n' })).toBe('---\nname: devis\ndescription: Rédiger un devis au format de la maison.\n---\n');
		expect(lireSkill('# Juste un titre\n')).toEqual({ description: '', icone: null, contenu: '# Juste un titre', entete: {}, illisible: false });
	});

	it('frontmatter illisible : tout le texte en contenu, signalé illisible ; une icône qui n\'est pas un texte est ignorée', () => {
		const brut = '---\nname: [x\n---\nCorps\n';
		expect(lireSkill(brut)).toEqual({ description: '', icone: null, contenu: brut.trim(), entete: {}, illisible: true });
		expect(lireSkill('---\nname: x\ndescription: d\nmetadata:\n  icone: 3\n---\n').icone).toBeNull();
	});
});
