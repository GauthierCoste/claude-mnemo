// Faux `llama-server` pour les tests : mêmes arguments, mêmes points d'entrée (`/health`, `/v1/models`, `/v1/embeddings`,
// `/v1/rerank`), clé `--api-key` exigée. Ne charge aucun modèle. Réglages lus dans `<modèle>.faux.json` (à côté du fichier
// passé par `-m`, car l'environnement transmis est minimal) :
//   { "demarrageMs": 0, "delaiMs": 0, "dimension": 1024, "defaut": null | "json" | "compte" | "500" | "premier-echoue" | "echoue",
//     "notes": [logit du document 0, du document 1, …] (reranker ; sinon une note tirée des lettres communes) }
// Chaque lancement ajoute une ligne JSON à `lancements.log` dans le dossier du modèle : { pid, args, env (noms des variables) }.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const valeur = (nom) => {
	const i = args.indexOf(nom);
	return i >= 0 ? args[i + 1] : undefined;
};
const modele = valeur('-m');
const port = Number(valeur('--port'));
const hote = valeur('--host') ?? '127.0.0.1';
const fichierCle = valeur('--api-key-file');
// comme llama-server : le fichier de clés est lu au démarrage seulement (une clé par ligne, « # » : commentaire)
const cle = fichierCle !== undefined ? readFileSync(fichierCle, 'utf8').split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#')) : valeur('--api-key');
const sens = args.includes('--embedding');
const reranker = args.includes('--reranking');
if (modele === undefined || !Number.isInteger(port)) process.exit(2);

const fichierReglages = `${modele}.faux.json`;
const reglages = existsSync(fichierReglages) ? JSON.parse(readFileSync(fichierReglages, 'utf8')) : {};
const dimension = reglages.dimension ?? 1024;
const defaut = reglages.defaut ?? null;

const journal = `${dirname(modele)}/lancements.log`;
const dejaLance = existsSync(journal) && readFileSync(journal, 'utf8').includes(JSON.stringify(modele));
appendFileSync(journal, `${JSON.stringify({ pid: process.pid, args, env: Object.keys(process.env).sort() })}\n`);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let pret = false;

/** Vecteur déterministe tiré du texte. */
function vecteur(texte) {
	const v = [];
	let h = 2166136261;
	for (const c of texte) h = Math.imul(h ^ c.codePointAt(0), 16777619);
	for (let i = 0; i < dimension; i++) {
		h = Math.imul(h ^ i, 16777619);
		v.push(((h >>> 0) % 1000) / 1000 - 0.5);
	}
	return v;
}

function repondre(res, code, corps) {
	res.writeHead(code, { 'content-type': 'application/json' });
	res.end(typeof corps === 'string' ? corps : JSON.stringify(corps));
}

const serveur = createServer((req, res) => {
	let brut = '';
	req.on('data', (d) => (brut += d));
	req.on('end', async () => {
		if (req.url === '/health') return repondre(res, pret ? 200 : 503, { status: pret ? 'ok' : 'loading' });
		if (req.headers.authorization !== `Bearer ${cle}`) return repondre(res, 401, { error: { message: 'Invalid API Key', code: 401 } });
		if (!pret) return repondre(res, 503, { error: { message: 'Loading model', code: 503 } });
		if (req.method === 'GET' && req.url === '/v1/models') return repondre(res, 200, { object: 'list', data: [{ id: modele }] });
		if (req.method !== 'POST') return repondre(res, 404, { error: { message: 'introuvable' } });
		let corps;
		try {
			corps = JSON.parse(brut);
		} catch {
			return repondre(res, 400, { error: { message: 'json' } });
		}
		if (reglages.delaiMs) await attendre(reglages.delaiMs);
		if (defaut === '500') return repondre(res, 500, { error: { message: 'panne' } });
		if (defaut === 'json') return repondre(res, 200, '{"data": [');
		if (req.url === '/v1/embeddings') {
			if (!sens) return repondre(res, 501, { error: { message: 'pas de sens' } });
			const textes = corps.input;
			const n = defaut === 'compte' ? textes.length - 1 : textes.length;
			// dans le désordre, comme un serveur qui répond par lots
			const data = textes.slice(0, n).map((t, index) => ({ object: 'embedding', index, embedding: vecteur(t) })).reverse();
			return repondre(res, 200, { object: 'list', model: modele, data });
		}
		if (req.url === '/v1/rerank') {
			if (!reranker) return repondre(res, 501, { error: { message: 'pas de reranker' } });
			const n = defaut === 'compte' ? corps.documents.length - 1 : corps.documents.length;
			// note : celle des réglages, sinon le nombre de lettres de la requête présentes dans le document ; rendu du mieux
			// noté au moins bien noté, avec `usage`, comme llama-server b11671 (forme relevée sur le vrai serveur)
			const lettres = new Set(String(corps.query).toLowerCase());
			const note = (d, index) => reglages.notes?.[index] ?? [...new Set(String(d).toLowerCase())].filter((c) => lettres.has(c)).length / 10;
			const results = corps.documents
				.slice(0, n)
				.map((d, index) => ({ index, relevance_score: note(d, index) }))
				.sort((a, b) => b.relevance_score - a.relevance_score);
			const jetons = corps.documents.reduce((s, d) => s + String(d).length, String(corps.query).length);
			return repondre(res, 200, { model: modele, object: 'list', usage: { prompt_tokens: jetons, total_tokens: jetons }, results });
		}
		return repondre(res, 404, { error: { message: 'introuvable' } });
	});
});

serveur.on('error', () => process.exit(1));
// « premier-echoue » : le premier lancement de ce modèle échoue (comme un port pris entre-temps), les suivants marchent.
if (defaut === 'premier-echoue' && !dejaLance) process.exit(1);
// « echoue » : chaque lancement de ce modèle échoue (modèle impossible à charger).
if (defaut === 'echoue') process.exit(1);
serveur.listen(port, hote, async () => {
	if (reglages.demarrageMs) await attendre(reglages.demarrageMs);
	pret = true;
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));
