import { describe, expect, it } from 'vitest';
import { expressionFts, motsDe, motsUtiles, similarite } from '../../src/domaine/requete.ts';

describe('motsDe', () => {
	it('met en minuscules, retire les accents et découpe sur les non-lettres', () => {
		expect(motsDe('Réunion du 12/03 — Café')).toEqual(['reunion', 'du', '12', '03', 'cafe']);
	});
	it('ignore les mots d’une lettre et les doublons', () => {
		expect(motsDe('a b stock Stock stocks')).toEqual(['stock', 'stocks']);
	});
});

describe('expressionFts', () => {
	it('ne laisse passer aucune syntaxe FTS5 venue de l’utilisateur', () => {
		const e = expressionFts('l\'inventaire "urgent" NEAR(a b) -x *: AND');
		expect(e).not.toBeNull();
		for (const expression of [e!.toutes, e!.une]) {
			expect((expression.match(/"/gu) ?? []).length % 2).toBe(0);
			// seule syntaxe ajoutée : la colonne des racines et les parenthèses qui groupent les variantes d'un mot
			const nue = expression.replaceAll('racines : "', '"').replace(/\(|\)/gu, '');
			expect(nue).not.toMatch(/[():\-^]/u);
			const morceaux = nue.split(/ (?:AND|OR) /u);
			for (const m of morceaux) expect(m).toMatch(/^"[\p{L}\p{N} ]+"\*?$/u);
		}
		expect(e!.toutes).toBe('("inventaire"* OR racines : "inventair") AND "urgent"* AND "near"* AND "and"*');
	});
	it('relie par AND ou OR', () => {
		expect(expressionFts('stock vide')).toEqual({ toutes: '"stock"* AND ("vide"* OR racines : "vid")', une: '"stock"* OR ("vide"* OR racines : "vid")' });
	});
	it('ramène les pluriels au préfixe du singulier', () => {
		expect(expressionFts('inventaires')?.toutes).toBe('("inventaire"* OR racines : "inventair")');
		// « travaux » : préfixe « travau » au texte exact, racine « traval » (Snowball : -aux → -al)
		expect(expressionFts('travaux')?.toutes).toBe('("travau"* OR racines : "traval")');
		expect(expressionFts('bus 2026')?.toutes).toBe('"bus"* AND "2026"*');
		expect(expressionFts('stock', new Map([['stock', ['Mises en stocks']]]))?.toutes).toBe('("stock"* OR "mise en stock"*)');
	});
	it('une phrase : les mots vides sont retirés, il reste les mots qui portent le sens', () => {
		const reference = '("reference"* OR racines : "referent")';
		const catalogue = '("catalogue"* OR racines : "catalogu")';
		expect(expressionFts('combien de références dans le catalogue')?.toutes).toBe(`${reference} AND ${catalogue}`);
		expect(expressionFts('Quel est le nombre de références du catalogue ?')?.toutes).toBe(`("nombre"* OR racines : "nombr") AND ${reference} AND ${catalogue}`);
	});
	it('rien que des mots vides : tous les mots sont gardés', () => {
		expect(expressionFts('le la')?.toutes).toBe('"le" AND "la"');
	});
	it('un mot de deux caractères est un terme exact, sans préfixe', () => {
		expect(expressionFts('PV de RH')).toEqual({ toutes: '"pv" AND "rh"', une: '"pv" OR "rh"' });
	});
	it('renvoie null sans mot', () => {
		expect(expressionFts('? ! -')).toBeNull();
	});
	it('cherche aussi la racine française du mot écrit, dans la colonne des racines (si elle diffère du terme exact)', () => {
		expect(expressionFts('déploiement')?.toutes).toBe('("deploiement"* OR racines : "deploi")');
		expect(expressionFts('configurer le serveur')?.toutes).toBe('("configurer"* OR racines : "configur") AND "serveur"*');
		// un identifiant de code, un sigle : leurs mots sont cherchés tels quels
		expect(expressionFts('deploy_sh')).toEqual({ toutes: '"deploy"* AND "sh"', une: '"deploy"* OR "sh"' });
		expect(expressionFts('HTTPS')?.toutes).toBe('"http"*');
	});
	it('développe les alias en expression de phrase', () => {
		const alias = new Map([['stock', ['Inventaire', 'Mise en stock']]]);
		expect(expressionFts('stock vide', alias)?.toutes).toBe('("stock"* OR "inventaire"* OR "mise en stock"*) AND ("vide"* OR racines : "vid")');
	});
});

describe('similarite', () => {
	it('mesure le recouvrement des mots', () => {
		expect(similarite('Livraison du module stocks le 15/12', 'Le module stocks sera livré le 15/12')).toBeGreaterThanOrEqual(0.25);
	});
	it('vaut 1 pour deux textes identiques et 0 sans mot commun', () => {
		const x = 'Livraison du module stocks';
		expect(similarite(x, x)).toBe(1);
		expect(similarite('chat noir', 'voiture rapide')).toBe(0);
	});
	it('vaut 0 si aucun mot utile', () => {
		expect(similarite('le la', 'les des')).toBe(0);
	});
});

describe('motsUtiles', () => {
	it('retire les mots vides ; vide pour un message sans substance', () => {
		expect(motsUtiles('c\'est tout')).toEqual([]);
		expect(motsUtiles('ok merci')).toEqual([]);
		expect(motsUtiles('je suis ok avec tes propositions')).toEqual(['propositions']);
		expect(motsUtiles('Le catalogue de vente')).toEqual(['catalogue', 'vente']);
	});
});
