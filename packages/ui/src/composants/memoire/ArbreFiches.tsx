/**
 * Arbre des fiches : champ « Filtrer les fichiers » (sans accents, titres et alias), dossiers
 * repliables, point de couleur de la branche de premier niveau, fiche ouverte en `.on`. En-tête : « Localiser la fiche
 * ouverte » (aussi ⌥L, par `localisation`), « Tout replier », « Tout déplier » (aussi ⌘- et ⌘+ / ⌘= quand l'arbre a le
 * focus, hors du champ de filtre). Au plus `LIGNES_MAX` lignes, depuis le début ; une fiche localisée plus loin est montrée
 * dans une fenêtre de `LIGNES_MAX` lignes autour d'elle (« Afficher le début » y revient).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { FicheGraphe } from '@mnemo/contrat';
import { couleurDeBranche, rangsDesFiches } from '../../graphe/branches.ts';
import { dossiersDe, lignesArbre } from '../../memoire/arbre.ts';
import { pliageArbre } from '../../raccourcis.ts';
import { BoutonsArbre } from '../commun/BoutonsArbre.tsx';
import { cx } from '../commun/classes.ts';
import { ChevronArbre, GuidesArbre, IconeDossier, margeArbre } from '../commun/ElementsArbre.tsx';
import { useTextes } from '../../langue/langue.tsx';
import s from './ArbreFiches.module.css';

/** Lignes affichées au plus : une grande mémoire (5 000 fiches) ne met pas 5 000 boutons dans la page ; le filtre affine. */
export const LIGNES_MAX = 400;

export function ArbreFiches(p: {
	fiches: FicheGraphe[] | undefined;
	erreur: string | null;
	courante: string | null;
	ouvrir(chemin: string): void;
	/** Compteur de demandes de localisation venues d'ailleurs (⌥L) : chaque nouvelle valeur localise la fiche ouverte. */
	localisation: number;
}): ReactNode {
	const t = useTextes().memoire.arbre;
	const [filtre, setFiltre] = useState('');
	const [replies, setReplies] = useState<ReadonlySet<string>>(() => new Set());
	const fiches = p.fiches;
	const rangs = useMemo(() => rangsDesFiches((fiches ?? []).map((f) => f.chemin)), [fiches]);
	const lignes = useMemo(() => lignesArbre(fiches ?? [], filtre, replies), [fiches, filtre, replies]);
	// Fiche autour de laquelle les lignes sont montrées (localisée au-delà des `LIGNES_MAX` premières) ; null : depuis le début.
	const [fenetre, setFenetre] = useState<string | null>(null);
	const cible = fenetre === null ? -1 : lignes.findIndex((l) => l.genre === 'fiche' && l.chemin === fenetre);
	const debut = cible < LIGNES_MAX ? 0 : Math.min(cible - LIGNES_MAX / 2, lignes.length - LIGNES_MAX);
	const filtrer = (texte: string) => {
		setFiltre(texte);
		setFenetre(null);
	};

	// La fiche ouverte depuis ailleurs (graphe, lien, Sessions) est amenée à l'écran dans l'arbre.
	const arbre = useRef<HTMLElement>(null);
	useEffect(() => {
		arbre.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' });
	}, [p.courante, fiches]);

	// Localiser : dossiers parents dépliés, filtre effacé s'il la masque, puis (après rendu) la fiche sélectionnée et amenée en vue.
	const [localisee, setLocalisee] = useState(0);
	const localiser = () => {
		const courante = p.courante;
		if (courante === null) return;
		const parents = new Set(dossiersDe(courante));
		setReplies((r) => new Set([...r].filter((cle) => !parents.has(cle))));
		if (filtre.trim() && !lignesArbre(fiches ?? [], filtre, new Set()).some((l) => l.genre === 'fiche' && l.chemin === courante)) setFiltre('');
		setFenetre(courante);
		setLocalisee((n) => n + 1);
	};
	useEffect(() => {
		if (localisee === 0) return;
		const fiche = arbre.current?.querySelector<HTMLElement>('[aria-current="page"]');
		fiche?.scrollIntoView?.({ block: 'nearest' });
		fiche?.focus({ preventScroll: true });
	}, [localisee]);
	const localiserCourant = useRef(localiser);
	localiserCourant.current = localiser;
	useEffect(() => {
		if (p.localisation > 0) localiserCourant.current();
	}, [p.localisation]);

	const toutReplier = () => {
		setReplies(new Set((fiches ?? []).flatMap((f) => dossiersDe(f.chemin))));
		setFenetre(null);
	};
	const toutDeplier = () => {
		setReplies(new Set());
		setFenetre(null);
	};

	const basculer = (cle: string) =>
		setReplies((r) => {
			const suivant = new Set(r);
			if (!suivant.delete(cle)) suivant.add(cle);
			return suivant;
		});

	// dossiers de la fiche ouverte : leurs traits de guide sont tracés en couleur
	const chemin = p.courante === null ? [] : dossiersDe(p.courante);
	const guides = (dossiers: readonly string[], debut: number) => <GuidesArbre niveaux={dossiers.map((d, k) => chemin[k] === d)} debut={debut} />;

	let contenu: ReactNode;
	if (fiches === undefined) contenu = <p className={s.vide}>{p.erreur ?? t.chargement}</p>;
	else if (lignes.length === 0) contenu = <p className={s.vide}>{filtre.trim() ? t.aucuneCorrespondance : t.aucune}</p>;
	else
		contenu = lignes.slice(debut, debut + LIGNES_MAX).map((l) =>
			l.genre === 'dossier' ? (
				<button
					key={`d:${l.cle}`}
					type="button"
					className={cx(s.fo, l.replie && s.c)}
					style={{ '--marge-arbre': `${margeArbre(l.profondeur)}px` } as CSSProperties}
					aria-expanded={!l.replie}
					title={l.cle}
					onClick={() => basculer(l.cle)}
				>
					{guides(dossiersDe(l.cle), margeArbre(l.profondeur))}
					<ChevronArbre ouvert={!l.replie} />
					<IconeDossier ouvert={!l.replie} />
					<bdi className={s.titre}>{l.nom}</bdi>
					<span className={s.nombre} title={t.nombreFiches(l.nombre)} aria-hidden="true">
						{l.nombre}
					</span>
				</button>
			) : (
				<button
					key={`f:${l.chemin}`}
					type="button"
					className={cx(s.fi, l.chemin === p.courante && s.on)}
					style={{ '--marge-arbre': `${margeArbre(l.profondeur)}px`, '--c': couleurDeBranche(rangs, l.chemin) } as CSSProperties}
					aria-current={l.chemin === p.courante ? 'page' : undefined}
					title={l.chemin}
					onClick={() => p.ouvrir(l.chemin)}
				>
					{guides(dossiersDe(l.chemin), margeArbre(l.profondeur))}
					<i aria-hidden="true" />
					<bdi className={s.titre}>{l.titre}</bdi>
				</button>
			),
		);

	return (
		<div
			onKeyDown={(e) => {
				// dans le champ de filtre, ⌘- et ⌘+ restent au navigateur (zoom)
				const pliage = e.target instanceof HTMLInputElement ? null : pliageArbre(e);
				if (pliage === null) return;
				e.preventDefault();
				if (pliage === 'replier') toutReplier();
				else toutDeplier();
			}}
		>
			<div className={s.entete}>
				<input type="text" className={s.filtre} placeholder={t.filtrer} aria-label={t.filtrer} value={filtre} onChange={(e) => filtrer(e.target.value)} />
				<BoutonsArbre surReplier={toutReplier} surDeplier={toutDeplier} localiser={{ possible: p.courante !== null, surLocaliser: localiser }} />
			</div>
			<nav ref={arbre} className={s.arbre} aria-label={t.fiches}>
				{debut > 0 && (
					<button type="button" className={s.debut} onClick={() => setFenetre(null)}>
						{t.debut(debut)}
					</button>
				)}
				{contenu}
				{lignes.length > debut + LIGNES_MAX && (
					<p className={s.vide}>{t.dePlus(lignes.length - debut - LIGNES_MAX)}</p>
				)}
			</nav>
		</div>
	);
}
