/**
 * Couleur principale de l'interface en pastilles : le vert d'origine et les couleurs des agents (jetons du thème, lus sur la
 * page à l'exécution : aucune couleur écrite hors de jetons.css), puis le choix libre : « Personnalisée » (le sélecteur de
 * couleur du système, sa pastille montre la couleur choisie à la main, un arc-en-ciel sinon) et le code hexadécimal,
 * saisissable, qui montre toujours la couleur en vigueur. Chaque pastille est un bouton, enfoncé quand sa couleur est la
 * couleur choisie. Sous le nuancier, l'erreur de code puis l'avertissement quand la couleur se lit mal sur le fond.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import { ACCENT_PAR_DEFAUT, estCouleurHex } from '@mnemo/commun';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { CONTRASTE_MINIMAL, contraste, normaliserHex } from '../../../reglages/accent.ts';
import type { Saisie } from '../../../reglages/brouillon.ts';
import type { ChampDispose } from '../../../reglages/disposition.ts';
import { useTextes } from '../../../langue/langue.tsx';
import c from '../Cartes.module.css';
import { BadgeEffet, Defaut } from './Defaut.tsx';

/** Les pastilles : le jeton qui les peint et celui où lire leur valeur. Le vert d'origine est le défaut, connu sans lecture. */
const PASTILLES = [
	{ nom: 'violet', fond: 'var(--violet)', jeton: '--violet' },
	{ nom: 'bleu', fond: 'var(--blue)', jeton: '--blue' },
	{ nom: 'ambre', fond: 'var(--amber)', jeton: '--amber' },
	{ nom: 'rouge', fond: 'var(--red)', jeton: '--red' },
] as const;

const ID_CODE_INVALIDE = 'nuancier-code-invalide';

/** Valeur `#rrggbb` d'un jeton de la page ; null si elle n'en est pas une (jeton absent). */
function lireJeton(jeton: string): string | null {
	const v = getComputedStyle(document.documentElement).getPropertyValue(jeton).trim().toLowerCase();
	return estCouleurHex(v) ? v : null;
}

export function Nuancier(p: { champ: ChampReglageVue; dispose: ChampDispose; saisie: Saisie; surSaisie(v: Saisie): void }): ReactNode {
	const t = useTextes().reglages.nuancier;
	const pastilles = useMemo(
		() => [
			{ nom: t.vertOrigine, fond: 'var(--vert)', hex: ACCENT_PAR_DEFAUT },
			...PASTILLES.flatMap((x) => {
				const hex = lireJeton(x.jeton);
				return hex === null ? [] : [{ nom: t[x.nom], fond: x.fond, hex }];
			}),
		],
		[t],
	);
	const choisie = typeof p.saisie === 'string' ? p.saisie.toLowerCase() : '';
	const autre = estCouleurHex(choisie) && !pastilles.some((x) => x.hex === choisie);
	const [codeInvalide, poserCodeInvalide] = useState(false);
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
						title={x.nom}
						className={c.nuance}
						style={{ '--c': x.fond } as CSSProperties}
						onClick={() => p.surSaisie(x.hex)}
					/>
				))}
				<span className={c.libre}>
					<label className={c.autre} data-choisie={autre || undefined} title={t.selecteur}>
						<span className={c.temoin} data-couleur={autre || undefined} style={autre ? ({ '--c': choisie } as CSSProperties) : undefined} aria-hidden="true" />
						{t.personnalisee}
						<input type="color" aria-label={t.couleurPersonnalisee} value={estCouleurHex(choisie) ? choisie : ACCENT_PAR_DEFAUT} onChange={(e) => p.surSaisie(e.target.value)} />
					</label>
					<CodeHex couleur={choisie} surSaisie={p.surSaisie} surInvalide={poserCodeInvalide} />
				</span>
			</div>
			{codeInvalide && (
				<p id={ID_CODE_INVALIDE} className={c.erreurHex} role="alert">
					{t.codeInvalide}
				</p>
			)}
			<AvertissementContraste couleur={choisie} />
			<Defaut champ={p.champ} saisie={p.saisie} surSaisie={p.surSaisie} />
		</div>
	);
}

/**
 * Code hexadécimal de la couleur, saisissable : un code valide (`#` facultatif, forme courte acceptée) s'applique dès la
 * frappe ; un code incomplet ne change rien et, une fois le champ quitté, est signalé sous le nuancier. Le champ reprend la
 * couleur en vigueur quand elle change ailleurs (pastille, sélecteur du système, Rétablir).
 */
function CodeHex(p: { couleur: string; surSaisie(v: Saisie): void; surInvalide(signale: boolean): void }): ReactNode {
	const t = useTextes().reglages.nuancier;
	const [texte, poserTexte] = useState(p.couleur);
	const [quitte, poserQuitte] = useState(true);
	useEffect(() => {
		poserTexte((t) => (normaliserHex(t) === p.couleur ? t : p.couleur));
	}, [p.couleur]);
	const invalide = normaliserHex(texte) === null;
	const signale = invalide && quitte && texte !== p.couleur;
	const { surInvalide } = p;
	useEffect(() => surInvalide(signale), [signale, surInvalide]);
	return (
		<input
			className={c.hex}
			type="text"
			aria-label={t.codeHex}
			aria-invalid={signale || undefined}
			aria-describedby={signale ? ID_CODE_INVALIDE : undefined}
			placeholder="#rrggbb"
			maxLength={7}
			spellCheck={false}
			autoComplete="off"
			value={texte}
			onFocus={() => poserQuitte(false)}
			onBlur={() => poserQuitte(true)}
			onChange={(e) => {
				poserTexte(e.target.value);
				const hex = normaliserHex(e.target.value);
				if (hex !== null && hex !== p.couleur) p.surSaisie(hex);
			}}
			onKeyDown={(e) => {
				if (e.key === 'Escape') poserTexte(p.couleur);
			}}
		/>
	);
}

/** Prévient quand l'accent se lit mal sur le fond (contraste sous 3:1). */
function AvertissementContraste(p: { couleur: string }): ReactNode {
	const t = useTextes().reglages.nuancier;
	const fond = lireJeton('--bg');
	if (!estCouleurHex(p.couleur) || fond === null) return null;
	const rapport = contraste(p.couleur, fond);
	if (rapport >= CONTRASTE_MINIMAL) return null;
	return (
		<p className={c.avertissement} role="status">
			{t.contraste(rapport, CONTRASTE_MINIMAL)}
		</p>
	);
}
