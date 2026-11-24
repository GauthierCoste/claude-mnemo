/**
 * Vue Réglages (roue dentée en bas du rail, ⌥,) : trois onglets, « Profils » (les profils de session : consigne, skills,
 * plugins, hooks, lancement, avatar, et l'aperçu de ce que reçoit une session), « Système » (les réglages du dossier) et
 * « App Claude » (les serveurs MCP de l'app Claude : brancher la mémoire, gérer les autres).
 * Le dernier onglet ouvert est retenu dans ce navigateur. Changer d'onglet avec des modifications non enregistrées est
 * retenu : un avertissement propose de les abandonner ou de rester.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bouton } from '../commun/Bouton.tsx';
import { AppClaude } from './claude-desktop/AppClaude.tsx';
import { Profils } from './profils/Profils.tsx';
import { ReglagesSysteme } from './ReglagesSysteme.tsx';
import s from './Reglages.module.css';

type Onglet = 'profils' | 'systeme' | 'app-claude';
const ONGLETS: { cle: Onglet; titre: string }[] = [
	{ cle: 'profils', titre: 'Profils' },
	{ cle: 'systeme', titre: 'Système' },
	{ cle: 'app-claude', titre: 'App Claude' },
];
const CLE_ONGLET = 'mnemo.reglages.onglet';

function ongletRetenu(): Onglet {
	try {
		const v = localStorage.getItem(CLE_ONGLET);
		return ONGLETS.find((o) => o.cle === v)?.cle ?? 'profils';
	} catch {
		return 'profils';
	}
}

function retenirOnglet(o: Onglet): void {
	try {
		localStorage.setItem(CLE_ONGLET, o);
	} catch {
		// stockage indisponible : l'onglet n'est pas retenu
	}
}

export function Reglages(): ReactNode {
	const [onglet, setOnglet] = useState<Onglet>(ongletRetenu);
	const [demande, setDemande] = useState<Onglet | null>(null);
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
							tabIndex={onglet === o.cle ? 0 : -1}
							className={s.onglet}
							onClick={() => choisir(o.cle)}
						>
							{o.titre}
						</button>
					))}
				</div>
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
				{onglet === 'profils' ? (
					<Profils surModifie={surModifie} />
				) : onglet === 'systeme' ? (
					<ReglagesSysteme surModifie={surModifie} />
				) : (
					<AppClaude surModifie={surModifie} />
				)}
			</div>
		</section>
	);
}
