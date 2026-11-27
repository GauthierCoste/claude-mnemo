/**
 * Tiroir de l'archiviste (560 px réglables, glisse depuis la droite), réduit à l'essentiel : ouvert
 * par ⌥A ou le bouton « Archiviste » de la barre de titre ; fermé par ⌥A ou Échap hors terminal, ou « Fermer » (dans le
 * terminal, ⌥A et Échap vont à `claude`).
 * En-tête : état, « N à faire » (→ Mémoire › Archiviste, qui a tout le reste : à faire, suggestions, dépôt, ce qu'il a fait
 * pour les sessions), « Agrandir », « Fermer ». Contenu : l'activité minimale (changements de la mémoire du jour), repliée
 * par défaut, puis le terminal de la session de profil `archiviste` (ou « Lancer l'archiviste »), qui prend toute la
 * hauteur restante. Glisser des fichiers sur le tiroir fait paraître un calque de dépôt, le temps du glisser et de l'envoi.
 * « Agrandir » (⌥⇧A hors terminal) met le même terminal en grand sur toute la zone sous la barre de titre ; « Réduire »,
 * ou ⌥⇧A et Échap hors terminal, le rendent au tiroir. Ouvert : le focus va au terminal après la glissade (300 ms), et après
 * Agrandir/Réduire ; fermé : il revient à l'élément d'avant.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { SessionVue } from '@mnemo/contrat';
import { useAujourdhui, useFil, useSessions, useSessionsConnues } from '../../client/hooks.ts';
import { useAFaire } from '../../memoire/a-faire.ts';
import { useNavigation } from '../../navigation.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { Puce } from '../commun/Puce.tsx';
import { garder, lireGarde } from '../commun/taille-gardee.ts';
import { Tiroir } from '../commun/Tiroir.tsx';
import { raccourciAlt } from '../../raccourcis.ts';
import { useTextes } from '../../langue/langue.tsx';
import type { Textes } from '../../langue/textes.ts';
import { activiteArchiviste, ActiviteArchiviste, libelleActivite } from './ActiviteArchiviste.tsx';
import { archivisteVivant, CentreArchiviste, terminalDansLaPage } from './CentreArchiviste.tsx';
import s from './TiroirArchiviste.module.css';
import { ZoneDepot } from './ZoneDepot.tsx';

/** Durée de la glissade du tiroir (`transition` de `#arch`) : le focus va au terminal ensuite. */
export const GLISSADE_MS = 300;

/** Largeur du tiroir : 560 px par défaut (un terminal `claude` lisible), réglable par sa poignée, gardée par visiteur. */
export const LARGEUR = { cle: 'mnemo.archiviste.largeur', defaut: 560, min: 360 } as const;

/** Activité dépliée (`1`), gardée par visiteur ; repliée par défaut. */
export const CLE_ACTIVITE_DEPLIEE = 'mnemo.archiviste.activite.depliee';

function puceEtat(a: SessionVue | null, t: Textes['archiviste']['tiroir']['etats']): ReactNode {
	if (a === null) return <Puce>{t.arrete}</Puce>;
	if (a.etat === 'travaille') return <Puce ton="succes">{t.auTravail}</Puce>;
	if (a.etat === 'en_pause') return <Puce>{t.enPause}</Puce>;
	if (a.etat === 'attend') return a.dialogueOuvert ? <Puce ton="avertissement">{t.attendReponse}</Puce> : <Puce ton="succes">{t.aLEcoute}</Puce>;
	return <Puce>{t.arrete}</Puce>;
}

/** Vrai si le glisser porte des fichiers (pas un texte ni un lien tirés de la page). */
const porteDesFichiers = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');

export function TiroirArchiviste(): ReactNode {
	const tout = useTextes();
	const textes = tout.archiviste;
	const t = textes.tiroir;
	const nav = useNavigation();
	const sessions = useSessions();
	const archiviste = archivisteVivant(sessions);
	const fil = useFil(useAujourdhui());
	const aFaire = useAFaire();
	const connues = useSessionsConnues();
	const activite = useMemo(() => activiteArchiviste([], fil.donnees?.commits ?? [], connues, textes.activite, tout.sessions), [fil.donnees, connues, textes, tout]);
	const ouvert = nav.tiroirOuvert;
	const grand = nav.archivisteGrand;
	const [depliee, setDepliee] = useState(() => lireGarde(CLE_ACTIVITE_DEPLIEE) === '1');
	const [glisser, setGlisser] = useState(false);
	/** Un dépôt lancé depuis le calque est en cours : le calque reste, avec la progression de l'envoi. */
	const [envoi, setEnvoi] = useState(false);
	// Le terminal ne s'abonne qu'à la première ouverture, puis reste monté (pas de relecture à chaque ouverture), sauf
	// quand la page Mémoire › Archiviste l'affiche : jamais deux xterm sur le même flux.
	const [vu, setVu] = useState(ouvert);
	if (ouvert && !vu) setVu(true);
	const contenu = useRef<HTMLDivElement>(null);
	/** Vrai après « Lancer l'archiviste » : le focus ira au terminal de la nouvelle session dès qu'il paraît. */
	const focusApresLancement = useRef(false);

	// Focus : au terminal après la glissade ; rendu à l'élément d'avant à la fermeture (s'il était resté dans le tiroir).
	useEffect(() => {
		if (!ouvert) return;
		const actif = document.activeElement;
		const avant = actif instanceof HTMLElement && actif !== document.body ? actif : null;
		const minuteur = setTimeout(() => {
			const zone = contenu.current;
			(zone?.querySelector<HTMLElement>('.xterm-helper-textarea') ?? zone?.querySelector<HTMLElement>('[data-focus-initial]'))?.focus({ preventScroll: true });
		}, GLISSADE_MS);
		return () => {
			clearTimeout(minuteur);
			const maintenant = document.activeElement;
			const dansLeTiroir = maintenant === null || maintenant === document.body || (contenu.current?.closest('aside')?.contains(maintenant) ?? false);
			if (avant?.isConnected && dansLeTiroir) avant.focus({ preventScroll: true });
		};
	}, [ouvert]);

	// Agrandi ou réduit (tiroir déjà ouvert) : le terminal garde, ou reprend, le focus ; sans terminal, l'action du centre.
	const grandAvant = useRef(grand);
	useEffect(() => {
		if (grandAvant.current === grand) return;
		grandAvant.current = grand;
		if (!ouvert) return;
		const zone = contenu.current;
		(zone?.querySelector<HTMLElement>('.xterm-helper-textarea') ?? zone?.querySelector<HTMLElement>('[data-focus-initial]'))?.focus({ preventScroll: true });
	}, [grand, ouvert]);

	// Le terminal d'xterm se crée après le rendu : on essaie quelques fois (2 s au plus).
	const terminalPret = archiviste?.terminal ? archiviste.id : null;
	useEffect(() => {
		if (!terminalPret || !focusApresLancement.current) return;
		let essais = 0;
		const minuteur = setInterval(() => {
			const champ = contenu.current?.querySelector<HTMLElement>('.xterm-helper-textarea');
			if (champ || ++essais >= 40) {
				clearInterval(minuteur);
				focusApresLancement.current = false;
				champ?.focus({ preventScroll: true });
			}
		}, 50);
		return () => clearInterval(minuteur);
	}, [terminalPret]);

	function basculerActivite(): void {
		setDepliee(!depliee);
		garder(CLE_ACTIVITE_DEPLIEE, depliee ? null : '1');
	}

	const actions = (
		<>
			<Bouton genre="icone" onClick={() => nav.ouvrirPageArchiviste()} title={t.aFaireTitre}>
				{t.aFaire(aFaire.total)}
			</Bouton>
			{(archiviste?.terminal || grand) && (
				<Bouton genre="icone" onClick={() => nav.agrandirArchiviste()} aria-keyshortcuts="Alt+Shift+A" title={grand ? t.rendre(raccourciAlt('A', { maj: true, textes: tout.coquille.raccourcis })) : t.enGrand(raccourciAlt('A', { maj: true, textes: tout.coquille.raccourcis }))}>
					{grand ? t.reduire : t.agrandir}
				</Bouton>
			)}
		</>
	);

	return (
		<Tiroir ouvert={ouvert} titre={t.titre} puce={puceEtat(archiviste, t.etats)} redimension={LARGEUR} agrandi={grand} actions={actions} surFermer={() => nav.ouvrirTiroir(false)}>
			<div
				ref={contenu}
				className={s.contenu}
				onDragEnter={(e) => {
					if (porteDesFichiers(e)) setGlisser(true);
				}}
			>
				{!grand && (
					<button type="button" className={s.enteteActivite} aria-expanded={depliee} aria-controls={depliee ? 'activite-archiviste' : undefined} onClick={basculerActivite}>
						<span aria-hidden="true">{depliee ? '▾' : '▸'}</span> {libelleActivite(activite, textes.activite)}
					</button>
				)}
				{!grand && depliee && (
					<div id="activite-archiviste" className={s.defile} data-zone="activite">
						<ActiviteArchiviste activite={activite} libelle={t.changementsDuJour} tronque={fil.donnees?.tronque === true} />
					</div>
				)}
				<CentreArchiviste
					archiviste={archiviste}
					monter={vu && !terminalDansLaPage(nav)}
					actif={ouvert}
					compact={!grand}
					surLancement={(enCours) => {
						focusApresLancement.current = enCours;
					}}
				/>
				{(glisser || envoi) && (
					<div
						className={s.calque}
						data-calque-depot
						onDragOver={(e) => e.preventDefault()}
						onDragLeave={(e) => {
							if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setGlisser(false);
						}}
						onDrop={(e) => {
							// déposé hors de la zone : rien n'est envoyé, et le navigateur n'ouvre pas le fichier
							e.preventDefault();
							setGlisser(false);
						}}
					>
						<ZoneDepot surEnvoi={setEnvoi} />
					</div>
				)}
			</div>
		</Tiroir>
	);
}
