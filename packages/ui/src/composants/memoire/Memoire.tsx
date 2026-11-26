/**
 * Vue Mémoire : barre d'onglets (Archiviste (N) | Fichiers | Graph 3D | Entraîner, avec la pastille des messages à relire)
 * et statistiques. Entraîner (`Entrainer`) : la note de confiance et son entraînement.
 * Archiviste (ouvert par défaut) : à faire, terminal de l'archiviste, enrichir (`PageArchiviste`). Fichiers (`#mFiles`) :
 * arbre | fiche | liens (arbre et liens redimensionnables, largeur gardée) ; ⌥L y localise la fiche ouverte dans l'arbre.
 * Le graphe (three.js, morceau à part) se charge à la première ouverture de son onglet, puis reste monté : positions et
 * épingles survivent aux allers-retours. Une seule lecture du graphe (`useGraphe`) sert l'arbre, le graphe et les
 * statistiques.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useEntrainement, useFiche, useGraphe } from '../../client/hooks.ts';
import type { FicheGraphe } from '@mnemo/contrat';
import { useAFaire } from '../../memoire/a-faire.ts';
import { couleurDeBranche, rangsDesFiches } from '../../graphe/branches.ts';
import { useNavigation, useSurAction, type OngletMemoire } from '../../navigation.tsx';
import { projetDeFiche } from '../../palette/resultats.ts';
import { titreFiche } from '../../sessions/servis.ts';
import { PageArchiviste } from '../archiviste/PageArchiviste.tsx';
import { useOuvrirSession } from '../sessions/ouvrir-session.ts';
import { cx } from '../commun/classes.ts';
import { Separateur } from '../commun/Separateur.tsx';
import { largeurMaxPanneau, useTailleGardee } from '../commun/taille-gardee.ts';
import { ArbreFiches } from './ArbreFiches.tsx';
import { Entrainer } from './entrainer/Entrainer.tsx';
import { LiensFiche } from './LiensFiche.tsx';
import s from './Memoire.module.css';
import { FournisseurMemoire, useNavigationMemoire } from './navigation-memoire.tsx';
import { StatistiquesMemoire } from './StatistiquesMemoire.tsx';
import { VueFiche } from './VueFiche.tsx';

/** Largeurs des panneaux de Fichiers, réglées par leur séparateur et gardées dans ce navigateur. */
const LARGEUR_ARBRE = { cle: 'mnemo.memoire.largeurArbre', defaut: 260, min: 180 };
const LARGEUR_LIENS = { cle: 'mnemo.memoire.largeurLiens', defaut: 280, min: 200 };

const Graphe3D = lazy(() => import('./graphe/Graphe3D.tsx').then((m) => ({ default: m.Graphe3D })));

/** `ficheInitiale` / `editionInitiale` : mode démo (`&fiche=…&edition=1`), pour les captures d'écran. */
export function Memoire(p: { visible: boolean; ficheInitiale?: string; editionInitiale?: boolean }): ReactNode {
	return (
		<FournisseurMemoire {...(p.ficheInitiale ? { ficheInitiale: p.ficheInitiale } : {})}>
			<CorpsMemoire visible={p.visible} editionInitiale={p.editionInitiale ?? false} />
		</FournisseurMemoire>
	);
}

function CorpsMemoire(p: { visible: boolean; editionInitiale: boolean }): ReactNode {
	const nav = useNavigation();
	const memoire = useNavigationMemoire();
	const graphe = useGraphe();
	const aFaire = useAFaire();
	const aRelire = useEntrainement().donnees?.banc.aRelire ?? 0;
	const largeurMax = largeurMaxPanneau(LARGEUR_LIENS.min);
	const largeurArbre = useTailleGardee(LARGEUR_ARBRE, largeurMax);
	const largeurLiens = useTailleGardee(LARGEUR_LIENS, largeurMax);
	const [grapheVisite, setGrapheVisite] = useState(memoire.onglet === 'graphe');
	if (memoire.onglet === 'graphe' && !grapheVisite) setGrapheVisite(true);
	// Fiche demandée depuis une autre vue (Sessions : fiche servie) : ouverte dans Fichiers.
	const demande = nav.ficheDemandee;
	const { ouvrirFiche } = memoire;
	useEffect(() => {
		if (demande) ouvrirFiche(demande.chemin);
	}, [demande, ouvrirFiche]);
	// le projet de la fiche ouverte dans Fichiers est « au premier plan » (filtre « Ce projet » de la palette)
	const ficheOuverte = useFiche(memoire.onglet === 'fichiers' ? memoire.fiche : null, false);
	const projet = memoire.onglet === 'fichiers' && memoire.fiche !== null ? projetDeFiche(ficheOuverte.donnees) : null;
	const nomProjet = projet?.projet ?? null;
	const positionProjet = projet?.position ?? '';
	const { definirProjetPremierPlan } = nav;
	useEffect(() => {
		if (p.visible) definirProjetPremierPlan(nomProjet === null ? null : { projet: nomProjet, position: positionProjet });
	}, [p.visible, nomProjet, positionProjet, definirProjetPremierPlan]);

	// ⌥L (vue Mémoire affichée) : retour à Fichiers, la fiche ouverte localisée dans l'arbre.
	const [localisation, setLocalisation] = useState(0);
	useSurAction((a) => {
		if (a.genre !== 'localiser' || !p.visible || memoire.fiche === null) return;
		memoire.choisirOnglet('fichiers');
		setLocalisation((n) => n + 1);
	});

	// L'édition demandée au départ ne vaut que pour la fiche de départ.
	const [ficheEditee, setFicheEditee] = useState(p.editionInitiale ? memoire.fiche : null);
	if (ficheEditee !== null && memoire.fiche !== ficheEditee) setFicheEditee(null);
	const onglet = (o: OngletMemoire, libelle: string, pastille?: ReactNode) => (
		<button
			type="button"
			role="tab"
			id={`onglet-memoire-${o}`}
			aria-selected={memoire.onglet === o}
			aria-controls={`panneau-memoire-${o}`}
			className={cx(s.onglet, memoire.onglet === o && s.on)}
			onClick={() => memoire.choisirOnglet(o)}
		>
			{libelle}
			{pastille}
		</button>
	);

	// la poignée est à gauche du panneau des liens : aller vers la gauche l'élargit
	const poigneeLiens = (
		<Separateur
			bord
			orientation="vertical"
			label="Largeur du panneau Liens"
			valeur={largeurLiens.valeur}
			min={LARGEUR_LIENS.min}
			max={largeurMax}
			sens={-1}
			surChanger={largeurLiens.regler}
			surDefaut={largeurLiens.reinitialiser}
		/>
	);

	return (
		<section className={s.memoire} hidden={!p.visible}>
			<div className={s.barre}>
				<div role="tablist" aria-label="Mémoire" className={s.onglets}>
					{onglet('archiviste', `Archiviste (${aFaire.total})`)}
					{onglet('fichiers', 'Fichiers')}
					{onglet('graphe', 'Graph 3D')}
					{onglet(
						'entrainer',
						'Entraîner',
						aRelire > 0 && (
							<span className={s.pastille} title={`${aRelire} message${aRelire > 1 ? 's' : ''} à relire`}>
								<span aria-hidden="true">{aRelire}</span>
								<span className={s.horsEcran}>{` (${aRelire} à relire)`}</span>
							</span>
						),
					)}
				</div>
				<span className={s.espace} />
				<StatistiquesMemoire donnees={graphe.donnees} className={s.statistiques} />
			</div>
			<div role="tabpanel" id="panneau-memoire-archiviste" aria-labelledby="onglet-memoire-archiviste" className={s.panneau} hidden={memoire.onglet !== 'archiviste'}>
				<PageArchiviste visible={p.visible && memoire.onglet === 'archiviste'} aFaire={aFaire} />
			</div>
			<div role="tabpanel" id="panneau-memoire-fichiers" aria-labelledby="onglet-memoire-fichiers" className={s.panneau} hidden={memoire.onglet !== 'fichiers'}>
				<div className={s.fichiers} style={{ '--l-arbre': `${largeurArbre.valeur}px`, '--l-liens': `${largeurLiens.valeur}px` } as CSSProperties}>
					<div className={s.arbre}>
						<ArbreFiches fiches={graphe.donnees?.fiches} erreur={graphe.erreur} courante={memoire.fiche} ouvrir={memoire.ouvrirFiche} localisation={localisation} />
					</div>
					<Separateur
						bord
						orientation="vertical"
						label="Largeur du panneau Arbre"
						valeur={largeurArbre.valeur}
						min={LARGEUR_ARBRE.min}
						max={largeurMax}
						sens={1}
						surChanger={largeurArbre.regler}
						surDefaut={largeurArbre.reinitialiser}
					/>
					{memoire.fiche ? (
						<FicheOuverte key={memoire.fiche} chemin={memoire.fiche} fiches={graphe.donnees?.fiches} editionInitiale={memoire.fiche === ficheEditee} poigneeLiens={poigneeLiens} />
					) : (
						<>
							<p className={s.vide}>Choisir une fiche dans l'arbre.</p>
							{poigneeLiens}
							<aside className={s.liensVides} aria-label="Liens de la fiche" />
						</>
					)}
				</div>
			</div>
			<div role="tabpanel" id="panneau-memoire-entrainer" aria-labelledby="onglet-memoire-entrainer" className={s.panneau} hidden={memoire.onglet !== 'entrainer'}>
				{memoire.onglet === 'entrainer' && <Entrainer />}
			</div>
			{grapheVisite && (
				<div role="tabpanel" id="panneau-memoire-graphe" aria-labelledby="onglet-memoire-graphe" className={s.panneau} hidden={memoire.onglet !== 'graphe'}>
					<Suspense fallback={<p className={s.vide}>Chargement du graphe…</p>}>
						<Graphe3D visible={p.visible && memoire.onglet === 'graphe'} />
					</Suspense>
				</div>
			)}
		</section>
	);
}

/** Fiche ouverte : une seule lecture (`useFiche`) pour la fiche (colonne du milieu) et ses liens (colonne de droite). */
function FicheOuverte(p: { chemin: string; fiches: FicheGraphe[] | undefined; editionInitiale: boolean; poigneeLiens: ReactNode }): ReactNode {
	const ouvrirSession = useOuvrirSession();
	const memoire = useNavigationMemoire();
	const fiche = useFiche(p.chemin, false);
	// « Tout voir » des sessions : une lecture à part, sans toucher à celle de la fiche (édition en cours comprise)
	const [toutesLesSessions, setToutesLesSessions] = useState(false);
	const toutes = useFiche(toutesLesSessions ? p.chemin : null, true);
	const rangs = useMemo(() => rangsDesFiches((p.fiches ?? []).map((f) => f.chemin)), [p.fiches]);
	const couleur = useCallback((chemin: string) => couleurDeBranche(rangs, chemin), [rangs]);
	const titres = useMemo(() => new Map((p.fiches ?? []).map((f) => [f.chemin, f.titre])), [p.fiches]);
	const titre = useCallback((chemin: string) => titres.get(chemin) ?? titreFiche(chemin), [titres]);
	return (
		<>
			<VueFiche chemin={p.chemin} fiche={fiche} editionInitiale={p.editionInitiale} />
			{p.poigneeLiens}
			<LiensFiche
				fiche={fiche.donnees}
				sessions={toutes.donnees?.sessions ?? fiche.donnees?.sessions ?? []}
				couleur={couleur}
				titre={titre}
				ouvrir={memoire.ouvrirFiche}
				ouvrirSession={ouvrirSession}
				surToutVoir={() => setToutesLesSessions(true)}
			/>
		</>
	);
}
