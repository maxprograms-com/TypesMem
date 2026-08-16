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

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, StatementSync, type SQLOutputValue, type StatementResultingChanges } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { LanguageUtils } from "typesbcp47";
import type { Match } from "typesmatch";
import { Catalog, Indenter, SAXParser, XMLAttribute, XMLElement } from "typesxml";
import { I18n } from "./i18n.js";
import { MatchQuality } from "./MatchQuality.js";
import { NGrams } from "./NGrams.js";
import { TMUtils } from "./TMUtils.js";
import { TMXContentHandler } from "./TMXContentHandler.js";

const SUPPORTED_LANGUAGES: Array<string> = ['en', 'es'];

interface FuzzyCandidate {
    id: number;
    distance: number;
    sourceRow: Record<string, SQLOutputValue>;
}

export class TranslationMemory {

    private name: string;
    private i18n: I18n;
    private db: DatabaseSync;
    private memoryFolder: string;
    private next: number;
    private ensuredDeltaNgramTables: Set<string>;
    private ensuredPackedNgramTables: Set<string>;
    private bulkNgramMode: boolean;
    private bulkLanguagesTouched: Set<string>;

    private selectTuByIdStatement: StatementSync;
    private insertTuStatement: StatementSync;
    private updateTuStatement: StatementSync;
    private deleteTuStatement: StatementSync;
    private selectIdByTuidStatement: StatementSync;
    private selectExportableTusStatement: StatementSync;

    private insertPropertyStatement: StatementSync;
    private selectPropertiesStatement: StatementSync;
    private deletePropertiesStatement: StatementSync;
    private insertNoteStatement: StatementSync;
    private selectNotesStatement: StatementSync;
    private deleteNotesStatement: StatementSync;

    private insertTuvStatement: StatementSync;
    private selectTuvStatement: StatementSync;
    private selectTuvByLangStatement: StatementSync;
    private deleteTuvStatement: StatementSync;
    private deleteTuvByLangStatement: StatementSync;
    private insertTuvPropertyStatement: StatementSync;
    private selectTuvPropertiesStatement: StatementSync;
    private deleteTuvPropertiesStatement: StatementSync;
    private deleteTuvPropertiesByLangStatement: StatementSync;
    private insertTuvNoteStatement: StatementSync;
    private selectTuvNotesStatement: StatementSync;
    private deleteTuvNotesStatement: StatementSync;
    private deleteTuvNotesByLangStatement: StatementSync;

    private selectMetadataValuesStatement: StatementSync;
    private safeLangs: Map<string, string> = new Map<string, string>();
    private langCache: Map<string, string> = new Map<string, string>();

    constructor(name: string, workFolder: string, lang?: string) {
        this.name = name;
        this.next = 0;
        this.ensuredDeltaNgramTables = new Set<string>();
        this.ensuredPackedNgramTables = new Set<string>();
        this.bulkNgramMode = false;
        this.bulkLanguagesTouched = new Set<string>();

        let normalizedLang: string = lang !== undefined && SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en';
        let moduleDir: string = dirname(fileURLToPath(import.meta.url));
        let resourcesFile: string = join(moduleDir, 'i18n', 'typesmem_' + normalizedLang + '.json');
        this.i18n = new I18n(resourcesFile);

        this.memoryFolder = join(workFolder, name);
        if (!existsSync(this.memoryFolder)) {
            mkdirSync(this.memoryFolder, { recursive: true });
        }
        let databaseFile: string = join(this.memoryFolder, 'database.db');
        let isNew: boolean = !existsSync(databaseFile);

        this.db = new DatabaseSync(databaseFile);
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA synchronous = NORMAL');
        this.db.function('TEXT_MATCHES', { deterministic: true }, (value: unknown, pattern: unknown): number => {
            try {
                let regex: RegExp = new RegExp(String(pattern));
                return regex.test(value === null || value === undefined ? '' : String(value)) ? 1 : 0;
            } catch (error) {
                return 0;
            }
        });

        if (isNew) {
            this.createSchema();
        }

        this.selectTuByIdStatement = this.db.prepare(
            'SELECT tuid, oEncoding, datatype, usagecount, lastusagedate, creationtool, creationtoolversion, ' +
            'creationdate, creationid, changedate, segtype, changeid, oTmf, srclang FROM tu WHERE id = ?');
        this.insertTuStatement = this.db.prepare(
            'INSERT INTO tu (tuid, syntheticTuid, oEncoding, datatype, usagecount, lastusagedate, creationtool, ' +
            'creationtoolversion, creationdate, creationid, changedate, segtype, changeid, oTmf, srclang) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        this.updateTuStatement = this.db.prepare(
            'UPDATE tu SET tuid = ?, syntheticTuid = ?, oEncoding = ?, datatype = ?, usagecount = ?, ' +
            'lastusagedate = ?, creationtool = ?, creationtoolversion = ?, creationdate = ?, creationid = ?, ' +
            'changedate = ?, segtype = ?, changeid = ?, oTmf = ?, srclang = ? WHERE id = ?');
        this.deleteTuStatement = this.db.prepare('DELETE FROM tu WHERE id = ?');
        this.selectIdByTuidStatement = this.db.prepare('SELECT id, syntheticTuid FROM tu WHERE tuid = ?');
        this.selectExportableTusStatement = this.db.prepare(
            'SELECT DISTINCT tuv.tuId AS id, tu.syntheticTuid AS syntheticTuid FROM tuv INNER JOIN tu ON tu.id = tuv.tuId');

        this.insertPropertyStatement = this.db.prepare('INSERT INTO properties (tuId, name, value) VALUES (?, ?, ?)');
        this.selectPropertiesStatement = this.db.prepare('SELECT name, value FROM properties WHERE tuId = ?');
        this.deletePropertiesStatement = this.db.prepare('DELETE FROM properties WHERE tuId = ?');

        this.insertNoteStatement = this.db.prepare('INSERT INTO notes (tuId, note) VALUES (?, ?)');
        this.selectNotesStatement = this.db.prepare('SELECT note FROM notes WHERE tuId = ? ORDER BY id');
        this.deleteNotesStatement = this.db.prepare('DELETE FROM notes WHERE tuId = ?');

        this.insertTuvStatement = this.db.prepare(
            'INSERT INTO tuv (tuId, lang, seg, puretext, textlength, oEncoding, datatype, usagecount, ' +
            'lastusagedate, creationtool, creationtoolversion, creationdate, creationid, changedate, changeid, oTmf) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        this.selectTuvStatement = this.db.prepare(
            'SELECT id, lang, seg, puretext, oEncoding, datatype, usagecount, lastusagedate, creationtool, ' +
            'creationtoolversion, creationdate, creationid, changedate, changeid, oTmf FROM tuv WHERE tuId = ?');
        this.selectTuvByLangStatement = this.db.prepare(
            'SELECT id, lang, seg, puretext, textlength, oEncoding, datatype, usagecount, lastusagedate, ' +
            'creationtool, creationtoolversion, creationdate, creationid, changedate, changeid, oTmf ' +
            'FROM tuv WHERE tuId = ? AND lang = ?');
        this.deleteTuvStatement = this.db.prepare('DELETE FROM tuv WHERE tuId = ?');
        this.deleteTuvByLangStatement = this.db.prepare('DELETE FROM tuv WHERE tuId = ? AND lang = ?');

        this.insertTuvPropertyStatement = this.db.prepare('INSERT INTO tuvProperties (tuvId, name, value) VALUES (?, ?, ?)');
        this.selectTuvPropertiesStatement = this.db.prepare('SELECT name, value FROM tuvProperties WHERE tuvId = ?');
        this.deleteTuvPropertiesStatement = this.db.prepare(
            'DELETE FROM tuvProperties WHERE tuvId IN (SELECT id FROM tuv WHERE tuId = ?)');
        this.deleteTuvPropertiesByLangStatement = this.db.prepare(
            'DELETE FROM tuvProperties WHERE tuvId IN (SELECT id FROM tuv WHERE tuId = ? AND lang = ?)');

        this.insertTuvNoteStatement = this.db.prepare('INSERT INTO tuvNotes (tuvId, note) VALUES (?, ?)');
        this.selectTuvNotesStatement = this.db.prepare('SELECT note FROM tuvNotes WHERE tuvId = ? ORDER BY id');
        this.deleteTuvNotesStatement = this.db.prepare(
            'DELETE FROM tuvNotes WHERE tuvId IN (SELECT id FROM tuv WHERE tuId = ?)');
        this.deleteTuvNotesByLangStatement = this.db.prepare(
            'DELETE FROM tuvNotes WHERE tuvId IN (SELECT id FROM tuv WHERE tuId = ? AND lang = ?)');

        this.selectMetadataValuesStatement = this.db.prepare(
            'SELECT DISTINCT value FROM properties WHERE name = ? ORDER BY value');
    }

    private createSchema(): void {
        this.db.exec('CREATE TABLE tu (' +
            'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
            'tuid TEXT UNIQUE, ' +
            'syntheticTuid INTEGER NOT NULL DEFAULT 0, ' +
            'oEncoding TEXT, ' +
            'datatype TEXT, ' +
            'usagecount TEXT, ' +
            'lastusagedate TEXT, ' +
            'creationtool TEXT, ' +
            'creationtoolversion TEXT, ' +
            'creationdate TEXT, ' +
            'creationid TEXT, ' +
            'changedate TEXT, ' +
            'segtype TEXT, ' +
            'changeid TEXT, ' +
            'oTmf TEXT, ' +
            'srclang TEXT' +
            ') STRICT');

        this.db.exec('CREATE TABLE tuv (' +
            'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
            'tuId INTEGER NOT NULL REFERENCES tu(id), ' +
            'lang TEXT NOT NULL, ' +
            'seg TEXT NOT NULL, ' +
            'puretext TEXT NOT NULL, ' +
            'textlength INTEGER NOT NULL, ' +
            'oEncoding TEXT, ' +
            'datatype TEXT, ' +
            'usagecount TEXT, ' +
            'lastusagedate TEXT, ' +
            'creationtool TEXT, ' +
            'creationtoolversion TEXT, ' +
            'creationdate TEXT, ' +
            'creationid TEXT, ' +
            'changedate TEXT, ' +
            'changeid TEXT, ' +
            'oTmf TEXT' +
            ') STRICT');
        this.db.exec('CREATE INDEX idx_tuv_tuId_lang ON tuv(tuId, lang)');
        this.db.exec('CREATE INDEX idx_tuv_lang_textlength ON tuv(lang, textlength)');

        this.db.exec('CREATE TABLE tuvProperties (' +
            'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
            'tuvId INTEGER NOT NULL REFERENCES tuv(id), ' +
            'name TEXT NOT NULL, ' +
            'value TEXT NOT NULL' +
            ') STRICT');
        this.db.exec('CREATE INDEX idx_tuvProperties_tuvId ON tuvProperties(tuvId)');

        this.db.exec('CREATE TABLE tuvNotes (' +
            'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
            'tuvId INTEGER NOT NULL REFERENCES tuv(id), ' +
            'note TEXT NOT NULL' +
            ') STRICT');
        this.db.exec('CREATE INDEX idx_tuvNotes_tuvId ON tuvNotes(tuvId)');

        this.db.exec('CREATE TABLE properties (' +
            'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
            'tuId INTEGER NOT NULL REFERENCES tu(id), ' +
            'name TEXT NOT NULL, ' +
            'value TEXT NOT NULL' +
            ') STRICT');
        this.db.exec('CREATE INDEX idx_properties_tuId ON properties(tuId)');
        this.db.exec('CREATE INDEX idx_properties_name_value ON properties(name, value)');

        this.db.exec('CREATE TABLE notes (' +
            'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
            'tuId INTEGER NOT NULL REFERENCES tu(id), ' +
            'note TEXT NOT NULL' +
            ') STRICT');

        // ngram posting-list tables (both the delta and packed forms) are created per language
        // on demand, see ensureDeltaNgramTable()/ensurePackedNgramTable()
    }

    getName(): string {
        return this.name;
    }

    getType(): string {
        return 'Local';
    }

    getAllLanguages(): Array<string> {
        let languages: Set<string> = new Set<string>();
        let rows: Array<Record<string, SQLOutputValue>> = this.db.prepare('SELECT DISTINCT lang FROM tuv ORDER BY lang').all();
        for (let row of rows) {
            languages.add(row.lang as string);
        }
        return Array.from(languages);
    }

    storeTu(tu: XMLElement, metadata?: Record<string, string>): string {
        this.db.exec('SAVEPOINT storeTu');
        try {
            let tuid: string = this.storeTuInternal(tu, metadata);
            this.db.exec('RELEASE storeTu');
            return tuid;
        } catch (error) {
            this.db.exec('ROLLBACK TO storeTu');
            this.db.exec('RELEASE storeTu');
            throw error;
        }
    }

    private storeTuInternal(tu: XMLElement, metadata?: Record<string, string>): string {
        let tuidAttribute: XMLAttribute | undefined = tu.getAttribute('tuid');
        let tuid: string;
        let syntheticTuid: number;
        let existingId: number | undefined = undefined;

        if (tuidAttribute !== undefined) {
            tuid = tuidAttribute.getValue();
            let existingRow: Record<string, SQLOutputValue> | undefined = this.selectIdByTuidStatement.get(tuid);
            if (existingRow !== undefined) {
                existingId = existingRow.id as number;
                syntheticTuid = existingRow.syntheticTuid as number;
            } else {
                syntheticTuid = 0;
            }
        } else {
            tuid = this.nextId();
            tu.setAttribute(new XMLAttribute('tuid', tuid));
            syntheticTuid = 1;
        }

        let creationDateAttribute: XMLAttribute | undefined = tu.getAttribute('creationdate');
        let creationDate: string | null = creationDateAttribute !== undefined ? creationDateAttribute.getValue() : null;

        let creationIdAttribute: XMLAttribute | undefined = tu.getAttribute('creationid');
        let creationId: string | null = creationIdAttribute !== undefined ? creationIdAttribute.getValue() : null;

        let changeDateAttribute: XMLAttribute | undefined = tu.getAttribute('changedate');
        let changeDate: string | null = changeDateAttribute !== undefined ? changeDateAttribute.getValue() : null;

        let changeIdAttribute: XMLAttribute | undefined = tu.getAttribute('changeid');
        let changeId: string | null = changeIdAttribute !== undefined ? changeIdAttribute.getValue() : null;

        let tuOEncodingAttribute: XMLAttribute | undefined = tu.getAttribute('o-encoding');
        let tuOEncoding: string | null = tuOEncodingAttribute !== undefined ? tuOEncodingAttribute.getValue() : null;
        let tuDatatypeAttribute: XMLAttribute | undefined = tu.getAttribute('datatype');
        let tuDatatype: string | null = tuDatatypeAttribute !== undefined ? tuDatatypeAttribute.getValue() : null;
        let tuUsagecountAttribute: XMLAttribute | undefined = tu.getAttribute('usagecount');
        let tuUsagecount: string | null = tuUsagecountAttribute !== undefined ? tuUsagecountAttribute.getValue() : null;
        let tuLastusagedateAttribute: XMLAttribute | undefined = tu.getAttribute('lastusagedate');
        let tuLastusagedate: string | null = tuLastusagedateAttribute !== undefined ? tuLastusagedateAttribute.getValue() : null;
        let tuCreationtoolAttribute: XMLAttribute | undefined = tu.getAttribute('creationtool');
        let tuCreationtool: string | null = tuCreationtoolAttribute !== undefined ? tuCreationtoolAttribute.getValue() : null;
        let tuCreationtoolversionAttribute: XMLAttribute | undefined = tu.getAttribute('creationtoolversion');
        let tuCreationtoolversion: string | null = tuCreationtoolversionAttribute !== undefined ? tuCreationtoolversionAttribute.getValue() : null;
        let segtypeAttribute: XMLAttribute | undefined = tu.getAttribute('segtype');
        let segtype: string | null = segtypeAttribute !== undefined ? segtypeAttribute.getValue() : null;
        let tuOTmfAttribute: XMLAttribute | undefined = tu.getAttribute('o-tmf');
        let tuOTmf: string | null = tuOTmfAttribute !== undefined ? tuOTmfAttribute.getValue() : null;
        let srclangAttribute: XMLAttribute | undefined = tu.getAttribute('srclang');
        let srclang: string | null = srclangAttribute !== undefined ? srclangAttribute.getValue() : null;

        // a <tu> may carry several <prop> elements sharing the same "type", so properties are
        // collected as a list, not a name-keyed map, or repeated values would be lost
        let properties: Array<{ name: string; value: string }> = [];
        let propertyNamesSeen: Set<string> = new Set<string>();
        let children: Array<XMLElement> = tu.getChildren();
        for (let i: number = 0; i < children.length; i++) {
            let child: XMLElement = children[i];
            if (child.getName() === 'prop') {
                let typeAttribute: XMLAttribute | undefined = child.getAttribute('type');
                if (typeAttribute !== undefined) {
                    let name: string = typeAttribute.getValue();
                    properties.push({ name: name, value: child.getText() });
                    propertyNamesSeen.add(name);
                }
            }
        }
        if (metadata !== undefined) {
            let keys: Array<string> = Object.keys(metadata);
            for (let i: number = 0; i < keys.length; i++) {
                let key: string = keys[i];
                if (!propertyNamesSeen.has(key)) {
                    let value: string = metadata[key];
                    properties.push({ name: key, value: value });
                    propertyNamesSeen.add(key);
                    let propElement: XMLElement = new XMLElement('prop');
                    propElement.setAttribute(new XMLAttribute('type', key));
                    propElement.addString(value);
                    tu.addElement(propElement);
                }
            }
        }

        let id: number;
        if (existingId !== undefined) {
            id = existingId;
            let langs: Set<string> = new Set<string>();
            tu.getChildren().forEach((child: XMLElement): void => {
                if ('tuv' === child.getName()) {
                    let langAttribute: XMLAttribute | undefined = child.getAttribute('xml:lang');
                    if (langAttribute === undefined) {
                        langAttribute = child.getAttribute('lang');
                    }
                    let lang: string = langAttribute !== undefined ? langAttribute.getValue() : '';
                    langs.add(this.normalizeLang(lang));
                }
            });
            this.clearTuvDataForLangs(id, langs);
            this.deletePropertiesStatement.run(id);
            this.deleteNotesStatement.run(id);
            this.updateTuStatement.run(tuid, syntheticTuid, tuOEncoding, tuDatatype, tuUsagecount, tuLastusagedate,
                tuCreationtool, tuCreationtoolversion, creationDate, creationId, changeDate, segtype, changeId,
                tuOTmf, srclang, id);
        } else {
            let insertResult: StatementResultingChanges = this.insertTuStatement.run(tuid, syntheticTuid, tuOEncoding,
                tuDatatype, tuUsagecount, tuLastusagedate, tuCreationtool, tuCreationtoolversion, creationDate,
                creationId, changeDate, segtype, changeId, tuOTmf, srclang);
            id = Number(insertResult.lastInsertRowid);
        }

        for (let i: number = 0; i < properties.length; i++) {
            this.insertPropertyStatement.run(id, properties[i].name, properties[i].value);
        }

        for (let i: number = 0; i < children.length; i++) {
            let child: XMLElement = children[i];
            if (child.getName() === 'note') {
                this.insertNoteStatement.run(id, child.getText());
            }
        }

        for (let i: number = 0; i < children.length; i++) {
            let child: XMLElement = children[i];
            if (child.getName() !== 'tuv') {
                continue;
            }
            let langAttribute: XMLAttribute | undefined = child.getAttribute('xml:lang');
            if (langAttribute === undefined) {
                langAttribute = child.getAttribute('lang');
            }
            let lang: string = langAttribute !== undefined ? langAttribute.getValue() : '';
            if (lang === '') {
                continue;
            }
            lang = this.normalizeLang(lang);
            let segElement: XMLElement | undefined = child.getChild('seg');
            if (segElement === undefined) {
                continue;
            }
            let pureText: string = TMUtils.extractText(segElement);
            if (pureText === '') {
                continue;
            }

            let oEncodingAttribute: XMLAttribute | undefined = child.getAttribute('o-encoding');
            let oEncoding: string | null = oEncodingAttribute !== undefined ? oEncodingAttribute.getValue() : null;
            let datatypeAttribute: XMLAttribute | undefined = child.getAttribute('datatype');
            let datatype: string | null = datatypeAttribute !== undefined ? datatypeAttribute.getValue() : null;
            let usagecountAttribute: XMLAttribute | undefined = child.getAttribute('usagecount');
            let usagecount: string | null = usagecountAttribute !== undefined ? usagecountAttribute.getValue() : null;
            let lastusagedateAttribute: XMLAttribute | undefined = child.getAttribute('lastusagedate');
            let lastusagedate: string | null = lastusagedateAttribute !== undefined ? lastusagedateAttribute.getValue() : null;
            let creationtoolAttribute: XMLAttribute | undefined = child.getAttribute('creationtool');
            let creationtool: string | null = creationtoolAttribute !== undefined ? creationtoolAttribute.getValue() : null;
            let creationtoolversionAttribute: XMLAttribute | undefined = child.getAttribute('creationtoolversion');
            let creationtoolversion: string | null = creationtoolversionAttribute !== undefined ? creationtoolversionAttribute.getValue() : null;
            let tuvCreationDateAttribute: XMLAttribute | undefined = child.getAttribute('creationdate');
            let tuvCreationDate: string | null = tuvCreationDateAttribute !== undefined ? tuvCreationDateAttribute.getValue() : null;
            let tuvCreationIdAttribute: XMLAttribute | undefined = child.getAttribute('creationid');
            let tuvCreationId: string | null = tuvCreationIdAttribute !== undefined ? tuvCreationIdAttribute.getValue() : null;
            let tuvChangeDateAttribute: XMLAttribute | undefined = child.getAttribute('changedate');
            let tuvChangeDate: string | null = tuvChangeDateAttribute !== undefined ? tuvChangeDateAttribute.getValue() : null;
            let tuvChangeIdAttribute: XMLAttribute | undefined = child.getAttribute('changeid');
            let tuvChangeId: string | null = tuvChangeIdAttribute !== undefined ? tuvChangeIdAttribute.getValue() : null;
            let oTmfAttribute: XMLAttribute | undefined = child.getAttribute('o-tmf');
            let oTmf: string | null = oTmfAttribute !== undefined ? oTmfAttribute.getValue() : null;

            let tuvInsertResult: StatementResultingChanges = this.insertTuvStatement.run(
                id, lang, segElement.toString(), pureText, pureText.length,
                oEncoding, datatype, usagecount, lastusagedate, creationtool, creationtoolversion,
                tuvCreationDate, tuvCreationId, tuvChangeDate, tuvChangeId, oTmf);
            let tuvId: number = Number(tuvInsertResult.lastInsertRowid);

            let tuvChildren: Array<XMLElement> = child.getChildren();
            for (let c: number = 0; c < tuvChildren.length; c++) {
                let tuvChild: XMLElement = tuvChildren[c];
                if (tuvChild.getName() === 'prop') {
                    let typeAttribute: XMLAttribute | undefined = tuvChild.getAttribute('type');
                    if (typeAttribute !== undefined) {
                        this.insertTuvPropertyStatement.run(tuvId, typeAttribute.getValue(), tuvChild.getText());
                    }
                } else if (tuvChild.getName() === 'note') {
                    this.insertTuvNoteStatement.run(tuvId, tuvChild.getText());
                }
            }

            let ngrams: Array<string> = NGrams.getNGrams(pureText, lang);
            for (let n: number = 0; n < ngrams.length; n++) {
                this.addToNgramIndex(lang, ngrams[n], id);
            }
        }

        return tuid;
    }

    getTu(tuid: string): XMLElement | undefined {
        let idRow: Record<string, SQLOutputValue> | undefined = this.selectIdByTuidStatement.get(tuid);
        if (idRow === undefined) {
            return undefined;
        }
        return this.getTuById(idRow.id as number);
    }

    private getTuById(id: number): XMLElement | undefined {
        let row: Record<string, SQLOutputValue> | undefined = this.selectTuByIdStatement.get(id);
        if (row === undefined) {
            return undefined;
        }

        let tu: XMLElement = new XMLElement('tu');
        tu.setAttribute(new XMLAttribute('tuid', row.tuid as string));
        if (row.oEncoding !== null) {
            tu.setAttribute(new XMLAttribute('o-encoding', row.oEncoding as string));
        }
        if (row.datatype !== null) {
            tu.setAttribute(new XMLAttribute('datatype', row.datatype as string));
        }
        if (row.usagecount !== null) {
            tu.setAttribute(new XMLAttribute('usagecount', row.usagecount as string));
        }
        if (row.lastusagedate !== null) {
            tu.setAttribute(new XMLAttribute('lastusagedate', row.lastusagedate as string));
        }
        if (row.creationtool !== null) {
            tu.setAttribute(new XMLAttribute('creationtool', row.creationtool as string));
        }
        if (row.creationtoolversion !== null) {
            tu.setAttribute(new XMLAttribute('creationtoolversion', row.creationtoolversion as string));
        }
        if (row.creationdate !== null) {
            tu.setAttribute(new XMLAttribute('creationdate', row.creationdate as string));
        }
        if (row.creationid !== null) {
            tu.setAttribute(new XMLAttribute('creationid', row.creationid as string));
        }
        if (row.changedate !== null) {
            tu.setAttribute(new XMLAttribute('changedate', row.changedate as string));
        }
        if (row.segtype !== null) {
            tu.setAttribute(new XMLAttribute('segtype', row.segtype as string));
        }
        if (row.changeid !== null) {
            tu.setAttribute(new XMLAttribute('changeid', row.changeid as string));
        }
        if (row.oTmf !== null) {
            tu.setAttribute(new XMLAttribute('o-tmf', row.oTmf as string));
        }
        if (row.srclang !== null) {
            tu.setAttribute(new XMLAttribute('srclang', row.srclang as string));
        }

        let propertyRows: Array<Record<string, SQLOutputValue>> = this.selectPropertiesStatement.all(id);
        for (let i: number = 0; i < propertyRows.length; i++) {
            let propElement: XMLElement = new XMLElement('prop');
            propElement.setAttribute(new XMLAttribute('type', propertyRows[i].name as string));
            propElement.addString(propertyRows[i].value as string);
            tu.addElement(propElement);
        }

        let noteRows: Array<Record<string, SQLOutputValue>> = this.selectNotesStatement.all(id);
        for (let i: number = 0; i < noteRows.length; i++) {
            let noteElement: XMLElement = new XMLElement('note');
            noteElement.addString(noteRows[i].note as string);
            tu.addElement(noteElement);
        }

        let tuvRows: Array<Record<string, SQLOutputValue>> = this.selectTuvStatement.all(id);
        for (let i: number = 0; i < tuvRows.length; i++) {
            tu.addElement(this.buildTuvElement(tuvRows[i]));
        }

        return tu;
    }

    searchTranslation(text: string, srcLang: string, tgtLang: string, similarity: number, limit?: number, caseSensitive?: boolean): Array<Match> {
        if (text.trim() === '') {
            return [];
        }
        let candidates: Array<FuzzyCandidate> = this.findFuzzyCandidates(text, srcLang, similarity, caseSensitive);

        let matches: Array<Match> = [];
        for (let i: number = 0; i < candidates.length; i++) {
            let id: number = candidates[i].id;

            let targetRow: Record<string, SQLOutputValue> | undefined = this.selectTuvByLangStatement.get(id, tgtLang);
            if (targetRow === undefined) {
                continue;
            }

            let tuRow: Record<string, SQLOutputValue> | undefined = this.selectTuByIdStatement.get(id);
            if (tuRow === undefined) {
                continue;
            }

            let properties: Record<string, string> = {};
            let propertyRows: Array<Record<string, SQLOutputValue>> = this.selectPropertiesStatement.all(id);
            for (let p: number = 0; p < propertyRows.length; p++) {
                properties[propertyRows[p].name as string] = propertyRows[p].value as string;
            }

            matches.push({
                id: tuRow.tuid as string,
                source: this.buildTuvElement(candidates[i].sourceRow),
                target: this.buildTuvElement(targetRow),
                origin: this.name,
                type: 'tm',
                similarity: candidates[i].distance,
                properties: properties
            });
        }

        matches.sort((a: Match, b: Match): number => b.similarity - a.similarity);
        return limit !== undefined ? matches.slice(0, limit) : matches;
    }

    searchAll(text: string, srcLang: string, similarity: number, limit?: number, caseSensitive?: boolean): Array<XMLElement> {
        if (text.trim() === '') {
            return [];
        }
        let candidates: Array<FuzzyCandidate> = this.findFuzzyCandidates(text, srcLang, similarity, caseSensitive);
        candidates.sort((a: FuzzyCandidate, b: FuzzyCandidate): number => b.distance - a.distance);

        let results: Array<XMLElement> = [];
        for (let i: number = 0; i < candidates.length; i++) {
            if (limit !== undefined && results.length >= limit) {
                break;
            }
            let tu: XMLElement | undefined = this.getTuById(candidates[i].id);
            if (tu !== undefined) {
                results.push(tu);
            }
        }
        return results;
    }

    private findFuzzyCandidates(text: string, srcLang: string, similarity: number, caseSensitive?: boolean): Array<FuzzyCandidate> {
        let ngrams: Array<string> = NGrams.getNGrams(text, srcLang);

        let minCount: number = Math.floor(ngrams.length * similarity / 100);
        let maxCount: number = Math.floor(ngrams.length * (200 - similarity) / 100);
        let minLength: number = Math.floor(text.length * similarity / 100);
        let maxLength: number = Math.floor(text.length * (200 - similarity) / 100);

        let deltaTable: string = this.ensureDeltaNgramTable(srcLang);
        let selectDeltaStatement: StatementSync = this.db.prepare(
            'SELECT id FROM "' + deltaTable + '" WHERE ngram = ?');
        let packedTable: string = this.ensurePackedNgramTable(srcLang);
        let selectPackedStatement: StatementSync = this.db.prepare(
            'SELECT tuids FROM "' + packedTable + '" WHERE ngram = ?');

        let counts: Map<number, number> = new Map<number, number>();
        for (let i: number = 0; i < ngrams.length; i++) {
            let deltaRows: Array<Record<string, SQLOutputValue>> = selectDeltaStatement.all(ngrams[i]);
            for (let j: number = 0; j < deltaRows.length; j++) {
                let id: number = deltaRows[j].id as number;
                counts.set(id, (counts.get(id) ?? 0) + 1);
            }

            let packedRow: Record<string, SQLOutputValue> | undefined = selectPackedStatement.get(ngrams[i]);
            if (packedRow !== undefined) {
                let ids: Array<number> = TranslationMemory.decodeIds(packedRow.tuids as Uint8Array);
                for (let j: number = 0; j < ids.length; j++) {
                    counts.set(ids[j], (counts.get(ids[j]) ?? 0) + 1);
                }
            }
        }

        let compareText: string = caseSensitive === true ? text : this.safeLowerCase(text, srcLang);
        let entries: Array<[number, number]> = Array.from(counts.entries());
        let results: Array<FuzzyCandidate> = [];
        for (let i: number = 0; i < entries.length; i++) {
            let id: number = entries[i][0];
            let count: number = entries[i][1];
            if (count < minCount || count > maxCount) {
                continue;
            }

            let sourceRow: Record<string, SQLOutputValue> | undefined = this.selectTuvByLangStatement.get(id, srcLang);
            if (sourceRow === undefined) {
                continue;
            }
            let textlength: number = sourceRow.textlength as number;
            if (textlength < minLength || textlength > maxLength) {
                continue;
            }
            let candidateText: string = sourceRow.puretext as string;
            let distance: number = MatchQuality.similarity(compareText, caseSensitive === true ? candidateText : this.safeLowerCase(candidateText, srcLang));
            if (distance < similarity) {
                continue;
            }

            results.push({ id: id, distance: distance, sourceRow: sourceRow });
        }
        return results;
    }


    private safeLowerCase(text: string, lang: string): string {
        if (this.safeLangs.has(lang)) {
            return text.toLocaleLowerCase(this.safeLangs.get(lang) as string);
        }
        let code: string | undefined = LanguageUtils.normalizeCode(lang);
        if (code) {
            this.safeLangs.set(lang, code);
            return text.toLocaleLowerCase(code);
        }
        return text.toLowerCase();
    }

    getMetadataValues(field: string): Array<string> {
        let rows: Array<Record<string, SQLOutputValue>> = this.selectMetadataValuesStatement.all(field);
        return rows.map((row: Record<string, SQLOutputValue>): string => row.value as string);
    }

    concordanceSearch(text: string, srcLang: string, limit?: number, isRegexp?: boolean, caseSensitive?: boolean): Array<XMLElement> {
        if (text.trim() === '') {
            return [];
        }
        if (isRegexp === true) {
            // throw error if invalid regexp
            new RegExp(text);
        }

        let pattern: string;
        let sql: string;
        if (isRegexp === true) {
            pattern = text;
            sql = 'SELECT DISTINCT tuId FROM tuv WHERE lang = ? AND TEXT_MATCHES(puretext, ?)';
        } else if (caseSensitive === true) {
            pattern = '*' + text + '*';
            sql = 'SELECT DISTINCT tuId FROM tuv WHERE lang = ? AND puretext GLOB ?';
        } else {
            let escaped: string = text.replace(/%/g, '\\%').replace(/_/g, '\\_');
            pattern = '%' + escaped + '%';
            sql = 'SELECT DISTINCT tuId FROM tuv WHERE lang = ? AND puretext LIKE ? ESCAPE \'\\\'';
        }
        if (limit !== undefined) {
            sql += ' LIMIT ?';
        }

        let statement: StatementSync = this.db.prepare(sql);
        let rows: Array<Record<string, SQLOutputValue>> = limit !== undefined
            ? statement.all(srcLang, pattern, limit)
            : statement.all(srcLang, pattern);

        let results: Array<XMLElement> = [];
        for (let i: number = 0; i < rows.length; i++) {
            let tu: XMLElement | undefined = this.getTuById(rows[i].tuId as number);
            if (tu !== undefined) {
                results.push(tu);
            }
        }
        return results;
    }

    storeTMX(tmxFile: string, metadata?: Record<string, string>, onProgress?: (count: number) => void): number {
        let moduleDir: string = dirname(fileURLToPath(import.meta.url));
        let catalog: Catalog = new Catalog(join(moduleDir, 'catalog', 'catalog.xml'));
        let handler: TMXContentHandler = new TMXContentHandler(this, metadata, onProgress);
        let parser: SAXParser = new SAXParser();
        parser.setCatalog(catalog);
        parser.setContentHandler(handler);
        this.bulkNgramMode = true;
        try {
            parser.parseFile(tmxFile);
        } catch (error) {
            this.rollback();
            this.bulkNgramMode = false;
            throw error;
        }
        this.bulkNgramMode = false;
        this.compactTouchedLanguages();
        return handler.getCount();
    }

    compactTouchedLanguages(): void {
        this.bulkLanguagesTouched.forEach((lang: string): void => {
            this.compactNgramIndex(lang);
        });
        this.bulkLanguagesTouched.clear();
    }

    compactNgramIndex(lang: string): void {
        let deltaTable: string = this.ensureDeltaNgramTable(lang);
        let packedTable: string = this.ensurePackedNgramTable(lang);

        let selectDeltaStatement: StatementSync = this.db.prepare(
            'SELECT ngram, id FROM "' + deltaTable + '" ORDER BY ngram');
        let rows: Array<Record<string, SQLOutputValue>> = selectDeltaStatement.all();
        if (rows.length === 0) {
            return;
        }

        let grouped: Map<string, Array<number>> = new Map<string, Array<number>>();
        for (let i: number = 0; i < rows.length; i++) {
            let ngram: string = rows[i].ngram as string;
            let id: number = rows[i].id as number;
            let ids: Array<number> | undefined = grouped.get(ngram);
            if (ids === undefined) {
                ids = [];
                grouped.set(ngram, ids);
            }
            ids.push(id);
        }

        let selectPackedStatement: StatementSync = this.db.prepare(
            'SELECT tuids FROM "' + packedTable + '" WHERE ngram = ?');
        let upsertPackedStatement: StatementSync = this.db.prepare(
            'INSERT OR REPLACE INTO "' + packedTable + '" (ngram, tuids) VALUES (?, ?)');

        let ngrams: Array<string> = Array.from(grouped.keys());
        for (let i: number = 0; i < ngrams.length; i++) {
            let ngram: string = ngrams[i];
            let newIds: Array<number> = grouped.get(ngram) as Array<number>;
            let existingRow: Record<string, SQLOutputValue> | undefined = selectPackedStatement.get(ngram);
            let merged: Set<number> = existingRow !== undefined
                ? new Set<number>(TranslationMemory.decodeIds(existingRow.tuids as Uint8Array))
                : new Set<number>();
            for (let j: number = 0; j < newIds.length; j++) {
                merged.add(newIds[j]);
            }
            upsertPackedStatement.run(ngram, TranslationMemory.encodeIds(Array.from(merged)));
        }

        this.db.exec('DELETE FROM "' + deltaTable + '"');
    }

    beginTransaction(): void {
        this.db.exec('BEGIN');
    }

    commit(): void {
        this.db.exec('COMMIT');
    }

    rollback(): void {
        this.db.exec('ROLLBACK');
    }

    exportMemory(tmxFile: string, langs: Array<string>, srcLang: string): void {
        let moduleDir: string = dirname(fileURLToPath(import.meta.url));
        let packageJson: { version: string } = JSON.parse(readFileSync(join(moduleDir, '..', 'package.json'), 'utf8'));

        let fd: number = openSync(tmxFile, 'w');
        writeSync(fd, '<?xml version="1.0" encoding="UTF-8"?>\n');
        writeSync(fd, '<!DOCTYPE tmx PUBLIC "-//LISA OSCAR:1998//DTD for Translation Memory eXchange//EN" "tmx14.dtd">\n');
        writeSync(fd, '<tmx version="1.4">\n');
        writeSync(fd, '<header creationtool="TypesMem" creationtoolversion="' + packageJson.version + '" srclang="' + srcLang +
            '" adminlang="en" datatype="xml" o-tmf="unknown" segtype="block" creationdate="' + TMUtils.creationDate() + '"/>\n');
        writeSync(fd, '<body>\n');

        let indenter: Indenter = new Indenter(2, 2);
        let tuRows: Array<Record<string, SQLOutputValue>> = this.selectExportableTusStatement.all();
        for (let i: number = 0; i < tuRows.length; i++) {
            let id: number = tuRows[i].id as number;
            let syntheticTuid: number = tuRows[i].syntheticTuid as number;
            let tu: XMLElement = this.getTuById(id) as XMLElement;
            if (syntheticTuid === 1) {
                tu.removeAttribute('tuid');
            }

            let tuvElements: Array<XMLElement> = tu.getChildren().filter((child: XMLElement): boolean => child.getName() === 'tuv');
            let kept: number = 0;
            for (let j: number = 0; j < tuvElements.length; j++) {
                let tuvElement: XMLElement = tuvElements[j];
                let langAttribute: XMLAttribute | undefined = tuvElement.getAttribute('xml:lang');
                let lang: string = langAttribute !== undefined ? langAttribute.getValue() : '';
                if (langs.indexOf(lang) === -1) {
                    tu.removeChild(tuvElement);
                } else {
                    kept++;
                }
            }
            if (kept < 2) {
                continue;
            }

            indenter.indent(tu);
            writeSync(fd, tu.toString() + '\n');
        }

        writeSync(fd, '</body>\n');
        writeSync(fd, '</tmx>\n');
        closeSync(fd);
    }

    removeTu(tuid: string): void {
        let row: Record<string, SQLOutputValue> | undefined = this.selectIdByTuidStatement.get(tuid);
        if (row === undefined) {
            return;
        }
        let id: number = row.id as number;
        this.clearChildData(id);
        this.deleteTuStatement.run(id);
    }

    close(): void {
        this.db.close();
    }

    deleteDatabase(): void {
        this.db.close();
        rmSync(this.memoryFolder, { recursive: true, force: true });
    }

    private clearChildData(id: number): void {
        let tuvRows: Array<Record<string, SQLOutputValue>> = this.selectTuvStatement.all(id);
        for (let i: number = 0; i < tuvRows.length; i++) {
            let lang: string = tuvRows[i].lang as string;
            let puretext: string = tuvRows[i].puretext as string;
            let ngrams: Array<string> = NGrams.getNGrams(puretext, lang);
            for (let n: number = 0; n < ngrams.length; n++) {
                this.removeFromNgramIndex(lang, ngrams[n], id);
            }
        }
        this.deleteTuvPropertiesStatement.run(id);
        this.deleteTuvNotesStatement.run(id);
        this.deleteTuvStatement.run(id);
        this.deletePropertiesStatement.run(id);
        this.deleteNotesStatement.run(id);
    }

    private clearTuvDataForLangs(id: number, langs: Set<string>): void {
        langs.forEach((lang: string): void => {
            let tuvRows: Array<Record<string, SQLOutputValue>> = this.selectTuvByLangStatement.all(id, lang);
            for (let i: number = 0; i < tuvRows.length; i++) {
                let puretext: string = tuvRows[i].puretext as string;
                let ngrams: Array<string> = NGrams.getNGrams(puretext, lang);
                for (let n: number = 0; n < ngrams.length; n++) {
                    this.removeFromNgramIndex(lang, ngrams[n], id);
                }
            }
            this.deleteTuvPropertiesByLangStatement.run(id, lang);
            this.deleteTuvNotesByLangStatement.run(id, lang);
            this.deleteTuvByLangStatement.run(id, lang);
        });
    }

    private buildTuvElement(row: Record<string, SQLOutputValue>): XMLElement {
        let tuvElement: XMLElement = new XMLElement('tuv');
        tuvElement.setAttribute(new XMLAttribute('xml:lang', row.lang as string));
        if (row.oEncoding !== null) {
            tuvElement.setAttribute(new XMLAttribute('o-encoding', row.oEncoding as string));
        }
        if (row.datatype !== null) {
            tuvElement.setAttribute(new XMLAttribute('datatype', row.datatype as string));
        }
        if (row.usagecount !== null) {
            tuvElement.setAttribute(new XMLAttribute('usagecount', row.usagecount as string));
        }
        if (row.lastusagedate !== null) {
            tuvElement.setAttribute(new XMLAttribute('lastusagedate', row.lastusagedate as string));
        }
        if (row.creationtool !== null) {
            tuvElement.setAttribute(new XMLAttribute('creationtool', row.creationtool as string));
        }
        if (row.creationtoolversion !== null) {
            tuvElement.setAttribute(new XMLAttribute('creationtoolversion', row.creationtoolversion as string));
        }
        if (row.creationdate !== null) {
            tuvElement.setAttribute(new XMLAttribute('creationdate', row.creationdate as string));
        }
        if (row.creationid !== null) {
            tuvElement.setAttribute(new XMLAttribute('creationid', row.creationid as string));
        }
        if (row.changedate !== null) {
            tuvElement.setAttribute(new XMLAttribute('changedate', row.changedate as string));
        }
        if (row.changeid !== null) {
            tuvElement.setAttribute(new XMLAttribute('changeid', row.changeid as string));
        }
        if (row.oTmf !== null) {
            tuvElement.setAttribute(new XMLAttribute('o-tmf', row.oTmf as string));
        }

        let tuvId: number = Number(row.id);
        let noteRows: Array<Record<string, SQLOutputValue>> = this.selectTuvNotesStatement.all(tuvId);
        for (let i: number = 0; i < noteRows.length; i++) {
            let noteElement: XMLElement = new XMLElement('note');
            noteElement.addString(noteRows[i].note as string);
            tuvElement.addElement(noteElement);
        }

        let propertyRows: Array<Record<string, SQLOutputValue>> = this.selectTuvPropertiesStatement.all(tuvId);
        for (let i: number = 0; i < propertyRows.length; i++) {
            let propElement: XMLElement = new XMLElement('prop');
            propElement.setAttribute(new XMLAttribute('type', propertyRows[i].name as string));
            propElement.addString(propertyRows[i].value as string);
            tuvElement.addElement(propElement);
        }

        tuvElement.addElement(TMUtils.parseSegment(row.seg as string, this.i18n));
        return tuvElement;
    }

    private nextId(): string {
        if (this.next === 0) {
            this.next = Date.now();
        }
        return '' + this.next++;
    }

    private normalizeLang(lang: string): string {
        if (this.langCache.has(lang)) {
            return this.langCache.get(lang) as string;
        }
        let code: string | undefined = LanguageUtils.normalizeCode(lang);
        if (code) {
            this.langCache.set(lang, code);
            return code;
        }
        let safeLang = '';
        for (let i: number = 0; i < lang.length; i++) {
            let c: string = lang.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-') {
                safeLang += c;
            }
            if (c === '_') {
                safeLang += '-';
            }
        }
        this.langCache.set(lang, safeLang);
        return safeLang;
    }

    private validatedLangTag(lang: string): string {
        lang = this.normalizeLang(lang);
        return lang.replace(/-/g, '_');
    }

    private ensureDeltaNgramTable(lang: string): string {
        let tableName: string = 'ngrams_' + this.validatedLangTag(lang);
        if (!this.ensuredDeltaNgramTables.has(tableName)) {
            this.db.exec('CREATE TABLE IF NOT EXISTS "' + tableName +
                '" (ngram TEXT NOT NULL, id INTEGER NOT NULL, PRIMARY KEY(ngram, id)) STRICT, WITHOUT ROWID');
            this.ensuredDeltaNgramTables.add(tableName);
        }
        return tableName;
    }

    private ensurePackedNgramTable(lang: string): string {
        let tableName: string = 'ngramsPacked_' + this.validatedLangTag(lang);
        if (!this.ensuredPackedNgramTables.has(tableName)) {
            this.db.exec('CREATE TABLE IF NOT EXISTS "' + tableName +
                '" (ngram TEXT PRIMARY KEY, tuids BLOB NOT NULL) STRICT, WITHOUT ROWID');
            this.ensuredPackedNgramTables.add(tableName);
        }
        return tableName;
    }

    private addToNgramIndex(lang: string, ngram: string, id: number): void {
        if (this.bulkNgramMode) {
            let tableName: string = this.ensureDeltaNgramTable(lang);
            let insertStatement: StatementSync = this.db.prepare(
                'INSERT OR IGNORE INTO "' + tableName + '" (ngram, id) VALUES (?, ?)');
            insertStatement.run(ngram, id);
            this.bulkLanguagesTouched.add(lang);
            return;
        }

        let packedTable: string = this.ensurePackedNgramTable(lang);
        let selectStatement: StatementSync = this.db.prepare('SELECT tuids FROM "' + packedTable + '" WHERE ngram = ?');
        let row: Record<string, SQLOutputValue> | undefined = selectStatement.get(ngram);
        let ids: Array<number> = row !== undefined ? TranslationMemory.decodeIds(row.tuids as Uint8Array) : [];
        if (ids.indexOf(id) !== -1) {
            return;
        }
        ids.push(id);
        let upsertStatement: StatementSync = this.db.prepare(
            'INSERT OR REPLACE INTO "' + packedTable + '" (ngram, tuids) VALUES (?, ?)');
        upsertStatement.run(ngram, TranslationMemory.encodeIds(ids));
    }

    private removeFromNgramIndex(lang: string, ngram: string, id: number): void {
        let deltaTable: string = this.ensureDeltaNgramTable(lang);
        this.db.prepare('DELETE FROM "' + deltaTable + '" WHERE ngram = ? AND id = ?').run(ngram, id);

        let packedTable: string = this.ensurePackedNgramTable(lang);
        let selectStatement: StatementSync = this.db.prepare('SELECT tuids FROM "' + packedTable + '" WHERE ngram = ?');
        let row: Record<string, SQLOutputValue> | undefined = selectStatement.get(ngram);
        if (row === undefined) {
            return;
        }
        let ids: Array<number> = TranslationMemory.decodeIds(row.tuids as Uint8Array);
        let index: number = ids.indexOf(id);
        if (index === -1) {
            return;
        }
        ids.splice(index, 1);
        if (ids.length === 0) {
            this.db.prepare('DELETE FROM "' + packedTable + '" WHERE ngram = ?').run(ngram);
        } else {
            this.db.prepare('UPDATE "' + packedTable + '" SET tuids = ? WHERE ngram = ?').run(TranslationMemory.encodeIds(ids), ngram);
        }
    }

    private static encodeIds(ids: Array<number>): Uint8Array {
        let buffer: Buffer = Buffer.alloc(ids.length * 4);
        for (let i: number = 0; i < ids.length; i++) {
            buffer.writeUInt32LE(ids[i], i * 4);
        }
        return buffer;
    }

    private static decodeIds(blob: Uint8Array): Array<number> {
        let buffer: Buffer = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
        let count: number = buffer.length / 4;
        let result: Array<number> = new Array<number>(count);
        for (let i: number = 0; i < count; i++) {
            result[i] = buffer.readUInt32LE(i * 4);
        }
        return result;
    }
}
