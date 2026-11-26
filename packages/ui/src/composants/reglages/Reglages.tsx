/**
 * Vue Réglages (roue dentée en bas du rail, ⌥,) : trois onglets, chacun avec son panneau à gauche. « Agents » (les profils de
 * session : consigne, skills, plugins, hooks, lancement, avatar, et l'aperçu de ce que reçoit une session), « Réglages »
 * (Branchements : moteurs et app Claude ; Mémoire : rappel et confiance ; Système : service, modèles, couleur) et
 * « Documentation » (comment Mnemo fonctionne, en six chapitres). Une pastille ambre sur « Réglages » quand un moteur attend un geste. Le dernier onglet ouvert est retenu
 * dans ce navigateur. Changer d'onglet avec des modifications non enregistrées est retenu : un avertissement propose de les
 * abandonner ou de rester.
 */
import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMoteurs } from '../../client/hooks.ts';
import { attendUnGeste } from '../../moteurs/circuit.ts';
import { ONGLETS_REGLAGES, ongletRetenu, retenirOnglet, type OngletReglages as Onglet } from '../../reglages/onglet-retenu.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { OngletReglages } from './OngletReglages.tsx';
import { Agents } from './agents/Agents.tsx';
import { Documentation } from './documentation/Documentation.tsx';
import s from './Reglages.module.css';

const TITRES_ONGLETS: Readonly<Record<Onglet, string>> = { agents: 'Agents', reglages: 'Réglages', documentation: 'Documentation' };
const ONGLETS = ONGLETS_REGLAGES.map((cle) => ({ cle, titre: TITRES_ONGLETS[cle] }));

export function Reglages(): ReactNode {
	const [onglet, setOnglet] = useState<Onglet>(ongletRetenu);
	const [demande, setDemande] = useState<Onglet | null>(null);
	const geste = useMoteurs(true).donnees?.moteurs.some(attendUnGeste) ?? false;
	const idGeste = useId();
	const modifie = useRef(false);
	const surModifie = useCallback((m: boolean) => {
		modifie.current = m;
	}, []);

	const ouvrir = (o: Onglet) => {
		modifie.current = false;
		setDemande(null);
		setOnglet(o);
		retenirOnglet(o);
	};
	const choisir = (o: Onglet) => {
		if (o === onglet) return;
		if (modifie.current) setDemande(o);
		else ouvrir(o);
	};
	const clavier = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const i = ONGLETS.findIndex((x) => x.cle === onglet);
		const suivant = ONGLETS[(i + (e.key === 'ArrowRight' ? 1 : ONGLETS.length - 1)) % ONGLETS.length]!;
		choisir(suivant.cle);
		document.getElementById(`onglet-${suivant.cle}`)?.focus();
	};

	return (
		<section className={s.reglages} aria-label="Réglages">
			<header className={s.barreOnglets}>
				<h1 className={s.titre}>Réglages</h1>
				<div role="tablist" aria-label="Sections des réglages" className={s.onglets} onKeyDown={clavier}>
					{ONGLETS.map((o) => (
						<button
							key={o.cle}
							id={`onglet-${o.cle}`}
							type="button"
							role="tab"
							aria-selected={onglet === o.cle}
							aria-controls={`panneau-${o.cle}`}
							aria-describedby={o.cle === 'reglages' && geste ? idGeste : undefined}
							tabIndex={onglet === o.cle ? 0 : -1}
							className={s.onglet}
							onClick={() => choisir(o.cle)}
						>
							{o.titre}
							{o.cle === 'reglages' && geste && <span className={s.pastille} aria-hidden="true" title="Un moteur attend un geste (Branchements)" />}
						</button>
					))}
				</div>
				{geste && (
					<span id={idGeste} className={s.horsEcran}>
						Un moteur attend un geste (Branchements)
					</span>
				)}
			</header>
			{demande !== null && (
				<div className={s.retenu} role="alert">
					<p>Modifications non enregistrées dans cet onglet : les abandonner ?</p>
					<div className={s.actions}>
						<Bouton onClick={() => ouvrir(demande)}>Abandonner</Bouton>
						<Bouton genre="primaire" onClick={() => setDemande(null)}>
							Rester
						</Bouton>
					</div>
				</div>
			)}
			<div id={`panneau-${onglet}`} role="tabpanel" aria-labelledby={`onglet-${onglet}`} className={s.panneau}>
				{onglet === 'agents' ? (
					<Agents surModifie={surModifie} />
				) : onglet === 'reglages' ? (
					<OngletReglages surModifie={surModifie} />
				) : (
					<Documentation />
				)}
			</div>
		</section>
	);
}
