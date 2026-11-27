/**
 * Règles pures de la montée de version (sans accès disque ni git), utilisées par `outils/publier.ts`.
 *
 * Convention de l'auteur : Version X.x.x (rupture, refonte), Feature x.X.x (grosse fonctionnalité), Patch x.x.X (petite
 * modification, correction).
 */

export const NIVEAUX = ['patch', 'feature', 'version'] as const;
export type Niveau = (typeof NIVEAUX)[number];

export const estNiveau = (v: unknown): v is Niveau => typeof v === 'string' && (NIVEAUX as readonly string[]).includes(v);

const FORME = /^(\d+)\.(\d+)\.(\d+)$/u;

export const estVersion = (v: string): boolean => FORME.test(v);

/** La version qui suit `actuelle` pour ce niveau : 1.11.7 → patch 1.11.8, feature 1.12.0, version 2.0.0. */
export function versionSuivante(actuelle: string, niveau: Niveau): string {
	const m = FORME.exec(actuelle);
	if (!m) throw new Error(`Version « ${actuelle} » : attendu x.y.z.`);
	const [majeure, mineure, correctif] = [Number(m[1]), Number(m[2]), Number(m[3])];
	if (niveau === 'version') return `${majeure + 1}.0.0`;
	if (niveau === 'feature') return `${majeure}.${mineure + 1}.0`;
	return `${majeure}.${mineure}.${correctif + 1}`;
}

/** Le texte d'un package.json avec sa version remplacée, le reste intact (indentation, ordre des clés). */
export function avecVersionPaquet(texte: string, ancienne: string, nouvelle: string): string {
	const motif = `"version": "${ancienne}"`;
	if (texte.split(motif).length !== 2) throw new Error(`« ${motif} » attendu une seule fois.`);
	return texte.replace(motif, `"version": "${nouvelle}"`);
}

/** Le README avec sa ligne « Version x.y.z. » mise à jour ; elle doit y être une seule fois, à l'ancienne version. */
export function avecVersionReadme(texte: string, ancienne: string, nouvelle: string): string {
	const lignes = texte.split('\n');
	const indices = lignes.flatMap((l, i) => (l.startsWith(`Version ${ancienne}.`) ? [i] : []));
	if (indices.length !== 1) throw new Error(`README : une ligne « Version ${ancienne}. » attendue, ${indices.length} trouvée(s).`);
	const i = indices[0] as number;
	lignes[i] = `Version ${nouvelle}.${(lignes[i] as string).slice(`Version ${ancienne}.`.length)}`;
	return lignes.join('\n');
}

/** Notes de version : non vides, sans le gabarit laissé tel quel, et sans section d'installation (ajoutée par la CI). */
export function problemeDesNotes(texte: string): string | null {
	const utile = texte.replace(/<!--[\s\S]*?-->/gu, '').trim();
	if (utile.length === 0) return 'les notes sont vides.';
	if (/\*\*Install on/u.test(utile)) return "la section d'installation est ajoutée par la CI : la retirer des notes.";
	return null;
}
