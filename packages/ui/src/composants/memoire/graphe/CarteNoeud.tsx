/**
 * Carte de la fiche choisie (panneau `.ov` du haut à droite) : chemin, titre, synthèse,
 * « Relié à (n) », « Ouvrir la fiche » ; plus le voisinage, Centrer et Fermer.
 */
import type { ReactNode } from 'react';
import { useFiche } from '../../../client/hooks.ts';
import { nomDEtat, type Noeud } from '../../../graphe/donnees.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import { DePlus, useToutPour } from '../../commun/DePlus.tsx';
import s from './CarteNoeud.module.css';
import { Pastille } from './Pastille.tsx';

const LIENS_AFFICHES = 80;

/** Premier paragraphe du corps, hors titres et listes ; `[[cible|texte]]` lu comme `texte`. */
export function syntheseDe(corps: string): string {
	const lignes: string[] = [];
	for (const ligne of corps.split('\n')) {
		const t = ligne.trim();
		if (t.startsWith('## ')) break;
		if (!t || t.startsWith('#') || t.startsWith('- ') || t.startsWith('|')) {
			if (lignes.length) break;
			continue;
		}
		lignes.push(t);
	}
	return lignes
		.join(' ')
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, (_, cible: string) => cible.split('/').pop() ?? cible);
}

export function CarteNoeud(p: {
	noeud: Noeud | null;
	/** Fiches reliées directement par les types de lien cochés. */
	relies: readonly Noeud[];
	profondeur: number;
	surProfondeur(n: number): void;
	surCentrer(): void;
	surFermer(): void;
	surOuvrir(noeud: Noeud): void;
	surChoisir(noeud: Noeud): void;
}): ReactNode {
	const textes = useTextes();
	const t = textes.memoire.graphe.carte;
	const tg = textes.memoire.graphe;
	const { noeud } = p;
	const liensVus = useToutPour(noeud);
	const fiche = useFiche(noeud?.chemin && !noeud.fantome ? noeud.chemin : null, false);
	if (!noeud) {
		return (
			<aside className={s.carte} aria-label={t.titre} onWheel={(e) => e.stopPropagation()}>
				<span className={s.lbl}>{t.fiche}</span>
				<p className={s.mu}>{t.vide}</p>
			</aside>
		);
	}
	const chemin = noeud.fantome ? tg.legende.lienCasse : noeud.branche === '' ? tg.legende.racine : noeud.branche.split('/').join(' / ');
	const synthese = noeud.fantome ? t.absente : fiche.donnees?.chemin === noeud.chemin ? syntheseDe(fiche.donnees.corps) : '';
	const relies = [...p.relies].sort((a, b) => a.titre.localeCompare(b.titre));
	const etats = noeud.etats.map((etat) => nomDEtat(etat, tg));

	return (
		<aside className={s.carte} aria-label={t.titre} onWheel={(e) => e.stopPropagation()}>
			<span className={s.lbl} style={{ color: noeud.couleur }}>
				{chemin}
			</span>
			<h2 className={s.titre}>{noeud.titre}</h2>
			{synthese && <p className={s.mu}>{synthese}</p>}
			{etats.length > 0 && <p className={s.etats}>{etats.join(', ')}</p>}
			<div className={s.outils}>
				<select aria-label={t.voisinage} value={p.profondeur} onChange={(e) => p.surProfondeur(Number(e.target.value))}>
					<option value={1}>{t.liensDirects}</option>
					<option value={2}>{t.jusquA(2)}</option>
					<option value={3}>{t.jusquA(3)}</option>
				</select>
				<Bouton petit onClick={p.surCentrer}>
					{t.centrer}
				</Bouton>
				<Bouton petit onClick={p.surFermer} aria-label={t.fermerFiche}>
					{textes.commun.actions.fermer}
				</Bouton>
			</div>
			<div className={s.sec}>
				<span className={s.lbl}>{t.reliesA(relies.length)}</span>
				<div className={s.liste}>
					{relies.slice(0, liensVus.tout ? relies.length : LIENS_AFFICHES).map((autre) => (
						<button key={autre.id} type="button" className={s.ml} onClick={() => p.surChoisir(autre)}>
							<Pastille couleur={autre.couleur} anneau={autre.fantome} />
							<span>{autre.titre}</span>
						</button>
					))}
					<DePlus nombre={liensVus.tout ? 0 : relies.length - LIENS_AFFICHES} surToutVoir={liensVus.toutVoir} />
				</div>
			</div>
			{!noeud.fantome && noeud.chemin && (
				<div className={s.sec}>
					<Bouton genre="primaire" petit onClick={() => p.surOuvrir(noeud)}>
						{t.ouvrir}
					</Bouton>
				</div>
			)}
		</aside>
	);
}
