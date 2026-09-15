import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import ts from "typescript";

// Test-only loader: exercise the real server modules with explicit dependency
// overrides, without shipping test-mode switches in production code.
export function loadTypeScript(path, overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const source = readFileSync(file, "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } });
    const nativeRequire = createRequire(file);
    const require = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === "server-only") return {};
      if (name.startsWith("@/")) return load(resolve(process.cwd(), name.slice(2) + ".ts"));
      if (name.startsWith(".")) return load(resolve(dirname(file), name + ".ts"));
      return nativeRequire(name);
    };
    new Function("require", "module", "exports", outputText)(require, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load(resolve(process.cwd(), path));
}
