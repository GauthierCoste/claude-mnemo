/**
 * Pourquoi une recherche ou une injection est venue sans notes, d'après l'état des modèles et le niveau (celui de la machine,
 * et celui d'une session s'il en a un) : `coupes` (pour la machine ou pour la session), `absents` (aucun modèle utile
 * installé), `chargement` (ils démarrent : les notes viendront), `arretes` (un modèle utile est permis mais ne tourne pas :
 * seul cas où « Démarrer » a un sens), `sens` (sens seul, pas de reclassement).
 */
import { modelesPermis, niveauEffectif, type NiveauModeles } from '@mnemo/commun';
import type { EtatModelesVue } from '@mnemo/contrat';

export type AvisModeles = { motif: 'coupes' | 'sens'; pourLaSession: boolean } | { motif: 'arretes' | 'absents' | 'chargement' };

export function avisModeles(e: EtatModelesVue | undefined, propre: NiveauModeles | null): AvisModeles | null {
	if (e === undefined) return null;
	const effectif = niveauEffectif(e.niveau, propre);
	const pourLaSession = effectif !== e.niveau;
	if (effectif === 'coupes') return { motif: 'coupes', pourLaSession };
	// les modèles utiles au niveau effectif, et installés (un seul installé suffit : la recherche s'en sert)
	const permis = modelesPermis(effectif);
	const utiles = (['sens', 'reranker'] as const).filter((t) => permis[t] && e[t] !== 'absent').map((t) => e[t]);
	if (utiles.length === 0) return { motif: 'absents' };
	if (e.gardien === 'demarrage') return { motif: 'chargement' };
	if (utiles.some((x) => x === 'arrete')) return { motif: 'arretes' };
	if (effectif === 'sens') return { motif: 'sens', pourLaSession };
	return null;
}
