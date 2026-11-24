/** Valeur d'une variable d'environnement : sous Windows, les noms ne tiennent pas compte de la casse (`Path`, `PATH`) ; ailleurs, nom exact. */
export function variable(env: NodeJS.ProcessEnv, nom: string, plateforme: NodeJS.Platform): string | undefined {
	if (plateforme !== 'win32') return env[nom];
	const cle = Object.keys(env).find((k) => k.toUpperCase() === nom.toUpperCase());
	return cle === undefined ? undefined : env[cle];
}
