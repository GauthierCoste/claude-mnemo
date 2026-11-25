/**
 * « Injecté dans la session » (panneau Contexte), le classement vivant. Une seule liste :
 * - ◆ en haut, les fiches injectées entières, de la plus ancienne à la plus récente ; à droite, comment : « du dossier » (fiche
 *   de position), « à la main » (➤), ou « auto 94 % » (injectée par Mnemo, sa note au message ; l'info-bulle le dit) ;
 * - la jonction : un espacement, sans trait (le repère du seuil est le seul trait du panneau) ; dessous, l'injection
 *   automatique coupée par le suivi, avec son motif et « Réactiver ». L'état du classement qui sort de l'ordinaire (« affinage… », « ordre seul » et sa raison) est dit dans le bouton des
 *   modèles de la session, à droite du titre. Le message classé n'est pas rappelé ;
 * - le classement du dernier message porteur : la note en % (calibrée), ou ◇ en ordre seul ; le titre et, dessous, la raison
 *   et « piste » (envoyée en piste dans la session) ; un repère au seuil d'injection automatique ;
 * - « Plus tôt dans la session » : les pistes plus anciennes et les fiches lues (◈) absentes du classement, plus récentes
 *   d'abord, sans % ;
 * - puis la suggestion des 3 sessions (« écartée dans 3 sessions : ne plus la suggérer ? »), « Sous le seuil (N) » et
 *   « Écartées (N) ».
 * Au survol d'une ligne : ➤ « Injecter dans la session » (la fiche entière, au prochain message ; allumé jusque-là, un clic
 * l'annule) et ✗, un menu : « Pas pour cette session » (rétablie depuis « Écartées ») ou « Ne plus jamais suggérer » (rétablie
 * depuis la fiche, page Mémoire). Une fiche injectée par Mnemo a aussi ✗ : l'écarter compte comme une erreur au suivi.
 * À chaque classement (hook) puis à l'affinage (même entrée, rangs changés), les lignes glissent (FLIP, sauf mouvement réduit),
 * un ▲/▼ dit le changement de rang quelques secondes, une nouvelle venue apparaît en fondu. La liste défile seule et s'ancre
 * à la jonction. Pas de % hors calibration : une entrée ancienne, ou un modèle de note non accepté, donne l'ordre seul.
 */
import { libelleRaison, niveauEffectif, type NiveauModeles } from '@mnemo/commun';
import type { ClassementVue, CoupureInjectionVue, EntreeServieVue, InjectionVue, LueVue, RaisonCarteVue, SuggestionEcarteeToujoursVue } from '@mnemo/contrat';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useAServir, useEcartes, useEcarteesToujours, useModeles, useReactiverInjection, useReglages } from '../../client/hooks.ts';
import { dernierClassement, derniereEntree, estCalibre, estEcarte, modesDInjection, pourcentage, seuilInjection, sousLeSeuil, type ModeInjection } from '../../sessions/classement.ts';
import { cartesProposees, cartesRecentes, fichesServies, LIBELLES_MUET, titreFiche, titresConnus } from '../../sessions/servis.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { ItemMenu, MenuModeles } from '../modeles/MenuModeles.tsx';
import sm from '../modeles/Modeles.module.css';
import { avisModeles } from '../modeles/avis-modeles.ts';
import { ModelesSession } from '../modeles/ModelesSession.tsx';
import { cx } from '../commun/classes.ts';
import { useToast } from '../Toast.tsx';
import s from './ClassementEnDirect.module.css';

/** Durée d'affichage des ▲/▼ et du fondu d'une nouvelle venue. */
export const INDICATEUR_MS = 4000;
const GLISSEMENT_MS = 260;
/** Fiches injectées laissées visibles au-dessus de la jonction quand la liste s'y ancre. */
const SERVIES_VISIBLES = 2;
/** Entrées récentes où le service cherche une carte à écarter (`ENTREES_CONSULTEES` du service). */
const ENTREES_ECARTABLES = 20;

/** Suggestions « Garder » de cette fenêtre : elles ne reviennent pas tant que l'app est ouverte. */
const suggestionsGardees = new Set<string>();

type Marques = { deltas: ReadonlyMap<string, number>; nouvelles: ReadonlySet<string> };
const SANS_MARQUES: Marques = { deltas: new Map(), nouvelles: new Set() };

function mouvementReduit(): boolean {
	return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Clé du classement reçu : un nouveau calcul, ou le même reclassé (affinage), en change ; un écart de l'utilisateur, non. */
function cleDe(entree: EntreeServieVue | null): string {
	return entree === null ? '' : `${entree.horodatageMs}|${entree.classement.map((c) => `${c.id}:${c.rang}`).join(',')}`;
}

function libelleDelta(delta: number): string {
	const n = Math.abs(delta);
	return `${delta > 0 ? 'monte' : 'descend'} de ${n} rang${n > 1 ? 's' : ''}`;
}

const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const chemin = (id: string) => id.split('#')[0]!;

/** Pourquoi le classement est en ordre seul (info-bulle du repère « ordre seul »). */
export function raisonOrdreSeul(coupes: boolean): string {
	return coupes
		? "Ordre seul : modèles coupés pour cette session, ni sens ni reranker. L'ordre suit les mots, puis l'historique de tes gestes ; sans %, ni injection par Mnemo."
		: "Ordre seul : aucune note apprise et validée sur tes jugements pour les modèles installés (pas encore apprise, refusée, ou modèles changés depuis). L'ordre suit le sens et les mots ; sans %, ni injection par Mnemo.";
}

/** Libellé à droite d'une fiche injectée et son info-bulle. */
function modeAffiche(m: ModeInjection | undefined, duDossier: boolean, seuil: number): { libelle: string | null; bulle: string; auto: boolean } {
	if (m?.mode === 'auto') {
		const note = pourcentage(m.p ?? null);
		return {
			libelle: note === null ? 'auto' : `auto ${note}`,
			bulle: `Injectée par Mnemo${note === null ? '' : ` : ${note} pour ce message`} (seuil ${pourcentage(seuil)}), entière, au message de ${heure(m.horodatageMs)}`,
			auto: true,
		};
	}
	if (m?.mode === 'main') return { libelle: 'à la main', bulle: `Injectée à la main (➤), entière, au message de ${heure(m.horodatageMs)}`, auto: false };
	if (duDossier) return { libelle: 'du dossier', bulle: 'Fiche du dossier de la session, injectée entière', auto: false };
	return { libelle: null, bulle: 'Injectée entière dans la session', auto: false };
}

/** Une ligne sous la jonction : du classement du message, ou plus tôt dans la session (piste ancienne, fiche lue). */
type Ligne = {
	id: string;
	titre: string;
	/** Classement : la note calibrée (null : ordre seul), son rang, et si elle a été envoyée en piste. */
	classee?: { p: number | null; rang: number; piste: boolean };
	raison?: RaisonCarteVue;
	depuis?: string;
	/** Plus tôt : piste d'un message précédent, ou fiche lue par la session. */
	plusTot?: { genre: 'piste' | 'lue'; heureMs: number };
	lueMs?: number;
	ecartable: boolean;
};

export function ClassementEnDirect(p: {
	session: string;
	entrees: readonly EntreeServieVue[];
	/** Faux pour une session terminée : rien à écarter, ni niveau des modèles à changer. */
	modifiable: boolean;
	/** Niveau des modèles propre à la session (`SessionVue.niveauModeles`) ; null ou absent : comme partout. */
	niveauModeles?: NiveauModeles | null;
	/** Position de la session (`SessionVue.position`) : une fiche injectée qui en est vient « du dossier ». */
	position?: string;
	/** Fiches injectées dans la session, sans doublon, plus récentes d'abord (défaut : celles du journal `entrees`). */
	servies?: readonly string[];
	/** Fiches lues par la session, avec l'heure de leur dernière lecture. */
	lues?: readonly LueVue[];
	/** Injections à la main et par Mnemo, d'après le journal des gestes (route `servis`). */
	injections?: readonly InjectionVue[];
	/** Injection automatique coupée par le suivi (`SessionVue.injectionCoupee`). */
	coupures?: readonly CoupureInjectionVue[];
	/** Suggestions de la règle des 3 sessions (`SessionVue.suggestionsEcarteeToujours`). */
	suggestions?: readonly SuggestionEcarteeToujoursVue[];
	surOuvrirFiche(chemin: string): void;
	couleur(chemin: string): string;
}): ReactNode {
	const toast = useToast();
	const { ecartes, ecarter, retablir } = useEcartes(p.session);
	const toujours = useEcarteesToujours();
	const aServir = useAServir(p.session);
	const reactiver = useReactiverInjection();
	const seuil = seuilInjection(useReglages().donnees);
	const jamais = new Set(toujours.liste.map((e) => e.chemin));
	const idsEcartes = ecartes.map((e) => e.id);
	const horsJeu = (id: string) => estEcarte(id, idsEcartes) || jamais.has(chemin(id));
	const derniere = derniereEntree(p.entrees);
	// sans message porteur encore, un message muet dit pourquoi rien n’est proposé
	const muetSeul = derniere === null ? (p.entrees.reduce<(typeof p.entrees)[number] | null>((a, e) => (a === null || e.horodatageMs > a.horodatageMs ? e : a), null)?.muet ?? null) : null;
	const calibre = estCalibre(derniere);
	const cle = cleDe(derniere);
	const titres = titresConnus(p.entrees);
	const classement = dernierClassement(p.entrees, idsEcartes);
	for (const l of classement) if (!titres.has(chemin(l.id))) titres.set(chemin(l.id), l.titre);
	const titre = (c: string) => titres.get(c) ?? titreFiche(c);
	const masquees = sousLeSeuil(p.entrees, idsEcartes);
	const coupures = p.coupures ?? [];

	// fiches demandées par ➤ vues dans cette fenêtre : injectées ensuite, elles sont « à la main » avant même le journal des gestes
	const demandees = useRef(new Set<string>());
	for (const c of aServir.chemins) demandees.current.add(c);
	// la note d'une injection par Mnemo : celle vue au hook, que l'affinage ne change pas
	const notesDInjection = useRef(new Map<string, number>());
	const modes = modesDInjection(p.injections ?? [], p.entrees, notesDInjection.current);

	// ◆ de la plus ancienne à la plus récente
	const parEntrees = [...p.entrees].sort((a, b) => a.horodatageMs - b.horodatageMs).flatMap((e) => e.ids.map(chemin));
	const ordreServies = [...new Set([...parEntrees, ...[...(p.servies ?? fichesServies(p.entrees))].reverse(), ...classement.filter((l) => l.servi).map((l) => chemin(l.id))])];
	const injectees = new Set(ordreServies);
	const lueA = new Map((p.lues ?? []).map((l) => [l.chemin, l.horodatageMs]));
	const pistesConnues = new Map(cartesProposees(p.entrees, ordreServies).map((c) => [c.id, c]));
	const ecartables = cartesRecentes(p.entrees, ENTREES_ECARTABLES);
	// « piste » : seulement une piste de ce message (sa marque au classement ; une entrée d'avant le classement vivant : ses cartes)
	const cartesDuMessage = new Set((derniere?.cartes ?? []).map((c) => chemin(c.id)));
	const pisteDuMessage = (l: ClassementVue) => l.piste === true || (l.signaux === undefined && cartesDuMessage.has(chemin(l.id)));

	const classees: Ligne[] = classement
		.filter((l) => !l.servi && !injectees.has(chemin(l.id)) && !horsJeu(l.id))
		.map((l, i) => {
			const carte = pistesConnues.get(chemin(l.id));
			const raison = l.raison ?? carte?.raison;
			const lueMs = lueA.get(chemin(l.id));
			return {
				id: l.id,
				titre: l.titre,
				classee: { p: calibre ? (l.p ?? l.note) : null, rang: i + 1, piste: pisteDuMessage(l) },
				...(raison === undefined ? {} : { raison }),
				...(carte?.depuis === undefined ? {} : { depuis: carte.depuis.titre }),
				...(lueMs === undefined ? {} : { lueMs }),
				ecartable: true,
			};
		});
	const presentes = new Set([...ordreServies, ...classees.map((l) => chemin(l.id))]);
	const pistesAnciennes: Ligne[] = [...pistesConnues.values()]
		.filter((c) => !presentes.has(c.id) && !horsJeu(c.id))
		.map((c) => ({ id: c.id, titre: c.titre, raison: c.raison, plusTot: { genre: 'piste', heureMs: c.horodatageMs }, ecartable: ecartables.has(c.id) }));
	const luesSeules: Ligne[] = (p.lues ?? [])
		.filter((l) => !presentes.has(l.chemin) && !pistesConnues.has(l.chemin) && !jamais.has(l.chemin))
		.map((l) => ({ id: l.chemin, titre: titre(l.chemin), plusTot: { genre: 'lue', heureMs: l.horodatageMs }, ecartable: false }));
	// tri stable : les pistes d'un même message gardent leur ordre
	const plusTot = [...pistesAnciennes, ...luesSeules].sort((a, b) => b.plusTot!.heureMs - a.plusTot!.heureMs);
	const enLice = [...classees, ...plusTot];
	const ordre = [...ordreServies, ...enLice.map((l) => l.id)].join('\n');

	// repères de la jonction
	const modeles = useModeles(derniere !== null && !derniere.sens);
	const niveauPropre = p.niveauModeles ?? null;
	const coupes = modeles.etat !== undefined && niveauEffectif(modeles.etat.niveau, niveauPropre) === 'coupes';
	const ordreSeul = classees.length > 0 && !calibre;
	const affinage = derniere?.affinage === 'en_cours';
	// notes absentes faute de sens : on dit pourquoi (niveau, chargement, modèles arrêtés ou non installés) ; un message muet n'est pas noté
	const sansSens = derniere !== null && derniere.classement.length > 0 && !derniere.sens && derniere.muet === null;
	const avis = sansSens ? avisModeles(modeles.etat, niveauPropre) : null;
	const [demarrage, setDemarrage] = useState<{ pour: string } | null>(null);
	const [jamaisIci, setJamaisIci] = useState<string[]>([]);
	const [, rafraichir] = useState(0);
	const suggestion = (p.suggestions ?? []).find((x) => !suggestionsGardees.has(`${p.session}|${x.chemin}`) && !jamais.has(x.chemin)) ?? null;

	const titreSection = useRef<HTMLSpanElement>(null);
	/** Après un écart : la ligne qui prend le focus ('' : le titre de la section). */
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
		// FLIP : chaque ligne déjà là part de son ancienne place et glisse vers la nouvelle. Pendant le glissement, une ligne a un
		// fond opaque et celle qui monte passe au-dessus de celle qui descend : les textes ne se mêlent jamais.
		const reduit = mouvementReduit();
		for (const [id, el] of elements.current) {
			const avant = positions.current.get(id);
			const delta = avant === undefined ? 0 : avant - el.offsetTop;
			if (delta !== 0 && !reduit && typeof el.animate === 'function') {
				el.dataset['glisse'] = delta > 0 ? 'monte' : 'descend';
				const animation = el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: GLISSEMENT_MS, easing: 'ease-out' }) as Animation | undefined;
				const fin = () => {
					delete el.dataset['glisse'];
				};
				if (animation !== undefined && 'finished' in animation) void animation.finished.then(fin, fin);
				else setTimeout(fin, GLISSEMENT_MS);
			}
		}
		// ▲/▼ et nouvelles venues : seulement quand un classement arrive ou s'affine (pas quand l'utilisateur écarte une ligne).
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
	// Places relevées après chaque rendu : l'apparition ou la fin des ▲/▼, un titre qui passe sur deux lignes, déplacent les
	// lignes ; le prochain glissement part de leur place réelle.
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

	// La liste reste ancrée à la jonction (dernières injectées au-dessus, classement en dessous) : à l'ouverture et à chaque
	// fiche injectée ; entre deux, l'utilisateur fait défiler librement.
	const liste = useRef<HTMLOListElement>(null);
	const jonction = useRef<HTMLLIElement | null>(null);
	const nombreServies = ordreServies.length;
	useLayoutEffect(() => {
		const ol = liste.current;
		const j = jonction.current;
		const premiere = ol?.querySelector<HTMLLIElement>('li[data-servie]');
		if (ol === null || j === null || premiere == null) return;
		ol.scrollTop = Math.max(0, j.offsetTop - SERVIES_VISIBLES * premiere.getBoundingClientRect().height);
	}, [nombreServies, p.session]);

	const agir = async (geste: () => Promise<unknown>): Promise<boolean> => {
		try {
			await geste();
			return true;
		} catch (e) {
			toast(e instanceof ErreurApi ? e.message : 'Action impossible.');
			return false;
		}
	};
	const focusSuivant = (id: string) => {
		const i = enLice.findIndex((l) => l.id === id);
		focusApres.current = i < 0 ? null : ((enLice[i + 1] ?? enLice[i - 1])?.id ?? '');
	};
	const ecarterIci = async (id: string) => {
		focusSuivant(id);
		if (!(await agir(() => ecarter(id)))) focusApres.current = null;
	};
	const ecarterToujours = async (id: string) => {
		focusSuivant(id);
		const c = chemin(id);
		if (await agir(() => toujours.ecarter(c, p.session))) setJamaisIci((j) => (j.includes(c) ? j : [...j, c]));
		else focusApres.current = null;
	};
	const demarrer = () => void agir(modeles.demarrer).then((ok) => ok && setDemarrage({ pour: cle }));
	const refFiche = (id: string, ancre?: { current: HTMLLIElement | null }) => (el: HTMLLIElement | null) => {
		if (el) elements.current.set(id, el);
		else elements.current.delete(id);
		if (ancre) ancre.current = el;
	};
	const delta = (id: string): ReactNode => {
		const d = marques.deltas.get(id);
		if (d === undefined) return null;
		return (
			<span className={`${s.delta} ${d > 0 ? s.monte : s.descend}`} data-delta="" title={libelleDelta(d)}>
				<span aria-hidden="true">{`${d > 0 ? '▲' : '▼'}${Math.abs(d)}`}</span>
				<span className={s.masque}>{libelleDelta(d)}</span>
			</span>
		);
	};

	/** ➤ (sauf une fiche déjà injectée) et ✗, le menu d'écart : pour cette session, ou pour toujours. */
	const gestes = (o: { id: string; titre: string; ecartableIci: boolean; motifIci: string; resume: string; injecter: boolean }): ReactNode => {
		if (!p.modifiable) return null;
		const c = chemin(o.id);
		const attend = aServir.chemins.includes(c);
		return (
			<span className={s.gestes} data-force={attend ? 'true' : undefined}>
				{o.injecter && (
					<button
						type="button"
						className={`${s.croix} ${s.servir}`}
						aria-pressed={attend}
						aria-label={`Injecter ${o.titre} dans la session`}
						title={attend ? 'Sera injectée au prochain message de la session ; cliquer pour annuler' : 'Injecter dans la session : la fiche entière, au prochain message'}
						onClick={() => void agir(() => (attend ? aServir.annuler(c) : aServir.servir(c)))}
					>
						➤
					</button>
				)}
				<MenuModeles
					libelle={`Écarter ${o.titre}`}
					titre="Écarter : de cette session, ou pour toujours"
					classeBouton={s.croix ?? ''}
					contenuBouton="✗"
					alignement="droite"
					entete={
						<>
							<div className={sm.entete}>{o.titre}</div>
							<p className={sm.note}>{o.resume}</p>
						</>
					}
				>
					{(fermer) => (
						<>
							<ItemMenu
								libelle="Pas pour cette session"
								detail={o.ecartableIci ? 'Ni proposée ni injectée par Mnemo dans cette session. Se rétablit depuis « Écartées ».' : o.motifIci}
								desactive={!o.ecartableIci}
								surChoix={() => {
									fermer();
									void ecarterIci(o.id);
								}}
							/>
							<ItemMenu
								libelle="Ne plus jamais suggérer"
								detail="Dans aucune session, ni par Mnemo ni en piste. Se rétablit depuis la fiche, page Mémoire."
								surChoix={() => {
									fermer();
									void ecarterToujours(o.id);
								}}
							/>
						</>
					)}
				</MenuModeles>
			</span>
		);
	};

	const ligneInjectee = (c: string): ReactNode => {
		const m = modes.get(c) ?? (demandees.current.has(c) ? { mode: 'main' as const, horodatageMs: derniere?.horodatageMs ?? 0 } : undefined);
		const duDossier = p.position !== undefined && p.position !== '' && c.startsWith(`${p.position}/`);
		const { libelle, bulle, auto } = modeAffiche(m, duDossier, seuil);
		const lueMs = lueA.get(c);
		const t = titre(c);
		return (
			<li key={c} ref={refFiche(c)} className={s.ligne} data-id={c} data-servie="true" data-nouvelle={marques.nouvelles.has(c) ? 'true' : undefined} style={{ '--c': p.couleur(c) } as CSSProperties}>
				<span className={`${s.note} ${s.injectee}`} role="img" aria-label="Injectée dans la session" title={bulle}>
					◆
				</span>
				<span className={s.corps}>
					<button
						type="button"
						className={s.fiche}
						title={`${bulle}${lueMs === undefined ? '' : `, lue aussi à ${heure(lueMs)}`}\n${c}`}
						aria-keyshortcuts={c === ordreServies[ordreServies.length - 1] ? 'Alt+M' : undefined}
						onClick={() => p.surOuvrirFiche(c)}
					>
						<i aria-hidden="true" />
						<span className={s.titre}>{t}</span>
					</button>
				</span>
				{delta(c)}
				{libelle !== null && (
					<span className={auto ? s.auto : s.mode} title={bulle}>
						{libelle}
					</span>
				)}
				{auto && gestes({ id: c, titre: t, ecartableIci: true, motifIci: '', resume: `${libelle} – injectée par Mnemo`, injecter: false })}
			</li>
		);
	};

	const ligneClassee = (l: Ligne, ancre?: { current: HTMLLIElement | null }): ReactNode => {
		const k = l.classee!;
		const c = chemin(l.id);
		const attend = aServir.chemins.includes(c);
		const note = pourcentage(k.p);
		const auDessus = k.p !== null && k.p >= seuil;
		const raison = l.raison === undefined ? null : libelleRaison(l.raison, l.depuis);
		const pourquoiPasInjectee = !auDessus
			? ''
			: coupures.length > 0
				? "\nAu-dessus du seuil, mais l'injection automatique est coupée : ➤ pour l'injecter."
				: "\nAu-dessus du seuil sans être injectée (affinée après le message, plafond par message, ou déjà vue) : ➤ pour l'injecter.";
		const bulle = `${raison ?? 'Classée pour ce message'}${k.piste ? ' – envoyée en piste dans la session (titre et résumé)' : ''}${l.lueMs === undefined ? '' : `, lue aussi à ${heure(l.lueMs)}`}${pourquoiPasInjectee}\n${c}`;
		const noteBulle = note !== null ? `${note} : chance que la fiche soit utile à ce message (note apprise sur tes jugements)` : `Rang ${k.rang} : ordre seul, sans note calibrée`;
		const resume = `${note ?? `rang ${k.rang}`}${raison === null ? '' : ` – ${raison}`}${k.piste ? ' – piste' : ''}`;
		return (
			<li key={l.id} ref={refFiche(l.id, ancre)} className={s.ligne} data-id={l.id} data-servie="false" data-nouvelle={marques.nouvelles.has(l.id) ? 'true' : undefined} style={{ '--c': p.couleur(c) } as CSSProperties}>
				<span className={`${s.note} ${auDessus ? s.haute : ''}`} title={noteBulle}>
					{note ?? '◇'}
				</span>
				<span className={s.corps}>
					<button type="button" className={s.fiche} title={bulle} onClick={() => p.surOuvrirFiche(c)}>
						<i aria-hidden="true" />
						<span className={s.titre}>{l.titre}</span>
					</button>
					{(attend || raison !== null || k.piste) && (
						<span className={s.sous}>
							{attend ? (
								<span className={s.attend}>injectée au prochain message</span>
							) : (
								<>
									{raison !== null && <span>{raison}</span>}
									{k.piste && <span className={s.piste}>{raison === null ? 'piste' : ' – piste'}</span>}
								</>
							)}
						</span>
					)}
				</span>
				{delta(l.id)}
				{gestes({ id: l.id, titre: l.titre, ecartableIci: true, motifIci: '', resume, injecter: true })}
			</li>
		);
	};

	const lignePlusTot = (l: Ligne, ancre?: { current: HTMLLIElement | null }): ReactNode => {
		const t = l.plusTot!;
		const lue = t.genre === 'lue';
		const c = chemin(l.id);
		const attend = aServir.chemins.includes(c);
		const quoi = lue ? `lue par la session à ${heure(t.heureMs)}` : `piste du message de ${heure(t.heureMs)}`;
		return (
			<li key={l.id} ref={refFiche(l.id, ancre)} className={s.ligne} data-id={l.id} data-servie="false" data-nouvelle={marques.nouvelles.has(l.id) ? 'true' : undefined} style={{ '--c': p.couleur(c) } as CSSProperties}>
				<span
					className={`${s.note} ${lue ? s.lue : ''}`}
					role={lue ? 'img' : undefined}
					aria-label={lue ? 'Lue par la session' : undefined}
					title={lue ? 'Lue par la session' : "Piste d'un message précédent, absente du classement de ce message"}
				>
					{lue ? '◈' : ''}
				</span>
				<span className={s.corps}>
					<button type="button" className={s.fiche} title={`${quoi}${l.raison === undefined ? '' : ` – ${libelleRaison(l.raison)}`}\n${c}`} onClick={() => p.surOuvrirFiche(c)}>
						<i aria-hidden="true" />
						<span className={s.titre}>{l.titre}</span>
					</button>
					<span className={s.sous}>{attend ? <span className={s.attend}>injectée au prochain message</span> : quoi}</span>
				</span>
				{delta(l.id)}
				{gestes({
					id: l.id,
					titre: l.titre,
					ecartableIci: l.ecartable,
					motifIci: lue ? "Indisponible : la session l'a lue d'elle-même, Mnemo ne l'a pas proposée." : 'Indisponible : proposée trop tôt dans la session pour être écartée ici.',
					resume: quoi,
					injecter: true,
				})}
			</li>
		);
	};

	// repère du seuil d'injection : avant la première note sous le seuil (ou après la dernière, toutes au-dessus)
	const indexSeuil = calibre ? classees.findIndex((l) => (l.classee!.p ?? 0) < seuil) : -1;
	const repereSeuil = (
		<li
			key="seuil"
			className={s.seuil}
			role="presentation"
			title={coupures.length > 0 ? `Seuil d'injection automatique : ${pourcentage(seuil)}. Injection coupée : rien n'est injecté au-dessus.` : `Au-dessus de ${pourcentage(seuil)}, Mnemo injecte la fiche entière au message même. Réglages › Système › Contexte injecté.`}
		>
			<span>{coupures.length > 0 ? `seuil ${pourcentage(seuil)} – coupé` : `seuil d’injection ${pourcentage(seuil)}`}</span>
		</li>
	);
	const lignesClassees = classees.flatMap((l, i) => {
		const ligne = ligneClassee(l, ordreServies.length > 0 || i > 0 ? undefined : jonction);
		return i === indexSeuil ? [repereSeuil, ligne] : [ligne];
	});
	if (calibre && indexSeuil === -1 && classees.length > 0) lignesClassees.push(repereSeuil);

	const jonctionVisible = (ordreServies.length > 0 && enLice.length > 0) || coupures.length > 0;
	const etatClassement = { affinage, ordreSeul: ordreSeul ? raisonOrdreSeul(coupes) : null };
	const niveaux = [...new Set(coupures.map((x) => x.niveau))];
	const libelleNiveau = (n: CoupureInjectionVue['niveau']) => (n === 'complets' ? 'modèles complets' : 'sens seul');

	return (
		<div className={s.classement}>
			<div className={s.enteteClassement}>
				<span className={s.lbl} id={`classement-${p.session}`} ref={titreSection} tabIndex={-1}>
					Injecté dans la session
				</span>
				{p.modifiable ? (
					<span className={s.aDroite}>
						<ModelesSession session={p.session} niveau={niveauPropre} classement={etatClassement} />
					</span>
				) : (
					ordreSeul && (
						<span className={cx(s.aDroite, s.ordreSeulFixe)} title={raisonOrdreSeul(coupes)}>
							ordre seul
						</span>
					)
				)}
			</div>
			{ordreServies.length + enLice.length === 0 && !jonctionVisible ? (
				<p className={s.mu}>Aucune fiche pour l’instant.</p>
			) : (
				<ol className={s.liste} aria-label="Injecté dans la session" ref={liste}>
					{ordreServies.map(ligneInjectee)}
					{jonctionVisible && (
						<li key="jonction" ref={ordreServies.length > 0 ? jonction : undefined} className={s.jonction} data-ecart={ordreServies.length > 0 ? 'true' : undefined} role="presentation">
							{coupures.length > 0 && (
								<div className={s.coupure} role="status">
									<p>
										<b>Injection automatique coupée</b>
										{niveaux.length === 1 ? ` (${libelleNiveau(niveaux[0]!)})` : ''} : justesse récente insuffisante.
									</p>
									{coupures.map((x) => (
										<p key={x.niveau} className={s.detailCoupure}>
											{niveaux.length > 1 ? `${libelleNiveau(x.niveau)} : ` : ''}
											{x.motif}.
										</p>
									))}
									<p className={s.detailCoupure}>{calibre ? 'Les % restent affichés ; ➤ pour injecter à la main.' : '➤ pour injecter à la main.'}</p>
									{p.modifiable && (
										<Bouton petit title="Réactiver l'injection automatique : elle se coupera de nouveau si les écarts continuent" onClick={() => void agir(() => reactiver(p.session))}>
											Réactiver
										</Bouton>
									)}
								</div>
							)}
						</li>
					)}
					{lignesClassees}
					{classees.length > 0 && plusTot.length > 0 && (
						<li key="plus-tot" className={s.intertitre} role="presentation">
							Plus tôt dans la session
						</li>
					)}
					{plusTot.map((l, i) => lignePlusTot(l, ordreServies.length > 0 || classees.length > 0 || i > 0 ? undefined : jonction))}
				</ol>
			)}
			{suggestion !== null && p.modifiable && (
				<div className={s.suggestion} role="group" aria-label="Suggestion">
					<p>
						<b>{titre(suggestion.chemin)}</b> écartée dans {suggestion.sessions} sessions : ne plus la suggérer ?
					</p>
					<div className={s.boutons}>
						<Bouton petit genre="primaire" title="Ne plus jamais la suggérer, dans aucune session ; se rétablit depuis la fiche (page Mémoire)" onClick={() => void ecarterToujours(suggestion.chemin)}>
							Ne plus suggérer
						</Bouton>
						<Bouton
							petit
							title="La garder : elle reste écartée de cette session seulement"
							onClick={() => {
								suggestionsGardees.add(`${p.session}|${suggestion.chemin}`);
								rafraichir((n) => n + 1);
							}}
						>
							Garder
						</Bouton>
					</div>
				</div>
			)}
			{jamaisIci.length > 0 && (
				<p className={s.avis}>
					{jamaisIci.map(titre).join(', ')} : plus jamais suggérée{jamaisIci.length > 1 ? 's' : ''}. Se rétablit depuis la fiche, page Mémoire.
				</p>
			)}
			{muetSeul !== null && <p className={s.avis}>{LIBELLES_MUET[muetSeul]}</p>}
			{sansSens && demarrage?.pour === cle ? (
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
			) : avis?.motif === 'chargement' ? (
				<p className={s.avis}>Modèles en chargement : les notes viendront au prochain message.</p>
			) : avis?.motif === 'coupes' || avis?.motif === 'sens' ? (
				<p className={s.avis}>{`Notes indisponibles : ${avis.motif === 'coupes' ? 'modèles coupés' : 'sens seul'}${avis.pourLaSession ? ' pour cette session' : ''}`}</p>
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
								<span className={`${s.titre} ${s.barre}`}>{e.titre}</span>
								{p.modifiable && (
									<button type="button" className={s.retablir} aria-label={`Rétablir ${e.titre}`} title="La remettre parmi les fiches proposées à cette session" onClick={() => void agir(() => retablir(e.id))}>
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
