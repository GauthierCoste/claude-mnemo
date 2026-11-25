/** Noms des moteurs (agents de code) dans l'interface, et ce qu'on montre du moteur et du modèle d'une session. */
import { estIdMoteur, MOTEUR_PAR_DEFAUT } from '@mnemo/commun';
import type { IdMoteur } from '@mnemo/commun';
import type { SessionVue } from '@mnemo/contrat';

export const NOMS_MOTEURS: Readonly<Record<IdMoteur, string>> = { 'claude-code': 'Claude Code', codex: 'Codex' };

/** Nom d'un moteur ; absent : Claude Code (session ou profil d'avant les moteurs) ; inconnu de l'interface : son identifiant. */
export const nomDuMoteur = (id: string | undefined): string => (id === undefined ? NOMS_MOTEURS[MOTEUR_PAR_DEFAUT] : estIdMoteur(id) ? NOMS_MOTEURS[id] : id);

/** « Codex · gpt-6.2-sol », « Claude Code · modèle par défaut ». */
export function moteurEtModele(s: Pick<SessionVue, 'moteur' | 'modele'>): string {
	return `${nomDuMoteur(s.moteur)} · ${s.modele === undefined || s.modele === '' ? 'modèle par défaut' : s.modele}`;
}

/**
 * Ce que les listes montrent du moteur d'une session : rien pour Claude Code avec son modèle par défaut (le cas courant, comme
 * le profil travail n'est pas répété), sinon le nom du moteur, et le modèle s'il est choisi.
 */
export function moteurParticulier(s: Pick<SessionVue, 'moteur' | 'modele'>): string | null {
	const defaut = (s.moteur ?? MOTEUR_PAR_DEFAUT) === MOTEUR_PAR_DEFAUT && (s.modele ?? '') === '';
	if (defaut) return null;
	return s.modele === undefined || s.modele === '' ? nomDuMoteur(s.moteur) : moteurEtModele(s);
}
