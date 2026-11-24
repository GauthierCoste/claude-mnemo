/** Textes du bilan d'import de la mémoire de Claude Code (`amorce`) : toast court et lignes du détail. Pur. */
import type { BilanAmorceVue, CompteAmorceVue } from '@mnemo/contrat';
import { lignesAvertissements } from '../client/avertissements.ts';

const nombre = (n: number, un: string, plusieurs: string): string => `${n} ${n > 1 ? plusieurs : un}`;

/** « 3 nouvelles, 1 modifiée, 60 inchangées » (féminin) ou « 2 nouveaux, 0 modifié, 5 inchangés » (masculin). */
function compte(c: CompteAmorceVue, feminin: boolean): string {
	const e = feminin ? 'e' : '';
	return [
		nombre(c.nouvelles, feminin ? 'nouvelle' : 'nouveau', feminin ? 'nouvelles' : 'nouveaux'),
		nombre(c.modifiees, `modifié${e}`, `modifié${e}s`),
		nombre(c.inchangees, `inchangé${e}`, `inchangé${e}s`),
	].join(', ');
}

/** Où en est la remise à l'archiviste, dite telle qu'elle est ; null s'il n'y a rien à traiter. */
export function etatArchiviste(b: BilanAmorceVue): string | null {
	if (b.archiviste === 'confie') return `confié à l’archiviste (${b.aTraiter} à traiter)`;
	if (b.archiviste === 'en_attente') return `en attente : l’archiviste n’est pas lancé, ${b.aTraiter} à traiter`;
	return null;
}

/** Bilan court, pour le toast : ce qui a changé (ou « rien de nouveau »), puis où en est la remise à l'archiviste. */
export function resumeAmorce(b: BilanAmorceVue): string {
	const notes = b.notes.nouvelles + b.notes.modifiees;
	const instructions = b.instructions.nouvelles + b.instructions.modifiees;
	const parties = [
		...(notes > 0 ? [nombre(notes, 'note nouvelle ou modifiée', 'notes nouvelles ou modifiées')] : []),
		...(instructions > 0 ? [nombre(instructions, 'CLAUDE.md nouveau ou modifié', 'CLAUDE.md nouveaux ou modifiés')] : []),
		...(b.rattachees > 0 ? [nombre(b.rattachees, 'fiche rattachée à un projet', 'fiches rattachées à un projet')] : []),
	];
	const tete = parties.length === 0 ? 'Mémoire de Claude : rien de nouveau' : `Mémoire de Claude importée : ${parties.join(', ')}`;
	const archiviste = etatArchiviste(b);
	return archiviste === null ? tete : `${tete} — ${archiviste}`;
}

/** Lignes du détail dépliable (sans les fichiers ignorés, listés à part). */
export function lignesAmorce(b: BilanAmorceVue): string[] {
	const archiviste = etatArchiviste(b);
	return [
		`Notes : ${compte(b.notes, true)}`,
		`CLAUDE.md des projets : ${compte(b.instructions, false)}`,
		...(b.rattachees > 0 ? [`${nombre(b.rattachees, 'fiche rattachée', 'fiches rattachées')} à un projet`] : []),
		...(b.secrets > 0 ? [nombre(b.secrets, 'secret masqué', 'secrets masqués')] : []),
		...(archiviste === null ? [] : [`À traiter : ${archiviste}`]),
		...lignesAvertissements(b),
		...(b.commit === null ? ['Aucun changement : rien n’a été écrit'] : []),
	];
}
