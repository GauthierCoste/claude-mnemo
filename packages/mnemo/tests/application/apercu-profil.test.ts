import { describe, expect, it } from 'vitest';
import { apercuProfil } from '../../src/application/apercu-profil.ts';
import { enregistrerProfil } from '../../src/application/gerer-profils.ts';
import type { ProfilEditable } from '../../src/application/gerer-profils.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const EDITABLE: ProfilEditable = {
	avatar: { forme: 'renard', couleur: 'ambre' },
	consigne: 'Rédige les courriers.',
	lancement: 'projet',
	hooks: ['debut', 'message'],
	skillsMemoire: 'tous',
	plugins: [],
	moteur: 'claude-code',
	modele: '',
};

async function avecSkill(moteur: ProfilEditable['moteur']) {
	const dep = fauxPorts();
	await dep.coffre.ecrire('skills/devis/SKILL.md', '---\nname: devis\ndescription: Rédiger un devis.\n---\n# Devis\n');
	await enregistrerProfil(dep, 'redaction', { ...EDITABLE, moteur }, null);
	return apercuProfil(dep, 'redaction');
}

describe('aperçu du profil selon son moteur', () => {
	it('Claude Code : consigne seule, plugins Claude Code, CLAUDE.md hors Mnemo', async () => {
		const { blocs } = await avecSkill('claude-code');
		expect(blocs[0]).toMatchObject({ origine: 'profil', titre: 'Consigne du profil (personnalisée)', texte: 'Rédige les courriers.\n' });
		expect(blocs.map((b) => b.titre)).toContain('Plugins Claude Code');
		expect(blocs.find((b) => b.origine === 'hors_mnemo')?.elements?.map((e) => e.nom)).toContain('CLAUDE.md');
	});

	it('moteur inconnu de ce Mnemo (fiche écrite à la main) : l\'aperçu dit que le lancement est refusé', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('profils/revue/revue.md', '---\ntype: profil\nmoteur: gemini\n---\n# Revue\n\nRelis.\n');
		const { blocs, avertissements } = await apercuProfil(dep, 'revue');
		expect(blocs.length).toBeGreaterThan(0);
		expect(avertissements).toContainEqual(expect.stringMatching(/^Le profil « revue » ne peut pas être lancé : moteur « gemini » inconnu de ce Mnemo/u));
	});

	it('Codex : la consigne reçue avec la liste des skills (lues par lire), sans plugins, AGENTS.md hors Mnemo', async () => {
		const { blocs } = await avecSkill('codex');
		expect(blocs[0]?.titre).toBe('Consigne du profil (personnalisée), avec la liste des skills');
		expect(blocs[0]?.texte).toContain('## Skills de Mnemo');
		expect(blocs[0]?.texte).toContain('- devis : Rédiger un devis. (`skills/devis/SKILL.md`)');
		expect(blocs.find((b) => b.origine === 'memoire')?.titre).toBe('Skills de la mémoire (listées dans la consigne, lues par l\'outil lire)');
		expect(blocs.some((b) => b.origine === 'plugin')).toBe(false);
		expect(blocs.find((b) => b.origine === 'hors_mnemo')?.elements?.map((e) => e.nom)).toEqual(['AGENTS.md', 'Skills de Codex']);
	});

	it('Codex : la liste de la consigne vient de la même source que la session (champ projets appliqué avec un projet), sans rien écrire', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('skills/devis/SKILL.md', '---\nname: devis\ndescription: Rédiger un devis.\nprojets: [alpha]\n---\n# Devis\n');
		await enregistrerProfil(dep, 'redaction', { ...EDITABLE, moteur: 'codex' }, null);
		const avant = await dep.coffre.lire('profils/redaction/redaction.md');
		expect((await apercuProfil(dep, 'redaction', 'alpha')).blocs[0]?.texte).toContain('- devis : ');
		expect((await apercuProfil(dep, 'redaction', 'beta')).blocs[0]?.texte).not.toContain('- devis : ');
		expect((await apercuProfil(dep, 'redaction')).blocs[0]?.texte).toContain('- devis : ');
		expect(await dep.coffre.lire('profils/redaction/redaction.md')).toBe(avant);
	});
});
