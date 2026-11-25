import { describe, expect, it } from 'vitest';
import { modelesDuCatalogue } from '../../src/domaine/moteurs/codex/modeles.ts';
import { TOUCHES_CODEX } from '../../src/domaine/moteurs/codex/touches.ts';
import { chaineToml, listeToml } from '../../src/domaine/moteurs/codex/toml.ts';
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
