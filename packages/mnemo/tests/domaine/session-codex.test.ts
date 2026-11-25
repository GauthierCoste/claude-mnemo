import { describe, expect, it } from 'vitest';
import { modelesDuCatalogue } from '../../src/domaine/moteurs/codex/modeles.ts';
import { TOUCHES_CODEX } from '../../src/domaine/moteurs/codex/touches.ts';
import { chaineToml, listeToml, listeValeursToml, valeurToml } from '../../src/domaine/moteurs/toml.ts';
import { refusDeVersionCodex } from '../../src/domaine/moteurs/codex/version.ts';
import { versionDans } from '../../src/domaine/moteurs/version.ts';
import { effetDuHook, hooksDuTexte, texteDesHooks } from '../../src/domaine/moteurs/hooks-du-profil.ts';

describe('chaînes TOML des -c de Codex', () => {
	it('guillemets, barres obliques inverses, retours à la ligne, tabulations : échappés', () => {
		expect(chaineToml('simple')).toBe('"simple"');
		expect(chaineToml('dit "oui"')).toBe('"dit \\"oui\\""');
		expect(chaineToml('D:\\outils\\a')).toBe('"D:\\\\outils\\\\a"');
		expect(chaineToml('l1\nl2\r\nl3\tfin')).toBe('"l1\\nl2\\r\\nl3\\tfin"');
		expect(chaineToml('\\"')).toBe('"\\\\\\""');
	});

	it('autres caractères de contrôle et DEL en \\uXXXX ; accents, apostrophes et emoji tels quels ; substitution isolée remplacée', () => {
		expect(chaineToml('a\u0000b\u001bc\u007fd\b\f')).toBe('"a\\u0000b\\u001Bc\\u007Fd\\b\\f"');
		expect(chaineToml('l’été « ok » 🙂 \'x\'')).toBe('"l’été « ok » 🙂 \'x\'"');
		expect(chaineToml('a\uD800b')).toBe('"a\uFFFDb"');
	});

	it('listes de chaînes', () => {
		expect(listeToml([])).toBe('[]');
		expect(listeToml(['/opt/a b/main.ts', 'mcp'])).toBe('["/opt/a b/main.ts", "mcp"]');
	});
});

describe('modèles du catalogue de Codex (codex debug models)', () => {
	it('visibilité list seulement, par priorité, sans doublon ni identifiant refusé', () => {
		const catalogue = {
			models: [
				{ slug: 'gpt-c', visibility: 'list', priority: 3 },
				{ slug: 'gpt-a', visibility: 'list', priority: 1 },
				{ slug: 'cache', visibility: 'hide', priority: 0 },
				{ slug: 'gpt-b', visibility: 'list' },
				{ slug: 'gpt-a', visibility: 'list', priority: 9 },
				{ slug: 'avec espace', visibility: 'list', priority: 2 },
				'pas un objet',
				{ visibility: 'list', priority: 2 },
			],
		};
		expect(modelesDuCatalogue(JSON.stringify(catalogue))).toEqual(['gpt-a', 'gpt-c', 'gpt-b']);
	});

	it('sortie illisible ou sans liste : aucun modèle (le modèle par défaut)', () => {
		expect(modelesDuCatalogue('')).toEqual([]);
		expect(modelesDuCatalogue('Error: not logged in')).toEqual([]);
		expect(modelesDuCatalogue('{"models": 3}')).toEqual([]);
	});
});

describe('hooks demandés par le profil (MNEMO_HOOKS)', () => {
	it('demandé : actif ; hook d’état non demandé qui sert un contexte : sans contexte ; ni l’un ni l’autre : absent', () => {
		expect(effetDuHook('outil', ['outil'])).toBe('actif');
		expect(effetDuHook('debut', ['arret'])).toBe('sans_contexte');
		expect(effetDuHook('message', [])).toBe('sans_contexte');
		expect(effetDuHook('arret', [])).toBe('actif');
		expect(effetDuHook('fin', [])).toBe('actif');
		expect(effetDuHook('outil', ['debut'])).toBe('absent');
		expect(effetDuHook('apres_outil', [])).toBe('absent');
	});

	it('texte de la variable, relu ; absente ou illisible : null', () => {
		expect(hooksDuTexte(texteDesHooks(['debut', 'arret', 'fin']))).toEqual(['debut', 'arret', 'fin']);
		expect(hooksDuTexte('')).toEqual([]);
		expect(hooksDuTexte(undefined)).toBeNull();
		expect(hooksDuTexte('debut,inconnu')).toBeNull();
	});
});

describe('touches de Codex', () => {
	it('arrêt : Ctrl-U, /quit, Entrée ; Échap pour un dialogue', () => {
		expect(TOUCHES_CODEX).toMatchObject({ echap: '\x1b', arret: '\x15/quit', entree: '\r' });
	});
});

describe('valeurs TOML sans guillemet double (PowerShell 5.1)', () => {
	it('littérale sans apostrophe ni contrôle ; littérale multiligne pour des sauts de ligne ou une apostrophe ; sinon chaîne de base', () => {
		expect(valeurToml('11111111-2222-4333-8444-555555555555')).toBe("'11111111-2222-4333-8444-555555555555'");
		expect(valeurToml('C:\\Program Files\\nodejs\\node.exe')).toBe("'C:\\Program Files\\nodejs\\node.exe'");
		expect(valeurToml('dit "oui"\tet « non »')).toBe('\'dit "oui"\tet « non »\'');
		expect(valeurToml('')).toBe("''");
		expect(valeurToml("l'agent\nrelit.\n")).toBe("'''l'agent\nrelit.\n'''");
		expect(valeurToml("l'agent")).toBe("'''l'agent'''");
		// `'''`, saut de ligne en tête, apostrophe finale, \r, autre contrôle, texte mal formé : chaîne de base
		expect(valeurToml("l'agent'")).toBe('"l\'agent\'"');
		expect(valeurToml("a\n'''b")).toBe('"a\\n\'\'\'b"');
		expect(valeurToml('\na')).toBe('"\\na"');
		expect(valeurToml("a\nb'")).toBe('"a\\nb\'"');
		expect(valeurToml('a\r\nb')).toBe('"a\\r\\nb"');
		expect(valeurToml('a\u001bb')).toBe('"a\\u001Bb"');
		expect(valeurToml('a\uD800b')).toBe('"a\uFFFDb"');
		expect(listeValeursToml(['/opt/a b/main.ts', 'mcp'])).toBe("['/opt/a b/main.ts', 'mcp']");
	});
});

describe('version de Codex', () => {
	it('lue dans la sortie de codex --version ; illisible : null', () => {
		expect(versionDans('codex-cli 0.171.0-alpha.13\n')).toBe('0.171.0-alpha.13');
		expect(versionDans('codex-cli 0.172.1')).toBe('0.172.1');
		expect(versionDans('v1.2.3')).toBe('1.2.3');
		expect(versionDans('codex-cli dev')).toBeNull();
		expect(versionDans('')).toBeNull();
	});

	it('refusée sous 0.171.0 (une préversion compte comme sa version) ; illisible ou inconnue : rien n’est refusé', () => {
		expect(refusDeVersionCodex('0.170.9')).toBe('Codex 0.170.9 trop ancien, 0.171 ou plus requis');
		expect(refusDeVersionCodex('0.99.0')).toBe('Codex 0.99.0 trop ancien, 0.171 ou plus requis');
		expect(refusDeVersionCodex('0.171.0-alpha.1')).toBeNull();
		expect(refusDeVersionCodex('0.171.0')).toBeNull();
		expect(refusDeVersionCodex('0.200.0')).toBeNull();
		expect(refusDeVersionCodex('1.0.0')).toBeNull();
		expect(refusDeVersionCodex(null)).toBeNull();
		expect(refusDeVersionCodex('dev')).toBeNull();
	});
});
