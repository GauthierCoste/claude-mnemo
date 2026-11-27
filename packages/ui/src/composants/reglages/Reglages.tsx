/**
 * Vue Réglages (roue dentée en bas du rail, ⌥,) : trois onglets, chacun avec son panneau à gauche. « Agents » (les profils de
 * session : consigne, skills, plugins, hooks, lancement, avatar, et l'aperçu de ce que reçoit une session), « Réglages »
 * (Branchements : moteurs et app Claude ; Mémoire : rappel, recherche, confiance ; Système : service, modèles, couleur, langue) et
 * « Documentation » (fonctionnement de Mnemo, une page et son sommaire). Une pastille ambre sur « Réglages » quand un moteur attend un geste. Le dernier onglet ouvert est retenu
 * dans ce navigateur. Changer d'onglet avec des modifications non enregistrées est retenu : un avertissement propose de les
 * abandonner ou de rester.
 */
import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMoteurs } from '../../client/hooks.ts';
import { useTextes } from '../../langue/langue.tsx';
import { attendUnGeste } from '../../moteurs/circuit.ts';
import { ONGLETS_REGLAGES, ongletRetenu, retenirOnglet, type OngletReglages as Onglet } from '../../reglages/onglet-retenu.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { OngletReglages } from './OngletReglages.tsx';
import { Agents } from './agents/Agents.tsx';
import { Documentation } from './documentation/Documentation.tsx';
import s from './Reglages.module.css';

export function Reglages(): ReactNode {
	const t = useTextes();
	const v = t.reglages.vue;
	const listeOnglets = ONGLETS_REGLAGES.map((cle) => ({ cle, titre: v.onglets[cle] }));
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
		const i = listeOnglets.findIndex((x) => x.cle === onglet);
		const suivant = listeOnglets[(i + (e.key === 'ArrowRight' ? 1 : listeOnglets.length - 1)) % listeOnglets.length]!;
		choisir(suivant.cle);
		document.getElementById(`onglet-${suivant.cle}`)?.focus();
	};

	return (
		<section className={s.reglages} aria-label={v.titre}>
			<header className={s.barreOnglets}>
				<h1 className={s.titre}>{v.titre}</h1>
				<div role="tablist" aria-label={v.sections} className={s.onglets} onKeyDown={clavier}>
					{listeOnglets.map((o) => (
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
							{o.cle === 'reglages' && geste && <span className={s.pastille} aria-hidden="true" title={v.geste} />}
						</button>
					))}
				</div>
				{geste && (
					<span id={idGeste} className={s.horsEcran}>
						{v.geste}
					</span>
				)}
			</header>
			{demande !== null && (
				<div className={s.retenu} role="alert">
					<p>{v.retenu}</p>
					<div className={s.actions}>
						<Bouton onClick={() => ouvrir(demande)}>{t.reglages.gestes.abandonner}</Bouton>
						<Bouton genre="primaire" onClick={() => setDemande(null)}>
							{t.reglages.gestes.rester}
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
