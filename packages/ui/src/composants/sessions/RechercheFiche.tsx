/**
 * Recherche ciblée d'une fiche, dans le panneau Contexte (« Injecté dans la session ») : un champ d'une ligne, juste sous la
 * jonction (sans fiche injectée, en tête du pas vu). Dès deux caractères, la route `recherche` du service (celle de la
 * palette, `useRechercheMoteur` : mots seuls après une courte attente, puis l'appel complet ; la requête en cours abandonnée
 * à chaque frappe), bornée aux fiches (`genre=fiche`, hors documents), sous sa clé de remplacement `fiche`. Les résultats,
 * une ligne par fiche dans l'ordre du moteur, remplacent le classement sous le champ ; `ClassementEnDirect` les rend
 * (`rendreTrouvee`) avec ses lignes et ses gestes ; pendant la recherche d'un texte changé, celles du précédent restent,
 * estompées. États : « Recherche… » (reflet), aucune fiche, erreur. Échap ou la croix
 * vident le champ et rendent le classement ; ↓ va au premier résultat.
 */
import type { TrouveRechercheVue } from '@mnemo/contrat';
import { useId, useRef, type ReactNode } from 'react';
import { titreDe } from '../../palette/presentation.ts';
import { LONGUEUR_MIN_RECHERCHE, useRechercheMoteur } from '../../palette/useRechercheMoteur.ts';
import r from '../commun/Reflet.module.css';
import s from './RechercheFiche.module.css';

/** Vrai quand la saisie lance une recherche : ses résultats remplacent alors le classement. */
export function rechercheActive(texte: string): boolean {
	return texte.trim().length >= LONGUEUR_MIN_RECHERCHE;
}

export type FicheTrouvee = { chemin: string; titre: string };

/** Une ligne par fiche, dans l'ordre du moteur (une information trouvée vaut pour sa fiche, au rang de la première). */
export function fichesTrouvees(trouves: readonly TrouveRechercheVue[]): FicheTrouvee[] {
	const vues = new Map<string, FicheTrouvee>();
	for (const t of trouves) {
		const chemin = t.chemin.split('#')[0]!;
		const deja = vues.get(chemin);
		// le titre d'une fiche trouvée elle-même l'emporte sur celui tiré du contexte d'une information
		if (deja === undefined || t.genre === 'fiche') vues.set(chemin, { chemin, titre: deja !== undefined && t.genre !== 'fiche' ? deja.titre : titreDe(t) });
	}
	return [...vues.values()];
}

export function RechercheFiche(p: { texte: string; surTexte(texte: string): void; rendreTrouvee(f: FicheTrouvee): ReactNode }): ReactNode {
	const champ = useRef<HTMLInputElement>(null);
	const id = useId();
	const active = rechercheActive(p.texte);
	const moteur = useRechercheMoteur(p.texte, { dossier: null, genre: 'fiche', actif: active, remplacement: 'fiche' });
	const reponse = moteur.trouves === null ? null : fichesTrouvees(moteur.trouves);
	// pendant la recherche d'un texte changé, les fiches du précédent restent, estompées, jusqu'à leur remplacement
	const precedentes = useRef<FicheTrouvee[] | null>(null);
	if (!active) precedentes.current = null;
	else if (reponse !== null) precedentes.current = reponse;
	const fiches = active ? (reponse ?? (moteur.erreur === null ? precedentes.current : null)) : null;
	const perimees = reponse === null && fiches !== null;
	const vider = () => {
		p.surTexte('');
		champ.current?.focus();
	};

	let etat: ReactNode = null;
	if (active) {
		if (moteur.erreur !== null && reponse === null) etat = <span className={s.erreur}>Recherche impossible : {moteur.erreur}</span>;
		else if (reponse === null || perimees) etat = <span className={r.reflet}>Recherche…</span>;
		else if (reponse.length === 0) etat = moteur.enCours ? <span className={r.reflet}>Recherche…</span> : `Aucune fiche pour « ${p.texte.trim()} »`;
		else etat = `${reponse.length} fiche${reponse.length > 1 ? 's' : ''}`;
	}

	return (
		<>
			<li key="recherche" className={s.recherche} role="presentation" data-perimees={perimees ? 'true' : undefined}>
				<div className={s.champ} role="search">
					<svg className={s.loupe} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
						<circle cx="6.8" cy="6.8" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
						<path d="M10 10l3.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
					</svg>
					<label className={s.masque} htmlFor={id}>
						Chercher une fiche à injecter
					</label>
					<input
						ref={champ}
						id={id}
						type="search"
						className={s.saisie}
						value={p.texte}
						placeholder="Chercher une fiche…"
						autoComplete="off"
						spellCheck={false}
						maxLength={200}
						onChange={(e) => p.surTexte(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Escape' && p.texte !== '') {
								e.preventDefault();
								e.stopPropagation();
								vider();
							} else if (e.key === 'ArrowDown' && active) {
								const premier = champ.current?.closest('ol')?.querySelector<HTMLButtonElement>('li[data-trouvee] button');
								if (premier) {
									e.preventDefault();
									premier.focus();
								}
							}
						}}
					/>
					{p.texte !== '' && (
						<button type="button" className={s.effacer} aria-label="Effacer la recherche" title="Effacer la recherche (Échap)" onClick={vider}>
							×
						</button>
					)}
				</div>
				{active && (
					<p className={s.etat} role="status">
						{etat}
					</p>
				)}
			</li>
			{active && fiches?.map((f) => p.rendreTrouvee(f))}
		</>
	);
}
