/**
 * Rangée des agents de la Nouvelle session : une vignette par agent, la liste de choix (`listbox` horizontale) que suivent
 * le clavier et les lecteurs d'écran. ← → (Début, Fin) changent d'agent et suivent le focus ; Entrée lance (le dialogue).
 * Un agent dont le moteur bloque le lancement porte une marque, dite dans son nom accessible et son infobulle.
 */
import type { ProfilVue } from '@mnemo/contrat';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { nomDuMoteur } from '../../../moteurs/noms.ts';
import { modeleDuProfil } from '../../../sessions/agents.ts';
import { AvatarProfil } from '../../commun/AvatarProfil.tsx';
import { useTextes } from '../../../langue/langue.tsx';
import s from './RangeeAgents.module.css';

export function RangeeAgents(p: { agents: readonly ProfilVue[]; choisi: number; eteints: ReadonlySet<string>; surChoisir(i: number): void }): ReactNode {
	const ts = useTextes().sessions;
	const t = ts.nouvelle;
	const vignettes = useRef<(HTMLButtonElement | null)[]>([]);
	const n = p.agents.length;
	const aller = (i: number) => {
		const j = ((i % n) + n) % n;
		p.surChoisir(j);
		vignettes.current[j]?.focus();
	};
	const clavier = (e: KeyboardEvent<HTMLDivElement>) => {
		const cible = { ArrowLeft: p.choisi - 1, ArrowRight: p.choisi + 1, Home: 0, End: n - 1 }[e.key];
		if (cible === undefined || n === 0) return;
		// la rangée garde ses touches : le dialogue ne change pas d'agent une seconde fois
		e.preventDefault();
		e.stopPropagation();
		aller(cible);
	};
	return (
		<div role="listbox" aria-label={t.agents} aria-orientation="horizontal" className={s.rangee} onKeyDown={clavier}>
			{p.agents.map((a, j) => {
				const eteint = p.eteints.has(a.nom);
				const infobulle = `${a.nom} · ${nomDuMoteur(a.moteur)} · ${modeleDuProfil(a, ts).texte}${eteint ? ` · ${t.lancementImpossibleCourt}` : ''}`;
				return (
					<button
						key={a.nom}
						ref={(b) => {
							vignettes.current[j] = b;
						}}
						type="button"
						role="option"
						aria-selected={j === p.choisi}
						aria-label={eteint ? t.eteint(a.nom) : a.nom}
						tabIndex={j === p.choisi ? 0 : -1}
						title={infobulle}
						className={s.vignette}
						data-eteint={eteint || undefined}
						onClick={() => p.surChoisir(j)}
					>
						<AvatarProfil avatar={a.avatar} taille="pleine" sansFond titre={a.nom} />
					</button>
				);
			})}
		</div>
	);
}
