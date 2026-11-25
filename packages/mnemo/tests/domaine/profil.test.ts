import { describe, expect, it } from 'vitest';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { CLES_GEREES_DU_PROFIL, donneesDeProfil, moteurOuModeleInvalides, MOTIF_ARCHIVISTE_HORS_CLAUDE_CODE, MOTIF_PLUGINS_HORS_CLAUDE_CODE, refusDuMoteur, estConsigneParDefaut, estIdentifiantDePlugin, lanceurPropreSansChemin, lireProfil, PROFILS_PAR_DEFAUT, skillPourProjet } from '../../src/domaine/profil.ts';
import type { Profil } from '../../src/domaine/profil.ts';

const DEFAUT: Profil = { ...PROFILS_PAR_DEFAUT.archiviste, hooks: [...PROFILS_PAR_DEFAUT.archiviste.hooks], consigne: 'Consigne par défaut.' };
const TRAVAIL: Profil = { ...PROFILS_PAR_DEFAUT.travail, hooks: [...PROFILS_PAR_DEFAUT.travail.hooks], consigne: 'Consigne travail.' };
const fiche = (texte: string) => lireFiche('profils/archiviste/archiviste.md', texte);

describe('profils par défaut', () => {
	it('travail : lancé dans le projet depuis le dialogue Nouvelle session, les six hooks, toutes les skills de la mémoire, aucun plugin, robot vert', () => {
		expect(PROFILS_PAR_DEFAUT.travail).toEqual({
			nom: 'travail',
			consignePersonnalisee: false,
			lancement: 'projet',
			lanceur: 'dialogue',
			hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'],
			skillsMemoire: 'tous',
			plugins: [],
			avatar: { forme: 'robot', couleur: 'vert' },
			moteur: 'claude-code',
			modele: '',
		});
	});
	it('archiviste : lancé dans la mémoire par son propre chemin, debut/arret/fin, aucune skill de la mémoire, aucun plugin, chouette violette', () => {
		expect(PROFILS_PAR_DEFAUT.archiviste).toEqual({
			nom: 'archiviste',
			consignePersonnalisee: false,
			lancement: 'memoire',
			lanceur: 'propre',
			hooks: ['debut', 'arret', 'fin'],
			skillsMemoire: [],
			plugins: [],
			avatar: { forme: 'chouette', couleur: 'violet' },
			moteur: 'claude-code',
			modele: '',
		});
	});
});

describe('lireProfil', () => {
	it('fiche absente → défaut', () => {
		expect(lireProfil(null, DEFAUT, [])).toEqual(DEFAUT);
	});

	it("fiche d'un autre type → défaut", () => {
		expect(lireProfil(fiche('---\ntype: sujet\nlancement: projet\n---\n# X\n\nAutre consigne.\n'), DEFAUT, [])).toEqual(DEFAUT);
	});

	it('lit consigne (synthèse), lancement, lanceur, hooks, skills de la mémoire, plugins et avatar', () => {
		const lu = lireProfil(
			fiche(
				'---\ntype: profil\nlancement: projet\nlanceur: dialogue\nhooks: [fin, debut, message]\nskills_memoire: [revue, notes]\nplugins: [superpowers@superpowers-marketplace]\navatar: { forme: renard, couleur: ambre }\n---\n# Archiviste\n\nMa consigne.\n',
			),
			DEFAUT,
			[],
		);
		expect(lu).toEqual({
			nom: 'archiviste',
			consigne: 'Ma consigne.',
			consignePersonnalisee: true,
			lancement: 'projet',
			lanceur: 'dialogue',
			hooks: ['debut', 'message', 'fin'],
			skillsMemoire: ['revue', 'notes'],
			plugins: ['superpowers@superpowers-marketplace'],
			avatar: { forme: 'renard', couleur: 'ambre' },
			moteur: 'claude-code',
			modele: '',
		});
	});

	it('moteur et modèle : lus du frontmatter ; absents → Claude Code et le modèle par défaut ; invalides → défaut champ par champ', () => {
		expect(lireProfil(fiche('---\ntype: profil\nmoteur: codex\nmodele: gpt-6.2-sol\n---\n# A\n'), TRAVAIL, [])).toMatchObject({ moteur: 'codex', modele: 'gpt-6.2-sol' });
		expect(lireProfil(fiche('---\ntype: profil\nmodele: opus\n---\n# A\n'), TRAVAIL, [])).toMatchObject({ moteur: 'claude-code', modele: 'opus' });
		expect(lireProfil(fiche('---\ntype: profil\n---\n# A\n'), TRAVAIL, [])).toMatchObject({ moteur: 'claude-code', modele: '' });
		expect(lireProfil(fiche('---\ntype: profil\nmoteur: gemini\nmodele: \'-x\'\n---\n# A\n'), TRAVAIL, [])).toMatchObject({ moteur: 'claude-code', modele: '', moteurInconnu: 'gemini' });
		expect(lireProfil(fiche('---\ntype: profil\nmoteur: 3\nmodele: [opus]\n---\n# A\n'), TRAVAIL, [])).toMatchObject({ moteur: 'claude-code', modele: '', moteurInconnu: '3' });
		expect(lireProfil(fiche('---\ntype: profil\nmoteur: codex\n---\n# A\n'), TRAVAIL, [])).not.toHaveProperty('moteurInconnu');
		expect(lireProfil(fiche('---\ntype: profil\nmodele: " opus"\n---\n# A\n'), TRAVAIL, []).modele).toBe('');
	});

	it('ancienne clé skills (v1.0) : projet → toutes les skills de la mémoire, profil → aucune ; skills_memoire l\'emporte', () => {
		expect(lireProfil(fiche('---\ntype: profil\nskills: projet\n---\n# A\n'), DEFAUT, []).skillsMemoire).toBe('tous');
		expect(lireProfil(fiche('---\ntype: profil\nskills: profil\n---\n# A\n'), TRAVAIL, []).skillsMemoire).toEqual([]);
		expect(lireProfil(fiche('---\ntype: profil\nskills: projet\nskills_memoire: [revue]\n---\n# A\n'), DEFAUT, []).skillsMemoire).toEqual(['revue']);
		expect(lireProfil(fiche('---\ntype: profil\nskills: profil\nskills_memoire: tous\n---\n# A\n'), DEFAUT, []).skillsMemoire).toBe('tous');
	});

	it('skills_memoire invalide → défaut en bloc ; plugins mal formés écartés un à un', () => {
		expect(lireProfil(fiche('---\ntype: profil\nskills_memoire: [revue, 42]\n---\n# A\n'), TRAVAIL, []).skillsMemoire).toBe('tous');
		expect(lireProfil(fiche('---\ntype: profil\nskills_memoire: certains\n---\n# A\n'), DEFAUT, []).skillsMemoire).toEqual([]);
		expect(lireProfil(fiche('---\ntype: profil\nplugins: [superpowers@superpowers-marketplace, mauvais, 3]\n---\n# A\n'), DEFAUT, []).plugins).toEqual(['superpowers@superpowers-marketplace']);
		expect(lireProfil(fiche('---\ntype: profil\nplugins: superpowers@superpowers-marketplace\n---\n# A\n'), DEFAUT, []).plugins).toEqual([]);
	});

	it('avatar invalide → avatar par défaut', () => {
		expect(lireProfil(fiche('---\ntype: profil\navatar: { forme: dragon, couleur: vert }\n---\n# A\n'), DEFAUT, []).avatar).toEqual({ forme: 'chouette', couleur: 'violet' });
		expect(lireProfil(fiche('---\ntype: profil\navatar: robot\n---\n# A\n'), TRAVAIL, []).avatar).toEqual({ forme: 'robot', couleur: 'vert' });
	});

	it('synthèse égale à une ancienne consigne par défaut → consigne par défaut, non personnalisée', () => {
		const anciennes = ['Ancienne ligne 1.\nAncienne ligne 2.'];
		const lu = lireProfil(fiche('---\ntype: profil\n---\n# A\n\nAncienne ligne 1.   \r\nAncienne ligne 2.\r\n'), DEFAUT, anciennes);
		expect(lu.consigne).toBe(DEFAUT.consigne);
		expect(lu.consignePersonnalisee).toBe(false);
		const autre = lireProfil(fiche('---\ntype: profil\n---\n# A\n\nAncienne ligne 1.\nLigne changée.\n'), DEFAUT, anciennes);
		expect(autre.consigne).toBe('Ancienne ligne 1.\nLigne changée.');
		expect(autre.consignePersonnalisee).toBe(true);
		expect(lireProfil(fiche('---\ntype: profil\n---\n# A\n'), DEFAUT, anciennes).consignePersonnalisee).toBe(false);
	});

	it('champs invalides ou absents → valeur par défaut champ par champ, jamais d\'erreur', () => {
		const lu = lireProfil(fiche('---\ntype: profil\nlancement: ailleurs\nlanceur: bouton\nhooks: [debut, inconnu]\nskills: 3\n---\n# Archiviste\n'), DEFAUT, []);
		expect(lu).toEqual(DEFAUT);
		expect(lireProfil(fiche('---\ntype: profil\nhooks: []\n---\n# A\n\n   \n'), DEFAUT, [])).toEqual(DEFAUT);
		expect(lireProfil(fiche('---\ntype: profil\nhooks: debut\n---\n# A\n'), DEFAUT, []).hooks).toEqual(DEFAUT.hooks);
	});

	it('lanceur « propre » : gardé pour un profil dont le défaut l’est (chemin connu du service), lu « dialogue » sinon', () => {
		const propre = fiche('---\ntype: profil\nlanceur: propre\n---\n# A\n');
		expect(lireProfil(propre, DEFAUT, []).lanceur).toBe('propre');
		const travail: Profil = { ...PROFILS_PAR_DEFAUT.travail, hooks: [...PROFILS_PAR_DEFAUT.travail.hooks], consigne: 'c' };
		expect(lireProfil(propre, travail, []).lanceur).toBe('dialogue');
		expect(lanceurPropreSansChemin(propre, travail)).toBe(true);
		expect(lanceurPropreSansChemin(propre, DEFAUT)).toBe(false);
	});

	it('les hooks sont dédoublonnés et rangés dans l\'ordre canonique', () => {
		expect(lireProfil(fiche('---\ntype: profil\nhooks: [arret, debut, arret]\n---\n# A\n'), DEFAUT, []).hooks).toEqual(['debut', 'arret']);
	});

	it('le défaut rendu est une copie : le modifier ne touche pas l\'original', () => {
		const lu = lireProfil(null, DEFAUT, []);
		lu.hooks.push('message');
		lu.plugins.push('a@b');
		lu.avatar.forme = 'chat';
		(lu.skillsMemoire as string[]).push('revue');
		expect(DEFAUT.hooks).toEqual(['debut', 'arret', 'fin']);
		expect(DEFAUT.plugins).toEqual([]);
		expect(DEFAUT.avatar).toEqual({ forme: 'chouette', couleur: 'violet' });
		expect(DEFAUT.skillsMemoire).toEqual([]);
	});
});

describe('moteur du profil', () => {
	it('refusDuMoteur : archiviste hors Claude Code, plugins avec un autre moteur ; rien avec Claude Code', () => {
		expect(refusDuMoteur({ nom: 'archiviste', moteur: 'codex', plugins: [] })).toEqual({ champ: 'moteur', motif: MOTIF_ARCHIVISTE_HORS_CLAUDE_CODE });
		expect(refusDuMoteur({ nom: 'redaction', moteur: 'codex', plugins: ['a@b'] })).toEqual({ champ: 'plugins', motif: MOTIF_PLUGINS_HORS_CLAUDE_CODE });
		expect(refusDuMoteur({ nom: 'redaction', moteur: 'codex', plugins: [] })).toBeNull();
		expect(refusDuMoteur({ nom: 'archiviste', moteur: 'claude-code', plugins: ['a@b'] })).toBeNull();
		// moteur inconnu de ce Mnemo (lu comme Claude Code) : refusé
		expect(refusDuMoteur({ nom: 'redaction', moteur: 'claude-code', plugins: [], moteurInconnu: 'gemini' })).toEqual({ champ: 'moteur', motif: expect.stringContaining('« gemini » inconnu de ce Mnemo') });
	});
	it('moteurOuModeleInvalides : un avertissement par valeur présente et invalide ; absente ou valide, aucun', () => {
		expect(moteurOuModeleInvalides(fiche('---\ntype: profil\nmoteur: Codex\nmodele: 4.5\n---\n# A\n'))).toEqual([expect.stringContaining('« Codex »'), expect.stringContaining('« 4.5 »')]);
		expect(moteurOuModeleInvalides(fiche('---\ntype: profil\nmodele: [opus]\n---\n# A\n'))).toEqual([expect.stringContaining('["opus"]')]);
		expect(moteurOuModeleInvalides(fiche('---\ntype: profil\nmoteur: codex\nmodele: gpt-6.2-sol\n---\n# A\n'))).toEqual([]);
		expect(moteurOuModeleInvalides(fiche('---\ntype: profil\n---\n# A\n'))).toEqual([]);
		expect(moteurOuModeleInvalides(null)).toEqual([]);
	});
});

describe('estConsigneParDefaut', () => {
	it('vide après trim → par défaut', () => {
		expect(estConsigneParDefaut('  \n\t\n', [])).toBe(true);
	});
	it('égale à une ancienne après normalisation (CRLF, espaces de fin de ligne, lignes vides de bord)', () => {
		const anciennes = ['Première.\nSeconde.', 'Autre.'];
		expect(estConsigneParDefaut('\r\n\r\nPremière.  \r\nSeconde.\t\r\n\r\n', anciennes)).toBe(true);
		expect(estConsigneParDefaut('Autre.', anciennes)).toBe(true);
		expect(estConsigneParDefaut('Première.\n\nSeconde.', anciennes)).toBe(false);
		expect(estConsigneParDefaut('Première.', anciennes)).toBe(false);
	});
});

describe('estIdentifiantDePlugin', () => {
	it('nom@marketplace, sans espace ni second @, 200 caractères au plus', () => {
		expect(estIdentifiantDePlugin('superpowers@superpowers-marketplace')).toBe(true);
		expect(estIdentifiantDePlugin('mauvais')).toBe(false);
		expect(estIdentifiantDePlugin('@marketplace')).toBe(false);
		expect(estIdentifiantDePlugin('nom@')).toBe(false);
		expect(estIdentifiantDePlugin('a@b@c')).toBe(false);
		expect(estIdentifiantDePlugin('un nom@marketplace')).toBe(false);
		expect(estIdentifiantDePlugin(`${'a'.repeat(100)}@${'b'.repeat(99)}`)).toBe(true);
		expect(estIdentifiantDePlugin(`${'a'.repeat(100)}@${'b'.repeat(100)}`)).toBe(false);
	});
});

describe('donneesDeProfil', () => {
	it('clés gérées du frontmatter, dans un ordre stable, sans skills ni lanceur « dialogue »', () => {
		const donnees = donneesDeProfil(lireProfil(null, TRAVAIL, []));
		expect(donnees).toEqual({
			avatar: { forme: 'robot', couleur: 'vert' },
			plugins: [],
			skills_memoire: 'tous',
			hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'],
			lancement: 'projet',
		});
		expect(Object.keys(donnees)).toEqual(['avatar', 'plugins', 'skills_memoire', 'hooks', 'lancement']);
	});
	it('lanceur écrit seulement s\'il diffère de « dialogue »', () => {
		const donnees = donneesDeProfil(DEFAUT);
		expect(Object.keys(donnees)).toEqual(['avatar', 'plugins', 'skills_memoire', 'hooks', 'lancement', 'lanceur']);
		expect(donnees.lanceur).toBe('propre');
		expect(donnees.skills_memoire).toEqual([]);
	});
	it('moteur écrit seulement s\'il diffère de Claude Code, modèle seulement s\'il n\'est pas vide', () => {
		expect(donneesDeProfil(TRAVAIL)).not.toHaveProperty('moteur');
		expect(donneesDeProfil(TRAVAIL)).not.toHaveProperty('modele');
		const donnees = donneesDeProfil({ ...TRAVAIL, moteur: 'codex', modele: 'gpt-6.2-sol' });
		expect(Object.keys(donnees)).toEqual(['avatar', 'plugins', 'skills_memoire', 'hooks', 'lancement', 'moteur', 'modele']);
		expect(donnees).toMatchObject({ moteur: 'codex', modele: 'gpt-6.2-sol' });
		expect(Object.keys(donneesDeProfil({ ...TRAVAIL, modele: 'opus' }))).toEqual(['avatar', 'plugins', 'skills_memoire', 'hooks', 'lancement', 'modele']);
	});
	it('rend des copies : modifier les données ne touche pas le profil', () => {
		const donnees = donneesDeProfil(DEFAUT);
		(donnees.hooks as string[]).push('message');
		(donnees.avatar as { forme: string }).forme = 'chat';
		expect(DEFAUT.hooks).toEqual(['debut', 'arret', 'fin']);
		expect(DEFAUT.avatar.forme).toBe('chouette');
	});
	it('CLES_GEREES_DU_PROFIL couvre les clés écrites et l\'ancienne clé skills', () => {
		expect(CLES_GEREES_DU_PROFIL).toEqual(['avatar', 'plugins', 'skills_memoire', 'skills', 'hooks', 'lancement', 'lanceur', 'moteur', 'modele']);
		for (const cle of Object.keys(donneesDeProfil({ ...DEFAUT, moteur: 'codex', modele: 'm' }))) expect(CLES_GEREES_DU_PROFIL).toContain(cle);
	});
});

describe('skillPourProjet', () => {
	it('sans frontmatter ou sans champ projets : active partout', () => {
		expect(skillPourProjet('# Revue\n\nTexte.', 'alpha')).toBe(true);
		expect(skillPourProjet('---\ndescription: Revue\n---\nTexte.', 'alpha')).toBe(true);
	});
	it('projets nomme le projet (liste ou texte)', () => {
		expect(skillPourProjet('---\nprojets: [alpha, beta]\n---\n', 'alpha')).toBe(true);
		expect(skillPourProjet('---\nprojets: alpha\n---\n', 'alpha')).toBe(true);
		expect(skillPourProjet('---\nprojets: [beta]\n---\n', 'alpha')).toBe(false);
		expect(skillPourProjet('---\nprojets: beta\n---\n', 'alpha')).toBe(false);
	});
	it('frontmatter illisible ou projets d\'un autre type : écartée', () => {
		expect(skillPourProjet('---\nprojets: [alpha\n---\n', 'alpha')).toBe(false);
		expect(skillPourProjet('---\nprojets: alpha\n', 'alpha')).toBe(false);
		expect(skillPourProjet('---\nprojets: 3\n---\n', 'alpha')).toBe(false);
	});
	it('accepte les fins de ligne CRLF', () => {
		expect(skillPourProjet('---\r\nprojets: [alpha]\r\n---\r\nTexte', 'alpha')).toBe(true);
	});
});
