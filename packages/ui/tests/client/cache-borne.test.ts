import { describe, expect, it } from 'vitest';
import { CacheBorne, TAILLE_CACHE_RESSOURCES } from '../../src/client/cache-borne.ts';

describe('CacheBorne', () => {
	it('la 201e clé évince la plus ancienne', () => {
		expect(TAILLE_CACHE_RESSOURCES).toBe(200);
		const cache = new CacheBorne(TAILLE_CACHE_RESSOURCES);
		for (let i = 1; i <= 200; i++) cache.set(`recherche:${i}`, i);
		expect(cache.taille).toBe(200);
		cache.set('recherche:201', 201);
		expect(cache.taille).toBe(200);
		expect(cache.get('recherche:1')).toBeUndefined();
		expect(cache.get('recherche:2')).toBe(2);
		expect(cache.get('recherche:201')).toBe(201);
	});

	it('une clé lue redevient la plus récente : la suivante évince la moins récemment lue', () => {
		const cache = new CacheBorne(3);
		cache.set('a', 1);
		cache.set('b', 2);
		cache.set('c', 3);
		expect(cache.get('a')).toBe(1);
		cache.set('d', 4);
		expect(cache.get('b')).toBeUndefined();
		expect(cache.get('a')).toBe(1);
	});

	it('réécrire une clé ne l’ajoute pas deux fois et la rend la plus récente', () => {
		const cache = new CacheBorne(2);
		cache.set('a', 1);
		cache.set('b', 2);
		cache.set('a', 3);
		cache.set('c', 4);
		expect(cache.taille).toBe(2);
		expect(cache.get('b')).toBeUndefined();
		expect(cache.get('a')).toBe(3);
		expect(cache.get('c')).toBe(4);
	});
});
