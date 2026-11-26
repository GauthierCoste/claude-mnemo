import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { initialiser } from '../../src/application/initialiser.ts';
import { PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import { CHEMIN_PROFIL_TRAVAIL, CONSIGNE_ARCHIVISTE_PAR_DEFAUT, CONSIGNE_TRAVAIL_PAR_DEFAUT, lireProfil, PHRASE_RELATIONS } from '../../src/application/profil.ts';
import { profilsDisponibles } from '../../src/application/profils-disponibles.ts';
import { TABLES_DEMANDE } from '../../src/application/validation.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const schema = await readFile(new URL('../../modeles/SCHEMA.md', import.meta.url), 'utf8');

describe('profil travail', () => {
	it('initialiser dépose la fiche profil dans le commit d\'initialisation', async () => {
		const dep = fauxPorts();
		await initialiser(dep, schema);
		expect(dep.commits).toHaveLength(1);
		const fiche = lireFiche(CHEMIN_PROFIL_TRAVAIL, dep.fichiers.get('profils/travail/travail.md')!);
		expect(fiche.type).toBe('profil');
		expect(fiche.synthese.trim()).toBe('');
	});

	it('lireProfil lit la fiche ; absente ou illisible, rend le défaut', async () => {
		const dep = fauxPorts();
		expect(await lireProfil(dep, 'travail', 'défaut')).toBe('défaut');
		await initialiser(dep, schema);
		expect(await lireProfil(dep, 'travail', 'défaut')).toBe('défaut');
		dep.fichiers.set(CHEMIN_PROFIL_TRAVAIL, '---\ntype: [oups\n---\n# x');
		expect(await lireProfil(dep, 'travail', 'défaut')).toBe('défaut');
		dep.fichiers.set(CHEMIN_PROFIL_TRAVAIL, '---\ntype: sujet\n---\n# x\n\nautre');
		expect(await lireProfil(dep, 'travail', 'défaut')).toBe('défaut');
	});

	it('une fiche modifiée à la main donne le texte modifié, et une 2e init n\'y touche pas', async () => {
		const dep = fauxPorts();
		await initialiser(dep, schema);
		const modifiee = '---\ntype: profil\n---\n# Profil travail\n\nMa propre consigne.\n';
		dep.fichiers.set(CHEMIN_PROFIL_TRAVAIL, modifiee);
		expect(await lireProfil(dep, 'travail', 'défaut')).toBe('Ma propre consigne.');
		await initialiser(dep, schema);
		expect(dep.fichiers.get(CHEMIN_PROFIL_TRAVAIL)).toBe(modifiee);
	});

	it('la consigne tient en 2 000 caractères, nomme les outils et demande les relations', () => {
		expect(CONSIGNE_TRAVAIL_PAR_DEFAUT.length).toBeLessThanOrEqual(2000);
		expect(CONSIGNE_TRAVAIL_PAR_DEFAUT).toContain(PHRASE_RELATIONS);
		expect(CONSIGNE_ARCHIVISTE_PAR_DEFAUT).toContain(PHRASE_RELATIONS);
		for (const outil of ['chercher', 'lister', 'lire', 'voisins', 'contexte', 'proposer', 'apresProches', 'remplace', 'declare', '<donnees>']) {
			expect(CONSIGNE_TRAVAIL_PAR_DEFAUT).toContain(outil);
		}
	});

	it('nomme chacun des 9 outils comme mot entier', () => {
		for (const outil of ['chercher', 'lister', 'lire', 'voisins', 'chronologie', 'contexte', 'proposer', 'deplacer', 'extraire_source']) {
			expect(CONSIGNE_TRAVAIL_PAR_DEFAUT, outil).toMatch(new RegExp(`(?<![\\p{L}\\d_])${outil}(?![\\p{L}\\d_])`, 'u'));
		}
	});

	it('chaque nom entre accents graves est un outil, un champ de la validation ou une valeur connue', () => {
		const outils = ['chercher', 'lister', 'lire', 'voisins', 'chronologie', 'contexte', 'proposer', 'deplacer', 'extraire_source'];
		const champs = new Set([...Object.keys(TABLES_DEMANDE.fait), ...Object.keys(TABLES_DEMANDE.consigne), ...Object.keys(TABLES_DEMANDE.modification), 'ref', 'type']);
		const genres = Object.keys(TABLES_DEMANDE);
		const valeurs = [...genres, 'declare', 'utilisateur', 'proches', 'true', '<donnees>', 'deplacer(id, dossier)', '{ref, type: utilisateur}'];
		const cites = [...CONSIGNE_TRAVAIL_PAR_DEFAUT.matchAll(/`([^`]+)`/gu)].map((m) => m[1]!);
		expect(cites.length).toBeGreaterThan(15);
		for (const nom of cites) expect([...outils, ...champs, ...valeurs], nom).toContain(nom);
		for (const champ of ['nature', 'source', 'remplace', 'apresProches', 'fiche']) expect(champs.has(champ), champ).toBe(true);
	});
});

describe('profilsDisponibles', () => {
	it('rend les profils par défaut et ceux de profils/, triés, chacun décrit par la première ligne de sa consigne', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('profils/redaction/redaction.md', '---\ntype: profil\n---\n# Profil rédaction\n\nRédige les courriers.\nSuite de la consigne.\n');
		dep.fichiers.set('profils/calculs/calculs.md', '---\ntype: profil\nmoteur: codex\nmodele: gpt-6.2-sol\n---\n# Profil calculs\n\nFait les calculs.\n');
		const r = await profilsDisponibles(dep);
		expect(r.profils).toEqual([
			{ nom: PROFIL_ARCHIVISTE, description: CONSIGNE_ARCHIVISTE_PAR_DEFAUT.split('\n')[0], lancement: 'memoire', lanceur: 'propre', avatar: { forme: 'chouette', couleur: 'violet' }, personnalise: false, moteur: 'claude-code', modele: '', equipement: { skills: 0, plugins: 0, hooks: ['debut', 'arret', 'fin'] } },
			{ nom: 'calculs', description: 'Fait les calculs.', lancement: 'projet', lanceur: 'dialogue', avatar: { forme: 'robot', couleur: 'vert' }, personnalise: true, moteur: 'codex', modele: 'gpt-6.2-sol', equipement: { skills: 0, plugins: 0, hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'] } },
			// profil de l'utilisateur sans avatar déclaré : celui de `travail` ; sa consigne n'est pas celle par défaut ; ni moteur ni modèle : Claude Code et celui par défaut
			{ nom: 'redaction', description: 'Rédige les courriers.', lancement: 'projet', lanceur: 'dialogue', avatar: { forme: 'robot', couleur: 'vert' }, personnalise: true, moteur: 'claude-code', modele: '', equipement: { skills: 0, plugins: 0, hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'] } },
			{ nom: PROFIL_TRAVAIL, description: CONSIGNE_TRAVAIL_PAR_DEFAUT.split('\n')[0], lancement: 'projet', lanceur: 'dialogue', avatar: { forme: 'robot', couleur: 'vert' }, personnalise: false, moteur: 'claude-code', modele: '', equipement: { skills: 0, plugins: 0, hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'] } },
		]);
		expect(r.ignores).toEqual([]);
		expect(r.avertissements).toEqual([]);
	});

	it('un profil de l’utilisateur qui se dit « propre » sans chemin de lancement connu : lu « dialogue », avec un avertissement', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('profils/redaction/redaction.md', '---\ntype: profil\nlanceur: propre\n---\n# Rédaction\n\nRédige.\n');
		const r = await profilsDisponibles(dep);
		expect(r.profils.find((p) => p.nom === 'redaction')!.lanceur).toBe('dialogue');
		expect(r.profils.find((p) => p.nom === PROFIL_ARCHIVISTE)!.lanceur).toBe('propre');
		expect(r.avertissements).toEqual([{ nom: 'redaction', motif: expect.stringContaining('propre') }]);
	});

	it('moteur ou modèle invalides dans une fiche écrite à la main : lus comme le défaut, avec un avertissement chacun', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('profils/redaction/redaction.md', '---\ntype: profil\nmoteur: Codex\nmodele: 4.5\n---\n# Rédaction\n\nRédige.\n');
		const r = await profilsDisponibles(dep);
		expect(r.profils.find((p) => p.nom === 'redaction')).toMatchObject({ moteur: 'claude-code', modele: '' });
		expect(r.avertissements).toEqual([
			{ nom: 'redaction', motif: expect.stringContaining('moteur « Codex » inconnu') },
			{ nom: 'redaction', motif: expect.stringContaining('modèle « 4.5 » refusé') },
		]);
	});

	it('équipement : skills reçues (du profil, puis celles de la mémoire qu\'il retient), plugins allumés avec Claude Code seulement, événements de hook', async () => {
		const dep = fauxPorts();
		const skill = (nom: string) => `---\nname: ${nom}\ndescription: ${nom}.\n---\n\nCorps.\n`;
		dep.fichiers.set('skills/devis/SKILL.md', skill('devis'));
		dep.fichiers.set('skills/relecture/SKILL.md', skill('relecture'));
		dep.fichiers.set('skills/archives/SKILL.md', skill('archives'));
		dep.fichiers.set('profils/redaction/redaction.md', '---\ntype: profil\nskills_memoire: [relecture, devis]\nplugins: [superpowers@marketplace, pdf@marketplace]\nhooks: [debut, message, fin]\n---\n# Rédaction\n\nRédige.\n');
		// une skill du profil de même nom qu'une de la mémoire la remplace : comptée une fois
		dep.fichiers.set('profils/redaction/skills/relecture/SKILL.md', skill('relecture'));
		dep.fichiers.set('profils/redaction/skills/signature/SKILL.md', skill('signature'));
		dep.fichiers.set('profils/calculs/calculs.md', '---\ntype: profil\nmoteur: codex\nplugins: [superpowers@marketplace]\n---\n# Calculs\n\nCalcule.\n');
		const { profils } = await profilsDisponibles(dep);
		const de = (nom: string) => profils.find((p) => p.nom === nom)!.equipement;
		expect(de('redaction')).toEqual({ skills: 3, plugins: 2, hooks: ['debut', 'message', 'fin'] });
		// toutes les skills de la mémoire ; des plugins avec Codex ne s'allument pas
		expect(de('calculs')).toEqual({ skills: 3, plugins: 0, hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'] });
		expect(de(PROFIL_TRAVAIL).skills).toBe(3);
		// l'archiviste ne retient aucune skill de la mémoire, et ses skills par défaut ne sont déposées qu'à son lancement
		expect(de(PROFIL_ARCHIVISTE)).toEqual({ skills: 0, plugins: 0, hooks: ['debut', 'arret', 'fin'] });
	});

	it('un dossier de profils/ au nom invalide est rendu dans ignores avec son motif, jamais lancé comme travail en silence', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('profils/Mon Profil/Mon Profil.md', '---\ntype: profil\n---\n# x\n\ny\n');
		const r = await profilsDisponibles(dep);
		expect(r.profils.map((p) => p.nom)).toEqual([PROFIL_ARCHIVISTE, PROFIL_TRAVAIL]);
		expect(r.ignores).toEqual([{ nom: 'Mon Profil', motif: expect.stringContaining('minuscules') }]);
	});
});
