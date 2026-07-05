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

export class MatchQuality {

    private static readonly PENALTY: number = 2;

    private constructor() {
        // static utility class, no instances
    }

    static similarity(x: string, y: string): number {
        let a: string = x.trim();
        let b: string = y.trim();
        let longest: number = Math.max(a.length, b.length);
        if (longest === 0) {
            return 0;
        }
        let longer: string;
        let shorter: string;
        if (a.length === longest) {
            longer = a;
            shorter = b;
        } else {
            longer = b;
            shorter = a;
        }

        let count: number = -1;
        let common: string = MatchQuality.longestCommonSubstring(longer, shorter);
        while (common.trim() !== '' && common.length > longest * MatchQuality.PENALTY / 100) {
            count++;
            let index: number = longer.indexOf(common);
            longer = longer.substring(0, index) + longer.substring(index + common.length);
            index = shorter.indexOf(common);
            shorter = shorter.substring(0, index) + shorter.substring(index + common.length);
            common = MatchQuality.longestCommonSubstring(longer, shorter);
        }

        let result: number = Math.floor(100 * (longest - longer.length) / longest) - count * MatchQuality.PENALTY;
        return result < 0 ? 0 : result;
    }

    private static longestCommonSubstring(x: string, y: string): string {
        let m: number = x.length;
        let n: number = y.length;
        let max: number = 0;
        let end: number = 0;
        let lengths: Array<Array<number>> = [];
        for (let i: number = 0; i <= m; i++) {
            lengths.push(new Array<number>(n + 1).fill(0));
        }

        for (let i: number = 1; i <= m; i++) {
            for (let j: number = 1; j <= n; j++) {
                if (x.charAt(i - 1) === y.charAt(j - 1)) {
                    lengths[i][j] = lengths[i - 1][j - 1] + 1;
                    if (lengths[i][j] > max) {
                        max = lengths[i][j];
                        end = i;
                    }
                }
            }
        }
        return x.substring(end - max, end);
    }
}
