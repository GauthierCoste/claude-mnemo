/** Fiches injectées dans une session et cartes proposées, d'après le journal `servir` : panneau Contexte, ⌥M. */
import type { CarteVue, EntreeServieVue } from '@mnemo/contrat';

/** Chemins des fiches servies (un fait `chemin#f-…` compte pour sa fiche), sans doublon, plus récentes d'abord. */
export function fichesServies(entrees: readonly EntreeServieVue[]): string[] {
	const chemins = new Set<string>();
	const recentes = [...entrees].sort((a, b) => b.horodatageMs - a.horodatageMs);
	for (const e of recentes) for (const id of e.ids) chemins.add(id.split('#')[0]!);
	return [...chemins];
}

/** Chemins des cartes proposées (plus récentes d'abord), sans doublon, hors fiches déjà servies. */
export function fichesProposees(entrees: readonly EntreeServieVue[], servies: readonly string[]): string[] {
	return cartesProposees(entrees, servies).map((c) => c.id);
}

/** Cartes proposées (plus récentes d'abord ; titre et raison de leur dernière proposition), sans doublon, hors fiches déjà servies. */
export function cartesProposees(entrees: readonly EntreeServieVue[], servies: readonly string[]): (CarteVue & { horodatageMs: number })[] {
	const cartes = new Map<string, CarteVue & { horodatageMs: number }>();
	const recentes = [...entrees].sort((a, b) => b.horodatageMs - a.horodatageMs);
	for (const e of recentes) for (const c of e.cartes) if (!servies.includes(c.id) && !cartes.has(c.id)) cartes.set(c.id, { ...c, horodatageMs: e.horodatageMs });
	return [...cartes.values()];
}

/** Chemins des cartes des `n` entrées les plus récentes : celles que le service sait écarter (il ne cherche que là). */
export function cartesRecentes(entrees: readonly EntreeServieVue[], n: number): Set<string> {
	const recentes = [...entrees].sort((a, b) => b.horodatageMs - a.horodatageMs).slice(0, n);
	return new Set(recentes.flatMap((e) => e.cartes.map((c) => c.id)));
}

/** Titres connus par les entrées (les plus récentes l'emportent), chemin → titre. */
export function titresConnus(entrees: readonly EntreeServieVue[]): Map<string, string> {
	const titres = new Map<string, string>();
	for (const e of [...entrees].sort((a, b) => a.horodatageMs - b.horodatageMs)) {
		for (const [chemin, titre] of Object.entries(e.titres ?? {})) titres.set(chemin, titre);
		for (const c of e.cartes) titres.set(c.id, c.titre);
	}
	return titres;
}

/** Titre affiché d'une fiche : son nom de fichier, sans `.md`. */
export function titreFiche(chemin: string): string {
	return (chemin.split('/').pop() ?? chemin).replace(/\.md$/, '');
}
