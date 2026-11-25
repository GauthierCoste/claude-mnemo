import type { Session } from '../domaine/session.ts';
import type { Moteur } from './ports.ts';

/**
 * Une ligne pour une session (bilan, consigne), et le moment où son moteur peut la recevoir. Un moteur peut ne rien montrer
 * de la session avant un hook de ce lancement : Codex ne sait pas la reprendre tant que son `fil` est inconnu, GitHub Copilot CLI
 * (`debutAuPremierMessage`) n'envoie aucun hook avant le premier message et pose d'abord une question à chaque lancement
 * (confiance du dossier, « Yes » choisi par défaut), à laquelle une ligne tapée répondrait.
 */

/**
 * La session tenue, lancée à `lanceMs`, a commencé chez son moteur : il sait la reprendre et, chez un moteur
 * `debutAuPremierMessage`, un hook de ce lancement est arrivé. État illisible : tenue pour commencée.
 */
export function commencee(moteur: Pick<Moteur, 'motifSansReprise' | 'debutAuPremierMessage'>, s: Session | null, lanceMs: number): boolean {
	if (s === null) return true;
	return moteur.motifSansReprise(s) === null && !(moteur.debutAuPremierMessage === true && s.majMs <= lanceMs);
}

/**
 * Comment une ligne parvient à la session :
 * - `tapee` : dans son terminal (elle tourne et a commencé ; ou elle ne tourne pas, et sa reprise la fera commencer avant) ;
 * - `avec_la_reprise` : elle ne tourne pas, chez un moteur `debutAuPremierMessage` : la ligne part avec sa reprise, comme son
 *   premier message, que le moteur envoie lui-même une fois sa question réglée ;
 * - `relance` : elle tourne sans avoir commencé, chez un tel moteur, et peut être reprise : arrêtée par signaux (rien n'est
 *   tapé, aucun message n'est perdu : elle n'en a encore reçu aucun), puis reprise avec la ligne ;
 * - `refusee` : elle tourne sans avoir commencé, et ne peut pas être relancée ainsi (Codex sans `fil`) : rien n'est tapé.
 */
export type VoieDeLaLigne = 'tapee' | 'avec_la_reprise' | 'relance' | 'refusee';

export function voieDeLaLigne(d: { tourne: boolean; commencee: boolean; debutAuPremierMessage: boolean; reprisePossible: boolean }): VoieDeLaLigne {
	if (!d.tourne) return d.debutAuPremierMessage ? 'avec_la_reprise' : 'tapee';
	if (d.commencee) return 'tapee';
	return d.debutAuPremierMessage && d.reprisePossible ? 'relance' : 'refusee';
}

/** Ce qui part avec une reprise, comme premier message du moteur : une `ligne` confiée, ou le bilan demandé à `bilanDemandeMs`. */
export type SuiteDeReprise = { ligne: string } | { bilanDemandeMs: number };
