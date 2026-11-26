import { EMPLACEMENTS_PAR_DEFAUT } from '@mnemo/commun';
import { avecConsigne, lireConsigne, niveauPropose, repeter } from '../../domaine/consigne.ts';
import { ecrirePortee } from '../../domaine/portee.ts';
import type { Portee, PorteeLue } from '../../domaine/portee.ts';
import { cheminValide, contientSyntaxeDeLien, estCache, nomDeFichier, positionDeFiche } from '../../domaine/chemin.ts';
import { tronquerTexte } from '../../domaine/texte.ts';
import { ecrireFiche, lireFiche } from '../../domaine/fiche.ts';
import type { Fiche } from '../../domaine/fiche.ts';
import { LONGUEUR_MAX_FAIT } from '../../domaine/fait.ts';
import type { Dependances } from '../ports.ts';
import { chargerRegles } from '../regles-du-coffre.ts';
import { aujourdhui, cheminDeFiche, cheminExistant, dossiersManquants, ecrireEtCommiter, enFichier, ficheVide, mentionDeSource, motifCheminInvalide, motifCollision, motifSourceInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat, SourceProposee } from '../commun.ts';

export type DemandeConsigne = {
	genre: 'consigne';
	fiche?: string;
	texte: string;
	portee: Portee;
	source: SourceProposee;
	/** L'agent a vu les éléments proches et veut ajouter quand même : saute leur recherche. */
	apresProches?: boolean;
};

const SOURCES_DE_CONSIGNE: readonly string[] = ['utilisateur', 'session'];

/** Texte comparé : espaces réduits, rogné, sans casse, NFC. */
export const normaliser = (texte: string) => texte.normalize('NFC').replace(/[\s  ]+/gu, ' ').trim().toLowerCase().normalize('NFC');
function memePortee(lue: PorteeLue, demandee: Portee): boolean {
	if (lue.genre === 'invalide' || lue.genre !== demandee.genre) return false;
	return lue.genre === 'globale' || (demandee.genre !== 'globale' && lue.nom === demandee.nom);
}
const tronquer = (texte: string, max: number) => (Array.from(texte).length > max ? `${tronquerTexte(texte, max)}…` : texte);

/** La fiche relue donne le même titre et la même consigne. */
function survitALaRelecture(fiche: Fiche): boolean {
	try {
		const relue = lireFiche(fiche.chemin, ecrireFiche(fiche));
		const attendue = lireConsigne(fiche);
		const lue = lireConsigne(relue);
		return relue.type === 'consigne' && relue.titre === fiche.titre && JSON.stringify(lue) === JSON.stringify(attendue);
	} catch {
		return false;
	}
}

/** Motif de refus de la demande elle-même (texte, source, portée), sinon null. */
export function motifConsigneInvalide(demande: DemandeConsigne): string | null {
	const texte = demande.texte.trim();
	if (texte === '') return 'Le texte de la consigne est vide.';
	if (texte.length > LONGUEUR_MAX_FAIT) return `Le texte de la consigne dépasse ${LONGUEUR_MAX_FAIT} caractères.`;
	if (/[\r\n]/u.test(demande.texte)) return 'Le texte de la consigne doit tenir sur une seule ligne.';
	if (texte.startsWith('#')) return 'Le texte de la consigne ne doit pas commencer par « # ».';
	// Sécurité : une consigne vient de l'utilisateur ou d'une session, jamais d'un document.
	if (!SOURCES_DE_CONSIGNE.includes(demande.source.type)) {
		return `Une consigne ne peut venir que de l'utilisateur ou d'une session, pas d'une source « ${demande.source.type} ».`;
	}
	const portee = demande.portee;
	if (portee.genre !== 'globale') {
		const nom = portee.nom.trim();
		if (nom === '' || nom !== portee.nom || nom.includes('/') || nom.includes('\\') || cheminValide(nom) !== nom || estCache(nom) || contientSyntaxeDeLien(nom)) return `Nom de portée invalide : « ${portee.nom} ».`;
	}
	return motifSourceInvalide(demande.source);
}

/**
 * Dossier du lieu qui déclare la portée `portee` (`projet:X`…), où naît une consigne de cette portée : parmi les fiches de
 * lieu indexées qui la déclarent, la moins profonde, puis la première par ordre alphabétique ; pour une fiche simple, son
 * dossier. Null si aucun lieu ne la déclare, ou si le lieu est à la racine.
 */
async function dossierDuLieu(dep: Dependances, portee: string): Promise<string | null> {
	const lieux = (await dep.index.elements({ genres: ['fiche'] })).filter((e) => e.portee === portee && e.typeFiche !== 'consigne').map((e) => e.chemin);
	const profondeur = (chemin: string) => chemin.split('/').length;
	const [premier] = lieux.sort((a, b) => profondeur(a) - profondeur(b) || a.localeCompare(b));
	if (premier === undefined) return null;
	const position = positionDeFiche(premier);
	const dossier = position === premier ? premier.slice(0, Math.max(0, premier.lastIndexOf('/'))) : position;
	return dossier === '' ? null : dossier;
}

export async function proposerConsigne(dep: Dependances, demande: DemandeConsigne): Promise<Resultat> {
	const motif = motifConsigneInvalide(demande);
	if (motif !== null) return refuse(motif);
	const texte = demande.texte.trim();
	const portee = demande.portee;
	const source = mentionDeSource(demande.source);
	if (typeof source === 'string') return refuse(source);
	let imposee: string | null = null;
	if (demande.fiche !== undefined) {
		imposee = cheminDeFiche(demande.fiche);
		if (imposee === null) return refuse(motifCheminInvalide(demande.fiche));
		const variante = await cheminExistant(dep, imposee);
		if (variante !== null) return refuse(variante);
	}

	const regles = await chargerRegles(dep);
	const date = aujourdhui(dep);
	const cherche = normaliser(texte);
	// Une consigne déjà connue (même portée, même texte) compte une répétition. Le jalon 2 indexera cette recherche.
	for (const chemin of await dep.coffre.toutesLesFiches()) {
		let existante;
		let consigne;
		try {
			const contenu = await dep.coffre.lire(chemin);
			if (contenu === null) continue;
			existante = lireFiche(chemin, contenu);
			if (existante.type !== 'consigne') continue;
			consigne = lireConsigne(existante);
		} catch {
			continue; // fiche illisible : ignorée
		}
		if (!memePortee(consigne.portee, portee) || normaliser(consigne.texte) !== cherche) continue;
		const repetee = repeter(consigne, date);
		const fiche = avecConsigne(existante, repetee);
		fiche.updated = date;
		const commit = await ecrireEtCommiter(dep, [{ chemin, texte: texteDeFiche(dep, fiche) }], `mnemo: consigne ${chemin}`);
		return { statut: 'repetition', fiche: chemin, repetitions: repetee.repetitions.length, niveauPropose: niveauPropose(regles, repetee), commit };
	}

	let chemin = imposee;
	if (chemin === null) {
		const lieu = portee.genre === 'globale' ? null : await dossierDuLieu(dep, ecrirePortee(portee));
		const dossier = lieu === null ? EMPLACEMENTS_PAR_DEFAUT.consignes : `${lieu}/${EMPLACEMENTS_PAR_DEFAUT.consignes}`;
		const nom = nomDeFichier(tronquer(texte, 60).replace(/…$/u, ''));
		chemin = `${dossier}/${nom}.md`;
		for (let n = 2; (await dep.coffre.lire(chemin)) !== null; n++) chemin = `${dossier}/${nom} ${n}.md`;
		if (cheminDeFiche(chemin) !== chemin) return refuse(motifCheminInvalide(chemin));
	}
	const collision = await motifCollision(dep, chemin);
	if (collision !== null) return refuse(collision);

	const base = ficheVide(dep, chemin, 'consigne', tronquer(texte, 80), { source: source.mention });
	const fiche = avecConsigne(base, { texte, portee, niveau: 'rappelee', repetitions: [] });
	if (!survitALaRelecture(fiche)) return refuse('Cette consigne ne survivrait pas à sa relecture depuis la fiche : reformuler le texte.');
	const dossiers = await dossiersManquants(dep, chemin);
	if (typeof dossiers === 'string') return refuse(dossiers);
	const aEcrire = [enFichier(dep, fiche), ...dossiers.map((f) => enFichier(dep, f))];
	const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: consigne ${chemin}`);
	return { statut: 'ecrit', fiche: chemin, aConfirmer: false, commit };
}
