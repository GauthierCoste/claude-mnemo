/**
 * Pourquoi une recherche ou une injection est venue sans notes, d'après l'état des modèles et le niveau (celui de la machine,
 * et celui d'une session s'il en a un) : `coupes` (pour la machine ou pour la session), `sens` (sens seul, pas de
 * reclassement), `arretes` (le modèle utile est permis mais ne tourne pas : seul cas où « Démarrer » a un sens), `absents`.
 */
import { niveauEffectif, type NiveauModeles } from '@mnemo/commun';
import type { EtatModelesVue } from '@mnemo/contrat';

export type AvisModeles = { motif: 'coupes' | 'sens'; pourLaSession: boolean } | { motif: 'arretes' | 'absents' };

export function avisModeles(e: EtatModelesVue | undefined, propre: NiveauModeles | null): AvisModeles | null {
	if (e === undefined) return null;
	const effectif = niveauEffectif(e.niveau, propre);
	const pourLaSession = effectif !== e.niveau;
	if (effectif === 'coupes') return { motif: 'coupes', pourLaSession };
	const utile = effectif === 'complets' ? e.reranker : e.sens;
	if (utile === 'absent') return { motif: 'absents' };
	if (utile === 'arrete') return { motif: 'arretes' };
	if (effectif === 'sens') return { motif: 'sens', pourLaSession };
	return null;
}
