import { describe, expect, it } from 'vitest';
import { anomalieDe, avecConsigne, lireConsigne, niveauPropose, repeter } from '../../src/domaine/consigne.ts';
import type { Consigne } from '../../src/domaine/consigne.ts';
import type { Fiche } from '../../src/domaine/fiche.ts';
import { REGLES_PAR_DEFAUT } from '../../src/domaine/regles.ts';

function fiche(donnees: Record<string, unknown> = {}): Fiche {
	return { chemin: 'consignes/x.md', id: 'c-1', type: 'consigne', alias: [], updated: '2026-11-22', titre: 'Titre', synthese: '', faits: [], relations: [], donnees, autresSections: [] };
}

const consigne: Consigne = { texte: 'Toujours répondre en français.', portee: { genre: 'projet', nom: 'Mnemo' }, niveau: 'toujours', repetitions: ['2026-11-01', '2026-11-02'], regle: { type: 'commandes_interdites', motifs: ['rm -rf'] } };

describe('lireConsigne / avecConsigne', () => {
	it('aller-retour', () => {
		expect(lireConsigne(avecConsigne(fiche(), consigne))).toEqual(consigne);
	});

	it('proposition : aller-retour ; invalide ou incomplète → absente ; retirée de la fiche quand elle disparaît', () => {
		const avec: Consigne = { ...consigne, proposition: { niveau: 'verifiee', regle: { type: 'chemins_interdits', motifs: ['**/.env'] }, date: '2026-11-22', source: 'session abc' } };
		const f = avecConsigne(fiche(), avec);
		expect(lireConsigne(f)).toEqual(avec);
		expect(lireConsigne(avecConsigne(f, consigne)).proposition).toBeUndefined();
		expect('proposition' in avecConsigne(f, consigne).donnees).toBe(false);
		for (const p of [{ niveau: 'max', date: 'd', source: 's' }, { niveau: 'toujours', source: 's' }, { niveau: 'verifiee', regle: { type: 'x', motifs: ['a'] }, date: 'd', source: 's' }, 'non']) {
			expect(lireConsigne(fiche({ proposition: p })).proposition).toBeUndefined();
		}
	});

	it('écrit la portée en chaîne, garde le titre et les autres données, sans muter', () => {
		const f = fiche({ autre: 1 });
		const r = avecConsigne(f, consigne);
		expect(r.donnees).toMatchObject({ autre: 1, portee: 'projet:Mnemo', niveau: 'toujours' });
		expect(r.titre).toBe('Titre');
		expect(r.synthese).toBe(consigne.texte);
		expect(f.donnees).toEqual({ autre: 1 });
		expect(f.synthese).toBe('');
	});

	it('portée globale et sans règle : pas de clé regle', () => {
		const r = avecConsigne(fiche({ regle: { type: 'chemins_interdits', motifs: ['a'] } }), { texte: ' t ', portee: { genre: 'globale' }, niveau: 'rappelee', repetitions: [] });
		expect(r.donnees['portee']).toBe('globale');
		expect('regle' in r.donnees).toBe(false);
		expect(r.synthese).toBe('t');
	});

	it('valeurs absentes ou invalides : défauts, sans exception ; portée absente = globale', () => {
		const attendu = { texte: 'Texte', portee: { genre: 'globale' }, niveau: 'rappelee', repetitions: [] };
		const f = { ...fiche(), synthese: 'Texte' };
		expect(lireConsigne(f)).toEqual(attendu);
		expect(lireConsigne({ ...f, donnees: { portee: 'globale', niveau: 'max', repetitions: 'non', regle: { type: 'x', motifs: [] } } })).toEqual(attendu);
		expect(anomalieDe(lireConsigne(f))).toBeNull();
	});

	it('portée mal écrite : invalide (jamais servie), valeur gardée et anomalie lisible', () => {
		for (const brute of ['bizarre:x', 'projet:', 'projets:vela', 'projet', 'Globale', 'stack: ']) {
			const c = lireConsigne(fiche({ portee: brute }));
			expect(c.portee).toEqual({ genre: 'invalide', brute });
			expect(anomalieDe(c)).toContain(`« ${brute} »`);
			expect(avecConsigne(fiche(), c).donnees['portee']).toBe(brute);
		}
		expect(lireConsigne(fiche({ portee: 3 })).portee).toEqual({ genre: 'invalide', brute: '3' });
		expect(lireConsigne(fiche({ portee: null })).portee).toEqual({ genre: 'invalide', brute: '' });
	});

	it('lit les portées stack et client', () => {
		expect(lireConsigne(fiche({ portee: 'stack:Symfony' })).portee).toEqual({ genre: 'stack', nom: 'Symfony' });
		expect(lireConsigne(fiche({ portee: 'client:Acme' })).portee).toEqual({ genre: 'client', nom: 'Acme' });
	});
});

describe('repeter', () => {
	it('ajoute la date sans muter, doublons du jour permis', () => {
		const a = repeter(consigne, '2026-11-22');
		expect(a.repetitions).toEqual(['2026-11-01', '2026-11-02', '2026-11-22']);
		expect(consigne.repetitions).toHaveLength(2);
		expect(repeter(a, '2026-11-22').repetitions).toHaveLength(4);
	});
});

describe('niveauPropose', () => {
	const base: Consigne = { texte: 't', portee: { genre: 'globale' }, niveau: 'rappelee', repetitions: ['2026-11-01'] };
	it('rappelee : monte à toujours au seuil seulement', () => {
		expect(niveauPropose(REGLES_PAR_DEFAUT, base)).toBeNull();
		expect(niveauPropose(REGLES_PAR_DEFAUT, { ...base, repetitions: ['a', 'b'] })).toBe('toujours');
		expect(niveauPropose(REGLES_PAR_DEFAUT, { ...base, repetitions: ['a', 'b', 'c'] })).toBe('toujours');
	});
	it('toujours : verifiee seulement avec une règle', () => {
		expect(niveauPropose(REGLES_PAR_DEFAUT, { ...base, niveau: 'toujours' })).toBeNull();
		expect(niveauPropose(REGLES_PAR_DEFAUT, { ...base, niveau: 'toujours', regle: { type: 'chemins_interdits', motifs: ['.env'] } })).toBe('verifiee');
	});
	it('verifiee : null', () => {
		expect(niveauPropose(REGLES_PAR_DEFAUT, { ...base, niveau: 'verifiee', repetitions: ['a', 'b'] })).toBeNull();
	});
});
