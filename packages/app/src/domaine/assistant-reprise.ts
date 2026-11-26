/**
 * Déclaration de Mnemo à Claude Code, de portée utilisateur, déjà faite pour une autre installation de Mnemo :
 * `mnemo init --json --mcp` rend l'étape `mcp` en échec de motif `perime` (`@mnemo/contrat`). Ce n'est pas un échec pour
 * l'assistant : il la reprend aussitôt par `mnemo declarer --remplacer --json` (ce que la vérification au lancement ferait),
 * puis montre l'état final de l'étape et une fin corrigée. Tout autre échec (Claude Code introuvable, déclaration `mnemo`
 * d'une autre portée ou qui ne lance pas Mnemo : sans motif) garde son message, qui dit quoi faire à la main.
 */
import type { EtapeInit, EvenementInit, FinInit, LigneInit } from '@mnemo/contrat';

/** Ce que rend `mnemo declarer --remplacer --json` vu de l'app (`declarer` de `infra/commande-mnemo.ts`). */
export type ResultatDeclarer = { ok: true; resultat: 'absent' | 'deja' | 'remplace' | 'autre' | 'retire'; message: string } | { ok: false; raison: string };

export const MESSAGE_REPRISE = 'Déclarée pour une autre installation de Mnemo : reprise pour celle-ci.';

/** La ligne est l'échec de la déclaration que l'assistant sait reprendre. */
export function declarationAReprendre(ligne: LigneInit): ligne is EvenementInit & { etape: 'mcp'; etat: 'echec'; motif: 'perime' } {
	return !('fin' in ligne) && ligne.etape === 'mcp' && ligne.etat === 'echec' && ligne.motif === 'perime';
}

/**
 * La ligne de l'étape `mcp` après la reprise : faite si la déclaration lance désormais ce Mnemo (`remplace`, `deja`) ;
 * sinon l'échec d'origine, sans motif (son message dit quoi faire à la main), avec la raison d'un échec de la reprise.
 */
export function ligneApresReprise(echec: EvenementInit, r: ResultatDeclarer): EvenementInit {
	if (r.ok && r.resultat === 'remplace') return { etape: 'mcp', etat: 'fait', message: MESSAGE_REPRISE };
	if (r.ok && r.resultat === 'deja') return { etape: 'mcp', etat: 'fait', message: 'Serveur MCP déjà déclaré.' };
	return { etape: 'mcp', etat: 'echec', message: r.ok ? echec.message : `${echec.message} (reprise impossible : ${r.raison})` };
}

/** La fin d'`init` après la reprise : `ok` si plus aucune étape n'est en échec. */
export function finApresReprise(fin: FinInit, etapesEnEchec: ReadonlySet<EtapeInit>): FinInit {
	return fin.ok || etapesEnEchec.size > 0 ? fin : { ...fin, ok: true };
}
