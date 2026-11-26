/**
 * Couleur du fournisseur de chaque moteur dans l'interface (son nom : `FOURNISSEURS_MOTEURS` de `@mnemo/commun` ; son logo :
 * `logos.tsx`), un jeton du thème (`--fournisseur-…`, posé dans jetons.css).
 */
import { FOURNISSEURS_MOTEURS } from '@mnemo/commun';
import type { FournisseurMoteur, IdMoteur } from '@mnemo/commun';

const JETONS: Readonly<Record<FournisseurMoteur, string>> = {
	Anthropic: 'var(--fournisseur-anthropic)',
	OpenAI: 'var(--fournisseur-openai)',
	Mistral: 'var(--fournisseur-mistral)',
};

/** Couleur du fournisseur du moteur : à poser en `--c` (ou autre propriété) sur l'élément qui la montre. */
export const couleurFournisseur = (moteur: IdMoteur): string => JETONS[FOURNISSEURS_MOTEURS[moteur]];
