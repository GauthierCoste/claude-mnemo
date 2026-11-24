import type { Dependances } from '../../src/application/ports.ts';
import type { Fait } from '../../src/domaine/fait.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';

/** Une fiche de test : en-tête, titre, corps. */
export const fiche = (type: string, titre: string, corps = '', extra = '') =>
	`---\nid: 01${titre.toUpperCase().replace(/[^A-Z]/gu, '')}\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n# ${titre}\n${corps}`;

/**
 * Informations d'Acme : f-0001, f-0002, f-0003 et f-0008 se répètent (f-0003 et f-0001 citent le même document ; f-0008
 * cite le même document que f-0001 et un autre) ; f-0004 est barrée par f-0002 ; f-0005 et f-0006 sont à confirmer (f-0006
 * contredit f-0007).
 */
export const ACME = [
	'- Le client est Acme | declare | src: [[sources/a]] | appris 2026-11-01 ^f-0001',
	'  > « Acme, notre client »',
	'- Acme est notre client | declare | src: [[sources/m]] | appris 2026-11-05 ^f-0002',
	'  > « Acme client »',
	'- Le client est bien Acme | declare | src: [[sources/a.md]] ^f-0003',
	'- ~~Siège à Paris~~ | declare | src: [[sources/a]] | invalidé 2026-11-02 par ^f-0002 ^f-0004',
	'- Le contact s\'appelle Corbano | infere | src: [[sources/a]] | a confirmer ^f-0005',
	'- [montant] Budget de 1200 € | declare | src: utilisateur | a confirmer | contredit ^f-0007 ^f-0006',
	'- [montant] Budget de 1500 € | declare | src: utilisateur ^f-0007',
	'- Acme est cliente | declare | src: [[sources/a]] | confiance 79 % ^f-0008',
	'  + src: [[sources/n]] | corroboré 2026-11-10',
].join('\n');

/** Mémoire de test : Acme, des sources typées, une fiche qui lie des informations d'Acme, une consigne. */
export function remplir(dep: Dependances & { fichiers: Map<string, string> }): void {
	dep.fichiers.set('sources/sources.md', fiche('dossier', 'Sources'));
	dep.fichiers.set('sources/a.md', fiche('source', 'Note A', '\nUn document.\n', 'type_source: inconnue\n'));
	dep.fichiers.set('sources/m.md', fiche('source', 'Mail M', '\nUn courriel.\n', 'type_source: email\n'));
	dep.fichiers.set('sources/n.md', fiche('source', 'Note N', '\nUne note.\n', 'type_source: note\n'));
	dep.fichiers.set('clients/acme.md', fiche('organisation', 'Acme', `\nLe client Acme.\n\n## Informations\n${ACME}\n`));
	dep.fichiers.set('clients/lyon.md', fiche('organisation', 'Site de Lyon', '\nVoir [[clients/acme#^f-0002]], [[Acme#^f-0006|budget]], [[clients/acme.md#^f-0005]] et [[clients/acme#^f-0007]].\n'));
	dep.fichiers.set('consignes/regle.md', fiche('consigne', 'Règle', '\n## Informations\n- Toujours vouvoyer | declare | src: utilisateur | a confirmer ^f-0001\n'));
}

export function faitDe(texte: string, ancre: string): Fait | undefined {
	for (const l of lireFiche('clients/acme.md', texte).faits) if ('fait' in l && l.fait.ancre === ancre) return l.fait;
	return undefined;
}

export const ligne = (n: number): string => ACME.split('\n').find((l) => l.endsWith(`^f-000${n}`))!;
