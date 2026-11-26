/**
 * Signature de l'app construite, d'après l'environnement de la construction (jamais versionné) :
 *
 * - sans `MNEMO_SIGNATURE` : signature ad hoc (identité `-`, sans runtime renforcé) ; l'app se lance, mais macOS demande à
 *   l'utilisateur de l'autoriser au premier lancement (clic droit › Ouvrir, ou Réglages › Confidentialité et sécurité) ;
 * - avec `MNEMO_SIGNATURE` (identité « Developer ID Application: … » du trousseau) : signature par `@electron/osx-sign`
 *   (par l'option `osxSign` de `@electron/packager`), runtime renforcé, droits par défaut d'Electron, et pour le Node emporté
 *   ceux dont V8 a besoin hors d'Electron ; puis notarisation par `@electron/notarize` (option `osxNotarize`, l'app agrafée)
 *   si ses variables sont posées : `MNEMO_NOTARISATION_PROFIL` (profil enregistré par `xcrun notarytool store-credentials`),
 *   ou `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, ou `APPLE_API_KEY` + `APPLE_API_KEY_ID` +
 *   `APPLE_API_ISSUER`. Un jeu incomplet arrête la construction ; aucune : signée, non notarisée (dit).
 *
 * Ce chemin n'a pas pu être essayé faute de compte Apple Developer : seul le chemin ad hoc l'a été.
 */
import { ErreurConstruction } from './erreur.ts';

export type Notarisation = { keychainProfile: string } | { appleId: string; appleIdPassword: string; teamId: string } | { appleApiKey: string; appleApiKeyId: string; appleApiIssuer: string };

export type Signature = { mode: 'adhoc' } | { mode: 'developerId'; identite: string; notarisation: Notarisation | null };

/** Droits du Node emporté sous runtime renforcé : la compilation à la volée de V8, et les modules natifs (`node-pty`). */
export const DROITS_NODE = ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-library-validation'];

type Env = Readonly<Record<string, string | undefined>>;

/** Les variables d'un jeu : toutes posées (les valeurs), aucune (null) ; un jeu incomplet arrête la construction. */
function jeu(env: Env, noms: readonly string[]): string[] | null {
	const posees = noms.filter((n) => (env[n] ?? '') !== '');
	if (posees.length === 0) return null;
	if (posees.length < noms.length) throw new ErreurConstruction(`Notarisation : variables incomplètes (${noms.filter((n) => !posees.includes(n)).join(', ')} manquante(s)).`);
	return noms.map((n) => env[n]!);
}

export function signatureDepuisEnv(env: Env): Signature {
	const identite = env['MNEMO_SIGNATURE'] ?? '';
	if (identite === '' || identite === '-') return { mode: 'adhoc' };
	const profil = env['MNEMO_NOTARISATION_PROFIL'] ?? '';
	if (profil !== '') return { mode: 'developerId', identite, notarisation: { keychainProfile: profil } };
	const mdp = jeu(env, ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']);
	if (mdp !== null) return { mode: 'developerId', identite, notarisation: { appleId: mdp[0]!, appleIdPassword: mdp[1]!, teamId: mdp[2]! } };
	const cle = jeu(env, ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']);
	if (cle !== null) return { mode: 'developerId', identite, notarisation: { appleApiKey: cle[0]!, appleApiKeyId: cle[1]!, appleApiIssuer: cle[2]! } };
	return { mode: 'developerId', identite, notarisation: null };
}

/** Le Node emporté (`Contents/Resources/node/bin/node`) : il a ses propres droits. */
export function estNodeEmporte(chemin: string): boolean {
	return /[\\/]Contents[\\/]Resources[\\/]node[\\/]bin[\\/]node$/u.test(chemin);
}

/** Phrase de la construction : comment l'app est signée. */
export function decrireSignature(s: Signature): string {
	if (s.mode === 'adhoc') return 'Signature ad hoc (sans MNEMO_SIGNATURE) : au premier lancement, macOS demande d’autoriser l’app.';
	return `Signée « ${s.identite} »${s.notarisation === null ? ', non notarisée (aucune variable de notarisation)' : ', notarisée et agrafée'}.`;
}
