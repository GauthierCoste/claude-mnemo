/** Libellés des modèles locaux : activités, texte et point du bouton global, état et détail de chaque pièce (textes : `t.modeles`). */
import type { ActiviteModeleVue, EtatModelesVue, PieceModeleVue } from '@mnemo/contrat';
import type { Textes } from '../../langue/textes.ts';
import { modelesUtilesPrets } from '../../modeles/etat.ts';

/** « Vectorisation 120/800 », « Vectorisation… » (total pas encore compté), « Recherche… », « Injection… ». */
export function libelleActivite(a: ActiviteModeleVue, t: Textes): string {
	const x = t.modeles.activite;
	if (a.operation === 'vectorisation') return a.avancement === null || a.avancement.total === null ? x.vectorisation : x.vectorisationAvancee(a.avancement.faits, a.avancement.total);
	return a.operation === 'recherche' ? x.recherche : x.injection;
}

/** Point d'état : `actif` (pouls), `pret` (fixe), `veille`, `alerte`, ou rien. */
export type Point = 'actif' | 'pret' | 'veille' | 'alerte' | null;

/**
 * Texte et point du bouton global. « Prêts » seulement si chaque modèle permis et installé l'est : un gardien prêt à qui en
 * manque un (niveau élargi depuis son lancement) est dit « en veille », et le menu propose « Démarrer ».
 */
export function resume(e: EtatModelesVue, t: Textes): { texte: string; point: Point } {
	const x = t.modeles.resume;
	if (e.niveau === 'coupes') return { texte: x.coupes, point: null };
	if (e.gardien === 'echec') return { texte: x.echec, point: 'alerte' };
	const derniere = e.activites.at(-1);
	if (derniere !== undefined) return { texte: libelleActivite(derniere, t) + (e.activites.length > 1 ? ` +${e.activites.length - 1}` : ''), point: 'actif' };
	if (e.gardien === 'demarrage') return { texte: x.chargement, point: 'actif' };
	const sens = e.niveau === 'sens';
	if (e.gardien === 'pret' && modelesUtilesPrets(e)) return { texte: sens ? x.sensPret : x.prets, point: 'pret' };
	return { texte: sens ? x.sensVeille : x.veille, point: 'veille' };
}

/** État d'un modèle, pour le menu. */
export function etatModele(e: EtatModelesVue, modele: 'sens' | 'reranker', t: Textes): string {
	const x = t.modeles.etats;
	const etat = e[modele];
	if (etat === 'absent') return x.nonInstalle;
	if (etat === 'exclu') return x.exclu;
	if (e.gardien === 'echec') return x.echec;
	if (etat === 'pret') return x.pret;
	return e.gardien === 'demarrage' ? x.chargement : x.veille;
}

/** « BAAI – Q8_0 – 605,2 Mo – aa473d51 ». */
export function detailPiece(x: PieceModeleVue, t: Textes): string {
	return [x.editeur, x.quantification, t.commun.formats.taille(x.octets), x.empreinte].join(' – ');
}

/** Une ligne du menu global : rôle, état, modèle, détail, et la bulle qui dit à quoi sert la pièce. */
export type LignePiece = { role: string; etat: string; modele: string; detail: string; titre: string };

/** Les trois pièces : sens, reclassement, moteur ; une pièce absente dit « non installé ». */
export function lignesPieces(e: EtatModelesVue, t: Textes): LignePiece[] {
	const { sens, reranker, moteur } = e.pieces;
	const p = t.modeles.pieces;
	const nonInstalle = t.modeles.etats.nonInstalle;
	const modele = (role: string, cle: 'sens' | 'reranker', x: PieceModeleVue | null, usage: string): LignePiece =>
		x === null
			? { role, etat: nonInstalle, modele: '', detail: '', titre: usage }
			: { role, etat: etatModele(e, cle, t), modele: x.modele, detail: detailPiece(x, t), titre: p.titre(usage, x.empreinte) };
	return [
		modele(p.sens, 'sens', sens, p.usageSens),
		modele(p.reclassement, 'reranker', reranker, p.usageReclassement),
		moteur === null
			? { role: p.moteur, etat: nonInstalle, modele: '', detail: '', titre: p.serveur }
			: { role: p.moteur, etat: '', modele: `llama.cpp ${moteur.version}`, detail: p.local(moteur.plateforme), titre: p.serveurVersion(moteur.version) },
	];
}
