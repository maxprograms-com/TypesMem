/*******************************************************************************
 * Copyright (c) 2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

export class NGrams {

    private static readonly NGRAM_SIZE: number = 3;

    private constructor() {
        // static utility class, no instances
    }

    static getNGrams(text: string, lang: string): Array<string> {
        let normalized: string = text.toLocaleLowerCase(lang).trim();
        let unique: Set<string> = new Set<string>();
        if (normalized === '') {
            return [];
        }
        if (normalized.length < NGrams.NGRAM_SIZE) {
            unique.add(normalized);
            return Array.from(unique);
        }
        let lastStart: number = normalized.length - NGrams.NGRAM_SIZE;
        for (let start: number = 0; start <= lastStart; start++) {
            unique.add(normalized.substring(start, start + NGrams.NGRAM_SIZE));
        }
        return Array.from(unique);
    }
}
