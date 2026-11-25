/**
 * L'étape du calcul affichée dans le bouton des modèles d'une session, sans clignotement : une étape n'apparaît que si elle
 * dure plus de `APPARITION_MS` ; une fois affichée, elle reste au moins `MINIMUM_MS` ; la progression d'une étape affichée
 * (« affinage 10/30… ») suit aussitôt. La fin (null) n'efface l'étape qu'après son minimum, et pas si une autre arrive avant.
 */
import type { EtapeCalcul } from '@mnemo/commun';

export const APPARITION_MS = 150;
export const MINIMUM_MS = 400;

type Minuteur = ReturnType<typeof setTimeout>;

export class AffichageEtape {
	private affichee: EtapeCalcul | null = null;
	private depuisMs = 0;
	private attente: Minuteur | null = null;
	/** L'étape qui attend son délai d'apparition (null : aucune, ou la fin qui attend le minimum). */
	private enAttente: EtapeCalcul | null = null;

	private readonly surChangement: (etape: EtapeCalcul | null) => void;
	private readonly maintenant: () => number;

	constructor(surChangement: (etape: EtapeCalcul | null) => void, maintenant: () => number = () => Date.now()) {
		this.surChangement = surChangement;
		this.maintenant = maintenant;
	}

	recevoir(etape: EtapeCalcul | null): void {
		// la même étape qui attend encore son apparition, qui avance : son délai continue
		if (etape !== null && this.enAttente !== null && this.enAttente.nom === etape.nom) {
			this.enAttente = etape;
			return;
		}
		this.annuler();
		if (etape === null) {
			if (this.affichee === null) return;
			this.attente = setTimeout(() => this.montrer(null), Math.max(0, this.depuisMs + MINIMUM_MS - this.maintenant()));
			return;
		}
		// la même étape qui avance : sa progression suit aussitôt
		if (this.affichee !== null && this.affichee.nom === etape.nom) {
			this.affichee = etape;
			this.surChangement(etape);
			return;
		}
		// une autre étape : affichée si elle dure, et pas avant le minimum de celle qui l'est
		const delai = this.affichee === null ? APPARITION_MS : Math.max(APPARITION_MS, this.depuisMs + MINIMUM_MS - this.maintenant());
		this.enAttente = etape;
		this.attente = setTimeout(() => this.montrer(this.enAttente), delai);
	}

	arreter(): void {
		this.annuler();
	}

	private montrer(etape: EtapeCalcul | null): void {
		this.attente = null;
		this.enAttente = null;
		this.affichee = etape;
		this.depuisMs = this.maintenant();
		this.surChangement(etape);
	}

	private annuler(): void {
		if (this.attente !== null) clearTimeout(this.attente);
		this.attente = null;
		this.enAttente = null;
	}
}
