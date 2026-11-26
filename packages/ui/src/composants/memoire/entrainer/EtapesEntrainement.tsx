/**
 * Les trois étapes de l'entraînement, en cartes numérotées ; l'étape utile (`etapeUtile`) est mise en avant et porte le seul
 * bouton principal de la page. 1. Préparer des messages (jauge : validés sur ~100 conseillés). 2. Juger (« Juger » ou
 * « Relire (n) » ouvre l'écran de jugement ; « Accepter les sûres » s'il y a des propositions à relire, annulable ;
 * « Pré-juger avec Claude », son coût dit avant : un appel par message). 3. Apprendre. Un geste indisponible est grisé avec sa
 * raison sous lui (pendant une tâche : le bandeau de la tâche). Un refus du service s'affiche dans la carte de son geste.
 * `focusAuRetour` (retour de l'écran de jugement) : le focus va au bouton principal de l'étape utile.
 */
import type { VueEntrainement } from '@mnemo/contrat';
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useActionsEntrainement } from '../../../client/hooks.ts';
import { accorder, etapeUtile, MESSAGES_CONSEILLES, NOMBRE_A_PREPARER, PREPARER_MAX, type Etape } from '../../../memoire/entrainement.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import { cx } from '../../commun/classes.ts';
import r from '../../commun/Reflet.module.css';
import s from './Entrainer.module.css';
import { useGeste, type Geste } from './useGeste.ts';

/** `idTache` : l'élément qui nomme la tâche en cours (raison des gestes indisponibles), null sans tâche. */
export function EtapesEntrainement(p: { vue: VueEntrainement; idTache: string | null; focusAuRetour?: boolean; surJuger(): void }): ReactNode {
	const v = p.vue;
	const b = v.banc;
	const actions = useActionsEntrainement();
	const geste = useGeste();
	const id = useId();
	const utile = etapeUtile(v);
	const [nombre, setNombre] = useState(String(NOMBRE_A_PREPARER));
	const [acceptes, setAcceptes] = useState<number | null>(null);
	const liste = useRef<HTMLOListElement>(null);
	// au retour de l'écran de jugement, le focus ne se perd pas : il va au geste qui suit (une fois, au montage)
	const focusAuRetour = useRef(p.focusAuRetour === true);
	useEffect(() => {
		if (focusAuRetour.current) liste.current?.querySelector<HTMLElement>('[data-principal]')?.focus();
	}, []);

	const n = Number(nombre);
	const nombreValide = Number.isInteger(n) && n >= 1 && n <= PREPARER_MAX;
	// pendant une tâche, les gestes qui en lancent une attendent ; leur raison est le bandeau de la tâche
	const occupe = p.idTache !== null ? { raison: p.idTache } : false;
	const genre = (etape: Etape) => (utile === etape ? 'primaire' : 'normal');
	const principal = (etape: Etape) => (utile === etape ? { 'data-principal': true } : {});
	const libelle = (nom: string, texte: string) => (geste.enCours === nom ? <span className={r.reflet}>{texte}</span> : texte);

	const preparer = (e: FormEvent) => {
		e.preventDefault();
		if (occupe || !nombreValide) return;
		setAcceptes(null);
		void geste.agir('preparer', () => actions.preparer(n));
	};
	const accepterSures = () =>
		void geste.agir('accepter', async () => {
			setAcceptes(await actions.accepterSures());
		});
	const annuler = () =>
		void geste.agir('annuler', async () => {
			await actions.annuler();
			setAcceptes(null);
		});

	const raisonJuger = b.messages === 0 ? 'Prépare d’abord des messages.' : b.aJuger === 0 ? 'Tous les messages préparés sont jugés.' : null;
	// rien à juger (rien de préparé, ou tout est jugé) : la raison de « Juger » vaut aussi pour Claude (dite une fois)
	const sansMessage = raisonJuger !== null && v.juge.disponible;
	const raisonClaude = !v.juge.disponible ? (v.juge.raison ?? 'Claude Code est introuvable sur ce poste.') : b.aPrejuger === 0 && !sansMessage ? 'Chaque message à juger a déjà ses propositions.' : null;
	const raisonApprendre = b.paires === 0 ? 'Aucun jugement validé : juge des messages d’abord.' : null;

	return (
		<ol ref={liste} className={s.etapes} aria-label="Étapes de l’entraînement">
			<li className={s.etape} data-utile={utile === 1 || undefined} aria-current={utile === 1 ? 'step' : undefined}>
				<TitreEtape numero={1} titre="Préparer des messages" />
				<p className={s.aide}>Tirés de tes dernières sessions, avec les fiches que Mnemo aurait proposées.</p>
				<Jauge valides={b.valides} />
				<p className={s.chiffres}>{accorder(b.messages, 'message préparé', 'messages préparés')}</p>
				<form className={s.gestes} onSubmit={preparer} noValidate>
					<label className={s.nombre}>
						<input
							type="number"
							inputMode="numeric"
							name="nombre"
							min={1}
							max={PREPARER_MAX}
							value={nombre}
							aria-label="Nombre de messages à préparer"
							aria-invalid={!nombreValide || undefined}
							aria-describedby={nombreValide ? undefined : `${id}-nombre`}
							onChange={(e) => setNombre(e.target.value)}
						/>
						<span>messages</span>
					</label>
					<Bouton type="submit" genre={genre(1)} {...principal(1)} className={s.cible} indisponible={occupe} title={occupe ? 'Une tâche est en cours' : undefined}>
						{libelle('preparer', 'Préparer')}
					</Bouton>
				</form>
				{!nombreValide && (
					<p id={`${id}-nombre`} className={s.refus}>
						De 1 à {PREPARER_MAX} messages.
					</p>
				)}
				<Refus geste={geste} ou="preparer" />
			</li>

			<li className={s.etape} data-utile={utile === 2 || undefined} aria-current={utile === 2 ? 'step' : undefined}>
				<TitreEtape numero={2} titre="Juger" />
				<p className={s.chiffres}>
					{b.messages === 0 ? 'Aucun message préparé' : `${b.aJuger} à juger`}
					{b.aRelire > 0 && <span className={s.discret}>{`, dont ${b.aRelire} pré-jugés par Claude, à relire`}</span>}
				</p>
				<div className={s.gestes}>
					<Bouton genre={genre(2)} {...principal(2)} className={s.cible} indisponible={raisonJuger !== null && { raison: `${id}-juger` }} onClick={p.surJuger}>
						{b.aRelire > 0 ? `Relire (${b.aRelire})` : 'Juger'}
					</Bouton>
					{b.aRelire > 0 && (
						<Bouton className={s.cible} disabled={geste.enCours !== null} title="Valide les messages dont Claude est sûr à 90 % ou plus pour chaque fiche" onClick={accepterSures}>
							{libelle('accepter', 'Accepter les sûres')}
						</Bouton>
					)}
				</div>
				{raisonJuger !== null && (
					<p id={`${id}-juger`} className={s.aide}>
						{raisonJuger}
					</p>
				)}
				{acceptes !== null && (
					<p className={s.fait} role="status">
						{acceptes === 0 ? 'Aucun message sûr à 90 % ou plus : relis-les.' : `${accorder(acceptes, 'message validé', 'messages validés')} avec les propositions sûres.`}
						{acceptes > 0 && (
							<Bouton petit className={s.cible} disabled={geste.enCours !== null} onClick={annuler}>
								{libelle('annuler', 'Annuler')}
							</Bouton>
						)}
					</p>
				)}
				<Refus geste={geste} ou="accepter" />
				<Refus geste={geste} ou="annuler" />
				<div className={s.claude}>
					<Bouton
						className={s.cible}
						indisponible={sansMessage ? { raison: `${id}-juger` } : raisonClaude !== null ? { raison: `${id}-claude` } : occupe}
						title={occupe && raisonClaude === null ? 'Une tâche est en cours' : undefined}
						onClick={() => void geste.agir('prejuger', actions.prejuger)}
					>
						{libelle('prejuger', 'Pré-juger avec Claude')}
					</Bouton>
					{!sansMessage && (
						<p id={`${id}-claude`} className={s.aide}>
							{raisonClaude ?? `${accorder(b.aPrejuger, 'appel')} à Claude Code, un par message, sur ton abonnement.`}
						</p>
					)}
				</div>
				<Refus geste={geste} ou="prejuger" />
			</li>

			<li className={s.etape} data-utile={utile === 3 || undefined} aria-current={utile === 3 ? 'step' : undefined}>
				<TitreEtape numero={3} titre="Apprendre" />
				<p className={s.chiffres}>
					{accorder(b.paires, 'fiche jugée', 'fiches jugées')}
					<span className={s.discret}>{` dans ${accorder(b.valides, 'message validé', 'messages validés')}`}</span>
				</p>
				<div className={s.gestes}>
					<Bouton
						genre={genre(3)}
						{...principal(3)}
						className={s.cible}
						indisponible={raisonApprendre !== null ? { raison: `${id}-apprendre` } : occupe}
						title={occupe && raisonApprendre === null ? 'Une tâche est en cours' : undefined}
						onClick={() => void geste.agir('apprendre', actions.apprendre)}
					>
						{libelle('apprendre', 'Apprendre la note')}
					</Bouton>
				</div>
				<p id={`${id}-apprendre`} className={s.aide}>
					{raisonApprendre ?? 'Le nouveau modèle remplace l’actuel, même refusé ; tu peux revenir au modèle d’avant (menu ⋯).'}
				</p>
				<Refus geste={geste} ou="apprendre" />
			</li>
		</ol>
	);
}

function TitreEtape(p: { numero: Etape; titre: string }): ReactNode {
	return (
		<h3 className={s.titreEtape}>
			<span className={s.numero} aria-hidden="true">
				{p.numero}
			</span>
			<span className={s.horsEcran}>{`Étape ${p.numero} : `}</span>
			{p.titre}
		</h3>
	);
}

/** Jauge des messages validés sur ceux conseillés ; au-delà, pleine. */
function Jauge(p: { valides: number }): ReactNode {
	const part = Math.min(1, p.valides / MESSAGES_CONSEILLES);
	return (
		<div className={s.jauge}>
			<span className={s.texteJauge}>
				<span className={s.compte}>{p.valides}</span> validés sur ~{MESSAGES_CONSEILLES} conseillés
			</span>
			<div
				className={cx(s.barre, part >= 1 && s.pleine)}
				role="meter"
				aria-label="Messages validés"
				aria-valuemin={0}
				aria-valuemax={MESSAGES_CONSEILLES}
				aria-valuenow={Math.min(p.valides, MESSAGES_CONSEILLES)}
				style={{ '--part': part } as CSSProperties}
			/>
		</div>
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
