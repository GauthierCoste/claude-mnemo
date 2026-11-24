import { describe, expect, it } from 'vitest';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { contenuAmorce, descripteurDeSource, ficheDeLienSource, positionDeLaPiece } from '../../src/domaine/source.ts';

const fiche = (entete: string, corps = '') => lireFiche('sources/x.md', `---\nid: X\ntype: source\n${entete}updated: 2026-11-01\n---\n# Titre\n\n${corps}`);

describe('descripteur de source', () => {
	it('document, fil, version, type, date, auteur', () => {
		expect(descripteurDeSource(fiche('chemin: docs\\b.mbox\nfil: 2\nversion_de: "[[sources/a]]"\ntype_source: email\ndate: 2026-10-01\nauteur: "Marc  D."\n'))).toEqual({
			document: 'docs/b.mbox', fil: 2, conteneur: false, parente: null, piece: null, positionPiece: null, empreinteContenu: null, versionDe: 'sources/a.md', typeSource: 'email', titre: 'Titre', date: '2026-10-01', auteur: 'Marc D.', resume: null,
		});
	});

	it('fille : parente et pièce ; amorcée : empreinte du contenu ; type inconnu par défaut ; autre fiche → null', () => {
		expect(descripteurDeSource(fiche('source_parente: "[[sources/mail|Mail]]"\npiece: a.pdf\n'))).toMatchObject({ document: null, parente: 'sources/mail.md', piece: 'a.pdf', positionPiece: null, typeSource: 'inconnue' });
		expect(descripteurDeSource(fiche('source_parente: "[[sources/mail]]"\npiece: a.pdf\npiece_position: 3\n'))).toMatchObject({ piece: 'a.pdf', positionPiece: 3 });
		expect(descripteurDeSource(fiche('source_parente: "[[sources/mail]]"\npiece: a.pdf\npiece_position: 0\n'))).toMatchObject({ positionPiece: null });
		expect(descripteurDeSource(fiche('', '## Contenu\n\n```\nnote\n```\n'))!.empreinteContenu).toMatch(/^[0-9a-f]{16}$/u);
		expect(descripteurDeSource(fiche('fil: -1\nchemin: a.mbox\n'))!.fil).toBeNull();
		expect(descripteurDeSource(fiche('chemin: a.mbox\nfils: 3\n'))!.conteneur).toBe(true);
		expect(descripteurDeSource(fiche('chemin: a.mbox\nfils: 3\nfil: 1\n'))!.conteneur).toBe(false);
		expect(descripteurDeSource(fiche('chemin: a.mbox\nfils: 1\n'))!.conteneur).toBe(false);
		expect(descripteurDeSource(lireFiche('a.md', '---\nid: A\ntype: sujet\nupdated: 2026-11-01\n---\n# A\n'))).toBeNull();
	});

	it('résumé : la synthèse de la fiche, en ligne de contexte (masquée, 300 caractères au plus), null sans synthèse', () => {
		expect(descripteurDeSource(fiche('', 'Passation de l\'extranet, jeton sk-abcdefghijklmnopqrstuvwxyz0123.\n\n## Contenu\n\nx\n'))!.resume).toBe(
			'Passation de l\'extranet, jeton [secret masqué].',
		);
		expect(descripteurDeSource(fiche('', '## Contenu\n\nx\n'))!.resume).toBeNull();
	});

	it('lien de source : chemin de fiche où qu\'il soit rangé, avec .md ; invalide → null', () => {
		expect(ficheDeLienSource('[[sources/a#x]]')).toBe('sources/a.md');
		expect(ficheDeLienSource('sources/b.md')).toBe('sources/b.md');
		expect(ficheDeLienSource('[[projets/a]]')).toBe('projets/a.md');
		for (const v of ['[[sources/../x]]', '[[sources/]]', '', 3, null]) expect(ficheDeLienSource(v)).toBeNull();
	});

	it('contenu amorcé : intérieur du bloc (clôture plus longue), sinon tel quel', () => {
		expect(contenuAmorce('````\nA\n```\nB\n```\n````')).toBe('A\n```\nB\n```');
		expect(contenuAmorce('texte libre\n')).toBe('texte libre');
		expect(contenuAmorce('```\nnon fermé')).toBe('non fermé');
	});
});

describe('positionDeLaPiece', () => {
	const pieces = [{ nom: 'devis.pdf', position: 1 }, { nom: 'logo.png', position: 2 }, { nom: 'Devis.pdf', position: 3 }];
	it('la position désignée si le nom y est le même (casse ignorée) ; sinon null', () => {
		expect(positionDeLaPiece('devis.pdf', 3, pieces)).toBe(3);
		expect(positionDeLaPiece('devis.pdf', 2, pieces)).toBeNull();
		expect(positionDeLaPiece('devis.pdf', 9, pieces)).toBeNull();
	});
	it('sans position (fiche d\'avant les positions) : la première pièce de ce nom', () => {
		expect(positionDeLaPiece('DEVIS.pdf', null, pieces)).toBe(1);
		expect(positionDeLaPiece('absent.pdf', null, pieces)).toBeNull();
	});
});
