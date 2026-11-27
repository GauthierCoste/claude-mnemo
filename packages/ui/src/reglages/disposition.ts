/**
 * Disposition des réglages (route `reglages`, `ReglagesVue`) dans l'onglet Réglages : quelle carte, quel groupe, quel libellé
 * court (l'explication du service passe en infobulle) et quelle forme pour chaque champ. Mémoire : cartes Rappel (ce qui est
 * injecté dans les sessions, et le réapprentissage de la note de confiance), Recherche (l'outil chercher et la recherche de l'interface) et Confiance ;
 * Système : une carte (service, modèles locaux, couleur et langue). Libellés dans la langue de l'interface. Un champ que cette disposition ne connaît pas va dans « Réglages fins » de Rappel, sous son libellé du
 * service : rien de ce que le service rend n'est caché.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import { TEXTES, type Textes } from '../langue/textes.ts';

/**
 * Forme d'un champ : `curseur` (libellé, valeur à droite, phrase d'effet), `barre` (compacte, sur une ligne), `nombre`,
 * `choix` (liste déroulante), `interrupteur` (oui ou non), `interrupteurs` (un par choix ; `inverse` : allumé = choix absent de
 * la valeur), `puces`, `couleur`.
 */
export type FormeChamp = 'curseur' | 'barre' | 'nombre' | 'choix' | 'interrupteur' | 'interrupteurs' | 'puces' | 'couleur';

export type ChampDispose = {
	cle: string;
	libelle: string;
	forme: FormeChamp;
	/** Petite ligne sous le libellé (lignes à interrupteur ou à liste). */
	aide?: string;
	/** `interrupteurs` : allumé quand le choix n'est pas dans la valeur. */
	inverse?: boolean;
	/** Valeur montrée, quand l'unité du service ne convient pas (« 2× »). */
	format?(valeur: number): string;
};

/** `repli` : groupe replié sous « titre · N » ; `etatService` : la ligne d'état du service en tête. */
export type GroupeDispose = { titre: string | null; champs: readonly ChampDispose[]; repli?: boolean; etatService?: boolean };

export type CarteDisposee = { cle: string; titre: string; sous: string; groupes: readonly GroupeDispose[] };

/**
 * Les cartes de Mémoire (Rappel, Recherche, Confiance) et de Système, dans la langue de `t`.
 * Rappel : la note de confiance décide des injections et des pistes ; son réapprentissage en fond (`entrainement.automatique`).
 * Les marqueurs de projet ne servent qu'au lancement d'une session : ◆ sur les dossiers-projets de l'arbre où l'on choisit
 * son dossier. Recherche : les réglages qui ne jouent que sur la recherche (`application/chercher.ts`), l'outil chercher et
 * la recherche de l'interface.
 */
export function cartesReglages(t: Textes): { memoire: readonly CarteDisposee[]; systeme: readonly CarteDisposee[] } {
	const d = t.reglages.disposition;
	const k = t.reglages.cartes;
	const barre = (cle: keyof typeof d): ChampDispose => ({ cle, libelle: d[cle], forme: 'barre' });
	const rappel: CarteDisposee = {
		cle: 'rappel',
		titre: k.rappel.titre,
		sous: k.rappel.sous,
		groupes: [
			{
				titre: null,
				champs: [
					{ cle: 'contexte.seuilInjection', libelle: d['contexte.seuilInjection'], forme: 'curseur' },
					{ cle: 'contexte.injectionsParMessage', libelle: d['contexte.injectionsParMessage'], forme: 'curseur' },
					{ cle: 'contexte.seuilPiste', libelle: d['contexte.seuilPiste'], forme: 'curseur' },
					{ cle: 'contexte.pistesParMessage', libelle: d['contexte.pistesParMessage'], forme: 'curseur' },
				],
			},
			{
				titre: k.rappel.note,
				champs: [{ cle: 'entrainement.automatique', libelle: d['entrainement.automatique'], aide: d['entrainement.automatique.aide'], forme: 'interrupteur' }],
			},
			{ titre: k.rappel.projet, champs: [{ cle: 'projets.marqueurs', libelle: d['projets.marqueurs'], forme: 'puces' }] },
			{
				titre: k.rappel.fins,
				repli: true,
				champs: [barre('contexte.similariteRecherche'), barre('contexte.poidsInjection'), barre('contexte.demiVieInjection'), barre('contexte.cartesNommees')],
			},
		],
	};
	const recherche: CarteDisposee = {
		cle: 'recherche',
		titre: k.recherche.titre,
		sous: k.recherche.sous,
		groupes: [
			{
				titre: k.recherche.devant,
				champs: [barre('recherche.poidsPosition'), barre('recherche.poidsConfiance'), barre('recherche.poidsMemoire'), barre('recherche.poidsFraicheur')],
			},
			{
				titre: k.recherche.fins,
				repli: true,
				champs: [barre('recherche.resultats'), barre('memoire.seuilRappel'), barre('recherche.chronologie'), barre('recherche.graphe'), barre('recherche.reranker')],
			},
		],
	};
	const confiance: CarteDisposee = {
		cle: 'confiance',
		titre: k.confiance.titre,
		sous: k.confiance.sous,
		groupes: [
			{
				titre: k.confiance.fiabilite,
				champs: [
					barre('memoire.fiabilite_utilisateur'),
					barre('memoire.fiabilite_contrat'),
					barre('memoire.fiabilite_spec_validee'),
					barre('memoire.fiabilite_compte_rendu'),
					barre('memoire.fiabilite_email'),
					barre('memoire.fiabilite_note'),
					barre('memoire.fiabilite_session'),
					barre('memoire.fiabilite_deduction'),
					barre('memoire.fiabilite_inconnue'),
				],
			},
			{
				titre: k.confiance.fait,
				champs: [
					barre('memoire.poids_declare'),
					barre('memoire.poids_observe'),
					barre('memoire.poids_infere'),
					{ cle: 'memoire.repetitions', libelle: d['memoire.repetitions'], forme: 'curseur', format: (n) => `${n}×` },
				],
			},
			{ titre: k.confiance.archiviste, champs: [{ cle: 'archiviste.typesAConfirmer', libelle: d['archiviste.typesAConfirmer'], forme: 'interrupteurs', inverse: true }] },
		],
	};
	const systeme: CarteDisposee = {
		cle: 'systeme',
		titre: k.systeme.titre,
		sous: k.systeme.sous,
		groupes: [
			{
				titre: k.systeme.service,
				etatService: true,
				champs: [
					{ cle: 'service.navigateur', libelle: d['service.navigateur'], aide: d['service.navigateur.aide'], forme: 'choix' },
					{ cle: 'service.port', libelle: d['service.port'], aide: d['service.port.aide'], forme: 'nombre' },
				],
			},
			{ titre: k.systeme.modeles, champs: [{ cle: 'modeles.inactiviteMinutes', libelle: d['modeles.inactiviteMinutes'], forme: 'curseur' }] },
			{
				titre: k.systeme.interface,
				champs: [
					{ cle: 'interface.accent', libelle: d['interface.accent'], forme: 'couleur' },
					{ cle: 'interface.langue', libelle: d['interface.langue'], forme: 'choix' },
				],
			},
		],
	};
	return { memoire: [rappel, recherche, confiance], systeme: [systeme] };
}

/**
 * Les cartes de chaque section de l'onglet Réglages (Branchements n'a pas de réglage de `ReglagesVue`), en français, la
 * langue de référence : leurs clés disent où se règle chaque champ.
 */
export const CARTES_REGLAGES = cartesReglages(TEXTES.fr);

const clesDe = (cartes: readonly CarteDisposee[]): Set<string> => new Set(cartes.flatMap((c) => c.groupes.flatMap((g) => g.champs.map((x) => x.cle))));
const CLES_DISPOSEES = clesDe([...CARTES_REGLAGES.memoire, ...CARTES_REGLAGES.systeme]);
const CLES_SYSTEME = clesDe(CARTES_REGLAGES.systeme);

/** Section où se règle un champ : Système pour les siens, Mémoire pour tous les autres (non disposés compris). */
export const sectionDuChamp = (cle: string): 'memoire' | 'systeme' => (CLES_SYSTEME.has(cle) ? 'systeme' : 'memoire');

const FORME_PAR_GENRE: Readonly<Record<ChampReglageVue['genre'], FormeChamp>> = {
	entier: 'barre',
	decimal: 'barre',
	liste: 'puces',
	choix: 'choix',
	'choix-multiple': 'interrupteurs',
	couleur: 'couleur',
	booleen: 'interrupteur',
};

/** Les champs du service que la disposition ne connaît pas, sous leur libellé du service, dans une forme selon leur genre. */
export function champsNonDisposes(champs: readonly ChampReglageVue[]): ChampDispose[] {
	return champs.filter((c) => !CLES_DISPOSEES.has(c.cle)).map((c) => ({ cle: c.cle, libelle: c.libelle, forme: FORME_PAR_GENRE[c.genre] }));
}
