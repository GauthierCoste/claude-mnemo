/** Faux WebSocket pilotable : les tests ouvrent, ferment et font parler la socket à la main. */
export class FauxWebSocket {
	static instances: FauxWebSocket[] = [];
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readonly url: string;
	readonly protocoles: string[] | undefined;
	readyState = 0;
	envoyes: unknown[] = [];
	onopen: ((e: Event) => void) | null = null;
	onmessage: ((e: MessageEvent) => void) | null = null;
	onclose: ((e: CloseEvent) => void) | null = null;
	onerror: ((e: Event) => void) | null = null;

	constructor(url: string, protocoles?: string | string[]) {
		this.url = url;
		this.protocoles = protocoles === undefined ? undefined : ([] as string[]).concat(protocoles);
		FauxWebSocket.instances.push(this);
	}

	static derniere(): FauxWebSocket {
		const s = FauxWebSocket.instances.at(-1);
		if (!s) throw new Error('aucune socket créée');
		return s;
	}

	static reinitialiser(): void {
		FauxWebSocket.instances = [];
	}

	send(donnees: string): void {
		if (this.readyState !== 1) throw new Error('socket fermée');
		this.envoyes.push(JSON.parse(donnees));
	}

	close(): void {
		if (this.readyState === 3) return;
		this.fermerDepuisServeur(1000);
	}

	// --- pilotage par le test ---
	ouvrir(): void {
		this.readyState = 1;
		this.onopen?.(new Event('open'));
	}

	recevoir(message: unknown): void {
		this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
	}

	fermerDepuisServeur(code = 1006): void {
		this.readyState = 3;
		this.onclose?.({ code } as CloseEvent);
	}

	/** Messages envoyés d'un type donné. */
	envoyesDeType(type: string): unknown[] {
		return this.envoyes.filter((m) => (m as { type: string }).type === type);
	}
}

export const FauxWebSocketType = FauxWebSocket as unknown as typeof WebSocket;
