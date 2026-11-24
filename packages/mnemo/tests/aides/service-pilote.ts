// Service minimal pour les tests de plantage (lancé par `node`, comme le vrai service) : lance une session sous un vrai
// pseudo-terminal (`faux-claude --tetu --enfant`), affiche `{ session, pid, enfant }` sur une ligne, puis attend d'être tué.
// Arguments : <racine> <faux-claude.mjs> <script de hook>.
import { creerPilote } from '../../src/application/pilote.ts';
import { dependancesReelles, pilotageReel } from '../../src/infra/systeme.ts';
import { terminauxPty } from '../../src/infra/terminaux-pty.ts';

const [racine, fauxClaude, hook] = process.argv.slice(2) as [string, string, string];
const pil = await pilotageReel(racine, { terminaux: await terminauxPty({ delaiArretMs: 300 }) });
pil.plugin.claude = { commande: process.execPath, avant: [fauxClaude, '--tetu', '--enfant'] };
pil.plugin.appel = { node: process.execPath, main: hook, version: '0.0.0-essai' };
// battement serré : la fenêtre des restes reconnus couvre tout ce qui est né avant le plantage
const pilote = creerPilote(dependancesReelles(racine), pil, { battementMs: 100 });
const r = await pilote.lancer({ profil: 'travail', dossier: 'alpha' });
if (!('session' in r) || 'manuel' in r) {
	console.log(JSON.stringify({ erreur: r }));
	process.exit(1);
}
let sortie = '';
const abonnement = pilote.abonner(r.session.id, (d) => {
	sortie += d;
});
sortie = (abonnement?.relecture ?? '') + sortie;
while (!/prêt/u.test(sortie)) await new Promise((attente) => setTimeout(attente, 20));
// au moins un battement après la naissance de l'enfant
await new Promise((attente) => setTimeout(attente, 400));
const pid = (await pil.etat.lire(r.session.id))?.pid ?? null;
console.log(JSON.stringify({ session: r.session.id, pid, enfant: Number(/enfant (\d+)\s/u.exec(sortie)?.[1]) }));
setInterval(() => {}, 1000);
