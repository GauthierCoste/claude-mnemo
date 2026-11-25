import { describe, expect, it } from 'vitest';
import { approbationDesHooks, etatsDansConfig } from '../../src/domaine/moteurs/codex/approbation-hooks.ts';
import { entreesToml } from '../../src/domaine/moteurs/toml-lecture.ts';

const CHEMIN = '/maison/a/.codex/hooks.json';
const CLES = ['stop:0:0', 'session_end:1:0'];
const approuve = (cle: string, chemin = CHEMIN) => `[hooks.state."${chemin}:${cle}"]\ntrusted_hash = "sha256:abc"\n`;

describe('clés TOML', () => {
	const cle = (texte: string) => entreesToml(`${texte} = 1\n`)?.[0]?.cle ?? null;
	it('segments nus, entre guillemets (échappements) ou apostrophes, points dans les chaînes', () => {
		expect(cle('hooks.state."/a/hooks.json:stop:0:0"')).toEqual(['hooks', 'state', '/a/hooks.json:stop:0:0']);
		expect(cle(` hooks . 'state' . "C:\\\\u\\\\.codex\\\\hooks.json:stop:0:0" `)).toEqual(['hooks', 'state', 'C:\\u\\.codex\\hooks.json:stop:0:0']);
		expect(cle('"a\\u00e9"')).toEqual(['aé']);
		expect(cle('a..b')).toBeNull();
		expect(cle('"ouvert')).toBeNull();
	});
});

describe('approbation des hooks de Mnemo dans config.toml', () => {
	it('toutes approuvées : approuvés, en disant que l’empreinte n’est pas recalculée', () => {
		const r = approbationDesHooks(`model = "x"\n${approuve(CLES[0]!)}${approuve(CLES[1]!)}`, [CHEMIN], CLES);
		expect(r.etat).toBe('approuves');
		expect(r.motif).toMatch(/recalculer/u);
	});

	it('une seule approuvée, ou aucune : à approuver dans Codex (/hooks)', () => {
		expect(approbationDesHooks(approuve(CLES[0]!), [CHEMIN], CLES)).toEqual({ etat: 'a_approuver', motif: expect.stringMatching(/^1 hook\(s\) de Mnemo sur 2 .*\/hooks/u) });
		expect(approbationDesHooks('', [CHEMIN], CLES).etat).toBe('a_approuver');
		// approbation d'un autre fichier hooks.json : ne compte pas
		expect(approbationDesHooks(approuve(CLES[0]!, '/autre/hooks.json') + approuve(CLES[1]!, '/autre/hooks.json'), [CHEMIN], CLES).etat).toBe('a_approuver');
	});

	it('clé sous le chemin réel du fichier : reconnue', () => {
		const reel = '/Volumes/d/.codex/hooks.json';
		expect(approbationDesHooks(approuve(CLES[0]!, reel) + approuve(CLES[1]!, reel), [CHEMIN, reel], CLES).etat).toBe('approuves');
	});

	it('trusted_hash en chaîne littérale : approuvé', () => {
		const texte = CLES.map((c) => `[hooks.state.'${CHEMIN}:${c}']\ntrusted_hash = 'sha256:abc'\n`).join('');
		expect(approbationDesHooks(texte, [CHEMIN], CLES).etat).toBe('approuves');
	});

	it('chaînes sur plusieurs lignes : leurs lignes ne sont ni des en-têtes ni des clés', () => {
		const leurre = (q: string) => `consigne = ${q}\n[hooks.state."${CHEMIN}:${CLES[0]!}"]\nenabled = false\n${q}\n`;
		for (const q of ['"""', "'''"]) {
			expect(approbationDesHooks(leurre(q) + approuve(CLES[0]!) + approuve(CLES[1]!), [CHEMIN], CLES).etat, q).toBe('approuves');
			// le leurre seul n'approuve rien
			expect(approbationDesHooks(`consigne = ${q}\n${approuve(CLES[0]!)}${approuve(CLES[1]!)}${q}\n`, [CHEMIN], CLES).etat, q).toBe('a_approuver');
		}
		// ouverte et fermée sur la même ligne
		expect(approbationDesHooks(`a = """x"""\n${approuve(CLES[0]!)}${approuve(CLES[1]!)}`, [CHEMIN], CLES).etat).toBe('approuves');
	});

	it('hook désactivé dans Codex : à réactiver', () => {
		const texte = `${approuve(CLES[0]!)}enabled = false\n${approuve(CLES[1]!)}`;
		expect(approbationDesHooks(texte, [CHEMIN], CLES)).toEqual({ etat: 'a_approuver', motif: expect.stringContaining('désactivés') });
	});

	it('clé pointée sur une ligne, sous [hooks] : lue', () => {
		const texte = `[hooks]\nstate."${CHEMIN}:${CLES[0]!}".trusted_hash = "sha256:x"\nstate."${CHEMIN}:${CLES[1]!}".trusted_hash = "sha256:y"\n`;
		expect(approbationDesHooks(texte, [CHEMIN], CLES).etat).toBe('approuves');
	});

	it('config.toml illisible ou TOML non suivi : état inconnu ; hooks.state en table en ligne : lu', () => {
		expect(approbationDesHooks(null, [CHEMIN], CLES).etat).toBe('inconnu');
		expect(approbationDesHooks('[hooks.state."ouvert]\n', [CHEMIN], CLES).etat).toBe('inconnu');
		expect(etatsDansConfig('[hooks.state."ouvert]\n').illisible).toBe(true);
		const enLigne = `[hooks]\nstate = { ${CLES.map((c, i) => `"${CHEMIN}:${c}" = { trusted_hash = "sha256:${i}" }`).join(', ')} }\n`;
		expect(approbationDesHooks(enLigne, [CHEMIN], CLES).etat).toBe('approuves');
	});
});
