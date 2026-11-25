/** Libellés des modèles locaux : niveaux, activités, texte et point du bouton global, état et détail de chaque pièce. */
import { tailleLisible, type NiveauModeles } from '@mnemo/commun';
import type { ActiviteModeleVue, EtatModelesVue, PieceModeleVue } from '@mnemo/contrat';

export const NOMS_NIVEAUX: Record<NiveauModeles, string> = { complets: 'Complets', sens: 'Sens seul', coupes: 'Coupés' };
export const DETAILS_NIVEAUX: Record<NiveauModeles, string> = {
	complets: 'Sens et reclassement : la meilleure recherche – ~1,6 Go',
	sens: 'Sans reclassement : un peu moins précis – ~0,8 Go',
	coupes: 'Mots seuls : ne trouve pas les reformulations – aucun',
};

/** Effet d'un niveau sur les recherches et l'injection d'une session (la mémoire ne change pas : les serveurs sont partagés). */
export const DETAILS_SESSION: Record<NiveauModeles, string> = {
	complets: 'Sens et reclassement : les pistes les plus justes',
	sens: 'Sans reclassement : pistes un peu moins bien classées, réponses plus rapides',
	coupes: 'Mots seuls : ne trouve pas les reformulations',
};

/** « Vectorisation 120/800 », « Vectorisation… » (total pas encore compté), « Recherche… », « Injection… ». */
export function libelleActivite(a: ActiviteModeleVue): string {
	if (a.operation === 'vectorisation') return a.avancement === null || a.avancement.total === null ? 'Vectorisation…' : `Vectorisation ${a.avancement.faits}/${a.avancement.total}`;
	return a.operation === 'recherche' ? 'Recherche…' : 'Injection…';
}

/** Point d'état : `actif` (pouls), `pret` (fixe), `veille`, `alerte`, ou rien. */
export type Point = 'actif' | 'pret' | 'veille' | 'alerte' | null;

/** Texte et point du bouton global. */
export function resume(e: EtatModelesVue): { texte: string; point: Point } {
	if (e.niveau === 'coupes') return { texte: 'Modèles coupés', point: null };
	if (e.gardien === 'echec') return { texte: 'Modèles en échec', point: 'alerte' };
	const derniere = e.activites.at(-1);
	if (derniere !== undefined) return { texte: libelleActivite(derniere) + (e.activites.length > 1 ? ` +${e.activites.length - 1}` : ''), point: 'actif' };
	if (e.gardien === 'demarrage') return { texte: 'Chargement…', point: 'actif' };
	const sens = e.niveau === 'sens';
	if (e.gardien === 'pret') return { texte: sens ? 'Sens seul prêt' : 'Modèles prêts', point: 'pret' };
	return { texte: sens ? 'Sens seul en veille' : 'Modèles en veille', point: 'veille' };
}

/** État d'un modèle, pour le menu. */
export function etatModele(e: EtatModelesVue, modele: 'sens' | 'reranker'): string {
	const etat = e[modele];
	if (etat === 'absent') return 'non installé';
	if (etat === 'exclu') return 'exclu';
	if (e.gardien === 'echec') return 'en échec';
	if (etat === 'pret') return 'prêt';
	return e.gardien === 'demarrage' ? 'chargement…' : 'en veille';
}

/** « BAAI – Q8_0 – 605,2 Mo – aa473d51 ». */
export function detailPiece(x: PieceModeleVue): string {
	return [x.editeur, x.quantification, tailleLisible(x.octets), x.empreinte].join(' – ');
}

/** Une ligne du menu global : rôle, état, modèle, détail, et la bulle qui dit à quoi sert la pièce. */
export type LignePiece = { role: string; etat: string; modele: string; detail: string; titre: string };

/** Les trois pièces : sens, reclassement, moteur ; une pièce absente dit « non installé ». */
export function lignesPieces(e: EtatModelesVue): LignePiece[] {
	const { sens, reranker, moteur } = e.pieces;
	const modele = (role: string, cle: 'sens' | 'reranker', x: PieceModeleVue | null, usage: string): LignePiece =>
		x === null
			? { role, etat: 'non installé', modele: '', detail: '', titre: usage }
			: { role, etat: etatModele(e, cle), modele: x.modele, detail: detailPiece(x), titre: `${usage} – empreinte SHA-256 ${x.empreinte}…` };
	return [
		modele('Sens', 'sens', sens, 'Vecteurs de sens (recherche par le sens)'),
		modele('Reclassement', 'reranker', reranker, 'Reclasse les meilleures pistes'),
		moteur === null
			? { role: 'Moteur', etat: 'non installé', modele: '', detail: '', titre: 'Serveur llama-server de llama.cpp (ggml)' }
			: { role: 'Moteur', etat: '', modele: `llama.cpp ${moteur.version}`, detail: `${moteur.plateforme} – local, 127.0.0.1`, titre: `Serveur llama-server de llama.cpp (ggml), version ${moteur.version}` },
	];
}
