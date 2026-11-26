/**
 * Circuit de liaison d'un moteur : une étape par point vérifié du poste (Installé → Version → Mémoire → Suivi → Approbation),
 * allumée quand elle est satisfaite ; la première cassée pulse. Chaque étape dit son état en clair (valeur dessous, détail en
 * infobulle, état lu par les lecteurs d'écran), jamais par la seule couleur.
 */
import type { ReactNode } from 'react';
import type { EtapeCircuit, EtatEtape } from '../../../moteurs/circuit.ts';
import s from './Moteurs.module.css';

const LUS: Readonly<Record<EtatEtape, string>> = { ok: 'satisfait', casse: 'à régler', attente: 'en attente', inconnu: 'à vérifier' };
const SIGNES: Readonly<Record<EtatEtape, string | null>> = { ok: '✓', casse: null, attente: null, inconnu: '?' };

export function CircuitLiaison(p: { moteur: string; etapes: readonly EtapeCircuit[] }): ReactNode {
	if (p.etapes.length === 0) return null;
	return (
		<ol className={s.circuit} aria-label={`Circuit de liaison de ${p.moteur}`}>
			{p.etapes.map((e, i) => (
				<li key={e.cle} className={s.etape} data-etat={e.etat} title={e.infobulle}>
					<span className={s.noeud} aria-hidden="true">
						{SIGNES[e.etat] ?? i + 1}
					</span>
					<span className={s.nomEtape}>{e.nom}</span>
					<span className={s.valeur}>{e.valeur}</span>
					<span className={s.horsEcran}>({LUS[e.etat]})</span>
				</li>
			))}
		</ol>
	);
}
