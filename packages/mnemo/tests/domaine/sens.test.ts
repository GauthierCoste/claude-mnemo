import { describe, expect, it } from 'vitest';
import { cosinus, decoderVecteur, encoderVecteur, normaliser, plusProches, texteAVectoriser } from '../../src/domaine/sens.ts';

function aleatoire(graine: number): () => number {
	let etat = graine;
	return () => {
		etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0;
		return etat / 2 ** 32 - 0.5;
	};
}

describe('normaliser', () => {
	it('ramène la norme à 1', () => {
		const v = normaliser(new Float32Array([3, 4]));
		expect(v[0]).toBeCloseTo(0.6);
		expect(v[1]).toBeCloseTo(0.8);
	});
	it('laisse le vecteur nul inchangé', () => {
		expect([...normaliser(new Float32Array([0, 0]))]).toEqual([0, 0]);
	});
});

describe('cosinus', () => {
	it('vaut 1, 0 et -1 sur des vecteurs connus', () => {
		expect(cosinus(new Float32Array([1, 2]), new Float32Array([2, 4]))).toBeCloseTo(1);
		expect(cosinus(new Float32Array([1, 0]), new Float32Array([0, 5]))).toBeCloseTo(0);
		expect(cosinus(new Float32Array([1, 0]), new Float32Array([-3, 0]))).toBeCloseTo(-1);
	});
	it('vaut 0 si un vecteur est nul', () => {
		expect(cosinus(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
	});
	it('refuse des dimensions différentes', () => {
		expect(() => cosinus(new Float32Array(2), new Float32Array(3))).toThrow(/dimension/iu);
	});
});

describe('plusProches', () => {
	it('donne le même résultat qu’un tri naïf sur 10 000 vecteurs', () => {
		const hasard = aleatoire(42);
		const dimension = 16;
		const requete = Float32Array.from({ length: dimension }, hasard);
		const candidats = Array.from({ length: 10_000 }, (_, i) => ({ id: `c${i}`, vecteur: Float32Array.from({ length: dimension }, hasard) }));
		const attendu = candidats
			.map((c) => ({ id: c.id, similarite: cosinus(requete, c.vecteur) }))
			.sort((a, b) => b.similarite - a.similarite || a.id.localeCompare(b.id))
			.slice(0, 50);
		expect(plusProches(requete, candidats, 50)).toEqual(attendu);
	});
	it('accepte un générateur et départage par id', () => {
		function* gen() {
			yield { id: 'b', vecteur: new Float32Array([1, 0]) };
			yield { id: 'a', vecteur: new Float32Array([1, 0]) };
			yield { id: 'c', vecteur: new Float32Array([0, 1]) };
		}
		expect(plusProches(new Float32Array([1, 0]), gen(), 2).map((r) => r.id)).toEqual(['a', 'b']);
	});
	it('rend [] pour une limite nulle ou négative', () => {
		expect(plusProches(new Float32Array([1]), [{ id: 'a', vecteur: new Float32Array([1]) }], 0)).toEqual([]);
		expect(plusProches(new Float32Array([1]), [{ id: 'a', vecteur: new Float32Array([1]) }], -3)).toEqual([]);
	});
	it('refuse une dimension différente', () => {
		expect(() => plusProches(new Float32Array(2), [{ id: 'a', vecteur: new Float32Array(3) }], 1)).toThrow(/dimension/iu);
	});
});

describe('valeurs non finies', () => {
	it('cosinus vaut 0 et normaliser laisse le vecteur tel quel', () => {
		expect(cosinus(new Float32Array([NaN, 1]), new Float32Array([1, 1]))).toBe(0);
		expect(cosinus(new Float32Array([Infinity, 1]), new Float32Array([1, 1]))).toBe(0);
		const v = new Float32Array([Infinity, 1]);
		expect(normaliser(v)).toBe(v);
	});
	it('plusProches garde les candidats valides malgré un vecteur NaN', () => {
		const c = [
			{ id: 'a', vecteur: new Float32Array([NaN, 1]) },
			{ id: 'b', vecteur: new Float32Array([1, 0]) },
			{ id: 'c', vecteur: new Float32Array([0.5, 0.5]) },
		];
		expect(plusProches(new Float32Array([1, 0]), c, 2).map((r) => r.id)).toEqual(['b', 'c']);
	});
});

describe('encoderVecteur / decoderVecteur', () => {
	it('fait l’aller-retour en float32 petit-boutiste', () => {
		const v = new Float32Array([1, -2.5, 0.125]);
		const octets = encoderVecteur(v);
		expect(octets.length).toBe(12);
		expect([...octets.slice(0, 4)]).toEqual([0, 0, 0x80, 0x3f]);
		expect([...decoderVecteur(octets, 3)]).toEqual([1, -2.5, 0.125]);
	});
	it('refuse une taille qui ne correspond pas à la dimension', () => {
		expect(() => decoderVecteur(new Uint8Array(11), 3)).toThrow(/octets/u);
	});
});

describe('texteAVectoriser', () => {
	it('joint préfixe et texte, ou rend le texte seul', () => {
		expect(texteAVectoriser('Titre', 'corps')).toBe('Titre\n\ncorps');
		expect(texteAVectoriser('', 'corps')).toBe('corps');
	});
	it('borne à 2 000 points de code sans couper une paire de substitution', () => {
		const r = texteAVectoriser('', '😀'.repeat(2500));
		expect([...r].length).toBe(2000);
		expect(r.length).toBe(4000);
	});
});
