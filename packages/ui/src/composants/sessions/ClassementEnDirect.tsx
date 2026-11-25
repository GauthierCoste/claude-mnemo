/**
 * « Injecté dans la session » (panneau Contexte) : une seule liste, sans séparation, où le signe distingue chaque ligne :
 * - ◆ en haut, les fiches injectées entières (la fiche de position, et celles que l'utilisateur a demandé d'injecter), de la plus
 *   ancienne à la plus récente ;
 * - ◇ puis les cartes proposées à Claude, les plus récentes d'abord, avec leur raison (« du périmètre », « nommée », « question »,
 *   « liée à <titre> » pour une voisine d'une fiche injectée à la main) ;
 * - ◈ parmi elles, à l'heure de leur lecture, les fiches que la session a lues (outils `lire`, `voisins`) sans qu'elles soient déjà dans la
 *   liste ; une fiche déjà là (injectée ou proposée) garde sa ligne, et son info-bulle dit « lue aussi à HH:MM » ;
 * - puis, pour un journal ancien (avant « contexte sobre »), le classement de son dernier calcul, avec la note du reranker en %.
 * Au survol d'une ligne non injectée : ➤ « Injecter dans la session » (la fiche entière, au prochain message de la session ; il
 * reste allumé jusque-là, un clic l'annule) et ✗ « ne plus suggérer » (les écartés restent dans « Écartées (N) », avec
 * « Rétablir »). Une fiche lue n'a que ➤ (le service n'écarte que ce qu'il a proposé). La liste défile seule et s'ancre à la
 * jonction des injectées et du reste. Sous la liste : le motif d'un message muet. Le clic sur un titre ouvre la fiche.
 * À chaque nouveau calcul, les lignes glissent vers leur nouvelle place (FLIP, 200 ms, sauf mouvement réduit), un ▲/▼ dit le
 * changement de rang quelques secondes, une nouvelle venue apparaît en fondu.
 * Quand le dernier calcul qui a proposé des cartes s'est fait sans le sens (modèle arrêté, sans réponse à temps, fiches pas encore
 * indexées), un repère discret le dit à côté du titre de la section (« sans note de sens ») : les « — » ne restent pas muets. Pas
 * de repère pour un message muet : son texte n'est pas noté, le modèle n'y est pour rien. À droite du titre, le niveau des
 * modèles de la session (`ModelesSession`) ; sans notes, une ligne sous la liste en dit la raison selon ce niveau (coupés, sens
 * seul, arrêtés : avec « Démarrer », non installés).
 */
import { libelleRaison, niveauEffectif, type NiveauModeles } from '@mnemo/commun';
import type { ClassementVue, EntreeServieVue, LueVue, RaisonCarteVue } from '@mnemo/contrat';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useAServir, useEcartes, useModeles } from '../../client/hooks.ts';
import { dernierClassement, derniereEntree, estEcarte, pourcentage, sousLeSeuil } from '../../sessions/classement.ts';
import { cartesProposees, cartesRecentes, fichesServies, LIBELLES_MUET, titreFiche, titresConnus } from '../../sessions/servis.ts';
import { avisModeles } from '../modeles/avis-modeles.ts';
import { ModelesSession } from '../modeles/ModelesSession.tsx';
import { useToast } from '../Toast.tsx';
import s from './ClassementEnDirect.module.css';

/** Durée d'affichage des ▲/▼ et du fondu d'une nouvelle venue. */
export const INDICATEUR_MS = 4000;
const GLISSEMENT_MS = 200;
/** Fiches injectées laissées visibles au-dessus de la jonction quand la liste s'y ancre. */
const SERVIES_VISIBLES = 2;
/** Entrées récentes où le service cherche une carte à écarter (`ENTREES_CONSULTEES` du service). */
const ENTREES_ECARTABLES = 20;

/**
 * Ligne affichée : `servi` pour une fiche injectée (◆) ; `raison` pour une carte proposée (◇) ; `lue` pour une fiche seulement
 * lue par la session (◈, à l'heure `lueMs`) ; sinon une ligne d'un classement ancien (note). `lueMs` sur une autre ligne : la fiche
 * a aussi été lue. `ecartable` : le service sait l'écarter (dernier classement, cartes récentes).
 */
type Ligne = Pick<ClassementVue, 'id' | 'titre' | 'note' | 'servi'> & { raison?: RaisonCarteVue; depuis?: string; proposeeMs?: number; lue?: boolean; lueMs?: number; ecartable: boolean };

type Marques = { deltas: ReadonlyMap<string, number>; nouvelles: ReadonlySet<string> };
const SANS_MARQUES: Marques = { deltas: new Map(), nouvelles: new Set() };

function mouvementReduit(): boolean {
	return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Clé du classement reçu : un nouveau calcul, ou le même reclassé (notes), en change ; un écart de l'utilisateur, non. */
function cleDe(entree: EntreeServieVue | null): string {
	return entree === null ? '' : `${entree.horodatageMs}|${entree.classement.map((c) => `${c.id}:${c.rang}`).join(',')}`;
}

function libelleDelta(delta: number): string {
	const n = Math.abs(delta);
	return `${delta > 0 ? 'monte' : 'descend'} de ${n} rang${n > 1 ? 's' : ''}`;
}

const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Le repère d'un calcul fait sans le sens, et son explication. */
export const SANS_NOTE_DE_SENS = 'sans note de sens';
const EXPLICATION_SANS_SENS = "Pas de note : le modèle de sens ne tourne pas, n'a pas répondu à temps, ou ces fiches ne sont pas encore indexées ; les fiches sont proposées sans note.";

/** Pourquoi une piste n'a pas de note. */
function noteAbsente(l: Ligne): string {
	if (l.raison !== undefined) return 'Sans note : proposée sans modèle du sens, ou par une version plus ancienne de Mnemo';
	return 'Note indisponible (modèles arrêtés ou non installés)';
}

/** Bulle d'une ligne : ce qu'elle est, pourquoi et quand elle est là (et si elle a aussi été lue), puis son chemin. */
function bulle(l: Ligne, chemin: string): string {
	// heure inconnue (service plus ancien) : 0
	const a = (ms: number | undefined) => (ms ? ` à ${heure(ms)}` : '');
	if (l.lue) return `Lue par la session${a(l.lueMs)}\n${chemin}`;
	const aussi = l.lueMs === undefined ? '' : `, lue aussi${a(l.lueMs)}`;
	if (l.servi) return `Injectée entière dans la session${aussi}\n${chemin}`;
	if (l.raison === undefined) return aussi === '' ? chemin : `${aussi.slice(2)}\n${chemin}`;
	const quand = l.proposeeMs === undefined ? '' : `, proposée à ${heure(l.proposeeMs)}`;
	return `${libelleRaison(l.raison, l.depuis)}${quand}${aussi}\n${chemin}`;
}

export function ClassementEnDirect(p: {
	session: string;
	entrees: readonly EntreeServieVue[];
	/** Faux pour une session terminée : rien à écarter, ni niveau des modèles à changer. */
	modifiable: boolean;
	/** Niveau des modèles propre à la session (`SessionVue.niveauModeles`) ; null ou absent : comme partout. */
	niveauModeles?: NiveauModeles | null;
	/** Fiches injectées dans la session, sans doublon, plus récentes d'abord (défaut : celles du journal `entrees`). */
	servies?: readonly string[];
	/** Fiches lues par la session, avec l'heure de leur dernière lecture. */
	lues?: readonly LueVue[];
	surOuvrirFiche(chemin: string): void;
	couleur(chemin: string): string;
}): ReactNode {
	const toast = useToast();
	const { ecartes, ecarter, retablir } = useEcartes(p.session);
	const aServir = useAServir(p.session);
	const lignes = dernierClassement(p.entrees, ecartes.map((e) => e.id));
	const masquees = sousLeSeuil(p.entrees, ecartes.map((e) => e.id));
	const derniere = derniereEntree(p.entrees);
	const cle = cleDe(derniere);
	const titres = titresConnus(p.entrees);
	for (const l of lignes) if (!titres.has(l.id)) titres.set(l.id, l.titre);
	const titre = (chemin: string) => titres.get(chemin) ?? titreFiche(chemin);

	// en haut, les fiches injectées, de la plus ancienne à la plus récente ; puis les cartes proposées (plus récentes d'abord),
	// puis le classement d'un journal ancien : ce qui n'a pas été injecté, là où l'on injecte à la main
	const ordreServies = [...new Set([...[...(p.servies ?? fichesServies(p.entrees))].reverse(), ...lignes.filter((l) => l.servi).map((l) => l.id.split('#')[0]!)])];
	const servies: Ligne[] = ordreServies.map((chemin) => ({ id: chemin, titre: titre(chemin), note: null, servi: true, ecartable: false }));
	const ecartables = cartesRecentes(p.entrees, ENTREES_ECARTABLES);
	const ecartees = ecartes.map((e) => e.id);
	const cartes: Ligne[] = cartesProposees(p.entrees, ordreServies)
		.filter((c) => !estEcarte(c.id, ecartees))
		.map((c) => ({
			id: c.id,
			titre: c.titre,
			note: c.note ?? null,
			servi: false,
			raison: c.raison,
			...(c.depuis === undefined ? {} : { depuis: c.depuis.titre }),
			proposeeMs: c.horodatageMs,
			ecartable: ecartables.has(c.id),
		}));
	// le dernier calcul qui a proposé des cartes s'est-il fait sans le sens ? (ses cartes, comme celles d'avant, sont alors sans note)
	const dernierAvecCartes = p.entrees.reduce<EntreeServieVue | null>((a, e) => (e.cartes.length > 0 && (a === null || e.horodatageMs > a.horodatageMs) ? e : a), null);
	// un message muet (sans contenu, ou système) n'est pas noté : son texte est vide, ce n'est pas le modèle qui manque. C'est aussi le
	// seul cas où des cartes viennent d'un message vide (le service passe un message vide au calcul pour un message muet ; une question
	// vide de l'outil `contexte` ne propose rien)
	const sansSens = cartes.length > 0 && dernierAvecCartes !== null && !dernierAvecCartes.sens && dernierAvecCartes.muet === null;
	const dejaLa = new Set([...ordreServies, ...cartes.map((c) => c.id)]);
	const classees: Ligne[] = lignes.filter((l) => !dejaLa.has(l.id.split('#')[0]!)).map((l) => ({ ...l, servi: false, ecartable: true }));
	// fiches lues : une fiche déjà dans la liste garde sa ligne (« lue aussi ») ; les autres, une ligne ◈ parmi les cartes, à
	// l'heure de leur lecture (le service ne les écarte pas : elles n'ont pas été proposées)
	const lueA = new Map((p.lues ?? []).map((l) => [l.chemin, l.horodatageMs]));
	const avecLecture = (l: Ligne): Ligne => {
		const lueMs = lueA.get(l.id.split('#')[0]!);
		return lueMs === undefined ? l : { ...l, lueMs };
	};
	const presentes = new Set([...dejaLa, ...classees.map((l) => l.id.split('#')[0]!)]);
	const luesSeules: Ligne[] = (p.lues ?? [])
		.filter((l) => !presentes.has(l.chemin))
		.map((l) => ({ id: l.chemin, titre: titre(l.chemin), note: null, servi: false, lue: true, lueMs: l.horodatageMs, ecartable: false }));
	const quand = (l: Ligne) => (l.lue ? (l.lueMs ?? 0) : (l.proposeeMs ?? 0));
	// tri stable : les cartes gardent leur ordre entre elles
	const recentes = [...cartes.map(avecLecture), ...luesSeules].sort((a, b) => quand(b) - quand(a));
	const enLice = [...recentes, ...classees.map(avecLecture)];
	const serviesLues = servies.map(avecLecture);
	const premiereServie = servies.at(-1)?.id;
	// toutes les lignes : une fiche qui vient d'être injectée monte, et le dit (▲)
	const ordre = [...serviesLues, ...enLice].map((l) => l.id).join('\n');
	// notes absentes : on dit pourquoi (modèles arrêtés ou non installés), et le démarrage reste un geste explicite
	const sansNotes = lignes.length > 0 && lignes.every((l) => l.note === null);
	const modeles = useModeles(sansNotes);
	const niveauPropre = p.niveauModeles ?? null;
	const avis = sansNotes ? avisModeles(modeles.etat, niveauPropre) : null;
	// coupés pour la session : le bouton de niveau le dit déjà sur la même ligne, le repère « sans note de sens » serait de trop
	const coupee = modeles.etat !== undefined && niveauEffectif(modeles.etat.niveau, niveauPropre) === 'coupes';
	const [demarrage, setDemarrage] = useState<{ pour: string } | null>(null);
	const titreSection = useRef<HTMLSpanElement>(null);
	/** Après un ✗ : la ligne qui prend le focus ('' : le titre de la section). */
	const focusApres = useRef<string | null>(null);

	const elements = useRef(new Map<string, HTMLLIElement>());
	const positions = useRef(new Map<string, number>());
	const precedent = useRef<{ cle: string; ids: string[] } | null>(null);
	const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [marques, setMarques] = useState<Marques>(SANS_MARQUES);
	useEffect(
		() => () => {
			if (minuteur.current) clearTimeout(minuteur.current);
		},
		[],
	);

	useLayoutEffect(() => {
		// FLIP : chaque ligne déjà là part de son ancienne place et glisse vers la nouvelle.
		const reduit = mouvementReduit();
		for (const [id, el] of elements.current) {
			const avant = positions.current.get(id);
			const delta = avant === undefined ? 0 : avant - el.offsetTop;
			if (delta !== 0 && !reduit && typeof el.animate === 'function') {
				el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: GLISSEMENT_MS, easing: 'ease-out' });
			}
		}

		// ▲/▼ et nouvelles venues : seulement quand un classement arrive (pas quand l'utilisateur écarte une ligne).
		const ids = ordre === '' ? [] : ordre.split('\n');
		const avant = precedent.current;
		precedent.current = { cle, ids };
		if (avant === null || avant.cle === cle || avant.ids.length === 0) return;
		const deltas = new Map<string, number>();
		const nouvelles = new Set<string>();
		ids.forEach((id, i) => {
			const j = avant.ids.indexOf(id);
			if (j < 0) nouvelles.add(id);
			else if (j !== i) deltas.set(id, j - i);
		});
		setMarques({ deltas, nouvelles });
		if (minuteur.current) clearTimeout(minuteur.current);
		minuteur.current = setTimeout(() => setMarques(SANS_MARQUES), INDICATEUR_MS);
	}, [ordre, cle]);
	// Places relevées après chaque rendu (pas seulement quand l'ordre change) : l'apparition ou la fin des ▲/▼, un titre
	// qui passe sur deux lignes, déplacent les lignes ; le prochain glissement part de leur place réelle.
	useLayoutEffect(() => {
		positions.current = new Map([...elements.current].map(([id, el]) => [id, el.offsetTop]));
	});

	// le focus ne retombe pas sur la page quand la ligne écartée disparaît
	useEffect(() => {
		const cible = focusApres.current;
		if (cible === null) return;
		focusApres.current = null;
		const bouton = cible === '' ? null : elements.current.get(cible)?.querySelector<HTMLButtonElement>('button');
		(bouton ?? titreSection.current)?.focus();
	}, [ordre]);

	// La liste reste ancrée à la jonction (dernières servies au-dessus, classement en dessous) : à l'ouverture et à chaque
	// fiche servie ; entre deux, l'utilisateur fait défiler librement.
	const liste = useRef<HTMLOListElement>(null);
	/** Première ligne du classement non injecté : la jonction, où la liste s'ancre. */
	const jonction = useRef<HTMLLIElement | null>(null);
	const nombreServies = servies.length;
	useLayoutEffect(() => {
		const ol = liste.current;
		const j = jonction.current;
		if (ol === null || j === null) return;
		ol.scrollTop = Math.max(0, j.offsetTop - SERVIES_VISIBLES * j.getBoundingClientRect().height);
	}, [nombreServies, p.session]);

	const agir = async (geste: () => Promise<void>): Promise<boolean> => {
		try {
			await geste();
			return true;
		} catch (e) {
			toast(e instanceof ErreurApi ? e.message : 'Action impossible.');
			return false;
		}
	};
	const ecarterLigne = async (id: string) => {
		const i = enLice.findIndex((l) => l.id === id);
		focusApres.current = (enLice[i + 1] ?? enLice[i - 1])?.id ?? '';
		if (!(await agir(() => ecarter(id)))) focusApres.current = null;
	};
	const demarrer = () => void agir(modeles.demarrer).then((ok) => ok && setDemarrage({ pour: cle }));

	/** Une ligne : une fiche injectée (◆), une carte proposée (◇ et sa raison), ou une fiche d'un classement ancien (note). */
	const ligne = (l: Ligne, premiereServie: boolean, ancre?: { current: HTMLLIElement | null }) => {
		const note = pourcentage(l.note);
		const delta = marques.deltas.get(l.id);
		const chemin = l.id.split('#')[0]!;
		const attend = aServir.chemins.includes(chemin);
		return (
			<li
				key={l.id}
				ref={(el) => {
					if (el) elements.current.set(l.id, el);
					else elements.current.delete(l.id);
					if (ancre) ancre.current = el;
				}}
				className={s.ligne}
				data-id={l.id}
				data-servie={String(l.servi)}
				data-nouvelle={marques.nouvelles.has(l.id) ? 'true' : undefined}
				style={{ '--c': p.couleur(chemin) } as CSSProperties}
			>
				{/* case de gauche, une seule colonne : ◆ d'une fiche injectée entière, ◈ d'une fiche lue, sinon la note de la piste (— sans note) */}
				{l.servi ? (
					<span className={`${s.note} ${s.injectee}`} role="img" aria-label="Injectée dans la session" title="Injectée entière dans la session">
						◆
					</span>
				) : l.lue ? (
					<span className={`${s.note} ${s.lue}`} role="img" aria-label="Lue par la session" title="Lue par la session">
						◈
					</span>
				) : (
					<span className={s.note} title={note === null ? noteAbsente(l) : l.raison === undefined ? 'Note du reranker' : 'Note de la piste : le sens du message, plus les poids'}>
						{note ?? '—'}
					</span>
				)}
				<button type="button" className={s.fiche} title={bulle(l, chemin)} aria-keyshortcuts={premiereServie ? 'Alt+M' : undefined} onClick={() => p.surOuvrirFiche(chemin)}>
					<i aria-hidden="true" />
					<span className={s.titre}>{l.titre}</span>
				</button>
				{/* à droite, la raison seulement si elle apprend quelque chose (« du périmètre » est le cas par défaut) ; ▲/▼ quelques
				    secondes après un nouveau calcul ; au survol, les gestes prennent leur place */}
				{l.raison !== undefined && l.raison !== 'perimetre' && <span className={s.raison}>{libelleRaison(l.raison, l.depuis)}</span>}
				{delta !== undefined && (
					<span className={`${s.delta} ${delta > 0 ? s.monte : s.descend}`} data-delta="" title={libelleDelta(delta)}>
						<span aria-hidden="true">{`${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`}</span>
						<span className={s.masque}>{libelleDelta(delta)}</span>
					</span>
				)}
				{p.modifiable && !l.servi && (
					<span className={s.gestes}>
						<button
							type="button"
							className={`${s.croix} ${s.servir}`}
							aria-pressed={attend}
							aria-label={`Injecter ${l.titre} dans la session`}
							title={attend ? 'Sera injectée au prochain message de la session ; cliquer pour annuler' : 'Injecter dans la session : la fiche entière, au prochain message'}
							onClick={() => void agir(() => (attend ? aServir.annuler(chemin) : aServir.servir(chemin)))}
						>
							➤
						</button>
						<button
							type="button"
							className={s.croix}
							// le service ne cherche l'écart que dans les calculs récents
							style={l.ecartable ? undefined : { visibility: 'hidden' }}
							disabled={!l.ecartable}
							aria-label={`Ne plus suggérer ${l.titre}`}
							title="Pas pertinent : ne plus suggérer dans cette session (ce qui a déjà été injecté le reste)"
							onClick={() => void ecarterLigne(l.id)}
						>
							✗
						</button>
					</span>
				)}
			</li>
		);
	};
	return (
		<div className={s.classement}>
			<div className={s.enteteClassement}>
				<span className={s.lbl} id={`classement-${p.session}`} ref={titreSection} tabIndex={-1}>
					Injecté dans la session
				</span>
				{sansSens && !coupee && (
					<span className={s.sansSens} title={EXPLICATION_SANS_SENS}>
						{SANS_NOTE_DE_SENS}
					</span>
				)}
				{p.modifiable && (
					<span className={s.aDroite}>
						<ModelesSession session={p.session} niveau={niveauPropre} />
					</span>
				)}
			</div>
			{serviesLues.length + enLice.length === 0 ? (
				<p className={s.mu}>Aucune fiche pour l’instant.</p>
			) : (
				<ol className={s.liste} aria-label="Injecté dans la session" ref={liste}>
					{serviesLues.map((l) => ligne(l, l.id === premiereServie))}
					{enLice.map((l, i) => ligne(l, false, i === 0 ? jonction : undefined))}
				</ol>
			)}
			{derniere?.muet != null && <p className={s.avis}>{LIBELLES_MUET[derniere.muet]}</p>}
			{sansNotes && demarrage?.pour === cle ? (
				<p className={s.avis}>Modèles démarrés : les notes viendront au prochain message.</p>
			) : avis?.motif === 'arretes' ? (
				<p className={s.avis}>
					Notes indisponibles : modèles arrêtés
					<button type="button" className={s.demarrer} onClick={demarrer}>
						Démarrer
					</button>
				</p>
			) : avis?.motif === 'absents' ? (
				<p className={s.avis}>Notes indisponibles : modèles non installés</p>
			) : avis?.motif === 'coupes' || avis?.motif === 'sens' ? (
				<p className={s.avis}>
					{`Notes indisponibles : ${avis.motif === 'coupes' ? 'modèles coupés' : 'sens seul'}${avis.pourLaSession ? ' pour cette session' : ''}`}
				</p>
			) : null}
			{masquees.length > 0 && (
				<details className={s.ecartees} role="group" aria-label={`Sous le seuil (${masquees.length})`}>
					<summary>Sous le seuil ({masquees.length})</summary>
					<ul>
						{masquees.map((c) => (
							<li key={c.id} title={c.id}>
								<span className={s.titre}>{c.titre}</span>
								<span>{pourcentage(c.note)}</span>
							</li>
						))}
					</ul>
				</details>
			)}
			{ecartes.length > 0 && (
				<details className={s.ecartees} role="group" aria-label={`Écartées (${ecartes.length})`}>
					<summary>Écartées ({ecartes.length})</summary>
					<ul>
						{ecartes.map((e) => (
							<li key={e.id} title={e.id}>
								<span className={s.titre}>{e.titre}</span>
								{p.modifiable && (
									<button type="button" className={s.retablir} aria-label={`Rétablir ${e.titre}`} onClick={() => void agir(() => retablir(e.id))}>
										Rétablir
									</button>
								)}
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}
