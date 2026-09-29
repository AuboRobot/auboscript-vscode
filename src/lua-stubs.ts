import { ApiCatalog, ApiMethod, ApiModule, ApiType } from './catalog';

export interface LuaStub {
  filename: string;
  content: string;
}

function typeName(type?: string): string {
  if (!type || /[\r\n;]/.test(type)) return 'any';
  const value = type.trim();
  // Keep the type expression useful to LuaLS while rejecting annotation/code
  // injection from an untrusted catalog. This covers names, arrays, unions,
  // generic containers and literal aliases used by the public SDK metadata.
  if (!value || !/^[A-Za-z0-9_.$<>[\]|,:?+*\-\s]+$/.test(value) ||
      /(?:^|[^A-Za-z0-9_.$])(?:do|end|function|local|return|require)(?:$|[^A-Za-z0-9_.$])/i.test(value)) {
    return 'any';
  }
  return value;
}

function identifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

function fieldName(value: string): string {
  // LuaLS accepts numeric/index fields in annotations, but a catalog field is
  // normally an identifier. Preserve bracket notation for array-like records
  // and quote nothing from the catalog into the generated source.
  if (/^\[[^\]\r\n]+\]$/.test(value)) return value;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : identifier(value);
}

function methodLines(method: ApiMethod, receiver: string, colon: boolean): string[] {
  const names = (method.parameters || []).map((parameter, index) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.name) ? parameter.name : `arg${index + 1}`);
  const parameters = names.join(', ');
  const lines = (method.parameters || []).map((parameter, index) =>
    `---@param ${names[index]} ${typeName(parameter.type)}`);
  if (method.returnType) lines.push(`---@return ${typeName(method.returnType)}`);
  lines.push(`function ${receiver ? `${receiver}${colon ? ':' : '.'}` : ''}${method.name}(${parameters}) end`);
  return lines;
}

function moduleFile(module: ApiModule): string {
  const className = module.name.replace(/[^A-Za-z0-9_]/g, '_');
  const lines = [`---@class ${className}`];
  for (const property of module.properties || []) {
    lines.push(`---@field ${property.name} ${typeName(property.type)}`);
  }
  lines.push('local M = {}', '');
  for (const method of module.methods) lines.push(...methodLines(method, 'M', !module.luaModule));
  if (module.luaModule) lines.push('', 'return M');
  return `${lines.join('\n')}\n`;
}

function typeFile(type: ApiType): LuaStub {
  const name = identifier(type.name);
  const lines: string[] = [];
  if (type.description) lines.push(`---${type.description.replace(/[\r\n]/g, ' ')}`);
  if (type.kind === 'alias') {
    lines.push(`---@alias ${name} ${typeName(type.alias)}`);
    return { filename: `types/${name}.lua`, content: `${lines.join('\n')}\n` };
  }
  if (type.kind === 'enum') {
    const values = type.values || [];
    const literals = values.map((entry) => {
      if (entry.value !== undefined) {
        if (typeof entry.value === 'number' || /^[-+]?\d+(?:\.\d+)?$/.test(String(entry.value))) {
          return String(entry.value);
        }
        return `"${String(entry.value).replace(/"/g, '\\"')}"`;
      }
      return entry.name;
    });
    lines.push(`---@alias ${name} ${literals.length ? literals.join('|') : 'string'}`);
    lines.push(`local ${name} = {}`);
    for (const entry of values) {
      const key = fieldName(entry.name);
      const value = entry.value === undefined ? 'nil' :
        typeof entry.value === 'number' ? String(entry.value) :
          /^[-+]?\d+(?:\.\d+)?$/.test(entry.value) ? entry.value : '"' + entry.value.replace(/"/g, '\\"') + '"';
      lines.push(/^\[[^\]]+\]$/.test(key)
        ? `${name}${key} = ${value}`
        : `${name}.${key} = ${value}`);
    }
    lines.push(`return ${name}`);
    return { filename: `types/${name}.lua`, content: `${lines.join('\n')}\n` };
  }

  lines.push(`---@class ${name}`);
  for (const field of type.fields || []) {
    const description = field.description ? ` ${field.description.replace(/[\r\n]/g, ' ')}` : '';
    lines.push(`---@field ${fieldName(field.name)} ${typeName(field.type)}${description}`);
  }
  lines.push(`local ${name} = {}`, `return ${name}`);
  return { filename: `types/${name}.lua`, content: `${lines.join('\n')}\n` };
}

export function renderLuaStubs(catalog: ApiCatalog): LuaStub[] {
  const stubs: LuaStub[] = [];
  for (const type of catalog.types || []) stubs.push(typeFile(type));
  const types = catalog.modules.filter((module) => !module.luaModule);
  for (const module of types) {
    const className = module.name.replace(/[^A-Za-z0-9_]/g, '_');
    const lines = [`---@class ${className}`];
    for (const property of module.properties || []) {
      lines.push(`---@field ${property.name} ${typeName(property.type)}`);
    }
    lines.push(`local ${className} = {}`, '');
    for (const method of module.methods) lines.push(...methodLines(method, className, true));
    lines.push('');
    stubs.push({ filename: `types/${className}.lua`, content: `${lines.join('\n')}\n` });
  }

  for (const module of catalog.modules.filter((item) => item.luaModule)) {
    const filename = `${module.luaModule!.split('.').join('/')}.lua`;
    stubs.push({ filename, content: moduleFile(module) });
  }

  const globals = catalog.modules.find((module) => module.name === 'AuboSdk');
  if (globals || (catalog.types || []).some((type) => type.kind === 'enum')) {
    const lines = ['---@diagnostic disable: duplicate-set-field'];
    for (const type of catalog.types || []) {
      if (type.kind !== 'enum') continue;
      const name = identifier(type.name);
      lines.push(`---@type ${name}`, `${name} = {}`);
      for (const entry of type.values || []) lines.push(`${name}.${fieldName(entry.name).replace(/^\[|\]$/g, '')} = nil`);
    }
    if (globals) for (const method of globals.methods) lines.push(...methodLines(method, '', false));
    stubs.push({ filename: '_aubo_globals.lua', content: `${lines.join('\n')}\n` });
  }
  return stubs;
}
