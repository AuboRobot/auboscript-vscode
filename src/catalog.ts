export interface ApiParameter {
  name: string;
  type?: string;
  description?: string;
}

export interface ApiMethod {
  name: string;
  parameters?: ApiParameter[];
  returnType?: string;
  description?: string;
  bindings?: string[];
}

export interface ApiProperty {
  name: string;
  type?: string;
  description?: string;
}

export interface ApiModule {
  name: string;
  /** Lua require path, for example `aubo.scheduler`. */
  luaModule?: string;
  properties?: ApiProperty[];
  methods: ApiMethod[];
}

export interface ApiCatalog {
  schemaVersion: number;
  interfaceVersion: string;
  sdkCommit?: string;
  sdkVersion?: string;
  macroValidation?: MacroValidation;
  modules: ApiModule[];
}

export interface MacroValidation {
  status: 'passed';
  interfaceVersion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadCatalog(source: string): ApiCatalog {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('AUBO API catalog is not valid JSON');
  }

  if (!isRecord(value) || value.schemaVersion !== 1 ||
      typeof value.interfaceVersion !== 'string' || !Array.isArray(value.modules)) {
    throw new Error('AUBO API catalog must contain schemaVersion, interfaceVersion, and modules');
  }
  if (value.sdkVersion !== undefined && typeof value.sdkVersion !== 'string') {
    throw new Error('AUBO API catalog sdkVersion is malformed');
  }

  let macroValidation: MacroValidation | undefined;
  if (value.macroValidation !== undefined) {
    if (!isRecord(value.macroValidation) || value.macroValidation.status !== 'passed' ||
        (value.macroValidation.interfaceVersion !== undefined &&
         typeof value.macroValidation.interfaceVersion !== 'string')) {
      throw new Error('AUBO API catalog macro validation must have status passed');
    }
    if (value.macroValidation.interfaceVersion !== undefined &&
        value.macroValidation.interfaceVersion !== value.interfaceVersion) {
      throw new Error('AUBO API catalog macro validation interfaceVersion does not match');
    }
    macroValidation = {
      status: 'passed',
      interfaceVersion: value.macroValidation.interfaceVersion
    };
  }

  const modules = value.modules.map((module) => {
    if (!isRecord(module) || typeof module.name !== 'string' || !Array.isArray(module.methods)) {
      throw new Error('AUBO API catalog module is malformed');
    }
    const methodNames = new Set<string>();
    let properties: ApiProperty[] | undefined;
    if (module.properties !== undefined) {
      if (!Array.isArray(module.properties) || module.properties.some((property) =>
        !isRecord(property) || typeof property.name !== 'string' ||
        (property.type !== undefined && typeof property.type !== 'string') ||
        (property.description !== undefined && typeof property.description !== 'string'))) {
        throw new Error('AUBO API catalog module properties are malformed');
      }
      properties = module.properties as unknown as ApiProperty[];
    }
    if (module.luaModule !== undefined && typeof module.luaModule !== 'string') {
      throw new Error('AUBO API catalog module luaModule is malformed');
    }
    const methods = module.methods.map((method) => {
      if (!isRecord(method) || typeof method.name !== 'string') {
        throw new Error('AUBO API catalog method is malformed');
      }
      if (methodNames.has(method.name)) {
        throw new Error(`AUBO API catalog contains duplicate method: ${method.name}`);
      }
      methodNames.add(method.name);
      if (method.parameters !== undefined && !Array.isArray(method.parameters)) {
        throw new Error('AUBO API catalog method parameters are malformed');
      }
      if (Array.isArray(method.parameters) && method.parameters.some((parameter) =>
        !isRecord(parameter) || typeof parameter.name !== 'string' ||
        (parameter.type !== undefined && typeof parameter.type !== 'string') ||
        (parameter.description !== undefined && typeof parameter.description !== 'string'))) {
        throw new Error('AUBO API catalog parameter is malformed');
      }
      if (method.returnType !== undefined && typeof method.returnType !== 'string') {
        throw new Error('AUBO API catalog method returnType is malformed');
      }
      if (method.description !== undefined && typeof method.description !== 'string') {
        throw new Error('AUBO API catalog method description is malformed');
      }
      if (method.bindings !== undefined &&
          (!Array.isArray(method.bindings) || method.bindings.some((binding) =>
            typeof binding !== 'string'))) {
        throw new Error('AUBO API catalog method bindings are malformed');
      }
      return method as unknown as ApiMethod;
    });
    return {
      name: module.name,
      ...(typeof module.luaModule === 'string' ? { luaModule: module.luaModule } : {}),
      ...(properties ? { properties } : {}),
      methods
    };
  });

  const moduleNames = new Set(modules.flatMap((module) =>
    [module.name, ...(module.luaModule ? [module.luaModule] : [])]));
  const primitiveTypes = new Set(['any', 'boolean', 'function', 'int', 'number', 'string', 'table', 'void']);
  for (const module of modules) {
    for (const property of module.properties || []) {
      if (property.type && !primitiveTypes.has(property.type) && !moduleNames.has(property.type)) {
        throw new Error(`AUBO API catalog property type has no module: ${property.type}`);
      }
    }
  }

  return {
    schemaVersion: 1,
    interfaceVersion: value.interfaceVersion,
    sdkCommit: typeof value.sdkCommit === 'string' ? value.sdkCommit : undefined,
    sdkVersion: typeof value.sdkVersion === 'string' ? value.sdkVersion : undefined,
    macroValidation,
    modules
  };
}

function moduleFor(catalog: ApiCatalog, moduleName?: string,
  seen = new Set<string>()): ApiModule | undefined {
  if (!moduleName) return undefined;
  const direct = catalog.modules.find((module) =>
    module.name === moduleName || module.luaModule === moduleName);
  if (direct || seen.has(moduleName)) return direct;
  seen.add(moduleName);
  const separator = moduleName.lastIndexOf('.');
  if (separator < 1) return undefined;
  const parent = moduleFor(catalog, moduleName.slice(0, separator), seen);
  const property = parent?.properties?.find((item) => item.name === moduleName.slice(separator + 1));
  return property?.type ? moduleFor(catalog, property.type, seen) : undefined;
}

export function findLuaModule(catalog: ApiCatalog, moduleName: string): ApiModule | undefined {
  return moduleFor(catalog, moduleName);
}

function methodReturnType(catalog: ApiCatalog, moduleName: string, methodName: string): string | undefined {
  return findMethod(catalog, methodName, undefined, moduleName)?.returnType;
}

function uniqueMethodReturnType(catalog: ApiCatalog, methodName: string): string | undefined {
  const types = new Set(catalog.modules.flatMap((module) => module.methods)
    .filter((method) => method.name === methodName && method.returnType)
    .map((method) => method.returnType as string));
  return types.size === 1 ? [...types][0] : undefined;
}

function resolveLuaExpression(catalog: ApiCatalog, expression: string,
  variables: Map<string, string>): string | undefined {
  let value = expression.trim().replace(/^\((.*)\)$/, '$1').split(/\s+or\s+/)[0].trim();
  const call = value.match(/^([A-Za-z_]\w*)(?::([A-Za-z_]\w*)\([^()]*\))+$/);
  if (call) {
    let base = variables.get(call[1]);
    const methods = [...value.matchAll(/:([A-Za-z_]\w*)\(/g)].map((match) => match[1]);
    for (const method of methods) {
      const next = base ? methodReturnType(catalog, base, method) : uniqueMethodReturnType(catalog, method);
      if (!next) return undefined;
      base = next;
      value = next;
    }
    return value;
  }
  const parts = value.split('.');
  let type = variables.get(parts.shift() || '') || value;
  for (const part of parts) {
    const module = moduleFor(catalog, type);
    const property = module?.properties?.find((item) => item.name === part);
    if (!property?.type) return undefined;
    type = property.type;
  }
  return moduleFor(catalog, type) ? type : undefined;
}

export function inferLuaModule(catalog: ApiCatalog, source: string,
  variable: string): ApiModule | undefined {
  const variables = new Map<string, string>([
    ['aubo', 'Aubo'], ['api', 'AuboApi'], ['_ENV', 'RobotEnvironment']
  ]);
  const assignments = [...source.matchAll(/\b(?:local\s+)?([A-Za-z_]\w*)\s*=\s*([^\n;]+)/g)];
  for (let pass = 0; pass < assignments.length + 1; pass += 1) {
    let changed = false;
    for (const assignment of assignments) {
      const type = resolveLuaExpression(catalog, assignment[2], variables);
      if (type && variables.get(assignment[1]) !== type) {
        variables.set(assignment[1], type);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const type = variables.get(variable) || resolveLuaExpression(catalog, variable, variables);
  return type ? moduleFor(catalog, type) : undefined;
}

export function findMethods(catalog: ApiCatalog, query: string, binding?: string,
  moduleName?: string): ApiMethod[] {
  const needle = query.toLowerCase();
  const module = moduleFor(catalog, moduleName);
  if (moduleName && !module) return [];
  return (module ? module.methods : catalog.modules.flatMap((item) => item.methods))
    .filter((method) => method.name.toLowerCase().includes(needle))
    .filter((method) => !binding || !method.bindings || method.bindings.includes(binding));
}

export function findMethod(catalog: ApiCatalog, name: string, binding?: string,
  moduleName?: string): ApiMethod | undefined {
  const module = moduleFor(catalog, moduleName);
  if (moduleName && !module) return undefined;
  return (module ? module.methods : catalog.modules.flatMap((item) => item.methods))
    .find((method) => method.name === name &&
      (!binding || !method.bindings || method.bindings.includes(binding)));
}

export function findLuaModules(catalog: ApiCatalog, query: string): ApiModule[] {
  const needle = query.toLowerCase();
  return catalog.modules.filter((module) => {
    const name = module.luaModule || module.name;
    return name.toLowerCase().includes(needle);
  });
}

export function findLuaMembers(catalog: ApiCatalog, moduleName: string, query: string):
  Array<{ name: string; type?: string; description?: string; method?: ApiMethod }> {
  const module = moduleFor(catalog, moduleName);
  if (!module) return [];
  const needle = query.toLowerCase();
  const properties = (module.properties || []).map((property) => ({ ...property }));
  const methods = module.methods.map((method) => ({
    name: method.name,
    type: method.returnType,
    description: method.description,
    method
  }));
  return [...properties, ...methods].filter((member) => member.name.toLowerCase().includes(needle));
}

export interface LuaAccess {
  moduleName?: string;
  receiver?: string;
  prefix: string;
}

export function parseLuaAccess(text: string): LuaAccess {
  const chained = text.match(/((?:[A-Za-z_]\w*(?::[A-Za-z_]\w*\([^()]*\))?)+:)([A-Za-z_]\w*)?$/);
  if (chained && chained[1].includes(':') && chained[1].includes('(')) {
    return {
      moduleName: chained[1].slice(0, -1),
      receiver: chained[1].slice(0, -1),
      prefix: chained[2] || ''
    };
  }
  const trailing = text.match(/((?:[A-Za-z_][A-Za-z0-9_]*[.:])+)$/);
  if (trailing) {
    const moduleName = trailing[1].slice(0, -1).replace(/:/g, '.');
    return { moduleName, receiver: moduleName, prefix: '' };
  }
  const match = text.match(/((?:[A-Za-z_][A-Za-z0-9_]*[.:])*)([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return { prefix: '' };
  const moduleName = match[1] ? match[1].slice(0, -1).replace(/:/g, '.') : undefined;
  return {
    moduleName,
    receiver: moduleName,
    prefix: match[2]
  };
}
