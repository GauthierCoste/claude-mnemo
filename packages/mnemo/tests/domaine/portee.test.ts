import { describe, expect, it } from 'vitest';
import { lieuxDe, lirePortee, porteesDesLieux } from '../../src/domaine/portee.ts';

const aucune = () => null;
const noms = (chemin: string, declaree: (fiche: string) => string | null = aucune) => porteesDesLieux(lieuxDe(chemin), declaree).map((p) => p.portee);

describe('lieuxDe', () => {
	it('une fiche, puis ses dossiers ascendants, du plus profond au premier niveau', () => {
		expect(lieuxDe('clients/acme/site/note.md')).toEqual([
			{ position: 'clients/acme/site/note.md', fiche: 'clients/acme/site/note.md' },
			{ position: 'clients/acme/site', fiche: 'clients/acme/site/site.md' },
			{ position: 'clients/acme', fiche: 'clients/acme/acme.md' },
			{ position: 'clients', fiche: 'clients/clients.md' },
		]);
	});

	it('la fiche d\'un dossier est le dossier lui-même ; un dossier sans .md aussi ; la racine n\'a aucun lieu', () => {
		expect(lieuxDe('projets/Lumen/Lumen.md').map((l) => l.position)).toEqual(['projets/Lumen', 'projets']);
		expect(lieuxDe('projets/Lumen').map((l) => l.position)).toEqual(['projets/Lumen', 'projets']);
		expect(lieuxDe('')).toEqual([]);
	});
});

describe('porteesDesLieux', () => {
	it('le nom d\'un dossier ne donne aucune portée : seule la clé portee déclarée compte', () => {
		expect(noms('clients/ombellerail/refonte/catalogue.md')).toEqual([]);
		expect(noms('projets/p/a.md')).toEqual([]);
		expect(noms('stacks/php.md')).toEqual([]);
		expect(noms('projets/Lumen/Lumen.md', (f) => (f === 'projets/Lumen/Lumen.md' ? 'projet:Lumen' : null))).toEqual(['projet:Lumen']);
	});

	it('déclarée dans la fiche d\'un lieu : elle s\'ajoute à celles des lieux parents', () => {
		const declaree = (fiche: string) => (fiche === 'clients/acme/site/site.md' ? 'projet:site' : fiche === 'clients/acme/acme.md' ? 'client:acme' : null);
		expect(porteesDesLieux(lieuxDe('clients/acme/site/api'), declaree)).toEqual([
			{ portee: 'projet:site', genre: 'projet', nom: 'site', position: 'clients/acme/site' },
			{ portee: 'client:acme', genre: 'client', nom: 'acme', position: 'clients/acme' },
		]);
	});

	it('déclarée n\'importe où : une mémoire rangée librement a ses portées', () => {
		expect(noms('travail/lumen/note.md', (f) => (f === 'travail/lumen/lumen.md' ? 'projet:Lumen' : null))).toEqual(['projet:Lumen']);
	});

	it('une portée vue à deux niveaux ne compte qu\'une fois, à son rang le plus profond, avec la position la plus haute', () => {
		const declaree = (fiche: string) => (fiche === 'projets/p/sous/note.md' || fiche === 'projets/p/p.md' ? 'projet:p' : fiche === 'projets/p/sous/sous.md' ? 'client:c' : null);
		expect(porteesDesLieux(lieuxDe('projets/p/sous/note.md'), declaree)).toEqual([
			{ portee: 'projet:p', genre: 'projet', nom: 'p', position: 'projets/p' },
			{ portee: 'client:c', genre: 'client', nom: 'c', position: 'projets/p/sous' },
		]);
	});

	it('une déclaration invalide ou « globale » ne donne aucune portée', () => {
		expect(noms('projets/p', () => 'n\'importe quoi')).toEqual([]);
		expect(noms('projets/p', () => 'globale')).toEqual([]);
	});
});

describe('lirePortee', () => {
	it('globale, genre:nom ; toute autre valeur est invalide', () => {
		expect(lirePortee(undefined)).toEqual({ genre: 'globale' });
		expect(lirePortee('globale')).toEqual({ genre: 'globale' });
		expect(lirePortee('client: Acme ')).toEqual({ genre: 'client', nom: 'Acme' });
		expect(lirePortee('equipe:x')).toEqual({ genre: 'invalide', brute: 'equipe:x' });
		expect(lirePortee(3)).toEqual({ genre: 'invalide', brute: '3' });
	});
});
