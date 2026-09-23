import { ApiCatalog, ApiMethod, ApiModule } from './catalog';

export interface LuaStub {
  filename: string;
  content: string;
}

function typeName(type?: string): string {
  return type && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(type) ? type : 'any';
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

export function renderLuaStubs(catalog: ApiCatalog): LuaStub[] {
  const stubs: LuaStub[] = [];
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
  if (globals) {
    const lines = ['---@diagnostic disable: duplicate-set-field'];
    for (const method of globals.methods) lines.push(...methodLines(method, '', false));
    stubs.push({ filename: '_aubo_globals.lua', content: `${lines.join('\n')}\n` });
  }
  return stubs;
}
