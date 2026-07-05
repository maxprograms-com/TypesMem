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

import { Constants, DOMBuilder, SAXParser, TextNode, XMLDocument, XMLElement, XMLNode } from "typesxml";
import { I18n } from "./i18n.js";

export class TMUtils {

    private constructor() {
        // static utility class, no instances
    }

    static creationDate(): string {
        return TMUtils.formatDate(new Date());
    }

    static formatDate(date: Date): string {
        let year: string = '' + date.getUTCFullYear();
        let month: string = TMUtils.pad(date.getUTCMonth() + 1);
        let day: string = TMUtils.pad(date.getUTCDate());
        let hours: string = TMUtils.pad(date.getUTCHours());
        let minutes: string = TMUtils.pad(date.getUTCMinutes());
        let seconds: string = TMUtils.pad(date.getUTCSeconds());
        return year + month + day + 'T' + hours + minutes + seconds + 'Z';
    }

    private static pad(value: number): string {
        return value < 10 ? '0' + value : '' + value;
    }

    static extractText(seg: XMLElement): string {
        // inline elements are discarded from the plain text, except <sub> and <hi>, whose own text still belongs to the segment
        let result: string = '';
        let content: Array<XMLNode> = seg.getContent();
        for (let i: number = 0; i < content.length; i++) {
            let node: XMLNode = content[i];
            if (node.getNodeType() === Constants.TEXT_NODE) {
                result += (node as TextNode).getValue();
            } else if (node instanceof XMLElement) {
                let name: string = node.getName();
                if (name === 'sub' || name === 'hi') {
                    result += TMUtils.extractText(node);
                }
            }
        }
        return result;
    }

    static parseSegment(seg: string, i18n: I18n): XMLElement {
        let xml: string = seg.trim().startsWith('<seg') ? seg : '<seg>' + seg + '</seg>';
        let builder: DOMBuilder = new DOMBuilder();
        let parser: SAXParser = new SAXParser();
        parser.setContentHandler(builder);
        parser.parseString(xml);
        let document: XMLDocument | undefined = builder.getDocument();
        let root: XMLElement | undefined = document ? document.getRoot() : undefined;
        if (root === undefined) {
            throw new Error(i18n.format(i18n.getString('tmUtils', 'invalidSegment'), [seg]));
        }
        return root;
    }
}
