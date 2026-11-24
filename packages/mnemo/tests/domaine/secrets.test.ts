import { describe, expect, it } from 'vitest';
import { masquerSecrets } from '../../src/domaine/secrets.ts';
import { borne, croissance } from '../aides/charge.ts';

const M = '[secret masqué]';

describe('masquerSecrets', () => {
	it('masque une clé privée PEM entière', () => {
		const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\ndef==\n-----END RSA PRIVATE KEY-----';
		expect(masquerSecrets(`avant\n${pem}\naprès`)).toEqual({ texte: `avant\n${M}\naprès`, masques: 1 });
	});

	it.each([
		['sk-abcdefghijklmnopqrstuvwxyz0123'],
		['ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
		['xoxb-123456789012-abcdefghij'],
		['xoxp-123456789012-abcdefghij'],
		['AKIAIOSFODNN7EXAMPLE'],
		['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'],
	])('masque le jeton %s', (jeton) => {
		expect(masquerSecrets(`clé ${jeton} fin`)).toEqual({ texte: `clé ${M} fin`, masques: 1 });
	});

	it('masque les clés Google (AIza…), Stripe (sk_live_, rk_test_) et les jetons Bearer', () => {
		const google = `AIza${'B'.repeat(35)}`;
		const stripe = `sk_live_${'a1'.repeat(12)}`;
		const restreinte = `rk_test_${'Z9'.repeat(10)}`;
		const bearer = `Authorization: Bearer ${'x'.repeat(30)}.abc`;
		for (const t of [google, stripe, restreinte, bearer]) {
			const r = masquerSecrets(`avant ${t} après`);
			expect(r.masques, t).toBe(1);
			expect(r.texte, t).toContain('[secret masqué]');
		}
		expect(masquerSecrets('Bearer court').masques).toBe(0);
	});

	it('masque la valeur après un mot-clé, en gardant le mot-clé', () => {
		expect(masquerSecrets('password: hunter2x').texte).toBe(`password: ${M}`);
		expect(masquerSecrets('API_KEY=abc123def456').texte).toBe(`API_KEY=${M}`);
		expect(masquerSecrets('"token": "abcdef123456"').texte).toBe(`"token": ${M}`);
		expect(masquerSecrets('Mot de passe : Zx9!kLm2').texte).toBe(`Mot de passe : ${M}`);
		expect(masquerSecrets('secret = s3cr3tvalue\nsuite').texte).toBe(`secret = ${M}\nsuite`);
	});

	it('masque les variables d’environnement avec préfixe ou suffixe', () => {
		for (const [e, attendu] of [
			['DB_PASSWORD=Sup3rS3cret', `DB_PASSWORD=${M}`],
			['GITHUB_TOKEN=abcdef123456', `GITHUB_TOKEN=${M}`],
			['SECRET_KEY=django-insecure-abc123', `SECRET_KEY=${M}`],
			['client_secret: abcdef123456', `client_secret: ${M}`],
			['aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRf', `aws_secret_access_key = ${M}`],
			['export PASSWORD=Sup3rS3cret', `export PASSWORD=${M}`],
		] as const) expect(masquerSecrets(e)).toEqual({ texte: attendu, masques: 1 });
	});

	it('masque après une espace insécable ou fine insécable (deux-points français)', () => {
		expect(masquerSecrets('Mot de passe\u00a0: Zx9!kLm2').texte).toBe(`Mot de passe\u00a0: ${M}`);
		expect(masquerSecrets('Mot de passe\u202f: Zx9!kLm2').texte).toBe(`Mot de passe\u202f: ${M}`);
		expect(masquerSecrets('Mot de passe : Zx9!kLm2').masques).toBe(1);
	});

	it('masque une valeur longue jusqu’à la fin de la ligne', () => {
		expect(masquerSecrets(`token=${'A'.repeat(300)}\nsuite`)).toEqual({ texte: `token=${M}\nsuite`, masques: 1 });
	});

	it('masque une clé PEM tronquée jusqu’à la ligne vide, ou la fin', () => {
		expect(masquerSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n\nsuite').texte).toBe(`${M}\n\nsuite`);
		expect(masquerSecrets('x\n-----BEGIN PRIVATE KEY-----\nMIIE').texte).toBe(`x\n${M}`);
		expect(masquerSecrets('-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQ\n-----END PGP PRIVATE KEY BLOCK-----').texte).toBe(M);
	});

	it('masque github_pat_ et la valeur d’une cellule de tableau', () => {
		expect(masquerSecrets('github_pat_11ABCDEFG0123456789_abcdefghij').texte).toBe(M);
		expect(masquerSecrets('| password | hunter22x |').texte).toBe(`| password | ${M} |`);
		expect(masquerSecrets('| mot de passe | à définir |').masques).toBe(0);
	});

	it('compte les masques', () => {
		expect(masquerSecrets('password: abc12345\nAKIAIOSFODNN7EXAMPLE\nrien').masques).toBe(2);
		expect(masquerSecrets('rien à masquer')).toEqual({ texte: 'rien à masquer', masques: 0 });
	});

	it('évite les faux positifs', () => {
		for (const t of [
			'mot de passe oublié',
			'Le token est expiré, il faut le renouveler',
			'le secret : à définir',
			'mot de passe : à définir',
			'token: court',
			'ask-me-anything',
		]) {
			expect(masquerSecrets(t)).toEqual({ texte: t, masques: 0 });
		}
	});

	it('un mot seul (sans espace) est un secret, une phrase de lettres non', () => {
		expect(masquerSecrets('password: motdepasse').masques).toBe(1);
		expect(masquerSecrets('password: un mot de passe long').masques).toBe(0);
		expect(masquerSecrets('password: un mot2 de passe').masques).toBe(1);
	});

	it('fusionne les recouvrements en un seul masque', () => {
		expect(masquerSecrets('token: sk-abcdefghijklmnopqrstuvwxyz0123')).toEqual({ texte: `token: ${M}`, masques: 1 });
	});

	it('reste linéaire sur des entrées pathologiques (temps de 2n / temps de n < 3, médiane de 3 ; 2n ≈ 1 Mo)', () => {
		const motifs: [string, number][] = [
			['-----BEGIN PRIVATE KEY-----\n', 20_000],
			['password ', 60_000],
			['sk-', 175_000],
			['xoxb-', 100_000],
			['eyJ-', 125_000],
			['eyJa.', 100_000],
			['eyJ x.y ', 60_000],
			['-----BEGIN PRIVATE KEY-----\n\n', 17_500],
			['ghp_', 125_000],
			['AKIA', 125_000],
			['token:\n', 75_000],
			['| password ', 45_000],
			['github_pat_', 45_000],
		];
		const cas: [string, (n: number) => string, number][] = [
			...motifs.map(([m, n]): [string, (k: number) => string, number] => [m, (k) => m.repeat(k), n]),
			['eyJ + a…', (n) => 'eyJ' + 'a'.repeat(n), 500_000],
			['token: + espaces', (n) => 'token:' + ' '.repeat(n), 500_000],
		];
		for (const [nom, entree, n] of cas) {
			const { rapport, ms2n } = croissance(entree, masquerSecrets, n);
			expect(rapport, nom).toBeLessThan(3);
			expect(ms2n, nom).toBeLessThan(borne(1000));
		}
	}, 60_000);

	it('une valeur déjà masquée n\'est ni remasquée ni recomptée', () => {
		expect(masquerSecrets('token: [secret masqué]')).toEqual({ texte: 'token: [secret masqué]', masques: 0 });
		const une = masquerSecrets('password = hunter2secret');
		expect(masquerSecrets(une.texte)).toEqual({ texte: une.texte, masques: 0 });
	});
});
