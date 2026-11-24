// Script de processus enfant des tests : ouvre l'index et y remplace `nombre` fiches distinctes.
import { ouvrirIndex } from '../../src/infra/index-sqlite.ts';

const [fichier, prefixe, nombre] = process.argv.slice(2) as [string, string, string];
const index = ouvrirIndex(fichier);
for (let i = 0; i < Number(nombre); i++) {
	const chemin = `${prefixe}${i}.md`;
	await index.remplacer(
		{ chemin, empreinte: 'e', mtimeMs: 1, taille: 1 },
		{
			titre: chemin,
			alias: [],
			liens: [],
			anomalies: [],
			elements: [{ id: chemin, chemin, genre: 'fiche', typeFiche: 'sujet', texte: `texte ${chemin}`, contexte: '', statut: 'servi', date: null, valideFin: null, finIncluse: false, confiance: null, source: null, typeSource: null, categorie: null, niveau: null, portee: null, dossierProjet: null }],
		},
	);
}
index.fermer();
