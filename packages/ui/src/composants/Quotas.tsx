/**
 * Quotas des abonnements dans la barre de titre, à gauche de l'Archiviste : compte Claude (Claude Code) et compte ChatGPT
 * (Codex), côte à côte quand les deux sont relevés, sinon celui qui l'est ; communs à toutes les sessions (la fenêtre de
 * contexte, propre à chaque session, reste sur sa jauge). Replié, par abonnement, un cercle à deux anneaux (intérieur :
 * 5 heures ; extérieur : semaine) ; un clic le déplie en barres avec la remise à zéro, un autre le replie. Rien tant qu'aucun
 * quota n'est connu. Mistral Vibe n'en communique aucun de lisible : le panneau Contexte de ses sessions le
 * dit.
 */
import { IDS_MOTEURS } from '@mnemo/commun';
import type { IdMoteur } from '@mnemo/commun';
import type { QuotaVue, QuotasDesMoteursVue, QuotasVue } from '@mnemo/contrat';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuotas } from '../client/hooks.ts';
import s from './Quotas.module.css';

/** Seuils (pourcentage consommé) où un quota passe à l'ambre, puis au rouge. */
const SEUIL_AMBRE = 50;
const SEUIL_ROUGE = 80;
const CLE_DEPLIE = 'mnemo.quotas.deplie';
/** Une fenêtre passée sa remise à zéro n'est plus connue : relu chaque minute. */
const RAFRAICHIR_MS = 60_000;

const couleur = (p: number): string => (p >= SEUIL_ROUGE ? 'var(--red)' : p >= SEUIL_AMBRE ? 'var(--amber)' : 'var(--ac)');

/** « 18:00 » le jour même, sinon « lun. 09:00 ». */
export function remiseLisible(remiseMs: number, maintenant: number): string {
	const date = new Date(remiseMs);
	const heure = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	return date.toDateString() === new Date(maintenant).toDateString() ? heure : `${date.toLocaleDateString('fr-FR', { weekday: 'short' })} ${heure}`;
}

/** Les fenêtres encore valables : une fenêtre passée sa remise à zéro est retirée. */
export function quotasEnCours(q: QuotasVue | null, maintenant: number): QuotasVue {
	const valable = (f: QuotaVue | undefined) => f !== undefined && f.remiseMs > maintenant;
	return { ...(valable(q?.cinqHeures) ? { cinqHeures: q!.cinqHeures } : {}), ...(valable(q?.semaine) ? { semaine: q!.semaine } : {}) };
}

/**
 * Libellé de l'abonnement dont Mnemo lit les quotas pour chaque moteur, montrés dans l'ordre de `IDS_MOTEURS` ; null : ce
 * moteur n'en communique pas de lisibles. Un moteur de plus doit dire le sien.
 */
const ABONNEMENTS: Readonly<Record<IdMoteur, string | null>> = {
	'claude-code': 'Claude',
	codex: 'ChatGPT',
	'mistral-vibe': null,
};

/** Libellé de l'abonnement dont Mnemo lit les quotas pour ce moteur ; null : ce moteur n'en communique pas de lisibles. */
export const abonnementDuMoteur = (moteur: IdMoteur): string | null => ABONNEMENTS[moteur];

export type AbonnementEnCours = { moteur: IdMoteur; libelle: string; quotas: QuotasVue };

/** Les abonnements qui ont au moins une fenêtre encore valable, dans l'ordre de `IDS_MOTEURS`. */
export function abonnementsEnCours(moteurs: QuotasDesMoteursVue, maintenant: number): AbonnementEnCours[] {
	return IDS_MOTEURS.flatMap((moteur) => {
		const libelle = ABONNEMENTS[moteur];
		return libelle === null ? [] : [{ moteur, libelle, quotas: quotasEnCours(moteurs[moteur] ?? null, maintenant) }];
	}).filter((a) => a.quotas.cinqHeures !== undefined || a.quotas.semaine !== undefined);
}

/** « Claude : 5 heures : 42 % (remise 18:00) · semaine : 61 % (remise lun. 09:00) ». */
function detailDe(a: AbonnementEnCours, maintenant: number): string {
	const { cinqHeures, semaine } = a.quotas;
	const fenetres = [cinqHeures && `5 heures : ${cinqHeures.pourcentage} % (remise ${remiseLisible(cinqHeures.remiseMs, maintenant)})`, semaine && `semaine : ${semaine.pourcentage} % (remise ${remiseLisible(semaine.remiseMs, maintenant)})`].filter(Boolean).join(' · ');
	return `${a.libelle} : ${fenetres}`;
}

function deplieRetenu(): boolean {
	try {
		return localStorage.getItem(CLE_DEPLIE) === '1';
	} catch {
		return false;
	}
}

function retenirDeplie(deplie: boolean): void {
	try {
		localStorage.setItem(CLE_DEPLIE, deplie ? '1' : '0');
	} catch {
		// stockage indisponible : l'état n'est pas retenu
	}
}

function Anneau(p: { rayon: number; quota: QuotaVue | undefined }): ReactNode {
	const tour = 2 * Math.PI * p.rayon;
	return (
		<>
			<circle className={s.piste} cx="11" cy="11" r={p.rayon} />
			{p.quota !== undefined && <circle className={s.arc} cx="11" cy="11" r={p.rayon} transform="rotate(-90 11 11)" strokeDasharray={`${(tour * p.quota.pourcentage) / 100} ${tour}`} style={{ stroke: couleur(p.quota.pourcentage) }} />}
		</>
	);
}

function Ligne(p: { nom: string; quota: QuotaVue; maintenant: number }): ReactNode {
	const c = couleur(p.quota.pourcentage);
	return (
		<span className={s.ligne}>
			<span className={s.nom}>{p.nom}</span>
			<span className={s.barre}>
				<span className={s.rempli} style={{ '--part': p.quota.pourcentage / 100, '--c': c } as CSSProperties} />
			</span>
			<span className={s.valeur}>{p.quota.pourcentage} %</span>
			<span className={s.remise}>↻ {remiseLisible(p.quota.remiseMs, p.maintenant)}</span>
		</span>
	);
}

export function Quotas(): ReactNode {
	const recus = useQuotas();
	const [maintenant, setMaintenant] = useState(() => Date.now());
	const [deplie, setDeplie] = useState(deplieRetenu);
	useEffect(() => {
		const minuteur = setInterval(() => setMaintenant(Date.now()), RAFRAICHIR_MS);
		return () => clearInterval(minuteur);
	}, []);
	// un nouveau relevé est lu avec l'heure du moment
	useEffect(() => setMaintenant(Date.now()), [recus]);
	const abonnements = abonnementsEnCours(recus, maintenant);
	if (abonnements.length === 0) return null;
	const detail = abonnements.map((a) => detailDe(a, maintenant)).join(' ; ');
	const basculer = () => {
		setDeplie(!deplie);
		retenirDeplie(!deplie);
	};
	return (
		<button type="button" className={s.quotas} aria-expanded={deplie} aria-label={`Quotas des abonnements, ${detail}. ${deplie ? 'Replier' : 'Déplier'}`} title={`Quotas des abonnements, ${detail}`} onClick={basculer}>
			<span className={s.abonnements}>
				{abonnements.map(({ moteur, libelle, quotas: { cinqHeures, semaine } }) => (
					<span key={moteur} className={s.abonnement} data-moteur={moteur}>
						<span className={s.libelle}>{libelle}</span>
						{deplie ? (
							<span className={s.detail}>
								{cinqHeures && <Ligne nom="5 h" quota={cinqHeures} maintenant={maintenant} />}
								{semaine && <Ligne nom="sem." quota={semaine} maintenant={maintenant} />}
							</span>
						) : (
							<svg className={s.anneaux} viewBox="0 0 22 22" aria-hidden="true">
								<Anneau rayon={9} quota={semaine} />
								<Anneau rayon={5} quota={cinqHeures} />
							</svg>
						)}
					</span>
				))}
			</span>
		</button>
	);
}
