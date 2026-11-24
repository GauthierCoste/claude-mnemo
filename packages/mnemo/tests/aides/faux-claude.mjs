// Faux `claude` des tests : jamais le vrai. Lancé sous un pseudo-terminal, il imite ce que Mnemo attend de Claude Code :
// lit ses arguments (`--session-id` ou `--resume`, `--plugin-dir`), lance les hooks du `hooks/hooks.json` du plugin comme
// Claude Code (forme « exec » : `command` + `args`, SANS shell, JSON de l'événement sur stdin), et répond aux lignes tapées :
//   - au départ : `SessionStart` ;
//   - chaque ligne : `UserPromptSubmit`, écho, `Stop` ;
//   - `outil:<Nom> <json>` : `PreToolUse`, puis la décision affichée ;
//   - `/exit` : `SessionEnd` (raison `prompt_input_exit`), puis sortie ;
//   - la ligne du bilan de Mnemo (« Mnemo : bilan… »), si `FAUX_CLAUDE_BILAN` désigne un script : `UserPromptSubmit`, puis le
//     script (lancé par ce Node, sans shell, avec l'environnement de la session : il écrit l'épisode comme Claude le ferait),
//     sa sortie affichée, puis `Stop`.
// Options (n'importe où parmi les arguments) : `--tetu` (ignore `/exit` et SIGTERM), `--bavard <Mo>` (inonde la sortie au
// départ), `--enfant` (lance un processus enfant qui ignore SIGTERM et SIGHUP, et affiche `enfant <pid>`).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const valeur = (nom) => {
	const i = args.indexOf(nom);
	return i === -1 ? undefined : args[i + 1];
};
const reprise = valeur('--resume');
const session = valeur('--session-id') ?? reprise ?? '00000000-0000-4000-8000-000000000000';
const plugin = valeur('--plugin-dir');
const tetu = args.includes('--tetu');
const bavard = Number(valeur('--bavard') ?? 0);

const ecrire = (texte) => new Promise((r) => (process.stdout.write(texte) ? r() : process.stdout.once('drain', r)));
const ligne = (texte) => ecrire(`${texte}\r\n`);

let hooks = {};
if (plugin !== undefined) {
	try {
		hooks = JSON.parse(readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8')).hooks ?? {};
	} catch {
		hooks = {};
	}
}

function correspond(matcher, outil) {
	if (matcher === undefined || matcher === '' || matcher === '*' || outil === undefined) return true;
	try {
		return new RegExp(`^(?:${matcher})$`, 'u').test(outil);
	} catch {
		return false;
	}
}

/** Un hook « command » : `command` + `args` lancés directement (sans shell), l'événement en JSON sur stdin ; rend sa sortie. */
function executer(h, entree) {
	return new Promise((resoudre) => {
		let sortie = '';
		let fini = false;
		const finir = () => {
			if (fini) return;
			fini = true;
			clearTimeout(minuteur);
			resoudre(sortie);
		};
		let enfant;
		try {
			enfant = spawn(h.command, Array.isArray(h.args) ? h.args : [], { stdio: ['pipe', 'pipe', 'ignore'], env: process.env, cwd: process.cwd() });
		} catch {
			resoudre('');
			return;
		}
		const minuteur = setTimeout(() => {
			enfant.kill('SIGKILL');
			finir();
		}, (typeof h.timeout === 'number' ? h.timeout : 60) * 1000);
		enfant.stdout.on('data', (m) => {
			sortie += m.toString('utf8');
		});
		enfant.on('error', finir);
		enfant.on('close', finir);
		enfant.stdin.on('error', () => {});
		enfant.stdin.end(JSON.stringify(entree));
	});
}

/** Tous les hooks de l'événement (en parallèle, comme Claude Code) ; rend leurs sorties. */
async function hook(evenement, donnees = {}, outil) {
	const entree = { session_id: session, transcript_path: '', cwd: process.cwd(), hook_event_name: evenement, ...donnees };
	const taches = [];
	for (const groupe of hooks[evenement] ?? []) {
		if (!correspond(groupe.matcher, outil)) continue;
		for (const h of groupe.hooks ?? []) if (h.type === 'command') taches.push(executer(h, entree));
	}
	return Promise.all(taches);
}

/** Lance un script Node (sans shell) et rend sa sortie, une fois fini. */
function lancerScript(script) {
	return new Promise((resoudre) => {
		let sortie = '';
		const enfant = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, cwd: process.cwd() });
		enfant.stdout.on('data', (m) => {
			sortie += m.toString('utf8');
		});
		enfant.stderr.on('data', (m) => {
			sortie += m.toString('utf8');
		});
		enfant.on('error', (e) => resoudre(`erreur ${e.message}`));
		enfant.on('close', () => resoudre(sortie));
	});
}

function decision(sorties) {
	for (const s of sorties) {
		try {
			const r = JSON.parse(s).hookSpecificOutput;
			if (r?.permissionDecision !== undefined) return `${r.permissionDecision}${r.permissionDecisionReason ? ` (${r.permissionDecisionReason})` : ''}`;
		} catch {
			// sortie non JSON : ignorée
		}
	}
	return 'allow';
}

async function traiter(texte) {
	if (texte === '/exit') {
		if (tetu) return ligne('/exit ignoré');
		await hook('SessionEnd', { reason: 'prompt_input_exit' });
		await ligne('au revoir');
		process.exit(0);
	}
	const outil = /^outil:(\S+)\s*(.*)$/u.exec(texte);
	if (outil !== null) {
		let entree = {};
		try {
			entree = JSON.parse(outil[2] || '{}');
		} catch {
			entree = {};
		}
		const sorties = await hook('PreToolUse', { tool_name: outil[1], tool_input: entree }, outil[1]);
		return ligne(`décision: ${decision(sorties)}`);
	}
	if (texte.trim() === '') return;
	await hook('UserPromptSubmit', { prompt: texte });
	const script = process.env.FAUX_CLAUDE_BILAN;
	if (script !== undefined && script !== '' && /^Mnemo : bilan/u.test(texte)) await ligne(`bilan: ${(await lancerScript(script)).trim()}`);
	await ligne(`écho: ${texte}`);
	await hook('Stop', { stop_hook_active: false });
}

if (tetu) process.on('SIGTERM', () => void ligne('SIGTERM ignoré'));
process.stdout.on('resize', () => void ligne(`taille ${process.stdout.columns}x${process.stdout.rows}`));

await ligne(`faux-claude ${JSON.stringify(args)}`);
await ligne(`cwd ${process.cwd()}`);
await ligne(`taille ${process.stdout.columns}x${process.stdout.rows}`);
await ligne(`env MNEMO_SESSION=${process.env.MNEMO_SESSION ?? ''} ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ''}`);
if (args.includes('--enfant')) {
	const code = "process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);";
	const enfant = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
	await ligne(`enfant ${enfant.pid}`);
}
await hook('SessionStart', { source: reprise === undefined ? 'startup' : 'resume' });
if (bavard > 0) {
	const bloc = `${'#'.repeat(1023)}\n`.repeat(64);
	for (let i = 0; i < bavard * 16; i++) await ecrire(bloc);
}
await ligne('prêt');

let file = Promise.resolve();
// Sous Windows (ConPTY), libuv ne signale un redimensionnement (`resize`) qu'en lecture brute de la console, comme la fait
// le vrai Claude Code ; en mode ligne, `taille …` ne viendrait jamais. Ailleurs, le mode du terminal reste celui par défaut.
if (process.platform === 'win32' && process.stdin.isTTY) process.stdin.setRawMode(true);
const lecteur = createInterface({ input: process.stdin });
lecteur.on('line', (texte) => {
	file = file.then(() => traiter(texte)).catch(() => {});
});
lecteur.on('close', () => {
	if (!tetu) file.then(() => process.exit(0));
});
