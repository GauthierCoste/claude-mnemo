/**
 * Couleur principale de l'interface en pastilles : le vert d'origine et les couleurs des agents (jetons du thème, lus sur la
 * page à l'exécution : aucune couleur écrite hors de jetons.css), puis « Autre couleur » (le sélecteur du système), qui montre
 * aussi une couleur choisie à la main. Chaque pastille est un bouton, enfoncé quand sa couleur est la couleur choisie. Sous
 * le nuancier, l'avertissement quand la couleur se lit mal sur le fond.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import { ACCENT_PAR_DEFAUT, estCouleurHex } from '@mnemo/commun';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { CONTRASTE_MINIMAL, contraste } from '../../../reglages/accent.ts';
import type { Saisie } from '../../../reglages/brouillon.ts';
import type { ChampDispose } from '../../../reglages/disposition.ts';
import c from '../Cartes.module.css';
import { BadgeEffet, Defaut } from './Defaut.tsx';

/** Les pastilles : le jeton qui les peint et celui où lire leur valeur. Le vert d'origine est le défaut, connu sans lecture. */
const PASTILLES = [
	{ nom: 'Violet', fond: 'var(--violet)', jeton: '--violet' },
	{ nom: 'Bleu', fond: 'var(--blue)', jeton: '--blue' },
	{ nom: 'Ambre', fond: 'var(--amber)', jeton: '--amber' },
	{ nom: 'Rouge', fond: 'var(--red)', jeton: '--red' },
] as const;

/** Valeur `#rrggbb` d'un jeton de la page ; null si elle n'en est pas une (jeton absent). */
function lireJeton(jeton: string): string | null {
	const v = getComputedStyle(document.documentElement).getPropertyValue(jeton).trim().toLowerCase();
	return estCouleurHex(v) ? v : null;
}

export function Nuancier(p: { champ: ChampReglageVue; dispose: ChampDispose; saisie: Saisie; surSaisie(v: Saisie): void }): ReactNode {
	const pastilles = useMemo(
		() => [
			{ nom: 'Vert d’origine', fond: 'var(--vert)', hex: ACCENT_PAR_DEFAUT },
			...PASTILLES.flatMap((x) => {
				const hex = lireJeton(x.jeton);
				return hex === null ? [] : [{ nom: x.nom, fond: x.fond, hex }];
			}),
		],
		[],
	);
	const choisie = typeof p.saisie === 'string' ? p.saisie.toLowerCase() : '';
	const autre = !pastilles.some((x) => x.hex === choisie);
	return (
		<div>
			<BadgeEffet champ={p.champ} />
			<div className={c.nuancier} role="group" aria-label={p.dispose.libelle} title={p.champ.explication}>
				{pastilles.map((x) => (
					<button
						key={x.hex}
						type="button"
						aria-pressed={x.hex === choisie}
						aria-label={x.nom}
						className={c.nuance}
						style={{ '--c': x.fond } as CSSProperties}
						onClick={() => p.surSaisie(x.hex)}
					/>
				))}
				<label className={c.autre} data-choisie={autre || undefined} style={autre && estCouleurHex(choisie) ? ({ '--c': choisie } as CSSProperties) : undefined} title="Autre couleur">
					<input type="color" aria-label="Autre couleur" value={estCouleurHex(choisie) ? choisie : ACCENT_PAR_DEFAUT} onChange={(e) => p.surSaisie(e.target.value)} />
				</label>
			</div>
			<AvertissementContraste couleur={choisie} />
			<Defaut champ={p.champ} saisie={p.saisie} surSaisie={p.surSaisie} />
		</div>
	);
}

/** Prévient quand l'accent se lit mal sur le fond (contraste sous 3:1). */
function AvertissementContraste(p: { couleur: string }): ReactNode {
	const fond = lireJeton('--bg');
	if (!estCouleurHex(p.couleur) || fond === null) return null;
	const rapport = contraste(p.couleur, fond);
	if (rapport >= CONTRASTE_MINIMAL) return null;
	return (
		<p className={c.avertissement} role="status">
			Cette couleur se lit mal sur le fond sombre (contraste {rapport.toFixed(1).replace('.', ',')}:1, au moins {CONTRASTE_MINIMAL}:1 conseillé) : les liens, filets et titres seront peu visibles.
		</p>
	);
}
