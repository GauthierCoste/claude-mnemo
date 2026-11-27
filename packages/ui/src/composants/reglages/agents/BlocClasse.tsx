/**
 * Classe d'un agent : l'agent de code qui fait tourner ses sessions (une carte par moteur, avec le logo de son fournisseur et
 * son état sur ce poste) et son modèle (en puces, « par défaut » d'abord, puis ceux que le moteur propose ; un autre nom se
 * saisit). Un moteur pas encore lié à Mnemo, ou pas installé, est verrouillé 🔒 avec la raison sur sa carte, sauf s'il est
 * déjà celui de l'agent ; l'archiviste reste sur Claude Code. Sous les cartes : ce que change le moteur choisi.
 */
import { estModele, FOURNISSEURS_MOTEURS, IDS_MOTEURS, MODELE_MAX, NOMS_MOTEURS, PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { IdMoteur } from '@mnemo/commun';
import type { MoteurVue } from '@mnemo/contrat';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { useMoteurs } from '../../../client/hooks.ts';
import { useTextes } from '../../../langue/langue.tsx';
import type { Textes } from '../../../langue/textes.ts';
import { statutDuMoteur } from '../../../moteurs/circuit.ts';
import { couleurFournisseur } from '../../../moteurs/fournisseurs.ts';
import { LogoMoteur } from '../../../moteurs/logos.tsx';
import f from '../champs/Saisie.module.css';
import s from './Agents.module.css';
import { Bloc } from './Bloc.tsx';

type TextesClasse = Textes['agents']['classe'];

/** État d'un moteur sur ce poste, sur sa carte : sa version, ou pourquoi ses sessions ne se lanceront pas ici. */
function etatDe(m: MoteurVue | undefined, chargement: boolean, t: TextesClasse): string {
	if (m === undefined) return chargement ? t.etatEnLecture : t.etatInconnu;
	if (m.indisponible !== null) return m.indisponible;
	return m.version === null ? t.trouve : t.version(m.version);
}

/** Pourquoi la carte d'un moteur est verrouillée ; null : il se choisit. */
function verrouDe(id: IdMoteur, agent: string, enregistre: IdMoteur, m: MoteurVue | undefined, t: TextesClasse): string | null {
	if (agent === PROFIL_ARCHIVISTE && id !== 'claude-code') return t.reserveArchiviste;
	if (id === enregistre || m?.poste === undefined) return null;
	const statut = statutDuMoteur(m).cle;
	if (statut === 'a-lier') return t.aLier(m.nom);
	if (statut === 'pas-installe' && !m.manuel) return t.pasInstalle;
	return null;
}

export function BlocClasse(p: { agent: string; moteur: IdMoteur; moteurEnregistre: IdMoteur; modele: string; surMoteur(m: IdMoteur): void; surModele(m: string): void }): ReactNode {
	const t = useTextes().agents.classe;
	const leger = useMoteurs();
	const poste = useMoteurs(true);
	const moteurs = poste.donnees?.moteurs ?? leger.donnees?.moteurs ?? [];
	const chargement = moteurs.length === 0 && leger.erreur === null;
	const id = useId();
	const choisi = moteurs.find((m) => m.id === p.moteur);
	const nom = NOMS_MOTEURS[p.moteur];
	const modeleValide = estModele(p.modele);
	const proposes = choisi?.modeles ?? [];
	const puces = ['', ...proposes.filter((m) => m !== '')];
	// « autre modèle » : un nom hors des puces, saisi ici ; une puce choisie le vide
	const [autre, setAutre] = useState('');
	const saisieAutre = !puces.includes(p.modele) || autre === p.modele ? p.modele : '';

	return (
		<Bloc titre={t.titre} sous={t.sous}>
			<div role="radiogroup" aria-label={t.titre} className={s.classes}>
				{IDS_MOTEURS.map((m) => {
					const vue = moteurs.find((x) => x.id === m);
					const verrou = verrouDe(m, p.agent, p.moteurEnregistre, vue, t);
					return (
						<button
							key={m}
							type="button"
							role="radio"
							className={s.cl}
							style={{ '--c': couleurFournisseur(m) } as CSSProperties}
							aria-checked={p.moteur === m}
							aria-label={`${NOMS_MOTEURS[m]} · ${FOURNISSEURS_MOTEURS[m]}`}
							aria-describedby={`${id}-${m}`}
							aria-disabled={verrou !== null || undefined}
							onClick={() => verrou === null && p.surMoteur(m)}
						>
							<span className={s.blason}>
								<LogoMoteur moteur={m} taille={20} />
							</span>
							<b>{NOMS_MOTEURS[m]}</b>
							<span className={s.fournisseur}>{FOURNISSEURS_MOTEURS[m]}</span>
							{verrou !== null && (
								<span className={s.verrou} aria-hidden="true">
									🔒
								</span>
							)}
							<span id={`${id}-${m}`} className={verrou === null ? s.etatCarte : s.raisonCarte}>
								{verrou ?? etatDe(vue, chargement, t)}
							</span>
						</button>
					);
				})}
			</div>
			<p className={s.effet}>{t.effets[p.moteur]}</p>
			{leger.erreur !== null && <p className={s.effet}>{t.etatIllisible(leger.erreur)}</p>}
			{choisi !== undefined && choisi.indisponible !== null && (
				<p className={s.avis} role="note">
					{choisi.manuel
						? t.manqueManuel(nom)
						: t.manqueRefuse(nom)}{' '}
					{t.etatDetaille}
				</p>
			)}

			<div className={s.niveaux} role="group" aria-label={t.modeles(nom)}>
				{puces.map((m) => (
					<button key={m === '' ? '(défaut)' : m} type="button" className={s.niveau} aria-pressed={p.modele === m} onClick={() => {
							setAutre('');
							p.surModele(m);
						}}>
						{m === '' ? t.parDefaut : m}
					</button>
				))}
				<input
					className={f.champTexte}
					aria-label={t.modele}
					list={`${id}-modeles`}
					spellCheck={false}
					autoComplete="off"
					maxLength={MODELE_MAX}
					placeholder={t.autreModele}
					value={saisieAutre}
					aria-invalid={!modeleValide || undefined}
					aria-describedby={`${id}-aide-modele`}
					onChange={(e) => {
						setAutre(e.target.value.trim());
						p.surModele(e.target.value.trim());
					}}
				/>
				<datalist id={`${id}-modeles`}>
					{proposes.map((m) => (
						<option key={m} value={m} />
					))}
				</datalist>
			</div>
			<p id={`${id}-aide-modele`} className={modeleValide ? s.effet : s.erreur}>
				{!modeleValide
					? t.nomRefuse(MODELE_MAX)
					: proposes.length === 0 && !chargement
						? t.parDefautSansListe(nom)
						: t.parDefautDe(nom)}
			</p>
		</Bloc>
	);
}
