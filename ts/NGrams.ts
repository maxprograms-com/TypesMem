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
    private static readonly SEPARATORS: string = " \r\n\f\t\u2028\u2029,.;\":<>¿?¡!()[]{}=+\-/*\u00AB\u00BB\u201C\u201D\u201E\uFF00";

    private constructor() {
        // static utility class, no instances
    }

    static getNGrams(text: string, lang: string): Array<string> {
        let normalized: string = text.toLocaleLowerCase(lang).trim();
        if (normalized === '') {
            return [];
        }
        let unique: Set<string> = new Set<string>();
        let words: Array<string> = this.buildWordList(normalized);
        for (let word of words) {
            if (word.length < NGrams.NGRAM_SIZE) {
                unique.add(word);
                continue;
            }
            let length: number = word.length;
            let ngrams: number = Math.floor(length / NGrams.NGRAM_SIZE);
            if (ngrams * NGrams.NGRAM_SIZE < length) {
                ngrams++;
            }
            for (let i: number = 0; i < ngrams; i++) {
                let gram: string = '';
                for (let j: number = 0; j < NGrams.NGRAM_SIZE; j++) {
                    if (i * NGrams.NGRAM_SIZE + j < length) {
                        gram += word.charAt(i * NGrams.NGRAM_SIZE + j);
                    }
                }
                unique.add(gram);
            }
        }
        return Array.from(unique);
    }

    private static buildWordList(text: string): string[] {
        let result: string[] = [];
        let current: string = '';
        for (let i: number = 0; i < text.length; i++) {
            let c: string = text.charAt(i);
            if (NGrams.SEPARATORS.indexOf(c) >= 0) {
                if (current.length > 0) {
                    result.push(current);
                    current = '';
                }
            } else {
                current += c;
            }
        }
        if (current.length > 0) {
            result.push(current);
        }
        return result;
    }
}
