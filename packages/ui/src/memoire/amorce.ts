/**
 * Textes du bilan d'import de la mémoire de Claude Code (`amorce`) : toast court et lignes du détail. Pur ; les phrases sont
 * dans la liste de textes (`t.memoire.amorce`), le français par défaut pour un appelant sans langue.
 */
import type { BilanAmorceVue, CompteAmorceVue } from '@mnemo/contrat';
import { lignesAvertissements } from '../client/avertissements.ts';
import { TEXTES, type Textes } from '../langue/textes.ts';

export type TextesAmorce = Textes['memoire']['amorce'];
const FR: TextesAmorce = TEXTES.fr.memoire.amorce;

const compte = (c: CompteAmorceVue, feminin: boolean, t: TextesAmorce): string => t.compte(c.nouvelles, c.modifiees, c.inchangees, feminin);

/** Où en est la remise à l'archiviste, dite telle qu'elle est ; null s'il n'y a rien à traiter. */
export function etatArchiviste(b: BilanAmorceVue, t: TextesAmorce = FR): string | null {
	if (b.archiviste === 'confie') return t.confie(b.aTraiter);
	if (b.archiviste === 'en_attente') return t.enAttente(b.aTraiter);
	return null;
}

/** Bilan court, pour le toast : ce qui a changé (ou « rien de nouveau »), puis où en est la remise à l'archiviste. */
export function resumeAmorce(b: BilanAmorceVue, t: TextesAmorce = FR): string {
	const notes = b.notes.nouvelles + b.notes.modifiees;
	const instructions = b.instructions.nouvelles + b.instructions.modifiees;
	const parties = [...(notes > 0 ? [t.notes(notes)] : []), ...(instructions > 0 ? [t.instructions(instructions)] : []), ...(b.rattachees > 0 ? [t.rattachees(b.rattachees)] : [])];
	const tete = parties.length === 0 ? t.rienDeNouveau : t.importee(parties);
	const archiviste = etatArchiviste(b, t);
	return archiviste === null ? tete : t.avecArchiviste(tete, archiviste);
}

/** Lignes du détail dépliable (sans les fichiers ignorés, listés à part). */
export function lignesAmorce(b: BilanAmorceVue, t: TextesAmorce = FR): string[] {
	const archiviste = etatArchiviste(b, t);
	return [
		t.ligneNotes(compte(b.notes, true, t)),
		t.ligneInstructions(compte(b.instructions, false, t)),
		...(b.rattachees > 0 ? [t.ligneRattachees(b.rattachees)] : []),
		...(b.secrets > 0 ? [t.secrets(b.secrets)] : []),
		...(archiviste === null ? [] : [t.aTraiter(archiviste)]),
		...lignesAvertissements(b),
		...(b.commit === null ? [t.rienEcrit] : []),
	];
}
