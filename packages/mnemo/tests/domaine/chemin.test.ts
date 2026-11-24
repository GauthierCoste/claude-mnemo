import { describe, expect, it } from 'vitest';
import { cheminValide, cleDeCasse, dossiersAscendants, estInstructionClaude, ficheDeDossier, nomDeFichier, nomDeLaFiche } from '../../src/domaine/chemin.ts';

describe('nomDeFichier', () => {
	it('remplace les caractères interdits par un séparateur', () => {
		expect(nomDeFichier('Module : stocks ?')).toBe('Module - stocks');
	});
	it('garde les accents et la casse', () => {
		expect(nomDeFichier('Réunion été')).toBe('Réunion été');
	});
	it('suffixe les noms réservés Windows', () => {
		expect(nomDeFichier('CON')).toBe('CON_');
		expect(nomDeFichier('com1')).toBe('com1_');
		expect(nomDeFichier('Lpt9')).toBe('Lpt9_');
		expect(nomDeFichier('Console')).toBe('Console');
	});
	it('ne rend jamais un nom vide', () => {
		expect(nomDeFichier('???')).toBe('sans-titre');
		expect(nomDeFichier('  . ')).toBe('sans-titre');
	});
	it('ôte les points, espaces et tirets aux extrémités et les caractères de contrôle', () => {
		expect(nomDeFichier('..a\tb\u0001c- ')).toBe('a - b - c');
	});
	it('tronque à 120 caractères sans finir par un séparateur', () => {
		expect(nomDeFichier('a'.repeat(300))).toHaveLength(120);
		const long = `${'a'.repeat(119)} ${'b'.repeat(10)}`;
		const nom = nomDeFichier(long);
		expect(nom.length).toBeLessThanOrEqual(120);
		expect(nom).toBe('a'.repeat(119));
	});
});

describe('nomDeFichier : syntaxe des liens et limites', () => {
	it('ôte la syntaxe de lien Obsidian (# ^ [ ] |)', () => {
		expect(nomDeFichier('## Toujours tester')).toBe('Toujours tester');
		expect(nomDeFichier('Note [v2] ^a | b #c')).not.toMatch(/[#^[\]|]/u);
	});
	it('suffixe un nom réservé suivi d\'espaces avant le point', () => {
		const nom = nomDeFichier('CON .x');
		expect(cheminValide(`${nom}.md`), nom).not.toBeNull();
	});
	it('tronque par point de code, sans couper un caractère hors BMP', () => {
		const nom = nomDeFichier('😀'.repeat(130));
		expect(Array.from(nom)).toHaveLength(120);
		expect(nom.isWellFormed()).toBe(true);
		const reserve = nomDeFichier(`CON.${'😀'.repeat(130)}`);
		expect(reserve.isWellFormed()).toBe(true);
		expect(Array.from(reserve).length).toBeLessThanOrEqual(120);
	});
});

describe('cheminValide', () => {
	it('normalise les antislashs', () => {
		expect(cheminValide('projets\\a\\b.md')).toBe('projets/a/b.md');
	});
	it('refuse les chemins dangereux', () => {
		for (const mauvais of ['../a.md', 'a/../b.md', './a.md', '/a.md', 'C:/a.md', 'C:a.md', 'a/b?.md', 'a<b.md', 'a"b.md', 'a|b.md', 'a*b.md', 'a./b.md', 'a /b.md', 'a/b.', '', 'a//b.md', 'a/b/', 'a/\u0001.md']) {
			expect(cheminValide(mauvais), mauvais).toBeNull();
		}
	});
	it('refuse un segment réservé Windows', () => {
		expect(cheminValide('a/CON')).toBeNull();
		expect(cheminValide('a/nul.md')).toBeNull();
		expect(cheminValide('aux/b.md')).toBeNull();
		expect(cheminValide('a/console.md')).toBe('a/console.md');
	});
});

describe('ficheDeDossier', () => {
	it('donne la fiche portant le nom du dossier', () => {
		expect(ficheDeDossier('projets/x/vente')).toBe('projets/x/vente/vente.md');
		expect(ficheDeDossier('projets')).toBe('projets/projets.md');
	});
});

describe('dossiersAscendants', () => {
	it("exclut le dossier propre d'une fiche de dossier", () => {
		expect(dossiersAscendants('projets/p/transport/vente/catalogue/catalogue.md')).toEqual(['projets', 'projets/p', 'projets/p/transport', 'projets/p/transport/vente']);
	});
	it("inclut le dossier d'une fiche ordinaire", () => {
		expect(dossiersAscendants('projets/p/vente/offre.md')).toEqual(['projets', 'projets/p', 'projets/p/vente']);
	});
	it('rend une liste vide à la racine', () => {
		expect(dossiersAscendants('index.md')).toEqual([]);
		expect(dossiersAscendants('projets/projets.md')).toEqual([]);
	});
});

describe('cleDeCasse', () => {
	it('ignore la casse', () => {
		expect(cleDeCasse('Projets/A.md')).toBe(cleDeCasse('projets/a.md'));
	});
	it('ignore la forme de normalisation Unicode', () => {
		expect(cleDeCasse('Réunion.md')).toBe(cleDeCasse('Re\u0301union.md'));
	});
});

describe('nomDeLaFiche', () => {
	it('dernier segment sans .md', () => {
		expect(nomDeLaFiche('projets/vela/mon fichier.md')).toBe('mon fichier');
		expect(nomDeLaFiche('racine.md')).toBe('racine');
	});
});

describe('instructions de Claude Code (CLAUDE.md, .claude/*.md)', () => {
	it('dans un dossier listé (caché ou non), seuls les segments sous lui sont jugés', () => {
		for (const chemin of ['Documents/.notes/CLAUDE.md', 'Documents/.notes/.claude/CLAUDE.md', 'Documents/.notes/.claude/rules/a.md']) {
			expect(estInstructionClaude(chemin, 'Documents/.notes'), chemin).toBe(true);
		}
		expect(estInstructionClaude('Documents/.notes/.ssh/x.md', 'Documents/.notes')).toBe(false);
		expect(estInstructionClaude('Documents/.notes/.git/CLAUDE.md', 'Documents/.notes')).toBe(false);
		expect(estInstructionClaude('Documents/.notes/CLAUDE.md')).toBe(false);
	});

	it('reconnues : CLAUDE.md et CLAUDE.local.md en toute casse, .md sous .claude/', () => {
		for (const chemin of ['.claude/CLAUDE.md', '.claude/claude.md', 'Projets/P/.claude/Claude.MD', '.claude/rules/x.md', 'Projets/P/.claude/commands/revue.md', '.claude/agents/a.md', 'Projets/P/CLAUDE.md', 'Projets/P/CLAUDE.local.md', 'Projets/P/packages/api/claude.LOCAL.md']) {
			expect(estInstructionClaude(chemin), chemin).toBe(true);
		}
	});

	it('non reconnues : autre fichier caché, autre type sous .claude/, .md sous un autre dossier caché, .git', () => {
		for (const chemin of ['.env', '.claude/settings.json', '.claude/settings.local.json', '.claude/.credentials.json', '.claude/.cache.md', '.claude/.cache/x.md', '.github/notes.md', 'Projets/P/.github/CLAUDE.md', '.ssh/CLAUDE.md', '.env.d/claude.md', 'P/.claude/.git/CLAUDE.md', '.git/CLAUDE.md', 'docs/.cache/x.md']) {
			expect(estInstructionClaude(chemin), chemin).toBe(false);
		}
	});
});
