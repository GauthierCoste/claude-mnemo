import type { EtatModelesVue, MessageServeur } from '@mnemo/contrat';
import type { EtatModeles, Modeles } from '../../application/ports.ts';

/** Sondage de secours : l'état des modèles est relu au moins aussi souvent (les fichiers surveillés ne disent pas tout). */
export const SONDAGE_MODELES_MS = 1000;
/** Une rafale de changements (écriture d'un fichier, puis de son voisin) ne fait qu'une relecture, après ce délai. */
export const REGROUPEMENT_MODELES_MS = 50;

/** La vue de l'API : l'état des modèles tel quel (le contrat et l'application en ont la même forme). */
export const vueModeles = (e: EtatModeles): EtatModelesVue => e satisfies EtatModelesVue;

export type DiffusionModeles = {
	/** Relit l'état (regroupé avec les autres demandes), et le diffuse s'il a changé : après un geste de l'utilisateur. */
	relire(): void;
	/** Arrête la surveillance et le sondage. */
	fermer(): void;
};

/**
 * Diffuse l'état des modèles de la machine (`{ type: 'modeles' }`) aux clients WebSocket quand il change : relu sur un signe
 * de la surveillance de ses fichiers (`Modeles.surveiller`), et par un sondage de secours (`sondageMs`) ; les demandes d'une
 * rafale sont regroupées (`regroupementMs`), une seule lecture à la fois. Rien n'est diffusé si la vue est la même que la
 * dernière lue (comparaison de son JSON) ; la première lecture sert de référence, sans diffusion (un client reçoit l'état à
 * son arrivée) ; si elle échoue, la première qui réussit est diffusée.
 */
export function diffuserModeles(o: {
	modeles: Modeles;
	diffuser(m: MessageServeur): void;
	journal(message: string): void;
	sondageMs?: number;
	regroupementMs?: number;
	/** Appelé après chaque lecture réussie de l'état (changement vu, ou sondage) : ce que le service relit avec lui. */
	apresLecture?: () => void;
}): DiffusionModeles {
	let derniere: string | null = null;
	/** La première lecture réussie sert de référence, sans diffusion ; si elle échoue, la suivante qui réussit est diffusée. */
	let reference = true;
	let ferme = false;
	let enCours = false;
	let encore = false;
	let minuteur: ReturnType<typeof setTimeout> | null = null;
	let erreurSignalee = false;

	const lire = async (): Promise<void> => {
		if (enCours) {
			encore = true;
			return;
		}
		enCours = true;
		try {
			do {
				encore = false;
				let vue: EtatModelesVue;
				try {
					vue = vueModeles(await o.modeles.etat());
					erreurSignalee = false;
				} catch (erreur) {
					if (!erreurSignalee) o.journal(`état des modèles illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
					erreurSignalee = true;
					reference = false;
					return;
				}
				if (ferme) return;
				const texte = JSON.stringify(vue);
				if (!reference && texte !== derniere) o.diffuser({ type: 'modeles', modeles: vue });
				derniere = texte;
				reference = false;
				o.apresLecture?.();
			} while (encore && !ferme);
		} finally {
			enCours = false;
		}
	};

	const relire = (): void => {
		if (ferme || minuteur !== null) return;
		minuteur = setTimeout(() => {
			minuteur = null;
			void lire();
		}, o.regroupementMs ?? REGROUPEMENT_MODELES_MS);
		minuteur.unref();
	};

	void lire();
	const arreterSurveillance = o.modeles.surveiller(relire);
	const sondage = setInterval(relire, o.sondageMs ?? SONDAGE_MODELES_MS);
	sondage.unref();

	return {
		relire,
		fermer() {
			ferme = true;
			clearInterval(sondage);
			if (minuteur !== null) clearTimeout(minuteur);
			minuteur = null;
			arreterSurveillance();
		},
	};
}
