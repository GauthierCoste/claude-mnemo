/**
 * Grille des sessions : une ligne par dossier, une cellule par
 * session, séparateurs à glisser (`.vs` entre cellules, `.hs` entre lignes). La disposition vient de `disposerGrille` ;
 * rien n'est reconstruit d'une disposition à l'autre, les transitions CSS animent les tailles. Pendant un glissement la
 * grille porte la classe globale `drag` (sans transition ; `useTerminal` attend la fin pour ajuster les terminaux).
 */
import type { SessionVue } from '@mnemo/contrat';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { dureeSession } from '../../sessions/etats.ts';
import { glisserSeparateur, MINIMUM_COLONNE, MINIMUM_LIGNE, type Grille } from '../../sessions/grille.ts';
import type { GroupeSessions } from '../../sessions/groupes.ts';
import { CLASSE_GLISSEMENT } from '../../terminal/useTerminal.ts';
import { cx } from '../commun/classes.ts';
import { useGestesSeparateur } from '../commun/gestes-separateur.ts';
import { raccourciAlt } from '../../raccourcis.ts';
import { AvatarSession } from './AvatarSession.tsx';
import { CarteSession } from './CarteSession.tsx';
import s from './GrilleSessions.module.css';
import { Point } from './Point.tsx';

export type GenrePoids = 'lignes' | 'cellules';

type Props = {
	groupes: GroupeSessions[];
	disposition: Grille;
	/** Rang de chaque session dans l'ordre affiché (1 = première). */
	rangs: ReadonlyMap<string, number>;
	choisie: string | null;
	replies: ReadonlySet<string>;
	maintenant: number;
	terminauxDisponibles: boolean;
	/** Éclair sur l'en-tête d'une ligne (`.fl`) ; `numero` relance l'animation. */
	eclair: { cle: string; numero: number } | null;
	surChoisir(id: string): void;
	surZoom(id: string): void;
	surReprendre(id: string): void;
	surBasculerLigne(cle: string): void;
	surPastille(id: string): void;
	surNouvelle(dossier: string): void;
	/** Poids mémorisés en pixels (au premier glissement, puis à chaque mouvement). */
	surPoids(genre: GenrePoids, poids: Record<string, number>): void;
};

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function GrilleSessions(p: Props): ReactNode {
	const racine = useRef<HTMLDivElement>(null);
	const [glisse, setGlisse] = useState(false);

	const lignes = new Map(p.disposition.lignes.map((l) => [l.cle, l]));
	const cellules = new Map(p.disposition.cellules.map((c) => [c.id, c]));
	const nombre = p.rangs.size;

	// Éclair sur l'en-tête d'une ligne (clic sur son dossier dans le panneau Dossier).
	useEffect(() => {
		if (!p.eclair) return;
		const entete = [...(racine.current?.querySelectorAll<HTMLElement>('[data-entete]') ?? [])].find((x) => x.dataset['entete'] === p.eclair!.cle);
		if (!entete) return;
		entete.classList.remove(s.fl!);
		void entete.offsetWidth;
		entete.classList.add(s.fl!);
		const fin = () => entete.classList.remove(s.fl!);
		entete.addEventListener('animationend', fin, { once: true });
		return () => entete.removeEventListener('animationend', fin);
	}, [p.eclair]);

	const carte = (x: SessionVue) => {
		const c = cellules.get(x.id);
		const rang = p.rangs.get(x.id) ?? 0;
		return (
			<div
				className={cx(s.cellule, c?.rail && s.rail)}
				data-cellule={x.id}
				data-rail={String(c?.rail ?? false)}
				data-zoomee={String(c?.zoomee ?? false)}
				style={{ flexGrow: c?.flexGrow ?? 1, flexBasis: c?.flexBasis ?? '0px' }}
			>
				<button
					type="button"
					className={s.railb}
					onClick={() => p.surZoom(x.id)}
					tabIndex={c?.rail ? 0 : -1}
					aria-hidden={!c?.rail}
					aria-keyshortcuts={rang <= 9 ? `Alt+${rang}` : undefined}
				>
					<AvatarSession session={x} taille="rail" />
					{rang <= 9 && <kbd>{raccourciAlt(String(rang))}</kbd>}
					<span className={s.vertical}>{x.objectif ?? 'Sans objectif'}</span>
				</button>
				<CarteSession
					session={x}
					rang={rang}
					duree={dureeSession(x, p.maintenant)}
					choisie={p.choisie === x.id}
					zoomee={c?.zoomee ?? false}
					terminauxDisponibles={p.terminauxDisponibles}
					surChoisir={p.surChoisir}
					surZoom={p.surZoom}
					surReprendre={p.surReprendre}
				/>
			</div>
		);
	};

	return (
		<div
			ref={racine}
			className={cx(s.grille, p.disposition.zoomee && s.zoomee, glisse && CLASSE_GLISSEMENT)}
			aria-label="Grille des sessions"
			role="region"
		>
			<div className={s.lignes}>
				{p.groupes.map((g, i) => {
					const l = lignes.get(g.cle);
					const mini = l?.mini ?? false;
					const repliee = p.replies.has(g.cle);
					return (
						<Fragment key={g.cle}>
							{i > 0 && <SeparateurGrille genre="lignes" inactif={p.disposition.zoomee} surPoids={p.surPoids} surGlisse={setGlisse} />}
							<div className={cx(s.ligne, mini && s.mini)} data-ligne={g.cle} data-mini={String(mini)} style={{ flexGrow: l?.flexGrow ?? 1, minHeight: mini ? undefined : MINIMUM_LIGNE }}>
								<div className={s.entete} data-entete={g.cle}>
									<button
										type="button"
										className={s.ib}
										aria-expanded={!repliee}
										aria-label={repliee ? `Déplier ${g.titre}` : `Replier ${g.titre}`}
										onClick={() => p.surBasculerLigne(g.cle)}
									>
										{repliee ? '▸' : '▾'}
									</button>
									<b>{g.titre}</b>
									<span>{pluriel(g.sessions.length, 'session')}</span>
									<span className={s.pastilles}>
										{g.sessions.map((x) => (
											<button key={x.id} type="button" className={s.pastille} onClick={() => p.surPastille(x.id)} tabIndex={mini ? 0 : -1}>
												<Point etat={x.etat} />
												{x.objectif ?? 'Sans objectif'}
											</button>
										))}
									</span>
									<span className={s.espace} />
									<button type="button" className={s.ib} onClick={() => p.surNouvelle(g.cle)}>
										+ session
									</button>
								</div>
								<div className={s.cellules}>
									{g.sessions.map((x, j) => (
										<Fragment key={x.id}>
											{j > 0 && <SeparateurGrille genre="cellules" inactif={p.disposition.zoomee} surPoids={p.surPoids} surGlisse={setGlisse} />}
											{carte(x)}
										</Fragment>
									))}
								</div>
							</div>
						</Fragment>
					);
				})}
			</div>
			<div className={s.aide} data-aide="">
				<span>{nombre > 1 ? `${raccourciAlt('1')} à ${raccourciAlt(String(Math.min(nombre, 9)))} ouvre une session en grand` : `${raccourciAlt('1')} ouvre la session en grand`}</span>
				<span>Échap revient à la grille</span>
				<span>double-clic sur un titre pour agrandir</span>
				<span>{raccourciAlt('A')} parle à l'archiviste</span>
			</div>
		</div>
	);
}

const ATTRIBUTS: Record<GenrePoids, string> = { cellules: 'data-cellule', lignes: 'data-ligne' };
const LIBELLES: Record<GenrePoids, string> = { cellules: 'Largeur des sessions voisines', lignes: 'Hauteur des dossiers voisins' };
const MINIMUMS: Record<GenrePoids, number> = { cellules: MINIMUM_COLONNE, lignes: MINIMUM_LIGNE };

type Voisines = { a: string; b: string; tailleA: number; tailleB: number };

/**
 * Voisines d'un séparateur et poids de toute leur rangée, en pixels ; null si l'une est repliée (`data-mini`). Le premier
 * geste mémorise la rangée entière : les autres gardent leur taille affichée.
 */
function voisinesDe(separateur: HTMLElement, genre: GenrePoids, surPoids: Props['surPoids']): Voisines | null {
	const attribut = ATTRIBUTS[genre];
	const [a, b] = [separateur.previousElementSibling, separateur.nextElementSibling];
	if (!(a instanceof HTMLElement) || !(b instanceof HTMLElement)) return null;
	if (a.dataset['mini'] === 'true' || b.dataset['mini'] === 'true') return null;
	const taille = (x: HTMLElement) => (genre === 'cellules' ? x.offsetWidth : x.offsetHeight);
	const freres = [...(separateur.parentElement?.children ?? [])].filter(
		(x): x is HTMLElement => x instanceof HTMLElement && x.hasAttribute(attribut) && x.dataset['mini'] !== 'true',
	);
	surPoids(genre, Object.fromEntries(freres.map((x) => [x.getAttribute(attribut)!, taille(x)])));
	return { a: a.getAttribute(attribut)!, b: b.getAttribute(attribut)!, tailleA: taille(a), tailleB: taille(b) };
}

/** Séparateur entre deux cellules (`.vs`) ou deux lignes (`.hs`) : il partage leur somme, chacune au moins à son minimum. */
function SeparateurGrille(p: { genre: GenrePoids; inactif: boolean; surPoids: Props['surPoids']; surGlisse(glisse: boolean): void }): ReactNode {
	const voisines = useRef<Voisines | null>(null);
	const element = useRef<HTMLDivElement>(null);
	// valeur ARIA : la taille affichée de la voisine d'avant, relue après chaque rendu (poids, disposition, fenêtre)
	const [mesure, setMesure] = useState<{ valeur: number; total: number } | null>(null);
	useLayoutEffect(() => {
		const [a, b] = [element.current?.previousElementSibling, element.current?.nextElementSibling];
		if (!(a instanceof HTMLElement) || !(b instanceof HTMLElement)) return;
		const taille = (x: HTMLElement) => (p.genre === 'cellules' ? x.offsetWidth : x.offsetHeight);
		const lue = { valeur: taille(a), total: taille(a) + taille(b) };
		setMesure((m) => (m?.valeur === lue.valeur && m.total === lue.total ? m : lue));
	});
	const partager = (v: Voisines, ecart: number) => {
		const [a, b] = glisserSeparateur(v.tailleA, v.tailleB, ecart, MINIMUMS[p.genre]);
		p.surPoids(p.genre, { [v.a]: a, [v.b]: b });
	};
	const vertical = p.genre === 'cellules';
	const { glisse, gestes } = useGestesSeparateur({
		vertical,
		surDebut: (separateur) => {
			voisines.current = p.inactif ? null : voisinesDe(separateur, p.genre, p.surPoids);
			return voisines.current !== null;
		},
		surGlisser: (ecart) => voisines.current && partager(voisines.current, ecart),
		surFin: () => {
			voisines.current = null;
		},
		surClavier: (geste, separateur) => {
			const v = p.inactif ? null : voisinesDe(separateur, p.genre, p.surPoids);
			if (v === null) return;
			partager(v, 'pas' in geste ? geste.pas : geste.borne === 'debut' ? -Infinity : Infinity);
		},
	});
	const { surGlisse } = p;
	useEffect(() => surGlisse(glisse), [glisse, surGlisse]);
	return (
		<div
			className={vertical ? s.vs : s.hs}
			data-separateur={p.genre}
			role="separator"
			aria-orientation={vertical ? 'vertical' : 'horizontal'}
			aria-label={LIBELLES[p.genre]}
			tabIndex={p.inactif ? -1 : 0}
			ref={element}
			aria-valuenow={mesure?.valeur}
			aria-valuemin={mesure === null ? undefined : MINIMUMS[p.genre]}
			aria-valuemax={mesure === null ? undefined : mesure.total - MINIMUMS[p.genre]}
			{...gestes}
		/>
	);
}
