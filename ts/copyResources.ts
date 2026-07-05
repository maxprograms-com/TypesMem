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

import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let moduleDir: string = dirname(fileURLToPath(import.meta.url));
let rootDir: string = join(moduleDir, '..');

cpSync(join(rootDir, 'i18n'), join(rootDir, 'dist', 'i18n'), { recursive: true });
cpSync(join(rootDir, 'catalog'), join(rootDir, 'dist', 'catalog'), { recursive: true });
