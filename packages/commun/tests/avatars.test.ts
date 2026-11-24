import { describe, expect, it } from 'vitest';
import { COULEURS_AVATAR, FORMES_AVATAR, lireAvatar } from '../src/index.ts';

describe('avatars : formes et couleurs partagées', () => {
	it('12 formes distinctes, les six de la maquette en tête', () => {
		expect(FORMES_AVATAR).toHaveLength(12);
		expect(new Set(FORMES_AVATAR).size).toBe(12);
		expect(FORMES_AVATAR.slice(0, 6)).toEqual(['robot', 'chouette', 'renard', 'fantome', 'chat', 'goutte']);
		for (const forme of FORMES_AVATAR) expect(forme, forme).toMatch(/^[a-z]+$/);
	});

	it('5 couleurs de thème', () => {
		expect(COULEURS_AVATAR).toEqual(['vert', 'violet', 'bleu', 'ambre', 'rouge']);
	});

	it('lireAvatar rend l\'objet quand les deux clés sont valides', () => {
		expect(lireAvatar({ forme: 'chouette', couleur: 'violet' })).toEqual({ forme: 'chouette', couleur: 'violet' });
	});

	it('lireAvatar rend null sinon', () => {
		for (const valeur of [{ forme: 'licorne', couleur: 'vert' }, { forme: 'robot', couleur: 'rose' }, { forme: 'robot' }, 'robot', null, undefined, 3, []]) expect(lireAvatar(valeur)).toBeNull();
	});
});
