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

import { Catalog, ContentHandler, Grammar, XMLAttribute, XMLElement } from "typesxml";
import { TranslationMemory } from "./TranslationMemory.js";

export class TMXContentHandler implements ContentHandler {

    private translationMemory: TranslationMemory;
    private metadata: Record<string, string> | undefined;
    private onProgress: ((count: number) => void) | undefined;
    private current: XMLElement | null;
    private stack: Array<XMLElement>;
    private inCDATA: boolean;
    private count: number;

    constructor(translationMemory: TranslationMemory, metadata?: Record<string, string>, onProgress?: (count: number) => void) {
        this.translationMemory = translationMemory;
        this.metadata = metadata;
        this.onProgress = onProgress;
        this.current = null;
        this.stack = [];
        this.inCDATA = false;
        this.count = 0;
    }

    getCount(): number {
        return this.count;
    }

    initialize(): void {
        this.current = null;
        this.stack = [];
        this.inCDATA = false;
    }

    setCatalog(catalog: Catalog): void {
        // import does not validate, catalog is only used to resolve the TMX DTD entity
    }

    startDocument(): void {
        this.translationMemory.beginTransaction();
    }

    endDocument(): void {
        this.translationMemory.commit();
        this.stack = [];
    }

    xmlDeclaration(version: string, encoding: string, standalone: string | undefined): void {
        // do nothing
    }

    internalSubset(declaration: string): void {
        // do nothing
    }

    startDTD(name: string, publicId: string, systemId: string): void {
        // do nothing
    }

    endDTD(): void {
        // do nothing
    }

    startElement(name: string, atts: Array<XMLAttribute>): void {
        let element: XMLElement = new XMLElement(name);
        for (let i: number = 0; i < atts.length; i++) {
            element.setAttribute(atts[i]);
        }
        if (this.current === null) {
            this.current = element;
        } else {
            // TMX 1.1's <ut> is superseded by <bpt>/<ept>/<ph>; drop it and its content from the stored TU
            if (name !== 'ut') {
                this.current.addElement(element);
            }
            this.stack.push(this.current);
            this.current = element;
        }
    }

    endElement(name: string): void {
        if (this.current === null) {
            return;
        }
        if (name === 'tu') {
            this.translationMemory.storeTu(this.current, this.metadata);
            this.count++;
            if (this.count % 500 === 0) {
                // commit periodically instead of leaving the whole import as one giant transaction,
                // and compact the ngram delta table at the same cadence so it never grows large
                this.translationMemory.commit();
                this.translationMemory.compactTouchedLanguages();
                this.translationMemory.beginTransaction();
                if (this.onProgress !== undefined) {
                    this.onProgress(this.count);
                }
            }
            // only one <tu> subtree is ever held in memory; drop the <tmx>/<header>/<body>
            // ancestry so the next <tu> starts as its own orphan root
            this.current = null;
            this.stack = [];
            return;
        }
        if (this.stack.length > 0) {
            this.current = this.stack.pop() as XMLElement;
        }
    }

    characters(ch: string): void {
        if (!this.inCDATA && this.current !== null) {
            this.current.addString(ch);
        }
    }

    ignorableWhitespace(ch: string): void {
        // do nothing
    }

    comment(ch: string): void {
        // do nothing
    }

    processingInstruction(target: string, data: string): void {
        // do nothing
    }

    startCDATA(): void {
        this.inCDATA = true;
    }

    endCDATA(): void {
        this.inCDATA = false;
    }

    skippedEntity(name: string): void {
        // do nothing
    }

    getGrammar(): Grammar | undefined {
        return undefined;
    }

    setGrammar(grammar: Grammar | undefined): void {
        // do nothing, import does not validate
    }

    getCurrentText(): string {
        return this.current !== null ? this.current.pureText() : '';
    }
}
