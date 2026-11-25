import { describe, expect, it } from 'vitest';
import { ficheTouchee } from '../../src/domaine/outil-de-session.ts';
import { OUTILS_CLAUDE_CODE as CC } from '../../src/domaine/moteurs/claude-code/outils.ts';
import { OUTILS_CODEX } from '../../src/domaine/moteurs/codex/outils.ts';

describe('ficheTouchee', () => {
	it('lire et voisins : la fiche lue, sans ancre ; proposer : la fiche écrite', () => {
		expect(ficheTouchee({ nom: 'mcp__mnemo__lire', entree: { id: 'projets/p/avoirs.md#^f-0001' } }, CC)).toEqual({ chemin: 'projets/p/avoirs.md', action: 'lue', outil: 'lire' });
		expect(ficheTouchee({ nom: 'mcp__mnemo__voisins', entree: { id: 'projets/p/avoirs.md' } }, CC)).toEqual({ chemin: 'projets/p/avoirs.md', action: 'lue', outil: 'voisins' });
		expect(ficheTouchee({ nom: 'mcp__mnemo__proposer', entree: { demande: { genre: 'fait', fiche: 'projets/p/avoirs.md' } } }, CC)).toEqual({ chemin: 'projets/p/avoirs.md', action: 'ecrite', outil: 'proposer' });
		expect(ficheTouchee({ nom: 'mcp__mnemo__proposer', entree: { demande: { genre: 'fiche', chemin: 'projets/p/neuve.md' } } }, CC)).toEqual({ chemin: 'projets/p/neuve.md', action: 'ecrite', outil: 'proposer' });
	});

	it('entretenir : la fiche qui reste écrite (fusion reçue, lien corrigé, redirection) ; rien pour une suppression sans redirection', () => {
		const entretenir = (entree: Record<string, unknown>) => ficheTouchee({ nom: 'mcp__mnemo__entretenir', entree }, CC);
		const ecrite = (chemin: string) => ({ chemin, action: 'ecrite', outil: 'entretenir' });
		expect(entretenir({ action: 'fusionner', id: 'notes/a.md', dans: 'notes/b.md' })).toEqual(ecrite('notes/b.md'));
		expect(entretenir({ action: 'corriger_lien', id: 'sources/doc.md', ancien: 'x' })).toEqual(ecrite('sources/doc.md'));
		expect(entretenir({ action: 'supprimer', id: 'notes/a.md', redirection: 'notes/b.md' })).toEqual(ecrite('notes/b.md'));
		expect(entretenir({ action: 'supprimer', id: 'notes/a.md' })).toBeNull();
		expect(entretenir({ action: 'corroborer', id: 'notes/a.md', ancre: 'f-0001', source: { ref: 'utilisateur', type: 'utilisateur' } })).toEqual(ecrite('notes/a.md'));
		expect(entretenir({ action: 'retoucher_information', id: 'notes/a.md', ancre: 'f-0001', texte: 'x' })).toEqual(ecrite('notes/a.md'));
	});

	it('rien pour un autre outil, un identifiant absent ou hors de la mémoire', () => {
		expect(ficheTouchee({ nom: 'Read', entree: { file_path: '/a.php' } }, CC)).toBeNull();
		expect(ficheTouchee({ nom: 'mcp__mnemo__chercher', entree: { requete: 'avoirs' } }, CC)).toBeNull();
		expect(ficheTouchee({ nom: 'mcp__mnemo__lire', entree: {} }, CC)).toBeNull();
		expect(ficheTouchee({ nom: 'mcp__mnemo__lire', entree: { id: '../x.md' } }, CC)).toBeNull();
	});
	it('Codex : mêmes noms d’outils MCP (mcp__mnemo__…) ; apply_patch n’est pas une fiche', () => {
		expect(ficheTouchee({ nom: 'mcp__mnemo__lire', entree: { id: 'projets/p/avoirs.md' } }, OUTILS_CODEX)).toEqual({ chemin: 'projets/p/avoirs.md', action: 'lue', outil: 'lire' });
		expect(ficheTouchee({ nom: 'apply_patch', entree: { command: '*** Begin Patch\n*** Add File: _mnemo/a.md\n' } }, OUTILS_CODEX)).toBeNull();
	});
});
