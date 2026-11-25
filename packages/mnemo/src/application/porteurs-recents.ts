import type { VecteurDuMessage, VecteurDuPorteur } from './ports.ts';

/** Le dernier message porteur d'une session, vu par le service : son rang, la position de la session, son vecteur s'il a été calculé. */
export type PorteurRecent = { rang: number; position: string; vecteur: VecteurDuMessage | null };

/**
 * Dernier message porteur de chaque session, gardé en mémoire par le service (jamais écrit) : les gestes faits depuis
 * l'interface (✗, rétablir) ou la lecture d'une carte en reprennent le vecteur, sans le recalculer.
 */
export type PorteursRecents = {
	noter(session: string, porteur: PorteurRecent): void;
	lire(session: string): PorteurRecent | null;
};

/** Sessions gardées au plus : au-delà, les moins récemment notées sont oubliées. */
export const PORTEURS_GARDES = 100;

export function porteursRecents(): PorteursRecents {
	const parSession = new Map<string, PorteurRecent>();
	return {
		noter(session, porteur) {
			parSession.delete(session);
			parSession.set(session, porteur);
			while (parSession.size > PORTEURS_GARDES) parSession.delete(parSession.keys().next().value!);
		},
		lire: (session) => parSession.get(session) ?? null,
	};
}

/** Le vecteur du dernier message porteur, à joindre à un geste (gardé seulement si le geste porte ce message). */
export function vecteurDuPorteur(porteur: PorteurRecent | null): VecteurDuPorteur | null {
	return porteur === null || porteur.vecteur === null ? null : { rang: porteur.rang, vecteur: porteur.vecteur };
}
