/**
 * Écran de jugement (spec « entraîner la note », D3), ouvert par « Juger » ou « Relire (n) », dans la page. Un écran = un
 * message (et le message d'avant s'il est joint, atténué) avec ses fiches candidates dans l'ordre reçu (déjà mêlé par le
 * service) ; chaque fiche : « Utile », « Pas utile », « Je ne sais pas » (`FicheAJuger`), pré-remplie par le jugement déjà donné
 * ou la proposition du juge. En bas, collée : « Le reste n'est pas utile » (coché, avec le nombre de fiches qu'il touchera),
 * « Passer », « Rien d'utile ici », « Valider ». En tête : la progression, « Annuler le dernier » (après une réponse de cet
 * écran : le message rétabli se rouvre), « Retour » (Échap). Après la dernière réponse : « Tout est jugé » et le retour à la
 * page, qui propose alors d'apprendre. Un refus du service (409, réseau) est dit à côté de son geste.
 *
 * Clavier, seulement quand la vue Mémoire est affichée, le focus sur l'écran ou nulle part (pas dans la palette, une modale,
 * le tiroir de l'archiviste) et hors d'un champ de saisie ou d'un terminal : ↑/↓ change de fiche
 * (le focus va sur son choix), o / n / i la juge et passe à la suivante, Entrée valide (sauf sur un bouton, un lien ou un
 * résumé, qui gardent leur Entrée), Échap revient à la page (sauf si la palette ou le tiroir de l'archiviste l'ont prise).
 */
import type { DemandeReponseMessage, JugementVue, VueMessageAJuger } from '@mnemo/contrat';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useActionsEntrainement, useEntrainement, useMessageAJuger } from '../../../client/hooks.ts';
import { accorder } from '../../../memoire/entrainement.ts';
import { choixDeDepart, demandePasser, demandeSilence, demandeValider, marqueeUtile, progression, sansReponse, TOUCHES_JUGEMENTS, type Choix } from '../../../memoire/jugement.ts';
import { useNavigation } from '../../../navigation.tsx';
import { origineDeLaTouche } from '../../../raccourcis.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import { cx } from '../../commun/classes.ts';
import r from '../../commun/Reflet.module.css';
import { FicheAJuger } from './FicheAJuger.tsx';
import s from './JugerMessage.module.css';
import { useGeste, type Geste } from './useGeste.ts';

/** Ce qu'on lit : un message (`indice`, ou le prochain si null), `tour` changeant à chaque lecture ; ou la fin. */
type Lecture = { tour: number; indice: number | null } | 'fin';

/** Les gestes de la barre du bas, nommés pour `useGeste`. */
type GesteMessage = 'valider' | 'silence' | 'passer';

/** Touche reçue par le message affiché ; vrai si elle a été prise. */
type Poignee = (e: KeyboardEvent) => void;

export function JugerMessage(p: { surFermer(): void }): ReactNode {
	const nav = useNavigation();
	const id = useId();
	const actions = useActionsEntrainement();
	const sautes = useEntrainement().donnees?.banc.sautes ?? 0;
	const geste = useGeste();
	const [lecture, setLecture] = useState<Lecture>({ tour: 0, indice: null });
	const [faits, setFaits] = useState(0);
	const [annulables, setAnnulables] = useState(0);
	const lu = useMessageAJuger(lecture === 'fin' ? null : `${id}:${lecture.tour}`, lecture === 'fin' ? null : lecture.indice);
	const pret = lecture !== 'fin' && !lu.chargement && lu.erreur === null && lu.donnees !== undefined;
	const lue = pret ? lu.donnees!.message : undefined;
	// le message affiché : gardé (estompé) pendant la lecture du suivant ; remplacé seulement par un message lu
	const [affiche, setAffiche] = useState<{ cle: string; m: VueMessageAJuger } | null>(null);
	const cleLue = lue && lecture !== 'fin' ? `${lecture.tour}:${lue.indice}` : null;
	if (lue && cleLue !== null && affiche?.cle !== cleLue) setAffiche({ cle: cleLue, m: lue });
	const fin = lecture === 'fin' || lue === null;

	const aller = (indice: number | null) => setLecture((l) => (indice === null ? 'fin' : { tour: (l === 'fin' ? 0 : l.tour) + 1, indice }));
	const repondre = (ou: GesteMessage, d: DemandeReponseMessage) =>
		void geste.agir(ou, async () => {
			const suivant = await actions.repondre(d);
			setFaits((n) => n + 1);
			setAnnulables((n) => n + 1);
			aller(suivant);
		});
	const annuler = () =>
		void geste.agir('annuler', async () => {
			const indice = await actions.annuler();
			setFaits((n) => Math.max(0, n - 1));
			setAnnulables((n) => Math.max(0, n - 1));
			aller(indice);
		});

	// le clavier : seulement la vue Mémoire affichée (elle reste montée cachée), hors champ de saisie et terminal
	const poignee = useRef<Poignee | null>(null);
	const fermer = useRef(p.surFermer);
	fermer.current = p.surFermer;
	const ecran = useRef<HTMLElement>(null);
	const visible = nav.vue === 'memoire';
	const { paletteOuverte, tiroirOuvert } = nav;
	useEffect(() => {
		if (!visible) return;
		const surTouche = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.isComposing || e.altKey || e.metaKey || e.ctrlKey) return;
			if (origineDeLaTouche(e.target) !== 'page') return;
			// le focus ailleurs que sur l'écran (palette, modale, tiroir, onglets…) : la touche n'est pas pour lui
			const cible = e.target;
			if (cible instanceof Node && cible !== document.body && cible !== document.documentElement && cible !== document && !ecran.current?.contains(cible)) return;
			if (e.key === 'Escape') {
				// la palette ou le tiroir de l'archiviste prennent Échap d'abord (raccourcis de l'application)
				if (paletteOuverte || tiroirOuvert) return;
				e.preventDefault();
				fermer.current();
				return;
			}
			poignee.current?.(e);
		};
		document.addEventListener('keydown', surTouche);
		return () => document.removeEventListener('keydown', surTouche);
	}, [visible, paletteOuverte, tiroirOuvert]);

	const titre = !fin ? 'Juger' : faits > 0 ? 'Tout est jugé' : 'Rien à juger';
	return (
		<section ref={ecran} className={s.juger} aria-labelledby={`${id}-titre`}>
			<div className={s.tete}>
				<h3 id={`${id}-titre`} className={s.titre}>
					{titre}
				</h3>
				{!fin && affiche !== null && <p className={s.progression}>{progression(faits + 1, affiche.m)}</p>}
				<div className={s.gestesTete}>
					{annulables > 0 && (
						<Bouton petit className={s.cible} disabled={geste.enCours !== null} title="Rouvre le message de ta dernière réponse, sans elle" onClick={annuler}>
							{geste.enCours === 'annuler' ? <span className={r.reflet}>Annuler le dernier</span> : 'Annuler le dernier'}
						</Bouton>
					)}
					{/* à la fin, « Revenir à l'entraînement » le dit déjà */}
					{!fin && (
						<Bouton petit className={s.cible} title="Revenir à l’entraînement (Échap)" aria-keyshortcuts="Escape" onClick={p.surFermer}>
							Retour
						</Bouton>
					)}
				</div>
				{!fin && <Raccourcis />}
			</div>
			<Refus geste={geste} ou="annuler" />

			{fin ? (
				<Fin faits={faits} sautes={sautes} surFermer={p.surFermer} />
			) : lu.erreur !== null ? (
				<p className={s.refus} role="alert">
					Message illisible : {lu.erreur}{' '}
					<Bouton petit className={s.cible} onClick={lu.recharger}>
						Relire
					</Bouton>
				</p>
			) : affiche !== null ? (
				<MessageAJuger key={affiche.cle} m={affiche.m} inerte={!pret || geste.enCours !== null} geste={geste} poignee={poignee} surRepondre={repondre} />
			) : (
				<Squelette />
			)}
		</section>
	);
}

/** Le message affiché, ses fiches et la barre du bas ; `inerte` : un geste ou la lecture du suivant est en cours. */
function MessageAJuger(p: { m: VueMessageAJuger; inerte: boolean; geste: Geste; poignee: { current: Poignee | null }; surRepondre(ou: GesteMessage, d: DemandeReponseMessage): void }): ReactNode {
	const { m } = p;
	const id = useId();
	const [choix, setChoix] = useState<Choix>(() => choixDeDepart(m.candidates));
	const [reste, setReste] = useState(true);
	const liste = useRef<HTMLOListElement>(null);
	/** La fiche courante quand le focus n'est sur aucune : la dernière quittée (la première au départ). */
	const courante = useRef(0);

	const restantes = sansReponse(m.candidates, choix);
	const repondues = m.candidates.length - restantes;
	const raisonValider = repondues === 0 && !reste ? 'Réponds pour une fiche au moins, ou coche « Le reste n’est pas utile ».' : null;
	const raisonSilence = marqueeUtile(choix) ? 'Une fiche est marquée « Utile ».' : null;

	const choisir = (chemin: string, j: JugementVue) => setChoix((c) => ({ ...c, [chemin]: j }));
	const valider = () => {
		if (p.inerte || raisonValider !== null) return;
		p.surRepondre('valider', demandeValider(m, choix, reste));
	};

	const fiches = () => [...(liste.current?.querySelectorAll<HTMLElement>('[data-fiche]') ?? [])];
	/** Le focus sur le choix de la fiche `k` (le coché, sinon le premier), ou sur le choix `j` s'il est donné. */
	const allerA = (k: number, j?: JugementVue) => {
		const li = fiches()[k];
		if (li === undefined) return;
		courante.current = k;
		const radio = j !== undefined ? li.querySelector<HTMLInputElement>(`input[value="${j}"]`) : (li.querySelector<HTMLInputElement>('input:checked') ?? li.querySelector<HTMLInputElement>('input'));
		radio?.focus();
	};
	const ficheDuFocus = () => {
		const k = fiches().findIndex((li) => li.contains(document.activeElement));
		return k >= 0 ? k : courante.current;
	};

	// la première fiche prend le focus quand le message est prêt, une fois (la clé du composant change avec le message) : on
	// juge au clavier sans viser
	const focusDonne = useRef(false);
	// démonté (fin) : ses touches ne valent plus, Entrée ne renverrait pas un message déjà répondu ; le message suivant, monté
	// avant ce nettoyage, garde la sienne
	const mienne = useRef<Poignee | null>(null);
	useEffect(() => {
		const poignee = p.poignee;
		return () => {
			if (poignee.current === mienne.current) poignee.current = null;
		};
	}, [p.poignee]);
	useEffect(() => {
		if (p.inerte || focusDonne.current) return;
		focusDonne.current = true;
		allerA(0);
	});

	mienne.current = p.poignee.current = (e) => {
		if (p.inerte) return;
		const n = m.candidates.length;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const k = ficheDuFocus();
			allerA(Math.min(n - 1, Math.max(0, k + (e.key === 'ArrowDown' ? 1 : -1))));
			return;
		}
		const j = TOUCHES_JUGEMENTS[e.key.toLowerCase()];
		if (j !== undefined) {
			e.preventDefault();
			const k = ficheDuFocus();
			const c = m.candidates[k];
			if (c === undefined) return;
			choisir(c.chemin, j);
			// la suivante ; la dernière garde le focus, sur le choix fait
			if (k + 1 < n) allerA(k + 1);
			else allerA(k, j);
			return;
		}
		if (e.key === 'Enter') {
			// un bouton, un lien ou un résumé gardent leur Entrée
			if (e.target instanceof Element && e.target.closest('button, a, summary')) return;
			e.preventDefault();
			valider();
		}
	};

	return (
		<div className={cx(s.corps, p.inerte && s.inerte)} aria-busy={p.inerte}>
			{m.precedent !== null && (
				<div className={s.precedent}>
					<span className={s.etiquette}>Message d’avant</span>
					<p className={s.textePrecedent}>{m.precedent}</p>
				</div>
			)}
			<blockquote className={s.message} aria-label="Message à juger">
				{m.message}
			</blockquote>
			{(m.valide || m.silence || m.saute) && <p className={s.aide}>{m.saute ? 'Passé auparavant : ta réponse le remet parmi les messages jugés.' : 'Déjà validé : ta réponse remplace la précédente.'}</p>}

			<ol ref={liste} className={s.fiches} aria-label="Fiches proposées pour ce message" onFocus={(e) => (courante.current = Math.max(0, fiches().findIndex((li) => li.contains(e.target))))}>
				{m.candidates.map((c) => (
					<FicheAJuger key={c.chemin} candidate={c} choix={choix[c.chemin]} inerte={p.inerte} surChoix={(j) => choisir(c.chemin, j)} />
				))}
			</ol>

			<div className={s.barre}>
				<label className={s.reste}>
					<input type="checkbox" checked={reste} disabled={p.inerte} onChange={(e) => setReste(e.target.checked)} aria-describedby={`${id}-reste`} />
					<span>Le reste n’est pas utile</span>
					<span id={`${id}-reste`} className={s.compte}>
						{restantes === 0 ? 'aucune fiche sans réponse' : `${accorder(restantes, 'fiche sans réponse', 'fiches sans réponse')}`}
					</span>
				</label>
				<div className={s.gestes}>
					<Bouton className={s.cible} disabled={p.inerte} title="Mettre ce message de côté sans le juger" onClick={() => p.surRepondre('passer', demandePasser(m))}>
						<Libelle geste={p.geste} nom="passer" texte="Passer" />
					</Bouton>
					<Bouton
						className={s.cible}
						disabled={p.inerte}
						indisponible={raisonSilence !== null && { raison: `${id}-silence` }}
						title="Aucune fiche n’aurait aidé à répondre à ce message"
						onClick={() => p.surRepondre('silence', demandeSilence(m, choix))}
					>
						<Libelle geste={p.geste} nom="silence" texte="Rien d’utile ici" />
					</Bouton>
					<Bouton
						genre="primaire"
						className={s.cible}
						disabled={p.inerte}
						indisponible={raisonValider !== null && { raison: `${id}-valider` }}
						aria-keyshortcuts="Enter"
						onClick={valider}
					>
						<Libelle geste={p.geste} nom="valider" texte="Valider" />
					</Bouton>
				</div>
				{raisonSilence !== null && (
					<p id={`${id}-silence`} className={s.aide}>
						« Rien d’utile ici » : {raisonSilence.charAt(0).toLocaleLowerCase('fr-FR') + raisonSilence.slice(1)}
					</p>
				)}
				{raisonValider !== null && (
					<p id={`${id}-valider`} className={s.aide}>
						{raisonValider}
					</p>
				)}
				<Refus geste={p.geste} ou="valider" />
				<Refus geste={p.geste} ou="silence" />
				<Refus geste={p.geste} ou="passer" />
			</div>
		</div>
	);
}

/** Le libellé d'un geste, avec le reflet tant qu'il est en cours. */
function Libelle(p: { geste: Geste; nom: string; texte: string }): ReactNode {
	return p.geste.enCours === p.nom ? <span className={r.reflet}>{p.texte}</span> : p.texte;
}

/** Après la dernière réponse (ou rien à juger dès l'ouverture) : le retour à la page, qui propose alors d'apprendre. */
function Fin(p: { faits: number; sautes: number; surFermer(): void }): ReactNode {
	const gestes = useRef<HTMLDivElement>(null);
	// Entrée y revient : le focus sur le bouton
	useEffect(() => gestes.current?.querySelector('button')?.focus(), []);
	return (
		<div className={s.fin}>
			<p className={s.texteFin}>{p.faits > 0 ? 'Tes réponses sont enregistrées. Reviens à l’entraînement pour apprendre la note.' : 'Aucun message n’attend de jugement : prépares-en d’autres.'}</p>
			{p.sautes > 0 && <p className={s.aide}>{`${accorder(p.sautes, 'message passé reste', 'messages passés restent')} de côté.`}</p>}
			<div ref={gestes}>
				<Bouton genre="primaire" className={s.cible} onClick={p.surFermer}>
					Revenir à l’entraînement
				</Bouton>
			</div>
		</div>
	);
}

/** L'aide des raccourcis, discrète, sous le titre. */
function Raccourcis(): ReactNode {
	const touches: [string[], string][] = [
		[['↑', '↓'], 'fiche'],
		[['o'], 'Utile'],
		[['n'], 'Pas utile'],
		[['i'], 'Je ne sais pas'],
		[['Entrée'], 'Valider'],
		[['Échap'], 'Retour'],
	];
	return (
		<p className={s.raccourcis}>
			<span className={s.horsEcran}>Raccourcis : </span>
			{touches.map(([ks, effet]) => (
				<span key={effet} className={s.raccourci}>
					{ks.map((k) => (
						<kbd key={k}>{k}</kbd>
					))}{' '}
					{effet}
				</span>
			))}
		</p>
	);
}

function Refus(p: { geste: Geste; ou: string }): ReactNode {
	if (p.geste.refus?.ou !== p.ou) return null;
	return (
		<p className={s.refus} role="alert">
			{p.geste.refus.message}
		</p>
	);
}

/** À la forme de l'écran : le message, puis trois fiches. */
function Squelette(): ReactNode {
	return (
		<div className={s.corps} aria-busy="true">
			<div className={s.squeletteMessage} />
			<div className={s.squeletteFiche} />
			<div className={s.squeletteFiche} />
			<div className={s.squeletteFiche} />
		</div>
	);
}
