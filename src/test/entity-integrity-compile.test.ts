// @vitest-environment node
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ID_FIELDS } from "../data/identity";

const configPath = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
const storePath = fileURLToPath(new URL("../data/store.ts", import.meta.url));
const modelsPath = fileURLToPath(new URL("../data/models.ts", import.meta.url));
const normalize = (path: string) => path.replaceAll("\\", "/").toLowerCase();

function compile(addition = "") {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL("../../", import.meta.url)));
  expect(parsed.errors).toEqual([]);
  const host = ts.createCompilerHost(parsed.options);
  const read = host.readFile;
  // Only the compiler's in-memory view changes. No entity or source file is written.
  host.readFile = path => {
    const source = read(path);
    return addition && normalize(path) === normalize(modelsPath)
      ? source + addition
      : source;
  };
  const program = ts.createProgram([storePath], parsed.options, host);
  return { program, diagnostics: ts.getPreEmitDiagnostics(program) };
}

function errorsFor(diagnostics: readonly ts.Diagnostic[], file: string, marker: string) {
  return diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error &&
    diagnostic.file?.fileName.replaceAll("\\", "/").endsWith("/" + file) &&
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").includes(marker));
}

function within(diagnostic: ts.Diagnostic, node: ts.Node) {
  return diagnostic.file === node.getSourceFile() && diagnostic.start !== undefined &&
    diagnostic.start >= node.getStart() && diagnostic.start < node.end;
}

function descendants(source: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    node.forEachChild(visit);
  };
  visit(source);
  return found;
}

it("rejects a new entity at every mandatory registration surface without modifying the project", () => {
  expect(compile().diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))).toEqual([]);
  const { program, diagnostics } = compile("\nexport interface Entities { syntheticUnregistered: AcademicTerm; }\n");
  const entityKeys = Object.keys(ID_FIELDS);
  // Discover entity-keyed registries structurally, without naming local bindings.
  for (const file of ["identity.ts", "validation.ts", "entity-integrity.ts"]) {
    const source = program.getSourceFiles().find(source => normalize(source.fileName).endsWith("/" + file))!;
    const registries = descendants(source, node => ts.isObjectLiteralExpression(node) &&
      entityKeys.every(key => node.properties.some(property => ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === key)));
    expect(registries.length, file + " must contain entity registrations").toBeGreaterThan(0);
    for (const registry of registries) {
      let declaration = registry;
      while (!ts.isVariableDeclaration(declaration) && declaration.parent) declaration = declaration.parent;
      expect(errorsFor(diagnostics, file, "syntheticUnregistered").some(error => within(error, declaration)),
        file + " must reject the omitted entity at each registry").toBe(true);
    }
  }
  expect(errorsFor(diagnostics, "store.ts", "syntheticUnregistered").some(error => error.code === 2420)).toBe(true);
  const checker = program.getTypeChecker();
  // Locate never-parameter guards by their types, independent of argument names.
  for (const file of ["validation.ts", "store.ts"]) {
    const source = program.getSourceFiles().find(source => normalize(source.fileName).endsWith("/" + file))!;
    const guards = descendants(source, node => {
      if (!ts.isCallExpression(node)) return false;
      const parameters = checker.getResolvedSignature(node)?.parameters;
      return parameters?.length === 1 && !!parameters[0].valueDeclaration &&
        !!(checker.getTypeOfSymbolAtLocation(parameters[0], node).flags & ts.TypeFlags.Never);
    });
    expect(guards.length, file + " must retain exhaustive guards").toBeGreaterThan(0);
    for (const guard of guards)
      expect(errorsFor(diagnostics, file, "syntheticUnregistered").some(error =>
        error.code === 2345 && within(error, guard)), file + " must reject every unhandled entity guard").toBe(true);
  }
}, 30_000);

it("rejects a new UUID reference omitted from an existing entity's identity fields", () => {
  const { diagnostics } = compile("\nexport interface Course { syntheticParentId?: string | null; }\n");
  expect(errorsFor(diagnostics, "identity.ts", "syntheticParentId").some(error => error.code === 2344)).toBe(true);
}, 30_000);

it("rejects a permitted input field omitted from input registration", () => {
  const { diagnostics } = compile("\nexport interface Course { syntheticPermittedField?: string | null; }\n");
  expect(errorsFor(diagnostics, "validation.ts", "syntheticPermittedField").some(error => error.code === 2344)).toBe(true);
}, 30_000);

it("does not mistake an unrelated compiler error for missing field registration", () => {
  const { diagnostics } = compile('\nconst unrelated: never = "syntheticPermittedField syntheticParentId";\n');
  expect(diagnostics.some(error => error.code === 2322 &&
    error.file?.fileName.replaceAll("\\", "/").endsWith("/models.ts"))).toBe(true);
  expect(errorsFor(diagnostics, "validation.ts", "syntheticPermittedField")).toEqual([]);
  expect(errorsFor(diagnostics, "identity.ts", "syntheticParentId")).toEqual([]);
}, 30_000);
