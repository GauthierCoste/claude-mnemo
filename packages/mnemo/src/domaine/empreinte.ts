/** Hachage FNV-1a 64 bits incrémental : `ajouter` des morceaux dans l'ordre, puis `resultat`. Même valeur que d'un bloc. */
export type Hacheur = { ajouter(octets: Uint8Array): void; resultat(): string };

/**
 * Empreinte FNV-1a 64 bits, en 16 caractères hexadécimaux, calculée morceau par morceau (un document de plusieurs Go se
 * hache sans être chargé). Calcul sur quatre mots de 16 bits (pas de BigInt). Multiplier par le premier 0x100000001b3,
 * c'est multiplier par 0x1b3 puis ajouter le hachage décalé de 40 bits.
 */
export function hacheurOctets(): Hacheur {
	// 0xcbf29ce484222325, du mot de poids faible au mot de poids fort.
	let h0 = 0x2325;
	let h1 = 0x8422;
	let h2 = 0x9ce4;
	let h3 = 0xcbf2;
	return {
		ajouter(octets) {
			for (let i = 0; i < octets.length; i++) {
				h0 ^= octets[i]!;
				const t0 = h0 * 0x1b3;
				let t1 = h1 * 0x1b3;
				let t2 = h2 * 0x1b3 + (h0 << 8);
				const t3 = h3 * 0x1b3 + (h1 << 8);
				t1 += t0 >>> 16;
				h0 = t0 & 0xffff;
				t2 += t1 >>> 16;
				h1 = t1 & 0xffff;
				h3 = (t3 + (t2 >>> 16)) & 0xffff;
				h2 = t2 & 0xffff;
			}
		},
		resultat() {
			const hex = (n: number) => n.toString(16).padStart(4, '0');
			return `${hex(h3)}${hex(h2)}${hex(h1)}${hex(h0)}`;
		},
	};
}

/** Empreinte FNV-1a 64 bits d'octets bruts, en 16 caractères hexadécimaux. Pure et stable. */
export function empreinteOctets(octets: Uint8Array): string {
	const h = hacheurOctets();
	h.ajouter(octets);
	return h.resultat();
}

/** Empreinte FNV-1a 64 bits du texte (UTF-8), en 16 caractères hexadécimaux. Pure et stable. */
export function empreinte(texte: string): string {
	return empreinteOctets(new TextEncoder().encode(texte));
}
