import { describe, expect, it } from 'vitest';
import { detailProfil, dupliquerProfil, enregistrerProfil } from '../../src/application/gerer-profils.ts';
import type { ProfilEditable } from '../../src/application/gerer-profils.ts';
import { chargerProfil, cheminDeProfil } from '../../src/application/profil.ts';
import { MOTIF_PLUGINS_HORS_CLAUDE_CODE } from '../../src/domaine/profil.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const EDITABLE: ProfilEditable = {
	avatar: { forme: 'renard', couleur: 'ambre' },
	consigne: 'Rédige les courriers.',
	lancement: 'projet',
	hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'],
	skillsMemoire: 'tous',
	plugins: [],
	moteur: 'claude-code',
	modele: '',
};

describe('profil : moteur et modèle', () => {
	it('détail d\'une fiche écrite à la main au moteur ou au modèle invalides : défauts, avec un avertissement', async () => {
		const dep = fauxPorts();
		dep.fichiers.set(cheminDeProfil('redaction'), '---\ntype: profil\nmoteur: Codex\nmodele: 4.5\n---\n# Rédaction\n\nRédige.\n');
		const detail = (await detailProfil(dep, 'redaction'))!;
		expect(detail.editable).toMatchObject({ moteur: 'claude-code', modele: '' });
		expect(detail.avertissements).toEqual([expect.stringContaining('« Codex »'), expect.stringContaining('« 4.5 »')]);
	});

	it('un profil sans moteur ni modèle : Claude Code et le modèle par défaut ; réenregistré tel quel, rien n\'est écrit', async () => {
		const dep = fauxPorts();
		await enregistrerProfil(dep, 'redaction', EDITABLE, null);
		const ecrit = dep.fichiers.get(cheminDeProfil('redaction'))!;
		expect(ecrit).not.toMatch(/^moteur:|^modele:/mu);
		const detail = (await detailProfil(dep, 'redaction'))!;
		expect(detail.editable).toMatchObject({ moteur: 'claude-code', modele: '' });
		const commits = dep.commits.length;
		expect(await enregistrerProfil(dep, 'redaction', detail.editable, detail.empreinte)).toEqual({ ok: true, commit: null });
		expect(dep.commits).toHaveLength(commits);
	});

	it('moteur et modèle enregistrés dans le frontmatter, relus, et gardés par la copie', async () => {
		const dep = fauxPorts();
		const r = await enregistrerProfil(dep, 'redaction', { ...EDITABLE, moteur: 'codex', modele: 'gpt-6.2-sol' }, null);
		expect(r.ok).toBe(true);
		const ecrit = dep.fichiers.get(cheminDeProfil('redaction'))!;
		expect(ecrit).toMatch(/^moteur: codex$/mu);
		expect(ecrit).toMatch(/^modele: gpt-6.2-sol$/mu);
		expect(await chargerProfil(dep, 'redaction')).toMatchObject({ moteur: 'codex', modele: 'gpt-6.2-sol' });
		expect((await detailProfil(dep, 'redaction'))!.editable).toMatchObject({ moteur: 'codex', modele: 'gpt-6.2-sol' });
		expect((await dupliquerProfil(dep, 'redaction', 'courriers')).ok).toBe(true);
		expect(await chargerProfil(dep, 'courriers')).toMatchObject({ moteur: 'codex', modele: 'gpt-6.2-sol' });
		// revenir au défaut retire les clés
		const detail = (await detailProfil(dep, 'redaction'))!;
		await enregistrerProfil(dep, 'redaction', { ...detail.editable, moteur: 'claude-code', modele: '' }, detail.empreinte);
		expect(dep.fichiers.get(cheminDeProfil('redaction'))).not.toMatch(/^moteur:|^modele:/mu);
	});

	it('moteur inconnu, modèle invalide, plugins avec un autre moteur que Claude Code, archiviste hors Claude Code : refusés, rien n\'est écrit', async () => {
		const dep = fauxPorts();
		const refus = async (nom: string, editable: ProfilEditable) => {
			const r = await enregistrerProfil(dep, nom, editable, null);
			if (r.ok || !('motifs' in r)) throw new Error('refus attendu');
			return r.motifs;
		};
		expect((await refus('redaction', { ...EDITABLE, moteur: 'gemini' as ProfilEditable['moteur'] })).moteur).toContain('moteur inconnu');
		for (const modele of [' opus', '-x', 'op\nus', 'op’us', 'op\u202Eus', 'a'.repeat(101), 3 as unknown as string]) {
			expect((await refus('redaction', { ...EDITABLE, modele })).modele, String(modele)).toContain('modèle refusé');
		}
		expect((await refus('redaction', { ...EDITABLE, moteur: 'codex', plugins: ['superpowers@superpowers-marketplace'] })).plugins).toBe(MOTIF_PLUGINS_HORS_CLAUDE_CODE);
		expect((await refus('archiviste', { ...EDITABLE, lancement: 'memoire', moteur: 'codex' })).moteur).toContain('Claude Code');
		expect((await refus('redaction', { ...EDITABLE, moteur: 'codex', plugins: ['mauvais'] })).plugins).toContain('mal formés');
		expect(dep.fichiers.has(cheminDeProfil('redaction'))).toBe(false);
		expect(dep.commits).toHaveLength(0);
		// avec Claude Code, les plugins restent permis ; un modèle choisi aussi
		expect((await enregistrerProfil(dep, 'redaction', { ...EDITABLE, plugins: ['superpowers@superpowers-marketplace'], modele: 'opus' }, null)).ok).toBe(true);
	});
});
