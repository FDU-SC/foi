import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

export function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

export function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function nodes<T extends ts.Node>(root: ts.Node, matches: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  function visit(node: ts.Node) {
    if (matches(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

export function moduleSpecifiers(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map(({ fileName }) => fileName);
}

export function importBindings(file: ts.SourceFile) {
  return file.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
    const clause = declaration.importClause;
    if (!clause || clause.isTypeOnly || !ts.isStringLiteral(declaration.moduleSpecifier)) return [];
    const source = declaration.moduleSpecifier.text;
    const bindings = clause.namedBindings;
    const names = clause.name ? [{ local: clause.name.text, imported: "default", source }] : [];
    if (bindings && ts.isNamespaceImport(bindings)) {
      names.push({ local: bindings.name.text, imported: "*", source });
    } else if (bindings) {
      names.push(...bindings.elements.filter((entry) => !entry.isTypeOnly).map((entry) => ({
        local: entry.name.text, imported: (entry.propertyName ?? entry.name).text, source,
      })));
    }
    return names;
  });
}

export function exportedNames(file: ts.SourceFile): string[] {
  function bindingNames(name: ts.BindingName): string[] {
    return ts.isIdentifier(name) ? [name.text] : name.elements
      .flatMap((element) => ts.isBindingElement(element) ? bindingNames(element.name) : []);
  }
  return file.statements.flatMap((statement) => {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const clause = statement.exportClause;
      return clause && ts.isNamedExports(clause)
        ? clause.elements.filter((entry) => !entry.isTypeOnly).map((entry) => entry.name.text) : [];
    }
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return [];
    if (ts.isFunctionDeclaration(statement)) return statement.name ? [statement.name.text] : [];
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((d) => bindingNames(d.name));
    return [];
  });
}
