import { describe, expect, it } from 'vitest';
import { filsDe, markdownDuFil, nettoyerMessage, sujetNormalise } from '../../src/domaine/emails.ts';

describe('nettoyerMessage', () => {
	it('retire les lignes citées « > »', () => {
		expect(nettoyerMessage('Oui, d’accord.\n> Tu viens ?\n>> et toi ?\nÀ demain')).toBe('Oui, d’accord.\nÀ demain');
	});

	it('retire « Le 3 mars, Marc a écrit : » et tout ce qui suit', () => {
		expect(nettoyerMessage('Merci !\n\nLe 3 mars 2026 à 10:00, Marc <m@exemple.fr> a écrit :\n> bonjour\nAutre texte ancien')).toBe('Merci !');
	});

	it('retire l’en-tête replié sur deux lignes', () => {
		expect(nettoyerMessage('Ok\n\nLe lundi 3 mars 2026 à 10:00, Marc Dupont\n<marc@exemple.fr> a écrit :\n> x')).toBe('Ok');
	});

	it('retire « On … wrote: »', () => {
		expect(nettoyerMessage('Sounds good.\n\nOn Mon, Mar 3, 2026 at 10:00 AM Marc <m@example.com> wrote:\n> hi')).toBe('Sounds good.');
	});

	it('retire un bloc Outlook français et anglais', () => {
		expect(nettoyerMessage('Réponse\n\nDe : Marc\nEnvoyé : lundi\nÀ : Moi\nObjet : x\n\nancien')).toBe('Réponse');
		expect(nettoyerMessage('Reply\n\nFrom: Marc\nSent: Monday\nTo: Me\nSubject: x\n\nold')).toBe('Reply');
		expect(nettoyerMessage('Reply\n-----Original Message-----\nold')).toBe('Reply');
	});

	it('conserve « De : » ordinaire sans « Envoyé »', () => {
		expect(nettoyerMessage('De : Paris à Lyon, le train part à 8 h.')).toBe('De : Paris à Lyon, le train part à 8 h.');
	});

	it('retire la signature « -- » et la suite', () => {
		expect(nettoyerMessage('Texte\n\n-- \nMarc\n06 00 00 00 00')).toBe('Texte');
		expect(nettoyerMessage('a -- b\n--- séparateur')).toBe('a -- b\n--- séparateur');
	});

	it('retire la formule de politesse finale et le nom, dans les 6 dernières lignes', () => {
		expect(nettoyerMessage('Le devis est prêt.\n\nCordialement,\nMarc Dupont')).toBe('Le devis est prêt.');
		expect(nettoyerMessage('Voilà.\nBonne journée\nMarc')).toBe('Voilà.');
	});

	it('faux positifs : « cordialement » au milieu d’un texte ou loin de la fin est conservé', () => {
		expect(nettoyerMessage('Il m’a répondu cordialement hier.\nSuite.')).toBe('Il m’a répondu cordialement hier.\nSuite.');
		const long = ['Cordialement', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
		expect(nettoyerMessage(long)).toBe(long);
	});

	it('gère CRLF', () => {
		expect(nettoyerMessage('Salut\r\n> cité\r\n')).toBe('Salut');
	});
});

describe('nettoyerMessage : prudence (faux positifs)', () => {
	it('« Le client nous a écrit : » sans date ni adresse est conservé', () => {
		const t = 'Le client nous a écrit :\nil veut une remise.';
		expect(nettoyerMessage(t)).toBe(t);
		expect(nettoyerMessage('On the other hand the client wrote:\nok')).toBe('On the other hand the client wrote:\nok');
	});
	it('« -- » seul n’est jamais une signature (seulement « -- » + espace)', () => {
		const t = ['a', '--', ...Array.from({ length: 9 }, (_, i) => `ligne ${i}`)].join('\n');
		expect(nettoyerMessage(t)).toBe(t);
		expect(nettoyerMessage('Point 1\n--\nPoint 2 important')).toBe('Point 1\n--\nPoint 2 important');
	});
	it('formule suivie de vrai contenu : conservée', () => {
		const t = 'Merci.\nCordialement\nJe voulais ajouter que le budget a changé, voir la pièce.\nEt aussi la date limite est le 5 !';
		expect(nettoyerMessage(t)).toBe(t);
		expect(nettoyerMessage('Voilà.\nCordialement\nMarc\nDirecteur\n06.00.00.00.00')).toBe('Voilà.');
		expect(nettoyerMessage('Voilà.\nCordialement\na\nb\nc\nd')).toBe('Voilà.\nCordialement\na\nb\nc\nd');
	});
	it('formule suivie de phrases : tout est conservé', () => {
		const t = 'Cordialement,\nl’équipe a validé\nle montant de 5000 €\nà régler avant fin mars';
		expect(nettoyerMessage(t)).toBe(t);
		expect(nettoyerMessage(`Merci.\n${t}`)).toBe(`Merci.\n${t}`);
		expect(nettoyerMessage('Voilà.\nCordialement,\nMarc Dupont\nDirecteur technique\n06 12 34 56 78')).toBe('Voilà.');
		expect(nettoyerMessage('Voilà.\nBien à vous,\nMarc')).toBe('Voilà.');
		expect(nettoyerMessage('Voilà.\nCordialement\nMarc\nmarc@exemple.fr\nhttps://exemple.fr')).toBe('Voilà.');
	});
	it('« De : » + une seule rubrique n’est pas un bloc Outlook ; deux rubriques oui', () => {
		const t = 'De : Paris\nDate : le 5\nsuite du texte';
		expect(nettoyerMessage(t)).toBe(t);
		expect(nettoyerMessage('ok\nDe : Marc\nDate : lundi\nObjet : x\nancien')).toBe('ok');
	});
});

describe('sujetNormalise', () => {
	it('retire Re/TR/Fwd/Fw répétés, casse et espaces ignorés', () => {
		expect(sujetNormalise('RE : Re: TR:  Fwd: FW: Devis  Mars')).toBe('devis mars');
		expect(sujetNormalise(null)).toBe('');
	});
});

const m = (id: string | null, reponseA: string[], sujet: string, date: string | null, texte = 't') => ({ id, reponseA, sujet, date, de: 'a', texte });

describe('filsDe', () => {
	it('regroupe par In-Reply-To / References, trié par date', () => {
		const fils = filsDe([m('<2>', ['<1>'], 'Re: x', '2026-03-02T10:00:00Z', 'deux'), m('<1>', [], 'x', '2026-03-01T10:00:00Z', 'un'), m('<9>', [], 'autre', '2026-03-01T00:00:00Z', 'neuf')]);
		expect(fils.map((f) => f.map((x) => x.texte))).toEqual([['un', 'deux'], ['neuf']]);
	});

	it('relie deux réponses à une racine absente du fichier', () => {
		const fils = filsDe([m('<a>', ['<racine>'], 'Re: q', '2026-03-02T00:00:00Z'), m('<b>', ['<racine>', '<a>'], 'Re: Re: q', '2026-03-03T00:00:00Z')]);
		expect(fils).toHaveLength(1);
	});

	it('à défaut d’identifiants, regroupe par sujet normalisé', () => {
		const fils = filsDe([m(null, [], 'Devis', '2026-03-01T00:00:00Z'), m(null, [], 'TR: RE : devis', '2026-03-02T00:00:00Z'), m(null, [], 'Autre', '2026-03-02T00:00:00Z')]);
		expect(fils.map((f) => f.length)).toEqual([2, 1]);
	});

	it('deux fils liés par identifiants ne fusionnent pas sur un sujet identique', () => {
		const fils = filsDe([m('<1>', [], 'Bonjour', '2026-03-01T00:00:00Z'), m('<2>', ['<1>'], 'Re: Bonjour', '2026-03-01T01:00:00Z'), m('<3>', [], 'Bonjour', '2026-04-01T00:00:00Z'), m('<4>', ['<3>'], 'Re: Bonjour', '2026-04-01T01:00:00Z')]);
		expect(fils).toHaveLength(2);
	});

	it('dates illisibles à la fin, ordre stable', () => {
		const fils = filsDe([m('<1>', [], 's', 'pas une date', 'x'), m('<2>', ['<1>'], 's', null, 'y'), m('<3>', ['<1>'], 's', '2026-01-01T00:00:00Z', 'z')]);
		expect(fils[0]!.map((x) => x.texte)).toEqual(['z', 'x', 'y']);
	});
});

describe('filsDe : sujet et doublons', () => {
	it('le sujet ne réunit pas deux fils déjà liés', () => {
		const fils = filsDe([m('<1>', [], 'Point', '2026-03-01T00:00:00Z'), m('<2>', ['<1>'], 'Re: Point', '2026-03-01T01:00:00Z'), m('<3>', [], 'Point', '2026-04-01T00:00:00Z'), m('<4>', ['<3>'], 'Re: Point', '2026-04-01T01:00:00Z'), m(null, [], 'Point', '2026-05-01T00:00:00Z', 'orphelin')]);
		expect(fils).toHaveLength(2);
		expect(fils.flat().filter((x) => x.texte === 'orphelin')).toHaveLength(1);
		expect(fils[0]!.some((x) => x.texte === 'orphelin')).toBe(true);
	});
	it('Message-ID en double : première copie gardée', () => {
		const fils = filsDe([m('<1>', [], 's', '2026-03-01T00:00:00Z', 'premier'), m('<1>', [], 's', '2026-03-01T00:00:00Z', 'copie')]);
		expect(fils.flat().map((x) => x.texte)).toEqual(['premier']);
	});
});

describe('markdownDuFil', () => {
	it('un titre par message', () => {
		expect(markdownDuFil([{ de: 'Marc', date: '2026-03-01T10:00:00Z', sujet: 's', texte: 'Bonjour' }, { de: null, date: null, sujet: null, texte: 'Re' }])).toBe(
			'## 2026-03-01T10:00:00Z — Marc\n\nBonjour\n\n## date inconnue — auteur inconnu\n\nRe',
		);
	});
});
