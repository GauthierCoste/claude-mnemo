import { describe, expect, it } from 'vitest';
import { ANCRE_MAX_PLAFOND, ecrireFiche, lireFiche, plusHauteAncre, prochaineAncre, retenirPlusHauteAncre } from '../../src/domaine/fiche.ts';

const texte = (entete: string, faits: string[]) => `---\nid: X\ntype: sujet\nupdated: 2026-11-01\n${entete}---\n# X\n\n## Informations\n${faits.join('\n')}\n`;
const UN = '- Un | declare ^f-0001';
const TROIS = '- Trois | declare ^f-0003';

describe('ancre_max : plus haut numéro d\'ancre jamais donné', () => {
	it('se relit et se réécrit à l\'identique, hors des données de l\'utilisateur ; prochaineAncre part de lui', () => {
		const brut = texte('ancre_max: 7\n', [UN, TROIS]);
		const fiche = lireFiche('x.md', brut);
		expect(fiche.ancreMax).toBe(7);
		expect(fiche.donnees).toEqual({});
		expect(ecrireFiche(fiche)).toBe(brut);
		expect(plusHauteAncre(fiche)).toBe(7);
		expect(prochaineAncre(fiche)).toBe('f-0008');
	});

	it('plus bas que les ancres présentes : sans effet ; mal formé : gardé tel quel dans les données, ignoré', () => {
		expect(prochaineAncre(lireFiche('x.md', texte('ancre_max: 2\n', [UN, TROIS])))).toBe('f-0004');
		const mal = lireFiche('x.md', texte('ancre_max: beaucoup\n', [UN, TROIS]));
		expect(mal.ancreMax).toBeUndefined();
		expect(mal.donnees).toEqual({ ancre_max: 'beaucoup' });
		expect(ecrireFiche(mal)).toContain('ancre_max: beaucoup');
		expect(prochaineAncre(mal)).toBe('f-0004');
	});

	it(`au-delà de ${ANCRE_MAX_PLAFOND} (l'ancre suivante ne tiendrait plus sur 9 chiffres) : mal formé, gardé tel quel dans les données`, () => {
		const limite = lireFiche('x.md', texte(`ancre_max: ${ANCRE_MAX_PLAFOND}\n`, [UN, TROIS]));
		expect(limite.ancreMax).toBe(ANCRE_MAX_PLAFOND);
		expect(prochaineAncre(limite)).toBe('f-999999999');
		const trop = lireFiche('x.md', texte(`ancre_max: ${ANCRE_MAX_PLAFOND + 1}\n`, [UN, TROIS]));
		expect(trop.ancreMax).toBeUndefined();
		expect(trop.donnees).toEqual({ ancre_max: ANCRE_MAX_PLAFOND + 1 });
		expect(ecrireFiche(trop)).toContain(`\nancre_max: ${ANCRE_MAX_PLAFOND + 1}\n`);
		expect(prochaineAncre(trop)).toBe('f-0004');
	});

	it('retenirPlusHauteAncre : retenu quand la plus haute part, retiré quand il est redondant', () => {
		const avant = lireFiche('x.md', texte('', [UN, TROIS]));
		const apres = lireFiche('x.md', texte('', [UN]));
		retenirPlusHauteAncre(avant, apres);
		expect(apres.ancreMax).toBe(3);
		expect(ecrireFiche(apres)).toContain('\nancre_max: 3\n');
		expect(prochaineAncre(apres)).toBe('f-0004');

		// la plus haute reste : rien à retenir
		const sansUn = lireFiche('x.md', texte('', [TROIS]));
		retenirPlusHauteAncre(avant, sansUn);
		expect(sansUn.ancreMax).toBeUndefined();

		// un ancre_max déjà retenu se garde quand une autre information part
		const avantRetenu = lireFiche('x.md', texte('ancre_max: 9\n', [UN, TROIS]));
		const apresRetenu = lireFiche('x.md', texte('ancre_max: 9\n', [UN]));
		retenirPlusHauteAncre(avantRetenu, apresRetenu);
		expect(apresRetenu.ancreMax).toBe(9);
	});
});
