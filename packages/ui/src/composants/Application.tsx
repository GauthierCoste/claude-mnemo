import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { EtatConnexion } from '../client/connexion.ts';
import { FournisseurClient, useClient, type Client } from '../client/contexte.tsx';
import { useGraphe, useReglages, useSante, useSessions } from '../client/hooks.ts';
import { useAFaire } from '../memoire/a-faire.ts';
import { FournisseurNavigation, useNavigation, type OngletMemoire, type Vue } from '../navigation.tsx';
import { appliquerAccent } from '../reglages/accent.ts';
import { actionDuRaccourci, origineDeLaTouche } from '../raccourcis.ts';
import { destinationDeSession } from '../sessions/groupes.ts';
import s from './Application.module.css';
import { BandeauConnexion } from './BandeauConnexion.tsx';
import { BarreStatut } from './BarreStatut.tsx';
import { BarreTitre } from './BarreTitre.tsx';
import { TiroirArchiviste } from './archiviste/TiroirArchiviste.tsx';
import { EcranJeton } from './EcranJeton.tsx';
import { Memoire } from './memoire/Memoire.tsx';
import { Navigation } from './Navigation.tsx';
import { Palette } from './Palette.tsx';
import { Reglages } from './reglages/Reglages.tsx';
import { Sessions } from './sessions/Sessions.tsx';
import { useSessionDeLAdresse } from './sessions/session-de-l-adresse.ts';
import { FournisseurToast } from './Toast.tsx';

/**
 * Vue ouverte au départ (mode démo : `?demo&vue=graphe`), et onglet de la vue Mémoire ; `zoom` (`?demo&zoom=2`) ouvre la n-ième session en grand ;
 * `fiche` / `edition` (`?demo&fiche=…&edition=1`) ouvrent une fiche dans Mémoire › Fichiers, en édition ; `archiviste`
 * (`&archiviste=1`) ouvre le tiroir ; `palette` (`&palette=stocks`) ouvre la palette avec ce texte.
 */
export type Depart = { vue: Vue; ongletMemoire?: OngletMemoire; zoom?: number; fiche?: string; edition?: boolean; archiviste?: boolean; palette?: string };

/**
 * Racine de l'interface : sans client (jeton absent), l'écran du jeton ; sinon la coquille de l'interface. `session` : l'id
 * demandé par l'adresse au chargement (`#session=<id>`), ouvert dès qu'il est dans la liste des sessions.
 */
export function Application(p: { client: Client | null; depart?: Depart; session?: string | null }): ReactNode {
	if (!p.client) return <EcranJeton />;
	return (
		<FournisseurClient client={p.client}>
			<FournisseurNavigation
				{...(p.depart ? { vueInitiale: p.depart.vue } : {})}
				{...(p.depart?.ongletMemoire ? { ongletMemoireInitial: p.depart.ongletMemoire } : {})}
				{...(p.depart?.archiviste ? { tiroirInitial: true } : {})}
				{...(p.depart?.palette !== undefined ? { paletteInitiale: true } : {})}
			>
				<FournisseurToast>
					<Coquille depart={p.depart} session={p.session ?? null} />
				</FournisseurToast>
			</FournisseurNavigation>
		</FournisseurClient>
	);
}

function useEtatConnexion(): EtatConnexion {
	const { connexion } = useClient();
	return useSyncExternalStore(connexion.surEtat, connexion.etat, connexion.etat);
}

function useJetonRefuse(): boolean {
	const client = useClient();
	const [refuse, setRefuse] = useState(false);
	useEffect(() => client.surJetonRefuse(() => setRefuse(true)), [client]);
	return refuse;
}

/**
 * Raccourcis globaux : la navigation d'abord, puis l'action est diffusée aux vues. Échap hors terminal ferme la palette,
 * sinon réduit l'archiviste en grand, sinon ferme son tiroir, sinon va aux vues.
 */
function useRaccourcis(): void {
	const nav = useNavigation();
	useEffect(() => {
		const surTouche = (e: KeyboardEvent) => {
			const action = actionDuRaccourci(e, { origine: origineDeLaTouche(e.target) });
			if (!action) return;
			// ⌥L ne vaut que dans la vue Mémoire : ailleurs, la touche reste à qui l'attend
			if (action.genre === 'localiser' && nav.vue !== 'memoire') return;
			if (action.genre === 'echap') {
				if (nav.paletteOuverte) nav.ouvrirPalette(false);
				else if (nav.archivisteGrand) nav.agrandirArchiviste(false);
				else if (nav.tiroirOuvert) nav.ouvrirTiroir(false);
				else nav.diffuser(action);
				return;
			}
			e.preventDefault();
			if (action.genre === 'session' || action.genre === 'grille') {
				// l'archiviste en grand cacherait la grille : il revient dans son tiroir
				nav.aller('sessions');
				nav.agrandirArchiviste(false);
			} else if (action.genre === 'archiviste') nav.ouvrirTiroir();
			else if (action.genre === 'archiviste_grand') nav.agrandirArchiviste();
			else if (action.genre === 'palette') nav.ouvrirPalette();
			else if (action.genre === 'reglages') {
				nav.aller('reglages');
				nav.agrandirArchiviste(false);
			}
			nav.diffuser(action);
		};
		document.addEventListener('keydown', surTouche);
		return () => document.removeEventListener('keydown', surTouche);
	}, [nav]);
}

/** Pose la couleur principale du réglage `interface.accent` au chargement (le défaut tant que les réglages ne sont pas lus). */
function useAccent(): void {
	const accent = useReglages().donnees?.champs.find((c) => c.cle === 'interface.accent')?.valeur;
	useEffect(() => {
		if (accent !== undefined) appliquerAccent(document.documentElement, accent);
	}, [accent]);
}

function Coquille(p: { depart: Depart | undefined; session: string | null }): ReactNode {
	const depart = p.depart;
	const client = useClient();
	const nav = useNavigation();
	// La vue Mémoire reste montée après sa première ouverture : le graphe garde ses positions.
	const [memoireOuverte, setMemoireOuverte] = useState(nav.vue === 'memoire');
	if (nav.vue === 'memoire' && !memoireOuverte) setMemoireOuverte(true);
	const etat = useEtatConnexion();
	const refuse = useJetonRefuse();
	const sessions = useSessions();
	const sante = useSante();
	const graphe = useGraphe();
	const aFaire = useAFaire();
	// le champ de la barre de titre : la palette se pose dessus, son menu juste dessous
	const champPalette = useRef<HTMLButtonElement>(null);
	useRaccourcis();
	useAccent();
	useSessionDeLAdresse(p.session);

	if (refuse || etat === 'jeton_refuse') return <EcranJeton />;

	const attendent = sessions.filter((x) => x.etat === 'attend');
	const pastilles: Partial<Record<Vue, number>> = { sessions: attendent.filter((x) => destinationDeSession(x) === 'grille').length, memoire: aFaire.total };
	const archivisteAttend = attendent.some((x) => destinationDeSession(x) === 'archiviste' && x.dialogueOuvert);

	return (
		<div className={s.app}>
			<BarreTitre
				racine={sante.donnees?.racine ?? null}
				fictif={client.fictif}
				tiroirOuvert={nav.tiroirOuvert}
				archivisteAttend={archivisteAttend}
				champPalette={champPalette}
				surPalette={() => nav.ouvrirPalette()}
				surArchiviste={() => nav.ouvrirTiroir()}
			/>
			{etat === 'reconnexion' && <BandeauConnexion />}
			<div className={s.corps}>
				<Navigation vue={nav.vue} pastilles={pastilles} surChoix={nav.aller} />
				{/* Sessions reste montée (terminaux, zoom et poids gardés) ; Mémoire après sa première ouverture. */}
				<main className={s.vue} aria-label={TITRES[nav.vue]} data-vue={nav.vue}>
					<Sessions visible={nav.vue === 'sessions'} {...(depart?.zoom ? { zoomInitial: depart.zoom } : {})} />
					{memoireOuverte && (
						<Memoire
							visible={nav.vue === 'memoire'}
							{...(depart?.fiche ? { ficheInitiale: depart.fiche, editionInitiale: depart.edition ?? false } : {})}
						/>
					)}
					{/* Réglages : montée à chaque ouverture (relus du service), démontée en la quittant. */}
					{nav.vue === 'reglages' && <Reglages />}
				</main>
				<TiroirArchiviste />
			</div>
			<Palette ancre={champPalette} {...(depart?.palette ? { texteInitial: depart.palette } : {})} />
			<BarreStatut sante={sante.donnees} fiches={graphe.donnees?.fiches.length} connexion={etat} />
		</div>
	);
}

const TITRES: Record<Vue, string> = { sessions: 'Sessions', memoire: 'Mémoire', reglages: 'Réglages' };
