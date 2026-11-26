/**
 * Vue Sessions : barre des états, panneau Dossier, grille des sessions (une ligne par dossier), panneau Contexte, le
 * dialogue « Nouvelle session » et le tiroir des sessions terminées. Tient l'état de la vue : session choisie (celle qui a
 * le focus), zoom, lignes repliées, poids des séparateurs, pliage du panneau Dossier (gardés pendant la visite,
 * même panneau masqué). Raccourcis : ⌥n zoome la n-ième session affichée (bascule), ⌥0 et Échap dézooment (Échap ferme
 * d'abord le tiroir des terminées), ⌥M ouvre la première fiche servie ; après un zoom, le terminal zoomé prend le focus
 * quand l'animation est finie, et ⌥n, ⌥0 comme Échap y vont alors à `claude` : ils n'agissent plus qu'hors du terminal.
 */
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { ROUTES, type SessionVue } from '@mnemo/contrat';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { avecId, useHistorique, useNomRacine, useSante, useServis, useSessions } from '../../client/hooks.ts';
import { useNavigation, useSurAction } from '../../navigation.tsx';
import { PLIAGE_INITIAL, type Pliage } from '../../dossiers/arbre.ts';
import { disposerGrille } from '../../sessions/grille.ts';
import { grouperSessions } from '../../sessions/groupes.ts';
import { fichesServies } from '../../sessions/servis.ts';
import { useToast } from '../Toast.tsx';
import { BarreEtats } from './BarreEtats.tsx';
import { GrilleSessions, type GenrePoids } from './GrilleSessions.tsx';
import { NouvelleSession } from './NouvelleSession.tsx';
import { Separateur } from '../commun/Separateur.tsx';
import { largeurMaxPanneau, useTailleGardee } from '../commun/taille-gardee.ts';
import { PanneauContexte } from './PanneauContexte.tsx';
import { PanneauDossier } from './PanneauDossier.tsx';
import s from './Sessions.module.css';
import { Terminees } from './Terminees.tsx';

/** Durée des transitions de la grille (340 ms) et un peu de marge. */
export const APRES_ANIMATION_MS = 360;
const RAFRAICHIR_DUREES_MS = 30_000;

function useMaintenant(): number {
	const [maintenant, setMaintenant] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setMaintenant(Date.now()), RAFRAICHIR_DUREES_MS);
		return () => clearInterval(t);
	}, []);
	return maintenant;
}

const sansCle = (ensemble: ReadonlySet<string>, cle: string): ReadonlySet<string> => {
	if (!ensemble.has(cle)) return ensemble;
	const suivant = new Set(ensemble);
	suivant.delete(cle);
	return suivant;
};

/** Largeurs des panneaux latéraux, réglées par leur séparateur et gardées dans ce navigateur. */
const LARGEUR_DOSSIER = { cle: 'mnemo.sessions.largeurDossier', defaut: 252, min: 180 };
const LARGEUR_CONTEXTE = { cle: 'mnemo.sessions.largeurContexte', defaut: 280, min: 220 };

export function Sessions(p: { visible: boolean; /** Mode démo : rang de la session ouverte en grand au départ. */ zoomInitial?: number }): ReactNode {
	const { api } = useClient();
	const nav = useNavigation();
	const toast = useToast();
	const sessions = useSessions();
	const sante = useSante();
	const maintenant = useMaintenant();
	const largeurMax = largeurMaxPanneau(LARGEUR_CONTEXTE.min);
	const largeurDossier = useTailleGardee(LARGEUR_DOSSIER, largeurMax);
	const largeurContexte = useTailleGardee(LARGEUR_CONTEXTE, largeurMax);
	const racine = sante.donnees?.racine ?? '';
	const nomRacine = useNomRacine();

	const groupes = useMemo(() => grouperSessions(sessions, nomRacine), [sessions, nomRacine]);
	const ordre = useMemo(() => groupes.flatMap((g) => g.sessions), [groupes]);
	const rangs = useMemo(() => new Map(ordre.map((x, i) => [x.id, i + 1])), [ordre]);

	const [choisie, setChoisie] = useState<string | null>(null);
	const [zoomDemande, setZoom] = useState<string | null>(null);
	const [replies, setReplies] = useState<ReadonlySet<string>>(() => new Set());
	const [poidsLignes, setPoidsLignes] = useState<Record<string, number>>({});
	const [poidsCellules, setPoidsCellules] = useState<Record<string, number>>({});
	const [dossierVisible, setDossierVisible] = useState(true);
	const [contexteVisible, setContexteVisible] = useState(true);
	const [eclair, setEclair] = useState<{ cle: string; numero: number } | null>(null);
	const [nouvelle, setNouvelle] = useState<{ dossier: string | null } | null>(null);
	const [pliageDossiers, setPliageDossiers] = useState<Pliage>(PLIAGE_INITIAL);
	const historique = useHistorique();
	const [termineesOuvertes, setTermineesOuvertes] = useState(false);
	// Un seul tiroir à la fois : l'archiviste ouvert ferme les terminées (et « N terminées » ferme l'archiviste).
	useEffect(() => {
		if (nav.tiroirOuvert) setTermineesOuvertes(false);
	}, [nav.tiroirOuvert]);

	const selection = ordre.find((x) => x.id === choisie) ?? ordre[0] ?? null;
	// le projet de la session choisie est « au premier plan » (filtre « Ce projet » de la palette)
	const { definirProjetPremierPlan } = nav;
	const projetChoisi = selection && selection.position !== '' ? selection.projet : null;
	const positionChoisie = selection?.position ?? '';
	useEffect(() => {
		if (p.visible) definirProjetPremierPlan(projetChoisi === null ? null : { projet: projetChoisi, position: positionChoisie });
	}, [p.visible, projetChoisi, positionChoisie, definirProjetPremierPlan]);
	const { definirSessionPremierPlan } = nav;
	const idChoisi = selection?.id ?? null;
	useEffect(() => {
		definirSessionPremierPlan(p.visible ? idChoisi : null);
	}, [p.visible, idChoisi, definirSessionPremierPlan]);
	const zoom = zoomDemande !== null && rangs.has(zoomDemande) ? zoomDemande : null;
	const zoomCourant = useRef(zoom);
	zoomCourant.current = zoom;

	const servis = useServis(selection?.id ?? null);
	const fiches = useMemo(() => fichesServies(servis.donnees ?? []), [servis.donnees]);

	const disposition = useMemo(
		() => disposerGrille({ groupes: groupes.map((g) => ({ cle: g.cle, sessions: g.sessions.map((x) => x.id) })), zoom, replies, poidsLignes, poidsCellules }),
		[groupes, zoom, replies, poidsLignes, poidsCellules],
	);

	// `settle` : l'animation finie, le terminal zoomé prend le focus.
	const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
	const racineVue = useRef<HTMLElement>(null);
	const apresAnimation = useCallback((id: string) => {
		if (minuteur.current) clearTimeout(minuteur.current);
		minuteur.current = setTimeout(() => {
			minuteur.current = null;
			if (zoomCourant.current !== id) return;
			const carte = [...(racineVue.current?.querySelectorAll<HTMLElement>('[data-session]') ?? [])].find((x) => x.dataset['session'] === id);
			carte?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus({ preventScroll: true });
		}, APRES_ANIMATION_MS);
	}, []);
	useEffect(
		() => () => {
			if (minuteur.current) clearTimeout(minuteur.current);
		},
		[],
	);

	const dossierDe = (id: string) => ordre.find((x) => x.id === id)?.dossier ?? null;

	const zoomer = (id: string) => {
		const suivant = zoomCourant.current === id ? null : id;
		zoomCourant.current = suivant;
		setZoom(suivant);
		setChoisie(id);
		const d = dossierDe(id);
		if (d !== null) setReplies((r) => sansCle(r, d));
		if (suivant) apresAnimation(id);
	};
	const dezoomer = () => {
		zoomCourant.current = null;
		setZoom(null);
	};
	/** Pastille d'une ligne repliée : la session est choisie, et zoomée si la grille l'est. */
	const allerA = (id: string) => {
		const d = dossierDe(id);
		if (d !== null) setReplies((r) => sansCle(r, d));
		setChoisie(id);
		if (zoomCourant.current) {
			zoomCourant.current = id;
			setZoom(id);
			apresAnimation(id);
		}
	};
	const choisirDossier = (cle: string) => {
		const premiere = groupes.find((g) => g.cle === cle)?.sessions[0];
		if (!premiere) return;
		allerA(premiere.id);
		setEclair((e) => ({ cle, numero: (e?.numero ?? 0) + 1 }));
	};
	const reprendre = async (id: string) => {
		try {
			const r = await api.envoyer<{ session?: SessionVue } | null>(avecId(ROUTES.reprise, id), undefined);
			if (r?.session && !r.session.terminal) toast('La session tourne ailleurs, ou les terminaux sont indisponibles.');
		} catch (e) {
			toast(e instanceof ErreurApi ? e.message : 'Reprise impossible.');
		}
	};
	const basculerLigne = (cle: string) =>
		setReplies((r) => {
			const suivant = new Set(r);
			if (suivant.has(cle)) suivant.delete(cle);
			else suivant.add(cle);
			return suivant;
		});
	const memoriserPoids = useCallback((genre: GenrePoids, poids: Record<string, number>) => {
		(genre === 'lignes' ? setPoidsLignes : setPoidsCellules)((p) => ({ ...p, ...poids }));
	}, []);

	useSurAction((a) => {
		// Dialogue ouvert : la grille ne bouge pas derrière lui.
		if (nouvelle !== null && (a.genre === 'session' || a.genre === 'grille' || a.genre === 'echap')) return;
		if (a.genre === 'session') {
			const x = ordre[a.rang - 1];
			if (x) zoomer(x.id);
		} else if (a.genre === 'grille') dezoomer();
		else if (a.genre === 'echap') {
			if (!p.visible) return;
			if (termineesOuvertes) setTermineesOuvertes(false);
			else dezoomer();
		} else if (a.genre === 'fiche_servie') {
			if (p.visible && fiches[0]) nav.ouvrirFiche(fiches[0]);
		}
	});

	/** Session ouverte en grand (jamais la bascule de `zoomer`) : palette. */
	const zoomerSur = (id: string) => {
		if (zoomCourant.current === id) return;
		zoomer(id);
	};
	// Session demandée (`ouvrirSession`) : choisie comme par sa pastille, ou en grand (palette) ; terminée : sa ligne du tiroir.
	const allerACourant = useRef(allerA);
	allerACourant.current = allerA;
	const zoomerSurCourant = useRef(zoomerSur);
	zoomerSurCourant.current = zoomerSur;
	const sessionDemandee = nav.sessionDemandee;
	const { ouvrirTiroir } = nav;
	const [termineeDemandee, setTermineeDemandee] = useState<string | null>(null);
	useEffect(() => {
		if (!sessionDemandee) return;
		if (sessionDemandee.destination === 'terminees') {
			ouvrirTiroir(false);
			setTermineesOuvertes(true);
			setTermineeDemandee(sessionDemandee.id);
		} else if (sessionDemandee.zoom) zoomerSurCourant.current(sessionDemandee.id);
		else allerACourant.current(sessionDemandee.id);
	}, [sessionDemandee, ouvrirTiroir]);

	// Mode démo (`&zoom=n`) : la n-ième session ouverte en grand dès qu'elle existe.
	const zoomInitialFait = useRef(false);
	useEffect(() => {
		if (zoomInitialFait.current || !p.zoomInitial) return;
		const x = ordre[p.zoomInitial - 1];
		if (!x) return;
		zoomInitialFait.current = true;
		zoomCourant.current = x.id;
		setZoom(x.id);
		setChoisie(x.id);
		apresAnimation(x.id);
	}, [ordre, p.zoomInitial, apresAnimation]);

	return (
		<section ref={racineVue} className={s.sessions} hidden={!p.visible}>
			<BarreEtats
				sessions={ordre}
				terminees={historique.donnees?.length ?? 0}
				surTerminees={() => {
					nav.ouvrirTiroir(false);
					setTermineeDemandee(null);
					setTermineesOuvertes(true);
				}}
				dossier={dossierVisible}
				contexte={contexteVisible}
				surDossier={setDossierVisible}
				surContexte={setContexteVisible}
				surNouvelle={() => setNouvelle({ dossier: selection?.dossier ?? null })}
				agents={sessions}
				surAgent={(id, profil) => {
					if (profil === PROFIL_ARCHIVISTE) nav.ouvrirTiroir(true);
					else allerA(id);
				}}
			/>
			<div className={s.corps}>
				{dossierVisible && (
					<PanneauDossier
						largeur={largeurDossier.valeur}
						racine={racine}
						racineAbsolue={sante.donnees?.racineAbsolue ?? racine}
						dossierChoisi={selection?.dossier ?? null}
						pliage={pliageDossiers}
						surPliage={setPliageDossiers}
						surChoisirDossier={choisirDossier}
						surNouvelle={(d) => setNouvelle({ dossier: d })}
					/>
				)}
				{dossierVisible && (
					<Separateur
						bord
						orientation="vertical"
						label="Largeur du panneau Dossier"
						valeur={largeurDossier.valeur}
						min={LARGEUR_DOSSIER.min}
						max={largeurMax}
						sens={1}
						surChanger={largeurDossier.regler}
						surDefaut={largeurDossier.reinitialiser}
					/>
				)}
				{ordre.length > 0 ? (
					<GrilleSessions
						groupes={groupes}
						disposition={disposition}
						rangs={rangs}
						choisie={selection?.id ?? null}
						replies={replies}
						maintenant={maintenant}
						terminauxDisponibles={sante.donnees?.terminaux.ok ?? false}
						eclair={eclair}
						surChoisir={setChoisie}
						surZoom={zoomer}
						surReprendre={(id) => void reprendre(id)}
						surBasculerLigne={basculerLigne}
						surPastille={allerA}
						surNouvelle={(d) => setNouvelle({ dossier: d })}
						surPoids={memoriserPoids}
					/>
				) : (
					<div className={s.vide}>
						<p>Aucune session en cours.</p>
						<p className={s.mu}>« + Nouvelle session » en lance une dans un dossier.</p>
					</div>
				)}
				{contexteVisible && selection && (
					<Separateur
						bord
						orientation="vertical"
						label="Largeur du panneau Contexte"
						valeur={largeurContexte.valeur}
						min={LARGEUR_CONTEXTE.min}
						max={largeurMax}
						// la poignée est à gauche du panneau : aller vers la gauche l'élargit
						sens={-1}
						surChanger={largeurContexte.regler}
						surDefaut={largeurContexte.reinitialiser}
					/>
				)}
				{contexteVisible && selection && <PanneauContexte largeur={largeurContexte.valeur} session={selection} nomRacine={nomRacine} maintenant={maintenant} fiches={fiches} entrees={servis.donnees ?? []} lues={servis.lues} injections={servis.injections} surOuvrirFiche={nav.ouvrirFiche} />}
			</div>
			<Terminees
				ouvert={termineesOuvertes}
				historique={historique}
				nomRacine={nomRacine}
				demandee={termineeDemandee}
				surFermer={() => {
					setTermineesOuvertes(false);
					setTermineeDemandee(null);
				}}
			/>
			{nouvelle && <NouvelleSession dossierInitial={nouvelle.dossier} nomRacine={nomRacine} surFermer={() => setNouvelle(null)} surLancee={nav.ouvrirSession} />}
		</section>
	);
}
