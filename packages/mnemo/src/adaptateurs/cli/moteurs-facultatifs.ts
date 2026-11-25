import type { EtapeInit, PosteVerifie } from '@mnemo/contrat';
import type { MoteurDuPoste } from '../../application/ports.ts';
import { FICHES_MOTEURS } from '../../domaine/moteurs/catalogue.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { MOTEURS_DU_POSTE } from '../../infra/moteurs/moteurs.ts';

/** Un moteur que `mnemo init` ne touche que sur son option (`facultatif` du catalogue) : tous sauf Claude Code. */
export type IdMoteurFacultatif = Exclude<IdMoteur, 'claude-code'>;

/** Ce qu'un moteur facultatif porte dans le contrat : son bloc dans `PosteVerifie`, ses étapes d'`init` (`EtapeInit`). */
export type ContratDuFacultatif = { bloc: Exclude<keyof PosteVerifie, 'git' | 'claude' | 'node'>; etape: EtapeInit; etapeHooks: EtapeInit };

export const CONTRAT_DES_FACULTATIFS: Readonly<Record<IdMoteurFacultatif, ContratDuFacultatif>> = {
	codex: { bloc: 'codex', etape: 'codex', etapeHooks: 'codex_hooks' },
	'mistral-vibe': { bloc: 'mistral', etape: 'mistral', etapeHooks: 'mistral_hooks' },
};

/** Un moteur facultatif : le moteur du poste, son option d'`init` (catalogue) et ce qu'il porte dans le contrat. */
export type MoteurFacultatif = ContratDuFacultatif & { moteur: MoteurDuPoste; id: IdMoteurFacultatif; nom: string; optionInit: string };

const estFacultatif = (id: IdMoteur): id is IdMoteurFacultatif => id in CONTRAT_DES_FACULTATIFS;

/** Les moteurs facultatifs du catalogue, dans l'ordre de `IDS_MOTEURS`. */
export const MOTEURS_FACULTATIFS: readonly MoteurFacultatif[] = FICHES_MOTEURS.flatMap((f) =>
	f.facultatif && estFacultatif(f.id) ? [{ ...CONTRAT_DES_FACULTATIFS[f.id], moteur: MOTEURS_DU_POSTE[f.id], id: f.id, nom: f.nom, optionInit: f.optionInit }] : [],
);
