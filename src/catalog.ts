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

export type ApiTypeKind = 'record' | 'enum' | 'alias';

export interface ApiTypeField {
  name: string;
  type?: string;
  description?: string;
}

export interface ApiTypeValue {
  name: string;
  value?: string | number;
  description?: string;
}

/** Public data type metadata. This is declarative and contains no SDK headers. */
export interface ApiType {
  name: string;
  kind: ApiTypeKind;
  fields?: ApiTypeField[];
  values?: ApiTypeValue[];
  alias?: string;
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
  types?: ApiType[];
  modules: ApiModule[];
}

export interface MacroValidation {
  status: 'passed';
  interfaceVersion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateTypeName(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
    throw new Error(`AUBO API catalog ${label} is malformed`);
  }
  return value;
}

function parseTypes(value: unknown): ApiType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('AUBO API catalog types are malformed');
  const names = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name ||
        !['record', 'enum', 'alias'].includes(String(item.kind))) {
      throw new Error(`AUBO API catalog type is malformed: ${index}`);
    }
    if (names.has(item.name)) throw new Error(`AUBO API catalog contains duplicate type: ${item.name}`);
    names.add(item.name);
    const kind = item.kind as ApiTypeKind;
    const result: ApiType = { name: item.name, kind };
    if (item.description !== undefined) result.description = validateTypeName(item.description, 'type description');
    if (kind === 'alias') {
      const alias = validateTypeName(item.alias, `type ${item.name} alias`);
      if (!alias) throw new Error(`AUBO API catalog alias type is missing alias: ${item.name}`);
      result.alias = alias;
    }
    if (kind === 'record') {
      if (item.fields !== undefined && !Array.isArray(item.fields)) {
        throw new Error(`AUBO API catalog record fields are malformed: ${item.name}`);
      }
      if (Array.isArray(item.fields)) {
        const fieldNames = new Set<string>();
        result.fields = item.fields.map((field, fieldIndex) => {
          if (!isRecord(field) || typeof field.name !== 'string' || !field.name) {
            throw new Error(`AUBO API catalog field is malformed: ${item.name}.${fieldIndex}`);
          }
          if (fieldNames.has(field.name)) throw new Error(`AUBO API catalog contains duplicate field: ${item.name}.${field.name}`);
          fieldNames.add(field.name);
          return {
            name: field.name,
            ...(validateTypeName(field.type, `field ${item.name}.${field.name} type`) ? { type: field.type as string } : {}),
            ...(validateTypeName(field.description, `field ${item.name}.${field.name} description`) ? { description: field.description as string } : {})
          };
        });
      }
    }
    if (kind === 'enum') {
      if (item.values !== undefined && !Array.isArray(item.values)) {
        throw new Error(`AUBO API catalog enum values are malformed: ${item.name}`);
      }
      if (Array.isArray(item.values)) {
        const valueNames = new Set<string>();
        result.values = item.values.map((entry, valueIndex) => {
          if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name ||
              (entry.value !== undefined && typeof entry.value !== 'string' && typeof entry.value !== 'number')) {
            throw new Error(`AUBO API catalog enum value is malformed: ${item.name}.${valueIndex}`);
          }
          if (valueNames.has(entry.name)) throw new Error(`AUBO API catalog contains duplicate enum value: ${item.name}.${entry.name}`);
          valueNames.add(entry.name);
          return {
            name: entry.name,
            ...(entry.value === undefined ? {} : { value: entry.value }),
            ...(validateTypeName(entry.description, `enum ${item.name}.${entry.name} description`) ? { description: entry.description as string } : {})
          };
        });
      }
    }
    return result;
  });
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

  const types = parseTypes(value.types);

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
  const primitiveTypes = new Set(['any', 'boolean', 'function', 'int', 'integer', 'number', 'string', 'table', 'void', 'nil']);
  const typeNames = new Set([...(types || []).map((type) => type.name), ...moduleNames]);
  const knownType = (value: string): boolean => {
    const normalized = value.replace(/\s+/g, '');
    const identifiers = normalized.match(/[A-Za-z_]\w*/g) || [];
    return identifiers.every((identifier) => primitiveTypes.has(identifier) || typeNames.has(identifier) ||
      ['const', 'struct', 'class', 'std', 'vector', 'array', 'map', 'optional', 'tuple'].includes(identifier));
  };
  for (const module of modules) {
    for (const property of module.properties || []) {
      if (property.type && !knownType(property.type)) {
        throw new Error(`AUBO API catalog property type has no module: ${property.type}`);
      }
    }
  }
  for (const type of types || []) {
    if (type.alias && !knownType(type.alias)) {
      throw new Error(`AUBO API catalog alias type has no public type: ${type.alias}`);
    }
    for (const field of type.fields || []) {
      if (field.type && !knownType(field.type)) {
        throw new Error(`AUBO API catalog field type has no public type: ${field.type}`);
      }
    }
  }

  return {
    schemaVersion: 1,
    interfaceVersion: value.interfaceVersion,
    sdkCommit: typeof value.sdkCommit === 'string' ? value.sdkCommit : undefined,
    sdkVersion: typeof value.sdkVersion === 'string' ? value.sdkVersion : undefined,
    macroValidation,
    types,
    modules
  };
}

function moduleFor(catalog: ApiCatalog, moduleName?: string,
  seen = new Set<string>()): ApiModule | undefined {
  if (!moduleName) return undefined;
  const container = moduleName.match(/^(.*?)(?:\[\s*\d*\s*\])+$/);
  if (container) return moduleFor(catalog, container[1], seen);
  const direct = catalog.modules.find((module) =>
    module.name === moduleName || module.luaModule === moduleName);
  if (direct || seen.has(moduleName)) return direct;
  const directType = catalog.types?.find((type) => type.name === moduleName);
  if (directType) {
    if (directType.kind === 'alias' && directType.alias) return moduleFor(catalog, directType.alias, seen);
    if (directType.kind === 'enum') {
      return { name: directType.name, properties: (directType.values || []).map((entry) => ({
        name: entry.name, type: directType.name, description: entry.description
      })), methods: [] };
    }
    return { name: directType.name, properties: (directType.fields || []).map((field) => ({
      name: field.name, type: field.type, description: field.description
    })), methods: [] };
  }
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
  const first = value.match(/^([A-Za-z_]\w*)/);
  if (!first) return undefined;
  let type = variables.get(first[1]);
  let cursor = first[1].length;
  if (!type) {
    const call = value.match(/^([A-Za-z_]\w*)\s*\([^()]*\)/);
    if (call) {
      type = uniqueMethodReturnType(catalog, call[1]);
      cursor = call[0].length;
    }
  }
  // A short snippet often contains a receiver whose declaration is outside
  // the current document (`robot:getMotionControl()`). Resolve the first
  // method by its unique public return type, then continue with typed chaining.
  if (!type) {
    const methodCall = value.slice(cursor).match(/^\s*:\s*([A-Za-z_]\w*)\s*\([^()]*\)/);
    if (methodCall) {
      type = uniqueMethodReturnType(catalog, methodCall[1]);
      cursor += methodCall[0].length;
    }
  }
  if (!type) return undefined;
  let currentType: string = type;
  while (cursor < value.length) {
    const rest = value.slice(cursor);
    const method = rest.match(/^\s*:\s*([A-Za-z_]\w*)\s*\([^()]*\)/);
    if (method) {
      const next: string | undefined = methodReturnType(catalog, currentType, method[1]) || uniqueMethodReturnType(catalog, method[1]);
      if (!next) return undefined;
      currentType = next;
      cursor += method[0].length;
      continue;
    }
    const property = rest.match(/^\s*\.\s*([A-Za-z_]\w*)/);
    if (property) {
      const member = moduleFor(catalog, currentType)?.properties?.find((item) => item.name === property[1]);
      if (!member?.type) return undefined;
      currentType = member.type;
      cursor += property[0].length;
      continue;
    }
    const index = rest.match(/^\s*\[[^\]]*\]/);
    if (index) {
      const element = currentType.match(/^(.*)\[\]$/)?.[1];
      if (!element) return undefined;
      currentType = element;
      cursor += index[0].length;
      continue;
    }
    return undefined;
  }
  return moduleFor(catalog, currentType) ? currentType : undefined;
}

export function inferLuaModule(catalog: ApiCatalog, source: string,
  variable: string): ApiModule | undefined {
  const variables = new Map<string, string>([
    ['aubo', 'Aubo'], ['api', 'AuboApi'], ['_ENV', 'RobotEnvironment']
  ]);
  for (const type of catalog.types || []) variables.set(type.name, type.name);
  for (const annotation of source.matchAll(/---@type\s+([^\n]+)\n\s*(?:local\s+)?([A-Za-z_]\w*)\s*=/g)) {
    const type = annotation[1].trim();
    if (moduleFor(catalog, type)) variables.set(annotation[2], type);
  }
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
  const memberAccess = text.match(/((?:[A-Za-z_][A-Za-z0-9_]*|\[[^\]]+\])(?:(?:\s*[.:]\s*[A-Za-z_][A-Za-z0-9_]*)|(?:\s*\[[^\]]+\]))*\s*[.:])\s*([A-Za-z_][A-Za-z0-9_]*)?$/);
  if (memberAccess) {
    const moduleName = memberAccess[1].slice(0, -1).replace(/\s*[.:]\s*/g, '.');
    return { moduleName, receiver: moduleName, prefix: memberAccess[2] || '' };
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
