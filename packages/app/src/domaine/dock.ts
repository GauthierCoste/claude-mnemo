/** Pastille de l'icône du Dock : le nombre de sessions qui attendent une réponse. */
import type { SessionVue } from '@mnemo/contrat';
import { attendReponse } from './sessions.ts';

/** Texte de la pastille : le nombre de sessions qui attendent une réponse ; vide (pas de pastille) à 0. */
export function pastilleDock(sessions: readonly SessionVue[]): string {
	const n = sessions.filter(attendReponse).length;
	return n === 0 ? '' : String(n);
}
